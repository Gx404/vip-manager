import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { readConfig } from "../src/config.ts";
import { openDatabase } from "../src/database.ts";
import { bootstrapAdmin, AuthService } from "../src/auth.ts";
import { createApp } from "../src/app.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { renewDate, type Subscription } from "../../shared/subscriptions.ts";
import { sampleSubscriptions } from "./fixtures.ts";

let directory:string,db:DatabaseSync,server:Server,url:string,cookie:string;
const password="test-only-not-a-production-password";
const config=readConfig({PUBLIC_ORIGIN:"http://frontend.test",COOKIE_SECURE:"false",ADMIN_USERNAME:"testadmin",ADMIN_PASSWORD:password});
const headers={"Content-Type":"application/json","X-Requested-With":"membership-dashboard",Origin:config.publicOrigin};
before(async()=>{
  directory=await mkdtemp(join(tmpdir(),"memberships-test-"));
  db=openDatabase(join(directory,"test.sqlite"));
  await bootstrapAdmin(db,config);
  server=createApp(db,config).listen(0,"127.0.0.1");
  await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  const address=server.address();
  assert.ok(address&&typeof address!=="string");
  url="http://127.0.0.1:"+address.port;
});
after(async()=>{
  if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  db?.close();
  if(directory)await rm(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100});
});
const post=(path:string,body:unknown,extra:Record<string,string>={})=>fetch(url+path,{method:"POST",headers:{...headers,...(cookie?{Cookie:cookie}:{}),...extra},body:JSON.stringify(body)});

test("API 独立运行，拒绝未登录和伪造的旧平台身份",async()=>{
  assert.equal((await fetch(url+"/api/health")).status,200);
  assert.equal((await fetch(url+"/api/subscriptions")).status,401);
  assert.equal((await fetch(url+"/api/subscriptions",{headers:{"oai-authenticated-user-id":"owner","oai-authenticated-user-email":"owner@example.com"}})).status,401);
});

