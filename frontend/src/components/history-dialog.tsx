import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CompactDialogHeader } from "@/components/context-help";
import { PaymentForm } from "@/components/payment-form";
import { apiRequest } from "@/lib/api";
import type { BillingFact, RenewalLog } from "../../../shared/renewals.ts";
import { type Subscription } from "@/lib/subscriptions";
import { paymentState, paymentCny } from "../../../shared/payments.ts";
import { pendingRenewals } from "../../../shared/payment-reports.ts";
import { formatDateTime } from "@/lib/dashboard-helpers";
import { ReconciliationDialog } from "@/components/reconciliation-dialog";
import { money } from "../../../shared/currency.ts";

type Props = {today:string;open:boolean;onOpenChange:(open:boolean)=>void;subscriptionId?:string;subscriptionName?:string;items:Subscription[];onChanged:()=>void;onRenew:(item:Subscription)=>void};
export function HistoryDialog({today,open,onOpenChange,subscriptionId,subscriptionName,items,onChanged,onRenew}: Props) {
  const [logs,setLogs]=useState<RenewalLog[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [billingFacts,setBillingFacts]=useState<BillingFact[]>([]);
  const [revision,setRevision]=useState(0),[filter,setFilter]=useState(subscriptionId ?? "");
  const [form,setForm]=useState<RenewalLog|null>(null),[target,setTarget]=useState<RenewalLog|null>(null),[busy,setBusy]=useState(false);
  const [offset,setOffset]=useState(0);
  const [reconcile,setReconcile]=useState(false),[pendingLog,setPendingLog]=useState<RenewalLog|undefined>();
  useEffect(()=>{if(!open)return;let active=true;setLoading(true);setError("");void apiRequest<{logs:RenewalLog[];billingFacts?:BillingFact[]}>("/payments").then(data=>{if(active){setLogs(data.logs);setBillingFacts(data.billingFacts??[]);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[open,revision]);
  useEffect(()=>{if(!open||form||reconcile)return;const refresh=()=>{if(document.visibilityState==="visible")setRevision(n=>n+1);};const timer=window.setInterval(refresh,60_000);document.addEventListener("visibilitychange",refresh);return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};},[open,form,reconcile]);
  useEffect(()=>{if(open){setFilter(subscriptionId ?? "");setForm(null);}},[open,subscriptionId]);
  useEffect(()=>setOffset(0),[filter]);
  const pendingIds=new Set(pendingRenewals(logs,today,billingFacts).map(log=>log.id));
  const shown=logs.filter(log=>paymentState(log)!=="void"&&(paymentState(log)!=="pending"||pendingIds.has(log.id))&&(!filter||log.subscriptionId===filter)).sort((a,b)=>(b.payment?.paidOn ?? b.newStartDate).localeCompare(a.payment?.paidOn ?? a.newStartDate)||b.createdAt.localeCompare(a.createdAt));
  useEffect(()=>setOffset(current=>Math.min(current,Math.max(0,Math.ceil(shown.length/30)-1)*30)),[shown.length]);
  const paid=shown.filter(log=>paymentState(log)==="paid");
  const pendingRates=paid.filter(log=>paymentCny(log.payment!)===null).length;
  const knownTotal=paid.reduce((sum,log)=>sum+(paymentCny(log.payment!)??0),0);
  const item=items.find(item=>item.id===filter);
  const choices=new Map(items.map(item=>[item.id,item.name+(item.plan?` · ${item.plan}`:"")]));
  for(const log of logs)if(!choices.has(log.subscriptionId))choices.set(log.subscriptionId,log.subscriptionName+"（已删除）");
  function done(){setForm(null);setRevision(n=>n+1);onChanged();toast.success("付款记录已保存");}
  async function act(){if(!target||busy)return;setBusy(true);try{await apiRequest("/payments/void",{id:target.id});setTarget(null);setRevision(n=>n+1);onChanged();toast.success("付款记录已删除");}catch(e){toast.error(e instanceof Error?e.message:"删除失败，请重试");}finally{setBusy(false);}}
  return <><Dialog open={open} onOpenChange={value=>{if(!busy)onOpenChange(value);}}><DialogContent className="membership-dialog history-dialog ledger-dialog simple-history-dialog" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}>
    <CompactDialogHeader title={subscriptionName?`${subscriptionName} · 续费记录`:"续费记录"} helpLabel="续费记录说明" help="每次续费各自保存实付金额、币种、付款日期和有效期。提前续费会在已有到期日后增加一期。外币按实际付款日参考汇率折算。删除付款只移除这次付款记录，不修改会员有效期；撤销续费则会恢复续费前的有效期。" />
    {form ? <PaymentForm today={today} target={form} onDone={done} onCancel={()=>setForm(null)} onBusyChange={setBusy} /> : <>
      <div className="renewal-history-toolbar"><label className="form-field"><span className="sr-only">筛选订阅</span><select aria-label="筛选订阅" value={filter} onChange={event=>setFilter(event.target.value)}><option value="">全部订阅</option>{[...choices].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><button type="button" className="button light" onClick={()=>{setPendingLog(undefined);setReconcile(true);}}>待核对付款</button>{item&&!item.autoRenew&&<button type="button" className="button primary" onClick={()=>onRenew(item)}><Plus size={16}/>记录续费</button>}</div>
      {!loading&&!error&&paid.length>0&&<div className="renewal-history-summary"><span>{paid.length} 次已付款</span><strong>{pendingRates===paid.length?"汇率待补":money(knownTotal)}</strong><small>{pendingRates?`${pendingRates} 笔外币折算待补` : "外币为参考折算"}</small></div>}
      {loading?<p className="muted">读取中…</p>:error?<p className="sync-banner" role="alert">{error}<button className="text-action" onClick={()=>setRevision(n=>n+1)}>重试</button></p>:!shown.length?<div className="ledger-empty">还没有续费记录。付款后点击“记录续费”，就能把新一期接在现有到期日之后。</div>:<div className="ledger-list">{shown.slice(offset,offset+30).map(log=>{
        const state=paymentState(log),p=log.payment;
        const start=p?.startDate ?? log.newStartDate,end=p?.endDate ?? log.newEndDate;
        const period=start>today?"待生效":end<today?"已结束":end===today?"今日到期":"使用中";
        return <article className="ledger-row" aria-label={`${log.subscriptionName}续费记录`} key={log.id}>
          <div className="ledger-row-main"><div><strong>{log.subscriptionName}{p?.plan&&<span className="renewal-plan"> · {p.plan}</span>}</strong><small>{p?`${p.paidOn} 付款`:"自动顺延 · 尚未记录付款"}</small></div><div className="ledger-row-money"><strong>{p||log.amount!==null?money(p?.amount ?? log.amount!,p?.currency ?? log.currency):"金额未记录"}</strong><span className={`payment-badge ${state}`}>{state==="paid"?"已支付":state==="pending"?"待确认付款":"已撤销 / 作废"}</span></div></div>
          <div className="ledger-row-bottom"><span className="renewal-service-period"><b>{period}</b>{start} — {end}</span><div>{state==="pending"&&<button className="text-action" onClick={()=>{setPendingLog(log);setReconcile(true);}}>{log.periods>1?"逐期核对付款":"记录已付款"}</button>}{state==="paid"&&<button className="text-action" onClick={()=>setForm(log)}>修改付款</button>}</div></div>
          <details className="ledger-detail"><summary>更多信息</summary>{p?<><p>{p.rate===null?"原币付款已保存，汇率稍后自动补齐。":p.currency==="CNY"?`实付 ${money(p.amount,"CNY")}`:`折合约 ${money(paymentCny(p)!)} · 1 ${p.currency} = ¥${p.rate} · 报价 ${p.rateDate}`}</p>{p.note&&<p>{p.note}</p>}{p.dateCorrections?.map((correction,n)=><p key={`date-${n}`}>付款日期 {correction.from} → {correction.to}</p>)}{p.corrections?.map((correction,n)=><p key={`edit-${n}`}>修改前：{money(correction.previous.amount,correction.previous.currency)} · {correction.previous.paidOn} 付款{correction.previous.note&&` · ${correction.previous.note}`}</p>)}</>:<p>这条记录只更新了有效期，尚未记录实际付款。{log.periods>1?`跨过了 ${log.periods} 期。`:""}</p>}<p>记录于 {formatDateTime(log.createdAt)}</p><div className="ledger-secondary-actions">{state==="paid"&&<button className="text-danger" onClick={()=>setTarget(log)}>删除付款</button>}</div></details>
        </article>;
      })}</div>}
      {shown.length>30&&<div className="history-pagination"><button className="button light" disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-30))}>上一页</button><span>{offset+1}–{Math.min(offset+30,shown.length)} / {shown.length}</span><button className="button light" disabled={offset+30>=shown.length} onClick={()=>setOffset(n=>n+30)}>下一页</button></div>}
    </>}
  </DialogContent></Dialog><AlertDialog open={Boolean(target)} onOpenChange={value=>{if(!value&&!busy)setTarget(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这笔付款记录？</AlertDialogTitle><AlertDialogDescription>“{target?.subscriptionName}”的这次付款将被删除，并从支出统计中排除。会员有效期保持现状，删除后不能在页面内恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={event=>{event.preventDefault();void act();}}>{busy?"删除中…":"确认删除"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>{reconcile&&<ReconciliationDialog open onClose={()=>setReconcile(false)} onChanged={()=>{setRevision(n=>n+1);onChanged();}} today={today} pendingLog={pendingLog} subscriptionId={filter||undefined} />}</>;
}
