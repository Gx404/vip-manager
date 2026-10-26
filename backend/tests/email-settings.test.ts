import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import fs, { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readConfig } from "../src/config.ts";
import { openDatabase } from "../src/database.ts";
import { EmailSettingsService } from "../src/email-settings-service.ts";
import { EmailNotificationService } from "../src/notifications.ts";
import { SmtpMailer, type MailMessage } from "../src/email.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { startNotificationScheduler } from "../src/renewal-scheduler.ts";
import { AuthService, bootstrapAdmin } from "../src/auth.ts";
import { createApp } from "../src/app.ts";
import type { EmailSettingsView } from "../../shared/notifications.ts";

const secret="smtp-only-secret-123";
const saved={EMAIL_NOTIFICATIONS:"false",SMTP_HOST:"smtp.qq.com",SMTP_PORT:"465",SMTP_SECURE:"true",SMTP_USER:"owner@qq.com",SMTP_PASSWORD:secret,
  EMAIL_FROM:"owner@qq.com",EMAIL_TO:"owner@qq.com",EMAIL_REMINDER_HOUR:"9",EMAIL_REMINDER_MINUTE:"0"};
function fixture(overrides: NodeJS.ProcessEnv={}) {
  const folder=mkdtempSync(join(tmpdir(),"vip-email-ui-")),file=join(folder,"email-settings.json");
  writeFileSync(file,JSON.stringify(saved),{mode:0o600});
  const config=readConfig({EMAIL_CONFIG_FILE:file,...overrides});
  const db=openDatabase(":memory:");db.exec("INSERT INTO users VALUES(1,'owner','test',0),(2,'other','test',0)");
  const settings=new EmailSettingsService(db,config);
  const close=()=>{db.close();rmSync(folder,{recursive:true,force:true,maxRetries:3,retryDelay:100});};
  return {folder,file,config,db,settings,close};
}
function input(view: EmailSettingsView,changes={}) {
  const {passwordConfigured:_passwordConfigured,timeZone:_timeZone,revision,editable:_editable,lockedFields:_lockedFields,...settings}=view;
  return {revision,settings:{...settings,...changes}};
}

test("网页邮件配置保存后立即生效并持久化，授权码不回传且留空保留",t=>{
  const {file,config,settings,close}=fixture();t.after(close);
  const before=settings.get(1);assert.equal(before.editable,true);assert.equal(before.passwordConfigured,true);
  assert.ok(!JSON.stringify(before).includes(secret));assert.deepEqual(before.lockedFields,[]);
  const after=settings.save(1,input(before,{enabled:true,reminderHour:10,reminderMinute:30,password:""}));
  assert.equal(config.email.enabled,true);assert.equal(config.email.reminderHour,10);assert.equal(config.email.password,secret);
  assert.equal(after.reminderMinute,30);assert.ok(!JSON.stringify(after).includes(secret));
  const restarted=readConfig({EMAIL_CONFIG_FILE:file});
  assert.equal(restarted.email.password,secret);assert.equal(restarted.email.reminderMinute,30);assert.equal(restarted.email.enabled,true);
  if(process.platform!=="win32") assert.equal(statSync(file).mode&0o077,0);
  assert.equal(existsSync(file+".previous"),false,"saving must not retain a local copy of the previous SMTP credential");
  assert.throws(()=>settings.save(1,input(before,{reminderHour:11})),{status:409,code:"VERSION_CONFLICT"});
});

test("首次网页配置可新建私有文件，不启用邮件时也可先保存配置",t=>{
  const f=fixture();t.after(f.close);
  const file=join(f.folder,"new-settings.json"),config=readConfig({EMAIL_CONFIG_FILE:file});
  const settings=new EmailSettingsService(f.db,config),before=settings.get(1);
  assert.equal(before.enabled,false);assert.equal(before.passwordConfigured,false);assert.equal(before.username,"");
  assert.throws(()=>settings.save(1,input(before,{enabled:true})),{status:400,code:"EMAIL_PASSWORD_REQUIRED"});
  const after=settings.save(1,input(before,{username:"new@qq.com",password:"new-smtp-secret"}));
  assert.equal(after.enabled,false);assert.equal(after.from,"new@qq.com");assert.equal(after.to,"new@qq.com");
  assert.equal(readConfig({EMAIL_CONFIG_FILE:file}).email.password,"new-smtp-secret");
});

