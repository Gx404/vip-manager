import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { currencyFields, dateSchema, idSchema, subscriptionObject, validCurrency, validPeriod, migrateLegacyCurrency } from "./validation.ts";
import { transaction } from "./database.ts";
import { ApiError } from "./errors.ts";
import { subscriptionFromRow } from "./subscriptions.ts";
import { renewalFromRow } from "./renewal-history.ts";
import type { BackupDocument, ImportPreview } from "../../shared/renewals.ts";
import { billingAnchor, cycleBoundary } from "../../shared/billing.ts";
import { paymentSchema } from "./payments.ts";
import { billingFacts, removeAllCanceledRenewals, saveBillingFact } from "./billing-facts.ts";
import { currencyCodes } from "../../shared/currency.ts";

const timestamp = z.string().datetime({ offset: true });
const intervalSchema=z.object({startDate:dateSchema,endDate:dateSchema}).strict().refine(value=>value.endDate>value.startDate,"账期日期不正确。");
const billingFactSchema=z.object({
  id:idSchema,subscriptionId:idSchema,requestId:idSchema.optional(),excludedPeriod:intervalSchema.optional(),
  schedule:z.object({
    subscriptionName:z.string().min(1).max(60),plan:z.string().max(80),category:z.string().min(1).max(60),
    previousStartDate:dateSchema,previousEndDate:dateSchema,newStartDate:dateSchema,newEndDate:dateSchema,
    amount:z.number().finite().min(0).max(1_100_000_000_000).nullable(),currency:z.enum(currencyCodes),fxRateToCny:z.number().finite().positive().max(100_000),
    previousRatePending:z.boolean(),periods:z.number().int().min(1).max(110_000),createdAt:timestamp,
  }).strict().refine(value=>value.previousEndDate>value.previousStartDate&&value.newEndDate>value.newStartDate&&value.previousStartDate<value.newStartDate,"保留账期不正确。")
    .refine(value=>value.currency!=="CNY"||value.fxRateToCny===1,"人民币汇率必须为 1。")
    .refine(value=>value.amount===null||(Number.isSafeInteger(Math.round(value.amount*100))&&Number(value.amount.toFixed(2))===value.amount),"账期金额格式不正确。").optional(),
}).strict();
const renewalSchema = z.object({
  id: idSchema, subscriptionId: idSchema, subscriptionName: z.string().min(1).max(60), kind: z.enum(["manual", "automatic"]),
  previousStartDate: dateSchema, previousEndDate: dateSchema, newStartDate: dateSchema, newEndDate: dateSchema,
  amount: z.number().finite().min(0).max(1_100_000_000_000).nullable(), ...currencyFields, periods: z.number().int().min(1).max(110_000),
  createdAt: timestamp, undoneAt: timestamp.nullable(),
  payment: paymentSchema.nullable().optional(),
  previousRatePending: z.boolean().optional(),
}).strict().refine(validCurrency, "流水汇率数据不完整。").refine(log => log.previousEndDate > log.previousStartDate && log.newEndDate > log.newStartDate, "流水账期不正确。")
  .refine(log => log.undoneAt === null || (log.kind === "manual" && Date.parse(log.undoneAt) >= Date.parse(log.createdAt)), "撤销时间不正确。")
  .refine(log => log.amount === null || (Number.isSafeInteger(Math.round(log.amount * 100)) && Number(log.amount.toFixed(2)) === log.amount), "流水金额超出范围或超过两位小数。");

