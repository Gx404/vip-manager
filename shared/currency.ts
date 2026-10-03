/** Original billing currencies. No live or guessed exchange rates are bundled. */
export const currencyCatalog = [
  { code: "CNY", label: "人民币", symbol: "¥" },
  { code: "USD", label: "美元", symbol: "US$" },
  { code: "EUR", label: "欧元", symbol: "€" },
  { code: "JPY", label: "日元", symbol: "JP¥" },
  { code: "GBP", label: "英镑", symbol: "£" },
  { code: "HKD", label: "港币", symbol: "HK$" },
  { code: "TWD", label: "新台币", symbol: "NT$" },
  { code: "KRW", label: "韩元", symbol: "₩" },
  { code: "SGD", label: "新加坡元", symbol: "S$" },
  { code: "AUD", label: "澳元", symbol: "A$" },
  { code: "CAD", label: "加元", symbol: "CA$" },
  { code: "CHF", label: "瑞士法郎", symbol: "CHF " },
  { code: "MYR", label: "马来西亚林吉特", symbol: "RM " },
  { code: "THB", label: "泰铢", symbol: "฿" },
  { code: "INR", label: "印度卢比", symbol: "₹" },
  { code: "TRY", label: "土耳其里拉", symbol: "₺" },
  { code: "ARS", label: "阿根廷比索", symbol: "ARS " },
  { code: "BRL", label: "巴西雷亚尔", symbol: "R$" },
  { code: "PHP", label: "菲律宾比索", symbol: "₱" },
  { code: "IDR", label: "印尼盾", symbol: "Rp " },
  { code: "VND", label: "越南盾", symbol: "₫" },
  { code: "RUB", label: "俄罗斯卢布", symbol: "₽" },
  { code: "AED", label: "阿联酋迪拉姆", symbol: "AED " },
  { code: "SAR", label: "沙特里亚尔", symbol: "SAR " },
  { code: "NZD", label: "新西兰元", symbol: "NZ$" },
  { code: "SEK", label: "瑞典克朗", symbol: "SEK " },
  { code: "NOK", label: "挪威克朗", symbol: "NOK " },
  { code: "DKK", label: "丹麦克朗", symbol: "DKK " },
  { code: "PLN", label: "波兰兹罗提", symbol: "PLN " },
  { code: "MXN", label: "墨西哥比索", symbol: "MX$" },
] as const;
export type CurrencyCode = typeof currencyCatalog[number]["code"];
export const currencyCodes = currencyCatalog.map(item => item.code) as [CurrencyCode, ...CurrencyCode[]];
/** Optional only for legacy CNY backups; every persisted record has a complete snapshot. */
export type CurrencySnapshot = {
  currency?: CurrencyCode; purchaseDate?: string; fxRateToCny?: number;
  fxRateDate?: string; fxRateSource?: "manual" | "frankfurter";
};
export type HistoricalRate = { currency: CurrencyCode; requestedDate: string; rateDate: string; rate: number; source: "frankfurter" | "manual" };

/** Resolve the original currency; old backups without metadata are RMB. */
export function currencyMeta(code: CurrencyCode = "CNY") {
  return currencyCatalog.find(item => item.code === code)!;
}
/** Keep two decimal places, including fractional JPY/KRW values from invoices. */
export function formatCurrency(amount: number, _code?: CurrencyCode): string {
  return amount.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/** Display an amount with an unambiguous source-currency symbol. */
export function money(amount: number, code: CurrencyCode = "CNY"): string {
  return currencyMeta(code).symbol + formatCurrency(amount);
}
/** Convert with the saved purchase-date snapshot, never a rate from today's query. */
export function amountInCny(amount: number, rate: number = 1): number {
  return amount * rate;
}
