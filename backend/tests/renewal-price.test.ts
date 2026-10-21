import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { PaymentService } from "../src/payments.ts";
import { ExchangeRates } from "../src/exchange-rates.ts";
import { BackupService } from "../src/backups.ts";
import { paymentState, type RenewalPaymentInput } from "../../shared/payments.ts";
import { reportEntries } from "../../shared/report-entries.ts";
import type { Subscription } from "../../shared/subscriptions.ts";

const now = new Date("2026-10-20T04:00:00Z");
const newPrice: RenewalPaymentInput = {amount:8.99,currency:"USD",paidOn:"2026-10-19",note:"一年优惠价"};
function fixture() {
  const db = openDatabase(":memory:");
  db.exec("INSERT INTO users VALUES(1,'owner','hash',0),(2,'other','hash',0)");
  const dates: string[] = [];
  const rates = new ExchangeRates(async url => {
    const date = new URL(String(url)).searchParams.get("date")!; dates.push(date);
    return Response.json({date,base:"USD",quote:"CNY",rate:7.1});
  });
  const service = new SubscriptionService(db,"Asia/Shanghai",()=>now,rates);
  const payments = new PaymentService(db,rates,{timeZone:"Asia/Shanghai",clock:()=>now});
  const original: Subscription = {id:randomUUID(),name:"Gemini",plan:"Pro",category:"AI 工具",amount:38,currency:"CNY",
    cycle:"yearly",customDays:30,startDate:"2026-01-19",endDate:"2027-01-19",reminderDays:7,
    autoRenew:false,note:"",color:"#269979",version:0,purchaseDate:"2026-01-19",fxRateToCny:1,fxRateDate:"2026-01-19",fxRateSource:"manual"};
  const item = service.execute(1,{action:"create",item:original}).item!;
  const renew = (item: Subscription, payment: RenewalPaymentInput = newPrice) => service.execute(1,{action:"renew",id:item.id,version:item.version,requestId:randomUUID(),payment});
  return {db,service,payments,dates,item,renew};
}

test("同一期内按不同金额币种续一年，旧价格独立保留且本期进度不被加长",async t=>{
  const {db,service,payments,dates,item,renew}=fixture();t.after(()=>db.close());
  const result=renew(item),log=result.renewal!,payment=log.payment!;
  assert.deepEqual(dates,[]);
  assert.equal(result.item!.startDate,"2027-01-19");assert.equal(result.item!.endDate,"2028-01-19");
  assert.equal(result.item!.coverageStartDate,"2026-01-19");
  assert.equal(result.item!.amount,8.99);assert.equal(result.item!.currency,"USD");assert.equal(result.item!.purchaseDate,"2026-10-19");
  assert.equal(log.amount,38);assert.equal(log.currency,"CNY");
  assert.equal(payment.amount,8.99);assert.equal(payment.currency,"USD");assert.equal(payment.paidOn,"2026-10-19");
  assert.equal(paymentState(log),"paid");assert.equal(payment.rate,null);
  await service.refreshPendingRates();await payments.refreshPendingRates();
  assert.deepEqual(dates,["2026-10-19"]);
  const saved=payments.all(1)[0];assert.equal(saved.payment!.rate,7.1);assert.equal(saved.payment!.rateDate,"2026-10-19");
  const cash=reportEntries([saved],service.list(1).items,"2026-10-20").cash;
  assert.equal(cash.length,2);assert.equal(cash.find(entry=>entry.source==="subscription")!.amount,38);
  assert.equal(cash.find(entry=>entry.source==="payment")!.amount,8.99*7.1);
});

test("改价续费撤销后恢复原币金额、币种、日期和汇率",t=>{
  const {db,service,payments,item,renew}=fixture();t.after(()=>db.close());
  const result=renew(item);
  const restored=service.execute(1,{action:"undoRenew",id:item.id,version:result.item!.version,logId:result.renewal!.id});
  assert.equal(restored.item!.amount,38);assert.equal(restored.item!.currency,"CNY");assert.equal(restored.item!.fxRateToCny,1);
  assert.equal(restored.item!.purchaseDate,"2026-01-19");assert.equal(restored.item!.ratePending,false);
  assert.equal(restored.item!.startDate,item.startDate);assert.equal(restored.item!.endDate,item.endDate);
  assert.deepEqual(payments.all(1),[]);
});

