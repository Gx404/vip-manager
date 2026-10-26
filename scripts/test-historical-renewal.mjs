/** Historical renewals use a real isolated API, in-memory SQLite, and the built UI. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { readConfig } from "../backend/src/config.ts";
import { openDatabase } from "../backend/src/database.ts";
import { bootstrapAdmin } from "../backend/src/auth.ts";
import { createApp } from "../backend/src/app.ts";
import { ExchangeRates } from "../backend/src/exchange-rates.ts";
import { SubscriptionService } from "../backend/src/subscriptions.ts";
import { PaymentService } from "../backend/src/payments.ts";
import { dateInTimeZone } from "../shared/billing.ts";
import { renewDate, shiftDate } from "../shared/subscriptions.ts";

const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const temporary = await mkdtemp(join(tmpdir(), "vip-historical-renewal-"));
const output = fileURLToPath(new URL("../outputs/historical-renewal-tests/", import.meta.url));
const config = readConfig({ PUBLIC_ORIGIN: "http://127.0.0.1", COOKIE_SECURE: "false", PUBLIC_DASHBOARD: "true",
  ADMIN_USERNAME: "historical-renewal-test", ADMIN_PASSWORD: randomUUID(), EMAIL_CONFIG_FILE: join(temporary, "email-settings.json"), APP_TIMEZONE: "Asia/Shanghai" });
const db = openDatabase(":memory:"), errors = [], blocked = [], layouts = [], checks = [];
const today = dateInTimeZone(new Date(), config.timeZone);
const monthDate = (value, offset, day) => {
  const date = new Date(`${value}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, day)).toISOString().slice(0, 10);
};
// On 2026-10-26 these are the reported 08/22, 09/22, 10/22 dates; stay reusable later.
const day = Number(today.slice(8)), boundary = day === 1 ? monthDate(today, -1, 22) : monthDate(today, 0, Math.min(22, day - 1));
const initialStart = monthDate(boundary, -2, Number(boundary.slice(8)));
const initialEnd = monthDate(boundary, -1, Number(boundary.slice(8)));
const nextEnd = renewDate(boundary, "monthly", 30), latePayment = shiftDate(initialEnd, 9);
const rates = new ExchangeRates(async () => { throw new Error("CNY-only fixtures must not request FX"); });
const service = new SubscriptionService(db, config.timeZone, () => new Date(), rates);
const payments = new PaymentService(db, rates, { timeZone: config.timeZone });
const current = id => service.list(1).items.find(item => item.id === id);
let server, browser, page;
const dialog = () => page.getByRole("dialog");
const tab = name => page.getByRole("tab", { name: new RegExp(`^${name}\\s*\\d+$`) });

async function preview(start, end) {
  await page.waitForFunction(({ start, end }) => {
    const text = document.querySelector('[role="dialog"] .renewal-period')?.textContent ?? "";
    return text.includes(start) && text.includes(end);
  }, { start, end });
}
async function openRenewal(item) {
  // A real reload also clears the client-only 30-second undo receipt before a second independent entry.
  await page.reload();
  await tab(current(item.id).endDate < today ? "已过期" : "全部").click();
  await page.getByRole("button", { name: `编辑${item.name}`, exact: true }).click();
  await dialog().getByRole("button", { name: "记录续费", exact: true }).click();
  await dialog().getByRole("heading", { name: `${item.name} · 记录续费`, exact: true }).waitFor();
}
async function saveRenewal() {
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/subscriptions") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "renew"),
    dialog().getByRole("button", { name: "保存本次续费", exact: true }).click(),
  ]);
  assert.equal(response.status(), 200, await response.text());
  const result = await response.json();
  await dialog().waitFor({ state: "hidden" });
  return { result, request: response.request().postDataJSON() };
}
async function capture(label) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const overflow = await dialog().evaluate(element => ({ page: document.documentElement.scrollWidth > innerWidth + 1,
      dialog: element.scrollWidth > element.clientWidth + 1 }));
    assert.deepEqual(overflow, { page: false, dialog: false }, `${label} ${width}px`);
    const filename = `${label}-${width}.png`;
    await page.screenshot({ path: join(output, filename), fullPage: true, animations: "disabled" });
    layouts.push(filename);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}

try {
  await mkdir(output, { recursive: true });
  await bootstrapAdmin(db, config);
  const create = (name, overrides = {}) => service.execute(1, { action: "create", item: {
    id: randomUUID(), name, plan: "32+200", category: "云服务与网络", amount: 29.9, currency: "CNY", cycle: "monthly", customDays: 30,
    startDate: initialStart, endDate: initialEnd, purchaseDate: initialStart, fxRateToCny: 1, fxRateDate: initialStart,
    fxRateSource: "manual", reminderDays: 7, autoRenew: false, note: "isolated browser fixture", color: "#269979", version: 0, ...overrides,
  } }).item;
  const historical = create("移动云电脑补录测试"), restart = create("移动云电脑重开测试");
  const active = create("未到期续费测试", { startDate: shiftDate(today, -20), endDate: shiftDate(today, 10),
    purchaseDate: shiftDate(today, -20), fxRateDate: shiftDate(today, -20) });
  const api = createApp(db, config, undefined, rates), web = express();
  web.use((req, res, next) => req.path.startsWith("/api/") ? api(req, res, next) : next());
  web.use(express.static(fileURLToPath(new URL("../frontend/dist/", import.meta.url))));
  server = web.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  config.publicOrigin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", timezoneId: config.timeZone });
  await context.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(config.publicOrigin + "/") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    blocked.push(new URL(url).origin); return route.abort("blockedbyclient");
  });
  const login = await context.request.post(`${config.publicOrigin}/api/auth/login`, {
    headers: { Origin: config.publicOrigin, "X-Requested-With": "membership-dashboard" },
    data: { username: config.adminUsername, password: config.adminPassword },
  });
  assert.equal(login.status(), 200);
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(config.publicOrigin);

  await openRenewal(historical);
  assert.equal(await dialog().getByLabel("续费方式", { exact: true }).inputValue(), "continue");
  await dialog().getByLabel("实际付款日期", { exact: true }).fill(initialEnd);
  await preview(initialEnd, boundary);
  await capture("continue-previous-period");
  const first = await saveRenewal();
  assert.equal(first.request.renewalMode, "continue");
  assert.equal(first.result.item.startDate, initialEnd); assert.equal(first.result.item.endDate, boundary);
  assert.equal(first.result.renewal.payment.paidOn, initialEnd);
  assert.equal(current(historical.id).endDate, boundary);
  checks.push("historical-payment-keeps-the-previous-billing-period");

  await openRenewal(historical);
  assert.equal(await dialog().getByLabel("续费方式", { exact: true }).inputValue(), "continue");
  await dialog().getByLabel("实际付款日期", { exact: true }).fill(boundary);
  await preview(boundary, nextEnd);
  const second = await saveRenewal();
  assert.equal(second.result.item.startDate, boundary); assert.equal(second.result.item.endDate, nextEnd);
  assert.equal(payments.all(1).filter(log => log.subscriptionId === historical.id).length, 2);
  checks.push("second-historical-payment-advances-exactly-one-more-period");

  await openRenewal(restart);
  await dialog().getByLabel("实际付款日期", { exact: true }).fill(latePayment);
  await preview(initialEnd, boundary);
  await dialog().getByLabel("续费方式", { exact: true }).selectOption("restart");
  await preview(latePayment, renewDate(latePayment, "monthly", 30));
  await capture("restart-from-payment-date");
  await dialog().getByLabel("续费方式", { exact: true }).selectOption("continue");
  await preview(initialEnd, boundary);
  await dialog().getByLabel("续费方式", { exact: true }).selectOption("restart");
  const movedPayment = shiftDate(latePayment, 1);
  await dialog().getByLabel("实际付款日期", { exact: true }).fill(movedPayment);
  await preview(movedPayment, renewDate(movedPayment, "monthly", 30));
  const restarted = await saveRenewal();
  assert.equal(restarted.request.renewalMode, "restart");
  assert.equal(restarted.result.item.startDate, movedPayment);
  assert.equal(restarted.result.item.endDate, renewDate(movedPayment, "monthly", 30));
  checks.push("restart-and-date-change-update-preview-and-server-identically", "mode-switch-preserves-the-payment-fields");

  await openRenewal(active);
  assert.equal(await dialog().getByLabel("续费方式", { exact: true }).count(), 0);
  await preview(active.endDate, renewDate(active.endDate, "monthly", 30));
  const activeResult = await saveRenewal();
  assert.equal(activeResult.result.item.startDate, active.endDate);
  assert.equal(activeResult.result.item.endDate, renewDate(active.endDate, "monthly", 30));
  checks.push("active-membership-retains-existing-paid-coverage");

  await page.reload();
  await page.getByRole("button", { name: "续费记录", exact: true }).click();
  await dialog().getByLabel("筛选订阅", { exact: true }).selectOption(historical.id);
  const oldRow = dialog().locator(".ledger-row").filter({ hasText: `${initialEnd} 付款` });
  await oldRow.getByRole("button", { name: "修改付款", exact: true }).click();
  assert.equal(await dialog().getByLabel("续费方式", { exact: true }).count(), 0);
  await dialog().getByLabel("实际付款日期", { exact: true }).fill(shiftDate(initialEnd, 1));
  const [correctedResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/payments/update") && response.request().method() === "POST"),
    dialog().getByRole("button", { name: "保存修改", exact: true }).click(),
  ]);
  assert.equal(correctedResponse.status(), 200, await correctedResponse.text());
  const corrected = await correctedResponse.json();
  assert.equal(corrected.log.payment.startDate, initialEnd); assert.equal(corrected.log.payment.endDate, boundary);
  assert.equal(current(historical.id).endDate, nextEnd);
  checks.push("editing-an-old-payment-does-not-reschedule-its-service-period");
  assert.deepEqual(errors, []); checks.push("no-javascript-errors", "desktop-and-mobile-dialogs-without-horizontal-overflow");
  const result = { passed: true, today, example: { initialStart, initialEnd, firstEnd: boundary, secondEnd: nextEnd },
    checks, layouts, pageErrors: errors, blockedOrigins: [...new Set(blocked)], productionDataWritten: false };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: false, today, checks, layouts, pageErrors: errors,
    error: error instanceof Error ? error.message : String(error), productionDataWritten: false }, null, 2) + "\n");
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  db.close();
  await rm(temporary, { recursive: true, force: true });
}
