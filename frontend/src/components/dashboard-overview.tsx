import { ArrowUpRight, CalendarDays, CircleAlert, LayoutGrid, Wallet } from "lucide-react";
import { remaining, stateOf, type Subscription } from "@/lib/subscriptions";
import { formatCurrency } from "../../../shared/currency.ts";
import type { SpendingSummary } from "../../../shared/payment-reports.ts";

type Props = { items: Subscription[]; today: string; spending?: SpendingSummary; canManage: boolean; onCosts: () => void };

/** Four compact tiles use the same overview hierarchy as the probe dashboard. */
export function DashboardOverview({ items, today, spending, canManage, onCosts }: Props) {
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
    <SpendingCard className={`summary-card spending-summary${canManage ? " clickable" : ""}`} onClick={canManage ? onCosts : undefined} aria-label={canManage ? "本月支出，查看已付款明细" : "本月支出"}>
      <div className="summary-label">本月支出<Wallet aria-hidden="true" /></div>
      <div className="summary-number">{spending ? spending.monthMissingRates===spending.monthCount&&spending.monthCount>0 ? <span>汇率待补</span> : <><small>¥</small>{formatCurrency(spending.monthTotal, "CNY")}</> : "—"}</div>
      <div className="spending-bottom"><span>{spending ? spending.monthMissingRates ? `${spending.monthMissingRates} 笔汇率待补，未计入` : `${spending.monthCount} 笔已付款 · 按付款日期` : "正在读取已付款金额"}</span>{canManage && <span className="summary-link">明细<ArrowUpRight size={13} aria-hidden="true" /></span>}</div>
    </SpendingCard>
    <div className="summary-card annual-summary"><div className="summary-label">年度支出<CalendarDays aria-hidden="true" /></div><div className="summary-number">{spending ? spending.yearMissingRates===spending.yearCount&&spending.yearCount>0 ? <span>汇率待补</span> : <><small>¥</small>{formatCurrency(spending.yearTotal, "CNY")}</> : "—"}</div><div className="spending-bottom">{spending ? spending.yearMissingRates ? `${spending.yearMissingRates} 笔汇率待补，未计入` : `${today.slice(0,4)} 年 · ${spending.yearCount} 笔已付款` : "正在读取已付款金额"}</div></div>
  </section>;
}
