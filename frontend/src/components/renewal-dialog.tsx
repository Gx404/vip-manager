import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CompactDialogHeader } from "@/components/context-help";
import { RenewalPaymentFields } from "@/components/renewal-payment-fields";
import type { Subscription } from "@/lib/subscriptions";
import { nextRenewalPeriod } from "../../../shared/billing.ts";
import type { RenewalPaymentInput } from "../../../shared/payments.ts";

type Props = {item:Subscription;today:string;onClose:()=>void;onSave:(payment:RenewalPaymentInput)=>Promise<void>};
export function RenewalDialog({item,today,onClose,onSave}: Props) {
  const [busy,setBusy] = useState(false);
  const next = nextRenewalPeriod(item,today);
  return <Dialog open onOpenChange={open => {if (!open && !busy) onClose();}}><DialogContent className="membership-dialog renewal-dialog" onEscapeKeyDown={event => {if(busy) event.preventDefault();}} onPointerDownOutside={event => {if(busy) event.preventDefault();}}>
    <CompactDialogHeader title={`${item.name} · 记录续费`} helpLabel="记录续费说明" help="填本次实际付款，保存后直接记为已支付，并从已有到期日顺延一期。卡片采用本次金额作为以后续费的默认值，旧付款各自保留。30 秒内可撤销本次续费。" />
    <RenewalPaymentFields initial={{amount:item.amount,currency:item.currency ?? "CNY",paidOn:today,note:""}} startDate={next.startDate} endDate={next.endDate} periodLabel="本次续费的有效期" submitLabel="保存本次续费" hint="保存即记为已支付。外币按实际付款日期查询汇率。" onSave={onSave} onCancel={onClose} onBusyChange={setBusy} />
  </DialogContent></Dialog>;
}
