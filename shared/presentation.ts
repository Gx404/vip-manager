import { categories, dateNumber, remaining, renewDate, type Subscription } from "./subscriptions.ts";
import { cycleBoundary } from "./billing.ts";

/** Return only occupied categories, in the configured order; the editor still offers every category. */
export function occupiedCategories(items: Pick<Subscription, "category">[]): { category: typeof categories[number]; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return categories.map(category => ({ category, count: counts.get(category) ?? 0 })).filter(value => value.count > 0);
}

/** Return whether an expiry is between today and the inclusive day limit; expired items are excluded. */
export function dueWithin(item: Subscription, today: string, limit: number): boolean {
  const days = remaining(item, today);
  return days >= 0 && days <= limit;
}

const progressStops = [
  [0, "#d35e62"], [20, "#df984c"], [50, "#a3b75c"], [100, "#2f9e7a"],
] as const;

/** One solid bar color follows the same remaining percentage as its length, for every billing cycle. */
export function progressColor(percentage: number): string {
  if (!Number.isFinite(percentage) || percentage <= 0) return progressStops[0][1];
  for (let index = 1; index < progressStops.length; index++) {
    const [rightPercent, right] = progressStops[index];
    const [leftPercent, left] = progressStops[index - 1];
    if (percentage <= rightPercent) {
      const fraction = (percentage - leftPercent) / (rightPercent - leftPercent);
      const channels = [1, 3, 5].map(offset => Math.round(parseInt(left.slice(offset, offset + 2), 16) * (1 - fraction) + parseInt(right.slice(offset, offset + 2), 16) * fraction));
      return "#" + channels.map(channel => channel.toString(16).padStart(2, "0")).join("");
    }
  }
  return progressStops[progressStops.length - 1][1];
}

/** Return remaining time against the current billing cycle; prepaid extra cycles may exceed 100%. */
export function periodPercentage(item: Pick<Subscription, "startDate" | "endDate" | "coverageStartDate"> & Partial<Pick<Subscription, "cycle" | "customDays">>, today: string): number {
  const cycleEnd = item.cycle ? renewDate(item.startDate, item.cycle, item.customDays ?? 0) : item.endDate;
  const total = dateNumber(cycleEnd) - dateNumber(item.startDate);
  const days = dateNumber(item.endDate) - dateNumber(today);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(days)) return 0;
  return Math.round(Math.max(0, days) / total * 100);
}

type BillingProgressItem = Pick<Subscription, "startDate" | "endDate" | "coverageStartDate" | "cycle" | "customDays">;
export type BillingProgress = {
  current: { startDate: string; endDate: string; used: number; remaining: number } | null;
  next: { startDate: string; endDate: string; remaining: number } | null;
  /** All scheduled periods that have not started, including the one displayed as next. */
  futurePeriods: number;
};

/**
 * Separate continuous coverage into real billing periods, instead of splitting a total percentage.
 * Periods are [start, end): on a renewal date the next period becomes current. Coverage is schedule
 * information, not payment confirmation; an unstarted period is always wholly available.
 */
export function billingProgress(item: BillingProgressItem, today: string): BillingProgress {
  const empty: BillingProgress = { current: null, next: null, futurePeriods: 0 };
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dateNumber(value)) &&
    new Date(dateNumber(value) * 86400000).toISOString().slice(0, 10) === value;
  if (!validDate(item.startDate) || !validDate(item.endDate) || !validDate(today) || item.endDate <= item.startDate) return empty;
  if (!["monthly", "quarterly", "yearly", "custom"].includes(item.cycle) ||
    (item.cycle === "custom" && (!Number.isInteger(item.customDays) || item.customDays <= 0))) return empty;
  const anchor = item.coverageStartDate && validDate(item.coverageStartDate) && item.coverageStartDate < item.startDate
    ? item.coverageStartDate : item.startDate;
  if (today >= item.endDate) return empty;

  const boundary = (index: number) => cycleBoundary(anchor, item.cycle, item.customDays, index);
  // Estimate by whole months/days, then adjust at most one boundary for the anchor day. This also
  // handles long renewal histories without iterating through every historical billing period.
  const indexAt = (date: string) => {
    if (item.cycle === "custom") return Math.floor((dateNumber(date) - dateNumber(anchor)) / item.customDays);
    const monthNumber = (value: string) => Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
    const months = item.cycle === "yearly" ? 12 : item.cycle === "quarterly" ? 3 : 1;
    const estimate = Math.floor((monthNumber(date) - monthNumber(anchor)) / months);
    return boundary(estimate) > date ? estimate - 1 : estimate;
  };
  // The latest saved interval is authoritative: a February-clamped start can still end on the
  // original billing day in March or a leap year. Never split that interval into a fictional renewal.
  const latestIndex = indexAt(item.startDate);
  const earlierPeriods = latestIndex + (boundary(latestIndex) < item.startDate ? 1 : 0);
  const totalPeriods = earlierPeriods + 1;
  const currentIndex = today < anchor ? -1 : today >= item.startDate ? earlierPeriods : indexAt(today);
  const futurePeriods = Math.max(0, totalPeriods - currentIndex - 1);
  const period = (index: number) => index === earlierPeriods
    ? { startDate: item.startDate, endDate: item.endDate }
    : { startDate: boundary(index), endDate: boundary(index + 1) < item.startDate ? boundary(index + 1) : item.startDate };
  const next = futurePeriods > 0 ? { ...period(currentIndex + 1), remaining: 100 } : null;
  if (currentIndex < 0) return { current: null, next, futurePeriods };
  const current = period(currentIndex);
  const used = Math.round((dateNumber(today) - dateNumber(current.startDate)) / (dateNumber(current.endDate) - dateNumber(current.startDate)) * 100);
  return { current: { ...current, used, remaining: 100 - used }, next, futurePeriods };
}
