import type { CurrencyCode } from "./currency.ts";
import type { RenewalLog } from "./renewals.ts";

export type Payment = {
  amount: number; currency: CurrencyCode; paidOn: string; startDate: string; endDate: string;
  rate: number | null; rateDate: string | null; category: string; plan: string; note: string;
  source: "backfill" | "renewal"; confirmedAt: string; voidedAt: string | null;
  dateCorrections?: { from: string; to: string; changedAt: string }[];
  corrections?: { previous: RenewalPaymentInput; changedAt: string }[];
};
export type PaymentInput = Pick<Payment, "amount" | "currency" | "paidOn" | "startDate" | "endDate" | "note">;
export type RenewalPaymentInput = Pick<PaymentInput, "amount" | "currency" | "paidOn" | "note">;
export type PaymentPreview = PaymentInput & { rate: number | null; rateDate: string | null; duplicate: boolean };
/** A known period without a confirmed payment, for explicit user reconciliation only. */
export type ReconciliationPeriod = {
  subscriptionId: string; subscriptionName: string; plan: string;
  startDate: string; endDate: string; amount: number; currency: CurrencyCode; paidOn: string;
};
export function paymentState(log: RenewalLog): "paid" | "pending" | "void" {
  return log.undoneAt || log.payment?.voidedAt ? "void" : log.payment ? "paid" : "pending";
}
export function paymentCny(payment: Payment): number | null { return payment.rate === null ? null : payment.amount * payment.rate; }
/**
 * Pick a usable date for the explicit confirmation form.
 *
 * A pending renewal is only a schedule until the user presses "确认已支付";
 * therefore a future service start may safely default to today's date here.
 * The user can still replace it with the actual charge date before submitting,
 * and the server rejects dates in the future and keeps the ledger pending
 * until that explicit confirmation.
 */
export function defaultPaymentDate(log: RenewalLog, today: string): string {
  return log.payment?.paidOn ?? (log.newStartDate <= today ? log.newStartDate : today);
}
