import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { categories } from "../../shared/subscriptions.ts";
import { currencyCodes } from "../../shared/currency.ts";
import { paymentState, type Payment, type PaymentInput, type PaymentPreview, type RenewalPaymentInput } from "../../shared/payments.ts";
import { dateSchema, idSchema, paymentAmountSchema, renewalPaymentSchema } from "./validation.ts";
import { RenewalHistory, renewalFromRow } from "./renewal-history.ts";
import { ExchangeRates } from "./exchange-rates.ts";
import { transaction } from "./database.ts";
import { ApiError } from "./errors.ts";
import { dateInTimeZone } from "../../shared/billing.ts";
import { removeCanceledRenewal } from "./billing-facts.ts";
import { syncPendingRenewalRates, syncRenewalRate } from "./subscription-rates.ts";

const amount = paymentAmountSchema;
const fields = { amount, currency: z.enum(currencyCodes), paidOn: dateSchema, startDate: dateSchema, endDate: dateSchema, note: z.string().trim().max(500) };
export const paymentInputSchema = z.object(fields).strict().refine(p => p.endDate > p.startDate, "到期日期必须晚于开始日期。");
export const paymentSchema = z.object({ ...fields, rate: z.number().finite().positive().max(100_000).nullable(), rateDate: dateSchema.nullable(),
  category: z.enum(categories), plan: z.string().max(80), source: z.enum(["backfill", "renewal"]),
  confirmedAt: z.string().datetime(), voidedAt: z.string().datetime().nullable(),
  dateCorrections: z.array(z.object({from:dateSchema,to:dateSchema,changedAt:z.string().datetime()}).strict()).max(100).optional(),
  corrections: z.array(z.object({previous:renewalPaymentSchema,changedAt:z.string().datetime()}).strict()).max(100).optional(),
}).strict().refine(p => p.endDate > p.startDate &&
  ((p.rate === null && p.rateDate === null && p.currency !== "CNY") ||
    (p.rate !== null && p.rateDate !== null && p.rateDate <= (p.paidOn > p.startDate ? p.paidOn : p.startDate) && (p.currency !== "CNY" || p.rate === 1))), "支付账期或汇率不正确。")
  .refine(p => !p.voidedAt || p.voidedAt >= p.confirmedAt, "作废时间不正确。");
const batchSchema = z.object({ subscriptionId: idSchema, entries: z.array(paymentInputSchema).min(1).max(36) }).strict();
const pendingRefreshes = new WeakMap<DatabaseSync, Promise<void>>();
type PaymentOptions = { timeZone?: string; clock?: () => Date };