test("更换 SMTP 目的地必须填写新授权码，显式服务器环境值保持锁定",t=>{
  const f=fixture();t.after(f.close);
  assert.throws(()=>f.settings.save(1,input(f.settings.get(1),{host:"smtp.example.com"})),{status:400,code:"EMAIL_PASSWORD_REQUIRED"});
  const after=f.settings.save(1,input(f.settings.get(1),{host:"smtp.example.com",username:"second@example.com",from:"second@example.com",to:"second@example.com",password:"new-smtp-secret"}));
  assert.equal(after.host,"smtp.example.com");assert.equal(f.config.email.password,"new-smtp-secret");
  assert.ok(!JSON.stringify(after).includes("new-smtp-secret"));
  const locked=fixture({EMAIL_REMINDER_HOUR:"8",SMTP_PASSWORD:"server-only-secret"});t.after(locked.close);
  assert.ok(locked.settings.get(1).lockedFields.includes("reminderHour"));
  assert.ok(locked.settings.get(1).lockedFields.includes("password"));
  assert.ok(locked.settings.get(1).lockedFields.includes("host"));
  assert.throws(()=>locked.settings.save(1,input(locked.settings.get(1),{reminderHour:10})),{status:409,code:"EMAIL_SETTINGS_LOCKED"});
  locked.settings.save(1,input(locked.settings.get(1),{reminderMinute:25}));
  assert.equal(readConfig({EMAIL_CONFIG_FILE:locked.file,EMAIL_REMINDER_HOUR:"8",SMTP_PASSWORD:"server-only-secret"}).email.reminderMinute,25);
});

test("邮件设置拒绝非主管理员、非法内容、并发磁盘变化，写入失败不影响运行配置",t=>{
  const f=fixture();t.after(f.close);
  assert.throws(()=>f.settings.get(2),{status:403});
  assert.throws(()=>f.settings.save(2,input(f.settings.get(1))),{status:403});
  for(const changes of [{to:"owner@qq.com\r\nBcc:bad@example.com"},{port:0},{reminderHour:24},{host:"host/path"},{password:secret.repeat(100)}]) {
    assert.throws(()=>f.settings.save(1,input(f.settings.get(1),changes)),error=>error instanceof Error&&!error.message.includes(secret));
  }
  const view=f.settings.get(1);
  writeFileSync(f.file,JSON.stringify({...saved,EMAIL_REMINDER_MINUTE:"7"}));
  assert.throws(()=>f.settings.save(1,input(view)),{status:409,code:"VERSION_CONFLICT"});
  const runtime={...f.config.email},disk=readFileSync(f.file,"utf8");
  const rename=fs.renameSync;
  try {
    fs.renameSync=()=>{throw new Error("fixture replace failure");};syncBuiltinESMExports();
    assert.throws(()=>f.settings.save(1,input(f.settings.get(1),{reminderMinute:35})),{status:503,code:"EMAIL_SETTINGS_WRITE_FAILED"});
  } finally {fs.renameSync=rename;syncBuiltinESMExports();}
  assert.deepEqual(f.config.email,runtime);assert.equal(readFileSync(f.file,"utf8"),disk);
  assert.ok(!readdirSync(f.folder).some(name=>name.endsWith(".tmp")));
  assert.equal(existsSync(f.file+".previous"),false);
});

