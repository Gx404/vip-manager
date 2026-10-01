import { Check, Ellipsis } from "lucide-react";
import { ServiceLogo } from "@/components/service-logo";
import { remaining, cycles, durationColor, type Subscription } from "@/lib/subscriptions";

type Props = { item: Subscription; today: string; canManage: boolean; busy: boolean; onRenew: () => void; onEdit: () => void };

/** A single dense row keeps the due date and actions visible even on narrow mobile screens. */
export function SubscriptionRow({ item, today, canManage, busy, onRenew, onEdit }: Props) {
  const days = remaining(item, today);
  return <article className="subscription-row" aria-label={item.name}>
    <div className="row-service"><ServiceLogo name={item.name} color={item.color} /><div><h2 title={item.name}>{item.name}</h2><p>{item.autoRenew ? "自动续费" : item.category}</p></div></div>
    <div className="row-amount">¥{item.amount.toFixed(2)}<small> / {item.cycle === "custom" ? `${item.customDays} 天` : cycles[item.cycle]}</small></div>
    <div className="row-date"><b style={{ color: durationColor(days) }}>{days < 0 ? `过期 ${-days} 天` : `剩余 ${days} 天`}</b><time dateTime={item.endDate}>{item.endDate}</time></div>
    {canManage && <div className="row-actions">
      {!item.autoRenew && <button className="quick-renew" disabled={busy} aria-label={`快捷续费${item.name}`} title="快捷续费（仅更新记录，可撤销）" onClick={onRenew}><Check size={16} /></button>}
      <button className="icon-button" aria-label={`编辑${item.name}`} onClick={onEdit}><Ellipsis size={18} /></button>
    </div>}
  </article>;
}
