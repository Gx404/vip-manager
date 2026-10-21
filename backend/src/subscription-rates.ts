import type { DatabaseSync } from "node:sqlite";
import type { RenewalLog } from "../../shared/renewals.ts";
import type { Payment } from "../../shared/payments.ts";
import { renewalFromRow } from "./renewal-history.ts";

/** Reuse a real charge's quote only while the matching subscription price still follows it. */
export function syncRenewalRate(db: DatabaseSync, owner: number, log: RenewalLog, payment: Payment, previous = payment, pendingOnly = true): void {
  if (payment.source !== "renewal" || payment.voidedAt || log.undoneAt ||
      payment.startDate !== log.newStartDate || payment.endDate !== log.newEndDate ||
      (payment.currency !== "CNY" && payment.rateDate !== null && payment.rateDate > payment.paidOn)) return;
  const rate = payment.currency === "CNY" ? 1 : payment.rate;
  const date = payment.currency === "CNY" ? payment.paidOn : payment.rateDate;
  if (rate === null && pendingOnly) {
    db.prepare(`UPDATE subscriptions SET purchase_date=?,fx_rate_date=CASE WHEN fx_rate_date>? THEN ? ELSE fx_rate_date END
      WHERE user_id=? AND id=? AND start_date=? AND end_date=?
      AND original_amount_cents=? AND currency=? AND rate_pending=1 AND purchase_date IN (?,?)`)
      .run(payment.paidOn,payment.paidOn,payment.paidOn,owner,log.subscriptionId,payment.startDate,payment.endDate,
        Math.round(payment.amount*100),payment.currency,previous.paidOn,payment.startDate);
    return;
  }
  db.prepare(`UPDATE subscriptions SET purchase_date=?,fx_rate_to_cny=?,fx_rate_date=?,fx_rate_source=?,
    amount_cents=round(original_amount_cents*?),rate_pending=?
    WHERE user_id=? AND id=? AND start_date=? AND end_date=? AND original_amount_cents=? AND currency=? AND
    ((rate_pending=1 AND purchase_date IN (?,?)) OR
     (?=0 AND rate_pending=0 AND (fx_rate_source='frankfurter' OR currency='CNY') AND purchase_date=? AND fx_rate_to_cny=? AND fx_rate_date=?))`)
    .run(payment.paidOn,rate ?? 1,date ?? payment.paidOn,payment.currency === "CNY" ? "manual" : "frankfurter",
      rate ?? 1,Number(rate === null),owner,log.subscriptionId,payment.startDate,payment.endDate,
      Math.round(payment.amount*100),payment.currency,previous.paidOn,payment.startDate,Number(pendingOnly),
      previous.paidOn,previous.rate,previous.rateDate);
}

/** Repair legacy pending budgets before filtering out future purchase dates. No external lookup is needed. */
export function syncPendingRenewalRates(db: DatabaseSync): void {
  const rows = db.prepare(`SELECT l.* FROM subscription_renewal_logs l JOIN subscriptions s
    ON s.user_id=l.user_id AND s.id=l.subscription_id AND s.start_date=l.new_start_date AND s.end_date=l.new_end_date
    WHERE s.rate_pending=1 AND l.undone_at IS NULL AND l.payment_json IS NOT NULL`).all();
  for (const row of rows) {
    const log = renewalFromRow(row);
    if (log.payment) syncRenewalRate(db,Number(row.user_id),log,log.payment);
  }
}
