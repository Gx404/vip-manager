import { currencyMeta, formatCurrency, type CurrencyCode } from "../../../shared/currency.ts";

/** Codes remain legible on every font and distinguish currencies that share a symbol. */
export function CurrencyAmount({ amount, currency = "CNY" }: { amount: number; currency?: CurrencyCode }) {
  const meta = currencyMeta(currency);
  const formatted = formatCurrency(amount, currency);
  return <span className="currency-amount" title={`${meta.label} · ${currency}`}>
    <span className="currency-code">{currency}</span>{" "}<strong className="currency-value">{formatted}</strong>
  </span>;
}
