import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CompactDialogHeader } from "@/components/context-help";
import { PaymentForm } from "@/components/payment-form";
import { apiRequest } from "@/lib/api";
import type { RenewalLog } from "../../../shared/renewals.ts";
import type { Subscription } from "@/lib/subscriptions";
import { paymentState, paymentCny } from "../../../shared/payments.ts";
import { formatDateTime } from "@/lib/dashboard-helpers";
import { money } from "../../../shared/currency.ts";

type Props = {open:boolean;onOpenChange:(open:boolean)=>void;subscriptionId?:string;subscriptionName?:string;items:Subscription[];onChanged:()=>void};
export function HistoryDialog({open,onOpenChange,subscriptionId,subscriptionName,items,onChanged}:Props) {
  const [logs,setLogs]=useState<RenewalLog[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [revision,setRevision]=useState(0),[filter,setFilter]=useState(subscriptionId??""),[month,setMonth]=useState(""),[status,setStatus]=useState("all");
  const [form,setForm]=useState<"backfill"|RenewalLog|null>(null),[target,setTarget]=useState<{log:RenewalLog;action:"delete"|"void"}|null>(null),[busy,setBusy]=useState(false);
  const [offset,setOffset]=useState(0);
  useEffect(()=>{let active=true;setLoading(true);setError("");void apiRequest<{logs:RenewalLog[]}>("/payments").then(data=>{if(active)setLogs(data.logs);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[revision]);
  useEffect(()=>setOffset(0),[filter,month,status]);
  const shown=logs.filter(log=>(!filter||log.subscriptionId===filter)&&(!month||(log.payment?.paidOn??log.newStartDate).startsWith(month))&&(status==="all"||paymentState(log)===status)).sort((a,b)=>(b.payment?.paidOn??b.newStartDate).localeCompare(a.payment?.paidOn??a.newStartDate));
  const paid=shown.filter(log=>paymentState(log)==="paid");
  const choices=new Map(items.map(i=>[i.id,i.name+(i.plan?` · ${i.plan}`:"")]));for(const log of logs)if(!choices.has(log.subscriptionId))choices.set(log.subscriptionId,log.subscriptionName+"（已删除）");
  function done(){setForm(null);setRevision(n=>n+1);onChanged();}
  async function act(){if(!target)return;setBusy(true);try{await apiRequest(target.action==="delete"?"/subscriptions/history/delete":"/payments/void",{id:target.log.id});setTarget(null);setRevision(n=>n+1);onChanged();toast.success(target.action==="delete"?"已删除撤销流水":"已作废支付记录，原始信息保留");}catch(e){toast.error(e instanceof Error?e.message:"操作失败");}finally{setBusy(false);}}
  return <><Dialog open={open} onOpenChange={value=>{if(!busy)onOpenChange(value);}}><DialogContent className="membership-dialog history-dialog ledger-dialog">
    <CompactDialogHeader title={subscriptionName?`${subscriptionName} · 续费流水`:"续费流水"} helpLabel="续费流水说明" help="账期变更、历史补录和支付确认集中在这里。已支付才计入支出；外币按各期开始日汇率折算。普通流水保留，只有已撤销的续费流水可删除。" />
    {form ? <PaymentForm items={items} initialId={typeof form==="object"?form.subscriptionId:filter||undefined} target={typeof form==="object"?form:undefined} onDone={done} onCancel={done}/> : <>
      <div className="ledger-toolbar"><label className="form-field"><span>订阅</span><select aria-label="筛选订阅" value={filter} onChange={e=>setFilter(e.target.value)}><option value="">全部订阅</option>{[...choices].map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><label className="form-field"><span>付款月份</span><input aria-label="付款月份" type="month" value={month} onChange={e=>setMonth(e.target.value)}/></label><label className="form-field"><span>状态</span><select aria-label="流水状态" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">全部状态</option><option value="paid">已支付</option><option value="pending">待确认</option><option value="void">已撤销 / 作废</option></select></label><button className="button primary" disabled={!items.length} onClick={()=>setForm("backfill")}>补录历史</button></div>
      <div className="ledger-summary"><span>已确认 {paid.length} 笔<strong>{money(paid.reduce((sum,log)=>sum+paymentCny(log.payment!),0))}</strong></span><small>仅统计已记录付款 · 外币为参考折算{month?" · 待确认记录按账期开始月份筛选":""}</small></div>
      {loading?<p className="muted">读取中…</p>:error?<p className="sync-banner" role="alert">{error}<button className="text-action" onClick={()=>setRevision(n=>n+1)}>重试</button></p>:!shown.length?<div className="ledger-empty">没有符合条件的流水。可以补录以前的续费，当前账期不会改变。</div>:<div className="ledger-list">{shown.slice(offset,offset+30).map(log=>{const state=paymentState(log),p=log.payment;return <article className="ledger-row" key={log.id}>
        <div className="ledger-row-main"><div><strong>{log.subscriptionName}</strong>{p?.plan&&<small>{p.plan}</small>}<small>{p?`付款 ${p.paidOn}`:`账期开始 ${log.newStartDate}`}</small></div><div className="ledger-row-money"><strong>{money(p?.amount??log.amount??0,p?.currency??log.currency)}</strong><span className={`payment-badge ${state}`}>{state==="paid"?"已支付":state==="pending"?"待确认":"已撤销 / 作废"}</span></div></div>
        <div className="ledger-row-bottom"><span>{p?.startDate??log.newStartDate} — {p?.endDate??log.newEndDate}</span><div>{state==="pending"&&log.periods===1&&<button className="text-action" onClick={()=>setForm(log)}>确认付款</button>}{state==="paid"&&<button className="text-action" onClick={()=>setTarget({log,action:"void"})}>作废</button>}{log.undoneAt&&<button className="text-danger history-delete" aria-label={`删除${log.subscriptionName}的已撤销流水`} onClick={()=>setTarget({log,action:"delete"})}>删除</button>}</div></div>
        <details className="ledger-detail"><summary>查看详情</summary><p>{p?.source==="backfill"?"历史补录":log.kind==="automatic"?"自动顺延":"手动续费"} · 记录于 {formatDateTime(log.createdAt)}</p>{p?<><p>折合约 {money(paymentCny(p))} · 1 {p.currency} = ¥{p.rate} · 报价 {p.rateDate}</p>{p.note&&<p>{p.note}</p>}{p.voidedAt&&<p>作废于 {formatDateTime(p.voidedAt)}，已从统计中排除。</p>}</>:<p>这里只记录过账期变化，尚未确认付款。{log.periods>1?`包含 ${log.periods} 个周期，请用补录历史逐期记录实际付款。`:""}</p>}{p?.source!=="backfill"&&<p>原账期 {log.previousStartDate} — {log.previousEndDate}<br/>变更为 {log.newStartDate} — {log.newEndDate}</p>}</details>
      </article>;})}</div>}
      {shown.length>30&&<div className="history-pagination"><button className="button light" disabled={!offset} onClick={()=>setOffset(n=>Math.max(0,n-30))}>上一页</button><span>{offset+1}–{Math.min(offset+30,shown.length)} / {shown.length}</span><button className="button light" disabled={offset+30>=shown.length} onClick={()=>setOffset(n=>n+30)}>下一页</button></div>}
    </>}
  </DialogContent></Dialog><AlertDialog open={Boolean(target)} onOpenChange={v=>{if(!v&&!busy)setTarget(null);}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{target?.action==="delete"?"删除这条撤销流水？":"作废这笔支付？"}</AlertDialogTitle><AlertDialogDescription>{target?.action==="delete"?"只删除已撤销的流水，不改变当前账期。删除后不能恢复。":"原始金额和记录会保留，但不再计入已支付统计。不会改变订阅账期，也不会向服务商申请退款。"}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>取消</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={e=>{e.preventDefault();void act();}}>{busy?"处理中…":target?.action==="delete"?"确认删除":"确认作废"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>;
}
