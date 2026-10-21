import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { PaymentService } from "../src/payments.ts";
import { RenewalHistory } from "../src/renewal-history.ts";
import { BackupService } from "../src/backups.ts";
import { billingProgress } from "../../shared/presentation.ts";
import { paymentReport } from "../../shared/payment-reports.ts";
import type { BillingFact, RenewalLog } from "../../shared/renewals.ts";
import type { Subscription } from "../../shared/subscriptions.ts";

const now=new Date("2026-10-20T04:00:00Z");
function fixture(filename=":memory:") {
  const db=openDatabase(filename);
  db.exec("INSERT INTO users VALUES(1,'owner','hash',0),(2,'other','hash',0)");
  const service=new SubscriptionService(db,"Asia/Shanghai",()=>now);
  const payments=new PaymentService(db,undefined,{timeZone:"Asia/Shanghai",clock:()=>now});
  const history=new RenewalHistory(db),backups=new BackupService(db);
  const original:Subscription={id:randomUUID(),name:"Gemini",plan:"Pro",category:"AI 工具",amount:38,currency:"CNY",
    startDate:"2026-01-19",endDate:"2027-01-19",cycle:"yearly",customDays:30,reminderDays:7,autoRenew:false,
    note:"",color:"#269979",version:0,purchaseDate:"2026-01-19",fxRateToCny:1,fxRateDate:"2026-01-19",fxRateSource:"manual"};
  const item=service.execute(1,{action:"create",item:original}).item!;
  const command={action:"renew",id:item.id,version:item.version,requestId:randomUUID(),
    payment:{amount:8.99,currency:"USD",paidOn:"2026-10-19",note:"private canceled receipt"}};
  const renew=()=>service.execute(1,command);
  return {db,service,payments,history,backups,item,renew,command};
}

function reports(logs:RenewalLog[],items:Subscription[],facts:BillingFact[]=[]) {
  return ["2026-10-20","2027-10-20"].flatMap(today=>["cash","accrual"].flatMap(basis=>
    ["",today.slice(0,4),today.slice(0,7)].map(period=>paymentReport(logs,items,today,period,basis as "cash"|"accrual",facts))));
}