test("已有 SMTP 发送使用旧连接快照，保存后后续发送使用新配置且不自动发送测试信",async t=>{
  const f=fixture();t.after(f.close);
  let finish!:()=>void;
  const transports:Array<{user:string;password:string;to:string}>=[];
  const mailer=new SmtpMailer(f.config.email,options=>({sendMail:async message=>{
    transports.push({user:String(options.auth?.user),password:String(options.auth?.pass),to:message.to});
    if(transports.length===1)await new Promise<void>(resolve=>{finish=resolve;});
    return {accepted:[message.to],rejected:[]};
  },close:()=>undefined}));
  const notifications=new EmailNotificationService(f.db,f.config,mailer,()=>new Date("2026-10-21T04:00:00Z"));
  const pending=notifications.sendTest(1);
  const after=f.settings.save(1,input(f.settings.get(1),{username:"second@example.com",from:"second@example.com",to:"second@example.com",password:"new-smtp-secret"}));
  assert.equal(transports.length,1);assert.equal(after.username,"second@example.com");
  finish();await pending;
  assert.deepEqual(transports[0],{user:"owner@qq.com",password:secret,to:"owner@qq.com"});
  const second=new EmailNotificationService(f.db,f.config,mailer,()=>new Date("2026-10-21T04:01:01Z"));
  await second.sendTest(1);
  assert.deepEqual(transports[1],{user:"second@example.com",password:"new-smtp-secret",to:"second@example.com"});
  assert.equal(second.status(1).recent[0].status,"sent");
});

test("自动提醒从暂停状态在网页启用后无需重启，同一期的发送去重仍保留",async t=>{
  const f=fixture();t.after(f.close);
  const messages:MailMessage[]=[];
  new SubscriptionService(f.db,f.config.timeZone).execute(1,{action:"create",item:{id:randomUUID(),name:"Gemini",plan:"Pro",category:"AI 工具",amount:38,currency:"CNY",cycle:"monthly",customDays:30,startDate:"2026-10-01",endDate:"2026-11-01",reminderDays:7,autoRenew:false,note:"",color:"#269979",version:0}});
  const notifications=new EmailNotificationService(f.db,f.config,{send:async message=>{messages.push(message);}});
  t.mock.timers.enable({apis:["setInterval"]});
  const stop=startNotificationScheduler(notifications,{intervalMs:1,now:()=>new Date("2026-10-28T04:00:00Z")});t.after(stop);
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(messages.length,0);
  f.settings.save(1,input(f.settings.get(1),{enabled:true}));
  t.mock.timers.tick(1);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(messages.length,1);
  f.settings.save(1,input(f.settings.get(1),{reminderMinute:1}));
  t.mock.timers.tick(1);await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(messages.length,1);
  await stop();
});

test("邮件配置 HTTP 接口要求登录与 CSRF，响应和错误从不包含授权码",async t=>{
  const folder=mkdtempSync(join(tmpdir(),"vip-email-api-")),file=join(folder,"settings.json");
  writeFileSync(file,JSON.stringify(saved),{mode:0o600});
  const config=readConfig({PUBLIC_ORIGIN:"http://frontend.test",COOKIE_SECURE:"false",ADMIN_PASSWORD:randomUUID(),EMAIL_CONFIG_FILE:file});
  const db=openDatabase(":memory:");await bootstrapAdmin(db,config);
  const server=createApp(db,config).listen(0,"127.0.0.1");
  t.after(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));db.close();rmSync(folder,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
  await new Promise<void>((resolve,reject)=>{server.once("listening",resolve);server.once("error",reject);});
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const url=`http://127.0.0.1:${address.port}/api/notifications/settings`;
  assert.equal((await fetch(url)).status,401);
  const login=await new AuthService(db,config).login("admin",config.adminPassword!,"198.51.100.8");
  const headers={Cookie:`membership_session=${login.token}`,Origin:config.publicOrigin,"X-Requested-With":"membership-dashboard","Content-Type":"application/json"};
  const response=await fetch(url,{headers});assert.equal(response.status,200);
  const view=await response.json() as EmailSettingsView;assert.ok(!JSON.stringify(view).includes(secret));
  const body=JSON.stringify(input(view,{reminderHour:10}));
  assert.equal((await fetch(url,{method:"POST",headers:{...headers,"X-Requested-With":""},body})).status,403);
  assert.equal((await fetch(url,{method:"POST",headers:{...headers,Origin:"http://untrusted.test"},body})).status,403);
  const savedResponse=await fetch(url,{method:"POST",headers,body});assert.equal(savedResponse.status,200);
  assert.ok(!(await savedResponse.text()).includes(secret));
  const invalid=await fetch(url,{method:"POST",headers,body:JSON.stringify(input(view,{password:secret,to:secret}))});
  assert.equal(invalid.status,400);assert.ok(!(await invalid.text()).includes(secret));
});
