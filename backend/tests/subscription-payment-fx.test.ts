import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { PaymentService } from "../src/payments.ts";
import { ExchangeRates } from "../src/exchange-rates.ts";
import { BackupService } from "../src/backups.ts";
import { monthlyCostCny, type Subscription } from "../../shared/subscriptions.ts";

const now = new Date("2024-10-18T04:00:00Z");
const payment = {amount:10.9,currency:"USD" as const,paidOn:"2024-10-17",note:""};
function fixture() {
  const db=openDatabase(":memory:"); db.exec("INSERT INTO users VALUES(1,'owner','hash',0),(2,'other','hash',0)");
  const dates:string[]=[];
  const rates=new ExchangeRates(async url=>{
    const date=new URL(String(url)).searchParams.get("date")!; dates.push(date);
    return Response.json({date,base:"USD",quote:"CNY",rate:date === "2024-10-17" ? 6.6839 : 6.7});
  });
  const service=new SubscriptionService(db,"Asia/Shanghai",()=>now,rates);
  const payments=new PaymentService(db,rates,{clock:()=>now});
  const item=service.execute(1,{action:"create",item:{id:randomUUID(),name:"DMIT",plan:"Pro",category:"云服务与网络",
    amount:10.9,currency:"USD",cycle:"monthly",customDays:30,startDate:"2024-09-24",endDate:"2024-10-24",
    reminderDays:7,autoRenew:false,note:"",color:"#269979",purchaseDate:"2024-09-24",fxRateToCny:6.7062,
    fxRateDate:"2024-09-24",fxRateSource:"frankfurter"}}).item!;
  const renew=(current:Subscription=item,entry=payment)=>service.execute(1,{action:"renew",id:current.id,version:current.version,payment:entry});
  return {db,service,payments,dates,item,renew};
}

test("未来账期的已付报价修复旧预算，不等待生效日、不重新查询、不改业务版本或流水",async t=>{
  const {db,service,payments,dates,item,renew}=fixture();t.after(()=>db.close());
  renew(); await payments.refreshPendingRates();
  const before=payments.all(1);
  db.prepare("UPDATE subscriptions SET purchase_date=start_date,fx_rate_to_cny=1,fx_rate_date=start_date,rate_pending=1 WHERE user_id=1 AND id=?").run(item.id);
  const version=service.list(1).items[0].version;
  const offline=new ExchangeRates(async()=>{throw Error("saved quote must be reused");});
  await new SubscriptionService(db,"Asia/Shanghai",()=>now,offline).refreshPendingRates();
  const saved=service.list(1).items[0];
  assert.equal(saved.purchaseDate,"2024-10-17");assert.equal(saved.fxRateDate,"2024-10-17");
  assert.equal(saved.fxRateToCny,6.6839);assert.equal(saved.ratePending,false);
  assert.equal(monthlyCostCny(saved),10.9*6.6839);assert.equal(saved.version,version);
  assert.equal(saved.startDate,"2024-10-24");assert.equal(saved.endDate,"2024-11-24");
  assert.equal(saved.coverageStartDate,item.startDate);assert.deepEqual(payments.all(1),before);
  assert.deepEqual(dates,["2024-10-17"]);
});

test("付款汇率异步补齐即同步预算，更正实付日后两处使用同一天报价",async t=>{
  const {db,service,payments,dates,renew}=fixture();t.after(()=>db.close());
  const result=renew();await payments.refreshPendingRates();
  assert.equal(service.list(1).items[0].ratePending,false);
  await payments.correctDate(1,{id:result.renewal!.id,expectedPaidOn:payment.paidOn,paidOn:"2024-10-16"});
  const saved=service.list(1).items[0],charge=payments.all(1)[0].payment!;
  assert.equal(saved.purchaseDate,charge.paidOn);assert.equal(saved.fxRateDate,charge.rateDate);
  assert.equal(saved.fxRateToCny,charge.rate);assert.equal(saved.ratePending,false);
  assert.deepEqual(dates,["2024-10-17","2024-10-16"]);
});

