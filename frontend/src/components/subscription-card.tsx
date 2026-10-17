import type { CSSProperties } from "react";
import { CalendarDays, Clock3, Ellipsis, Wallet } from "lucide-react";
import { ServiceLogo } from "@/components/service-logo";
import { Progress } from "@/components/ui/progress";
import { cycles, periodPercentage, progressColor, remaining, stateOf, type Subscription } from "@/lib/subscriptions";
import { CurrencyAmount } from "@/components/currency-amount";

type Props = { item: Subscription; today: string; canManage: boolean; onEdit: () => void };

export function SubscriptionCard({ item, today, canManage, onEdit }: Props) {
  const days = remaining(item, today);
  const status = stateOf(item, today);
  const progress = periodPercentage(item, today);
  const progressValue = Math.min(100, Math.max(0, progress));
  const metadata = [item.plan, item.category].filter(Boolean).join(" · ");
  // Calendar days decide expiry; the visual bar caps at 100% while the label keeps prepaid extra time.
  const statusLabel = days < 0 ? "已到期" : days === 0 ? "今日到期" : status === "soon" ? "即将到期" : null;
  const periodLabel = "本周期剩余";
  const progressLabel = `${item.name}：${periodLabel} ${progress}%，${item.startDate} 至 ${item.endDate}，${days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今日到期" : `距到期 ${days} 天`}`;

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
      {statusLabel ? <span className={`card-status ${days <= 0 ? "expired" : "soon"}`}>{statusLabel}</span> : <span>{periodLabel}</span>}
      <span>{progress}%</span>
    </div>
    <Progress value={progressValue} aria-label={progressLabel} aria-valuetext={progressLabel} title={progressLabel} className={`segments${progress === 0 ? " is-empty" : ""}`} style={{ "--segment-color": progressColor(progress) } as CSSProperties} />
    <div className="membership-expiry"><span><CalendarDays size={13} />到期日期</span><time dateTime={item.endDate}>{item.endDate.replaceAll("-", ".")}</time></div>
  </article>;
}
