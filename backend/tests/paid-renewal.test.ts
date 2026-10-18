import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { PaymentService } from "../src/payments.ts";
import { ExchangeRates } from "../src/exchange-rates.ts";
import { RenewalHistory } from "../src/renewal-history.ts";
import { paymentState } from "../../shared/payments.ts";
import type { Subscription } from "../../shared/subscriptions.ts";

const at = new Date("2026-10-17T17:00:00Z"); // October 18 in APP_TIMEZONE.
const record = (changes: Partial<Subscription> = {}): Subscription => ({
  id:randomUUID(),name:"DMIT",plan:"Pro",category:"云服务与网络",amount:10.9,currency:"CNY",
  cycle:"monthly",customDays:30,startDate:"2026-09-24",endDate:"2026-10-24",reminderDays:7,
  autoRenew:true,note:"",color:"#269979",version:0,purchaseDate:"2026-09-24",
  fxRateToCny:1,fxRateDate:"2026-09-24",fxRateSource:"manual",...changes,
});

function fixture(rates?: ExchangeRates) {
  const db=openDatabase(":memory:");
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(1,'owner','test',0),(2,'other','test',0)").run();
  return {db,service:new SubscriptionService(db,"Asia/Shanghai",()=>at,rates),history:new RenewalHistory(db)};
}

test("手动续费和已支付流水同事务保存，付款日使用应用时区而非未来账期开始日", t => {
  const {db,service,history}=fixture(); t.after(()=>db.close());
  const item=service.execute(1,{action:"create",item:record()}).item!;
  const result=service.execute(1,{action:"renew",id:item.id,version:item.version,requestId:randomUUID()});
  assert.equal(result.item?.startDate,"2026-10-24");
  assert.equal(result.item?.endDate,"2026-11-24");
  assert.equal(result.item?.purchaseDate,"2026-10-18");
  assert.equal(result.renewal?.payment?.paidOn,"2026-10-18");
  assert.equal(result.renewal?.payment?.startDate,"2026-10-24");
  assert.equal(result.renewal?.payment?.rate,1);
  assert.equal(result.renewal?.payment?.rateDate,"2026-10-18");
  assert.equal(paymentState(result.renewal!),"paid");
  assert.ok(result.undoUntil);
  assert.equal(history.list(1).total,1);
  assert.equal(history.list(2).total,0);
});

test("提前手动续费的预算立即查询实际付款日汇率，不等待未来账期开始", async t => {
  const requested:string[]=[];
  const rates=new ExchangeRates(async input=>{
    const date=new URL(String(input)).searchParams.get("date")!; requested.push(date);
    return new Response(JSON.stringify({date:"2026-10-16",base:"USD",quote:"CNY",rate:7.12}),{status:200});
  });
  const {db,service}=fixture(rates); t.after(()=>db.close());
  const item=service.execute(1,{action:"create",item:record({currency:"USD",fxRateToCny:7})}).item!;
  const renewed=service.execute(1,{action:"renew",id:item.id,version:item.version}).item!;
  assert.equal(renewed.purchaseDate,"2026-10-18");
  assert.equal(renewed.ratePending,true);
  await service.refreshPendingRates();
  const refreshed=service.list(1).items[0];
  assert.deepEqual(requested,["2026-10-18"]);
  assert.equal(refreshed.startDate,"2026-10-24");
  assert.equal(refreshed.purchaseDate,"2026-10-18");
  assert.equal(refreshed.fxRateDate,"2026-10-16");
  assert.equal(refreshed.fxRateToCny,7.12);
  assert.equal(refreshed.ratePending,false);
  assert.equal(refreshed.version,renewed.version);
});

test("预算汇率在查询期间更正购买日时不写回过期日期的结果", async t => {
  let release!:()=>void, started!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  const began=new Promise<void>(resolve=>{started=resolve;});
  let calls=0;
  const rates=new ExchangeRates(async input=>{
    const date=new URL(String(input)).searchParams.get("date")!;
    if(++calls===1) {started();await blocked;}
    return new Response(JSON.stringify({date,base:"USD",quote:"CNY",rate:date==="2026-10-18"?7.2:7.1}),{status:200});
  });
  const {db,service}=fixture(rates); t.after(()=>db.close());
  const item=service.execute(1,{action:"create",item:record({currency:"USD",fxRateToCny:7})}).item!;
  service.execute(1,{action:"renew",id:item.id,version:item.version});
  const refresh=service.refreshPendingRates(); await began;
  db.prepare("UPDATE subscriptions SET purchase_date='2026-10-17' WHERE user_id=1 AND id=?").run(item.id);
  release(); await refresh;
  let latest=service.list(1).items[0];
  assert.equal(latest.purchaseDate,"2026-10-17");
  assert.equal(latest.fxRateToCny,7);
  assert.equal(latest.ratePending,true);
  await service.refreshPendingRates();
  latest=service.list(1).items[0];
  assert.equal(latest.fxRateToCny,7.1);
  assert.equal(latest.fxRateDate,"2026-10-17");
  assert.equal(latest.ratePending,false);
});

