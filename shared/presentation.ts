import { categories, type Subscription } from "./subscriptions.ts";

/** Return only occupied categories, in the configured order; the editor still offers every category. */
export function occupiedCategories(items: Pick<Subscription, "category">[]): { category: typeof categories[number]; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  return categories.map(category => ({ category, count: counts.get(category) ?? 0 })).filter(value => value.count > 0);
}

/** A shared remaining-days ruler. Square-root easing keeps short durations visible; it is not a billing percentage. */
export function durationMeter(days: number, horizonDays = 365): number {
  const horizon = Number.isFinite(horizonDays) ? Math.max(365, horizonDays) : 365;
  const remaining = Number.isFinite(days) ? Math.max(0, Math.min(days, horizon)) : 0;
  return Math.sqrt(remaining / horizon) * 100;
}

const timeStops = [
  [0, "#d35e62"], [3, "#de7857"], [7, "#df984c"], [14, "#c9ab4d"],
  [30, "#80af70"], [90, "#3fa890"], [180, "#459fbd"], [365, "#6c8fcd"], [730, "#8880c8"],
] as const;

/** Interpolate by absolute remaining days: urgent red/orange, medium green, distant blue/violet. */
export function durationColor(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return timeStops[0][1];
  for (let index = 1; index < timeStops.length; index++) {
    const [rightDay, right] = timeStops[index];
    const [leftDay, left] = timeStops[index - 1];
    if (days <= rightDay) {
      const fraction = (days - leftDay) / (rightDay - leftDay);
      const channels = [1, 3, 5].map(offset => Math.round(parseInt(left.slice(offset, offset + 2), 16) * (1 - fraction) + parseInt(right.slice(offset, offset + 2), 16) * fraction));
      return "#" + channels.map(channel => channel.toString(16).padStart(2, "0")).join("");
    }
  }
  return timeStops[timeStops.length - 1][1];
}

/** Return the remaining fraction of the entered billing period for a compact percentage label. */
export function periodPercentage(item: Pick<Subscription, "startDate" | "endDate">, today: string): number {
  const dateNumber = (value: string) => Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) / 86400000;
  const total = Math.max(1, dateNumber(item.endDate) - dateNumber(item.startDate));
  const left = Math.max(0, Math.min(total, dateNumber(item.endDate) - dateNumber(today)));
  return Math.round(left / total * 100);
}
