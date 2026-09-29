/** Shared subscription data and timezone-safe date-only arithmetic. */
export const categories = ["影音娱乐", "购物会员", "AI 工具", "云盘存储", "效率办公", "生活服务", "游戏会员", "学习教育", "网络服务", "其他服务"] as const;
export const cycles = { monthly: "月付", quarterly: "季付", yearly: "年付", custom: "自定义" } as const;
export type Subscription = {
  id: string; name: string; plan: string; category: string; amount: number;
  cycle: keyof typeof cycles; customDays: number; startDate: string; endDate: string;
  reminderDays: number; autoRenew: boolean; note: string; color: string; version: number;
};
export type DashboardSnapshot = { items: Subscription[]; canManage: boolean; publicDashboard: boolean };
export const palette = ["#d74747", "#269979", "#497ccd", "#8a5fc4", "#cf8b30", "#3b424c"];
export function dateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateNumber(date: string): number { return Date.parse(`${date}T00:00:00Z`) / 86400000; }
export function shiftDate(date: string, days: number): string { return new Date((dateNumber(date) + days) * 86400000).toISOString().slice(0, 10); }
export function remaining(item: Subscription, today: string): number { return Math.round(dateNumber(item.endDate) - dateNumber(today)); }
/** Return 0–100% remaining in the entered billing period, not the lifetime of a membership. */
export function fraction(item: Subscription, today: string): number {
  return Math.max(0, Math.min(100, remaining(item, today) / Math.max(1, dateNumber(item.endDate) - dateNumber(item.startDate)) * 100));
}
/** Map remaining percentage to twenty distinct 5% bands: low red through amber to high green. */
export function progressColor(value: number): string {
  const percentage = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  const band = Math.max(1, Math.ceil(percentage / 5));
  return `hsl(${Math.round((band - 1) * 150 / 19)} 64% 42%)`;
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
