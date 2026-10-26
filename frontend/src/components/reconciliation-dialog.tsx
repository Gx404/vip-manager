import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CompactDialogHeader } from "@/components/context-help";
import { RenewalPaymentFields } from "@/components/renewal-payment-fields";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/api";
import { money } from "../../../shared/currency.ts";
import type { ReconciliationPeriod, RenewalPaymentInput } from "../../../shared/payments.ts";
import type { RenewalLog } from "../../../shared/renewals.ts";

type Props = {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  today: string;
  pendingLog?: RenewalLog;
  subscriptionId?: string;
};

/** Known service periods are suggestions until the user records an actual payment. */
export function ReconciliationDialog({open,onClose,onChanged,today,pendingLog,subscriptionId}: Props) {
  const [periods,setPeriods] = useState<ReconciliationPeriod[]>([]);
  const [loading,setLoading] = useState(true), [error,setError] = useState("");
  const [revision,setRevision] = useState(0), [offset,setOffset] = useState(0);
  const [target,setTarget] = useState<ReconciliationPeriod|null>(null);
  const [busy,setBusy] = useState(false);
  const busyRef = useRef(false), context = useRef(0);
  const logId = pendingLog?.id;
  const formContext = context.current;

  useEffect(() => {
    context.current++;
    setTarget(null); setOffset(0); setPeriods([]); setError("");
    busyRef.current=false; setBusy(false);
    return () => { context.current++; };
  }, [open,logId,subscriptionId]);

  useEffect(() => {
    if (!open) return;
    let active=true;
    setLoading(true); setError("");
    const path=logId ? `/payments/pending-periods?id=${encodeURIComponent(logId)}` : "/payments/reconciliation";
    void apiRequest<{periods:ReconciliationPeriod[]}>(path)
      .then(data => { if (active) setPeriods(data.periods.filter(period => !subscriptionId || period.subscriptionId===subscriptionId)); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "暂时无法读取待核对账期。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active=false; };
  }, [open,logId,subscriptionId,revision]);

  useEffect(() => setOffset(current => Math.min(current,Math.max(0,Math.ceil(periods.length/30)-1)*30)), [periods.length]);

  async function save(entry: RenewalPaymentInput) {
    if (!target) return;
    const generation=context.current, period=target;
    const result=await apiRequest<{added:number;skipped:number}>("/payments/backfill",{
      subscriptionId:period.subscriptionId,
      entries:[{...entry,startDate:period.startDate,endDate:period.endDate}],
    });
    if (context.current!==generation) return;
    setTarget(null); setRevision(value => value+1);
    onChanged();
    if (result.added) toast.success("已登记这期实际付款");
    else toast.info("这期付款已经记录，请以最新记录为准");
  }

  return <Dialog open={open} onOpenChange={value => {if (!value && !busyRef.current) onClose();}}>
    <DialogContent className="membership-dialog history-dialog ledger-dialog simple-history-dialog" showCloseButton={!busy}
      onEscapeKeyDown={event => {if (busyRef.current) event.preventDefault();}}
      onPointerDownOutside={event => {if (busyRef.current) event.preventDefault();}}>
      <CompactDialogHeader title={pendingLog ? `${pendingLog.subscriptionName} · 逐期核对付款` : "待核对付款"}
        help="这里列出已知有效期内尚未确认付款的账期，金额和日期只供核对，不会自动计入支出。确实付款后，按实际金额和付款日期逐期登记；不确定的可以暂时保留。登记付款不会修改会员有效期。" />
      {target ? <section className="payment-form" aria-label="核对历史付款">
        <h3 className="payment-form-title">{target.subscriptionName}{target.plan ? ` · ${target.plan}` : ""} · 登记已付款</h3>
        <RenewalPaymentFields key={`${target.subscriptionId}:${target.startDate}:${target.endDate}`} today={today}
          initial={{amount:target.amount,currency:target.currency,paidOn:target.paidOn>today ? today : target.paidOn,note:""}}
          startDate={target.startDate} endDate={target.endDate} submitLabel="保存这期已付款"
          hint="确认这期确实已付款，再填写实际金额和付款日期。保存后才计入支出。"
          onSave={save} onCancel={() => setTarget(null)} onBusyChange={value => {if (context.current===formContext) {busyRef.current=value;setBusy(value);}}} />
      </section> : <>
        <p className="renewal-hint">这些账期尚未确认付款，不计入支出。请按实际付款逐期核对。</p>
        {loading ? <p className="muted">读取中…</p> : error ? <p className="sync-banner" role="alert">{error}<button type="button" className="text-action" onClick={() => setRevision(value => value+1)}>重试</button></p>
          : periods.length===0 ? <div className="ledger-empty">没有尚待核对的已知账期。已登记的付款可在续费记录中查看。</div>
          : <div className="ledger-list">{periods.slice(offset,offset+30).map(period => <article className="ledger-row" key={`${period.subscriptionId}:${period.startDate}:${period.endDate}`} aria-label={`${period.subscriptionName}待核对账期`}>
            <div className="ledger-row-main"><div><strong>{period.subscriptionName}{period.plan && <span className="renewal-plan"> · {period.plan}</span>}</strong><small>待核对 · 尚未计入支出</small></div>
              <div className="ledger-row-money"><strong>{money(period.amount,period.currency)}</strong><small>参考金额</small></div></div>
            <div className="ledger-row-bottom"><span className="renewal-service-period">{period.startDate} — {period.endDate}</span><button type="button" className="text-action" onClick={() => setTarget(period)}>登记已付款</button></div>
          </article>)}</div>}
        {!loading && !error && periods.length>30 && <div className="history-pagination"><button type="button" className="button light" disabled={!offset} onClick={() => setOffset(value => Math.max(0,value-30))}>上一页</button><span>{offset+1}–{Math.min(offset+30,periods.length)} / {periods.length}</span><button type="button" className="button light" disabled={offset+30>=periods.length} onClick={() => setOffset(value => value+30)}>下一页</button></div>}
      </>}
    </DialogContent>
  </Dialog>;
}
