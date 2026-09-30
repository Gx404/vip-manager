import { dateNumber, renewDate, shiftDate, type Subscription } from "./subscriptions.ts";

type Period = Pick<Subscription, "startDate" | "endDate" | "cycle" | "customDays">;
const monthsPerCycle = { monthly: 1, quarterly: 3, yearly: 12 } as const;

/** Return a YYYY-MM-DD date in the application's configured timezone. */
export function dateInTimeZone(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Keep the original billing day when a short month has clamped an otherwise regular period. */
export function billingAnchor(item: Period): string {
  return renewDate(item.startDate, item.cycle, item.customDays) === item.endDate ? item.startDate : item.endDate;
}

/** Return an anchored boundary without cumulative February/month-end drift. */
export function cycleBoundary(anchor: string, cycle: Subscription["cycle"], days: number, index: number): string {
  if (!Number.isInteger(index) || index < 0) throw new Error("账期序号必须是非负整数。");
  if (cycle === "custom") return shiftDate(anchor, days * index);
  const original = new Date(`${anchor}T00:00:00Z`);
  const target = new Date(Date.UTC(original.getUTCFullYear(), original.getUTCMonth() + monthsPerCycle[cycle] * index, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(original.getUTCDate(), last));
  return target.toISOString().slice(0, 10);
}

/**
 * Compute the scheduled period covering today. endDate is the renewal boundary for automatic records.
 * Returns null before the boundary, otherwise one catch-up result even after many missed periods.
 * This function does not process payments or confirm a provider's billing status.
 */
export function automaticPeriod(item: Period, anchor: string, today: string): { startDate: string; endDate: string; periods: number } | null {
  if (item.endDate > today) return null;
  if (item.cycle === "custom") {
    const periods = Math.floor((dateNumber(today) - dateNumber(item.endDate)) / item.customDays) + 1;
    return { startDate: shiftDate(item.endDate, (periods - 1) * item.customDays), endDate: shiftDate(item.endDate, periods * item.customDays), periods };
  }
  const monthNumber = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  const months = monthsPerCycle[item.cycle];
  let index = Math.floor((monthNumber(today) - monthNumber(anchor)) / months);
  if (cycleBoundary(anchor, item.cycle, item.customDays, index) > today) index--;
  const startDate = cycleBoundary(anchor, item.cycle, item.customDays, index);
  const endDate = cycleBoundary(anchor, item.cycle, item.customDays, index + 1);
  const periods = Math.max(1, Math.round((monthNumber(endDate) - monthNumber(item.endDate)) / months));
  return { startDate, endDate, periods };
}
