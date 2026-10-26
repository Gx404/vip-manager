import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { PaymentService } from "../src/payments.ts";
import { RenewalHistory } from "../src/renewal-history.ts";
import { ExchangeRates } from "../src/exchange-rates.ts";
import { paymentReport } from "../../shared/payment-reports.ts";
import { dateInTimeZone, nextRenewalPeriod } from "../../shared/billing.ts";
import { readConfig } from "../src/config.ts";
import { AuthService, bootstrapAdmin } from "../src/auth.ts";
import { createApp } from "../src/app.ts";
import type { DashboardSnapshot } from "../../shared/subscriptions.ts";

const now=new Date("2026-10-26T04:00:00Z");
const draft=()=>({id:randomUUID(),name:"移动云电脑",plan:"32+200",category:"办公效率",amount:29.9,
  currency:"CNY",purchaseDate:"2026-08-22",cycle:"monthly",customDays:30,startDate:"2026-08-22",endDate:"2026-09-22",
  reminderDays:7,autoRenew:false,note:"private-membership-note",color:"#269979"});
const charge=()=>({amount:29.9,currency:"CNY",paidOn:"2026-08-22",note:"private-receipt-note"});
function setup(){
  const db=openDatabase(":memory:"); db.exec("INSERT INTO users VALUES(1,'owner','hash',0),(2,'other','hash',0)");
  const rates=new ExchangeRates(async()=>Response.json({date:"2026-08-22",base:"USD",quote:"CNY",rate:7}));
  return {db,service:new SubscriptionService(db,"Asia/Shanghai",()=>now,rates),payments:new PaymentService(db,rates,{timeZone:"Asia/Shanghai",clock:()=>now})};
}

test("new membership only counts an explicitly confirmed initial payment and rolls back invalid payment",t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  const unpaid=service.execute(1,{action:"create",item:draft()}).item!;
  assert.equal(payments.all(1).length,0);
  const paid=service.execute(1,{action:"create",item:draft(),payment:charge()}).item!;
  const receipt=payments.all(1)[0].payment!;
  assert.deepEqual([receipt.amount,receipt.paidOn,receipt.startDate,receipt.endDate,receipt.source],[29.9,"2026-08-22",paid.startDate,paid.endDate,"backfill"]);
  assert.equal(paymentReport(payments.all(1),service.list(1).items,"2026-10-26","2026").total,29.9);
  const bad=draft();
  assert.throws(()=>service.execute(1,{action:"create",item:bad,payment:{...charge(),paidOn:"2026-10-27"}}),{status:400});
  assert.equal(service.list(1).items.some(item=>item.id===bad.id),false);
  assert.equal(service.list(1).items.some(item=>item.id===unpaid.id),true);
  db.exec("CREATE TRIGGER reject_initial_receipt BEFORE INSERT ON subscription_renewal_logs BEGIN SELECT RAISE(ABORT,'fixture'); END");
  const failure=draft();assert.throws(()=>service.execute(1,{action:"create",item:failure,payment:charge()}));
  assert.equal(service.list(1).items.some(item=>item.id===failure.id),false);
});

test("stable creation ID tolerates a lost response and rejects changed data/payment or later changes",t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  const input={action:"create",item:draft(),payment:charge()};
  const created=service.execute(1,input).item!;
  assert.deepEqual(service.execute(1,input).item,created);
  assert.equal(payments.all(1).length,1);assert.equal(service.list(1).items.length,1);
  assert.throws(()=>service.execute(1,{...input,item:{...input.item,amount:30}}),{status:409,code:"CREATE_CONFLICT"});
  assert.throws(()=>service.execute(1,{...input,payment:{...charge(),amount:30}}),{status:409});
  assert.throws(()=>service.execute(1,{action:"create",item:input.item}),{status:409});
  service.execute(1,{action:"update",id:created.id,version:created.version,item:{...created,note:"changed"}});
  assert.throws(()=>service.execute(1,input),{status:409});
  const unpaid={action:"create",item:draft()};service.execute(1,unpaid);service.execute(1,unpaid);
  assert.equal(service.list(1).items.length,2);assert.equal(payments.all(1).length,1);
});

