import { shiftDate, type Subscription } from "../../shared/subscriptions.ts";

/** Test-only synthetic records. Never bundled or inserted into a deployed database. */
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
