import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { renewDate, type Subscription } from "../../shared/subscriptions.ts";
import { actionSchema, dateSchema, subscriptionSchema } from "./validation.ts";
import { ApiError } from "./errors.ts";
import { transaction } from "./database.ts";

type Row = Record<string, unknown>;
function fromRow(row: Row): Subscription {
  return {
    id: String(row.id), name: String(row.name), plan: String(row.plan), category: String(row.category),
    amount: Number(row.amount_cents) / 100, cycle: row.cycle as Subscription["cycle"], customDays: Number(row.custom_days),
    startDate: String(row.start_date), endDate: String(row.end_date), reminderDays: Number(row.reminder_days),
    autoRenew: Boolean(row.auto_renew), note: String(row.note), color: String(row.color), version: Number(row.version),
  };
}
function values(item: Subscription): SQLInputValue[] {
  return [item.name,item.plan,item.category,Math.round(item.amount*100),item.cycle,item.customDays,item.startDate,
    item.endDate,item.reminderDays,Number(item.autoRenew),item.note,item.color];
}

/** User-scoped storage and authoritative renewals; UI and server share date arithmetic. */
export class SubscriptionService {
  private db: DatabaseSync;
  private timeZone: string;
  constructor(db: DatabaseSync, timeZone: string) { this.db=db; this.timeZone=timeZone; }

  list(owner: number) {
    const rows = this.db.prepare("SELECT * FROM subscriptions WHERE user_id=? ORDER BY end_date,id").all(owner);
    const preference = this.db.prepare("SELECT initialized FROM subscription_preferences WHERE user_id=?").get(owner);
    return { items: rows.map(fromRow), initialized: Boolean(preference?.initialized) || rows.length > 0 };
  }

  execute(owner: number, body: unknown): { item?: Subscription; id?: string; initialized?: boolean } {
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
          reminder_days,auto_renew,note,color,version,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)`)
          .run(owner,item.id,...values(item),Date.now());
        this.initialize(owner);
        return { item: this.get(owner,item.id) };
      });
    }
    if (!input.id || input.version === undefined) throw new ApiError(400,"缺少记录标识或版本。");
    return transaction(this.db, () => {
      const item = this.get(owner,input.id!);
      if (item.version !== input.version) throw new ApiError(409,"记录已在其他页面修改，请刷新后再试。","VERSION_CONFLICT");
      if (input.action === "delete") {
        this.db.prepare("DELETE FROM subscriptions WHERE user_id=? AND id=? AND version=?").run(owner,item.id,item.version);
        return { id: item.id };
      }
      if (input.action === "update") {
        const changed = subscriptionSchema.parse(input.item) as Subscription;
        if (changed.id !== item.id) throw new ApiError(400,"记录标识不一致。");
        this.db.prepare(`UPDATE subscriptions SET name=?,plan=?,category=?,amount_cents=?,cycle=?,custom_days=?,start_date=?,
          end_date=?,reminder_days=?,auto_renew=?,note=?,color=?,version=version+1,updated_at=? WHERE user_id=? AND id=? AND version=?`)
          .run(...values(changed),Date.now(),owner,item.id,item.version);
      } else {
        const parts = new Intl.DateTimeFormat("en-CA",{timeZone:this.timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts();
        const part = (name: string) => parts.find(p => p.type===name)!.value;
        const today = part("year")+"-"+part("month")+"-"+part("day");
        const base = item.endDate > today ? item.endDate : today;
        const end = dateSchema.parse(renewDate(base,item.cycle,item.customDays));
        this.db.prepare("UPDATE subscriptions SET start_date=?,end_date=?,version=version+1,updated_at=? WHERE user_id=? AND id=? AND version=?")
          .run(base,end,Date.now(),owner,item.id,item.version);
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
    return fromRow(row);
  }
}
