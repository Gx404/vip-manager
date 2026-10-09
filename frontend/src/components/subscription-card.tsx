import type { CSSProperties } from "react";
import { Ellipsis } from "lucide-react";
import { ServiceLogo } from "@/components/service-logo";
import { Progress } from "@/components/ui/progress";
import { cycles, periodPercentage, progressColor, remaining, stateOf, type Subscription } from "@/lib/subscriptions";
import { CurrencyAmount } from "@/components/currency-amount";

type Props = { item: Subscription; today: string; canManage: boolean; onEdit: () => void };

export function SubscriptionCard({ item, today, canManage, onEdit }: Props) {
  const days = remaining(item, today);
  const status = stateOf(item, today);
  const progress = periodPercentage(item, today);
  const metadata = [item.plan, item.category].filter(Boolean).join(" · ");
  // Calendar days decide expiry; a long period can round to 0% while it is still active.
  const statusLabel = days < 0 ? "已到期" : days === 0 ? "今日到期" : status === "soon" ? "即将到期" : null;
  const progressLabel = `${item.name}：本期剩余 ${progress}%，${days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今日到期" : `距到期 ${days} 天`}`;

  return <article className={`subscription-card ${status}`} aria-label={item.name}>
    <div className="card-heading">
      <ServiceLogo name={item.name} color={item.color} />
      <div className="service-name"><h2 title={item.name}>{item.name}</h2><p title={metadata}>{metadata}</p></div>
      {canManage && <div className="card-actions"><button className="icon-button" aria-label={`编辑${item.name}`} onClick={onEdit}><Ellipsis size={20} /></button></div>}
    </div>
    <div className="remaining-block">
      <div><div className="small-label">{days < 0 ? "已过期" : "剩余时间"}</div><div className="remaining-number">{Math.abs(days)}<span>天</span></div></div>
      <time className="expiry-date" dateTime={item.endDate}>{item.endDate.replaceAll("-", ".")} 到期</time>
    </div>
    <div className="progress-caption">
      {statusLabel ? <span className={`card-status ${days <= 0 ? "expired" : "soon"}`}>{statusLabel}</span> : <span>本期剩余</span>}
      <span>{progress}%</span>
    </div>
    <Progress value={progress} aria-label={progressLabel} aria-valuetext={progressLabel} title={progressLabel} className={`segments${progress === 0 ? " is-empty" : ""}`} style={{ "--segment-color": progressColor(progress) } as CSSProperties} />
    <div className="card-metrics">
      <span className="small-label">续费金额</span>
      <p><CurrencyAmount amount={item.amount} currency={item.currency} /><small> / {item.cycle === "custom" ? `${item.customDays}天` : cycles[item.cycle].replace("付", "")}</small></p>
    </div>
  </article>;
}
