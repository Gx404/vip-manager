import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { RenewalHistory } from "../src/renewal-history.ts";
import { BackupService } from "../src/backups.ts";
import { createApp } from "../src/app.ts";
import { readConfig } from "../src/config.ts";
import { AuthService, bootstrapAdmin } from "../src/auth.ts";
import type { Subscription } from "../../shared/subscriptions.ts";
import type { RenewalResult } from "../../shared/renewals.ts";

const item = (changes: Partial<Subscription> = {}): Subscription => ({
  id: randomUUID(), name: "History test", plan: "", category: "AI 工具", amount: 19.99,
  cycle: "monthly", customDays: 30, startDate: "2198-01-31", endDate: "2198-02-28",
  reminderDays: 7, autoRenew: false, note: "private", color: "#269979", version: 0, ...changes,
});

test("active manual and automatic history stays protected even after the subscription is deleted", t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.exec("INSERT INTO users VALUES(1,'owner','test-hash',0)");
  const service = new SubscriptionService(db,"Asia/Shanghai");
  const history = new RenewalHistory(db);
  const manual = service.execute(1,{ action:"create", item:item() }).item!;
  const renewed = service.execute(1,{ action:"renew", id:manual.id, version:0 });
  const automatic = service.execute(1,{ action:"create", item:item({ startDate:"2026-09-01", endDate:"2026-10-01", autoRenew:true }) }).item!;
  service.advanceAutomaticRenewals(new Date("2026-10-01T00:00:00Z"));
  const before = history.list(1);
  assert.deepEqual(before.logs.map(log => log.kind).sort(),["automatic","manual"]);
  for (const log of before.logs) assert.throws(() => history.deleteUndone(1,log.id),{ status:409, code:"RENEWAL_NOT_UNDONE" });
  assert.deepEqual(history.list(1),before);
  assert.equal(service.list(1).items.find(record => record.id === manual.id)?.endDate,renewed.item!.endDate);
  service.execute(1,{ action:"delete", id:manual.id, version:renewed.item!.version });
  service.execute(1,{ action:"delete", id:automatic.id, version:1 });
  for (const log of before.logs) assert.throws(() => history.deleteUndone(1,log.id),{ status:409, code:"RENEWAL_NOT_UNDONE" });
  assert.deepEqual(history.list(1),before);
});

test("deleting undone history is owner-scoped, preserves membership and invalidates stale backup previews", t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.exec("INSERT INTO users VALUES(1,'owner','test-hash',0),(2,'other','other-test-hash',0)");
  const service = new SubscriptionService(db,"Asia/Shanghai");
  const history = new RenewalHistory(db), backups = new BackupService(db);
  const original = service.execute(1,{ action:"create", item:item() }).item!;
  const command = { action:"renew", id:original.id, version:0, requestId:randomUUID() };
  const renewed = service.execute(1,command);
  service.execute(1,{ action:"undoRenew", id:original.id, version:1, logId:renewed.renewal!.id });
  const other = service.execute(2,{ action:"create", item:item() }).item!;
  service.execute(2,{ action:"renew", id:other.id, version:0 });
  const subscriptions = service.list(1), otherHistory = history.list(2);
  const backup = backups.export(1), preview = backups.preview(1,backup);
  assert.throws(() => history.deleteUndone(2,renewed.renewal!.id),{ status:404 });
  assert.equal(history.list(1).total,1);
  assert.deepEqual(history.deleteUndone(1,renewed.renewal!.id),{ id:renewed.renewal!.id });
  assert.deepEqual(history.list(1,original.id),{ logs:[], total:0 });
  assert.deepEqual(service.list(1),subscriptions);
  assert.deepEqual(history.list(2),otherHistory);
  assert.equal(backups.export(1).renewalLogs.length,0);
  assert.throws(() => backups.import(1,{ backup, mode:"replace", confirmReplace:true, expectedRevision:preview.revision }),{ status:409 });
  assert.throws(() => service.execute(1,command),{ status:409 });
  assert.throws(() => history.deleteUndone(1,renewed.renewal!.id),{ status:404 });
});

test("history deletion API requires authentication, CSRF and a valid ID, and accepts only undone entries", async t => {
  const config = readConfig({ PUBLIC_ORIGIN:"http://frontend.test", COOKIE_SECURE:"false", PUBLIC_DASHBOARD:"true", ADMIN_PASSWORD:randomUUID() });
  const db = openDatabase(":memory:"); await bootstrapAdmin(db,config);
  const server = createApp(db,config).listen(0,"127.0.0.1");
  t.after(async () => { await new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())); db.close(); });
  await new Promise<void>((resolve,reject) => { server.once("listening",resolve); server.once("error",reject); });
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const session = await new AuthService(db,config).login("admin",config.adminPassword!,"198.51.100.8");
  const headers = { Cookie:`membership_session=${session.token}`, Origin:config.publicOrigin, "Content-Type":"application/json", "X-Requested-With":"membership-dashboard" };
  const post = (path: string, body: unknown, overrides = {}) => fetch(base + path,{ method:"POST", headers:{ ...headers, ...overrides }, body:JSON.stringify(body) });
  const service = new SubscriptionService(db,config.timeZone), history = new RenewalHistory(db);
  const original = service.execute(1,{ action:"create", item:item() }).item!;
  const renewed = service.execute(1,{ action:"renew", id:original.id, version:0 });
  const path = "/subscriptions/history/delete", body = { id:renewed.renewal!.id };
  assert.equal((await post(path,body,{ Cookie:"" })).status,401);
  assert.equal((await post(path,body,{ "X-Requested-With":"" })).status,403);
  assert.equal((await post(path,body,{ Origin:"http://untrusted.test" })).status,403);
  assert.equal((await post(path,{ id:"invalid" })).status,400);
  assert.equal((await post(path,{ ...body, undoneAt:new Date().toISOString() })).status,400);
  const active = await post(path,body);
  assert.equal(active.status,409); assert.equal((await active.json() as { code:string }).code,"RENEWAL_NOT_UNDONE");
  assert.equal(history.list(1).total,1);
  const undo = await post("/subscriptions",{ action:"undoRenew", id:original.id, version:1, logId:body.id });
  assert.equal(undo.status,200);
  const restored = await undo.json() as RenewalResult;
  const deleted = await post(path,body);
  assert.equal(deleted.status,200); assert.deepEqual(await deleted.json(),body);
  assert.deepEqual(service.list(1).items,[restored.item]);
  assert.equal(history.list(1).total,0);
  assert.equal((await post(path,body)).status,404);
});
