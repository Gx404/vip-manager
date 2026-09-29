/** Shared subscription data and timezone-safe date-only arithmetic. */
export const categories = ["影音娱乐", "AI 工具", "云盘存储", "效率办公", "其他服务"] as const;
export const cycles = { monthly: "月付", quarterly: "季付", yearly: "年付", custom: "自定义" } as const;
export type Subscription = {
  id: string; name: string; plan: string; category: string; amount: number;
  cycle: keyof typeof cycles; customDays: number; startDate: string; endDate: string;
  reminderDays: number; autoRenew: boolean; note: string; color: string; version: number;
};
export const palette = ["#d74747", "#269979", "#497ccd", "#8a5fc4", "#cf8b30", "#3b424c"];
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateNumber(date: string): number { return Date.parse(`${date}T00:00:00Z`) / 86400000; }
export function shiftDate(date: string, days: number): string { return new Date((dateNumber(date) + days) * 86400000).toISOString().slice(0, 10); }
export function remaining(item: Subscription, today: string): number { return Math.round(dateNumber(item.endDate) - dateNumber(today)); }
export function fraction(item: Subscription, today: string): number {
  return Math.max(0, Math.min(100, remaining(item, today) / Math.max(1, dateNumber(item.endDate) - dateNumber(item.startDate)) * 100));
}
export function stateOf(item: Subscription, today: string) {
  const days = remaining(item, today);
  return days < 0 ? "expired" : days <= item.reminderDays ? "soon" : "healthy";
}
export function monthlyCost(item: Subscription): number {
  return item.amount / (item.cycle === "yearly" ? 12 : item.cycle === "quarterly" ? 3 : item.cycle === "custom" ? item.customDays / 30 : 1);
}
/** Add a billing cycle with month-end clamping. */
export function renewDate(base: string, cycle: Subscription["cycle"], days: number): string {
  if (cycle === "custom") return shiftDate(base, days);
  const d = new Date(`${base}T00:00:00Z`), day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (cycle === "yearly" ? 12 : cycle === "quarterly" ? 3 : 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}
export function sampleSubscriptions(today: string): Subscription[] {
  const values: [string, string, string, number, Subscription["cycle"], number, string, boolean][] = [
    ["Netflix", "标准会员", "影音娱乐", 78, "monthly", 3, "#d74747", true],
    ["ChatGPT", "Plus", "AI 工具", 145, "monthly", 6, "#269979", true],
    ["网易云音乐", "黑胶 VIP", "影音娱乐", 158, "yearly", 18, "#d74747", false],
    ["iCloud+", "200 GB", "云盘存储", 21, "monthly", 23, "#497ccd", true],
    ["哔哩哔哩", "年度大会员", "影音娱乐", 168, "yearly", 86, "#de7295", false],
    ["Notion", "Plus", "效率办公", 72, "monthly", 12, "#3b424c", false],
    ["百度网盘", "超级会员", "云盘存储", 198, "yearly", -2, "#497ccd", false],
    ["腾讯视频", "VIP 会员", "影音娱乐", 25, "monthly", 15, "#cf8b30", true],
  ];
  return values.map(([name, plan, category, amount, cycle, left, color, autoRenew], i) => ({
    id: `example-${i}`, name, plan, category, amount, cycle, customDays: 30,
    startDate: shiftDate(today, left - (cycle === "yearly" ? 365 : 30)), endDate: shiftDate(today, left),
    reminderDays: 7, autoRenew, note: "", color, version: 0,
  }));
}
