import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { PaymentService } from "../src/payments.ts";
import { ExchangeRates } from "../src/exchange-rates.ts";
import { BackupService } from "../src/backups.ts";
import { RenewalHistory } from "../src/renewal-history.ts";
import { allocatedPayment, paymentReport } from "../../shared/payment-reports.ts";
import { defaultPaymentDate, type PaymentInput } from "../../shared/payments.ts";
import { monthlyCostCny } from "../../shared/subscriptions.ts";
import { periodPercentage } from "../../shared/presentation.ts";

function setup() {
  const db=openDatabase(":memory:");db.exec("INSERT INTO users VALUES(1,'owner','hash',0),(2,'other','hash',0)");
  const dates:string[]=[];
  const rates=new ExchangeRates(async url=>{const date=new URL(String(url)).searchParams.get("date")!;dates.push(date);return Response.json({date,base:"AUD",quote:"CNY",rate:date.startsWith("2024-05")?4:5});});
  const service=new SubscriptionService(db,"Asia/Shanghai",()=>new Date("2024-10-01T00:00:00Z"),rates);
  const item=service.execute(1,{action:"create",item:{id:randomUUID(),name:"Open Ai",plan:"Business",category:"AI 工具",amount:25,currency:"AUD",purchaseDate:"2024-09-20",fxRateToCny:5,fxRateDate:"2024-09-20",fxRateSource:"frankfurter",cycle:"monthly",customDays:30,startDate:"2024-09-20",endDate:"2024-10-20",reminderDays:7,autoRenew:false,note:"private",color:"#269979"}}).item!;
  return {db,service,item,dates,payments:new PaymentService(db,rates),backups:new BackupService(db)};
}
const entry=(startDate="2024-05-20",endDate="2024-06-20"):PaymentInput=>({amount:25,currency:"AUD",paidOn:startDate,startDate,endDate,note:"historical receipt"});

test("historical batches use each period's rate, preserve subscriptions and skip retry/overlap",async t=>{
  const {db,service,item,payments,dates}=setup();t.after(()=>db.close());const before=service.list(1);
  const batch={subscriptionId:item.id,entries:[entry(),entry("2024-06-20","2024-07-20")]};
  const preview=await payments.preview(1,batch);assert.deepEqual(preview.entries.map(p=>p.rate),[4,5]);assert.equal(payments.all(1).length,0);
  assert.deepEqual(await payments.add(1,batch),{added:2,skipped:0});
  assert.deepEqual(await payments.add(1,batch),{added:0,skipped:2});
  assert.deepEqual(service.list(1),before);assert.deepEqual(dates,["2024-05-20","2024-06-20"]);
  assert.equal((await payments.preview(1,{subscriptionId:item.id,entries:[entry("2024-05-25","2024-06-25")]})).entries[0].duplicate,true);
  await assert.rejects(payments.add(2,batch),{status:404});assert.equal(payments.all(2).length,0);
});

test("confirmation enriches one original audit, is single-use and cannot be undone as a schedule",async t=>{
  const {db,service,item,payments}=setup();t.after(()=>db.close());
  const renewal=service.execute(1,{action:"renew",id:item.id,version:0});
  const pendingReport=paymentReport(payments.all(1),[],"2024-12-01","");
  assert.equal(pendingReport.yearTotal,0);assert.equal(pendingReport.pending,1);
  assert.equal(pendingReport.subscriptionCount,1,"the recorded previous period remains an estimate, not a confirmed payment");
  const p={...entry(renewal.item!.startDate,renewal.item!.endDate),paidOn:"2024-10-01"};
  await assert.rejects(payments.confirm(2,{id:renewal.renewal!.id,entry:p}),{status:404});
  const before=service.list(1);
  await payments.confirm(1,{id:renewal.renewal!.id,entry:p});
  assert.equal(payments.all(1).length,1);assert.equal(payments.all(1)[0].payment!.rateDate,p.startDate);
  assert.deepEqual(service.list(1),before);
  await assert.rejects(payments.confirm(1,{id:renewal.renewal!.id,entry:p}),{status:409});
  assert.throws(()=>service.execute(1,{action:"undoRenew",id:item.id,version:1,logId:renewal.renewal!.id}),{status:409});
  assert.throws(()=>new RenewalHistory(db).deleteUndone(1,renewal.renewal!.id),{status:409});
});

