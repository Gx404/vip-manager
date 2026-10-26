import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {test} from "node:test";
import {openDatabase} from "../src/database.ts";
import {SubscriptionService} from "../src/subscriptions.ts";
import {BackupService} from "../src/backups.ts";
import {PaymentService} from "../src/payments.ts";
import type {BackupDocument} from "../../shared/renewals.ts";

const clock=()=>new Date("2026-10-25T17:00:00Z");
function fixture() {
  const db=openDatabase(":memory:");
  db.exec("INSERT INTO users VALUES(1,'owner','test-only',0),(2,'second','test-only',0)");
  const service=new SubscriptionService(db,"Asia/Shanghai",clock);
  const item=service.execute(1,{action:"create",item:{id:randomUUID(),name:"Import fixture",plan:"Monthly",category:"其他服务",amount:6,currency:"CNY",cycle:"monthly",customDays:30,startDate:"2026-08-22",endDate:"2026-09-22",reminderDays:7,autoRenew:false,note:"",color:"#269979",version:0}}).item!;
  service.execute(1,{action:"renew",id:item.id,version:item.version,renewalMode:"continue",payment:{amount:6,currency:"CNY",paidOn:"2026-09-22",note:""}});
  const backups=new BackupService(db,{timeZone:"Asia/Shanghai",clock});
  return {db,service,backups,backup:backups.export(1)};
}
const copy=(backup:BackupDocument)=>structuredClone(backup);

test("import preview exposes different-ID overlapping payments and import refuses atomically",t=>{
  const {db,backups,backup}=fixture();t.after(()=>db.close());
  const duplicate=copy(backup);duplicate.renewalLogs.push({...structuredClone(duplicate.renewalLogs[0]),id:randomUUID()});
  const preview=backups.preview(2,duplicate);
  assert.deepEqual(preview.paymentConflicts,{merge:2,replace:2});
  assert.throws(()=>backups.import(2,{backup:duplicate,mode:"merge",expectedRevision:preview.revision}),{status:409,code:"IMPORT_PAYMENT_CONFLICT"});
  assert.equal(db.prepare("SELECT count(*) AS n FROM subscriptions WHERE user_id=2").get()!.n,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM subscription_renewal_logs WHERE user_id=2").get()!.n,0);
});

test("merge checks existing paid intervals while replacement checks only its replacement document",t=>{
  const {db,backups,backup}=fixture();t.after(()=>db.close());
  const different=copy(backup);different.renewalLogs[0].id=randomUUID();
  const preview=backups.preview(1,different);
  assert.deepEqual(preview.paymentConflicts,{merge:1,replace:0});
  assert.throws(()=>backups.import(1,{backup:different,mode:"merge",expectedRevision:preview.revision}),{status:409,code:"IMPORT_PAYMENT_CONFLICT"});
  assert.equal(backups.import(1,{backup:different,mode:"replace",confirmReplace:true,expectedRevision:preview.revision}).importedLogs,1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM subscription_renewal_logs WHERE user_id=1").get()!.n,1);
});

test("same-ID retries remain idempotent and touching boundaries are not overlapping",t=>{
  const {db,backups,backup,service}=fixture();t.after(()=>db.close());
  const preview=backups.preview(1,backup);assert.deepEqual(preview.paymentConflicts,{merge:0,replace:0});
  assert.equal(backups.import(1,{backup,mode:"merge",expectedRevision:preview.revision}).importedLogs,0);
  const item=service.list(1).items[0];
  service.execute(1,{action:"renew",id:item.id,version:item.version,renewalMode:"continue",payment:{amount:6,currency:"CNY",paidOn:"2026-10-22",note:""}});
  const both=backups.export(1),emptyPreview=backups.preview(2,both);
  assert.deepEqual(emptyPreview.paymentConflicts,{merge:0,replace:0});
  assert.equal(backups.import(2,{backup:both,mode:"merge",expectedRevision:emptyPreview.revision}).importedLogs,2);
});

test("future paid dates reject preview and import using application timezone",t=>{
  const {db,backups,backup}=fixture();t.after(()=>db.close());
  const future=copy(backup);future.renewalLogs[0].payment!.paidOn="2099-01-01";
  future.renewalLogs[0].payment!.rateDate="2099-01-01";
  assert.throws(()=>backups.preview(2,future),{status:400,code:"IMPORT_FUTURE_PAYMENT"});
  const revision=backups.preview(2,backup).revision;
  assert.throws(()=>backups.import(2,{backup:future,mode:"merge",expectedRevision:revision}),{status:400,code:"IMPORT_FUTURE_PAYMENT"});
  const today=copy(backup);today.renewalLogs[0].payment!.paidOn="2026-10-26";today.renewalLogs[0].payment!.rateDate="2026-10-26";
  assert.equal(backups.preview(2,today).paymentConflicts.merge,0);
});

test("pending automatic schedules may overlap paid backfills without creating a payment conflict",t=>{
  const {db,backups,backup}=fixture();t.after(()=>db.close());
  const pending=copy(backup);pending.renewalLogs.push({...structuredClone(pending.renewalLogs[0]),id:randomUUID(),kind:"automatic",periods:2,payment:null});
  const preview=backups.preview(2,pending);assert.deepEqual(preview.paymentConflicts,{merge:0,replace:0});
  assert.equal(backups.import(2,{backup:pending,mode:"merge",expectedRevision:preview.revision}).importedLogs,2);
});

test("merging an older document still cannot resurrect a canceled payment ID",t=>{
  const {db,backups,backup}=fixture();t.after(()=>db.close());
  new PaymentService(db,undefined,{timeZone:"Asia/Shanghai",clock}).void(1,{id:backup.renewalLogs[0].id});
  const preview=backups.preview(1,backup);
  assert.equal(preview.newLogs,0);assert.equal(preview.paymentConflicts.merge,0);
  assert.equal(backups.import(1,{backup,mode:"merge",expectedRevision:preview.revision}).importedLogs,0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM subscription_renewal_logs WHERE user_id=1").get()!.n,0);
});
