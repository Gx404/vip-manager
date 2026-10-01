/** Isolated production-build browser regression; all writes target a disposable in-memory database. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { readConfig } from "../backend/src/config.ts";
import { openDatabase } from "../backend/src/database.ts";
import { createApp } from "../backend/src/app.ts";
import { bootstrapAdmin } from "../backend/src/auth.ts";
import { SubscriptionService } from "../backend/src/subscriptions.ts";
import { dateKey, shiftDate } from "../shared/subscriptions.ts";

const playwright = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const config = readConfig({ PUBLIC_ORIGIN:"http://127.0.0.1", COOKIE_SECURE:"false", ADMIN_USERNAME:"browser-test", ADMIN_PASSWORD:randomUUID() });
const db=openDatabase(":memory:");
let server, browser;
const output=fileURLToPath(new URL("../outputs/browser-tests/",import.meta.url));
try {
  await mkdir(output,{recursive:true});
  await bootstrapAdmin(db,config);
  const service=new SubscriptionService(db,config.timeZone), today=dateKey();
  const names=["ChatGPT Plus","百度网盘","淘宝88VIP","哔哩哔哩大会员","iCloud+","自定义测试"];
  for (const [index,name] of names.entries()) service.execute(1,{action:"create",item:{id:randomUUID(),name,plan:"测试套餐",category:["AI 工具","云盘存储","购物会员","影音娱乐","云盘存储","其他服务"][index],amount:20+index,cycle:"monthly",customDays:30,startDate:shiftDate(today,-20),endDate:shiftDate(today,2+index),reminderDays:7,autoRenew:index===4,note:"isolated browser fixture",color:"#269979",version:0}});
  const api=createApp(db,config), web=express();
  web.use((req,res,next)=>req.path.startsWith("/api/")?api(req,res,next):next());
  web.use(express.static(fileURLToPath(new URL("../frontend/dist/",import.meta.url))));
  server=web.listen(0,"127.0.0.1");
  await new Promise((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  config.publicOrigin=`http://127.0.0.1:${server.address().port}`;
  browser=await playwright.chromium.launch({headless:true,...(process.env.BROWSER_CHANNEL?{channel:process.env.BROWSER_CHANNEL}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const csrf={"X-Requested-With":"membership-dashboard",Origin:config.publicOrigin};
  assert.equal((await context.request.post(config.publicOrigin+"/api/auth/login",{headers:csrf,data:{username:config.adminUsername,password:config.adminPassword}})).status(),200);
  const page=await context.newPage(), errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  const records=async()=>(await (await context.request.get(config.publicOrigin+"/api/subscriptions")).json()).items;
  await page.goto(config.publicOrigin);
  await page.getByRole("heading",{name:"ChatGPT Plus",exact:true}).waitFor();
  assert.equal(await page.locator(".subscription-card").count(),6);
  await page.getByRole("button",{name:"添加订阅",exact:true}).click();
  await page.getByLabel("本期开始日期").fill("2026-01-31");
  assert.equal(await page.getByLabel("本期到期日期").inputValue(),"2026-02-28");
  await page.getByLabel("续费周期",{exact:true}).selectOption("quarterly");
  assert.equal(await page.getByLabel("本期到期日期").inputValue(),"2026-04-30");
  await page.getByLabel("本期到期日期").fill("2026-05-12");
  await page.getByLabel("本期开始日期").fill("2026-02-01");
  await page.getByRole("button",{name:"淘宝88VIP",exact:true}).click();
  assert.equal(await page.getByLabel("本期到期日期").inputValue(),"2026-05-12");
  assert.equal(await page.getByLabel("分类",{exact:true}).inputValue(),"购物会员");
  assert.equal(await page.getByLabel("续费周期",{exact:true}).inputValue(),"yearly");
  await page.getByRole("button",{name:"重新按开始日期和周期计算"}).click();
  assert.equal(await page.getByLabel("本期到期日期").inputValue(),"2027-02-01");
  await page.getByRole("button",{name:"取消",exact:true}).click();
  console.log("PASS date linking, manual override, template defaults and explicit reset");

  const original=(await records()).find(item=>item.name==="ChatGPT Plus");
  await page.getByRole("button",{name:"快捷续费ChatGPT Plus",exact:true}).click();
  await page.getByRole("button",{name:"撤销",exact:true}).click();
  await page.getByText("已撤销本次续费记录",{exact:true}).waitFor();
  assert.equal((await records()).find(item=>item.id===original.id).endDate,original.endDate);
  await page.getByRole("button",{name:/提醒中心/}).click();
  await page.getByRole("dialog").getByRole("button",{name:"快捷续费百度网盘",exact:true}).click();
  await page.getByRole("button",{name:"撤销",exact:true}).click();
  const history=await (await context.request.get(config.publicOrigin+"/api/subscriptions/history")).json();
  // Wait for the second undo request to complete before checking the retained ledger.
  await page.waitForFunction(()=>document.querySelectorAll('[data-sonner-toast]').length>0);
  await page.getByRole("button",{name:"流水",exact:true}).click();
  await page.getByRole("dialog").getByText("已撤销",{exact:true}).first().waitFor();
  assert.equal(history.total,2);
  await page.keyboard.press("Escape");
  console.log("PASS card/reminder quick renewal, toast undo and retained history");

  await page.getByRole("button",{name:"备份",exact:true}).click();
  const downloadPromise=page.waitForEvent("download");
  await page.getByRole("button",{name:"下载当前备份",exact:true}).click();
  const download=await downloadPromise;
  const backup=JSON.parse(await readFile(await download.path(),"utf8"));
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
  assert.equal(await page.getByRole("button",{name:"确认覆盖恢复",exact:true}).isDisabled(),true);
  const beforeReplace=page.waitForEvent("download");
  await page.getByRole("button",{name:"下载当前备份",exact:true}).click();await beforeReplace;
  await page.getByRole("checkbox").check();
  await page.getByRole("button",{name:"确认覆盖恢复",exact:true}).click();
  await page.getByRole("dialog").waitFor({state:"hidden"});
  assert.equal((await records()).length,6);
  console.log("PASS full JSON export, merge and explicitly confirmed replacement in isolated DB");

  await page.waitForFunction(()=>document.querySelectorAll('[data-sonner-toast]').length===0,undefined,{timeout:12000});
  await page.screenshot({path:output+"/desktop-grid.png",fullPage:true});
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
  await page.getByTitle("大卡片视图").click();
  await page.screenshot({path:output+"/mobile-grid.png",fullPage:true});
  assert.deepEqual(errors,[]);
  console.log("PASS 320/375/390/768 responsive rows, persisted view and zero JS errors");
} finally {
  await browser?.close();
  if(server)await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  db.close();
}
