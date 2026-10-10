import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { renewDate, type Subscription } from "../../shared/subscriptions.ts";
import { automaticPeriod, billingAnchor, dateInTimeZone } from "../../shared/billing.ts";
import { actionSchema, dateSchema, subscriptionSchema } from "./validation.ts";
import { ApiError } from "./errors.ts";
import { transaction } from "./database.ts";
import { RenewalHistory, renewalFromRow } from "./renewal-history.ts";
import type { RenewalLog } from "../../shared/renewals.ts";
import { ExchangeRates } from "./exchange-rates.ts";

type Row = Record<string, unknown>;
export function subscriptionFromRow(row: Row): Subscription {
  return {
    ratePending: Boolean(row.rate_pending),
    id: String(row.id), name: String(row.name), plan: String(row.plan), category: String(row.category),
    amount: Number(row.original_amount_cents) / 100, cycle: row.cycle as Subscription["cycle"], customDays: Number(row.custom_days),
    startDate: String(row.start_date), endDate: String(row.end_date), reminderDays: Number(row.reminder_days),
    autoRenew: Boolean(row.auto_renew), note: String(row.note), color: String(row.color), version: Number(row.version),
    currency: String(row.currency || "CNY") as Subscription["currency"],
    purchaseDate: String(row.purchase_date || row.start_date),
    fxRateToCny: Number(row.fx_rate_to_cny || 1),
    fxRateDate: String(row.fx_rate_date || row.purchase_date || row.start_date),
    fxRateSource: String(row.fx_rate_source || "manual") as Subscription["fxRateSource"],
  };
}
function values(item: Subscription): SQLInputValue[] {
  return [item.name,item.plan,item.category,Math.round(item.amount*(item.fxRateToCny ?? 1)*100),item.cycle,item.customDays,item.startDate,
    item.endDate,item.reminderDays,Number(item.autoRenew),item.note,item.color,item.currency ?? "CNY",item.purchaseDate ?? item.startDate,item.fxRateToCny ?? 1,item.fxRateDate ?? item.purchaseDate ?? item.startDate,item.fxRateSource ?? "manual",Math.round(item.amount*100)];
}

/** User-scoped storage and authoritative renewals; UI and server share date arithmetic. */
export class SubscriptionService {
  private rates: ExchangeRates;
  private db: DatabaseSync;
  private timeZone: string;
  private history: RenewalHistory;
  private clock: () => Date;
  constructor(db: DatabaseSync, timeZone: string, clock: () => Date = () => new Date(), rates = new ExchangeRates()) {
    this.rates = rates;
    this.db=db; this.timeZone=timeZone; this.history=new RenewalHistory(db); this.clock=clock;
  }

  list(owner: number) {
    const rows = this.db.prepare("SELECT * FROM subscriptions WHERE user_id=? ORDER BY end_date,id").all(owner);
    const preference = this.db.prepare("SELECT initialized FROM subscription_preferences WHERE user_id=?").get(owner);
    return { items: rows.map(subscriptionFromRow), initialized: Boolean(preference?.initialized) || rows.length > 0 };
  }

  /** Read only the single administrator's display fields; never select private notes or real versions. */
  listPublic(): Subscription[] {
    const rows = this.db.prepare(`SELECT id,name,plan,category,amount_cents,original_amount_cents,cycle,custom_days,start_date,end_date,
      reminder_days,auto_renew,color,'' AS note,0 AS version,currency,purchase_date,fx_rate_to_cny,fx_rate_date,fx_rate_source,rate_pending FROM subscriptions
      WHERE user_id=(SELECT id FROM users ORDER BY id LIMIT 1) ORDER BY end_date,id`).all();
    return rows.map(subscriptionFromRow);
  }

  /** Retry missing start-date rates without changing schedule, payments or optimistic versions. */
  async refreshPendingRates(): Promise<void> {
    const rows = this.db.prepare("SELECT * FROM subscriptions WHERE rate_pending=1 AND start_date<=? LIMIT 20").all(new Date().toISOString().slice(0,10));
    for (const row of rows) {
      try {
        const fx = await this.rates.lookup({currency:row.currency,date:row.start_date});
        this.db.prepare("UPDATE subscriptions SET purchase_date=start_date,fx_rate_to_cny=?,fx_rate_date=?,fx_rate_source=?,amount_cents=round(original_amount_cents*?),rate_pending=0 WHERE user_id=? AND id=? AND version=? AND rate_pending=1 AND start_date=?")
          .run(fx.rate,fx.rateDate,fx.source,fx.rate,Number(row.user_id),String(row.id),Number(row.version),String(row.start_date));
      } catch { /* Leave explicit pending status; retry on the next scheduler pass. */ }
    }
  }

