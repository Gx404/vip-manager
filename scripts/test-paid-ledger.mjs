/** Paid-ledger UI regression against an isolated API and in-memory SQLite. Never targets production. */
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
import { saveBillingFact } from "../backend/src/billing-facts.ts";
import { dateInTimeZone } from "../shared/billing.ts";
import { renewDate, shiftDate } from "../shared/subscriptions.ts";
import { paymentState } from "../shared/payments.ts";
import { spendingSummary } from "../shared/payment-reports.ts";

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const temporary=await mkdtemp(join(tmpdir(),"vip-paid-ledger-"));
const output=fileURLToPath(new URL("../outputs/paid-ledger-tests/",import.meta.url));
const config=readConfig({PUBLIC_ORIGIN:"http://127.0.0.1",COOKIE_SECURE:"false",PUBLIC_DASHBOARD:"true",
  ADMIN_USERNAME:"paid-ledger-test",ADMIN_PASSWORD:randomUUID(),EMAIL_CONFIG_FILE:join(temporary,"email-settings.json"),APP_TIMEZONE:"Asia/Shanghai"});
const db=openDatabase(":memory:"),errors=[],blocked=[],checks=[],layouts=[];
const today=dateInTimeZone(new Date(),config.timeZone);
const rates=new ExchangeRates(async()=>{throw new Error("CNY-only fixtures must not call external FX");});
const service=new SubscriptionService(db,config.timeZone,()=>new Date(),rates);
const payments=new PaymentService(db,rates,{timeZone:config.timeZone});
const current=id=>service.list(1).items.find(item=>item.id===id);
const actual=()=>payments.all(1).filter(log=>paymentState(log)==="paid");
const totals=()=>spendingSummary(payments.all(1),today);
let server,browser,page,releaseHeld;
const dialog=()=>page.getByRole("dialog").last();
const alert=()=>page.getByRole("alertdialog");
const monthDate=(value,offset,day)=>{
  const date=new Date(`${value}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+offset,day)).toISOString().slice(0,10);
};

async function closeDialog() {
  const title=await dialog().locator('[data-slot="dialog-title"]').innerText();
  await dialog().getByRole("button",{name:"Close",exact:true}).click();
  await page.getByRole("heading",{name:title,exact:true}).waitFor({state:"hidden"});
}
async function screenshot(label,{modal=false,confirmation=false}={}) {
  for(const dark of [false,true]) for(const width of [1440,390]) {
    await page.setViewportSize({width,height:width===390?844:1000});
    await page.evaluate(dark=>{
      document.documentElement.dataset.appearance=dark?"dark":"light";
      document.documentElement.classList.toggle("dark",dark);
    },dark);
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);
    assert.equal(overflow,false,`${label} page ${width}px`);
    if(modal||confirmation) {
      const local=await (confirmation?alert():dialog()).evaluate(element=>element.scrollWidth>element.clientWidth+1);
      assert.equal(local,false,`${label} dialog ${width}px`);
    }
    const filename=`${label}-${width}-${dark?"dark":"light"}.png`;
    await page.screenshot({path:join(output,filename),fullPage:true,animations:"disabled"}); layouts.push(filename);
    if(label==="initial-payment-editor") {
      await dialog().getByRole("checkbox",{name:"本期已付款",exact:true}).scrollIntoViewIfNeeded();
      const detail=`${label}-payment-${width}-${dark?"dark":"light"}.png`;
      await page.screenshot({path:join(output,detail),fullPage:true,animations:"disabled"});layouts.push(detail);
      await dialog().evaluate(element=>{element.scrollTop=0;});
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>{document.documentElement.dataset.appearance="light";document.documentElement.classList.remove("dark");});
}
async function overview(expected) {
  await page.waitForFunction(value=>{
    const element=document.querySelector(".spending-summary .summary-number");
    return element?.textContent?.replaceAll(",","").replaceAll("¥","").trim()===value;
  },expected.toFixed(2));
  assert.equal((await page.locator(".annual-summary .summary-number").innerText()).replaceAll(",","").replaceAll("¥","").trim(),expected.toFixed(2));
}
async function fillCreate(name,amount,paid=true) {
  await page.getByRole("button",{name:"添加订阅",exact:true}).first().click();
  await dialog().getByLabel("会员名称 *",{exact:true}).fill(name);
  await dialog().getByLabel("费用 *",{exact:true}).fill(String(amount));
  assert.equal(await dialog().getByRole("checkbox",{name:"本期已付款",exact:true}).isChecked(),true);
  if(!paid) await dialog().getByRole("checkbox",{name:"本期已付款",exact:true}).uncheck();
}
async function saveCreate() {
  const [response]=await Promise.all([
    page.waitForResponse(response=>response.url().endsWith("/api/subscriptions")&&response.request().method()==="POST"&&response.request().postDataJSON()?.action==="create"),
    dialog().getByRole("button",{name:"保存",exact:true}).click(),
  ]);
  assert.equal(response.status(),201,await response.text());
  const result=await response.json();
  await page.getByRole("heading",{name:"添加订阅",exact:true}).waitFor({state:"hidden"});
  return result.item;
}
async function openHistory(id) {
  await page.getByRole("button",{name:"续费记录",exact:true}).click();
  await dialog().getByLabel("筛选订阅",{exact:true}).selectOption(id??"");
}
async function saveBackfill(amount,paidOn=today) {
  await dialog().getByLabel("本次实付金额",{exact:true}).fill(String(amount));
  await dialog().getByLabel("实际付款日期",{exact:true}).fill(paidOn);
  const [response]=await Promise.all([
    page.waitForResponse(response=>response.url().endsWith("/api/payments/backfill")&&response.request().method()==="POST"),
    dialog().getByRole("button",{name:"保存这期已付款",exact:true}).click(),
  ]);
  assert.equal(response.status(),200,await response.text());
  assert.equal((await response.json()).added,1);
  await dialog().getByRole("button",{name:"保存这期已付款",exact:true}).waitFor({state:"hidden"});
}

try {
  await mkdir(output,{recursive:true});
  await bootstrapAdmin(db,config);
  const create=(name,overrides={})=>service.execute(1,{action:"create",item:{id:randomUUID(),name,plan:"Fixture",category:"其他服务",amount:9,currency:"CNY",
    cycle:"monthly",customDays:30,startDate:today,endDate:renewDate(today,"monthly",30),purchaseDate:today,fxRateToCny:1,fxRateDate:today,fxRateSource:"manual",
    reminderDays:7,autoRenew:false,note:"isolated paid-ledger fixture",color:"#269979",version:0,...overrides}}).item;
  const originalStart=monthDate(today,-3,10),originalEnd=monthDate(today,-2,10);
  const auto=create("多期自动顺延测试",{startDate:originalStart,endDate:originalEnd,purchaseDate:originalStart,fxRateDate:originalStart,autoRenew:true,amount:11});
  assert.equal(service.advanceAutomaticRenewals(),1);
  const automatic=payments.all(1).find(log=>log.subscriptionId===auto.id);
  assert.ok(automatic.periods>1);
  const autoPeriods=payments.pendingPeriods(1,automatic.id).periods;
  assert.ok(autoPeriods.length>1);
  saveBillingFact(db,1,{id:randomUUID(),subscriptionId:randomUUID(),schedule:{subscriptionName:"Gemini 已删除估算测试",plan:"",category:"AI 工具",
    previousStartDate:"2026-08-18",previousEndDate:"2027-08-18",newStartDate:"2027-08-18",newEndDate:"2028-08-18",amount:38,currency:"CNY",fxRateToCny:1,
    previousRatePending:false,periods:1,createdAt:new Date().toISOString()}});
  assert.equal(totals().monthTotal,0); assert.equal(totals().yearTotal,0);
  const api=createApp(db,config,undefined,rates),web=express();
  web.use((req,res,next)=>req.path.startsWith("/api/")?api(req,res,next):next());
  web.use(express.static(fileURLToPath(new URL("../frontend/dist/",import.meta.url))));
  server=web.listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  config.publicOrigin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce",timezoneId:"America/Los_Angeles"});
  await context.route("**/*",route=>{
    const url=route.request().url();
    if(url.startsWith(config.publicOrigin+"/")||url.startsWith("data:")||url.startsWith("blob:")) return route.continue();
    blocked.push(new URL(url).origin); return route.abort("blockedbyclient");
  });
  const login=await context.request.post(`${config.publicOrigin}/api/auth/login`,{headers:{Origin:config.publicOrigin,"X-Requested-With":"membership-dashboard"},data:{username:config.adminUsername,password:config.adminPassword}});
  assert.equal(login.status(),200);
  page=await context.newPage(); page.on("pageerror",error=>errors.push(error.message));
  await page.goto(config.publicOrigin); await overview(0);
  checks.push("unpaid-schedules-and-deleted-gemini-estimates-do-not-create-expenses");

  await fillCreate("首笔付款丢包测试",12.5);
  assert.equal(await dialog().getByLabel("首次付款日期",{exact:true}).inputValue(),today,"form uses application date despite browser timezone");
  await screenshot("initial-payment-editor",{modal:true});
  let intercept=true,firstRequest,commitResolve;
  const committed=new Promise(resolve=>{commitResolve=resolve;});
  const held=new Promise(resolve=>{releaseHeld=resolve;});
  await page.route("**/api/subscriptions",async route=>{
    const request=route.request(),body=request.method()==="POST"?request.postDataJSON():null;
    if(intercept&&body?.action==="create"&&body.item.name==="首笔付款丢包测试") {
      intercept=false; firstRequest=body;
      const response=await route.fetch(); assert.equal(response.status(),201,await response.text());
      commitResolve(); await held; return route.abort("failed");
    }
    return route.continue();
  });
  await dialog().getByRole("button",{name:"保存",exact:true}).click(); await committed;
  assert.equal(await dialog().getByRole("button",{name:"取消",exact:true}).isDisabled(),true);
  assert.equal(await dialog().getByRole("button",{name:"Close",exact:true}).count(),0);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("heading",{name:"添加订阅",exact:true}).isVisible(),true);
  assert.equal(actual().length,1);
  releaseHeld();
  await dialog().getByRole("button",{name:"保存",exact:true}).waitFor();
  const first=await saveCreate();
  assert.equal(first.id,firstRequest.item.id);
  assert.equal(actual().filter(log=>log.subscriptionId===first.id).length,1);
  assert.equal(service.list(1).items.filter(item=>item.id===first.id).length,1);
  await overview(12.5);
  checks.push("checked-first-payment-counts-in-month-and-year","pending-editor-cannot-close","lost-create-response-reuses-stable-id-without-duplicate-member-or-payment");

  await fillCreate("未付款新增测试",20,false);
  const unpaid=await saveCreate(); await overview(12.5);
  assert.equal(actual().some(log=>log.subscriptionId===unpaid.id),false);
  await openHistory(unpaid.id);
  let failReconciliation=true;
  await page.route("**/api/payments/reconciliation",route=>{
    if(failReconciliation) {failReconciliation=false;return route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"隔离测试：读取失败，请重试。"})});}
    return route.continue();
  });
  await dialog().getByRole("button",{name:"待核对付款",exact:true}).click();
  await dialog().getByRole("alert").waitFor(); await dialog().getByRole("button",{name:"重试",exact:true}).click();
  await dialog().getByRole("article",{name:"未付款新增测试待核对账期",exact:true}).waitFor();
  assert.match(await dialog().innerText(),/不计入支出/);
  await screenshot("unconfirmed-period",{modal:true});
  await dialog().getByRole("button",{name:"登记已付款",exact:true}).click();
  assert.equal(await dialog().getByLabel("本次实付金额",{exact:true}).inputValue(),"20");
  await saveBackfill(18.6);
  await dialog().getByText("没有尚待核对的已知账期。已登记的付款可在续费记录中查看。",{exact:true}).waitFor();
  await closeDialog(); await closeDialog(); await overview(31.1);
  assert.equal(actual().find(log=>log.subscriptionId===unpaid.id).payment.amount,18.6);
  checks.push("unchecked-create-remains-unpaid","reconciliation-read-error-is-retryable","explicit-first-period-confirmation-uses-real-amount-without-rescheduling");

  await fillCreate("彻底删除测试",7);
  const purge=await saveCreate(); await overview(38.1);
  await page.getByRole("button",{name:"编辑彻底删除测试",exact:true}).click();
  await dialog().getByRole("button",{name:"删除",exact:true}).click();
  assert.equal(await alert().getByRole("radio",{name:"保留已付款记录",exact:true}).isChecked(),true);
  await alert().getByRole("radio",{name:"彻底删除",exact:true}).check();
  assert.equal(await alert().getByRole("button",{name:"彻底删除",exact:true}).isDisabled(),true);
  await alert().getByRole("checkbox",{name:"确认同时删除这条会员的全部历史",exact:true}).check();
  await screenshot("purge-confirmation",{confirmation:true});
  await alert().getByRole("button",{name:"彻底删除",exact:true}).click();
  await alert().waitFor({state:"hidden"}); await overview(31.1);
  assert.equal(current(purge.id),undefined);
  for(const table of ["subscription_renewal_logs","subscription_billing_facts","automatic_renewal_events","email_notification_deliveries"])
    assert.equal(Number(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id=1 AND subscription_id=?`).get(purge.id).n),0,table);
  await page.getByRole("button",{name:"编辑首笔付款丢包测试",exact:true}).click();
  await dialog().getByRole("button",{name:"删除",exact:true}).click();
  assert.equal(await alert().getByRole("radio",{name:"保留已付款记录",exact:true}).isChecked(),true);
  await alert().getByRole("button",{name:"删除并保留付款",exact:true}).click();
  await alert().waitFor({state:"hidden"}); await overview(31.1);
  assert.equal(current(first.id),undefined);assert.equal(actual().filter(log=>log.subscriptionId===first.id).length,1);
  assert.equal(actual().filter(log=>log.subscriptionId===unpaid.id).length,1);
  checks.push("purge-needs-explicit-confirmation-and-removes-only-target-history","default-delete-keeps-real-payments-and-other-memberships");

  await openHistory(auto.id);
  await dialog().getByRole("button",{name:"逐期核对付款",exact:true}).click();
  await dialog().getByRole("button",{name:"登记已付款",exact:true}).first().waitFor();
  assert.equal(await dialog().getByRole("button",{name:"登记已付款",exact:true}).count(),autoPeriods.length);
  await screenshot("automatic-periods",{modal:true});
  for(let index=0;index<autoPeriods.length;index++) {
    await dialog().getByRole("button",{name:"登记已付款",exact:true}).first().click();
    await saveBackfill(11,today);
  }
  await dialog().getByText("没有尚待核对的已知账期。已登记的付款可在续费记录中查看。",{exact:true}).waitFor();
  assert.equal(payments.pendingPeriods(1,automatic.id).periods.length,0);
  await closeDialog(); await closeDialog(); await overview(31.1+11*autoPeriods.length);
  assert.equal(actual().filter(log=>log.subscriptionId===auto.id).length,autoPeriods.length);
  checks.push("multi-period-automatic-schedule-does-not-assert-payment","automatic-catch-up-is-payable-one-real-period-at-a-time");

  const leap=create("闰年续费预览测试",{cycle:"yearly",startDate:"2024-02-29",endDate:"2025-02-28",purchaseDate:"2024-02-29",fxRateDate:"2024-02-29"});
  for(let count=0;count<2;count++) {const item=current(leap.id);service.execute(1,{action:"renew",id:item.id,version:item.version,renewalMode:"continue"});}
  await page.reload();
  await page.getByRole("button",{name:"编辑闰年续费预览测试",exact:true}).click();
  await dialog().getByRole("button",{name:"记录续费",exact:true}).click();
  assert.match(await dialog().locator(".renewal-period").innerText(),/2027-02-28.*2028-02-29/s);
  await closeDialog();checks.push("leap-year-preview-keeps-the-original-February-29-anchor");

  await page.getByRole("button",{name:"支出分析",exact:true}).click();
  await page.getByRole("combobox",{name:"统计范围",exact:true}).selectOption("all");
  await page.locator(".report-list li").first().waitFor();
  assert.equal(await page.locator(".report-list li").filter({hasText:"Gemini 已删除估算测试"}).count(),0);
  assert.equal(await page.locator(".report-list li").filter({hasText:"首笔付款丢包测试"}).count(),1);
  assert.equal(await page.locator(".report-list li").filter({hasText:"彻底删除测试"}).count(),0);
  assert.equal(await page.locator(".report-context").innerText().then(text=>text.includes("笔待确认")),false);
  await screenshot("paid-only-report");
  checks.push("reports-exclude-deleted-estimates-and-purged-payments-but-keep-retained-payments","fully-reconciled-automatic-period-is-no-longer-actionable","desktop-mobile-light-dark-without-horizontal-overflow");
  assert.deepEqual(errors,[]);checks.push("no-javascript-errors");
  const result={passed:true,today,checks,layouts,pageErrors:errors,blockedOrigins:[...new Set(blocked)],productionDataWritten:false};
  await writeFile(join(output,"result.json"),JSON.stringify(result,null,2)+"\n"); console.log(JSON.stringify(result,null,2));
} catch(error) {
  await page?.screenshot({path:join(output,"failure.png"),fullPage:true}).catch(()=>{});
  await writeFile(join(output,"result.json"),JSON.stringify({passed:false,today,checks,layouts,pageErrors:errors,error:error instanceof Error?error.message:String(error),productionDataWritten:false},null,2)+"\n");
  throw error;
} finally {
  releaseHeld?.();await browser?.close();
  await new Promise(resolve=>server?server.close(resolve):resolve());db.close();
  await rm(temporary,{recursive:true,force:true});
}
