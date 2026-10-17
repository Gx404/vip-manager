import type { CSSProperties } from "react";
import { CalendarDays, Clock3, Ellipsis, Wallet } from "lucide-react";
import { ServiceLogo } from "@/components/service-logo";
import { Progress } from "@/components/ui/progress";
import { billingProgress, cycles, periodPercentage, progressColor, remaining, stateOf, type Subscription } from "@/lib/subscriptions";
import { CurrencyAmount } from "@/components/currency-amount";

type Props = { item: Subscription; today: string; canManage: boolean; onEdit: () => void };

export function SubscriptionCard({ item, today, canManage, onEdit }: Props) {
  const days = remaining(item, today);
  const status = stateOf(item, today);
  const coverageStart = item.coverageStartDate ?? item.startDate;
  const progress = periodPercentage(item, today < coverageStart ? coverageStart : today);
  const billing = billingProgress(item, today);
  const metadata = [item.plan, item.category].filter(Boolean).join(" · ");
  // Each row represents a real billing period, rather than a slice of the total percentage.
  const statusLabel = days < 0 ? "已到期" : days === 0 ? "今日到期" : status === "soon" ? "即将到期" : null;
  const progressLabel = `${item.name}：总时长剩余 ${progress}%，${days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今日到期" : `距到期 ${days} 天`}`;
  const currentLabel = billing.current ? `本期 ${billing.current.startDate} 至 ${billing.current.endDate}，已用 ${billing.current.used}%，剩余 ${billing.current.remaining}%` : "";
  const nextLabel = billing.next ? `${billing.current ? "下期" : "账期"} ${billing.next.startDate} 至 ${billing.next.endDate}，尚未开始，剩余 ${billing.next.remaining}%` : "";

  return <article className={`subscription-card ${status}`} aria-label={item.name}>
    <div className="card-heading">
      <ServiceLogo name={item.name} color={item.color} />
      <div className="service-name"><h2 title={item.name}>{item.name}</h2><p title={metadata}>{metadata}</p></div>
      <span className={`membership-status ${status}`} role="img" aria-label={statusLabel ?? "正常"} title={statusLabel ?? "正常"} />
      {canManage && <div className="card-actions"><button className="icon-button" aria-label={`编辑${item.name}`} onClick={onEdit}><Ellipsis size={20} /></button></div>}
    </div>
    <div className="membership-metrics">
      <div className="membership-metric"><div className="small-label"><Clock3 size={13} />{days < 0 ? "已过期" : "剩余时间"}</div><div className="remaining-number">{Math.abs(days)}<span>天</span></div></div>
      <div className="membership-metric"><div className="small-label"><Wallet size={13} />续费金额</div><div className="membership-price"><CurrencyAmount amount={item.amount} currency={item.currency} /><small> / {item.cycle === "custom" ? `${item.customDays}天` : cycles[item.cycle].replace("付", "")}</small></div></div>
    </div>
    <div className="progress-caption">
      <span>总时长</span>
      <span title={progressLabel}>{progress}%</span>
    </div>
    <div className="billing-progress">
      {billing.current && <div className="billing-progress-period" title={currentLabel}>
        <div className="billing-progress-label"><span>本期已用 {billing.current.used}%</span><span>剩余 {billing.current.remaining}%</span></div>
        <Progress value={billing.current.remaining} fillFrom="end" aria-label={`${item.name}：${currentLabel}`} aria-valuetext={currentLabel} className="segments" style={{ "--segment-color": progressColor(billing.current.remaining) } as CSSProperties} />
      </div>}
      {billing.next && <div className="billing-progress-period next" title={nextLabel}>
        <div className="billing-progress-label"><span>{billing.current ? "下期待开始" : "待开始"}</span><span>{billing.next.startDate.replaceAll("-", ".")}</span></div>
        <Progress value={billing.next.remaining} aria-label={`${item.name}：${nextLabel}`} aria-valuetext={nextLabel} className="segments" style={{ "--segment-color": "#7186df" } as CSSProperties} />
      </div>}
      {!billing.current && !billing.next && <div className="billing-progress-period">
        <div className="billing-progress-label"><span className="card-status expired">{statusLabel ?? "已结束"}</span><span>剩余 0%</span></div>
        <Progress value={0} aria-label={progressLabel} aria-valuetext={progressLabel} className="segments is-empty" />
      </div>}
      {billing.futurePeriods > 1 && <div className="billing-progress-note">已续 {billing.futurePeriods} 个后续账期</div>}
    </div>
    <div className="membership-expiry"><span><CalendarDays size={13} />到期日期</span><time dateTime={item.endDate}>{item.endDate.replaceAll("-", ".")}</time></div>
  </article>;
}
