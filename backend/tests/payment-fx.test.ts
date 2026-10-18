import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { PaymentService, paymentSchema } from "../src/payments.ts";
import { ExchangeRates } from "../src/exchange-rates.ts";
import { BackupService } from "../src/backups.ts";
import { ApiError } from "../src/errors.ts";
import { paymentCny, paymentState, type PaymentInput } from "../../shared/payments.ts";
import { paymentReport } from "../../shared/payment-reports.ts";

const offline = () => new ExchangeRates(async () => new Response("offline",{status:503}));
const entry: PaymentInput = {amount:10.9,currency:"USD",paidOn:"2024-10-17",startDate:"2024-10-24",endDate:"2024-11-24",note:""};
function setup() {
  const db=openDatabase(":memory:"); db.exec("INSERT INTO users VALUES(1,'owner','hash',0),(2,'other','hash',0)");
  const item=new SubscriptionService(db,"Asia/Shanghai").execute(1,{action:"create",item:{id:randomUUID(),name:"DMIT",plan:"Pro",category:"云服务与网络",amount:10.9,currency:"CNY",cycle:"monthly",customDays:30,startDate:"2024-09-24",endDate:"2024-10-24",reminderDays:7,autoRenew:false,note:"",color:"#269979"}}).item!;
  return {db,item,payments:new PaymentService(db,offline()),backups:new BackupService(db)};
}

test("paid FX outages retain original money, remain paid, count omissions and round-trip backups",async t=>{
  const {db,item,payments,backups}=setup();t.after(()=>db.close());
  const batch={subscriptionId:item.id,entries:[entry]};
  assert.equal((await payments.preview(1,batch)).entries[0].rate,null);
  await payments.add(1,batch);const log=payments.all(1)[0];
  assert.equal(paymentState(log),"paid");assert.equal(paymentCny(log.payment!),null);assert.equal(log.payment!.rateDate,null);
  assert.equal(log.payment!.amount,10.9);assert.equal(log.payment!.paidOn,"2024-10-17");
  const report=paymentReport([log],[],"2024-10-18","2024-10");
  assert.equal(report.total,0);assert.equal(report.selectedCount,1);assert.equal(report.missingRates,1);
  assert.equal(report.monthMissingRates,1);assert.equal(report.yearMissingRates,1);assert.equal(report.pending,0);
  assert.equal(report.details[0].allocated,null);assert.equal(report.details[0].originalAmount,10.9);
  assert.equal(report.details[0].currency,"USD");assert.equal(report.months[9].missingRates,1);
  assert.equal(report.categories[0].missingRates,1);assert.equal(report.ranking[0].missingRates,1);
  const backup=backups.export(1);backups.import(2,{backup,mode:"merge",expectedRevision:backups.preview(2,backup).revision});
  assert.deepEqual(payments.all(2),[log]);
  const dates:string[]=[];
  const online=new PaymentService(db,new ExchangeRates(async url=>{const date=new URL(String(url)).searchParams.get("date")!;dates.push(date);return Response.json({date:"2024-10-16",base:"USD",quote:"CNY",rate:7.1});}));
  await online.refreshPendingRates();assert.deepEqual(dates,["2024-10-17"]);
  assert.equal(online.all(1)[0].payment!.rateDate,"2024-10-16");assert.equal(online.all(2)[0].payment!.rateDate,"2024-10-16");
  assert.equal(paymentReport(online.all(1),[],"2024-10-18","2024-10").missingRates,0);
  assert.equal(paymentCny(online.all(1)[0].payment!),10.9*7.1);
});