test("voids retain payment details, exclude totals and allow corrected backfill; backups preserve all",async t=>{
  const {db,item,payments,backups,service}=setup();t.after(()=>db.close());
  await payments.add(1,{subscriptionId:item.id,entries:[entry()]});const log=payments.all(1)[0];
  const preview=backups.preview(1,backups.export(1));payments.void(1,{id:log.id});
  assert.equal(payments.all(1)[0].payment!.amount,25);assert.ok(payments.all(1)[0].payment!.voidedAt);
  assert.equal(paymentReport(payments.all(1),[],"2024-12-01","").total,0);
  assert.throws(()=>backups.import(1,{backup:backups.export(1),mode:"merge",expectedRevision:preview.revision}),{status:409});
  await payments.add(1,{subscriptionId:item.id,entries:[{...entry(),amount:30}]});
  const backup=backups.export(1);assert.equal(backup.formatVersion,3);
  backups.import(2,{backup,mode:"merge",expectedRevision:backups.preview(2,backup).revision});
  assert.deepEqual(payments.all(2),payments.all(1));
  assert.equal(paymentReport(payments.all(2),[],"2024-12-01","").total,120);
  assert.equal(service.list(1).items[0].startDate,item.startDate);
  assert.throws(()=>new RenewalHistory(db).deleteUndone(1,log.id),{status:409});
});

test("failed rate lookup and insert failure cannot partially save a batch",async t=>{
  const {db,item,payments}=setup();t.after(()=>db.close());
  const bad=new PaymentService(db,new ExchangeRates(async()=>Response.json({}, {status:503})));
  await assert.rejects(bad.add(1,{subscriptionId:item.id,entries:[entry()]}),{code:"FX_UNAVAILABLE"});assert.equal(payments.all(1).length,0);
  db.exec("CREATE TRIGGER fail_second BEFORE INSERT ON subscription_renewal_logs WHEN (SELECT count(*) FROM subscription_renewal_logs)=1 BEGIN SELECT RAISE(ABORT,'fixture'); END");
  await assert.rejects(payments.add(1,{subscriptionId:item.id,entries:[entry(),entry("2024-06-20","2024-07-20")]}));assert.equal(payments.all(1).length,0);
});

test("reports group by payment month, exclude voids and never count a prepaid future period twice",async t=>{
  const {db,item,payments}=setup();t.after(()=>db.close());
  await payments.add(1,{subscriptionId:item.id,entries:[{...entry(),paidOn:"2024-06-01"},{...entry("2024-10-20","2024-11-20"),paidOn:"2024-10-01"}]});
  const all=payments.all(1), report=paymentReport(all,[item],"2024-10-10","2024-06");
  assert.equal(report.total,100);assert.equal(report.yearTotal,225);assert.equal(report.monthTotal,125);assert.equal(report.upcoming.length,0);
  assert.equal(report.months.length,12);assert.equal(report.months.find(m=>m.key==="2024-05")!.count,0);
  assert.equal(report.categories[0].amount,report.ranking[0].amount);
});

test("new period rates retry independently, omit pending budget and restore prior snapshot on undo",async t=>{
  const {db,item,service,dates}=setup();t.after(()=>db.close());
  const renewed=service.execute(1,{action:"renew",id:item.id,version:0});assert.equal(renewed.item!.ratePending,true);assert.equal(monthlyCostCny(renewed.item!),0);
  await service.refreshPendingRates();const current=service.list(1).items[0];assert.equal(current.ratePending,false);assert.equal(current.fxRateDate,current.startDate);assert.deepEqual(dates,[current.startDate]);
  service.execute(1,{action:"undoRenew",id:item.id,version:1,logId:renewed.renewal!.id});
  const restored=service.list(1).items[0];assert.equal(restored.purchaseDate,item.purchaseDate);assert.equal(restored.fxRateDate,item.fxRateDate);assert.equal(restored.ratePending,false);
});

