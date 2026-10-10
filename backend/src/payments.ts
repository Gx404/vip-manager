import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { categories } from "../../shared/subscriptions.ts";
import { currencyCodes } from "../../shared/currency.ts";
import { paymentState, type Payment, type PaymentPreview } from "../../shared/payments.ts";
import { dateSchema, idSchema } from "./validation.ts";
import { RenewalHistory, renewalFromRow } from "./renewal-history.ts";
import { ExchangeRates } from "./exchange-rates.ts";
import { transaction } from "./database.ts";
import { ApiError } from "./errors.ts";

const amount = z.number().finite().min(0).max(10_000_000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001, "金额最多两位小数。");
const fields = { amount, currency: z.enum(currencyCodes), paidOn: dateSchema, startDate: dateSchema, endDate: dateSchema, note: z.string().trim().max(500) };
export const paymentInputSchema = z.object(fields).strict().refine(p => p.endDate > p.startDate, "到期日期必须晚于开始日期。");
export const paymentSchema = z.object({ ...fields, rate: z.number().finite().positive().max(100_000), rateDate: dateSchema,
  category: z.enum(categories), plan: z.string().max(80), source: z.enum(["backfill", "renewal"]),
  confirmedAt: z.string().datetime(), voidedAt: z.string().datetime().nullable(),
}).strict().refine(p => p.endDate > p.startDate && p.rateDate <= p.startDate && (p.currency !== "CNY" || p.rate === 1), "支付账期或汇率不正确。")
  .refine(p => !p.voidedAt || p.voidedAt >= p.confirmedAt, "作废时间不正确。");
const batchSchema = z.object({ subscriptionId: idSchema, entries: z.array(paymentInputSchema).min(1).max(36) }).strict();