test("连续续费各自保留实付价格，重试同一请求不新增第二笔",t=>{
  const {db,service,payments,item,renew}=fixture();t.after(()=>db.close());
  const first=renew(item);
  const request={action:"renew",id:item.id,version:first.item!.version,requestId:randomUUID(),payment:{...newPrice,amount:9.99,paidOn:"2026-10-20"}};
  const second=service.execute(1,request);const retry=service.execute(1,request);
  assert.equal(retry.renewal!.id,second.renewal!.id);assert.equal(payments.all(1).length,2);
  assert.equal(second.item!.endDate,"2029-01-19");assert.equal(second.renewal!.amount,8.99);assert.equal(second.renewal!.currency,"USD");
  assert.equal(second.renewal!.payment!.amount,9.99);assert.equal(first.renewal!.payment!.amount,8.99);
});

test("无效实付金额或未来付款日拒绝并回滚整个续费，其他用户不能写入",t=>{
  const {db,service,payments,item,renew}=fixture();t.after(()=>db.close());
  assert.throws(()=>renew(item,{...newPrice,paidOn:"2026-10-21"}),{status:400});
  assert.throws(()=>renew(item,{...newPrice,amount:8.999}));
  assert.throws(()=>service.execute(2,{action:"renew",id:item.id,version:item.version,payment:newPrice}),{status:404});
  assert.equal(payments.all(1).length,0);assert.deepEqual(service.list(1).items[0],item);
});

test("修改旧付款币种金额按付款日重新换算，保留修改信息和备份且拒绝陈旧修改",async t=>{
  const {db,service,payments,dates,item,renew}=fixture();t.after(()=>db.close());
  const old={amount:38,currency:"CNY" as const,paidOn:"2026-10-19",note:""};
  const result=renew(item,old);
  const changed=await payments.correct(1,{id:result.renewal!.id,entry:newPrice,expected:old});
  assert.deepEqual(dates,["2026-10-19"]);
  assert.equal(changed.log.payment!.currency,"USD");assert.equal(changed.log.payment!.rate,7.1);
  assert.deepEqual(changed.log.payment!.corrections![0].previous,old);
  assert.equal(changed.log.previousStartDate,item.startDate);assert.equal(changed.log.payment!.startDate,"2027-01-19");
  assert.equal(service.list(1).items[0].amount,8.99);assert.equal(service.list(1).items[0].currency,"USD");
  assert.equal(service.list(1).items[0].ratePending,false);
  await assert.rejects(payments.correct(1,{id:result.renewal!.id,entry:{...newPrice,amount:10},expected:old}),{status:409});
  await assert.rejects(payments.correct(2,{id:result.renewal!.id,entry:newPrice,expected:old}),{status:404});
  const backups=new BackupService(db),backup=backups.export(1);
  backups.import(2,{backup,mode:"merge",expectedRevision:backups.preview(2,backup).revision});
  assert.deepEqual(backups.export(2).renewalLogs,backup.renewalLogs);
});

test("修改更早付款不覆盖最新续费金额，单独编辑过的卡片价格也优先保留",async t=>{
  const {db,service,payments,item,renew}=fixture();t.after(()=>db.close());
  const first=renew(item),second=renew(first.item!,{...newPrice,amount:9.99});
  await payments.correct(1,{id:first.renewal!.id,entry:{...newPrice,amount:7.99},expected:newPrice});
  assert.equal(service.list(1).items[0].amount,9.99);
  const current=service.list(1).items[0];
  service.execute(1,{action:"update",id:item.id,version:current.version,item:{...current,amount:10.99,ratePending:true}});
  await payments.correct(1,{id:second.renewal!.id,entry:{...newPrice,amount:8.99},expected:{...newPrice,amount:9.99}});
  assert.equal(service.list(1).items[0].amount,10.99);
});

test("修改付款期间如记录作废，迟到的汇率结果不能复活或覆盖记录",async t=>{
  const {db,payments,item,renew}=fixture();t.after(()=>db.close());
  const old={amount:38,currency:"CNY" as const,paidOn:"2026-10-19",note:""};
  const result=renew(item,old);let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),began=new Promise<void>(resolve=>{entered=resolve;});
  const slow=new PaymentService(db,new ExchangeRates(async()=>{entered();await gate;return Response.json({date:"2026-10-19",base:"USD",quote:"CNY",rate:7.1});}),{clock:()=>now});
  const pending=slow.correct(1,{id:result.renewal!.id,entry:newPrice,expected:old});
  await began;payments.void(1,{id:result.renewal!.id});release();
  await assert.rejects(pending,{status:404});
  assert.deepEqual(payments.all(1),[]);
});
