import type { CurrencyCode } from "./currency.ts";
import type { RenewalLog } from "./renewals.ts";

export type Payment = {
  amount: number; currency: CurrencyCode; paidOn: string; startDate: string; endDate: string;
  rate: number; rateDate: string; category: string; plan: string; note: string;
  source: "backfill" | "renewal"; confirmedAt: string; voidedAt: string | null;
};
export type PaymentInput = Pick<Payment, "amount" | "currency" | "paidOn" | "startDate" | "endDate" | "note">;
export type PaymentPreview = PaymentInput & { rate: number; rateDate: string; duplicate: boolean };
export function paymentState(log: RenewalLog): "paid" | "pending" | "void" {
  return log.undoneAt || log.payment?.voidedAt ? "void" : log.payment ? "paid" : "pending";
}
export function paymentCny(payment: Payment): number { return payment.amount * payment.rate; }