/** One ledger for schedule events and explicit payments. All writes are owner-scoped and atomic. */
export class PaymentService {
  private db: DatabaseSync;
  private rates: ExchangeRates;
  constructor(db: DatabaseSync, rates = new ExchangeRates()) { this.db = db; this.rates = rates; }
  all(owner: number) { return this.db.prepare("SELECT * FROM subscription_renewal_logs WHERE user_id=? ORDER BY created_at DESC,id DESC").all(owner).map(renewalFromRow); }
  private subscription(owner: number, id: string) {
    const row = this.db.prepare("SELECT * FROM subscriptions WHERE user_id=? AND id=?").get(owner,id);
    if (!row) throw new ApiError(404,"订阅不存在，请刷新后重试。");
    return row;
  }
  private duplicate(owner: number, subscriptionId: string, start: string, end: string, except?: string): boolean {
    return this.all(owner).some(log => {
      if (log.subscriptionId !== subscriptionId || log.id === except || paymentState(log) === "void") return false;
      // Multi-period automatic catch-up is an audit only; backfill each real payment separately.
      if (!log.payment && log.periods > 1) return false;
      const from = log.payment?.startDate ?? log.newStartDate, to = log.payment?.endDate ?? log.newEndDate;
      return from < end && to > start;
    });
  }
  private checkDate(p: { paidOn: string; startDate: string }) {
    if (p.paidOn > new Date().toISOString().slice(0,10)) throw new ApiError(400,"付款日期不能晚于今天。");
  }
  async preview(owner: number, value: unknown): Promise<{ entries: PaymentPreview[] }> {
    const input = batchSchema.parse(value); this.subscription(owner,input.subscriptionId);
    const entries: PaymentPreview[] = [];
    for (const entry of input.entries) {
      this.checkDate(entry);
      const duplicate = this.duplicate(owner,input.subscriptionId,entry.startDate,entry.endDate) || entries.some(p => p.startDate < entry.endDate && p.endDate > entry.startDate);
      // Sequential requests respect the rate provider's bounded concurrency.
      const fx = await this.rates.lookup({currency:entry.currency,date:entry.startDate});
      entries.push({...entry,rate:fx.rate,rateDate:fx.rateDate,duplicate});
    }
    return {entries};
  }
  async add(owner: number, value: unknown) {
    const input = batchSchema.parse(value), preview = await this.preview(owner,input);
    return transaction(this.db, () => {
      const sub = this.subscription(owner,input.subscriptionId);
      let added = 0, skipped = 0;
      for (const p of preview.entries) {
        if (p.duplicate || this.duplicate(owner,input.subscriptionId,p.startDate,p.endDate)) { skipped++; continue; }
        const {duplicate: _duplicate, ...details} = p;
        const payment: Payment = {...details,category:String(sub.category) as Payment["category"],plan:String(sub.plan),source:"backfill",confirmedAt:new Date().toISOString(),voidedAt:null};
        this.db.prepare(`INSERT INTO subscription_renewal_logs(user_id,id,subscription_id,subscription_name,kind,previous_start_date,previous_end_date,new_start_date,new_end_date,previous_anchor_date,new_anchor_date,amount_cents,currency,purchase_date,fx_rate_to_cny,fx_rate_date,fx_rate_source,periods,created_at,payment_json)
          VALUES(?,?,?,?,'manual',?,?,?,?,?,?,?,?,?,?,?,'frankfurter',1,?,?)`)
          .run(owner,randomUUID(),input.subscriptionId,String(sub.name),p.startDate,p.endDate,p.startDate,p.endDate,p.startDate,p.startDate,Math.round(p.amount*100),p.currency,p.startDate,p.rate,p.rateDate,Date.now(),JSON.stringify(payment));
        added++;
      }
      return {added,skipped};
    });
  }
  async confirm(owner: number, value: unknown) {
    const input = z.object({id:idSchema,entry:paymentInputSchema}).strict().parse(value);
    const history = new RenewalHistory(this.db), before = renewalFromRow(history.get(owner,input.id));
    if (paymentState(before) !== "pending") throw new ApiError(409,"该流水已处理，请刷新查看。");
    if (before.periods > 1) throw new ApiError(409,"此条包含多个自动顺延账期，请使用补录历史逐期记录实际付款。");
    if (input.entry.startDate !== before.newStartDate || input.entry.endDate !== before.newEndDate) throw new ApiError(400,"确认付款不能改变原流水对应的账期。");
    this.checkDate(input.entry);
    const fx = await this.rates.lookup({currency:input.entry.currency,date:input.entry.startDate});
    return transaction(this.db, () => {
      const current = renewalFromRow(history.get(owner,input.id));
      if (paymentState(current) !== "pending" || JSON.stringify(current) !== JSON.stringify(before)) throw new ApiError(409,"流水已变化，请刷新后重试。");
      if (this.duplicate(owner,current.subscriptionId,input.entry.startDate,input.entry.endDate,input.id)) throw new ApiError(409,"该账期已有流水，请先核对，避免重复统计。");
      const sub = this.db.prepare("SELECT * FROM subscriptions WHERE user_id=? AND id=?").get(owner,current.subscriptionId);
      const payment: Payment = {...input.entry,rate:fx.rate,rateDate:fx.rateDate,category:(sub?.category ?? "其他服务") as Payment["category"],plan:String(sub?.plan ?? ""),source:"renewal",confirmedAt:new Date().toISOString(),voidedAt:null};
      this.db.prepare("UPDATE subscription_renewal_logs SET payment_json=?,undo_until=NULL WHERE user_id=? AND id=?").run(JSON.stringify(payment),owner,input.id);
      return {log:renewalFromRow(history.get(owner,input.id))};
    });
  }
  void(owner: number, value: unknown) {
    const {id} = z.object({id:idSchema}).strict().parse(value);
    return transaction(this.db, () => {
      const row = new RenewalHistory(this.db).get(owner,id), log = renewalFromRow(row);
      if (paymentState(log) !== "paid" || !log.payment) throw new ApiError(409,"只有已支付记录可以作废。");
      const payment = {...log.payment,voidedAt:new Date().toISOString()};
      this.db.prepare("UPDATE subscription_renewal_logs SET payment_json=? WHERE user_id=? AND id=?").run(JSON.stringify(payment),owner,id);
      return {id};
    });
  }
}
