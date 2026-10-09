import { renewDate, type Subscription } from "../../../shared/subscriptions.ts";

export type MembershipTemplate = {
  key: string;
  name: string;
  plan: string;
  category: string;
  color: string;
  cycle: Subscription["cycle"];
  customDays: number;
};

/** Curated presets only provide identity and billing cadence; they never invent a price. */
export const membershipTemplates: readonly MembershipTemplate[] = [
  { key: "baidu", name: "百度网盘", plan: "SVIP", category: "云存储", color: "#4388d8", cycle: "yearly", customDays: 365 },
  { key: "chatgpt", name: "ChatGPT Plus", plan: "Plus", category: "AI 工具", color: "#10a37f", cycle: "monthly", customDays: 30 },
  { key: "bilibili", name: "哔哩哔哩大会员", plan: "大会员", category: "影音娱乐", color: "#fb7299", cycle: "monthly", customDays: 30 },
  { key: "88vip", name: "淘宝88VIP", plan: "88VIP", category: "购物电商", color: "#ff5000", cycle: "yearly", customDays: 365 },
  { key: "icloud", name: "iCloud+", plan: "iCloud+", category: "云存储", color: "#4f8ee8", cycle: "monthly", customDays: 30 },
];

/** Recalculate a draft date only when automatic linking is still enabled. */
export function linkedEndDate(startDate: string, cycle: Subscription["cycle"], customDays: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate < "1900-01-01" || startDate > "2200-12-31") return null;
  const parsed = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== startDate) return null;
  if (cycle === "custom" && (!Number.isInteger(customDays) || customDays < 1 || customDays > 3650)) return null;
  const result = renewDate(startDate, cycle, customDays);
  return result <= "2200-12-31" ? result : null;
}

/** Preserve manual end dates; derive only while a new/edit draft explicitly enables linking. */
export function updateDraftPeriod<T extends { startDate: string; endDate: string; cycle: Subscription["cycle"]; customDays: string }>(draft: T, patch: Partial<T>, linked: boolean): T {
  const next = { ...draft, ...patch };
  if (linked && ("startDate" in patch || "cycle" in patch || "customDays" in patch)) {
    const end = linkedEndDate(next.startDate, next.cycle, Number(next.customDays));
    if (end) next.endDate = end;
  }
  return next;
}

/** Generate a stable request id on secure browsers; the server version check remains the fallback guard. */
export function requestId(): string | undefined {
  try { return globalThis.crypto?.randomUUID?.(); } catch { return undefined; }
}

export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "short" });
}