test("two prepaid annual bills allocate only over each service year and remain out of monthly forecasts",async t=>{
  const {db,item,service,payments}=setup();t.after(()=>db.close());
  const annual={...item,currency:"CNY" as const,fxRateToCny:1,cycle:"yearly" as const,amount:199,startDate:"2024-03-11",endDate:"2025-03-11"};
  const changed=service.execute(1,{action:"update",id:item.id,version:item.version,item:annual}).item!;
  const renewed=service.execute(1,{action:"renew",id:item.id,version:changed.version});
  assert.equal(renewed.item!.coverageStartDate,"2024-03-11");
  assert.equal(periodPercentage(renewed.item!,"2024-10-10"),71);
  assert.equal(periodPercentage(renewed.item!,"2025-03-11"),50,"progress cannot reset when the next year begins");
  assert.equal(service.listPublic()[0].coverageStartDate,"2024-03-11");
  assert.equal(defaultPaymentDate(renewed.renewal!,"2024-10-10"),"","prepayment requires its actual payment date");
  await payments.confirm(1,{id:renewed.renewal!.id,entry:{...entry("2025-03-11","2026-03-11"),amount:199,currency:"CNY",paidOn:"2024-03-11"}});
  await payments.add(1,{subscriptionId:item.id,entries:[{...entry("2024-03-11","2025-03-11"),amount:199,currency:"CNY",paidOn:"2024-03-11"}]});
  const logs=payments.all(1), cash=paymentReport(logs,[renewed.item!],"2024-10-10","2024-03");
  assert.equal(cash.total,398);assert.equal(cash.monthTotal,0);
  const accrual=paymentReport(logs,[renewed.item!],"2024-10-10","2024-10","accrual");
  assert.equal(accrual.total,0,"a March payment is not repeated in October");
  assert.equal(accrual.selectedCount,0);assert.equal(accrual.upcoming.length,0);
  const first=logs.find(l=>l.payment!.startDate==="2024-03-11")!;
  const allocated=Array.from({length:13},(_,n)=>allocatedPayment(first,new Date(Date.UTC(2024,2+n,1)).toISOString().slice(0,7))).reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(allocated-199)<1e-8,"allocations conserve the paid amount across month/year boundaries");
  const monthly={...item,endDate:"2024-10-20"};
  const yearly={...annual,id:randomUUID(),endDate:"2024-10-23"};
  assert.equal(paymentReport([], [monthly,yearly,{...yearly,id:randomUUID(),cycle:"quarterly"}],"2024-10-10").upcoming.length,1);
});

test("payment date corrections preserve audit, amounts, coverage and backups while moving cash month",async t=>{
  const {db,item,payments,service,backups}=setup();t.after(()=>db.close());
  await payments.add(1,{subscriptionId:item.id,entries:[{...entry(),paidOn:"2024-10-10"}]});
  const log=payments.all(1)[0], before=service.list(1);
  assert.equal(defaultPaymentDate({...log,payment:null},"2024-10-10"),"2024-05-20");
  assert.throws(()=>payments.correctDate(2,{id:log.id,paidOn:"2024-05-20",expectedPaidOn:"2024-10-10"}),{status:404});
  payments.correctDate(1,{id:log.id,paidOn:"2024-05-20",expectedPaidOn:"2024-10-10"});
  const corrected=payments.all(1)[0];
  assert.deepEqual({...corrected.payment,paidOn:log.payment!.paidOn,dateCorrections:undefined},{...log.payment,dateCorrections:undefined});
  assert.equal(corrected.payment!.dateCorrections![0].from,"2024-10-10");
  assert.equal(paymentReport([corrected],[],"2024-10-10","2024-10").total,0);
  assert.equal(paymentReport([corrected],[],"2024-10-10","2024-05").total,100);
  assert.deepEqual(service.list(1),before);
  assert.throws(()=>payments.correctDate(1,{id:log.id,paidOn:"2024-05-21",expectedPaidOn:"2024-10-10"}),{status:409});
  const backup=backups.export(1);backups.import(2,{backup,mode:"merge",expectedRevision:backups.preview(2,backup).revision});
  assert.deepEqual(payments.all(2),payments.all(1));
  payments.void(1,{id:log.id});assert.throws(()=>payments.correctDate(1,{id:log.id,paidOn:"2024-05-21",expectedPaidOn:"2024-05-20"}),{status:409});
});
