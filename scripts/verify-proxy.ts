import assert from "node:assert/strict";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { readConfig } from "../backend/src/config.ts";
import { openDatabase } from "../backend/src/database.ts";
import { bootstrapAdmin } from "../backend/src/auth.ts";
import { createApp } from "../backend/src/app.ts";

let directory:string|undefined,db:DatabaseSync|undefined,server:Server|undefined;
try {
  directory=await mkdtemp(join(tmpdir(),"memberships-proxy-"));
  const password=randomBytes(24).toString("hex");
  const config=readConfig({PUBLIC_ORIGIN:"http://127.0.0.1:5173",COOKIE_SECURE:"false",ADMIN_USERNAME:"proxytest",ADMIN_PASSWORD:password});
  db=openDatabase(join(directory,"proxy.sqlite"));
  await bootstrapAdmin(db,config);
  server=createApp(db,config).listen(3000,"127.0.0.1");
  await new Promise<void>((resolve,reject)=>{server!.once("listening",resolve);server!.once("error",reject);});
  const base="http://127.0.0.1:5173";
  assert.equal((await fetch(base+"/api/health")).status,200);
  const login=await fetch(base+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json","X-Requested-With":"membership-dashboard",Origin:base},body:JSON.stringify({username:"proxytest",password})});
  assert.equal(login.status,200);
  const cookie=login.headers.get("set-cookie")!.split(";")[0];
  const state=await fetch(base+"/api/subscriptions",{headers:{Cookie:cookie,Origin:base}});
  assert.equal(state.status,200);
  assert.deepEqual(await state.json(),{items:[],initialized:false});
  console.log("PASS: frontend proxy -> separate backend -> SQLite login and reads.");
} catch(error) {
  console.error("Proxy verification failed:",error instanceof Error?error.message:"Unknown error");
  process.exitCode=1;
} finally {
  if(server?.listening)await new Promise<void>(resolve=>server!.close(()=>resolve()));
  try{db?.close();}catch{console.error("Test database close failed.");}
  if(directory)await rm(directory,{recursive:true,force:true});
}
