/** Isolated production-build browser regression; all writes target a disposable in-memory database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { readConfig } from "../backend/src/config.ts";
import { openDatabase } from "../backend/src/database.ts";
import { ExchangeRates } from "../backend/src/exchange-rates.ts";
import { createApp } from "../backend/src/app.ts";
import { bootstrapAdmin } from "../backend/src/auth.ts";
import { SubscriptionService } from "../backend/src/subscriptions.ts";
import { EmailNotificationService } from "../backend/src/notifications.ts";
import { dateKey, shiftDate } from "../shared/subscriptions.ts";
import { brands } from "../shared/brands.ts";
import { categories } from "../shared/subscriptions.ts";

const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const config = readConfig({ PUBLIC_ORIGIN:"http://127.0.0.1", COOKIE_SECURE:"false", PUBLIC_DASHBOARD:"true", ADMIN_USERNAME:"browser-test", ADMIN_PASSWORD:randomUUID() });
const db=openDatabase(":memory:");
let server, browser;
const output=fileURLToPath(new URL("../outputs/browser-tests/",import.meta.url));
try {
  await mkdir(output,{recursive:true});
  await bootstrapAdmin(db,config);
  const service=new SubscriptionService(db,config.timeZone), today=dateKey();
  const names=["ChatGPT Plus","百度网盘","淘宝88VIP","哔哩哔哩大会员","iCloud+","自定义测试"];
  for (const [index,name] of names.entries()) service.execute(1,{action:"create",item:{id:randomUUID(),name,plan:"测试套餐",category:["AI 工具","云盘存储","购物会员","影音娱乐","云盘存储","其他服务"][index],amount:20+index,cycle:"monthly",customDays:30,startDate:shiftDate(today,-20),endDate:shiftDate(today,2+index),reminderDays:7,autoRenew:index===4,note:"isolated browser fixture",color:"#269979",version:0,...(index===0?{currency:"USD",purchaseDate:"2024-05-05",fxRateToCny:7.2352,fxRateDate:"2024-05-03",fxRateSource:"frankfurter"}:{})}});
  const emailConfig={ ...config,email:{ ...config.email,username:'owner@qq.com',password:'browser-test-only',from:'owner@qq.com',to:'owner@qq.com' } };
  let emailCount=0;
  const notifications=new EmailNotificationService(db,emailConfig,{send:async()=>{emailCount++;}});
  const api=createApp(db,config,notifications,new ExchangeRates(async input=>{const url=new URL(String(input));return Response.json({date:url.searchParams.get("date"),base:url.pathname.split("/").at(-2).toUpperCase(),quote:"CNY",rate:7.2352});})), web=express();
  web.use((req,res,next)=>req.path.startsWith("/api/")?api(req,res,next):next());
  web.use(express.static(fileURLToPath(new URL("../frontend/dist/",import.meta.url))));
  server=web.listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  config.publicOrigin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const csrf={"X-Requested-With":"membership-dashboard",Origin:config.publicOrigin};
  const page=await context.newPage(), errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  const records=async()=>(await (await context.request.get(config.publicOrigin+"/api/subscriptions")).json()).items;
  await page.goto(config.publicOrigin);
  await page.getByRole("heading",{name:"ChatGPT Plus",exact:true}).waitFor();
  const assertGuest=async()=>{
    assert.deepEqual(await page.locator('.header-actions button').allTextContents(),['管理员登录']);
    assert.equal(await page.locator('.overview button,.summary-link,.card-actions,.report-page,.help-tooltip').count(),0);
    assert.equal(await page.getByRole('dialog').count(),0);
    assert.equal(await page.locator('.spending-summary').evaluate(el=>el.tagName),'DIV');
    assert.equal(await page.locator('.spending-summary').evaluate(el=>el.tabIndex),-1);
  };
  await assertGuest();
  await page.locator('.spending-summary').click();await assertGuest();
  assert.equal((await context.request.get(config.publicOrigin+'/api/backup')).status(),401);
  assert.equal((await context.request.get(config.publicOrigin+'/api/subscriptions/history')).status(),401);
  assert.equal((await context.request.get(config.publicOrigin+'/api/notifications/status')).status(),401);
  for (const width of [320,390,1440]) {
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const amount=page.getByRole('article',{name:'ChatGPT Plus',exact:true}).locator('.currency-amount');
    assert.equal((await amount.innerText()).replace(/\s+/g,' '),'USD 20.00');
    assert.equal(await amount.getAttribute('title'),'美元 · USD');
    assert.ok(await amount.locator('.currency-code').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=13));
    assert.ok(await amount.evaluate(el=>{
      const code=el.querySelector('.currency-code').getBoundingClientRect(), value=el.querySelector('.currency-value').getBoundingClientRect();
      return code.right<=value.left && code.top<value.bottom && value.top<code.bottom;
    }),`Currency and amount should share one line at ${width}`);
    assert.deepEqual(await page.locator('.subscription-card .currency-code').allTextContents(),['USD','CNY','CNY','CNY','CNY','CNY']);
    await page.screenshot({path:output+`/guest-${width}.png`,fullPage:width===1440});
  }
  await page.getByRole('button',{name:'管理员登录',exact:true}).click();
  await page.getByLabel('管理员账号',{exact:true}).fill(config.adminUsername);
  await page.getByLabel('密码',{exact:true}).fill(config.adminPassword);
  await page.getByRole('button',{name:'登录',exact:true}).click();
  await page.getByRole('button',{name:'退出',exact:true}).waitFor();
  assert.equal(await page.locator('.header-toolbox').count(),1);
  assert.equal(await page.locator('.header-toolbox .header-utility').count(),5);
  const utilityShape=await page.locator('.header-toolbox .header-utility').evaluateAll(buttons=>buttons.map(button=>{const style=getComputedStyle(button);return {height:style.height,borderRadius:style.borderRadius,border:style.border};}));
  assert.equal(new Set(utilityShape.map(item=>item.height)).size,1);
  assert.equal(new Set(utilityShape.map(item=>item.borderRadius)).size,1);
  assert.equal(await page.locator('.header-secondary').count(),0);
  console.log('PASS guest-only subscription browsing, static overview, private API auth and UI login');
  assert.equal(await page.locator(".subscription-card").count(),6);
  assert.equal(await page.locator(".overview .summary-card").count(),2);
  assert.equal(await page.locator(".header-date").count(),0);
  assert.doesNotMatch(await page.locator(".header-actions").innerText(), /\d{4}\.\d{2}\.\d{2}/);
  assert.equal(await page.locator(".page-footer time").count(),1);
  assert.equal(await page.locator(".status-legend > span").count(),3);
  await page.getByRole("button",{name:"月均支出，查看摊算明细",exact:true}).click();
  await page.getByRole("heading",{name:"月均支出明细",exact:true}).waitFor();
  assert.equal(await page.locator('.help-tooltip').count(),0);
  await page.screenshot({path:output+'/cost-compact.png',animations:'disabled'});
  const help=page.getByRole('button',{name:'月均支出计算说明',exact:true});
  await help.hover();await page.locator('.help-tooltip').waitFor();
  await page.screenshot({path:output+'/cost-help.png',animations:'disabled'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.help-tooltip').count(),0);
  assert.equal(await page.getByRole('dialog').count(),1);
  await help.focus();await help.press('Enter');await page.locator('.help-tooltip').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(),1);
  await page.keyboard.press("Escape");
  const fonts=await page.evaluate(()=>['.service-name p','.expiry-date','.small-label','.progress-caption'].map(selector=>parseFloat(getComputedStyle(document.querySelector(selector)).fontSize)));
  assert.ok(fonts.every(size=>size>=13),JSON.stringify(fonts));
  const touchContext=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,storageState:await context.storageState()});
  const touch=await touchContext.newPage();await touch.goto(config.publicOrigin);
  await touch.getByRole('button',{name:'月均支出，查看摊算明细',exact:true}).tap();
  await touch.getByRole('button',{name:'月均支出计算说明',exact:true}).tap();
  await touch.locator('.help-tooltip').waitFor();
  assert.ok(await touch.locator('.help-tooltip').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
  await touch.screenshot({path:output+'/touch-help.png',animations:'disabled'});
  await touch.getByRole('button',{name:'月均支出计算说明',exact:true}).tap();
  assert.equal(await touch.locator('.help-tooltip').count(),0);
  await touch.getByRole('button',{name:'月均支出计算说明',exact:true}).tap();
  await touch.locator('.help-tooltip').waitFor();
  await touch.keyboard.press('Escape');assert.equal(await touch.getByRole('dialog').count(),1);
  await touchContext.close();await page.bringToFront();
  console.log('PASS on-demand help: closed by default, hover, keyboard, touch, Escape and readable text');
  assert.equal(await page.locator(".subscription-grid .quick-renew").count(),0);
  assert.equal(await page.getByRole("button",{name:/快捷续费/}).count(),0);
  await page.getByRole("button",{name:"添加订阅",exact:true}).click();
  assert.equal(await page.locator('.help-tooltip').count(),0);
  await page.screenshot({path:output+'/editor-compact.png',animations:'disabled'});
  await page.getByLabel("本期开始日期").fill("2026-01-31");
  assert.equal(await page.getByLabel("本期到期日期").inputValue(),"2026-02-28");
  assert.equal(await page.getByLabel("购买日期（汇率基准）").count(),0);
  await page.getByLabel("续费周期",{exact:true}).selectOption("quarterly");
  assert.equal(await page.getByLabel("本期到期日期").inputValue(),"2026-04-30");
  await page.getByLabel("本期到期日期").fill("2026-05-12");
  await page.getByLabel("本期开始日期").fill("2026-02-01");
  await page.getByRole("button",{name:"淘宝88VIP",exact:true}).click();
  assert.equal(await page.getByLabel("本期到期日期").inputValue(),"2026-05-12");
  assert.equal(await page.getByLabel("分类",{exact:true}).inputValue(),"购物电商");
  assert.deepEqual(await page.getByLabel("分类",{exact:true}).locator('option').allTextContents(),categories);
  assert.equal(await page.getByLabel("续费周期",{exact:true}).inputValue(),"yearly");
  await page.getByRole("button",{name:"重新计算",exact:true}).click();
  assert.equal(await page.getByLabel("本期到期日期").inputValue(),"2027-02-01");
  await page.getByLabel("付款币种").selectOption("USD");
  await page.getByLabel("本期开始日期").fill("2024-05-05");
  await page.getByText(/参考汇率：1 USD/).waitFor();
  assert.match(await page.locator('.auto-fx').innerText(),/2024-05-05/);
  assert.equal(await page.getByLabel(/购买时汇率/).count(),0);
  await page.getByLabel("本期开始日期").fill("2024-06-05");
  await page.getByText(/报价 2024-06-05/).waitFor();
  await page.getByRole("button",{name:"取消",exact:true}).click();
  console.log("PASS date linking, manual override, template defaults and explicit reset");

  const original=(await records()).find(item=>item.name==="ChatGPT Plus");
  await page.getByRole("button",{name:"编辑ChatGPT Plus",exact:true}).click();
  assert.equal(await page.getByLabel("购买日期（汇率基准）").count(),0);
  await page.getByLabel("套餐名称").fill("unsaved");
  assert.equal(await page.getByRole("button",{name:"快捷续费",exact:true}).isDisabled(),true);
  await page.getByLabel("套餐名称").fill("测试套餐");
  await page.getByRole('button',{name:'删除',exact:true}).click();
  assert.equal(await page.getByRole('alertdialog').getByText(/删除后不能在页面内撤销/).isVisible(),true);
  await page.getByRole('alertdialog').getByRole('button',{name:'取消',exact:true}).click();
  await page.getByRole("button",{name:"快捷续费",exact:true}).click();
  await page.getByRole("button",{name:"撤销",exact:true}).click();
  await page.getByText("已撤销本次续费记录",{exact:true}).waitFor();
  assert.equal((await records()).find(item=>item.id===original.id).endDate,original.endDate);
  await page.getByRole("button",{name:/提醒中心/}).click();
  await page.getByRole('button',{name:'发送测试邮件',exact:true}).click();
  await page.getByText('测试邮件已提交',{exact:true}).waitFor();
  assert.equal(emailCount,1);
  assert.equal(await page.getByRole('button',{name:/秒后可重试/}).isDisabled(),true);
  await page.getByText('最近发送记录',{exact:true}).click();
  await page.getByText('测试邮件 · 已提交',{exact:true}).waitFor();
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:output+'/email-reminders-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  console.log('PASS private email status, simulated test send, cooldown, recent delivery and mobile layout');
  assert.equal(await page.getByRole("dialog").getByRole("button",{name:/快捷续费/}).count(),0);
  await page.getByRole("button",{name:"管理百度网盘",exact:true}).click();
  await page.getByRole("button",{name:"快捷续费",exact:true}).click();
  await page.getByRole("button",{name:"撤销",exact:true}).click();
  const history=await (await context.request.get(config.publicOrigin+"/api/subscriptions/history")).json();
  // Wait for the second undo request to complete before checking the retained ledger.
  await page.waitForFunction(()=>document.querySelectorAll('[data-sonner-toast]').length>0);
  await page.getByRole("button",{name:"流水",exact:true}).click();
  await page.locator(".payment-badge.void").first().waitFor();
  assert.equal(history.total,2);
  await page.keyboard.press("Escape");
  console.log("PASS detail-only renewal, dirty-form guard, toast undo and frozen foreign ledger");

  await page.getByRole("button",{name:"备份",exact:true}).click();
  const downloadPromise=page.waitForEvent("download");
  await page.getByRole("button",{name:"下载当前备份",exact:true}).click();
  const download=await downloadPromise;
  const backup=JSON.parse(await readFile(await download.path(),"utf8"));
  assert.equal(backup.formatVersion,3);
  assert.equal(backup.subscriptions.find(item=>item.name==="ChatGPT Plus").fxRateToCny,7.2352);
  assert.equal(backup.subscriptions.length,6);assert.equal(backup.renewalLogs.length,2);
  assert.equal("users" in backup,false);
  const extended=structuredClone(backup);
  extended.subscriptions.push({...extended.subscriptions[0],id:randomUUID(),name:"导入测试"});
  const choose=async value=>page.getByLabel("选择 JSON 备份文件").setInputFiles({name:"test-backup.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(value))});
  await choose(extended);
  await page.getByText(/文件校验通过：7/).waitFor();
  await page.getByRole("button",{name:"确认合并导入",exact:true}).click();
  await page.getByRole("heading",{name:"导入测试",exact:true}).waitFor();
  assert.equal((await records()).length,7);
  await page.getByRole("button",{name:"备份",exact:true}).click();
  await choose(backup);
  await page.getByText(/文件校验通过：6/).waitFor();
  await page.getByLabel("覆盖恢复",{exact:true}).check();
  assert.equal(await page.getByText(/将用文件替换当前全部订阅与流水/).isVisible(),true);
  assert.equal(await page.getByRole("button",{name:"确认覆盖恢复",exact:true}).isDisabled(),true);
  const beforeReplace=page.waitForEvent("download");
  await page.getByRole("button",{name:"下载当前备份",exact:true}).click();await beforeReplace;
  await page.getByRole("checkbox").check();
  await page.getByRole("button",{name:"确认覆盖恢复",exact:true}).click();
  await page.getByRole("dialog").waitFor({state:"hidden"});
  assert.equal((await records()).length,6);
  console.log("PASS full JSON export, merge and explicitly confirmed replacement in isolated DB");

  await page.getByRole("button",{name:"流水",exact:true}).click();
  await page.getByRole("button",{name:"补录历史",exact:true}).click();
  await page.getByLabel("订阅",{exact:true}).selectOption(original.id);
  await page.getByLabel("首期开始日期").fill("2024-05-20");
  await page.getByLabel(/补录期数/).fill("3");
  await page.getByLabel("每期费用").fill("25");
  await page.getByLabel("付款币种").selectOption("CNY");
  await page.getByRole("button",{name:"生成逐期明细"}).click();
  assert.equal(await page.locator('.payment-entry').count(),3);
  await page.locator('.payment-entry').nth(1).getByLabel("费用",{exact:true}).fill("30");
  await page.getByRole("button",{name:"预览金额与重复账期"}).click();
  await page.getByRole("button",{name:"确认补录已支付记录"}).click();
  await page.getByText("已补录 3 笔，跳过 0 笔重复账期。",{exact:true}).waitFor();
  await page.getByRole("button",{name:"完成",exact:true}).click();
  await page.locator('.ledger-summary').getByText('¥80.00',{exact:true}).waitFor();
  assert.equal((await records()).find(i=>i.id===original.id).endDate,original.endDate);
  await page.getByLabel("流水状态").selectOption("paid");
  assert.equal(await page.locator('.ledger-row').count(),3);
  await page.screenshot({path:output+'/ledger-desktop.png',fullPage:true});
  await page.setViewportSize({width:320,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:output+'/ledger-mobile.png'});
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.ledger-row').first().getByRole('button',{name:'更正付款日期',exact:true}).click();
  await page.getByLabel('付款日期',{exact:true}).fill('2024-07-19');
  await page.getByRole('button',{name:'保存付款日期',exact:true}).click();
  await page.locator('.ledger-row').first().getByText('付款 2024-07-19',{exact:true}).waitFor();
  await page.locator('.ledger-row').first().getByRole('button',{name:'作废',exact:true}).click();
  await page.getByRole('button',{name:'确认作废',exact:true}).click();
  await page.locator('.ledger-summary').getByText('¥55.00',{exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Close'}).click();
  const paymentsResponse=await context.request.get(config.publicOrigin+'/api/payments');
  const ledger=(await paymentsResponse.json()).logs;
  assert.equal(ledger.filter(l=>l.payment&&!l.payment.voidedAt).length,2);
  console.log('PASS historical batch preview, per-entry edits, payment totals, void audit and mobile ledger');

  await page.waitForFunction(()=>document.querySelectorAll('[data-sonner-toast]').length===0,undefined,{timeout:12000});
  await page.screenshot({path:output+"/desktop-grid.png",fullPage:true});
  await page.getByRole("button",{name:"支出分析",exact:true}).click();
  await page.getByRole("heading",{name:"支出分析",exact:true}).waitFor();
  await page.getByLabel('统计方式',{exact:true}).selectOption('cash');
  await page.getByLabel('统计月份',{exact:true}).fill('2024-06');
  await page.locator('.payment-kpis>div').first().getByText('¥30.00',{exact:true}).waitFor();
  await page.getByLabel('统计月份',{exact:true}).fill('2024-05');
  await page.locator('.payment-kpis>div').first().getByText('¥25.00',{exact:true}).waitFor();
  await page.getByLabel('统计方式',{exact:true}).selectOption('accrual');
  await page.locator('.payment-kpis>div').first().getByText('¥25.00',{exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'月付预计账单',exact:true}).count(),1);
  assert.equal(await page.getByRole("heading",{name:"分类支出",exact:true}).count(),1);
  await page.screenshot({path:output+"/desktop-report.png",fullPage:true});
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(layout.scroll<=layout.width,JSON.stringify(layout));
    await page.screenshot({path:output+`/report-${width}.png`,fullPage:true});
  }
  await page.getByRole("button",{name:"返回订阅",exact:true}).click();
  await page.getByTitle("紧凑列表视图").click();
  for(const width of [320,375,390,768]){
    await page.setViewportSize({width,height:900});
    const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,rows:[...document.querySelectorAll('.subscription-row')].map(row=>({rect:row.getBoundingClientRect().toJSON(),date:row.querySelector('time')?.getBoundingClientRect().toJSON()}))}));
    assert.ok(layout.scroll<=layout.width,JSON.stringify(layout));
    assert.equal(layout.rows.length,6);
    for(const row of layout.rows){assert.ok(row.date.width>0);assert.ok(row.date.right<=width);}
    await page.screenshot({path:output+`/mobile-list-${width}.png`,fullPage:true});
  }
  await page.reload();await page.locator(".subscription-row").first().waitFor();
  await page.setViewportSize({width:390,height:900});
  await page.getByTitle("卡片视图").click();
  await page.screenshot({path:output+"/mobile-grid.png",fullPage:true});
  for (const width of [320,375,390,590,760,768,1024,1920]) {
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Grid overflow at ${width}`);
    assert.equal(await page.locator('.header-toolbox .header-utility').count(),5);
    for (const name of ["支出分析","流水","备份","退出","添加订阅"]) {
      const box=await page.getByRole("button",{name,exact:true}).boundingBox();
      assert.ok(box && box.x>=0 && box.x+box.width<=width+1,`${name} clipped at ${width}`);
    }
    if (width===320) await page.screenshot({path:output+"/grid-320.png",fullPage:true});
  }
  // Exercise health states and empty data using this disposable DB, never the deployed server.
  const samples=await records();
  service.execute(1,{action:"update",id:samples[0].id,version:samples[0].version,item:{...samples[0],endDate:shiftDate(today,-1)}});
  service.execute(1,{action:"update",id:samples[2].id,version:samples[2].version,item:{...samples[2],endDate:shiftDate(today,60)}});
  await page.reload();await page.locator(".subscription-card.expired").waitFor();
  assert.equal(await page.locator(".subscription-card.healthy").count(),1);
  assert.match(await page.locator(".status-legend .expired").innerText(),/1/);
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:output+"/desktop-states.png",fullPage:true});

  // Equal percentages share colors across cycles; rounding to zero must not imply expiry.
  const progressCases = [
    {start:0,end:30,percent:100,color:"rgb(47, 158, 122)",label:""},
    {start:-15,end:15,percent:50,color:"rgb(163, 183, 92)",label:""},
    {start:-24,end:6,percent:20,color:"rgb(223, 152, 76)",label:"即将到期"},
    {start:-30,end:0,percent:0,color:"rgb(211, 94, 98)",label:"今日到期"},
    {start:-31,end:-1,percent:0,color:"rgb(211, 94, 98)",label:"已到期"},
    {start:-729,end:1,percent:0,color:"rgb(211, 94, 98)",label:"即将到期"},
  ];
  const progressRecords=await records();
  for (const [index,item] of progressRecords.entries()) {
    const sample=progressCases[index];
    service.execute(1,{action:"update",id:item.id,version:item.version,item:{...item,startDate:shiftDate(today,sample.start),endDate:shiftDate(today,sample.end),autoRenew:false,reminderDays:7}});
  }
  await page.reload();await page.locator('.subscription-card').first().waitFor();
  await page.emulateMedia({reducedMotion:'reduce'});
  for (const [index,item] of progressRecords.entries()) {
    const sample=progressCases[index], card=page.getByRole('article',{name:item.name,exact:true});
    const actual=await card.evaluate(el=>({percent:Number(el.querySelector('[role="progressbar"]').getAttribute('aria-valuenow')),color:getComputedStyle(el.querySelector('[data-slot="progress-indicator"]')).backgroundColor,track:getComputedStyle(el.querySelector('.segments')).backgroundColor,number:getComputedStyle(el.querySelector('.remaining-number')).color,label:el.querySelector('.card-status')?.textContent??''}));
    assert.equal(actual.percent,sample.percent);assert.equal(actual.color,sample.color);assert.equal(actual.label,sample.label);
    assert.equal(actual.number,'rgb(34, 56, 46)');
    if(sample.percent===0) assert.equal(actual.track,'rgb(246, 223, 225)');
  }
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:1000});
    const layout=await page.locator('.subscription-card').evaluateAll(cards=>cards.map(card=>{
      const label=card.querySelector('.card-metrics > span').getBoundingClientRect(), price=card.querySelector('.card-metrics p').getBoundingClientRect();
      return {height:card.getBoundingClientRect().height,oneFeeLine:label.top<price.bottom&&price.top<label.bottom,contained:card.scrollWidth<=card.clientWidth};
    }));
    assert.ok(layout.every(card=>card.oneFeeLine&&card.contained),JSON.stringify({width,layout}));
    if(width===1440) assert.ok(layout.every(card=>card.height>=240&&card.height<=290),JSON.stringify(layout));
    await page.screenshot({path:output+`/compact-progress-${width}.png`,fullPage:width===1440});
  }
  console.log('PASS compact fee row, dark numbers, full/half/low/empty colors, due-today and rounded-zero expiry boundaries');

  const longRecord=(await records()).find(item=>item.id===progressRecords[0].id);
  const longName='超长会员名称'.repeat(10), longPlan='EnterprisePlan'.repeat(5);
  service.execute(1,{action:'update',id:longRecord.id,version:longRecord.version,item:{...longRecord,name:longName,plan:longPlan,amount:9999999.99}});
  await page.reload();await page.getByRole('heading',{name:longName,exact:true}).waitFor();
  for (const width of [320,1024,1440]) {
    await page.setViewportSize({width,height:1000});
    const card=page.getByRole('article',{name:longName,exact:true});
    assert.ok(await card.evaluate(el=>{
      const box=el.getBoundingClientRect(), amount=el.querySelector('.card-metrics p').getBoundingClientRect(), action=el.querySelector('button').getBoundingClientRect();
      return document.documentElement.scrollWidth<=innerWidth&&amount.left>=box.left&&amount.right<=box.right&&action.right<=box.right&&el.scrollWidth<=el.clientWidth;
    }),`Long content overflow at ${width}`);
  }
  await page.getByRole('textbox',{name:'搜索订阅',exact:true}).fill(longName);
  assert.equal(await page.locator('.subscription-card').count(),1);
  await page.getByRole('textbox',{name:'搜索订阅',exact:true}).fill('');
  assert.equal(await page.locator('.subscription-card').count(),6);
  console.log('PASS maximum-length names, long plans, large foreign amounts and search');

  await page.getByRole('button',{name:'支出分析',exact:true}).click();
  await page.getByRole('button',{name:'退出',exact:true}).click();
  await page.getByRole('button',{name:'管理员登录',exact:true}).waitFor();await assertGuest();
  assert.equal((await context.request.post(config.publicOrigin+'/api/auth/login',{headers:csrf,data:{username:config.adminUsername,password:config.adminPassword}})).status(),200);
  await page.reload();await page.getByRole('button',{name:'退出',exact:true}).waitFor();
  await page.getByRole('button',{name:'月均支出，查看摊算明细',exact:true}).click();
  await page.getByRole('heading',{name:'月均支出明细',exact:true}).waitFor();
  db.prepare('DELETE FROM sessions').run(); // Disposable test DB only: simulate session expiry in an open modal.
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.getByRole('button',{name:'管理员登录',exact:true}).waitFor();await assertGuest();
  assert.equal((await context.request.post(config.publicOrigin+'/api/auth/login',{headers:csrf,data:{username:config.adminUsername,password:config.adminPassword}})).status(),200);
  await page.reload();await page.getByRole('button',{name:'退出',exact:true}).waitFor();
  console.log('PASS logout and expired-session refresh close secondary pages/modals');

  // Verify every static brand asset decodes at small size, including newly added SVGs.
  const gallery=await context.newPage();await gallery.goto(config.publicOrigin);
  await gallery.setViewportSize({width:1000,height:900});
  await gallery.evaluate(entries=>{
    document.body.replaceChildren();document.body.style.cssText="margin:24px;background:#f4f6f5;display:grid;grid-template-columns:repeat(6,1fr);gap:12px;font:13px sans-serif";
    for (const brand of entries) {
      const tile=document.createElement("div");tile.style.cssText="background:white;padding:16px;display:grid;gap:8px;justify-items:center;border-radius:10px";
      const img=document.createElement("img");img.src=brand.icon;img.width=36;img.height=36;img.style.cssText="width:36px;height:36px;object-fit:contain";
      const label=document.createElement("span");label.textContent=brand.label;tile.append(img,label);document.body.append(tile);
    }
  },brands);
  await gallery.waitForFunction(()=>[...document.images].every(img=>img.complete&&img.naturalWidth>0));
  assert.equal(await gallery.locator("img").count(),brands.length);
  await gallery.screenshot({path:output+"/brand-gallery.png",fullPage:true});await gallery.close();

  for (const item of await records()) service.execute(1,{action:"delete",id:item.id,version:item.version});
  await page.reload();await page.getByRole("heading",{name:"把你的第一个会员加进来",exact:true}).waitFor();
  assert.equal(await page.locator(".overview .summary-card").count(),2);
  assert.match(await page.locator(".spending-summary .summary-number").innerText(),/0\.00/);
  assert.deepEqual(errors,[]);
  console.log(`PASS 320–1920 responsive grid/header, mobile lists, date removal, health/empty states, ${brands.length} decoded local icons and zero JS errors`);
} finally {
  await browser?.close();
  if(server)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  db.close();
}



