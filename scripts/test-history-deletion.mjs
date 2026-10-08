/** Browser regression for history deletion; all writes use disposable, in-memory fixture data. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { readConfig } from "../backend/src/config.ts";
import { openDatabase } from "../backend/src/database.ts";
import { createApp } from "../backend/src/app.ts";
import { bootstrapAdmin } from "../backend/src/auth.ts";
import { SubscriptionService } from "../backend/src/subscriptions.ts";
import { RenewalHistory } from "../backend/src/renewal-history.ts";

const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const config = readConfig({ PUBLIC_ORIGIN:"http://127.0.0.1", COOKIE_SECURE:"false", PUBLIC_DASHBOARD:"true", ADMIN_USERNAME:"history-test", ADMIN_PASSWORD:randomUUID() });
const db = openDatabase(":memory:");
const output = fileURLToPath(new URL("../outputs/history-deletion-tests/",import.meta.url));
let server, browser;
try {
  await mkdir(output,{ recursive:true });
  await bootstrapAdmin(db,config);
  let now = Date.now() - 600_000;
  const service = new SubscriptionService(db,config.timeZone,() => new Date(now));
  const history = new RenewalHistory(db);
  function receipt(name, undone) {
    const original = service.execute(1,{ action:"create", item:{ id:randomUUID(), name, plan:"", category:"其他服务", amount:10, cycle:"monthly", customDays:30, startDate:"2198-01-31", endDate:"2198-02-28", reminderDays:7, autoRenew:false, note:"isolated fixture", color:"#269979", version:0 } }).item;
    const renewed = service.execute(1,{ action:"renew", id:original.id, version:0 });
    if (undone) service.execute(1,{ action:"undoRenew", id:original.id, version:1, logId:renewed.renewal.id });
    now += 1_000;
    return renewed.renewal;
  }
  const active = receipt("正常续费",false);
  const undone = receipt("撤销测试",true);
  const web = express(), api = createApp(db,config);
  web.use((req,res,next) => req.path.startsWith("/api/") ? api(req,res,next) : next());
  web.use(express.static(fileURLToPath(new URL("../frontend/dist/",import.meta.url))));
  server = web.listen(0,"127.0.0.1");
  await new Promise((resolve,reject) => { server.once("listening",resolve); server.once("error",reject); });
  config.publicOrigin = `http://127.0.0.1:${server.address().port}`;
  browser = await playwright.chromium.launch({ headless:true, ...(process.env.BROWSER_CHANNEL ? { channel:process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
  const csrf = { Origin:config.publicOrigin, "X-Requested-With":"membership-dashboard" };
  assert.equal((await context.request.post(config.publicOrigin + "/api/auth/login",{ headers:csrf, data:{ username:config.adminUsername, password:config.adminPassword } })).status(),200);
  const page = await context.newPage(), errors = [];
  page.on("pageerror",error => errors.push(error.message));
  await page.goto(config.publicOrigin);
  await page.getByRole("button",{ name:"流水", exact:true }).click();
  await page.locator(".history-entry").filter({ hasText:"撤销测试" }).waitFor();
  assert.equal(await page.locator(".history-entry").filter({ hasText:"正常续费" }).getByRole("button").count(),0);
  const deleteButton = page.getByRole("button",{ name:"删除撤销测试的已撤销流水", exact:true });
  await deleteButton.click();
  await page.getByRole("alertdialog").getByRole("button",{ name:"取消", exact:true }).click();
  assert.equal(history.list(1).total,2);
  await deleteButton.click();
  await page.route("**/api/subscriptions/history/delete",route => route.fulfill({ status:500, json:{ error:"测试删除失败", code:"TEST_FAILURE" } }));
  await page.getByRole("alertdialog").getByRole("button",{ name:"确认删除", exact:true }).click();
  await page.getByRole("alertdialog").getByRole("alert").getByText("测试删除失败",{ exact:true }).waitFor();
  assert.ok(history.get(1,undone.id));
  await page.unroute("**/api/subscriptions/history/delete");
  const before = service.list(1);
  await page.getByRole("alertdialog").getByRole("button",{ name:"确认删除", exact:true }).click();
  await page.getByRole("alertdialog").waitFor({ state:"hidden" });
  await page.locator(".history-entry").filter({ hasText:"撤销测试" }).waitFor({ state:"hidden" });
  await page.locator(".history-entry").filter({ hasText:"正常续费" }).waitFor();
  assert.deepEqual(service.list(1),before);
  assert.deepEqual(history.list(1).logs.map(log => log.id),[active.id]);
  await page.screenshot({ path:output + "/history-desktop.png" });
  console.log("PASS active entries have no delete action; cancel/failure preserve history; confirmed deletion preserves membership");

  await page.keyboard.press("Escape");
  now = Date.now() - 1_200_000;
  const last = receipt("最后一页撤销流水",true);
  now = Date.now();
  for (let index = 0; index < 49; index++) receipt(`分页撤销流水 ${index + 1}`,true);
  await page.reload();
  await page.getByRole("button",{ name:"流水", exact:true }).click();
  await page.getByRole("button",{ name:"下一页", exact:true }).click();
  await page.getByRole("button",{ name:"删除最后一页撤销流水的已撤销流水", exact:true }).waitFor();
  assert.equal(await page.locator(".history-entry").count(),1);
  await page.getByRole("button",{ name:"删除最后一页撤销流水的已撤销流水", exact:true }).click();
  await page.getByRole("alertdialog").getByRole("button",{ name:"确认删除", exact:true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".history-entry").length === 50);
  assert.equal(await page.locator(".history-pagination").count(),0);
  assert.equal(history.list(1).total,50);
  assert.throws(() => history.get(1,last.id),{ status:404 });
  await page.setViewportSize({ width:320, height:900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  for (const button of await page.locator(".history-delete").all()) {
    const box = await button.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 320);
  }
  await page.screenshot({ path:output + "/history-mobile.png" });
  assert.deepEqual(errors,[]);
  console.log("PASS deleting the last page returns to a valid page; 320px actions fit; no JavaScript errors");
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  db.close();
}
