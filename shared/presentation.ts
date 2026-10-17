import { categories, dateNumber, remaining, renewDate, type Subscription } from "./subscriptions.ts";

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

/** Split a remaining percentage into the current cycle and one prepaid overflow layer. */
export function progressLayers(percentage: number): { primary: number; overflow: number } {
  if (!Number.isFinite(percentage) || percentage <= 0) return { primary: 0, overflow: 0 };
  return {
    primary: Math.min(100, percentage),
    overflow: Math.min(100, Math.max(0, percentage - 100)),
  };
}

/** Return remaining time against the current billing cycle; prepaid extra cycles may exceed 100%. */
export function periodPercentage(item: Pick<Subscription, "startDate" | "endDate" | "coverageStartDate"> & Partial<Pick<Subscription, "cycle" | "customDays">>, today: string): number {
  const cycleEnd = item.cycle ? renewDate(item.startDate, item.cycle, item.customDays ?? 0) : item.endDate;
  const total = dateNumber(cycleEnd) - dateNumber(item.startDate);
  const days = dateNumber(item.endDate) - dateNumber(today);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(days)) return 0;
  return Math.round(Math.max(0, days) / total * 100);
}