export const backupSchema = z.object({
  application: z.literal("vip-manager"), formatVersion: z.union([z.literal(1), z.literal(2), z.literal(3),z.literal(4)]), exportedAt: timestamp, currency: z.literal("CNY"),
  subscriptions: z.array(z.preprocess(migrateLegacyCurrency, subscriptionObject.extend({ renewalAnchorDate: dateSchema }).refine(validCurrency, "订阅汇率数据不完整。").refine(validPeriod, "到期日期必须晚于开始日期。")
    .refine(item => {
      if (item.renewalAnchorDate > item.endDate) return false;
      if (item.cycle === "custom") return true;
      const months = (Number(item.endDate.slice(0,4)) - Number(item.renewalAnchorDate.slice(0,4))) * 12 + Number(item.endDate.slice(5,7)) - Number(item.renewalAnchorDate.slice(5,7));
      const index = months / ({monthly:1,quarterly:3,yearly:12}[item.cycle]);
      return Number.isInteger(index) && index >= 0 && cycleBoundary(item.renewalAnchorDate,item.cycle,item.customDays,index) === item.endDate;
    }, "续费锚点与到期周期不一致，请检查备份文件。"))).max(2000),
  renewalLogs: z.array(renewalSchema).max(10_000),
  billingFacts:z.array(billingFactSchema).max(10_000).optional().default([]),
}).strict().superRefine((backup, ctx) => {
  for (const [name, records] of [["subscriptions", backup.subscriptions], ["renewalLogs", backup.renewalLogs]] as const) {
    if (new Set(records.map(record => record.id)).size !== records.length) ctx.addIssue({ code: "custom", message: `${name} 包含重复标识。` });
  }
  if(new Set(backup.billingFacts.map(fact=>fact.id)).size!==backup.billingFacts.length)ctx.addIssue({code:"custom",message:"billingFacts 包含重复标识。"});
  const logs=new Set(backup.renewalLogs.map(log=>log.id));
  if(backup.billingFacts.some(fact=>logs.has(fact.id)))ctx.addIssue({code:"custom",message:"账期事实与付款记录标识冲突。"});
});
export const importSchema = z.object({
  backup: backupSchema, mode: z.enum(["merge", "replace"]), expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
  confirmReplace: z.boolean().optional(),
}).strict();

