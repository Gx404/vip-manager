/** Expired subscription browsing and renewal against an isolated real API and memory database. */
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
import { RenewalHistory } from "../backend/src/renewal-history.ts";
import { PaymentService } from "../backend/src/payments.ts";
import { dateInTimeZone } from "../shared/billing.ts";
import { renewDate, shiftDate } from "../shared/subscriptions.ts";
import { paymentReport } from "../shared/payment-reports.ts";

const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const temporary = await mkdtemp(join(tmpdir(), "vip-expired-subscriptions-"));
const output = fileURLToPath(new URL("../outputs/expired-subscriptions-tests/", import.meta.url));
const config = readConfig({ PUBLIC_ORIGIN: "http://127.0.0.1", COOKIE_SECURE: "false", PUBLIC_DASHBOARD: "true",
  ADMIN_USERNAME: "expired-subscription-test", ADMIN_PASSWORD: randomUUID(), EMAIL_CONFIG_FILE: join(temporary, "email-settings.json"), APP_TIMEZONE: "Asia/Shanghai" });
const db = openDatabase(":memory:"), errors = [], blocked = [], queries = [], layouts = [];
const today = dateInTimeZone(new Date(), config.timeZone), yesterday = shiftDate(today, -1);
const yearBefore = value => { const date = new Date(`${value}T00:00:00Z`); date.setUTCFullYear(date.getUTCFullYear() - 1); return date.toISOString().slice(0, 10); };
const rates = new ExchangeRates(async input => {
  const url = new URL(String(input)), currency = url.pathname.split("/").at(-2).toUpperCase(), date = url.searchParams.get("date");
  queries.push({ currency, date });
  return Response.json({ date, base: currency, quote: "CNY", rate: 6.6839 });
});
const service = new SubscriptionService(db, config.timeZone, () => new Date(), rates);
const history = new RenewalHistory(db), payments = new PaymentService(db, rates, { timeZone: config.timeZone });
let server, browser, page;
const dialog = () => page.getByRole("dialog");
const tab = name => page.getByRole("tab", { name: new RegExp(`^${name}\\s*\\d+$`) });
const rows = () => page.locator(".subscription-grid > article");
const current = id => service.list(1).items.find(item => item.id === id);
async function expectRows(names) {
  if (names.length) await rows().first().waitFor();
  else await page.locator(".empty-state").waitFor();
  assert.deepEqual((await rows().evaluateAll(elements => elements.map(element => element.getAttribute("aria-label")))).sort(), [...names].sort());
}
async function closeDialog() {
  await dialog().getByRole("button", { name: "Close", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
}
async function appearance(dark) {
  const desired = dark ? "dark" : "light";
  if (await page.locator("html").getAttribute("data-appearance") !== desired) {
    await page.getByRole("button", { name: dark ? "切换到黑夜模式" : "切换到明亮模式", exact: true }).click();
  }
  assert.equal(await page.locator("html").getAttribute("data-appearance"), desired);
}
async function capture(label, width, dark) {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
  await appearance(dark);
  // The existing category strip scrolls horizontally on phones; show the selected status in captures.
  await page.getByRole("tab", { selected: true }).scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth + 1,
    rows: [...document.querySelectorAll(".subscription-grid > article")].some(element => element.scrollWidth > element.clientWidth + 1) }));
  assert.deepEqual(overflow, { page: false, rows: false }, `${label} ${width}px layout`);
  const filename = `${label}-${width}-${dark ? "dark" : "light"}.png`;
  await page.screenshot({ path: join(output, filename), fullPage: true, animations: "disabled" });
  layouts.push(filename);
}
function report() {
  return paymentReport(payments.all(1), service.list(1).items, today, "", "accrual", history.facts(1));
}

