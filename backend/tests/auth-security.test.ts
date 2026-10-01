import assert from "node:assert/strict";
import { test } from "node:test";
import { openDatabase } from "../src/database.ts";
import { AuthService, bootstrapAdmin, loginAttemptKey } from "../src/auth.ts";
import { configurationWarnings, readConfig } from "../src/config.ts";
import { createApp } from "../src/app.ts";

const password = "test-only-long-admin-password";
const config = readConfig({ ADMIN_USERNAME: "owner", ADMIN_PASSWORD: password, PUBLIC_ORIGIN: "https://frontend.test" });

test("composite login buckets isolate usernames and client IPs and are hashed", async t => {
  const db=openDatabase(":memory:"); t.after(()=>db.close()); await bootstrapAdmin(db,config);
  const auth=new AuthService(db,config);
  for(let i=0;i<10;i++) await assert.rejects(auth.login("somebody-else","wrong","203.0.113.1"),{status:401});
  await assert.rejects(auth.login("somebody-else","wrong","203.0.113.1"),{status:429});
  assert.equal((await auth.login("owner",password,"203.0.113.1")).user.username,"owner");
  for(let i=0;i<10;i++) await assert.rejects(auth.login("owner","wrong","203.0.113.1"),{status:401});
  await assert.rejects(auth.login("owner",password,"203.0.113.1"),{status:429});
  assert.equal((await auth.login("owner",password,"203.0.113.2")).user.username,"owner");
  assert.match(String(db.prepare("SELECT key FROM login_attempts LIMIT 1").get()?.key),/^[a-f0-9]{64}$/);
  assert.equal(loginAttemptKey("::ffff:127.0.0.1","owner"),loginAttemptKey("127.0.0.1","owner"));
});

test("loopback recovers after 30 seconds, not a 15-minute lock; parallel scrypt is bounded", async t => {
  const db=openDatabase(":memory:"); t.after(()=>db.close()); await bootstrapAdmin(db,config);
  let now=Date.now(); const auth=new AuthService(db,config,()=>now);
  for(let i=0;i<10;i++) await assert.rejects(auth.login("owner","wrong","::1"),{status:401});
  await assert.rejects(auth.login("owner",password,"::1"),{status:429,retryAfterSeconds:30});
  now+=30_001;
  assert.equal((await auth.login("owner",password,"::1")).user.username,"owner");
  const pending=[auth.login("owner","wrong","203.0.113.20"),auth.login("owner","wrong","203.0.113.21")];
  await assert.rejects(auth.login("owner","wrong","203.0.113.22"),{status:429,code:"LOGIN_BUSY"});
  await Promise.all(pending.map(promise=>assert.rejects(promise,{status:401})));
  assert.equal((await auth.login("owner",password,"203.0.113.22")).user.username,"owner");
});

test("proxy CIDRs are explicit, insecure full-range trust is rejected and missing trust warns",()=>{
  assert.equal(configurationWarnings(config).length,1);
  assert.deepEqual(configurationWarnings({...config,trustProxy:true}),[]);
  assert.throws(()=>readConfig({TRUSTED_PROXY_RANGES:"0.0.0.0/0"}));
  assert.throws(()=>readConfig({TRUSTED_PROXY_RANGES:"::/0"}));
  assert.throws(()=>readConfig({TRUSTED_PROXY_RANGES:"invalid"}));
  assert.throws(()=>readConfig({TRUST_PROXY:"yes"}));
});

test("HTTP proxy chain ignores spoofed left-most addresses and ignores all forwarding when untrusted", async t => {
  for(const trustProxy of [false,true]) {
    const db=openDatabase(":memory:"); await bootstrapAdmin(db,config);
    const server=createApp(db,{...config,trustProxy}).listen(0,"127.0.0.1");
    await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
    t.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();});
    const address=server.address(); assert.ok(address&&typeof address!=="string");
    const response=await fetch(`http://127.0.0.1:${address.port}/api/auth/login`,{method:"POST",headers:{"Content-Type":"application/json","X-Requested-With":"membership-dashboard","X-Forwarded-For":"198.51.100.99, 203.0.113.7, 172.18.0.1"},body:JSON.stringify({username:"owner",password:"wrong"})});
    assert.equal(response.status,401);
    assert.ok(db.prepare("SELECT key FROM login_attempts WHERE key=?").get(loginAttemptKey(trustProxy?"203.0.113.7":"127.0.0.1","owner")));
    assert.equal(db.prepare("SELECT key FROM login_attempts WHERE key=?").get(loginAttemptKey("198.51.100.99","owner")),undefined);
  }
});
