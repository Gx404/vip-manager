import { Ellipsis } from "lucide-react";
import { ServiceLogo } from "@/components/service-logo";
import { remaining, cycles, stateOf, type Subscription } from "@/lib/subscriptions";
import { currencyMeta, formatCurrency } from "../../../shared/currency.ts";

type Props = { item: Subscription; today: string; canManage: boolean; onEdit: () => void };

/** A single dense row keeps the due date and actions visible even on narrow mobile screens. */
export function SubscriptionRow({ item, today, canManage, onEdit }: Props) {
  const days = remaining(item, today);
  const metadata = [item.plan, item.category].filter(Boolean).join(" · ");
  return <article className={`subscription-row ${stateOf(item, today)}`} aria-label={item.name}>
    <div className="row-service"><ServiceLogo name={item.name} color={item.color} /><div><h2 title={item.name}>{item.name}</h2><p title={metadata}>{metadata}</p></div></div>
    <div className="row-amount">{currencyMeta(item.currency).symbol}{formatCurrency(item.amount, item.currency)}<small> / {item.cycle === "custom" ? `${item.customDays} 天` : cycles[item.cycle].replace("付", "")}</small></div>
    <div className="row-date"><b>{days < 0 ? `已过期 ${-days} 天` : days === 0 ? "今日到期" : `剩余 ${days} 天`}</b><time dateTime={item.endDate}>{item.endDate}</time></div>
    {canManage && <div className="row-actions">
      <button className="icon-button" aria-label={`编辑${item.name}`} onClick={onEdit}><Ellipsis size={18} /></button>
    </div>}
  </article>;
}
