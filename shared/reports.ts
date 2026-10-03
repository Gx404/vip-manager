import { monthlyCost, monthlyCostCny, remaining, type Subscription } from "./subscriptions.ts";
import type { CurrencyCode } from "./currency.ts";
export type CostGroup = { label: string; count: number; monthly: number; share: number };

/** Budget analysis of non-expired records, including future periods; never claims a payment occurred. */
export function spendingReport(items: Subscription[], today: string) {
  const active = items.filter(item => remaining(item, today) >= 0);
  const monthly = active.reduce((sum, item) => sum + monthlyCostCny(item), 0);
  function group(key: (item: Subscription) => string): CostGroup[] {
    const values = new Map<string, CostGroup>();
    for (const item of active) {
      const label = key(item), value = values.get(label) ?? { label, count: 0, monthly: 0, share: 0 };
      value.count++; value.monthly += monthlyCostCny(item); values.set(label, value);
    }
    return [...values.values()].map(value => ({ ...value, share: monthly ? value.monthly / monthly * 100 : 0 })).sort((a,b) => b.monthly - a.monthly || a.label.localeCompare(b.label, "zh-CN"));
  }
  const currencies = group(item => item.currency ?? "CNY").map(value => ({
    ...value, code: value.label as CurrencyCode,
    originalMonthly: active.filter(item => (item.currency ?? "CNY") === value.label).reduce((sum,item) => sum + monthlyCost(item), 0),
  }));
  return { active, monthly, annual: monthly * 12, expired: items.length - active.length,
    categories: group(item => item.category), currencies, cycles: group(item => item.cycle),
    modes: group(item => item.autoRenew ? "自动续费" : "手动续费"),
    ranking: [...active].sort((a,b) => monthlyCostCny(b) - monthlyCostCny(a)).slice(0,5) };
}
