import { ArrowUpRight, LayoutGrid, Wallet } from "lucide-react";
import { remaining, stateOf, type Subscription } from "@/lib/subscriptions";
import { formatCurrency } from "../../../shared/currency.ts";

type Props = { items: Subscription[]; today: string; monthly: number; canManage: boolean; onCosts: () => void };

/** A compact overview keeps subscription health and the amortized monthly budget together. */
export function DashboardOverview({ items, today, monthly, canManage, onCosts }: Props) {
  const activeCount = items.filter(item => remaining(item, today) >= 0).length;
  const counts = { healthy: 0, soon: 0, expired: 0 };
  for (const item of items) counts[stateOf(item, today)]++;
  const SpendingCard = canManage ? "button" : "div";

  return <section className="overview" aria-label="订阅总览">
    <div className="summary-card subscription-summary">
      <div className="summary-label">有效订阅<LayoutGrid aria-hidden="true" /></div>
      <div className="summary-number">{activeCount}<span>/ {items.length} 项</span></div>
      <div className="status-legend" aria-label="订阅状态分布">
        <span className="healthy">正常 <b>{counts.healthy}</b></span>
        <span className="soon" title="按各订阅的提前提醒设置">临期 <b>{counts.soon}</b></span>
        <span className="expired">过期 <b>{counts.expired}</b></span>
      </div>
    </div>
    <SpendingCard className={`summary-card spending-summary${canManage ? " clickable" : ""}`} onClick={canManage ? onCosts : undefined} aria-haspopup={canManage ? "dialog" : undefined} aria-label={canManage ? "月均支出，查看摊算明细" : "月均支出"}>
      <div className="summary-label">月均支出<Wallet aria-hidden="true" /></div>
      <div className="summary-number"><small>¥</small>{formatCurrency(monthly, "CNY")}<span>/ 月</span></div>
      <div className="spending-bottom"><span>{items.some(i=>i.ratePending)?`${items.filter(i=>i.ratePending).length} 项汇率待补全，未计入`:<>年约 <b>¥{formatCurrency(monthly * 12, "CNY")}</b></>}</span>{canManage && <span className="summary-link">摊算明细<ArrowUpRight size={15} aria-hidden="true" /></span>}</div>
    </SpendingCard>
  </section>;
}