test("delete preserves only real paid receipts by default, purge clears only the selected owner's membership",t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  const paid=service.execute(1,{action:"create",item:draft(),payment:charge()}).item!;
  const other=service.execute(1,{action:"create",item:draft(),payment:charge()}).item!;
  service.execute(2,{action:"create",item:{...draft(),id:paid.id},payment:charge()});
  const renewed=service.execute(1,{action:"renew",id:paid.id,version:paid.version,renewalMode:"continue",payment:{...charge(),paidOn:"2026-09-22"}}).item!;
  db.prepare("UPDATE subscription_renewal_logs SET payment_json=NULL WHERE user_id=1 AND subscription_id=? AND new_start_date='2026-09-22'").run(paid.id);
  db.prepare("INSERT INTO subscription_billing_facts VALUES(?,?,?,?)").run(1,randomUUID(),paid.id,JSON.stringify({id:randomUUID(),subscriptionId:paid.id}));
  db.prepare(`INSERT INTO email_notification_deliveries(user_id,notification_key,channel,subscription_id,end_date,reminder_days,status,attempts,created_at,updated_at) VALUES(1,?,'email',?,'2026-09-22',7,'sent',1,0,0)`).run(randomUUID(),paid.id);
  service.execute(1,{action:"delete",id:paid.id,version:renewed.version});
  assert.equal(payments.all(1).filter(log=>log.subscriptionId===paid.id).length,1);
  assert.equal(paymentReport(payments.all(1),service.list(1).items,"2026-10-26","2026").total,59.8);
  assert.equal(new RenewalHistory(db).facts(1).filter(fact=>fact.subscriptionId===paid.id).length,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM email_notification_deliveries WHERE user_id=1 AND subscription_id=?").get(paid.id)?.n,0);
  assert.throws(()=>service.execute(1,{action:"create",item:{...draft(),id:paid.id}}),{status:409});
  const deleted=service.execute(1,{action:"create",item:{...draft(),autoRenew:true},payment:charge()}).item!;
  service.advanceAutomaticRenewals(now);
  const current=service.list(1).items.find(item=>item.id===deleted.id)!;
  service.execute(1,{action:"delete",id:deleted.id,version:current.version,deleteMode:"purge"});
  for(const table of ["subscriptions","subscription_renewal_logs","subscription_billing_facts","automatic_renewal_events","email_notification_deliveries"]){
    const idColumn=table==="subscriptions"?"id":"subscription_id";
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id=1 AND ${idColumn}=?`).get(deleted.id)?.n,0);
  }
  assert.equal(service.list(1).items.some(item=>item.id===other.id),true);assert.equal(payments.all(2).length,1);
});

test("unconfirmed original periods are read-only suggestions and disappear after explicit recording",async t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  const old=service.execute(1,{action:"create",item:draft()}).item!;
  service.execute(1,{action:"create",item:draft(),payment:charge()});
  const before=db.prepare("SELECT total_changes() AS total").get()?.total;const list=payments.reconciliation(1).periods;
  assert.equal(list.length,1);assert.equal(list[0].subscriptionId,old.id);assert.equal(list[0].startDate,"2026-08-22");
  assert.equal(db.prepare("SELECT total_changes() AS total").get()?.total,before);assert.equal(payments.reconciliation(2).periods.length,0);
  const {subscriptionId,subscriptionName:_name,plan:_plan,...entry}=list[0];
  assert.deepEqual(await payments.add(1,{subscriptionId,entries:[{...entry,note:"confirmed old receipt"}]}),{added:1,skipped:0});
  assert.equal(payments.reconciliation(1).periods.length,0);
});

test("automatic catch-up is unpaid and exposes each unconfirmed period without charging twice",async t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  const item=service.execute(1,{action:"create",item:{...draft(),autoRenew:true},payment:charge()}).item!;
  assert.equal(service.advanceAutomaticRenewals(now),1);
  const log=payments.all(1).find(log=>log.kind==="automatic")!;
  assert.equal(log.periods,2);assert.equal(log.payment,null);
  const pending=payments.pendingPeriods(1,log.id).periods;
  assert.deepEqual(pending.map(p=>[p.startDate,p.endDate,p.amount]),[["2026-09-22","2026-10-22",29.9],["2026-10-22","2026-11-22",29.9]]);
  assert.equal(paymentReport(payments.all(1),service.list(1).items,"2026-10-26","2026").total,29.9);
  for(const p of pending) await payments.add(1,{subscriptionId:item.id,entries:[{amount:p.amount,currency:p.currency,paidOn:p.paidOn,startDate:p.startDate,endDate:p.endDate,note:"confirmed"}]});
  assert.deepEqual(payments.pendingPeriods(1,log.id),{periods:[]});
  assert.equal(Math.round(paymentReport(payments.all(1),service.list(1).items,"2026-10-26","2026").total*100),8970);
  const p=pending[0];
  assert.deepEqual(await payments.add(1,{subscriptionId:item.id,entries:[{amount:p.amount,currency:p.currency,paidOn:p.paidOn,startDate:p.startDate,endDate:p.endDate,note:"retry"}]}),{added:0,skipped:1});
});

test("single automatic period can be recorded via the same per-period backfill flow",async t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  const item=service.execute(1,{action:"create",item:{...draft(),startDate:"2026-09-22",endDate:"2026-10-22",autoRenew:true}}).item!;
  service.advanceAutomaticRenewals(now);
  const log=payments.all(1)[0], p=payments.pendingPeriods(1,log.id).periods[0];
  assert.equal(log.periods,1);
  assert.deepEqual(await payments.add(1,{subscriptionId:item.id,entries:[{amount:p.amount,currency:p.currency,paidOn:p.paidOn,startDate:p.startDate,endDate:p.endDate,note:"confirmed"}]}),{added:1,skipped:0});
  assert.equal(payments.pendingPeriods(1,log.id).periods.length,0);
});

test("historical catch-up keeps original monthly intervals and price after yearly/custom edits",t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  const item=service.execute(1,{action:"create",item:{...draft(),autoRenew:true}}).item!;
  service.advanceAutomaticRenewals(now);
  const log=payments.all(1)[0], before=payments.pendingPeriods(1,log.id).periods;
  let latest=service.list(1).items.find(current=>current.id===item.id)!;
  latest=service.execute(1,{action:"update",id:item.id,version:latest.version,item:{...latest,cycle:"yearly",amount:999}}).item!;
  assert.deepEqual(payments.pendingPeriods(1,log.id).periods,before);
  service.execute(1,{action:"update",id:item.id,version:latest.version,item:{...latest,cycle:"custom",customDays:90,amount:777}});
  assert.deepEqual(payments.pendingPeriods(1,log.id).periods,before);
  assert.deepEqual(before.map(p=>[p.startDate,p.endDate,p.amount]),[["2026-09-22","2026-10-22",29.9],["2026-10-22","2026-11-22",29.9]]);
});

test("historical quarterly/yearly/custom catch-ups recover immutable boundaries after current cycle changes",t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  const originals=[
    {...draft(),cycle:"quarterly",startDate:"2026-03-22",endDate:"2026-06-22"},
    {...draft(),cycle:"yearly",startDate:"2023-08-22",endDate:"2024-08-22"},
    {...draft(),cycle:"custom",customDays:15,startDate:"2026-08-01",endDate:"2026-08-16"},
  ];
  for(const original of originals) service.execute(1,{action:"create",item:{...original,autoRenew:true}});
  service.advanceAutomaticRenewals(now);
  const expectations=payments.all(1).map(log=>({log,periods:payments.pendingPeriods(1,log.id).periods}));
  for(const item of service.list(1).items) service.execute(1,{action:"update",id:item.id,version:item.version,item:{...item,cycle:"monthly",amount:123}});
  for(const expected of expectations){
    assert.deepEqual(payments.pendingPeriods(1,expected.log.id).periods,expected.periods);
    assert.equal(expected.periods.length,expected.log.periods);
    assert.equal(expected.periods[0].startDate,expected.log.previousEndDate);
    assert.equal(expected.periods.at(-1)!.startDate,expected.log.newStartDate);
    assert.equal(expected.periods.at(-1)!.endDate,expected.log.newEndDate);
    assert.ok(expected.periods.every(period=>period.amount===29.9));
  }
});

test("ambiguous or inconsistent historical period boundaries require manual reconciliation",t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  service.execute(1,{action:"create",item:{...draft(),autoRenew:true}});service.advanceAutomaticRenewals(now);
  const log=payments.all(1)[0];
  db.prepare("UPDATE subscription_renewal_logs SET previous_end_date='2026-01-30',new_start_date='2026-04-30',new_end_date='2026-05-30',new_anchor_date='2026-01-30',periods=4 WHERE user_id=1 AND id=?").run(log.id);
  const before=db.prepare("SELECT total_changes() AS total").get()?.total;
  assert.throws(()=>payments.pendingPeriods(1,log.id),{status:409,code:"RECONCILIATION_PERIOD_AMBIGUOUS"});
  assert.equal(db.prepare("SELECT total_changes() AS total").get()?.total,before);
  db.prepare("UPDATE subscription_renewal_logs SET new_start_date='2026-04-29' WHERE user_id=1 AND id=?").run(log.id);
  assert.throws(()=>payments.pendingPeriods(1,log.id),{status:409,code:"RECONCILIATION_PERIOD_AMBIGUOUS"});
});

test("legacy imported three-period audit with final-start anchor recovers without negative-index loops",t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  const item=service.execute(1,{action:"create",item:{...draft(),autoRenew:true}}).item!;
  service.advanceAutomaticRenewals(new Date("2026-11-26T04:00:00Z"));
  const log=payments.all(1)[0];assert.equal(log.periods,3);
  const importedPayments=new PaymentService(db,new ExchangeRates(),{timeZone:"Asia/Shanghai",clock:()=>new Date("2026-11-26T04:00:00Z")});
  const before=importedPayments.pendingPeriods(1,log.id).periods;
  db.prepare("UPDATE subscription_renewal_logs SET new_anchor_date=new_start_date,previous_anchor_date=previous_start_date WHERE user_id=1 AND id=?").run(log.id);
  const latest=service.list(1).items.find(current=>current.id===item.id)!;
  service.execute(1,{action:"update",id:item.id,version:latest.version,item:{...latest,cycle:"yearly",amount:888}});
  assert.deepEqual(importedPayments.pendingPeriods(1,log.id).periods,before);
  assert.deepEqual(before.map(p=>[p.startDate,p.endDate,p.amount]),[["2026-09-22","2026-10-22",29.9],["2026-10-22","2026-11-22",29.9],["2026-11-22","2026-12-22",29.9]]);
});

test("saved leap-day anchor reaches the client and preview matches authoritative renewal",t=>{
  const {db,service}=setup();t.after(()=>db.close());
  const original=service.execute(1,{action:"create",item:{...draft(),cycle:"yearly",startDate:"2024-02-29",endDate:"2025-02-28"}}).item!;
  const first=service.execute(1,{action:"renew",id:original.id,version:original.version,renewalMode:"continue"}).item!;
  const second=service.execute(1,{action:"renew",id:first.id,version:first.version,renewalMode:"continue"}).item!;
  assert.equal(second.renewalAnchorDate,"2024-02-29");
  assert.equal(service.listPublic()[0].renewalAnchorDate,"2024-02-29");
  const preview=nextRenewalPeriod(second,"2026-10-26",second.renewalAnchorDate,{mode:"continue",paidOn:"2026-10-26"});
  const next=service.execute(1,{action:"renew",id:second.id,version:second.version,renewalMode:"continue"}).item!;
  assert.equal(preview.endDate,"2028-02-29");assert.equal(next.endDate,preview.endDate);
  const irregular=service.execute(1,{action:"create",item:{...draft(),startDate:"2026-01-01",endDate:"2026-02-15"}}).item!;
  db.prepare("UPDATE subscriptions SET renewal_anchor_date='' WHERE user_id=1 AND id=?").run(irregular.id);
  assert.equal(service.list(1).items.find(item=>item.id===irregular.id)?.renewalAnchorDate,"2026-02-15");
});

test("one future imported payment cannot block valid pending foreign-payment conversion",async t=>{
  const {db,service,payments}=setup();t.after(()=>db.close());
  for(let i=0;i<2;i++) service.execute(1,{action:"create",item:draft(),payment:{...charge(),currency:"USD"}});
  const [future,valid]=payments.all(1);
  db.prepare("UPDATE subscription_renewal_logs SET payment_json=? WHERE user_id=1 AND id=?")
    .run(JSON.stringify({...future.payment!,paidOn:"2199-01-01"}),future.id);
  await payments.refreshPendingRates();
  assert.equal(payments.all(1).find(log=>log.id===valid.id)?.payment?.rate,7);
  assert.equal(payments.all(1).find(log=>log.id===future.id)?.payment?.rate,null);
});

test("dashboard exposes approved expenditure aggregates only; receipt and reconciliation APIs remain private",async t=>{
  const db=openDatabase(":memory:");t.after(()=>db.close());
  const config=readConfig({PUBLIC_ORIGIN:"http://frontend.test",COOKIE_SECURE:"false",PUBLIC_DASHBOARD:"true",ADMIN_USERNAME:"testadmin",ADMIN_PASSWORD:"test-only-not-a-production-password"});
  await bootstrapAdmin(db,config);
  const service=new SubscriptionService(db,config.timeZone), owner=Number(db.prepare("SELECT id FROM users LIMIT 1").get()?.id);
  service.execute(owner,{action:"create",item:draft(),payment:{...charge(),paidOn:dateInTimeZone(new Date(),config.timeZone)}});
  const server=createApp(db,config).listen(0,"127.0.0.1");
  await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  t.after(()=>new Promise<void>((resolve,reject)=>server.close(err=>err?reject(err):resolve())));
  const address=server.address();assert.ok(address&&typeof address!=="string");const url="http://127.0.0.1:"+address.port;
  const publicResponse=await fetch(url+"/api/dashboard");assert.equal(publicResponse.status,200);
  const body=await publicResponse.json() as DashboardSnapshot;
  assert.equal(body.spending?.yearTotal,29.9);assert.equal(body.spending?.yearCount,1);assert.equal(body.canManage,false);
  assert.equal(body.items[0].note,"");assert.equal(body.timeZone,config.timeZone);assert.match(body.today!,/^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(body.spending!).sort(),["monthCount","monthMissingRates","monthTotal","yearCount","yearMissingRates","yearTotal"]);
  assert.equal(JSON.stringify(body).includes("private-receipt-note"),false);
  assert.equal((await fetch(url+"/api/payments")).status,401);assert.equal((await fetch(url+"/api/payments/reconciliation")).status,401);
  assert.equal((await fetch(url+"/api/payments/pending-periods?id="+randomUUID())).status,401);
  const session=await new AuthService(db,config).login(config.adminUsername,config.adminPassword!,"198.51.100.7");
  const headers={Cookie:`membership_session=${session.token}`};
  const authenticated=await (await fetch(url+"/api/dashboard",{headers})).json() as DashboardSnapshot;
  assert.deepEqual(authenticated.spending,body.spending);assert.equal(authenticated.canManage,true);
  assert.equal((await fetch(url+"/api/payments/pending-periods?id=invalid",{headers})).status,400);
  assert.deepEqual(await (await fetch(url+"/api/payments/reconciliation",{headers})).json(),{periods:[]});
});
