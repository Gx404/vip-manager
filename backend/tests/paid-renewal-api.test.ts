import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.ts";
import { openDatabase } from "../src/database.ts";
import { bootstrapAdmin } from "../src/auth.ts";
import { createApp } from "../src/app.ts";
import { ExchangeRates } from "../src/exchange-rates.ts";
import { dateInTimeZone } from "../../shared/billing.ts";
import type { RenewalLog } from "../../shared/renewals.ts";
import type { Subscription } from "../../shared/subscriptions.ts";

test("续费 API 先返回已支付待汇率记录；日期更正 API 等待付款日汇率重算后返回完整记录", async () => {
  const config=readConfig({PUBLIC_ORIGIN:"http://frontend.test",COOKIE_SECURE:"false",ADMIN_USERNAME:"owner",ADMIN_PASSWORD:"test-only-password",APP_TIMEZONE:"Asia/Shanghai"});
  const db=openDatabase(":memory:");
  await bootstrapAdmin(db,config);
  let release!:()=>void;
  const blocked=new Promise<void>(resolve=>{release=resolve;});
  let completed!:()=>void;
  const rateCompleted=new Promise<void>(resolve=>{completed=resolve;});
  let calls=0;
  const rates=new ExchangeRates(async input=>{
    const parsed=new URL(String(input)); calls++;
    if(calls===1) await blocked;
    const date=parsed.searchParams.get("date")!;
    const response=new Response(JSON.stringify({date,base:"USD",quote:"CNY",rate:date==="2026-10-16"?6.9:7.1}),{status:200});
    completed(); return response;
  });
  const server=createApp(db,config,undefined,rates).listen(0,"127.0.0.1");
  await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  const address=server.address(); assert.ok(address&&typeof address!=="string");
  const url="http://127.0.0.1:"+address.port;
  const baseHeaders={"Content-Type":"application/json","X-Requested-With":"membership-dashboard",Origin:config.publicOrigin};
  let cookie="";
  const post=(path:string,body:unknown)=>fetch(url+path,{method:"POST",headers:{...baseHeaders,...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  try {
    const login=await post("/api/auth/login",{username:"owner",password:"test-only-password"});
    assert.equal(login.status,200); cookie=login.headers.get("set-cookie")!.split(";")[0];
    const create=await post("/api/subscriptions",{action:"create",item:{
      id:randomUUID(),name:"DMIT",plan:"Pro",category:"云服务与网络",amount:10.9,currency:"USD",cycle:"monthly",customDays:30,
      startDate:"2026-09-24",endDate:"2026-10-24",reminderDays:7,autoRenew:false,note:"",color:"#269979",version:0,
      purchaseDate:"2026-09-23",fxRateToCny:7,fxRateDate:"2026-09-23",fxRateSource:"manual",
    }});
    assert.equal(create.status,201);
    const item=(await create.json() as {item:Subscription}).item;
    const request={action:"renew",id:item.id,version:item.version,requestId:randomUUID()};
    const response=await post("/api/subscriptions",request);
    assert.equal(response.status,200);
    const renewed=await response.json() as {item:Subscription;renewal:RenewalLog;undoUntil:string};
    assert.equal(renewed.renewal.payment?.paidOn,dateInTimeZone(new Date(),config.timeZone));
    assert.equal(renewed.renewal.payment?.rate,null);
    assert.ok(renewed.undoUntil);
    const retry=await post("/api/subscriptions",request);
    assert.equal(retry.status,200);
    assert.equal((await retry.json() as {renewal:RenewalLog}).renewal.id,renewed.renewal.id);
    release(); await rateCompleted;
    // Correction is awaited by the API even while the first background snapshot finishes.
    const corrected=await post("/api/payments/date",{id:renewed.renewal.id,paidOn:"2026-10-16",expectedPaidOn:renewed.renewal.payment!.paidOn});
    assert.equal(corrected.status,200);
    const result=await corrected.json() as {log:RenewalLog};
    assert.equal(result.log.payment?.paidOn,"2026-10-16");
    assert.equal(result.log.payment?.rateDate,"2026-10-16");
    assert.equal(result.log.payment?.rate,6.9);
  } finally {
    release();
    await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
    db.close();
  }
});
