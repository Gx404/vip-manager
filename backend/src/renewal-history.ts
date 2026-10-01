import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Subscription } from "../../shared/subscriptions.ts";
import { UNDO_RENEWAL_MS, type RenewalLog, type HistoryPage } from "../../shared/renewals.ts";
import { ApiError } from "./errors.ts";

type Row = Record<string, unknown>;
/** Convert a private ledger row to its stable API/JSON-backup representation. */
export function renewalFromRow(row: Row): RenewalLog {
  return {
    id: String(row.id), subscriptionId: String(row.subscription_id), subscriptionName: String(row.subscription_name),
    kind: row.kind as RenewalLog["kind"], previousStartDate: String(row.previous_start_date), previousEndDate: String(row.previous_end_date),
    newStartDate: String(row.new_start_date), newEndDate: String(row.new_end_date), amount: row.amount_cents === null ? null : Number(row.amount_cents) / 100,
    periods: Number(row.periods), createdAt: new Date(Number(row.created_at)).toISOString(),
    undoneAt: row.undone_at === null ? null : new Date(Number(row.undone_at)).toISOString(),
  };
}

/** Durable user-scoped ledger. Mutations run inside the subscription service's transaction. */
export class RenewalHistory {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  record(owner: number, previous: Subscription, next: Subscription, previousAnchor: string, newAnchor: string,
    kind: RenewalLog["kind"], periods: number, now: number, requestId: string | null = null): RenewalLog {
    const id = randomUUID();
    this.db.prepare(`INSERT INTO subscription_renewal_logs(user_id,id,subscription_id,subscription_name,kind,
      previous_start_date,previous_end_date,new_start_date,new_end_date,previous_anchor_date,new_anchor_date,
      amount_cents,periods,created_at,resulting_version,undo_until,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(owner,id,previous.id,previous.name,kind,previous.startDate,previous.endDate,next.startDate,next.endDate,
        previousAnchor,newAnchor,Math.round(previous.amount * 100) * periods,periods,now,next.version,
        kind === "manual" ? now + UNDO_RENEWAL_MS : null,requestId);
    return renewalFromRow(this.get(owner, id));
  }

  get(owner: number, id: string): Row {
    const row = this.db.prepare("SELECT * FROM subscription_renewal_logs WHERE user_id=? AND id=?").get(owner,id);
    if (!row) throw new ApiError(404, "续费流水不存在。", "NOT_FOUND");
    return row;
  }

  byRequest(owner: number, requestId: string): Row | undefined {
    return this.db.prepare("SELECT * FROM subscription_renewal_logs WHERE user_id=? AND request_id=?").get(owner,requestId);
  }

  list(owner: number, subscriptionId?: string, offset = 0, limit = 50): HistoryPage {
    const condition = subscriptionId ? "user_id=? AND subscription_id=?" : "user_id=?";
    const params = subscriptionId ? [owner, subscriptionId] : [owner];
    const total = Number(this.db.prepare(`SELECT count(*) AS count FROM subscription_renewal_logs WHERE ${condition}`).get(...params)?.count);
    const rows = this.db.prepare(`SELECT * FROM subscription_renewal_logs WHERE ${condition} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...params,limit,offset);
    return { logs: rows.map(renewalFromRow), total };
  }
}
