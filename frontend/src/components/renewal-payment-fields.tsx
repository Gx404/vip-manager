import { useState } from "react";
import { currencyCatalog, type CurrencyCode } from "../../../shared/currency.ts";
import type { RenewalPaymentInput } from "../../../shared/payments.ts";
import { dateKey } from "@/lib/subscriptions";

type Props = {
  initial: RenewalPaymentInput;
  startDate: string;
  endDate: string;
  periodLabel?: string;
  submitLabel: string;
  hint?: string;
  onSave: (payment: RenewalPaymentInput) => Promise<void>;
  onCancel: () => void;
  onBusyChange?: (busy: boolean) => void;
};

/** One real payment, one service period, one save. */
export function RenewalPaymentFields({initial,startDate,endDate,periodLabel="对应有效期",submitLabel,hint,onSave,onCancel,onBusyChange}: Props) {
  const [amount,setAmount] = useState(String(initial.amount));
  const [currency,setCurrency] = useState<CurrencyCode>(initial.currency);
  const [paidOn,setPaidOn] = useState(initial.paidOn);
  const [note,setNote] = useState(initial.note);
  const [busy,setBusy] = useState(false), [error,setError] = useState("");

  async function save() {
    setError("");
    const value = Number(amount);
    if (!amount.trim() || !Number.isFinite(value) || value < 0 || value > 10_000_000 || Math.abs(value*100-Math.round(value*100)) > 0.00001) {
      setError("请填写有效的付款金额，最多两位小数。"); return;
    }
    if (!paidOn || paidOn > dateKey()) { setError("请选择实际付款日期，不能晚于今天。"); return; }
    setBusy(true); onBusyChange?.(true);
    try { await onSave({amount:value,currency,paidOn,note:note.trim()}); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败，请重试。"); }
    finally { setBusy(false); onBusyChange?.(false); }
  }

  return <form className="simple-renewal-form" onSubmit={event => { event.preventDefault(); void save(); }}>
    <div className="renewal-period"><span>{periodLabel}</span><strong>{startDate}<span aria-hidden="true"> — </span>{endDate}</strong></div>
    <fieldset disabled={busy} className="renewal-payment-fields">
      <div className="form-grid">
        <label className="form-field"><span>本次实付金额</span><input aria-label="本次实付金额" autoFocus required type="number" min="0" max="10000000" step="0.01" inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} /></label>
        <label className="form-field"><span>付款币种</span><select aria-label="付款币种" value={currency} onChange={event => setCurrency(event.target.value as CurrencyCode)}>{currencyCatalog.map(item => <option key={item.code} value={item.code}>{item.code} · {item.label}</option>)}</select></label>
        <label className="form-field wide"><span>实际付款日期</span><input aria-label="实际付款日期" required type="date" min="1900-01-01" max={dateKey()} value={paidOn} onChange={event => setPaidOn(event.target.value)} /></label>
      </div>
      <details className="renewal-note"><summary>添加备注（可选）</summary><label className="form-field"><span className="sr-only">付款备注</span><input aria-label="付款备注" maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="例如：一年优惠价" /></label></details>
    </fieldset>
    {hint && <p className="renewal-hint">{hint}</p>}
    {error && <p className="sync-banner" role="alert">{error}</p>}
    <div className="renewal-form-actions"><button type="button" className="button light" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="button primary" disabled={busy}>{busy ? "保存中…" : submitLabel}</button></div>
  </form>;
}
