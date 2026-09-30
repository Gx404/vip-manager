import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { readConfig } from "../src/config.ts";
import { openDatabase } from "../src/database.ts";
import { bootstrapAdmin } from "../src/auth.ts";
import { createApp } from "../src/app.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { categories, type Subscription, type DashboardSnapshot } from "../../shared/subscriptions.ts";

const password = "isolated-dashboard-test-password";
const config = readConfig({ PUBLIC_ORIGIN: "http://dashboard.test", COOKIE_SECURE: "false", ADMIN_PASSWORD: password, PUBLIC_DASHBOARD: "true" });
const headers = { "Content-Type": "application/json", "X-Requested-With": "membership-dashboard", Origin: config.publicOrigin };
const fixture: Subscription = {
  id: randomUUID(), name: "88VIP", plan: "年度会员", category: "购物会员", amount: 88,
  cycle: "yearly", customDays: 30, startDate: "2024-09-15", endDate: "2025-09-15",
  reminderDays: 7, autoRenew: true, note: "private-account-do-not-publish", color: "#269979", version: 0,
};
let directory: string, db: DatabaseSync, publicServer: Server, privateServer: Server, publicUrl: string, privateUrl: string;

/** Start an isolated loopback listener and return its origin. */
async function address(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const value = server.address();
  assert.ok(value && typeof value !== "string");
  return `http://127.0.0.1:${value.port}`;
}
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "memberships-dashboard-"));
  db = openDatabase(join(directory, "dashboard.sqlite"));
  await bootstrapAdmin(db, config);
  const service = new SubscriptionService(db, config.timeZone);
  service.execute(1, { action: "create", item: fixture });
  service.execute(1, { action: "update", id: fixture.id, version: 0, item: fixture });
  db.prepare("INSERT INTO users(username,password_hash,created_at) VALUES(?,?,?)").run("other-owner", "not-a-login-hash", Date.now());
  service.execute(2, { action: "create", item: { ...fixture, id: randomUUID(), name: "other-user-private-membership" } });
  publicServer = createApp(db, config).listen(0, "127.0.0.1");
  publicUrl = await address(publicServer);
  privateServer = createApp(db, { ...config, publicDashboard: false }).listen(0, "127.0.0.1");
  privateUrl = await address(privateServer);
});
after(async () => {
  for (const server of [publicServer, privateServer]) {
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
  db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("公开看板只返回管理员真实记录，隐藏备注、真实版本和其他用户数据", async () => {
  const response = await fetch(publicUrl + "/api/dashboard");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  const raw = await response.text();
  assert.ok(!raw.includes(fixture.note));
  assert.ok(!raw.includes("other-user-private-membership"));
  const state = JSON.parse(raw);
  assert.equal(state.canManage, false);
  assert.equal(state.publicDashboard, true);
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].name, "88VIP");
  assert.equal(state.items[0].note, "");
  assert.equal(state.items[0].version, 0);
  assert.equal(state.items[0].endDate, fixture.endDate); // Reads never perform renewals; the independent scheduler owns date rollover.
  assert.equal(new SubscriptionService(db, config.timeZone).list(1).items[0].version, 1);
});

test("开放只读后，所有写操作和私人接口仍拒绝匿名及伪造身份", async () => {
  for (const action of ["create", "update", "delete", "renew", "initialize"]) {
    const response = await fetch(publicUrl + "/api/subscriptions", {
      method: "POST", headers: { ...headers, "oai-authenticated-user-id": "1" },
      body: JSON.stringify({ action, id: fixture.id, version: 1, item: fixture }),
    });
    assert.equal(response.status, 401, action);
  }
  assert.equal((await fetch(publicUrl + "/api/subscriptions")).status, 401);
  assert.equal((await fetch(publicUrl + "/api/auth/session")).status, 401);
  assert.equal((await fetch(publicUrl + "/api/dashboard", { headers: { Origin: "https://evil.test" } })).status, 403);
  assert.equal(new SubscriptionService(db, config.timeZone).list(1).items.length, 1);
});

test("登录才能管理和读取备注；退出后恢复真实只读列表", async () => {
  const login = await fetch(publicUrl + "/api/auth/login", { method: "POST", headers, body: JSON.stringify({ username: "admin", password }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const state = await (await fetch(publicUrl + "/api/dashboard", { headers: { Cookie: cookie } })).json() as DashboardSnapshot;
  assert.equal(state.canManage, true);
  assert.equal(state.items[0].note, fixture.note);
  assert.equal(state.items[0].version, 1);
  await fetch(publicUrl + "/api/auth/logout", { method: "POST", headers: { ...headers, Cookie: cookie }, body: "{}" });
  const signedOut = await (await fetch(publicUrl + "/api/dashboard", { headers: { Cookie: cookie } })).json() as DashboardSnapshot;
  assert.equal(signedOut.canManage, false);
  assert.equal(signedOut.items[0].id, fixture.id);
  assert.equal(signedOut.items[0].note, "");
});

test("公开展示必须显式开启，默认配置和关闭状态不泄露记录", async () => {
  assert.equal(readConfig({}).publicDashboard, false);
  assert.throws(() => readConfig({ PUBLIC_DASHBOARD: "yes" }), /PUBLIC_DASHBOARD/);
  const response = await fetch(privateUrl + "/api/dashboard");
  assert.equal(response.status, 401);
  assert.ok(!(await response.text()).includes(fixture.name));
});

test("新增分类可保存和读取，不需要修改现有数据库结构", () => {
  const service = new SubscriptionService(db, config.timeZone);
  for (const category of categories) {
    const id = randomUUID();
    const saved = service.execute(1, { action: "create", item: { ...fixture, id, category } }).item!;
    assert.equal(saved.category, category);
    service.execute(1, { action: "delete", id, version: saved.version });
  }
});
