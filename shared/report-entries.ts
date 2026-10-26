import type { BillingFact, RenewalLog } from "./renewals.ts";
import { paymentCny, paymentState } from "./payments.ts";
import { dateNumber, type Subscription } from "./subscriptions.ts";
import type { CurrencyCode } from "./currency.ts";

type Interval = { startDate: string; endDate: string };
export type ReportEntry = Interval & {
  id: string; subscriptionId: string; label: string; plan: string; category: string;
  paidOn: string; amount: number | null; originalAmount: number; currency: CurrencyCode; source: "payment" | "subscription";
  // Service coverage is retained for display; expenditure always uses the actual payment amount.
  segments: Interval[];
};

/** Only explicit valid payments are expenditure. Legacy schedules/facts never create a charge. */
export function reportEntries(logs: RenewalLog[], _items: Subscription[], today: string, _billingFacts: BillingFact[] = []) {
  const confirmed: ReportEntry[] = logs.filter(log => paymentState(log) === "paid" && log.payment!.paidOn <= today).map(log => {
    const p = log.payment!;
    return { id: log.id, subscriptionId: log.subscriptionId, label: log.subscriptionName, plan: p.plan, category: p.category,
      startDate: p.startDate, endDate: p.endDate, paidOn: p.paidOn, amount: paymentCny(p), originalAmount:p.amount, currency:p.currency, source: "payment", segments: [p] };
  });
  // Keep the old response keys for imports/tests and callers; both views now have one paid-only meaning.
  return { accrual: [...confirmed], cash: [...confirmed], confirmed, unavailable: confirmed.filter(entry=>entry.amount===null).length };
}

export function reportWindow(period: string): Interval | null {
  if (!period) return null;
  const startDate = period.length === 4 ? `${period}-01-01` : `${period}-01`;
  const endDate = new Date(Date.UTC(Number(period.slice(0,4)) + (period.length === 4 ? 1 : 0), period.length === 4 ? 0 : Number(period.slice(5,7)), 1)).toISOString().slice(0,10);
  return { startDate, endDate };
}

export function entryDays(entry: ReportEntry, period: string): number {
  const window = reportWindow(period);
  return entry.segments.reduce((days, segment) => {
    const start = window && window.startDate > segment.startDate ? window.startDate : segment.startDate;
    const end = window && window.endDate < segment.endDate ? window.endDate : segment.endDate;
    return days + Math.max(0, dateNumber(end) - dateNumber(start));
  }, 0);
}

/** A charge belongs in full to its actual payment month, regardless of service coverage. */
export function entryAmount(entry: ReportEntry): number | null {
  return entry.amount;
}

export function allocatedEntry(entry: ReportEntry, period: string): number | null {
  return (!period || entry.paidOn.startsWith(period)) ? entryAmount(entry) : 0;
}
