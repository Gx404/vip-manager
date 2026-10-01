import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { RenewalHistory } from "../src/renewal-history.ts";
import { BackupService } from "../src/backups.ts";
import type { Subscription } from "../../shared/subscriptions.ts";

const item = (changes:Partial<Subscription>={}):Subscription=>({id:randomUUID(),name:"Test",plan:"",category:"AI 工具",amount:19.99,cycle:"monthly",customDays:30,startDate:"2026-09-30",endDate:"2026-10-30",reminderDays:7,autoRenew:false,note:"private",color:"#269979",version:0,...changes});
function setup() {
  const db=openDatabase(":memory:");
  db.exec("INSERT INTO users VALUES(1,'owner','preserved-hash',0),(2,'other','other-hash',0)");
  let now=new Date("2026-10-01T00:00:00Z");
  return { db, service:new SubscriptionService(db,"Asia/Shanghai",()=>now), history:new RenewalHistory(db), backups:new BackupService(db), tick:(ms:number)=>{now=new Date(now.getTime()+ms);} };
}

test("manual renewal is atomic, idempotent and reversible once with an auditable amount",t=>{
  const {db,service,history,tick}=setup();t.after(()=>db.close());
  const original=service.execute(1,{action:"create",item:item()}).item!;
  const command={action:"renew",id:original.id,version:original.version,requestId:randomUUID()};
  const result=service.execute(1,command);
  assert.equal(result.item?.endDate,"2026-11-30");assert.equal(result.renewal?.amount,19.99);
  assert.equal(result.renewal?.previousEndDate,original.endDate);
  assert.equal(service.execute(1,command).renewal?.id,result.renewal?.id);
  assert.equal(history.list(1).total,1);assert.equal(history.list(2).total,0);
  tick(5000);
  const undo={action:"undoRenew",id:original.id,version:result.item!.version,logId:result.renewal!.id};
  const undone=service.execute(1,undo);
  assert.equal(undone.item?.endDate,original.endDate);assert.equal(undone.item?.note,"private");
  assert.equal(undone.item?.version,2);assert.ok(undone.renewal?.undoneAt);
  assert.throws(()=>service.execute(1,{...undo,version:2}),{status:409});
  assert.throws(()=>service.execute(1,command),{status:409});
});

test("undo refuses expiry, later edits and cross-owner access without losing newer data",t=>{
  const {db,service,tick}=setup();t.after(()=>db.close());
  const original=service.execute(1,{action:"create",item:item()}).item!;
  const result=service.execute(1,{action:"renew",id:original.id,version:0});
  assert.throws(()=>service.execute(2,{action:"undoRenew",id:original.id,version:1,logId:result.renewal!.id}),{status:404});
  const changed=service.execute(1,{action:"update",id:original.id,version:1,item:{...result.item!,note:"new edit"}}).item!;
  assert.throws(()=>service.execute(1,{action:"undoRenew",id:original.id,version:changed.version,logId:result.renewal!.id}),{status:409});
  assert.equal(service.list(1).items[0].note,"new edit");
  const latest=service.execute(1,{action:"renew",id:original.id,version:changed.version});tick(30_000);
  assert.throws(()=>service.execute(1,{action:"undoRenew",id:original.id,version:latest.item!.version,logId:latest.renewal!.id}),{code:"UNDO_UNAVAILABLE"});
});

test("automatic catch-up records period count and estimated total once; deleting membership retains history",t=>{
  const {db,service,history}=setup();t.after(()=>db.close());
  const original=service.execute(1,{action:"create",item:item({amount:20,startDate:"2026-09-01",endDate:"2026-10-01",autoRenew:true})}).item!;
  service.advanceAutomaticRenewals(new Date("2026-12-01T00:00:00Z"));
  service.advanceAutomaticRenewals(new Date("2026-12-01T00:00:00Z"));
  const logs=history.list(1).logs;assert.equal(logs.length,1);assert.equal(logs[0].kind,"automatic");
  assert.equal(logs[0].periods,3);assert.equal(logs[0].amount,60);assert.equal(logs[0].newEndDate,"2027-01-01");
  service.execute(1,{action:"delete",id:original.id,version:1});assert.equal(history.list(1).total,1);
});

test("a ledger insert failure rolls back the subscription and legacy audit in the same transaction",t=>{
  const {db,service}=setup();t.after(()=>db.close());
  const original=service.execute(1,{action:"create",item:item({startDate:"2026-09-01",endDate:"2026-10-01",autoRenew:true})}).item!;
  db.exec("CREATE TRIGGER fail_log BEFORE INSERT ON subscription_renewal_logs BEGIN SELECT RAISE(ABORT,'test failure'); END");
  assert.throws(()=>service.execute(1,{action:"renew",id:original.id,version:0}));
  assert.throws(()=>service.advanceAutomaticRenewals(new Date("2026-10-01T00:00:00Z")));
  assert.equal(service.list(1).items[0].version,0);assert.equal(service.list(1).items[0].endDate,original.endDate);
  assert.equal(db.prepare("SELECT count(*) AS count FROM automatic_renewal_events").get()?.count,0);
});

