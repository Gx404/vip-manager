import { apiRequest } from "@/lib/api";
import { dateInTimeZone } from "../../../shared/billing.ts";
import { RenewalPaymentFields } from "@/components/renewal-payment-fields";
import { defaultPaymentDate, type RenewalPaymentInput } from "../../../shared/payments.ts";
import type { RenewalLog } from "../../../shared/renewals.ts";

type Props = {today?:string;target:RenewalLog;onDone:()=>void;onCancel:()=>void;onBusyChange:(busy:boolean)=>void};
export function PaymentForm({today=dateInTimeZone(new Date(),"Asia/Shanghai"),target,onDone,onCancel,onBusyChange}: Props) {
  const payment = target.payment;
  const initial: RenewalPaymentInput = {amount:payment?.amount ?? target.amount ?? 0,currency:payment?.currency ?? target.currency ?? "CNY",paidOn:defaultPaymentDate(target,today),note:payment?.note ?? ""};
  async function save(entry: RenewalPaymentInput) {
    if (payment) await apiRequest("/payments/update",{id:target.id,entry,expected:initial});
    else await apiRequest("/payments/confirm",{id:target.id,entry:{...entry,startDate:target.newStartDate,endDate:target.newEndDate}});
    onDone();
  }
  return <section className="payment-form" aria-label={payment ? "修改付款" : "记录已付款"}>
    <h3 className="payment-form-title">{target.subscriptionName} · {payment ? "修改本次付款" : "记录已付款"}</h3>
    <RenewalPaymentFields today={today} key={target.id} initial={initial} startDate={payment?.startDate ?? target.newStartDate} endDate={payment?.endDate ?? target.newEndDate} submitLabel={payment ? "保存修改" : "保存已付款"} hint="金额、币种和日期按这次实际付款填写，外币自动查询对应日期的汇率。" onSave={save} onCancel={onCancel} onBusyChange={onBusyChange} />
  </section>;
}
