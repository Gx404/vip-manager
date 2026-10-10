import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { currencyCatalog, type CurrencyCode, type HistoricalRate } from "../../../shared/currency.ts";
export type CurrencyDraft = {
  currency: CurrencyCode; purchaseDate: string; fxRateToCny: string; fxRateDate: string; fxRateSource: "manual" | "frankfurter"; ratePending?: boolean;
};
export function CurrencyFields({ value, startDate, onChange }: { value: CurrencyDraft; startDate: string; onChange: (patch: Partial<CurrencyDraft>) => void }) {
  const update = useRef(onChange); update.current = onChange;
  const [busy,setBusy] = useState(false), [error,setError] = useState(""), [retry,setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    if (value.currency === "CNY") { update.current({purchaseDate:startDate,fxRateToCny:"1",fxRateDate:startDate,fxRateSource:"manual",ratePending:false}); setBusy(false); return; }
    setBusy(true);
    update.current({purchaseDate:startDate,fxRateToCny:"",fxRateDate:startDate,fxRateSource:"manual",ratePending:true});
    const timer = window.setTimeout(() => {
      void apiRequest<HistoricalRate>("/exchange-rate?" + new URLSearchParams({currency:value.currency,date:startDate})).then(fx => {
        if (active) update.current({purchaseDate:startDate,fxRateToCny:String(fx.rate),fxRateDate:fx.rateDate,fxRateSource:fx.source,ratePending:false});
      }).catch(reason => { if(active) setError(reason instanceof Error ? reason.message : "汇率待补全，稍后自动重试。"); }).finally(() => {if(active) setBusy(false);});
    },300);
    return () => {active=false; window.clearTimeout(timer);};
  },[value.currency,startDate,retry]);
  return <>
    <label className="form-field"><span>付款币种</span><select value={value.currency} onChange={event => onChange({currency:event.target.value as CurrencyCode})}>{currencyCatalog.map(item => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>
    {value.currency !== "CNY" && <div className="auto-fx wide" role="status">{busy ? "正在获取本期开始日汇率…" : error ? <><span>{error} 未补全前不计入人民币估算。</span><button type="button" className="text-action" onClick={()=>setRetry(n=>n+1)}>重试</button></> : <span>参考汇率：1 {value.currency} ≈ ¥{value.fxRateToCny} · 按本期开始日自动获取（报价 {value.fxRateDate}）</span>}</div>}
  </>;
}
