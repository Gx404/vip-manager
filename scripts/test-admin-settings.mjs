/** Browser regression for deletion and email settings. All data and mail are disposable fixtures. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { readConfig } from "../backend/src/config.ts";
import { openDatabase } from "../backend/src/database.ts";
import { createApp } from "../backend/src/app.ts";
import { bootstrapAdmin } from "../backend/src/auth.ts";
import { SubscriptionService } from "../backend/src/subscriptions.ts";
import { RenewalHistory } from "../backend/src/renewal-history.ts";
import { EmailNotificationService } from "../backend/src/notifications.ts";
import { dateInTimeZone } from "../shared/billing.ts";
import { renewDate } from "../shared/subscriptions.ts";

const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const temporary = await mkdtemp(join(tmpdir(), "vip-admin-settings-"));
const filename = join(temporary, "email-settings.json");
const output = fileURLToPath(new URL("../outputs/admin-settings-tests/", import.meta.url));
const config = readConfig({ PUBLIC_ORIGIN: "http://127.0.0.1", COOKIE_SECURE: "false", PUBLIC_DASHBOARD: "true",
  ADMIN_USERNAME: "admin-settings-test", ADMIN_PASSWORD: randomUUID(), EMAIL_CONFIG_FILE: filename, APP_TIMEZONE: "Asia/Shanghai" });
const db = openDatabase(":memory:"), errors = [], blocked = [], sent = [], layouts = [];
const authorizationCode = "abcdefghijklmnop", replacementCode = "ponmlkjihgfedcba";
const today = dateInTimeZone(new Date(), config.timeZone);
let now = Date.now() - 60_000;
const service = new SubscriptionService(db, config.timeZone, () => new Date(now));
const history = new RenewalHistory(db);
const notifications = new EmailNotificationService(db, config, { send: async message => { sent.push(message); } });
let server, browser, page;

function item(name) {
  return service.execute(1, { action: "create", item: { id: randomUUID(), name, plan: "Fixture", category: "其他服务", amount: 10,
    currency: "CNY", cycle: "monthly", customDays: 30, startDate: today, endDate: renewDate(today, "monthly", 30),
    reminderDays: 7, autoRenew: false, note: "isolated fixture", color: "#269979", version: 0 } }).item;
}
function renew(current) {
  now += 1000;
  return service.execute(1, { action: "renew", id: current.id, version: current.version, requestId: randomUUID(),
    payment: { amount: 10, currency: "CNY", paidOn: today, note: "isolated fixture" } });
}
const count = () => Number(db.prepare("SELECT count(*) AS count FROM subscription_renewal_logs WHERE user_id=1").get().count);
const exists = id => Boolean(db.prepare("SELECT id FROM subscription_renewal_logs WHERE user_id=1 AND id=?").get(id));
const reminderButton = () => page.getByRole("button", { name: /^提醒中心/ });
const settingsForm = () => page.getByRole("form", { name: "邮件配置", exact: true });
async function openSettings() {
  await page.getByRole("button", { name: "配置邮件提醒", exact: true }).click();
  await settingsForm().getByLabel("发件邮箱", { exact: true }).waitFor();
}
async function saveSettings() {
  await settingsForm().getByRole("button", { name: "保存配置", exact: true }).click();
  await settingsForm().waitFor({ state: "hidden" });
}
async function closeDialog() {
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
}

try {
  await mkdir(output, { recursive: true });
  await bootstrapAdmin(db, config);
  const undoItem = item("撤销测试"), active = renew(item("删除付款测试"));
  const app = express(), api = createApp(db, config, notifications);
  app.use((req, res, next) => req.path.startsWith("/api/") ? api(req, res, next) : next());
  app.use(express.static(fileURLToPath(new URL("../frontend/dist/", import.meta.url))));
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  config.publicOrigin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}) });
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
  await page.goto(config.publicOrigin);

  // Saving a renewal and immediately undoing it must leave no canceled history row.
  await page.getByRole("button", { name: "编辑撤销测试", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "记录续费", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "保存本次续费", exact: true }).click();
  await page.getByRole("button", { name: "撤销", exact: true }).waitFor();
  assert.equal(count(), 2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByText("已撤销本次续费记录", { exact: true }).waitFor();
  assert.equal(count(), 1);
  assert.equal(service.get(1, undoItem.id).endDate, undoItem.endDate);

  // Cancel and a simulated HTTP failure preserve a real payment; deletion preserves coverage.
  await page.getByRole("button", { name: "续费记录", exact: true }).click();
  let row = page.getByRole("article", { name: "删除付款测试续费记录", exact: true });
  await row.getByText("更多信息", { exact: true }).click();
  await row.getByRole("button", { name: "删除付款", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  assert.ok(exists(active.renewal.id));
  const deleteFailure = route => route.fulfill({ status: 500, json: { error: "模拟删除失败", code: "FIXTURE_FAILURE" } });
  await page.route("**/api/payments/void", deleteFailure);
  await row.getByRole("button", { name: "删除付款", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByText("模拟删除失败", { exact: true }).waitFor();
  assert.ok(exists(active.renewal.id));
  assert.ok(await page.getByRole("alertdialog").isVisible());
  await page.unroute("**/api/payments/void", deleteFailure);
  const expiryBeforeDelete = service.get(1, active.item.id).endDate;
  await page.getByRole("alertdialog").getByRole("button", { name: "确认删除", exact: true }).click();
  await page.getByRole("alertdialog").waitFor({ state: "hidden" });
  await row.waitFor({ state: "hidden" });
  assert.equal(exists(active.renewal.id), false);
  assert.equal(service.get(1, active.item.id).endDate, expiryBeforeDelete);
  assert.equal(count(), 0);
  await closeDialog();

  // The single row on page 2 is removed; the page clamps back to its 30 valid rows.
  let paginationItem = item("分页测试");
  const paginationLogs = [];
  now = Date.now() - 60_000;
  for (let index = 0; index < 31; index++) { const result = renew(paginationItem); paginationItem = result.item; paginationLogs.push(result.renewal); }
  await page.reload();
  await page.getByRole("button", { name: "续费记录", exact: true }).click();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ledger-row").length === 1);
  row = page.locator(".ledger-row");
  await row.getByText("更多信息", { exact: true }).click();
  await row.getByRole("button", { name: "删除付款", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "确认删除", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ledger-row").length === 30);
  assert.equal(await page.locator(".history-pagination").count(), 0);
  assert.equal(count(), 30);
  assert.equal(exists(paginationLogs[0].id), false);
  assert.equal(service.get(1, paginationItem.id).endDate, paginationItem.endDate);
  await page.screenshot({ path: join(output, "history-after-delete.png") });
  await closeDialog();

  // Configure disposable email settings; the sender is fake and never reaches SMTP.
  await reminderButton().click();
  await openSettings();
  let form = settingsForm();
  await form.getByLabel("发件邮箱", { exact: true }).fill("fixture@qq.com");
  await form.getByLabel("收件邮箱", { exact: true }).fill("recipient@qq.com");
  await form.getByLabel("SMTP 授权码", { exact: true }).fill(authorizationCode);
  await form.getByLabel("自动到期提醒", { exact: true }).check();
  await form.getByLabel("每天提醒时间", { exact: true }).fill("08:25");
  await saveSettings();
  assert.equal(config.email.enabled, true);
  assert.equal(config.email.to, "recipient@qq.com");
  assert.equal(config.email.password, authorizationCode);
  assert.equal(config.email.reminderHour, 8);
  assert.equal(config.email.reminderMinute, 25);
  assert.equal(sent.length, 0, "saving settings must not send email");
  assert.equal(JSON.parse(await readFile(filename, "utf8")).SMTP_PASSWORD, authorizationCode);

  await openSettings(); form = settingsForm();
  assert.equal(await form.getByLabel("SMTP 授权码", { exact: true }).inputValue(), "");
  await form.getByLabel("每天提醒时间", { exact: true }).fill("08:30");
  await saveSettings();
  assert.equal(config.email.password, authorizationCode, "blank code retains the saved server code");
  assert.equal(config.email.reminderMinute, 30);
  assert.equal(sent.length, 0);
  const viewResponse = await context.request.get(`${config.publicOrigin}/api/notifications/settings`);
  const viewText = await viewResponse.text();
  assert.equal(viewText.includes(authorizationCode), false);
  assert.equal(Object.hasOwn(JSON.parse(viewText), "password"), false);

  await openSettings(); form = settingsForm();
  await form.getByLabel("SMTP 授权码", { exact: true }).fill(replacementCode);
  let releaseSave;
  const failedSaveGate = new Promise(resolve => { releaseSave = resolve; });
  const settingsFailure = async route => {
    if (route.request().method() !== "POST") return route.continue();
    await failedSaveGate;
    return route.fulfill({ status: 500, json: { error: "模拟配置保存失败", code: "FIXTURE_FAILURE" } });
  };
  await page.route("**/api/notifications/settings", settingsFailure);
  await form.getByRole("button", { name: "保存配置", exact: true }).click();
  await form.getByRole("button", { name: "保存中…", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  assert.equal(await form.isVisible(), true);
  releaseSave();
  await form.getByText("模拟配置保存失败", { exact: true }).waitFor();
  assert.equal(await form.getByLabel("SMTP 授权码", { exact: true }).inputValue(), "");
  assert.equal(config.email.password, authorizationCode);
  await page.unroute("**/api/notifications/settings", settingsFailure);
  await form.getByLabel("SMTP 授权码", { exact: true }).fill(replacementCode);
  await saveSettings();
  assert.equal(config.email.password, replacementCode);
  assert.equal(sent.length, 0);

  await openSettings(); form = settingsForm();
  assert.equal(await form.getByLabel("SMTP 授权码", { exact: true }).inputValue(), "");
  for (const appearance of ["dark", "light"]) {
    await page.evaluate(appearance => { document.documentElement.dataset.appearance = appearance; localStorage.setItem("membership-appearance", appearance); }, appearance);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 900 });
      const fit = await page.getByRole("dialog").evaluate(element => { const box = element.getBoundingClientRect(); return {
        left: box.left, right: box.right, width: box.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
        windowWidth: innerWidth, documentWidth: document.documentElement.scrollWidth,
      }; });
      assert.ok(fit.left >= 0 && fit.right <= width + 1 && fit.scrollWidth <= fit.clientWidth + 1 && fit.documentWidth <= width, JSON.stringify(fit));
      layouts.push({ appearance, width, ...fit });
      await page.screenshot({ path: join(output, `email-${appearance}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await form.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "发送测试邮件", exact: true }).click();
  await page.getByText("测试邮件已提交", { exact: true }).waitFor();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "recipient@qq.com");
  assert.equal(sent[0].from, "fixture@qq.com");
  assert.equal(notifications.status(1).recent[0].kind, "test");
  assert.equal(notifications.status(1).recent[0].status, "sent");
  assert.equal(await page.evaluate(codes => Object.values(localStorage).some(value => codes.some(code => value.includes(code))), [authorizationCode, replacementCode]), false);
  assert.deepEqual(errors, []);
  const result = { result: "PASS", scope: "isolated localhost / in-memory database / temporary private email file / fake mail sender",
    checks: ["undo removes the renewal row", "payment cancel/failure preserve data", "payment deletion retains coverage",
      "deleting page 2 clamps to 30 remaining rows", "settings save hot-applies without sending mail", "saved password is never returned or prefilled",
      "blank password preserves saved credentials", "failed settings save clears the input and permits retry", "saving prevents modal dismissal",
      "only explicit test-mail click calls the fake sender"], layouts, errors, externalOriginsBlocked: [...new Set(blocked)] };
  await writeFile(join(output, "results.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await page?.screenshot({ path: join(output, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await notifications.drain();
  if (server) await new Promise(resolve => server.close(resolve));
  db.close();
  // This directory was created by this script and contains only disposable fixture settings.
  assert.ok(basename(temporary).startsWith("vip-admin-settings-") && resolve(temporary).startsWith(resolve(tmpdir())));
  await rm(temporary, { recursive: true, force: true });
}
