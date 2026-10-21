import type { DatabaseSync } from "node:sqlite";
import type { BillingFact } from "../../shared/renewals.ts";
import type { Payment } from "../../shared/payments.ts";
import type { CurrencyCode } from "../../shared/currency.ts";

type Row = Record<string, unknown>;
export function billingFacts(db: DatabaseSync, owner: number): BillingFact[] {
  return db.prepare("SELECT fact_json FROM subscription_billing_facts WHERE user_id=? ORDER BY id").all(owner)
    .map(row => JSON.parse(String(row.fact_json)) as BillingFact);
}

export function saveBillingFact(db: DatabaseSync, owner: number, fact: BillingFact): void {
  db.prepare("INSERT INTO subscription_billing_facts(user_id,id,subscription_id,fact_json) VALUES(?,?,?,?) ON CONFLICT(user_id,id) DO NOTHING")
    .run(owner,fact.id,fact.subscriptionId,JSON.stringify(fact));
}

/** Called in an existing transaction, after cancellation/undo has been established. */
export function removeCanceledRenewal(db: DatabaseSync, row: Row): void {
  const payment = row.payment_json ? JSON.parse(String(row.payment_json)) as Payment : null;
  if (row.undone_at === null && !payment?.voidedAt) throw new Error("Active renewal cannot be removed");
  const fact: BillingFact = {id:String(row.id),subscriptionId:String(row.subscription_id)};
  if(row.request_id)fact.requestId=String(row.request_id);
  if (payment) fact.excludedPeriod={startDate:payment.startDate,endDate:payment.endDate};
  if (row.undone_at === null && payment?.source !== "backfill" && String(row.previous_start_date) < String(row.new_start_date)) {
    const item=db.prepare("SELECT plan,category FROM subscriptions WHERE user_id=? AND id=?").get(Number(row.user_id),String(row.subscription_id));
    fact.schedule={
      subscriptionName:String(row.subscription_name),plan:payment?.plan ?? String(item?.plan ?? ""),category:payment?.category ?? String(item?.category ?? "其他服务"),
      previousStartDate:String(row.previous_start_date),previousEndDate:String(row.previous_end_date),newStartDate:String(row.new_start_date),newEndDate:String(row.new_end_date),
      amount:row.amount_cents === null ? null : Number(row.amount_cents)/100,currency:String(row.currency || "CNY") as CurrencyCode,
      fxRateToCny:Number(row.fx_rate_to_cny || 1),previousRatePending:Boolean(row.previous_rate_pending),periods:Number(row.periods),createdAt:new Date(Number(row.created_at)).toISOString(),
    };
  }
  saveBillingFact(db,Number(row.user_id),fact);
  db.prepare("DELETE FROM subscription_renewal_logs WHERE user_id=? AND id=?").run(Number(row.user_id),String(row.id));
}

/** Migration and legacy-import cleanup remove complete invalid rows atomically with their valid facts. */
export function removeAllCanceledRenewals(db: DatabaseSync, owner?: number): void {
  const condition="(undone_at IS NOT NULL OR (payment_json IS NOT NULL AND json_extract(payment_json,'$.voidedAt') IS NOT NULL))";
  const rows=owner === undefined ? db.prepare(`SELECT * FROM subscription_renewal_logs WHERE ${condition}`).all()
    : db.prepare(`SELECT * FROM subscription_renewal_logs WHERE user_id=? AND ${condition}`).all(owner);
  for(const row of rows) removeCanceledRenewal(db,row);
}