  /** Atomically catch up enabled records at their due date, keeping one audit event per changed record. */
  advanceAutomaticRenewals(now = new Date()): number {
    const today = dateSchema.parse(dateInTimeZone(now, this.timeZone));
    return transaction(this.db, () => {
      const rows = this.db.prepare("SELECT * FROM subscriptions WHERE auto_renew=1 AND end_date<=? ORDER BY user_id,id").all(today);
      let changed = 0;
      for (const row of rows) {
        const item = subscriptionFromRow(row);
        const anchor = String(row.renewal_anchor_date) || billingAnchor(item);
        const next = automaticPeriod(item, anchor, today);
        if (!next) continue;
        dateSchema.parse(next.startDate);
        dateSchema.parse(next.endDate);
        const result = this.db.prepare(`UPDATE subscriptions SET start_date=?,end_date=?,renewal_anchor_date=?,
          version=version+1,updated_at=? WHERE user_id=? AND id=? AND auto_renew=1 AND version=?`)
          .run(next.startDate,next.endDate,anchor,now.getTime(),Number(row.user_id),item.id,item.version);
        if (Number(result.changes) !== 1) continue;
        this.db.prepare(`INSERT INTO automatic_renewal_events(user_id,subscription_id,previous_start_date,previous_end_date,
          new_start_date,new_end_date,periods_advanced,created_at) VALUES(?,?,?,?,?,?,?,?)`)
          .run(Number(row.user_id),item.id,item.startDate,item.endDate,next.startDate,next.endDate,next.periods,now.getTime());
        this.history.record(Number(row.user_id),item,this.get(Number(row.user_id),item.id),anchor,anchor,"automatic",next.periods,now.getTime());
        this.db.prepare("UPDATE subscriptions SET rate_pending=CASE WHEN currency='CNY' THEN 0 ELSE 1 END,purchase_date=start_date WHERE user_id=? AND id=?").run(Number(row.user_id),item.id);
        changed++;
      }
      return changed;
    });
  }

