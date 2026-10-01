import { z } from "zod";
import { categories } from "../../shared/subscriptions.ts";

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  if (value < "1900-01-01" || value > "2200-12-31") return false;
  const parsed = new Date(value + "T00:00:00Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === value;
}, "请选择有效日期（1900–2200 年）。");
export const idSchema = z.string().uuid("记录标识不正确。");
export const subscriptionObject = z.object({
  id: idSchema,
  name: z.string().trim().min(1,"请填写会员名称。").max(60),
  plan: z.string().trim().max(80),
  category: z.enum(categories),
  amount: z.number().finite().min(0).max(10_000_000).refine(n => Math.abs(Math.round(n * 100) - n * 100) < 0.00001, "金额最多保留两位小数。"),
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
export const subscriptionSchema = subscriptionObject.refine(validPeriod, "到期日期必须晚于开始日期。");
export const actionSchema = z.object({
  action: z.enum(["create","update","delete","renew","undoRenew","initialize"]),
  id: idSchema.optional(),
  version: z.number().int().nonnegative().optional(),
  item: z.unknown().optional(),
  requestId: idSchema.optional(),
  logId: idSchema.optional(),
}).strict();
