import { useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import { currencyCatalog, type CurrencyCode, type HistoricalRate } from "../../../shared/currency.ts";
import { ContextHelp } from "@/components/context-help";
export type CurrencyDraft = {
  currency: CurrencyCode; purchaseDate: string; fxRateToCny: string; fxRateDate: string; fxRateSource: "manual" | "frankfurter";
};

/** Edit a purchase-date snapshot. Lookup failures never silently substitute a current or guessed rate. */
export function CurrencyFields({ value, onChange }: { value: CurrencyDraft; onChange: (patch: Partial<CurrencyDraft>) => void }) {
  const sequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => { ++sequence.current; }, []);
  useEffect(() => { setBusy(false); setError(""); return () => { ++sequence.current; }; }, [value.currency, value.purchaseDate]);
  function invalidate() { ++sequence.current; setBusy(false); setError(""); }
  function reset(currency: CurrencyCode, purchaseDate: string) {
    invalidate();
    onChange({ currency, purchaseDate, fxRateToCny: currency === "CNY" ? "1" : "", fxRateDate: purchaseDate, fxRateSource: "manual" });
  }
  async function lookup() {
    const id = ++sequence.current;
    setBusy(true); setError("");
    try {
      const query = new URLSearchParams({ currency: value.currency, date: value.purchaseDate });
      const result = await apiRequest<HistoricalRate>("/exchange-rate?" + query);
      if (id !== sequence.current) return;
      onChange({ fxRateToCny: String(result.rate), fxRateDate: result.rateDate, fxRateSource: result.source });
    } catch (reason) {
      if (id === sequence.current) setError(reason instanceof Error ? reason.message : "汇率查询失败，请按账单手动填写。");
    } finally { if (id === sequence.current) setBusy(false); }
  }
  return <>
    <label className="form-field"><span>付款币种</span><select value={value.currency} onChange={event => reset(event.target.value as CurrencyCode, value.purchaseDate)}>{currencyCatalog.map(item => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>
    <label className="form-field"><span>购买日期（汇率基准）</span><input type="date" required min="1900-01-01" max="2200-12-31" value={value.purchaseDate} onChange={event => reset(value.currency, event.target.value)} /></label>
    {value.currency !== "CNY" && <div className="fx-fields wide">
      <label className="form-field"><span>购买时汇率（1 {value.currency} = 人民币） *</span><input required type="number" min="0.00000001" max="100000" step="any" value={value.fxRateToCny} placeholder="输入实际结算汇率，或查询历史值" onChange={event => { invalidate(); onChange({ fxRateToCny: event.target.value, fxRateDate: value.purchaseDate, fxRateSource: "manual" }); }} /></label>
      <button type="button" className="button light" disabled={busy || !/^\d{4}-\d{2}-\d{2}$/.test(value.purchaseDate)} onClick={() => void lookup()}>{busy ? "查询中…" : "查询购买日汇率"}</button>
      <div className="fx-status">{value.fxRateToCny && <span>{value.fxRateSource === "frankfurter" ? "Frankfurter 历史参考" : "手动结算"} · {value.fxRateDate}</span>}<ContextHelp label="历史汇率说明">按购买日期查询，非交易日取此前报价。保存后锁定，跨年续费也不改写。可按实际账单手动填写。</ContextHelp></div>
      {error && <p className="red form-help" role="alert">{error}</p>}
    </div>}
  </>;
}