test("late payment and date correction always resolve the actual paid date, including failed correction",async t=>{
  const {db,item,payments}=setup();t.after(()=>db.close());const dates:string[]=[];
  const online=new PaymentService(db,new ExchangeRates(async url=>{const date=new URL(String(url)).searchParams.get("date")!;dates.push(date);return Response.json({date,base:"USD",quote:"CNY",rate:7});}));
  await online.add(1,{subscriptionId:item.id,entries:[{...entry,paidOn:"2024-11-01"}]});
  assert.deepEqual(dates,["2024-11-01"]);const log=online.all(1)[0];
  await payments.correctDate(1,{id:log.id,expectedPaidOn:"2024-11-01",paidOn:"2024-10-17"});
  const corrected=payments.all(1)[0];assert.equal(corrected.payment!.paidOn,"2024-10-17");assert.equal(corrected.payment!.rate,null);
  assert.equal(corrected.payment!.dateCorrections![0].from,"2024-11-01");
  assert.equal(corrected.payment!.startDate,entry.startDate);assert.equal(paymentState(corrected),"paid");
  await online.refreshPendingRates();assert.deepEqual(dates,["2024-11-01","2024-10-17"]);
  await assert.rejects(payments.correctDate(1,{id:log.id,expectedPaidOn:"2024-11-01",paidOn:"2024-10-18"}),{status:409});
});

test("pending FX refresh shares a database lock and cannot overwrite a concurrent corrected date or void",async t=>{
  const {db,item,payments}=setup();t.after(()=>db.close());await payments.add(1,{subscriptionId:item.id,entries:[entry]});
  const id=payments.all(1)[0].id;let resolve!:()=>void;let entered!:()=>void;
  const started=new Promise<void>(r=>{entered=r;}), gate=new Promise<void>(r=>{resolve=r;});let calls=0;
  const slowRates=new ExchangeRates(async url=>{calls++;entered();await gate;const date=new URL(String(url)).searchParams.get("date")!;return Response.json({date,base:"USD",quote:"CNY",rate:7});});
  const first=new PaymentService(db,slowRates).refreshPendingRates();await started;
  const second=new PaymentService(db,slowRates).refreshPendingRates();
  await payments.correctDate(1,{id,expectedPaidOn:entry.paidOn,paidOn:"2024-10-16"});
  resolve();await Promise.all([first,second]);assert.equal(calls,1);
  assert.equal(payments.all(1)[0].payment!.paidOn,"2024-10-16");assert.equal(payments.all(1)[0].payment!.rate,null);
  let release!:()=>void;const waiting=new Promise<void>(r=>{release=r;});let requested!:()=>void;const startVoid=new Promise<void>(r=>{requested=r;});
  const pending=new PaymentService(db,new ExchangeRates(async()=>{requested();await waiting;return Response.json({date:"2024-10-16",base:"USD",quote:"CNY",rate:7});})).refreshPendingRates();
  await startVoid;payments.void(1,{id});release();await pending;
  assert.equal(paymentState(payments.all(1)[0]),"void");assert.equal(payments.all(1)[0].payment!.rate,null);
});

test("validation errors are not downgraded to FX pending, and legacy numeric snapshots remain compatible",async t=>{
  const {db,item,payments,backups}=setup();t.after(()=>db.close());
  await assert.rejects(payments.add(1,{subscriptionId:item.id,entries:[{...entry,paidOn:"2200-01-01"}]}),{status:400});
  const strict=new ExchangeRates();strict.lookup=async()=>{throw new ApiError(400,"invalid date");};
  await assert.rejects(new PaymentService(db,strict).add(1,{subscriptionId:item.id,entries:[entry]}),{status:400});
  assert.equal(payments.all(1).length,0);
  await payments.add(1,{subscriptionId:item.id,entries:[{...entry,currency:"CNY"}]});
  const backup=backups.export(1), payment=backup.renewalLogs[0].payment!;
  Object.assign(payment,{paidOn:"2024-03-11",startDate:"2025-03-11",endDate:"2026-03-11",rate:1,rateDate:"2025-03-11"});
  assert.ok(paymentSchema.safeParse(payment).success);
  backups.import(2,{backup,mode:"merge",expectedRevision:backups.preview(2,backup).revision});
  assert.deepEqual(backups.export(2).renewalLogs[0].payment,payment);
  assert.equal(paymentSchema.safeParse({...payment,currency:"CNY",rate:null,rateDate:null}).success,false);
  assert.equal(paymentSchema.safeParse({...payment,currency:"USD",rate:null,rateDate:payment.rateDate}).success,false);
});
