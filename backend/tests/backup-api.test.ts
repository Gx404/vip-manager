import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.ts";
import { openDatabase } from "../src/database.ts";
import { createApp } from "../src/app.ts";
import { AuthService, bootstrapAdmin } from "../src/auth.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import type { BackupDocument, ImportPreview, RenewalResult, HistoryPage } from "../../shared/renewals.ts";

test("private history and JSON API validate auth, large imports, optimistic revisions and undo end to end",async t=>{
  const config=readConfig({PUBLIC_ORIGIN:"http://frontend.test",COOKIE_SECURE:"false",PUBLIC_DASHBOARD:"true",ADMIN_PASSWORD:randomUUID()});
  const db=openDatabase(":memory:");await bootstrapAdmin(db,config);
  const server=createApp(db,config).listen(0,"127.0.0.1");
  t.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();});
  await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const url=`http://127.0.0.1:${address.port}/api`;
  const session=await new AuthService(db,config).login("admin",config.adminPassword!,"198.51.100.8");
  const headers={Cookie:`membership_session=${session.token}`,Origin:config.publicOrigin,"Content-Type":"application/json","X-Requested-With":"membership-dashboard"};
  const post=(path:string,body:unknown)=>fetch(url+path,{method:"POST",headers,body:JSON.stringify(body)});
  for(const path of ["/backup","/subscriptions/history"])assert.equal((await fetch(url+path)).status,401);
  for(const path of ["/backup/preview","/backup/import"]){
    assert.equal((await fetch(url+path,{method:"POST",headers:{...headers,Cookie:""},body:JSON.stringify({data:"x".repeat(40_000)})})).status,401);
    assert.equal((await fetch(url+path,{method:"POST",headers:{...headers,"X-Requested-With":""},body:"{}"})).status,403);
  }
  const service=new SubscriptionService(db,config.timeZone);
  const item=service.execute(1,{action:"create",item:{id:randomUUID(),name:"Private",plan:"",category:"AI 工具",amount:10,cycle:"monthly",customDays:30,startDate:"2198-01-31",endDate:"2198-02-28",reminderDays:7,autoRenew:false,note:"private",color:"#269979",version:0}}).item!;
  const renewed=await (await post("/subscriptions",{action:"renew",id:item.id,version:0,requestId:randomUUID()})).json() as RenewalResult;
  assert.ok(renewed.renewal.id);assert.ok(renewed.undoUntil);
  assert.equal((await post("/subscriptions",{action:"undoRenew",id:item.id,version:1,logId:renewed.renewal.id})).status,200);
  const history=await (await fetch(url+`/subscriptions/history?subscriptionId=${item.id}&limit=1&offset=0`,{headers})).json() as HistoryPage;
  assert.equal(history.total,1);assert.ok(history.logs[0].undoneAt);
  assert.equal((await fetch(url+"/subscriptions/history?limit=1000",{headers})).status,400);
  const exported=await fetch(url+"/backup",{headers});assert.match(exported.headers.get("content-disposition")!,/attachment/);
  const backup=await exported.json() as BackupDocument;
  for(let index=0;index<70;index++)backup.subscriptions.push({...backup.subscriptions[0],id:randomUUID(),note:"x".repeat(500)});
  assert.ok(JSON.stringify(backup).length>20_000);
  const response=await post("/backup/preview",{backup});assert.equal(response.status,200);
  const preview=await response.json() as ImportPreview;
  assert.equal(preview.newSubscriptions,70);
  assert.equal((await post("/backup/import",{backup,mode:"merge"})).status,400);
  assert.equal((await post("/backup/import",{backup,mode:"merge",expectedRevision:preview.revision})).status,200);
  assert.equal(service.list(1).items.length,71);
  assert.equal((await post("/backup/import",{backup,mode:"replace",confirmReplace:true,expectedRevision:preview.revision})).status,409);
});
