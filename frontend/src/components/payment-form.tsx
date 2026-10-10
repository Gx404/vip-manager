import { useState } from "react";
import { apiRequest } from "@/lib/api";
import { cycles, dateKey, type Subscription } from "@/lib/subscriptions";
import { cycleBoundary } from "../../../shared/billing.ts";
import { currencyCatalog, money, type CurrencyCode } from "../../../shared/currency.ts";
import type { PaymentInput, PaymentPreview } from "../../../shared/payments.ts";
import type { RenewalLog } from "../../../shared/renewals.ts";

export function PaymentForm({items,initialId,target,onDone,onCancel}:{items:Subscription[];initialId?:string;target?:RenewalLog;onDone:()=>void;onCancel:()=>void}) {
  const [id,setId]=useState(initialId ?? items[0]?.id ?? ""), [start,setStart]=useState(target?.newStartDate ?? items.find(i=>i.id===initialId)?.startDate ?? dateKey());
  const item=items.find(i=>i.id===id);
  const [count,setCount]=useState(1),[amount,setAmount]=useState(String(target?.amount ?? item?.amount ?? 0));
  const [currency,setCurrency]=useState<CurrencyCode>(target?.currency ?? item?.currency ?? "CNY");
  const [entries,setEntries]=useState<PaymentInput[]>(target ? [{amount:target.amount ?? 0,currency:target.currency ?? "CNY",paidOn:dateKey(),startDate:target.newStartDate,endDate:target.newEndDate,note:""}] : []);
  const [preview,setPreview]=useState<PaymentPreview[] | null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [result,setResult]=useState("");
  function generate() {
    setError("");setPreview(null);
    try {
      if (!item || !start || !Number.isInteger(count) || count<1 || count>36 || !Number.isFinite(Number(amount)) || Number(amount)<0) throw new Error("请填写有效日期、费用和期数（1–36 期）。");
      const generated=Array.from({length:count},(_,n)=>({startDate:cycleBoundary(start,item.cycle,item.customDays,n),endDate:cycleBoundary(start,item.cycle,item.customDays,n+1),paidOn:cycleBoundary(start,item.cycle,item.customDays,n),amount:Number(amount),currency,note:""}));
      if(generated.some(e=>e.endDate>"2200-12-31")) throw new Error("日期超出范围。");
      setEntries(generated);
    } catch(reason) {setError(reason instanceof Error ? reason.message : "生成失败。");}
  }
  function change(n:number,patch:Partial<PaymentInput>) {setEntries(rows=>rows.map((r,i)=>i===n?{...r,...patch}:r));setPreview(null);setError("");}
  async function submit(save:boolean) {
    setBusy(true);setError("");
    try {
      if(target) {await apiRequest("/payments/confirm",{id:target.id,entry:entries[0]});onDone();return;}
      const payload={subscriptionId:id,entries};
      if(!save) {const data=await apiRequest<{entries:PaymentPreview[]}>("/payments/preview",payload);setPreview(data.entries);}
      else {const data=await apiRequest<{added:number;skipped:number}>("/payments/backfill",payload);setResult(`已补录 ${data.added} 笔，跳过 ${data.skipped} 笔重复账期。`);setEntries([]);setPreview(null);}
    } catch(reason) {setError(reason instanceof Error?reason.message:"保存失败，请重试。");}
    finally {setBusy(false);}
  }
  return <section className="payment-form" aria-label={target?"确认支付":"补录历史"}>
    <div className="ledger-subheading"><h3>{target?`确认 ${target.subscriptionName} 的付款`:"补录历史"}</h3><button className="button light" disabled={busy} onClick={result?onDone:onCancel}>{result?"完成":"返回流水"}</button></div>
    <p className="muted">{target?"请按实际账单确认。确认付款不改变当前订阅账期。":"选择起始账期，生成后逐笔核对。历史补录不改变当前到期日期。"}</p>
    {!target && !result && <div className="form-grid">
      <label className="form-field wide"><span>订阅</span><select aria-label="订阅" disabled={busy} value={id} onChange={e=>{const next=items.find(i=>i.id===e.target.value)!;setId(next.id);setAmount(String(next.amount));setCurrency(next.currency??"CNY");setStart(next.startDate);setEntries([]);setPreview(null);}}>{items.map(i=><option key={i.id} value={i.id}>{i.name}{i.plan?` · ${i.plan}`:""}</option>)}</select></label>
      <label className="form-field"><span>首期开始日期</span><input type="date" min="1900-01-01" max={dateKey()} value={start} onChange={e=>{setStart(e.target.value);setEntries([]);setPreview(null);}} /></label>
      <label className="form-field"><span>补录期数 · {item?cycles[item.cycle]:""}</span><input type="number" min={1} max={36} value={count} onChange={e=>{setCount(Number(e.target.value));setEntries([]);setPreview(null);}} /></label>
      <label className="form-field"><span>每期费用</span><input type="number" min={0} step="0.01" value={amount} onChange={e=>{setAmount(e.target.value);setEntries([]);setPreview(null);}} /></label>
      <label className="form-field"><span>付款币种</span><select value={currency} onChange={e=>{setCurrency(e.target.value as CurrencyCode);setEntries([]);setPreview(null);}}>{currencyCatalog.map(c=><option key={c.code} value={c.code}>{c.code} · {c.label}</option>)}</select></label>
      <button disabled={busy||!item} className="button light wide" onClick={generate}>生成逐期明细</button>
    </div>}
    <fieldset disabled={busy} className="payment-entries">{entries.map((entry,n)=><div key={n} className="payment-entry">
      <div className="ledger-subheading"><strong>第 {n+1} 笔 · {entry.currency}</strong>{!target&&<button className="text-action" onClick={()=>{setEntries(rows=>rows.filter((_,i)=>i!==n));setPreview(null);}}>移除此笔</button>}</div>
      <div className="form-grid">
        <label className="form-field"><span>账期开始</span><input type="date" disabled={Boolean(target)} value={entry.startDate} onChange={e=>change(n,{startDate:e.target.value})}/></label>
        <label className="form-field"><span>账期结束</span><input type="date" disabled={Boolean(target)} value={entry.endDate} onChange={e=>change(n,{endDate:e.target.value})}/></label>
        <label className="form-field"><span>付款日期</span><input type="date" max={dateKey()} value={entry.paidOn} onChange={e=>change(n,{paidOn:e.target.value})}/></label>
        <label className="form-field"><span>费用</span><input type="number" min={0} step="0.01" value={entry.amount} onChange={e=>change(n,{amount:Number(e.target.value)})}/></label>
        <label className="form-field wide"><span>备注</span><input maxLength={500} value={entry.note} onChange={e=>change(n,{note:e.target.value})}/></label>
      </div>
      {preview?.[n] && <p className={preview[n].duplicate?"amber":"muted"}>{preview[n].duplicate ? "已有相同或重叠账期，保存时将跳过。可返回流水确认已有记录。" : `${money(entry.amount,entry.currency)} · 折合约 ${money(entry.amount*preview[n].rate)}（${preview[n].rateDate} 汇率）`}</p>}
    </div>)}</fieldset>
    {error&&<p role="alert" className="sync-banner">{error}</p>}
    {result&&<p role="status" className="ledger-notice">{result}</p>}
    {entries.length>0&&<div className="payment-submit"><small className="muted">汇率按各期开始日自动获取；只有确认已支付的记录计入支出。{target&&entries[0].currency!=="CNY"?"人民币金额为历史汇率折算。":""}</small><button className="button primary" disabled={busy||Boolean(preview?.every(p=>p.duplicate))} onClick={()=>void submit(Boolean(preview))}>{busy?"处理中…":target?"确认已支付":preview?"确认补录已支付记录":"预览金额与重复账期"}</button></div>}
  </section>;
}

