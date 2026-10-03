import { z } from "zod";
import { currencyCodes, type HistoricalRate } from "../../shared/currency.ts";
import { dateSchema } from "./validation.ts";
import { ApiError } from "./errors.ts";

export const rateQuerySchema = z.object({ currency: z.enum(currencyCodes), date: dateSchema }).strict();
const responseSchema = z.object({ date: dateSchema, base: z.string(), quote: z.string(), rate: z.number().finite().positive().max(100_000) });

/** Authenticated, bounded historical lookup. Never falls back to today's rate or a guessed value. */
export class ExchangeRates {
  private cache = new Map<string, { value: HistoricalRate; expires: number }>();
  private pending = new Map<string, Promise<HistoricalRate>>();
  private fetcher: typeof fetch;
  constructor(fetcher: typeof fetch = fetch) { this.fetcher = fetcher; }

  async lookup(input: unknown): Promise<HistoricalRate> {
    const { currency, date } = rateQuerySchema.parse(input);
    if (date > new Date().toISOString().slice(0, 10)) throw new ApiError(400, "未来日期尚无历史汇率，请改用实际结算汇率。");
    if (currency === "CNY") return { currency, requestedDate: date, rateDate: date, rate: 1, source: "manual" };
    const key = currency + ":" + date;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    if (this.pending.has(key)) return this.pending.get(key)!;
    if (this.pending.size >= 4) throw new ApiError(429, "汇率查询繁忙，请稍后重试或手动填写。", "FX_BUSY", 5);
    const work = this.request(currency, date).then(value => {
      if (this.cache.size >= 256) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { value, expires: Date.now() + 86_400_000 });
      return value;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, work);
    return work;
  }

  private async request(currency: HistoricalRate["currency"], date: string): Promise<HistoricalRate> {
    try {
      const url = new URL("https://api.frankfurter.dev/v2/rate/" + currency.toLowerCase() + "/cny");
      url.searchParams.set("date", date);
      const response = await this.fetcher(url, { signal: AbortSignal.timeout(8000), redirect: "error", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Historical provider unavailable");
      const body = await response.text();
      if (body.length > 10_000) throw new Error("Unexpected rate response size");
      const result = responseSchema.parse(JSON.parse(body));
      const age = (Date.parse(date) - Date.parse(result.date)) / 86_400_000;
      if (result.base.toUpperCase() !== currency || result.quote.toUpperCase() !== "CNY" || age < 0 || age > 14) throw new Error("Mismatched historical rate");
      return { currency, requestedDate: date, rateDate: result.date, rate: result.rate, source: "frankfurter" };
    } catch {
      throw new ApiError(502, "未获取到该购买日期的历史汇率。请稍后重试，或按账单手动填写；不会改用今天的汇率。", "FX_UNAVAILABLE");
    }
  }
}
