import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openDatabase } from "../src/database.ts";
import { ExchangeRates } from "../src/exchange-rates.ts";
import { PaymentService } from "../src/payments.ts";
import { RenewalHistory } from "../src/renewal-history.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { paymentState, type RenewalPaymentInput } from "../../shared/payments.ts";
import type { Subscription } from "../../shared/subscriptions.ts";

// UTC is still October 25; authoritative application date is October 26.
const now = new Date("2026-10-25T17:00:00Z");
const payment = (paidOn: string, changes: Partial<RenewalPaymentInput> = {}): RenewalPaymentInput => ({
  amount: 29.9, currency: "CNY", paidOn, note: "", ...changes,
});
const record = (changes: Partial<Subscription> = {}): Subscription => ({
  id: randomUUID(), name: "移动云电脑", plan: "32+200", category: "云服务与网络", amount: 29.9,
  currency: "CNY", cycle: "monthly", customDays: 30, startDate: "2026-08-22", endDate: "2026-09-22",
  reminderDays: 7, autoRenew: false, note: "", color: "#269979", version: 0,
  purchaseDate: "2026-08-22", fxRateToCny: 1, fxRateDate: "2026-08-22", fxRateSource: "manual", ...changes,
});

function fixture(rates?: ExchangeRates) {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(1,'owner','test',0)").run();
  const service = new SubscriptionService(db, "Asia/Shanghai", () => now, rates);
  const history = new RenewalHistory(db);
  const payments = new PaymentService(db, rates, {timeZone: "Asia/Shanghai", clock: () => now});
  const renew = (item: Subscription, paid: RenewalPaymentInput, requestId = randomUUID(), renewalMode: "continue" | "restart" = "continue") =>
    service.execute(1, {action: "renew", id: item.id, version: item.version, requestId, renewalMode, payment: paid});
  return {db, service, history, payments, renew};
}

