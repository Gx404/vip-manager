import type { RenewalLog } from "./renewals.ts";
import { paymentCny, paymentState } from "./payments.ts";
import { dateNumber, type Subscription } from "./subscriptions.ts";

type Interval = { startDate: string; endDate: string };
export type ReportEntry = Interval & {
  id: string; subscriptionId: string; label: string; plan: string; category: string;
  paidOn: string; amount: number; source: "payment" | "subscription";
  // A subscription estimate can fill only the uncovered portions of a ledger period.
  segments: Interval[];
};

function subtract(segments: Interval[], covered: Interval): Interval[] {
  return segments.flatMap(segment => {
    if (covered.endDate <= segment.startDate || covered.startDate >= segment.endDate) return [segment];
    const rest: Interval[] = [];
    if (segment.startDate < covered.startDate) rest.push({ startDate: segment.startDate, endDate: covered.startDate });
    if (covered.endDate < segment.endDate) rest.push({ startDate: covered.endDate, endDate: segment.endDate });
    return rest;
  });
}

/** Read-only reporting inputs: never create payment confirmations from subscription estimates. */
export function reportEntries(logs: RenewalLog[], items: Subscription[], today: string) {
  const confirmed: ReportEntry[] = logs.filter(log => paymentState(log) === "paid" && log.payment!.paidOn <= today).map(log => {
    const p = log.payment!;
    return { id: log.id, subscriptionId: log.subscriptionId, label: log.subscriptionName, plan: p.plan, category: p.category,
      startDate: p.startDate, endDate: p.endDate, paidOn: p.paidOn, amount: paymentCny(p), source: "payment", segments: [p] };
  });
  const candidates: ReportEntry[] = [];
  const unavailable = new Set<string>();
  for (const item of items) {
    if (item.startDate > today) continue;
    if (item.ratePending) { unavailable.add(item.id); continue; }
    candidates.push({ id: `subscription:${item.id}`, subscriptionId: item.id, label: item.name, plan: item.plan, category: item.category,
      startDate: item.startDate, endDate: item.endDate, paidOn: item.startDate, amount: item.amount * (item.fxRateToCny ?? 1), source: "subscription", segments: [item] });
  }
  // Renewal audits also preserve the previous entered period and its price. Keep that
  // known history after renewal, without extrapolating missing cycles backwards.
  for (const log of [...logs].sort((a,b) => b.createdAt.localeCompare(a.createdAt))) {
    if (log.undoneAt || log.payment?.source === "backfill" || log.previousStartDate >= log.newStartDate || log.previousStartDate > today || log.amount === null || log.previousRatePending) continue;
    const item = items.find(item => item.id === log.subscriptionId);
    candidates.push({ id: `schedule:${log.id}`, subscriptionId: log.subscriptionId, label: log.subscriptionName,
      plan: log.payment?.plan ?? item?.plan ?? "", category: log.payment?.category ?? item?.category ?? "其他服务",
      startDate: log.previousStartDate, endDate: log.previousEndDate, paidOn: log.previousStartDate,
      amount: log.amount / log.periods * (log.fxRateToCny ?? 1), source: "subscription", segments: [{ startDate: log.previousStartDate, endDate: log.previousEndDate }] });
  }

  const accrual = [...confirmed], cash = [...confirmed];
  const occupied = new Map<string, Interval[]>();
  const cashBlocked = new Map<string, Interval[]>();
  for (const log of logs) {
    const interval = log.payment ?? { startDate: log.newStartDate, endDate: log.newEndDate };
    // A voided payment must not reappear as a subscription estimate. Pending schedule
    // events remain estimates in accrual, but must not become inferred cash payments.
    if (log.payment) occupied.set(log.subscriptionId, [...(occupied.get(log.subscriptionId) ?? []), interval]);
    if (!log.undoneAt || log.payment) cashBlocked.set(log.subscriptionId, [...(cashBlocked.get(log.subscriptionId) ?? []), interval]);
  }
  for (const entry of candidates) {
    if (!Number.isFinite(entry.amount) || entry.amount < 0 || entry.endDate <= entry.startDate) continue;
    const blockers = occupied.get(entry.subscriptionId) ?? [];
    let segments: Interval[] = [entry];
    for (const interval of blockers) segments = subtract(segments, interval);
    if (segments.length) accrual.push({ ...entry, segments });
    // Partial ledger overlap does not justify inventing an additional cash payment.
    if (!(cashBlocked.get(entry.subscriptionId) ?? []).some(interval => interval.startDate < entry.endDate && interval.endDate > entry.startDate)) cash.push(entry);
    occupied.set(entry.subscriptionId, [...blockers, entry]);
    cashBlocked.set(entry.subscriptionId, [...(cashBlocked.get(entry.subscriptionId) ?? []), entry]);
  }
  return { accrual, cash, confirmed, unavailable: unavailable.size };
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

/**
 * Return the amount represented by an entry after confirmed payments have
 * covered part of its service interval. The remaining amount stays attached
 * to the entry's payment month; it is never spread into later months.
 */
export function entryAmount(entry: ReportEntry): number {
  const duration = dateNumber(entry.endDate) - dateNumber(entry.startDate);
  const covered = entry.segments.reduce((days, segment) =>
    days + Math.max(0, dateNumber(segment.endDate) - dateNumber(segment.startDate)), 0);
  return duration > 0 ? entry.amount * Math.min(1, covered / duration) : 0;
}

export function allocatedEntry(entry: ReportEntry, period: string): number {
  return (!period || entry.paidOn.startsWith(period)) ? entryAmount(entry) : 0;
}