try {
  await mkdir(output, { recursive: true });
  await bootstrapAdmin(db, config);
  const create = (name, overrides = {}) => service.execute(1, { action: "create", item: {
    id: randomUUID(), name, plan: "Fixture", category: "购物电商", amount: 12, currency: "CNY", cycle: "monthly", customDays: 30,
    startDate: shiftDate(today, -15), endDate: shiftDate(today, 15), purchaseDate: shiftDate(today, -15),
    fxRateToCny: 1, fxRateDate: shiftDate(today, -15), fxRateSource: "manual", ratePending: false,
    reminderDays: 7, autoRenew: false, note: "isolated regression fixture", color: "#269979", version: 0, ...overrides,
  } }).item;
  // Yesterday's annual membership mirrors JD's 2025-10-23 -> 2026-10-23 record without expiring the test itself.
  const jd = create("京东", { plan: "Plus", amount: 98, cycle: "yearly", startDate: yearBefore(yesterday), endDate: yesterday,
    purchaseDate: yearBefore(yesterday), fxRateDate: yearBefore(yesterday) });
  const shopping = create("淘宝", { plan: "88VIP", amount: 88, cycle: "yearly", startDate: shiftDate(today, -60), endDate: renewDate(shiftDate(today, -60), "yearly", 30) });
  const boundary = create("本日到期测试", { category: "AI 工具", startDate: shiftDate(today, -30), endDate: today });
  const dmit = create("DMIT预付测试", { category: "云服务与网络", amount: 10.9, currency: "USD", startDate: shiftDate(today, -27), endDate: shiftDate(today, 3),
    purchaseDate: shiftDate(today, -27), fxRateToCny: 6.6839, fxRateDate: shiftDate(today, -27), fxRateSource: "frankfurter" });
  const prepaid = service.execute(1, { action: "renew", id: dmit.id, version: dmit.version, requestId: randomUUID(),
    payment: { amount: 10.9, currency: "USD", paidOn: yesterday, note: "future period already paid" } });
  await payments.refreshPendingRates();
  assert.ok(prepaid.item.startDate > today, "fixture really stores a future prepaid period");
  assert.ok(current(dmit.id).coverageStartDate < today, "prior continuous coverage is retained");
  const expectedMonthly = paymentReport(payments.all(1), service.list(1).items, today).monthTotal;
  const originalJdRows = report().details.filter(entry => entry.subscriptionId === jd.id);
  assert.equal(originalJdRows.length, 0, "a saved expired JD price is not proof of historical payment");

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
  await tab("已过期").waitFor();
  await expectRows(["淘宝", "本日到期测试", "DMIT预付测试"]);
  assert.match(await tab("全部").innerText(), /全部\s*3$/);
  assert.match(await tab("购物电商").innerText(), /购物电商\s*1$/);
  assert.match(await tab("已过期").innerText(), /已过期\s*1$/);
  assert.ok((await page.getByRole("button", { name: /^提醒中心/ }).getAttribute("aria-label")).includes("1 项"), "only the membership ending today needs attention");
  await page.getByRole("button", { name: /^提醒中心/ }).click();
  await dialog().getByRole("heading", { name: "到期提醒", exact: true }).waitFor();
  assert.equal(await dialog().getByRole("button", { name: "管理京东", exact: true }).count(), 0);
  assert.equal(await dialog().getByRole("button", { name: "管理DMIT预付测试", exact: true }).count(), 0);
  assert.equal(await dialog().getByRole("button", { name: "管理本日到期测试", exact: true }).count(), 1);
  await closeDialog();
  assert.equal((await page.locator(".spending-summary .summary-number").innerText()).replaceAll(",", "").replaceAll(/\s/g, ""), `¥${expectedMonthly.toFixed(2)}`);
  await page.getByRole("button", { name: "本月支出，查看已付款明细", exact: true }).click();
  await page.getByRole("heading", { name: "支出分析", exact: true }).waitFor();
  await page.locator(".report-list li").filter({ hasText: "DMIT预付测试" }).waitFor();
  assert.equal(await page.locator(".report-list li").filter({ hasText: "京东" }).count(), 0);
  await page.getByRole("button", { name: "返回订阅", exact: true }).click();

  // The report receives every stored subscription; status tabs never filter its historical inputs.
  await page.getByRole("button", { name: "支出分析", exact: true }).click();
  await page.getByRole("combobox", { name: "统计范围", exact: true }).selectOption("all");
  const jdHistory = page.locator(".report-list li").filter({ hasText: "京东" });
  await page.locator(".report-list li").filter({ hasText: "DMIT预付测试" }).waitFor();
  assert.equal(await jdHistory.count(), 0, "unknown initial payments cannot reappear in all-years reporting");
  await page.getByRole("button", { name: "返回订阅", exact: true }).click();

  await tab("购物电商").click(); await expectRows(["淘宝"]);
  await page.getByRole("textbox", { name: "搜索订阅", exact: true }).fill("京东"); await expectRows([]);
  await tab("已过期").click(); await expectRows(["京东"]);
  await page.getByRole("textbox", { name: "搜索订阅", exact: true }).fill("no-such-subscription"); await expectRows([]);
  await page.getByRole("textbox", { name: "搜索订阅", exact: true }).fill(""); await expectRows(["京东"]);
  for (const dark of [false, true]) for (const width of [1440, 390]) {
    await page.getByRole("button", { name: "卡片视图", exact: true }).click();
    await capture("expired-grid", width, dark);
    await page.getByRole("button", { name: "紧凑列表视图", exact: true }).click();
    await expectRows(["京东"]); await capture("expired-list", width, dark);
  }
  await page.getByRole("textbox", { name: "搜索订阅", exact: true }).fill("no-such-subscription"); await expectRows([]);
  await page.getByRole("textbox", { name: "搜索订阅", exact: true }).fill(""); await expectRows(["京东"]);
  await tab("全部").click(); await expectRows(["淘宝", "本日到期测试", "DMIT预付测试"]);
  for (const dark of [false, true]) for (const width of [1440, 390]) await capture("active-list", width, dark);
  await tab("已过期").click(); await expectRows(["京东"]);

  // Renew through the real editor, using a different amount and today after the lapse.
  await page.getByRole("button", { name: "编辑京东", exact: true }).click();
  await dialog().getByRole("button", { name: "记录续费", exact: true }).click();
  await dialog().getByRole("heading", { name: "京东 · 记录续费", exact: true }).waitFor();
  await dialog().getByLabel("续费方式", { exact: true }).selectOption("restart");
  assert.ok((await dialog().locator(".renewal-period").innerText()).includes(today));
  await dialog().getByRole("spinbutton", { name: "本次实付金额", exact: true }).fill("128");
  assert.equal(await dialog().getByLabel("实际付款日期", { exact: true }).inputValue(), today);
  await dialog().getByRole("button", { name: "保存本次续费", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  await page.locator(".empty-state").waitFor();
  assert.equal(await tab("已过期").getAttribute("aria-selected"), "true", "renewal keeps the user's status filter stable");
  assert.match(await tab("已过期").innerText(), /已过期\s*0$/);
  assert.equal(current(jd.id).startDate, today);
  assert.equal(current(jd.id).endDate, renewDate(today, "yearly", 30));
  assert.equal(current(jd.id).amount, 128);
  await tab("购物电商").click(); await expectRows(["京东", "淘宝"]);
  assert.match(await tab("购物电商").innerText(), /购物电商\s*2$/);
  await tab("全部").click(); await expectRows(["京东", "淘宝", "本日到期测试", "DMIT预付测试"]);
  assert.match(await tab("全部").innerText(), /全部\s*4$/);

  const renewedJd = report().details.filter(entry => entry.subscriptionId === jd.id);
  assert.equal(renewedJd.length, 1, "only the newly confirmed payment is expenditure");
  assert.deepEqual(renewedJd.map(entry => entry.allocated), [128]);
  assert.equal(payments.all(1).filter(log => log.subscriptionId === jd.id).length, 1);
  await page.getByRole("button", { name: "支出分析", exact: true }).click();
  await page.getByRole("combobox", { name: "统计范围", exact: true }).selectOption("all");
  await page.locator(".report-list li").filter({ hasText: "京东" }).first().waitFor();
  assert.equal(await page.locator(".report-list li").filter({ hasText: "京东" }).count(), 1);
  const amounts = await page.locator(".report-list li").filter({ hasText: "京东" }).locator(":scope > b").allTextContents();
  assert.deepEqual(amounts, ["¥128.00"]);
  assert.deepEqual(errors, []);
  const result = { passed: true, today, checks: ["expired-tab-and-active-category-counts", "expired-hidden-from-all-and-shopping", "today-inclusive-boundary", "prepaid-future-period-stays-active",
    "expired-excluded-from-reminders", "unconfirmed-expired-prices-not-in-spending", "paid-only-dashboard-and-report", "grid-list-search-empty-states", "desktop-mobile-light-dark-without-overflow",
    "real-renewal-restores-original-category", "only-confirmed-payment-in-history", "no-javascript-errors"], layouts, queries, blockedOrigins: [...new Set(blocked)] };
  await writeFile(join(output, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  db.close();
  await rm(temporary, { recursive: true, force: true });
}