test("外币续费不等待汇率接口，接口失败仍保留已支付原币金额及待补折算", async t => {
  let calls=0;
  const rates=new ExchangeRates(async()=>{calls++;throw new Error("offline");});
  const {db,service}=fixture(rates); t.after(()=>db.close());
  const item=service.execute(1,{action:"create",item:record({currency:"USD",fxRateToCny:7})}).item!;
  const result=service.execute(1,{action:"renew",id:item.id,version:item.version});
  assert.equal(calls,0);
  assert.equal(paymentState(result.renewal!),"paid");
  assert.equal(result.renewal?.payment?.amount,10.9);
  assert.equal(result.renewal?.payment?.currency,"USD");
  assert.equal(result.renewal?.payment?.rate,null);
  assert.equal(result.renewal?.payment?.rateDate,null);
  await new PaymentService(db,rates,{timeZone:"Asia/Shanghai",clock:()=>at}).refreshPendingRates();
  assert.equal(calls,1);
  const saved=new RenewalHistory(db).list(1).logs[0];
  assert.equal(paymentState(saved),"paid");
  assert.equal(saved.payment?.paidOn,"2026-10-18");
  assert.equal(saved.payment?.rate,null);
});

test("自动顺延仅生成待确认流水，不伪造实际付款", t => {
  const {db,service,history}=fixture(); t.after(()=>db.close());
  service.execute(1,{action:"create",item:record({startDate:"2026-08-24",endDate:"2026-09-24"})});
  assert.equal(service.advanceAutomaticRenewals(at),1);
  const log=history.list(1).logs[0];
  assert.equal(log.kind,"automatic");
  assert.equal(log.payment,null);
  assert.equal(paymentState(log),"pending");
});

test("重试相同续费请求不会重复付款，撤销同时排除付款且保留流水审计", t => {
  const {db,service,history}=fixture(); t.after(()=>db.close());
  const item=service.execute(1,{action:"create",item:record()}).item!;
  const request={action:"renew",id:item.id,version:item.version,requestId:randomUUID()};
  const first=service.execute(1,request);
  const retry=service.execute(1,request);
  assert.equal(retry.renewal?.id,first.renewal?.id);
  assert.equal(retry.renewal?.payment?.confirmedAt,first.renewal?.payment?.confirmedAt);
  assert.equal(retry.item?.version,1);
  assert.equal(history.list(1).total,1);
  assert.throws(()=>service.execute(2,{...request,version:1}),{status:404});
  const undone=service.execute(1,{action:"undoRenew",id:item.id,version:retry.item!.version,logId:first.renewal!.id});
  assert.equal(undone.item?.startDate,item.startDate);
  assert.equal(undone.item?.endDate,item.endDate);
  assert.equal(paymentState(undone.renewal!),"void");
  assert.equal(history.list(1).total,1);
  assert.throws(()=>service.execute(1,request),{status:409});
});

test("付款写入失败时整个续费事务回滚，不留下延长日期或重复流水", async t => {
  const {db,service,history}=fixture(); t.after(()=>db.close());
  const item=service.execute(1,{action:"create",item:record()}).item!;
  await new PaymentService(db,undefined,{timeZone:"Asia/Shanghai",clock:()=>at}).add(1,{subscriptionId:item.id,entries:[{
    amount:10.9,currency:"CNY",paidOn:"2026-10-17",startDate:"2026-10-24",endDate:"2026-11-24",note:"already recorded",
  }]});
  assert.throws(()=>service.execute(1,{action:"renew",id:item.id,version:item.version}),{status:409});
  assert.equal(service.list(1).items[0].endDate,item.endDate);
  assert.equal(service.list(1).items[0].version,item.version);
  assert.equal(history.list(1).total,1);
});