/** Private business-data backup/restore. Authentication, sessions and server settings never leave the server. */
export class BackupService {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) { this.db = db; }

  export(owner: number): BackupDocument {
    return {
      application: "vip-manager", formatVersion: 4, exportedAt: new Date().toISOString(), currency: "CNY",
      subscriptions: this.db.prepare("SELECT * FROM subscriptions WHERE user_id=? ORDER BY id").all(owner)
        .map(row => ({ ...subscriptionFromRow(row), renewalAnchorDate: String(row.renewal_anchor_date) || billingAnchor(subscriptionFromRow(row)) })),
      renewalLogs: this.db.prepare("SELECT * FROM subscription_renewal_logs WHERE user_id=? ORDER BY id").all(owner).map(renewalFromRow),
      billingFacts:billingFacts(this.db,owner),
    };
  }

  /** Hash all current business state so a preview cannot overwrite concurrent edits or scheduler changes. */
  private revision(owner: number): string {
    const subscriptions = this.db.prepare("SELECT * FROM subscriptions WHERE user_id=? ORDER BY id").all(owner);
    const logs = this.db.prepare("SELECT * FROM subscription_renewal_logs WHERE user_id=? ORDER BY id").all(owner);
    return createHash("sha256").update(JSON.stringify({ subscriptions, logs, facts:billingFacts(this.db,owner) })).digest("hex");
  }

  preview(owner: number, value: unknown): ImportPreview {
    const backup = backupSchema.parse(value);
    const currentIds = new Set(this.db.prepare("SELECT id FROM subscriptions WHERE user_id=?").all(owner).map(row => String(row.id)));
    const logIds = new Set([...this.db.prepare("SELECT id FROM subscription_renewal_logs WHERE user_id=?").all(owner).map(row => String(row.id)),...billingFacts(this.db,owner).map(fact=>fact.id)]);
    const skippedSubscriptions = backup.subscriptions.filter(item => currentIds.has(item.id)).length;
    return { revision: this.revision(owner), subscriptions: backup.subscriptions.length, logs: backup.renewalLogs.length,
      existing: currentIds.size, newSubscriptions: backup.subscriptions.length - skippedSubscriptions, skippedSubscriptions,
      newLogs: backup.renewalLogs.filter(log => !logIds.has(log.id)&&!log.undoneAt&&!log.payment?.voidedAt).length };
  }

  /** Validate completely before mutation, then import atomically; merge never overwrites an existing ID. */
  import(owner: number, value: unknown): { importedSubscriptions: number; importedLogs: number; skippedSubscriptions: number } {
    const input = importSchema.parse(value);
    if (input.mode === "replace" && input.confirmReplace !== true) throw new ApiError(400,"覆盖恢复前必须明确确认。","CONFIRM_REQUIRED");
    return transaction(this.db, () => {
      if (this.revision(owner) !== input.expectedRevision) throw new ApiError(409,"预览后数据已有变化，请重新预览导入文件。","VERSION_CONFLICT");
      const versions = new Map(this.db.prepare("SELECT id,version FROM subscriptions WHERE user_id=?").all(owner).map(row => [String(row.id),Number(row.version)]));
      if (input.mode === "replace") {
        this.db.prepare("DELETE FROM subscription_billing_facts WHERE user_id=?").run(owner);
        this.db.prepare("DELETE FROM subscription_renewal_logs WHERE user_id=?").run(owner);
        this.db.prepare("DELETE FROM subscriptions WHERE user_id=?").run(owner);
      }
      // A removed ID remains absent when merging an older backup containing its old payment.
      for(const fact of input.backup.billingFacts) {
        if(this.db.prepare("SELECT id FROM subscription_renewal_logs WHERE user_id=? AND id=?").get(owner,fact.id))continue;
        saveBillingFact(this.db,owner,fact);
      }
      let importedSubscriptions = 0, importedLogs = 0, skippedSubscriptions = 0;
      for (const item of input.backup.subscriptions) {
        if (input.mode === "merge" && versions.has(item.id)) { skippedSubscriptions++; continue; }
        const version = Math.max(versions.get(item.id) ?? -1, item.version ?? 0) + 1;
        if (!Number.isSafeInteger(version)) throw new ApiError(400,"记录版本超出安全范围。");
        this.db.prepare(`INSERT INTO subscriptions(user_id,id,name,plan,category,amount_cents,cycle,custom_days,start_date,end_date,
          reminder_days,auto_renew,note,color,currency,purchase_date,fx_rate_to_cny,fx_rate_date,fx_rate_source,original_amount_cents,version,updated_at,renewal_anchor_date) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(owner,item.id,item.name,item.plan,item.category,Math.round(item.amount*(item.fxRateToCny ?? 1)*100),item.cycle,item.customDays,item.startDate,
            item.endDate,item.reminderDays,Number(item.autoRenew),item.note,item.color,item.currency ?? "CNY",item.purchaseDate ?? item.startDate,item.fxRateToCny ?? 1,item.fxRateDate ?? item.purchaseDate ?? item.startDate,item.fxRateSource ?? "manual",Math.round(item.amount*100),version,Date.now(),item.renewalAnchorDate);
        importedSubscriptions++;
        this.db.prepare("UPDATE subscriptions SET rate_pending=? WHERE user_id=? AND id=?").run(Number(Boolean(item.ratePending)),owner,item.id);
      }
      for (const log of input.backup.renewalLogs) {
        if(this.db.prepare("SELECT id FROM subscription_billing_facts WHERE user_id=? AND id=?").get(owner,log.id))continue;
        const result = this.db.prepare(`INSERT INTO subscription_renewal_logs(user_id,id,subscription_id,subscription_name,kind,
          previous_start_date,previous_end_date,new_start_date,new_end_date,previous_anchor_date,new_anchor_date,amount_cents,currency,purchase_date,fx_rate_to_cny,fx_rate_date,fx_rate_source,periods,created_at,undone_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,id) DO NOTHING`)
          .run(owner,log.id,log.subscriptionId,log.subscriptionName,log.kind,log.previousStartDate,log.previousEndDate,log.newStartDate,log.newEndDate,
            log.previousStartDate,log.newStartDate,log.amount === null ? null : Math.round(log.amount*100),log.currency ?? "CNY",log.purchaseDate ?? log.previousStartDate,log.fxRateToCny ?? 1,log.fxRateDate ?? log.purchaseDate ?? log.previousStartDate,log.fxRateSource ?? "manual",log.periods,Date.parse(log.createdAt),
            log.undoneAt === null ? null : Date.parse(log.undoneAt));
        if(!log.undoneAt&&!log.payment?.voidedAt)importedLogs += Number(result.changes);
        if (Number(result.changes) && log.payment) this.db.prepare("UPDATE subscription_renewal_logs SET payment_json=? WHERE user_id=? AND id=?").run(JSON.stringify(log.payment),owner,log.id);
        if (Number(result.changes) && log.previousRatePending) this.db.prepare("UPDATE subscription_renewal_logs SET previous_rate_pending=1 WHERE user_id=? AND id=?").run(owner,log.id);
      }
      removeAllCanceledRenewals(this.db,owner);
      this.db.prepare("INSERT INTO subscription_preferences(user_id,initialized) VALUES(?,1) ON CONFLICT(user_id) DO UPDATE SET initialized=1").run(owner);
      return { importedSubscriptions, importedLogs, skippedSubscriptions };
    });
  }
}
