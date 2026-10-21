import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { currencyCatalog, type CurrencyCode, type HistoricalRate } from "../../../shared/currency.ts";
export type CurrencyDraft = {
  currency: CurrencyCode; purchaseDate: string; fxRateToCny: string; fxRateDate: string; fxRateSource: "manual" | "frankfurter"; ratePending?: boolean;
};
export function CurrencyFields({ value, onChange }: { value: CurrencyDraft; onChange: (patch: Partial<CurrencyDraft>) => void }) {
  const update = useRef(onChange); update.current = onChange;
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [retry,setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const purchaseDate = value.purchaseDate;
    setError("");
    if (value.currency === "CNY") { update.current({fxRateToCny:"1",fxRateDate:purchaseDate,fxRateSource:"manual",ratePending:false}); setBusy(false); return; }
    // Opening an editor must preserve the quote already locked to its payment date.
    if (!value.ratePending && Number(value.fxRateToCny) > 0 && value.fxRateDate && value.fxRateDate <= purchaseDate) { setBusy(false); return; }
    setBusy(true);
    update.current({fxRateToCny:"",fxRateDate:purchaseDate,fxRateSource:"manual",ratePending:true});
    const timer = window.setTimeout(() => {
      void apiRequest<HistoricalRate>("/exchange-rate?" + new URLSearchParams({currency:value.currency,date:purchaseDate})).then(fx => {
        if (active) update.current({fxRateToCny:String(fx.rate),fxRateDate:fx.rateDate,fxRateSource:fx.source,ratePending:false});
      }).catch(reason => { if(active) setError(reason instanceof Error ? reason.message : "汇率待补全，稍后自动重试。"); }).finally(() => {if(active) setBusy(false);});
    },300);
    return () => {active=false; window.clearTimeout(timer);};
  },[value.currency,value.purchaseDate,retry]);
  return <>
    <label className="form-field"><span>付款币种</span><select value={value.currency} onChange={event => { const currency = event.target.value as CurrencyCode; onChange({currency,fxRateToCny:currency === "CNY" ? "1" : "",fxRateDate:value.purchaseDate,fxRateSource:"manual",ratePending:currency !== "CNY"}); }}>{currencyCatalog.map(item => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>
    {value.currency !== "CNY" && <div className="auto-fx wide" role="status">{busy ? "正在获取付款日汇率…" : error ? <><span>{error} 未补全前不计入人民币估算。</span><button type="button" className="text-action" onClick={()=>setRetry(n=>n+1)}>重试</button></> : <span>参考汇率：1 {value.currency} ≈ ¥{value.fxRateToCny} · 付款日期 {value.purchaseDate}（报价 {value.fxRateDate}）</span>}</div>}
  </>;
}
