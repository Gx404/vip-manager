import { useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CompactDialogHeader } from "@/components/context-help";
import { RenewalPaymentFields } from "@/components/renewal-payment-fields";
import type { Subscription } from "@/lib/subscriptions";
import { nextRenewalPeriod } from "../../../shared/billing.ts";
import type { RenewalPaymentInput } from "../../../shared/payments.ts";
import type { RenewalMode } from "../../../shared/renewals.ts";

type Props = {item:Subscription;today:string;onClose:()=>void;onSave:(payment:RenewalPaymentInput,mode:RenewalMode)=>Promise<void>};
export function RenewalDialog({item,today,onClose,onSave}: Props) {
  const [busy,setBusy] = useState(false);
  const [paidOn,setPaidOn] = useState(today);
  const [mode,setMode] = useState<RenewalMode>("continue");
  const expired = item.endDate < today;
  const next = nextRenewalPeriod(item,today,undefined,{mode,paidOn:paidOn || today});
  const hint = expired ? mode === "continue" ? "每次只接续一期，付款日期单独记录；未补到当前月份时仍显示为已过期。外币按实际付款日期查询汇率。" : "从实际付款日期重新计算一期，之前的空档不补记。外币按实际付款日期查询汇率。" : "保存即记为已支付。外币按实际付款日期查询汇率。";
  async function save(payment: RenewalPaymentInput) {
    if (mode === "restart" && payment.paidOn < item.endDate) throw new Error("重新开始的付款日期不能早于原到期日；补记历史账期请选择接原到期日补一期。");
    await onSave(payment,mode);
  }
  return <Dialog open onOpenChange={open => {if (!open && !busy) onClose();}}><DialogContent className="membership-dialog renewal-dialog" onEscapeKeyDown={event => {if(busy) event.preventDefault();}} onPointerDownOutside={event => {if(busy) event.preventDefault();}}>
    <CompactDialogHeader title={`${item.name} · 记录续费`} helpLabel="记录续费说明" help="填本次实际付款，保存后直接记为已支付。默认接原到期日补一期；已过期时也可选择从付款日重新开始。卡片采用本次金额作为以后续费的默认值，旧付款各自保留。30 秒内可撤销本次续费。" />
    <RenewalPaymentFields initial={{amount:item.amount,currency:item.currency ?? "CNY",paidOn:today,note:""}} startDate={next.startDate} endDate={next.endDate} periodLabel="本次续费的有效期" submitLabel="保存本次续费" hint={hint} periodOptions={expired ? <label className="form-field"><span>续费方式</span><select aria-label="续费方式" disabled={busy} value={mode} onChange={event => setMode(event.target.value as RenewalMode)}><option value="continue">接原到期日补一期</option><option value="restart">从付款日重新开始</option></select></label> : undefined} onPaidOnChange={setPaidOn} onSave={save} onCancel={onClose} onBusyChange={setBusy} />
  </DialogContent></Dialog>;
}
