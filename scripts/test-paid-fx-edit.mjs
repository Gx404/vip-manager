/** Real editor regression against disposable API data and a deterministic local FX provider. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
import { dateInTimeZone } from "../shared/billing.ts";
import { renewDate, shiftDate } from "../shared/subscriptions.ts";

const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const temporary = await mkdtemp(join(tmpdir(), "vip-paid-fx-edit-"));
const config = readConfig({ PUBLIC_ORIGIN: "http://127.0.0.1", COOKIE_SECURE: "false", PUBLIC_DASHBOARD: "true",
  ADMIN_USERNAME: "paid-fx-editor-test", ADMIN_PASSWORD: randomUUID(), EMAIL_CONFIG_FILE: join(temporary, "email-settings.json"), APP_TIMEZONE: "Asia/Shanghai" });
const db = openDatabase(":memory:"), errors = [], queries = [], submissions = [], blocked = [];
const output = fileURLToPath(new URL("../outputs/paid-fx-edit-tests/", import.meta.url));
const today = dateInTimeZone(new Date(), config.timeZone), paidOn = shiftDate(today, -5), startDate = shiftDate(today, 2);
let releaseEuro, enterEuro;
const euroGate = new Promise(resolve => { releaseEuro = resolve; }), euroStarted = new Promise(resolve => { enterEuro = resolve; });
const rates = new ExchangeRates(async input => {
  const url = new URL(String(input)), currency = url.pathname.split("/").at(-2).toUpperCase(), date = url.searchParams.get("date");
  queries.push({ currency, date });
  if (currency === "EUR") { enterEuro(); await euroGate; }
  return Response.json({ date, base: currency, quote: "CNY", rate: currency === "EUR" ? 8.2 : currency === "GBP" ? 9.3 : 6.6839 });
});
const service = new SubscriptionService(db, config.timeZone, () => new Date(), rates);
let server, browser, page;
const current = id => service.list(1).items.find(item => item.id === id);
const dialog = () => page.getByRole("dialog");
async function edit(name) {
  await page.getByRole("button", { name: `编辑${name}`, exact: true }).click();
  await dialog().getByLabel("会员名称 *", { exact: true }).waitFor();
}
async function save() {
  await dialog().getByRole("button", { name: "保存", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
}
async function close() {
  await dialog().getByRole("button", { name: "取消", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
}
try {
  await mkdir(output, { recursive: true });
  await bootstrapAdmin(db, config);
  const fixture = (name, rate) => service.execute(1, { action: "create", item: { id: randomUUID(), name, plan: "Pro", category: "云服务与网络",
    amount: 10.9, currency: "USD", cycle: "monthly", customDays: 30, startDate, endDate: renewDate(startDate, "monthly", 30),
    purchaseDate: paidOn, fxRateToCny: rate, fxRateDate: paidOn, fxRateSource: "frankfurter", ratePending: false,
    reminderDays: 7, autoRenew: false, note: "isolated fixture", color: "#269979", version: 0 } }).item;
  const dmit = fixture("DMIT", 6.6839), other = fixture("其他外币订阅", 7.12);
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
  page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/subscriptions") submissions.push(request.postDataJSON());
  });
  await page.goto(config.publicOrigin);

  await page.getByRole("button", { name: "月均支出，查看摊算明细", exact: true }).click();
  await dialog().getByRole("heading", { name: "月均支出明细", exact: true }).waitFor();
  const costRow = dialog().locator(".cost-list li").filter({ hasText: "DMIT" });
  assert.ok((await costRow.innerText()).includes("¥72.85"));
  assert.ok((await costRow.locator("b").getAttribute("title")).includes(`${paidOn} 付款日`));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `no page overflow at ${width}px`);
    assert.ok(await dialog().evaluate(element => { const box = element.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1; }), `dialog stays inside ${width}px viewport`);
    assert.ok(await costRow.evaluate(element => element.scrollWidth <= element.clientWidth + 1), `cost row does not overflow at ${width}px`);
    await page.screenshot({ path: join(output, `costs-${width === 390 ? "mobile" : "desktop"}.png`), fullPage: true });
  }
  await dialog().getByRole("button", { name: "Close", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 1000 });

  // Opening an already-paid future period keeps its original locked quote, even when saving other fields.
  await edit("DMIT");
  await dialog().getByText(`参考汇率：1 USD ≈ ¥6.6839 · 付款日期 ${paidOn}（报价 ${paidOn}）`, { exact: true }).waitFor();
  await page.waitForTimeout(450);
  assert.equal(queries.length, 0, "opening the editor must not query the future billing start");
  await dialog().getByPlaceholder("填写备注", { exact: true }).fill("only the note changed");
  await save();
  assert.equal(queries.length, 0);
  assert.equal(submissions.at(-1).item.purchaseDate, paidOn);
  assert.equal(current(dmit.id).purchaseDate, paidOn);
  assert.equal(current(dmit.id).fxRateToCny, 6.6839);
  assert.equal(current(dmit.id).ratePending, false);

  // Independently recorded payment dates do not follow later service-period corrections.
  await edit("DMIT");
  await dialog().getByLabel("本期开始日期 *", { exact: true }).fill(shiftDate(startDate, 1));
  await save();
  assert.equal(current(dmit.id).startDate, shiftDate(startDate, 1));
  assert.equal(current(dmit.id).purchaseDate, paidOn);
  assert.equal(current(dmit.id).fxRateToCny, 6.6839);
  assert.equal(queries.length, 0);

  // Two editors sharing currency/payment date still display their own saved snapshots.
  await edit("其他外币订阅");
  await dialog().getByText(`参考汇率：1 USD ≈ ¥7.12 · 付款日期 ${paidOn}（报价 ${paidOn}）`, { exact: true }).waitFor();
  await close();
  assert.equal(current(other.id).fxRateToCny, 7.12);
  assert.equal(queries.length, 0);

  // New subscriptions retain the simple default: changing the start date also changes the payment-date default.
  await page.getByRole("button", { name: "添加订阅", exact: true }).click();
  await dialog().getByLabel("会员名称 *", { exact: true }).fill("新建外币测试");
  const newStart = shiftDate(today, -10);
  await dialog().getByLabel("本期开始日期 *", { exact: true }).fill(newStart);
  await dialog().getByRole("combobox", { name: /^付款币种/ }).selectOption("USD");
  await dialog().getByText(`参考汇率：1 USD ≈ ¥6.6839 · 付款日期 ${newStart}（报价 ${newStart}）`, { exact: true }).waitFor();
  await save();
  const created = service.list(1).items.find(item => item.name === "新建外币测试");
  assert.equal(created.purchaseDate, newStart);
  assert.equal(created.fxRateToCny, 6.6839);
  assert.deepEqual(queries, [{ currency: "USD", date: newStart }]);

  // Changing currency invalidates the old quote; a slow result for the previous currency must not win.
  await edit("DMIT");
  await dialog().getByRole("combobox", { name: /^付款币种/ }).selectOption("EUR");
  await euroStarted;
  await dialog().getByRole("combobox", { name: /^付款币种/ }).selectOption("GBP");
  await dialog().getByText(`参考汇率：1 GBP ≈ ¥9.3 · 付款日期 ${paidOn}（报价 ${paidOn}）`, { exact: true }).waitFor();
  const oldResponse = page.waitForResponse(response => response.url().includes("/api/exchange-rate?") && response.url().includes("currency=EUR"));
  releaseEuro(); await oldResponse;
  await page.waitForTimeout(100);
  assert.equal(await dialog().getByRole("combobox", { name: /^付款币种/ }).inputValue(), "GBP");
  assert.ok((await dialog().locator(".auto-fx").innerText()).includes("¥9.3"));
  await save();
  assert.equal(current(dmit.id).currency, "GBP");
  assert.equal(current(dmit.id).purchaseDate, paidOn);
  assert.equal(current(dmit.id).fxRateToCny, 9.3);
  assert.equal(current(dmit.id).ratePending, false);
  assert.deepEqual(queries.slice(1), [{ currency: "EUR", date: paidOn }, { currency: "GBP", date: paidOn }]);
  assert.deepEqual(errors, []);
  // Host security software may inject requests; every non-fixture origin is blocked above.
  console.log(JSON.stringify({ passed: true, checks: ["paid-fx-visible-in-monthly-cost-detail", "desktop-mobile-without-overflow", "preserve-paid-date-and-quote-on-note-edit", "preserve-independent-payment-date-on-period-edit",
    "separate-snapshots-for-each-editor", "link-new-payment-date-default", "currency-change-uses-paid-date", "ignore-stale-currency-response"], queries, blockedOrigins: [...new Set(blocked)] }, null, 2));
} finally {
  releaseEuro();
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  db.close();
  await rm(temporary, { recursive: true, force: true });
}