test("deleting a changed-price Gemini payment preserves current progress and old CNY38 without resurrecting the canceled charge",t=>{
  const {db,service,payments,history,backups,renew}=fixture();t.after(()=>db.close());
  const renewed=renew(),before=service.list(1),log=payments.all(1)[0];
  const legacy={...log,payment:{...log.payment!,voidedAt:now.toISOString()}};
  const expected=reports([legacy],before.items);
  payments.void(1,{id:renewed.renewal!.id});
  assert.deepEqual(payments.all(1),[]);assert.equal(history.list(1).total,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM subscription_renewal_logs").get()!.n,0);
  assert.deepEqual(service.list(1),before,"deleting payment data must not change the valid subscription schedule");
  assert.deepEqual(billingProgress(service.list(1).items[0],"2026-10-20"),billingProgress(before.items[0],"2026-10-20"));
  const facts=history.facts(1);
  assert.equal(facts.length,1);assert.equal(facts[0].schedule!.amount,38);assert.equal(facts[0].schedule!.currency,"CNY");
  assert.deepEqual(facts[0].excludedPeriod,{startDate:"2027-01-19",endDate:"2028-01-19"});
  for(const privateValue of ["8.99","2026-10-19","private canceled receipt","confirmedAt","voidedAt","corrections","purchaseDate"])
    assert.equal(JSON.stringify(facts).includes(privateValue),false,`deleted payment detail ${privateValue} is not retained`);
  assert.deepEqual(reports([],before.items,facts),expected);
  assert.equal(paymentReport([],before.items,"2026-10-20","","cash",facts).total,38);
  assert.equal(paymentReport([],before.items,"2027-10-20","2027","accrual",facts).total,0);

  const backup=backups.export(1);
  assert.equal(backup.formatVersion,4);assert.deepEqual(backup.renewalLogs,[]);
  backups.import(2,{backup,mode:"merge",expectedRevision:backups.preview(2,backup).revision});
  assert.deepEqual(payments.all(2),[]);assert.deepEqual(history.facts(2),facts);
  assert.deepEqual(reports([],service.list(2).items,history.facts(2)),expected);
  assert.equal(service.list(2).items[0].coverageStartDate,before.items[0].coverageStartDate);
});

test("undo deletes immediately and merging an older backup cannot revive the removed payment",t=>{
  const {db,service,payments,history,backups,item,renew,command}=fixture();t.after(()=>db.close());
  const renewed=renew(),oldBackup=backups.export(1),oldPreview=backups.preview(1,oldBackup);
  service.execute(1,{action:"undoRenew",id:item.id,version:renewed.item!.version,logId:renewed.renewal!.id});
  assert.deepEqual(payments.all(1),[]);assert.equal(history.list(1).total,0);
  assert.equal(history.facts(1)[0].schedule,undefined);
  assert.equal(service.list(1).items[0].amount,38);assert.equal(service.list(1).items[0].endDate,item.endDate);
  assert.throws(()=>service.execute(1,{...command,version:service.list(1).items[0].version}),{status:409});
  assert.throws(()=>backups.import(1,{backup:oldBackup,mode:"merge",expectedRevision:oldPreview.revision}),{status:409});
  const preview=backups.preview(1,oldBackup);assert.equal(preview.newLogs,0);
  assert.equal(backups.import(1,{backup:oldBackup,mode:"merge",expectedRevision:preview.revision}).importedLogs,0);
  assert.deepEqual(payments.all(1),[]);assert.equal(service.list(1).items[0].endDate,item.endDate);
  assert.deepEqual(history.facts(2),[]);
  assert.throws(()=>payments.void(2,{id:renewed.renewal!.id}),{status:404});
});

test("legacy backups containing canceled rows import only minimal facts and keep prior price and coverage",t=>{
  const {db,service,payments,history,backups,renew}=fixture();t.after(()=>db.close());
  renew();const legacy=backups.export(1);legacy.formatVersion=3;delete legacy.billingFacts;
  legacy.renewalLogs[0].payment!.voidedAt=now.toISOString();
  const before=service.list(1);
  const preview=backups.preview(2,legacy);assert.equal(preview.newLogs,0);
  assert.equal(backups.import(2,{backup:legacy,mode:"merge",expectedRevision:preview.revision}).importedLogs,0);
  assert.deepEqual(payments.all(2),[]);assert.deepEqual(backups.export(2).renewalLogs,[]);
  assert.equal(history.facts(2).length,1);
  assert.deepEqual(reports([],service.list(2).items,history.facts(2)),reports(legacy.renewalLogs,before.items));
});

test("migration 009 removes legacy voids and undos while protecting other active records",t=>{
  const directory=mkdtempSync(join(tmpdir(),"vip-canceled-")),filename=join(directory,"test.sqlite");
  let migrated:ReturnType<typeof openDatabase>|undefined;
  t.after(()=>{migrated?.close();rmSync(directory,{recursive:true,force:true});});
  const {db,service,payments,renew}=fixture(filename);
  const renewed=renew(),item=service.list(1).items[0];
  const payment={...renewed.renewal!.payment!,voidedAt:now.toISOString()};
  db.prepare("UPDATE subscription_renewal_logs SET payment_json=? WHERE id=?").run(JSON.stringify(payment),renewed.renewal!.id);
  const other=service.execute(2,{action:"create",item:{...item,id:randomUUID(),version:0}}).item!;
  service.execute(2,{action:"renew",id:other.id,version:0});
  const third=service.execute(1,{action:"create",item:{...item,id:randomUUID(),version:0}}).item!;
  const undone=service.execute(1,{action:"renew",id:third.id,version:0});
  db.prepare("UPDATE subscription_renewal_logs SET undone_at=created_at,undo_until=NULL WHERE id=?").run(undone.renewal!.id);
  const before=reports(payments.all(1),service.list(1).items),coverage=item.coverageStartDate;
  db.exec("DROP TABLE subscription_billing_facts; PRAGMA user_version=8");db.close();
  migrated=openDatabase(filename);
  const saved=new RenewalHistory(migrated),subscriptions=new SubscriptionService(migrated,"Asia/Shanghai");
  assert.equal(migrated.prepare("PRAGMA user_version").get()!.user_version,9);
  assert.deepEqual(saved.list(1).logs,[]);assert.equal(saved.list(2).total,1);
  assert.equal(saved.facts(1).length,2);assert.deepEqual(saved.facts(2),[]);
  assert.equal(subscriptions.list(1).items.find(record=>record.id===item.id)!.coverageStartDate,coverage);
  assert.deepEqual(reports([],subscriptions.list(1).items,saved.facts(1)),before);
});

test("failed physical deletion rolls back cancellation, facts and undo schedule in one transaction",t=>{
  const {db,service,payments,history,item,renew}=fixture();t.after(()=>db.close());
  const renewed=renew(),before=service.list(1),log=payments.all(1)[0];
  db.exec("CREATE TRIGGER refuse_delete BEFORE DELETE ON subscription_renewal_logs BEGIN SELECT RAISE(ABORT,'fixture'); END");
  assert.throws(()=>payments.void(1,{id:log.id}));
  assert.deepEqual(payments.all(1),[log]);assert.deepEqual(history.facts(1),[]);assert.deepEqual(service.list(1),before);
  assert.throws(()=>service.execute(1,{action:"undoRenew",id:item.id,version:renewed.item!.version,logId:log.id}));
  assert.deepEqual(payments.all(1),[log]);assert.deepEqual(history.facts(1),[]);assert.deepEqual(service.list(1),before);
});