test("JSON round-trip preserves notes, anchors and history, isolates owners and invalidates stale versions/undo",t=>{
  const {db,service,backups,history}=setup();t.after(()=>db.close());
  const original=service.execute(1,{action:"create",item:item({startDate:"2027-01-31",endDate:"2027-02-28"})}).item!;
  const renewed=service.execute(1,{action:"renew",id:original.id,version:0});
  service.execute(2,{action:"create",item:item({name:"Other owner"})});
  const backup=backups.export(1), preview=backups.preview(1,backup);
  assert.equal(backup.subscriptions[0].renewalAnchorDate,"2027-01-31");
  assert.ok(!JSON.stringify(backup).includes("preserved-hash"));
  assert.throws(()=>backups.import(1,{backup,mode:"replace",expectedRevision:preview.revision}),{code:"CONFIRM_REQUIRED"});
  const result=backups.import(1,{backup,mode:"replace",confirmReplace:true,expectedRevision:preview.revision});
  assert.equal(result.importedSubscriptions,1);assert.equal(result.importedLogs,1);
  assert.equal(service.list(1).items[0].note,"private");assert.equal(service.list(2).items[0].name,"Other owner");
  assert.equal(history.list(1).logs[0].id,renewed.renewal!.id);
  assert.throws(()=>service.execute(1,{action:"undoRenew",id:original.id,version:service.list(1).items[0].version,logId:renewed.renewal!.id}),{code:"UNDO_UNAVAILABLE"});
  assert.throws(()=>service.execute(1,{action:"delete",id:original.id,version:renewed.item!.version}),{status:409});
  assert.equal(db.prepare("SELECT password_hash FROM users WHERE id=1").get()?.password_hash,"preserved-hash");
});

test("merge is idempotent; malformed/duplicate data and stale previews cannot partially overwrite records",t=>{
  const {db,service,backups}=setup();t.after(()=>db.close());
  const original=service.execute(1,{action:"create",item:item()}).item!;
  const backup=backups.export(1);
  backup.subscriptions.push({...backup.subscriptions[0],id:randomUUID(),name:"Imported"});
  const preview=backups.preview(1,backup);assert.equal(preview.newSubscriptions,1);assert.equal(preview.skippedSubscriptions,1);
  service.execute(1,{action:"update",id:original.id,version:0,item:{...original,name:"Edited"}});
  assert.throws(()=>backups.import(1,{backup,mode:"merge",expectedRevision:preview.revision}),{status:409});
  assert.equal(service.list(1).items.length,1);
  const current=backups.preview(1,backup);
  const result=backups.import(1,{backup,mode:"merge",expectedRevision:current.revision});
  assert.equal(result.importedSubscriptions,1);assert.equal(service.list(1).items.find(i=>i.id===original.id)?.name,"Edited");
  assert.equal(backups.import(1,{backup,mode:"merge",expectedRevision:backups.preview(1,backup).revision}).importedSubscriptions,0);
  assert.throws(()=>backups.preview(1,{...backup,subscriptions:[backup.subscriptions[0],backup.subscriptions[0]]}));
  assert.throws(()=>backups.preview(1,{...backup,application:"another-app"}));
  assert.throws(()=>backups.preview(1,{...backup,users:[{password:"not allowed"}]}));
  const broken=structuredClone(backup);broken.subscriptions[1].endDate="2026-02-30";
  assert.throws(()=>backups.import(1,{backup:broken,mode:"replace",confirmReplace:true,expectedRevision:backups.preview(1,backup).revision}));
  assert.equal(service.list(1).items.length,2);
});

test("restore rejects future or off-cycle anchors before mutation and exports irregular periods safely",t=>{
  const {db,service,backups}=setup();t.after(()=>db.close());
  service.execute(1,{action:"create",item:item({startDate:"2026-01-01",endDate:"2026-02-15",autoRenew:true})});
  db.exec("UPDATE subscriptions SET renewal_anchor_date=''");
  const backup=backups.export(1);
  assert.equal(backup.subscriptions[0].renewalAnchorDate,"2026-02-15");
  const revision=backups.preview(1,backup).revision;
  for(const anchor of ["2027-01-01","2026-01-02"]){
    const broken=structuredClone(backup);broken.subscriptions[0].renewalAnchorDate=anchor;
    assert.throws(()=>backups.import(1,{backup:broken,mode:"replace",confirmReplace:true,expectedRevision:revision}));
    assert.equal(service.list(1).items.length,1);
  }
  backups.import(1,{backup,mode:"replace",confirmReplace:true,expectedRevision:revision});
  assert.equal(service.advanceAutomaticRenewals(new Date("2026-10-01T00:00:00Z")),1);
  assert.equal(service.list(1).items[0].endDate,"2026-10-15");
});

test("deleting then recreating a UUID cannot revive an old undo receipt",t=>{
  const {db,service}=setup();t.after(()=>db.close());
  const original=service.execute(1,{action:"create",item:item()}).item!;
  const result=service.execute(1,{action:"renew",id:original.id,version:0});
  service.execute(1,{action:"delete",id:original.id,version:1});
  const recreated=service.execute(1,{action:"create",item:result.item}).item!;
  service.execute(1,{action:"update",id:recreated.id,version:0,item:recreated});
  assert.throws(()=>service.execute(1,{action:"undoRenew",id:original.id,version:1,logId:result.renewal!.id}),{code:"UNDO_UNAVAILABLE"});
});