test("旧式待确认流水在未来期提前确认付款后立即同步预算",async t=>{
  const {db,service,payments,renew}=fixture();t.after(()=>db.close());
  const result=renew();
  db.prepare("UPDATE subscription_renewal_logs SET payment_json=NULL WHERE user_id=1 AND id=?").run(result.renewal!.id);
  db.prepare("UPDATE subscriptions SET purchase_date=start_date,fx_rate_date=start_date,rate_pending=1 WHERE user_id=1 AND id=?").run(result.item!.id);
  await payments.confirm(1,{id:result.renewal!.id,entry:{...payment,startDate:result.item!.startDate,endDate:result.item!.endDate}});
  const saved=service.list(1).items[0];
  assert.equal(saved.ratePending,false);assert.equal(saved.purchaseDate,payment.paidOn);assert.equal(saved.fxRateToCny,6.6839);
});

test("更正付款日遇到汇率服务故障时，旧预算折算立即失效而不会继续使用旧日期",async t=>{
  const {db,service,payments,renew}=fixture();t.after(()=>db.close());
  const result=renew();await payments.refreshPendingRates();
  const offline=new PaymentService(db,new ExchangeRates(async()=>new Response("offline",{status:503})),{clock:()=>now});
  await offline.correctDate(1,{id:result.renewal!.id,expectedPaidOn:payment.paidOn,paidOn:"2024-10-16"});
  const saved=service.list(1).items[0];
  assert.equal(saved.purchaseDate,"2024-10-16");assert.equal(saved.ratePending,true);assert.equal(monthlyCostCny(saved),0);
  assert.equal(payments.all(1)[0].payment!.rate,null);
  await payments.refreshPendingRates();
  assert.equal(service.list(1).items[0].ratePending,false);assert.equal(service.list(1).items[0].fxRateToCny,6.7);
});

test("旧报价不覆盖后续续费、独立改价、币种、付款日期或人工汇率",async t=>{
  const {db,service,payments,item,renew}=fixture();t.after(()=>db.close());
  const first=renew();await payments.refreshPendingRates();
  const second=renew(service.list(1).items[0],{...payment,amount:15,paidOn:"2024-10-18"});
  await payments.refreshPendingRates();
  assert.equal(service.list(1).items[0].amount,15);
  await payments.correctDate(1,{id:first.renewal!.id,expectedPaidOn:payment.paidOn,paidOn:"2024-10-16"});
  assert.equal(service.list(1).items[0].purchaseDate,"2024-10-18");
  for (const patch of [{amount:20,ratePending:true},{currency:"AUD" as const,ratePending:true},
    {purchaseDate:"2024-10-15",fxRateDate:"2024-10-15",ratePending:true},{fxRateToCny:8,fxRateSource:"manual" as const,ratePending:false}]) {
    const current=service.list(1).items[0];
    const edited=service.execute(1,{action:"update",id:item.id,version:current.version,item:{...second.item!,...patch,version:current.version}}).item!;
    await payments.refreshPendingRates();
    assert.deepEqual(service.list(1).items[0],edited);
  }
});

test("缺少报价先按实付日重试，已删除付款及其他用户不能成为修复依据",async t=>{
  const {db,service,payments,dates,item,renew}=fixture();t.after(()=>db.close());
  const result=renew();
  db.prepare("UPDATE subscriptions SET purchase_date=start_date,fx_rate_date=start_date,rate_pending=1 WHERE user_id=1 AND id=?").run(item.id);
  const offline=new ExchangeRates(async()=>new Response("offline",{status:503}));
  await new SubscriptionService(db,"Asia/Shanghai",()=>now,offline).refreshPendingRates();
  const pending=service.list(1).items[0];
  assert.equal(pending.purchaseDate,payment.paidOn);assert.equal(pending.ratePending,true);
  assert.ok(pending.fxRateDate!<=pending.purchaseDate!);
  const backups=new BackupService(db);
  const exported=backups.export(1);
  assert.doesNotThrow(()=>backups.preview(2,exported));
  await service.refreshPendingRates();
  assert.deepEqual(dates,[payment.paidOn]);assert.equal(service.list(1).items[0].purchaseDate,payment.paidOn);
  await payments.refreshPendingRates();payments.void(1,{id:result.renewal!.id});
  db.prepare("UPDATE subscriptions SET purchase_date=start_date,rate_pending=1 WHERE user_id=1 AND id=?").run(item.id);
  await service.refreshPendingRates();
  assert.equal(service.list(1).items[0].ratePending,true);assert.equal(service.list(1).items[0].purchaseDate,"2024-10-24");
  assert.deepEqual(service.list(2).items,[]);
});
