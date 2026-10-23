import { ArrowUpRight, CalendarDays, CircleAlert, LayoutGrid, Wallet } from "lucide-react";
import { remaining, stateOf, type Subscription } from "@/lib/subscriptions";
import { formatCurrency } from "../../../shared/currency.ts";

type Props = { items: Subscription[]; today: string; monthly: number; canManage: boolean; onCosts: () => void };

/** Four compact tiles use the same overview hierarchy as the probe dashboard. */
export function DashboardOverview({ items, today, monthly, canManage, onCosts }: Props) {
  const active = items.filter(item => remaining(item, today) >= 0);
  const activeCount = active.length;
  const counts = { healthy: 0, soon: 0, expired: 0 };
  for (const item of items) counts[stateOf(item, today)]++;
  const SpendingCard = canManage ? "button" : "div";

  return <section className="overview" aria-label="订阅总览">
    <div className="summary-card subscription-summary">
      <div className="summary-label">有效订阅<LayoutGrid aria-hidden="true" /></div>
      <div className="summary-number">{activeCount}<span>/ {items.length} 项</span></div>
      <div className="overview-bars" aria-hidden="true">{Array.from({length: 12}, (_, n) => <i key={n} className={n < Math.round(activeCount / Math.max(1, items.length) * 12) ? "" : "expired"} />)}</div>
    </div>
    <div className={`summary-card attention-summary${counts.soon ? " has-attention" : ""}`}>
      <div className="summary-label">待关注<CircleAlert aria-hidden="true" /></div>
      <div className="summary-number">{counts.soon}<span>项</span></div>
      <div className="status-legend" aria-label="订阅状态分布"><span className="soon" title="按各订阅的提前提醒设置">临期 <b>{counts.soon}</b></span><span className="expired" title="在分类栏的「已过期」中查看">已过期 <b>{counts.expired}</b></span></div>
    </div>
    <SpendingCard className={`summary-card spending-summary${canManage ? " clickable" : ""}`} onClick={canManage ? onCosts : undefined} aria-haspopup={canManage ? "dialog" : undefined} aria-label={canManage ? "月均支出，查看摊算明细" : "月均支出"}>
      <div className="summary-label">月均支出<Wallet aria-hidden="true" /></div>
      <div className="summary-number"><small>¥</small>{formatCurrency(monthly, "CNY")}<span>/ 月</span></div>
      <div className="spending-bottom"><span>{active.some(i=>i.ratePending)?`${active.filter(i=>i.ratePending).length} 项汇率待补全，未计入` : "按续费周期折算"}</span>{canManage && <span className="summary-link">明细<ArrowUpRight size={13} aria-hidden="true" /></span>}</div>
    </SpendingCard>
    <div className="summary-card annual-summary"><div className="summary-label">年度估算<CalendarDays aria-hidden="true" /></div><div className="summary-number"><small>¥</small>{formatCurrency(monthly * 12, "CNY")}</div><div className="spending-bottom">按当前月均费用估算</div></div>
  </section>;
}