test("跨来源请求、缺少防跨站头和非法 JSON 被拒绝",async()=>{
  assert.equal((await post("/api/auth/login",{username:"testadmin",password},{Origin:"https://evil.test"})).status,403);
  assert.equal((await fetch(url+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).status,403);
  assert.equal((await fetch(url+"/api/auth/login",{method:"POST",headers,body:"{broken"})).status,400);
  assert.equal((await fetch(url+"/api/auth/login",{method:"POST",headers,body:JSON.stringify({password:"x".repeat(30_000)})})).status,413);
});

test("管理员登录使用 HttpOnly 会话，不回传密码或 token",async()=>{
  assert.equal((await post("/api/auth/login",{username:"testadmin",password:"wrong"})).status,401);
  const response=await post("/api/auth/login",{username:"testadmin",password});
  assert.equal(response.status,200);
  const setCookie=response.headers.get("set-cookie")!;
  assert.match(setCookie,/HttpOnly/);
  assert.match(setCookie,/SameSite=Lax/);
  cookie=setCookie.split(";")[0];
  const body=await response.json() as Record<string,unknown>;
  assert.equal("token" in body,false);
  assert.equal((await fetch(url+"/api/auth/session",{headers:{Cookie:cookie}})).status,200);
  assert.match(String(db.prepare("SELECT password_hash FROM users LIMIT 1").get()?.password_hash),/^scrypt:/);
  assert.notEqual(db.prepare("SELECT token_hash FROM sessions LIMIT 1").get()?.token_hash,cookie.split("=")[1]);
});

test("增删改、版本冲突、服务端续费、非法日期及持久化",async()=>{
  const item={...sampleSubscriptions("2026-09-29")[0],id:randomUUID(),startDate:"2198-12-31",endDate:"2199-01-31",cycle:"monthly"};
  const original=await fetch(url+"/api/subscriptions",{headers:{Cookie:cookie}});
  assert.deepEqual(await original.json(),{items:[],initialized:false});
  let response=await post("/api/subscriptions",{action:"create",item});
  assert.equal(response.status,201);
  let saved=(await response.json() as {item:Subscription}).item;
  assert.equal(saved.amount,item.amount);
  response=await post("/api/subscriptions",{action:"update",id:saved.id,version:0,item:{...saved,note:"已修改"}});
  assert.equal(response.status,200);
  saved=(await response.json() as {item:Subscription}).item;
  assert.equal(saved.version,1);
  assert.equal((await post("/api/subscriptions",{action:"delete",id:saved.id,version:0})).status,409);
  assert.equal((await post("/api/subscriptions",{action:"create",item:{...item,id:randomUUID(),endDate:"2199-02-30"}})).status,400);
  assert.equal((await post("/api/subscriptions",{action:"create",item:{...item,id:randomUUID(),amount:-1}})).status,400);
  response=await post("/api/subscriptions",{action:"renew",id:saved.id,version:saved.version,item:{...saved,endDate:"2200-01-01"}});
  assert.equal(response.status,200);
  saved=(await response.json() as {item:Subscription}).item;
  assert.equal(saved.endDate,"2199-02-28"); // Client-supplied renewal dates are ignored.
  const secondConnection=openDatabase(join(directory,"test.sqlite"));
  assert.equal(new SubscriptionService(secondConnection,config.timeZone).list(1).items[0].note,"已修改");
  assert.equal(new SubscriptionService(secondConnection,config.timeZone).list(2).items.length,0);
  secondConnection.close();
  assert.equal((await post("/api/subscriptions",{action:"delete",id:saved.id,version:saved.version})).status,200);
  const empty=await fetch(url+"/api/subscriptions",{headers:{Cookie:cookie}});
  assert.deepEqual(await empty.json(),{items:[],initialized:true});
});

test("登录限流是持久化的；退出后旧会话失效",async()=>{
  const auth=new AuthService(db,config);
  for(let n=0;n<10;n++)await assert.rejects(auth.login("testadmin","wrong","test-rate-ip"),{status:401});
  await assert.rejects(auth.login("testadmin",password,"test-rate-ip"),{status:429});
  assert.equal((await post("/api/auth/logout",{})).status,200);
  assert.equal((await fetch(url+"/api/subscriptions",{headers:{Cookie:cookie}})).status,401);
});

test("月末和闰年续费算法前后端共用",()=>{
  assert.equal(renewDate("2024-01-31","monthly",30),"2024-02-29");
  assert.equal(renewDate("2024-02-29","yearly",30),"2025-02-28");
  assert.equal(renewDate("2026-09-29","custom",5),"2026-10-04");
});

test("关闭服务并重开数据库后，会员记录和原密码仍然保留",async()=>{
  const item={...sampleSubscriptions("2026-09-29")[0],id:randomUUID()};
  new SubscriptionService(db,config.timeZone).execute(1,{action:"create",item});
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  db.close();
  db=openDatabase(join(directory,"test.sqlite"));
  await bootstrapAdmin(db,{...config,adminPassword:"changing-env-must-not-reset-password"});
  server=createApp(db,config).listen(0,"127.0.0.1");
  await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  const address=server.address();
  assert.ok(address&&typeof address!=="string");
  url="http://127.0.0.1:"+address.port;
  const response=await post("/api/auth/login",{username:"testadmin",password});
  assert.equal(response.status,200);
  cookie=response.headers.get("set-cookie")!.split(";")[0];
  const state=await (await fetch(url+"/api/subscriptions",{headers:{Cookie:cookie}})).json() as {items:Subscription[]};
  assert.equal(state.items[0].id,item.id);
});

test("备份脚本可生成完整快照；重置密码脚本撤销旧会话",async()=>{
  const backupFile=join(directory,"snapshot.sqlite");
  const env={...process.env,DATABASE_PATH:join(directory,"test.sqlite"),PUBLIC_ORIGIN:config.publicOrigin};
  await new Promise<void>((resolve,reject)=>execFile(process.execPath,["backend/scripts/backup.ts",backupFile],{env},error=>error?reject(error):resolve()));
  const restored=openDatabase(backupFile);
  assert.equal(new SubscriptionService(restored,config.timeZone).list(1).items.length,1);
  restored.close();
  const resetPassword=(value:string)=>new Promise<{code:number|null;detail:string}>((resolve,reject)=>{
    const child=spawn(process.execPath,["backend/scripts/reset-password.ts"],{env,stdio:["pipe","ignore","pipe"]});
    let detail="";
    child.stderr.on("data",chunk=>{detail+=String(chunk);});
    child.on("error",reject);
    child.on("close",code=>resolve({code,detail}));
    child.stdin.on("error",reject);
    child.stdin.end(value);
  });
  const originalHash=db.prepare("SELECT password_hash FROM users LIMIT 1").get()?.password_hash;
  for(const size of [7,257]) {
    const rejected=await resetPassword("p".repeat(size));
    assert.equal(rejected.code,1);
    assert.match(rejected.detail,/8–256/);
    assert.equal(db.prepare("SELECT password_hash FROM users LIMIT 1").get()?.password_hash,originalHash);
    assert.equal((await fetch(url+"/api/auth/session",{headers:{Cookie:cookie}})).status,200);
  }
  const changedPassword=randomUUID().slice(0,8);
  assert.equal(changedPassword.length,8);
  const changed=await resetPassword(changedPassword);
  assert.equal(changed.code,0,changed.detail);
  assert.equal((await fetch(url+"/api/auth/session",{headers:{Cookie:cookie}})).status,401);
  assert.equal((await post("/api/auth/login",{username:"testadmin",password})).status,401);
  assert.equal((await post("/api/auth/login",{username:"testadmin",password:changedPassword})).status,200);
});