  execute(owner: number, body: unknown): { item?: Subscription; id?: string; initialized?: boolean; renewal?: RenewalLog; undoUntil?: string | null } {
    const input = actionSchema.parse(body);
    if (input.action === "initialize") {
      this.initialize(owner);
      return { initialized: true };
    }
    if (input.action === "create") {
      // The browser need not supply a UUID on non-HTTPS LAN previews.
      const raw = input.item && typeof input.item === "object" ? input.item as Record<string, unknown> : {};
      const item = subscriptionSchema.parse({ ...raw, id: raw.id || randomUUID() }) as Subscription;
      return transaction(this.db, () => {
        if (this.db.prepare("SELECT id FROM subscriptions WHERE user_id=? AND id=?").get(owner,item.id)) {
          throw new ApiError(409,"这条记录已经存在，请刷新确认，避免重复保存。");
        }
        this.db.prepare(`INSERT INTO subscriptions(user_id,id,name,plan,category,amount_cents,cycle,custom_days,start_date,end_date,
          reminder_days,auto_renew,note,color,currency,purchase_date,fx_rate_to_cny,fx_rate_date,fx_rate_source,original_amount_cents,version,updated_at,renewal_anchor_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`)
          .run(owner,item.id,...values(item),Date.now(),billingAnchor(item));
        this.initialize(owner);
        this.db.prepare("UPDATE subscriptions SET rate_pending=? WHERE user_id=? AND id=?").run(Number(Boolean(item.ratePending)),owner,item.id);
        return { item: this.get(owner,item.id) };
      });
    }
    if (!input.id || input.version === undefined) throw new ApiError(400,"缺少记录标识或版本。");
    return transaction(this.db, () => {
      const item = this.get(owner,input.id!);
      if (input.action === "renew" && input.requestId) {
        const previous = this.history.byRequest(owner,input.requestId);
        if (previous) {
          if (previous.subscription_id !== item.id || previous.undone_at !== null || Number(previous.resulting_version) !== item.version) {
            throw new ApiError(409,"该续费请求已处理且记录后来发生变化，请刷新。","VERSION_CONFLICT");
          }
          return { item, renewal: renewalFromRow(previous), undoUntil: previous.undo_until === null ? null : new Date(Number(previous.undo_until)).toISOString() };
        }
      }
      if (item.version !== input.version) throw new ApiError(409,"记录已在其他页面修改，请刷新后再试。","VERSION_CONFLICT");
      if (input.action === "undoRenew") {
        if (!input.logId) throw new ApiError(400,"缺少续费流水标识。");
        const log = this.history.get(owner,input.logId);
        const now = this.clock().getTime();
        if (log.kind !== "manual" || log.subscription_id !== item.id || log.undone_at !== null || log.undo_until === null || Number(log.undo_until) <= now) {
          throw new ApiError(409,"这次续费已撤销或超过 30 秒撤销期限。","UNDO_UNAVAILABLE");
        }
        if (Number(log.resulting_version) !== item.version || item.startDate !== log.new_start_date || item.endDate !== log.new_end_date) {
          throw new ApiError(409,"订阅已有后续修改，不能覆盖，请检查流水后手动调整。","VERSION_CONFLICT");
        }
        this.db.prepare("UPDATE subscriptions SET start_date=?,end_date=?,renewal_anchor_date=?,version=version+1,updated_at=? WHERE user_id=? AND id=? AND version=?")
          .run(String(log.previous_start_date),String(log.previous_end_date),String(log.previous_anchor_date),now,owner,item.id,item.version);
        this.db.prepare("UPDATE subscription_renewal_logs SET undone_at=?,undo_until=NULL WHERE user_id=? AND id=?").run(now,owner,input.logId);
        this.db.prepare("UPDATE subscriptions SET purchase_date=?,fx_rate_to_cny=?,fx_rate_date=?,fx_rate_source=?,amount_cents=round(original_amount_cents*?),rate_pending=? WHERE user_id=? AND id=?")
          .run(String(log.purchase_date),Number(log.fx_rate_to_cny),String(log.fx_rate_date),String(log.fx_rate_source),Number(log.fx_rate_to_cny),Number(log.previous_rate_pending),owner,item.id);
        return { item: this.get(owner,item.id), renewal: renewalFromRow(this.history.get(owner,input.logId)), undoUntil: null };
      }
      if (input.action === "delete") {
        // Keep the ledger, but never let an old receipt undo a future record reusing this UUID.
        this.db.prepare("UPDATE subscription_renewal_logs SET undo_until=NULL,resulting_version=NULL WHERE user_id=? AND subscription_id=?").run(owner,item.id);
        this.db.prepare("DELETE FROM subscriptions WHERE user_id=? AND id=? AND version=?").run(owner,item.id,item.version);
        return { id: item.id };
      }
      if (input.action === "update") {
        const changed = subscriptionSchema.parse(input.item) as Subscription;
        if (changed.id !== item.id) throw new ApiError(400,"记录标识不一致。");
        const scheduleChanged = changed.startDate !== item.startDate || changed.endDate !== item.endDate || changed.cycle !== item.cycle || changed.customDays !== item.customDays;
        this.db.prepare(`UPDATE subscriptions SET name=?,plan=?,category=?,amount_cents=?,cycle=?,custom_days=?,start_date=?,
          end_date=?,reminder_days=?,auto_renew=?,note=?,color=?,currency=?,purchase_date=?,fx_rate_to_cny=?,fx_rate_date=?,fx_rate_source=?,original_amount_cents=?,version=version+1,updated_at=? WHERE user_id=? AND id=? AND version=?`)
          .run(...values(changed),Date.now(),owner,item.id,item.version);
        if (scheduleChanged) this.db.prepare("UPDATE subscriptions SET renewal_anchor_date=? WHERE user_id=? AND id=?").run(billingAnchor(changed),owner,item.id);
        this.db.prepare("UPDATE subscriptions SET rate_pending=? WHERE user_id=? AND id=?").run(Number(Boolean(changed.ratePending)),owner,item.id);
      } else if (input.action === "renew") {
        const now = this.clock();
        const today = dateInTimeZone(now, this.timeZone);
        const base = item.endDate > today ? item.endDate : today;
        const savedAnchor = String(this.db.prepare("SELECT renewal_anchor_date FROM subscriptions WHERE user_id=? AND id=?").get(owner,item.id)?.renewal_anchor_date ?? "") || billingAnchor(item);
        const anchor = item.endDate >= today ? savedAnchor : base;
        const end = dateSchema.parse(item.endDate >= today ? automaticPeriod(item,anchor,base)!.endDate : renewDate(base,item.cycle,item.customDays));
        this.db.prepare("UPDATE subscriptions SET start_date=?,end_date=?,renewal_anchor_date=?,version=version+1,updated_at=? WHERE user_id=? AND id=? AND version=?")
          .run(base,end,anchor,now.getTime(),owner,item.id,item.version);
        const updated = this.get(owner,item.id);
        const renewal = this.history.record(owner,item,updated,savedAnchor,anchor,"manual",1,now.getTime(),input.requestId ?? null);
        this.db.prepare("UPDATE subscriptions SET rate_pending=CASE WHEN currency='CNY' THEN 0 ELSE 1 END,purchase_date=start_date WHERE user_id=? AND id=?").run(owner,item.id);
        const log = this.history.get(owner,renewal.id);
        return { item: this.get(owner,item.id), renewal, undoUntil: new Date(Number(log.undo_until)).toISOString() };
      }
      return { item: this.get(owner,item.id) };
    });
  }

  private initialize(owner: number): void {
    this.db.prepare("INSERT INTO subscription_preferences(user_id,initialized) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET initialized=1").run(owner);
  }

  private get(owner: number, id: string): Subscription {
    const row = this.db.prepare("SELECT * FROM subscriptions WHERE user_id=? AND id=?").get(owner,id);
    if (!row) throw new ApiError(404,"记录不存在或已删除。","NOT_FOUND");
    return subscriptionFromRow(row);
  }
}