/** One ledger for schedule events and explicit payments. All writes are owner-scoped and atomic. */
export class PaymentService {
  private db: DatabaseSync;
  private rates: ExchangeRates;
  private timeZone: string;
  private clock: () => Date;
  constructor(db: DatabaseSync, rates = new ExchangeRates(), options: PaymentOptions = {}) {
    this.db = db; this.rates = rates;
    this.timeZone = options.timeZone ?? process.env.APP_TIMEZONE ?? "Asia/Shanghai";
    this.clock = options.clock ?? (() => new Date());
  }
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
    if (p.paidOn > dateInTimeZone(this.clock(), this.timeZone)) throw new ApiError(400,"付款日期不能晚于今天。");
  }
  /** A provider outage does not make a real payment unpaid. Validation errors still fail. */
  private async lookupPaymentRate(entry: Pick<PaymentInput, "currency" | "paidOn">): Promise<Pick<Payment, "rate" | "rateDate">> {
    if (entry.currency === "CNY") return {rate:1,rateDate:entry.paidOn};
    try {
      const fx = await this.rates.lookup({currency:entry.currency,date:entry.paidOn});
      return {rate:fx.rate,rateDate:fx.rateDate};
    } catch (error) {
      if (error instanceof ApiError && ["FX_UNAVAILABLE", "FX_BUSY"].includes(error.code)) return {rate:null,rateDate:null};
      throw error;
    }
  }
  async preview(owner: number, value: unknown): Promise<{ entries: PaymentPreview[] }> {
    const input = batchSchema.parse(value); this.subscription(owner,input.subscriptionId);
    const entries: PaymentPreview[] = [];
    for (const entry of input.entries) {
      this.checkDate(entry);
      const duplicate = this.duplicate(owner,input.subscriptionId,entry.startDate,entry.endDate) || entries.some(p => p.startDate < entry.endDate && p.endDate > entry.startDate);
      // Sequential requests respect the rate provider's bounded concurrency.
      const fx = await this.lookupPaymentRate(entry);
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
        // Legacy schedule columns are NOT NULL. Their sentinel is marked unavailable;
        // payment_json is the authoritative nullable conversion for paid reporting.
        this.db.prepare(`INSERT INTO subscription_renewal_logs(user_id,id,subscription_id,subscription_name,kind,previous_start_date,previous_end_date,new_start_date,new_end_date,previous_anchor_date,new_anchor_date,amount_cents,currency,purchase_date,fx_rate_to_cny,fx_rate_date,fx_rate_source,periods,created_at,payment_json,previous_rate_pending)
          VALUES(?,?,?,?,'manual',?,?,?,?,?,?,?,?,?,?,?,'frankfurter',1,?,?,?)`)
          .run(owner,randomUUID(),input.subscriptionId,String(sub.name),p.startDate,p.endDate,p.startDate,p.endDate,p.startDate,p.startDate,Math.round(p.amount*100),p.currency,p.paidOn,p.rate ?? 1,p.rateDate ?? p.paidOn,Date.now(),JSON.stringify(payment),Number(p.rate === null));
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
    const fx = await this.lookupPaymentRate(input.entry);
    return transaction(this.db, () => {
      const current = renewalFromRow(history.get(owner,input.id));
      if (paymentState(current) !== "pending" || JSON.stringify(current) !== JSON.stringify(before)) throw new ApiError(409,"流水已变化，请刷新后重试。");
      if (this.duplicate(owner,current.subscriptionId,input.entry.startDate,input.entry.endDate,input.id)) throw new ApiError(409,"该账期已有流水，请先核对，避免重复统计。");
      const sub = this.db.prepare("SELECT * FROM subscriptions WHERE user_id=? AND id=?").get(owner,current.subscriptionId);
      const payment: Payment = {...input.entry,rate:fx.rate,rateDate:fx.rateDate,category:(sub?.category ?? "其他服务") as Payment["category"],plan:String(sub?.plan ?? ""),source:"renewal",confirmedAt:new Date().toISOString(),voidedAt:null};
      this.db.prepare("UPDATE subscription_renewal_logs SET payment_json=?,undo_until=NULL WHERE user_id=? AND id=?").run(JSON.stringify(payment),owner,input.id);
      syncRenewalRate(this.db,owner,current,payment);
      return {log:renewalFromRow(history.get(owner,input.id))};
    });
  }

  /** Called inside the renewal transaction. Payment is immediate; FX is filled asynchronously. */
  recordRenewalPayment(owner: number, logId: string, paidOn: string, details?: RenewalPaymentInput) {
    idSchema.parse(logId); dateSchema.parse(paidOn); this.checkDate({paidOn,startDate:paidOn});
    const history = new RenewalHistory(this.db), log = renewalFromRow(history.get(owner,logId));
    if (paymentState(log) !== "pending") throw new ApiError(409,"该流水已处理，请刷新查看。");
    if (log.amount === null) throw new ApiError(400,"流水缺少付款金额。");
    if (this.duplicate(owner,log.subscriptionId,log.newStartDate,log.newEndDate,log.id)) throw new ApiError(409,"该账期已有流水，请先核对，避免重复统计。");
    const entry = renewalPaymentSchema.parse(details ?? {amount:log.amount,currency:log.currency ?? "CNY",paidOn,note:""});
    this.checkDate({...entry,startDate:log.newStartDate});
    const sub = this.subscription(owner,log.subscriptionId);
    const payment: Payment = {...entry,startDate:log.newStartDate,endDate:log.newEndDate,
      rate:entry.currency === "CNY" ? 1 : null,rateDate:entry.currency === "CNY" ? entry.paidOn : null,
      category:String(sub.category) as Payment["category"],plan:String(sub.plan),source:"renewal",confirmedAt:this.clock().toISOString(),voidedAt:null};
    this.db.prepare("UPDATE subscription_renewal_logs SET payment_json=? WHERE user_id=? AND id=?").run(JSON.stringify(payment),owner,logId);
    return {log:renewalFromRow(history.get(owner,logId))};
  }

  /** Fill only still-pending snapshots; a concurrent edit or void always wins. */
  async refreshPendingRates(): Promise<void> {
    const existing = pendingRefreshes.get(this.db);
    if (existing) return existing;
    const work = this.fillPendingRates().finally(() => { pendingRefreshes.delete(this.db); });
    pendingRefreshes.set(this.db,work);
    return work;
  }
  private async fillPendingRates(): Promise<void> {
    syncPendingRenewalRates(this.db);
    const rows = this.db.prepare("SELECT user_id,id,payment_json,undone_at FROM subscription_renewal_logs WHERE payment_json IS NOT NULL AND undone_at IS NULL").all();
    for (const row of rows) {
      const original = String(row.payment_json), payment = JSON.parse(original) as Payment;
      if (payment.voidedAt || payment.rate !== null || payment.rateDate !== null) continue;
      this.checkDate(payment);
      const fx = await this.lookupPaymentRate(payment);
      if (fx.rate === null) continue;
      transaction(this.db, () => {
        const saved = this.db.prepare("UPDATE subscription_renewal_logs SET payment_json=? WHERE user_id=? AND id=? AND payment_json=? AND undone_at IS NULL")
          .run(JSON.stringify({...payment,...fx}),Number(row.user_id),String(row.id),original);
        if (Number(saved.changes) === 1) {
          const log = renewalFromRow(new RenewalHistory(this.db).get(Number(row.user_id),String(row.id)));
          syncRenewalRate(this.db,Number(row.user_id),log,log.payment!);
        }
      });
    }
  }
  void(owner: number, value: unknown) {
    const {id} = z.object({id:idSchema}).strict().parse(value);
    return transaction(this.db, () => {
      const row = new RenewalHistory(this.db).get(owner,id), log = renewalFromRow(row);
      if (paymentState(log) !== "paid" || !log.payment) throw new ApiError(409,"只有已支付记录可以作废。");
      const payment = {...log.payment,voidedAt:new Date().toISOString()};
      this.db.prepare("UPDATE subscription_renewal_logs SET payment_json=? WHERE user_id=? AND id=?").run(JSON.stringify(payment),owner,id);
      removeCanceledRenewal(this.db,new RenewalHistory(this.db).get(owner,id));
      return {id};
    });
  }

  async correctDate(owner: number, value: unknown) {
    const input = z.object({id:idSchema,paidOn:dateSchema,expectedPaidOn:dateSchema}).strict().parse(value);
    this.checkDate({paidOn:input.paidOn,startDate:input.paidOn});
    const before = renewalFromRow(new RenewalHistory(this.db).get(owner,input.id));
    if (paymentState(before) !== "paid" || !before.payment) throw new ApiError(409,"只有已支付记录可以更正付款日期。");
    if (before.payment.paidOn !== input.expectedPaidOn) throw new ApiError(409,"付款日期已变化，请刷新后重试。");
    if (before.payment.paidOn === input.paidOn) return {log:before};
    if ((before.payment.dateCorrections?.length ?? 0) >= 100) throw new ApiError(409,"更正次数已达上限。");
    const original = JSON.stringify(before.payment);
    const fx = await this.lookupPaymentRate({...before.payment,paidOn:input.paidOn});
    return transaction(this.db, () => {
      const log = renewalFromRow(new RenewalHistory(this.db).get(owner,input.id));
      if (paymentState(log) !== "paid" || !log.payment) throw new ApiError(409,"只有已支付记录可以更正付款日期。");
      if (JSON.stringify(log.payment) !== original) throw new ApiError(409,"流水已变化，请刷新后重试。");
      const payment: Payment = {...log.payment,...fx,paidOn:input.paidOn,dateCorrections:[...(log.payment.dateCorrections??[]),{from:log.payment.paidOn,to:input.paidOn,changedAt:this.clock().toISOString()}]};
      this.db.prepare("UPDATE subscription_renewal_logs SET payment_json=? WHERE user_id=? AND id=?").run(JSON.stringify(payment),owner,input.id);
      syncRenewalRate(this.db,owner,log,payment,log.payment,false);
      return {log:{...log,payment}};
    });
  }

  /** Correct one real charge while retaining its previous values and service period. */
  async correct(owner: number, value: unknown) {
    const input = z.object({id:idSchema,entry:renewalPaymentSchema,expected:renewalPaymentSchema}).strict().parse(value);
    this.checkDate({...input.entry,startDate:input.entry.paidOn});
    const history = new RenewalHistory(this.db);
    const details = (payment: Payment): RenewalPaymentInput => ({amount:payment.amount,currency:payment.currency,paidOn:payment.paidOn,note:payment.note});
    const matches = (payment: Payment, expected: RenewalPaymentInput) => JSON.stringify(details(payment)) === JSON.stringify(expected);
    const before = renewalFromRow(history.get(owner,input.id));
    if (paymentState(before) !== "paid" || !before.payment) throw new ApiError(409,"只有已支付记录可以修改付款。");
    if (!matches(before.payment,input.expected)) throw new ApiError(409,"付款记录已变化，请刷新后重试。");
    if (matches(before.payment,input.entry)) return {log:before};
    if ((before.payment.corrections?.length ?? 0) >= 100) throw new ApiError(409,"修改次数已达上限。");
    const fx = before.payment.currency === input.entry.currency && before.payment.paidOn === input.entry.paidOn
      ? {rate:before.payment.rate,rateDate:before.payment.rateDate} : await this.lookupPaymentRate(input.entry);
    return transaction(this.db, () => {
      const log = renewalFromRow(history.get(owner,input.id));
      if (paymentState(log) !== "paid" || !log.payment || !matches(log.payment,input.expected) ||
          log.payment.startDate !== before.payment!.startDate || log.payment.endDate !== before.payment!.endDate) {
        throw new ApiError(409,"付款记录已变化，请刷新后重试。");
      }
      // A completed background FX lookup may have filled the same unchanged quote.
      const quote = log.payment.currency === input.entry.currency && log.payment.paidOn === input.entry.paidOn
        ? {rate:log.payment.rate,rateDate:log.payment.rateDate} : fx;
      const payment: Payment = {...log.payment,...input.entry,...quote,
        corrections:[...(log.payment.corrections ?? []),{previous:details(log.payment),changedAt:this.clock().toISOString()}]};
      this.db.prepare("UPDATE subscription_renewal_logs SET payment_json=?,undo_until=NULL WHERE user_id=? AND id=?")
        .run(JSON.stringify(payment),owner,input.id);
      // Follow the latest renewal only; a separately edited or newer price takes precedence.
      if (payment.source === "renewal") this.db.prepare(`UPDATE subscriptions SET original_amount_cents=?,currency=?,purchase_date=?,
        fx_rate_to_cny=?,fx_rate_date=?,fx_rate_source='frankfurter',rate_pending=?,amount_cents=?,version=version+1,updated_at=?
        WHERE user_id=? AND id=? AND start_date=? AND end_date=? AND original_amount_cents=? AND currency=? AND purchase_date=?`)
        .run(Math.round(payment.amount*100),payment.currency,payment.paidOn,payment.rate ?? 1,payment.rateDate ?? payment.paidOn,
          Number(payment.rate === null),Math.round(payment.amount*(payment.rate ?? 1)*100),this.clock().getTime(),owner,log.subscriptionId,
          log.newStartDate,log.newEndDate,Math.round(log.payment.amount*100),log.payment.currency,log.payment.paidOn);
      return {log:{...log,payment}};
    });
  }
}