test("历史付款逐期补录：九月和十月各续一个月，不跳到操作当天", t => {
  const {db, service, history, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  const september = renew(original, payment("2026-09-22"));
  assert.equal(september.item!.startDate, "2026-09-22");
  assert.equal(september.item!.endDate, "2026-10-22");
  assert.equal(september.item!.purchaseDate, "2026-09-22");
  assert.equal(september.renewal!.payment!.paidOn, "2026-09-22");
  assert.equal(september.renewal!.payment!.startDate, "2026-09-22");
  assert.equal(september.renewal!.payment!.endDate, "2026-10-22");
  assert.equal(september.renewal!.payment!.amount, 29.9);
  assert.equal(september.renewal!.payment!.rate, 1);
  assert.equal(september.renewal!.payment!.rateDate, "2026-09-22");
  assert.equal(paymentState(september.renewal!), "paid");
  const october = renew(september.item!, payment("2026-10-22", {amount: 32}));
  assert.equal(october.item!.startDate, "2026-10-22");
  assert.equal(october.item!.endDate, "2026-11-22");
  assert.equal(october.renewal!.payment!.amount, 32);
  assert.equal(october.renewal!.payment!.rateDate, "2026-10-22");
  assert.equal(history.list(1).total, 2);
  assert.equal(history.list(1).logs.find(log => log.id === september.renewal!.id)!.payment!.amount, 29.9);
});

test("历史外币续费按实际付款日补汇率，保留原币金额和历史服务账期", async t => {
  const requested: string[] = [];
  const rates = new ExchangeRates(async input => {
    const date = new URL(String(input)).searchParams.get("date")!; requested.push(date);
    return Response.json({date, base: "USD", quote: "CNY", rate: 7.1});
  });
  const {db, service, payments, renew} = fixture(rates); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  const result = renew(original, payment("2026-09-22", {amount: 8.99, currency: "USD"}));
  assert.equal(result.renewal!.payment!.amount, 8.99);
  assert.equal(result.renewal!.payment!.rate, null);
  await payments.refreshPendingRates();
  const saved = payments.all(1)[0].payment!;
  assert.deepEqual(requested, ["2026-09-22"]);
  assert.equal(saved.paidOn, "2026-09-22");
  assert.equal(saved.startDate, "2026-09-22");
  assert.equal(saved.endDate, "2026-10-22");
  assert.equal(saved.amount, 8.99);
  assert.equal(saved.currency, "USD");
  assert.equal(saved.rate, 7.1);
  assert.equal(saved.rateDate, "2026-09-22");
});

test("历史续费重试同一请求只记一次付款和一次账期", t => {
  const {db, service, history} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  const request = {action: "renew", id: original.id, version: original.version,
    requestId: randomUUID(), renewalMode: "continue", payment: payment("2026-09-22")};
  const first = service.execute(1, request), retry = service.execute(1, request);
  assert.equal(first.item!.startDate, "2026-09-22");
  assert.equal(retry.item!.endDate, "2026-10-22");
  assert.equal(retry.item!.version, 1);
  assert.equal(retry.renewal!.id, first.renewal!.id);
  assert.equal(retry.renewal!.payment!.confirmedAt, first.renewal!.payment!.confirmedAt);
  assert.equal(history.list(1).total, 1);
});

test("撤销第二次历史续费还原上一期和原付款信息，不删除更早流水", t => {
  const {db, service, history, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  const september = renew(original, payment("2026-09-22"));
  const october = renew(september.item!, payment("2026-10-22", {amount: 32}));
  const undone = service.execute(1, {action: "undoRenew", id: original.id,
    version: october.item!.version, logId: october.renewal!.id});
  assert.equal(undone.item!.startDate, "2026-09-22");
  assert.equal(undone.item!.endDate, "2026-10-22");
  assert.equal(undone.item!.amount, 29.9);
  assert.equal(undone.item!.purchaseDate, "2026-09-22");
  assert.equal(undone.item!.currency, september.item!.currency);
  assert.equal(undone.item!.fxRateToCny, september.item!.fxRateToCny);
  assert.equal(undone.item!.fxRateDate, september.item!.fxRateDate);
  assert.equal(undone.item!.fxRateSource, september.item!.fxRateSource);
  assert.equal(history.list(1).total, 1);
  assert.equal(history.list(1).logs[0].id, september.renewal!.id);
  assert.equal(history.facts(1).some(fact => fact.id === october.renewal!.id), true);
});

test("断档后今天付款仍从应用当天重新开通，不自动补造漏掉的付款", t => {
  const {db, service, history, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  const result = renew(original, payment("2026-10-26"), randomUUID(), "restart");
  assert.equal(result.item!.startDate, "2026-10-26");
  assert.equal(result.item!.endDate, "2026-11-26");
  assert.equal(result.renewal!.payment!.paidOn, "2026-10-26");
  assert.equal(history.list(1).total, 1);
});

test("补录上一期即使在周期中途付款，也从原到期日只延长一期", t => {
  const {db, service, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  const result = renew(original, payment("2026-10-01"));
  assert.equal(result.item!.startDate, "2026-09-22");
  assert.equal(result.item!.endDate, "2026-10-22");
  assert.equal(result.renewal!.payment!.paidOn, "2026-10-01");
});

test("重新开通允许补记过去付款日，从该日开始一个新周期", t => {
  const {db, service, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  const result = renew(original, payment("2026-10-01"), randomUUID(), "restart");
  assert.equal(result.item!.startDate, "2026-10-01");
  assert.equal(result.item!.endDate, "2026-11-01");
  assert.equal(result.renewal!.payment!.paidOn, "2026-10-01");
  assert.equal(result.renewal!.payment!.rateDate, "2026-10-01");
});

test("兼容未指定续费方式的旧请求，已过期仍从服务端当天重新开通", t => {
  const {db, service} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  const result = service.execute(1, {action: "renew", id: original.id, version: original.version,
    requestId: randomUUID(), payment: payment("2026-09-22")});
  assert.equal(result.item!.startDate, "2026-10-26");
  assert.equal(result.item!.endDate, "2026-11-26");
  assert.equal(result.renewal!.payment!.paidOn, "2026-09-22");
});

test("未到期提前付款继续从原到期日延长，不把付款日作为服务开始日", t => {
  const {db, service, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record({
    startDate: "2026-10-22", endDate: "2026-11-22", purchaseDate: "2026-10-22", fxRateDate: "2026-10-22",
  })}).item!;
  const result = renew(original, payment("2026-10-25"));
  assert.equal(result.item!.startDate, "2026-11-22");
  assert.equal(result.item!.endDate, "2026-12-22");
  assert.equal(result.renewal!.payment!.paidOn, "2026-10-25");
  assert.equal(result.renewal!.payment!.rateDate, "2026-10-25");
});

test("未来付款日期被拒绝且完整回滚，不改变历史账期、版本或流水", t => {
  const {db, service, history, payments, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  assert.throws(() => renew(original, payment("2026-10-27")), {status: 400});
  assert.deepEqual(service.list(1).items[0], original);
  assert.equal(history.list(1).total, 0);
  assert.deepEqual(payments.all(1), []);
  assert.deepEqual(history.facts(1), []);
});

test("重新开通不能选择早于原到期日的付款日，避免重叠服务账期", t => {
  const {db, service, history, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  assert.throws(() => renew(original, payment("2026-09-21"), randomUUID(), "restart"), {status: 400});
  assert.deepEqual(service.list(1).items[0], original);
  assert.equal(history.list(1).total, 0);
});

test("仍有有效覆盖的订阅不能通过重新开通缩短或覆盖已购账期", t => {
  const {db, service, history, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record({
    startDate: "2026-10-22", endDate: "2026-11-22", purchaseDate: "2026-10-22", fxRateDate: "2026-10-22",
  })}).item!;
  assert.throws(() => renew(original, payment("2026-10-26"), randomUUID(), "restart"), {status: 400});
  assert.deepEqual(service.list(1).items[0], original);
  assert.equal(history.list(1).total, 0);
});

test("未知续费方式被拒绝且不写入订阅或付款流水", t => {
  const {db, service, history} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  assert.throws(() => service.execute(1, {action: "renew", id: original.id, version: original.version,
    renewalMode: "invalid", payment: payment("2026-09-22")}));
  assert.deepEqual(service.list(1).items[0], original);
  assert.equal(history.list(1).total, 0);
});

test("补录续费碰到已有相同账期的付款时拒绝，保留原账期及既有流水", async t => {
  const {db, service, history, payments, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record()}).item!;
  await payments.add(1, {subscriptionId: original.id, entries: [{...payment("2026-09-22"),
    startDate: "2026-09-22", endDate: "2026-10-22"}]});
  const existing = payments.all(1)[0];
  assert.throws(() => renew(original, payment("2026-09-22")), {status: 409});
  assert.deepEqual(service.list(1).items[0], original);
  assert.equal(history.list(1).total, 1);
  assert.equal(payments.all(1)[0].id, existing.id);
});

test("月末历史续费沿用原账期锚点，二月补记后仍恢复三十一日", t => {
  const {db, service, renew} = fixture(); t.after(() => db.close());
  const original = service.execute(1, {action: "create", item: record({
    startDate: "2026-01-31", endDate: "2026-02-28", purchaseDate: "2026-01-31", fxRateDate: "2026-01-31",
  })}).item!;
  const result = renew(original, payment("2026-02-28"));
  assert.equal(result.item!.startDate, "2026-02-28");
  assert.equal(result.item!.endDate, "2026-03-31");
});
