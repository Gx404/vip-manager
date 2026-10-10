import { z } from "zod";
import { categories, normalizeCategory } from "../../shared/subscriptions.ts";
import { currencyCodes, type CurrencySnapshot } from "../../shared/currency.ts";
import { ApiError } from "./errors.ts";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  if (value < "1900-01-01" || value > "2200-12-31") return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}, "请选择有效日期（1900–2200 年）。");
export const idSchema = z.string().uuid("记录标识不正确。");
export const currencyFields = {
  currency: z.enum(currencyCodes).default("CNY"),
  purchaseDate: dateSchema.optional(),
  fxRateToCny: z.number().finite().positive().max(100_000).optional(),
  fxRateDate: dateSchema.optional(),
  fxRateSource: z.enum(["manual", "frankfurter"]).optional(),
};
/** Foreign amounts require a complete dated snapshot; legacy CNY needs no conversion. */
export function validCurrency(item: CurrencySnapshot): boolean {
  if (!item.currency || item.currency === "CNY") return item.fxRateToCny === undefined || item.fxRateToCny === 1;
  return Boolean(item.purchaseDate && item.fxRateDate && item.fxRateToCny && item.fxRateSource && item.fxRateDate <= item.purchaseDate);
}
/** Upgrade the deployed v4 API/backup shape without converting its already-converted CNY amount twice. */
export function migrateLegacyCurrency(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const input = value as Record<string, unknown>;
  const keys = ["billingAmount", "billingCurrency", "exchangeRate", "exchangeRateDate"];
  if (!keys.some(key => key in input)) return input;
  if (["currency", "purchaseDate", "fxRateToCny", "fxRateDate", "fxRateSource"].some(key => key in input)) throw new ApiError(400, "备份包含两种冲突的币种格式。");
  const old = z.object({
    billingAmount: z.number().finite().min(0).max(10_000_000).optional(),
    billingCurrency: z.enum(currencyCodes).default("CNY"),
    exchangeRate: z.number().finite().positive().max(100_000).optional(),
    exchangeRateDate: dateSchema.optional(), startDate: dateSchema,
  }).passthrough().parse(input);
  if (old.billingCurrency !== "CNY" && (old.billingAmount === undefined || old.exchangeRate === undefined)) throw new ApiError(400, "旧外币记录缺少原币金额或汇率。");
  const { billingAmount, billingCurrency, exchangeRate, exchangeRateDate, ...rest } = old;
  const rateDate = exchangeRateDate ?? old.startDate;
  return { ...rest, amount: billingAmount ?? rest.amount, currency: billingCurrency,
    purchaseDate: rateDate > old.startDate ? rateDate : old.startDate,
    fxRateToCny: billingCurrency === "CNY" ? 1 : exchangeRate, fxRateDate: rateDate, fxRateSource: "manual" };
}
export const subscriptionObject = z.object({
  ratePending: z.boolean().optional(),
  coverageStartDate: dateSchema.optional(),
  id: idSchema,
  name: z.string().trim().min(1,"请填写会员名称。").max(60),
  plan: z.string().trim().max(80),
  category: z.preprocess(normalizeCategory, z.enum(categories)),
  amount: z.number().finite().min(0).max(10_000_000).refine(n => Math.abs(Math.round(n * 100) - n * 100) < 0.00001, "金额最多保留两位小数。"),
  ...currencyFields,
  cycle: z.enum(["monthly","quarterly","yearly","custom"]),
  customDays: z.number().int().min(1).max(3650),
  startDate: dateSchema,
  endDate: dateSchema,
  reminderDays: z.number().int().min(0).max(365),
  autoRenew: z.boolean(),
  note: z.string().trim().max(500),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  version: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1).optional(),
}).strict();
export const validPeriod = (item: { startDate: string; endDate: string }) => item.endDate > item.startDate;
export const subscriptionSchema = z.preprocess(migrateLegacyCurrency, subscriptionObject.refine(validPeriod, "到期日期必须晚于开始日期。")
  .refine(validCurrency, "请填写购买日期和有效的历史/实际结算汇率；人民币汇率必须为 1。"));
export const actionSchema = z.object({
  action: z.enum(["create","update","delete","renew","undoRenew","initialize"]),
  id: idSchema.optional(),
  version: z.number().int().nonnegative().optional(),
  item: z.unknown().optional(),
  requestId: idSchema.optional(),
  logId: idSchema.optional(),
}).strict();
