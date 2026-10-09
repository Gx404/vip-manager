import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { BackupService } from "../src/backups.ts";
import { categories, type Subscription } from "../../shared/subscriptions.ts";

const renamed = [
  ["购物会员", "购物电商"], ["云盘存储", "云存储"],
  ["效率办公", "办公效率"], ["网络服务", "云服务与网络"],
] as const;
const item = (category: string, name = "Category fixture"): Subscription => ({
  id: randomUUID(), name, plan: "monthly", category, amount: 25, currency: "AUD",
  purchaseDate: "2024-05-05", fxRateDate: "2024-05-03", fxRateToCny: 4.7689, fxRateSource: "manual",
  cycle: "monthly", customDays: 30, startDate: "2026-09-01", endDate: "2026-10-01",
  reminderDays: 7, autoRenew: false, note: "private note must stay", color: "#269979", version: 0,
});

test("v6 category migration preserves money, dates, owners and history, and runs only once", t => {
  const directory = mkdtempSync(join(tmpdir(), "vip-categories-"));
  t.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const path = join(directory, "v6.sqlite");
  let db = new DatabaseSync(path);
  for (const name of ["001_initial.sql", "002_automatic_renewals.sql", "003_subscription_history.sql", "004_multi_currency.sql", "005_purchase_rate_snapshots.sql", "006_email_notifications.sql"]) {
    db.exec(readFileSync(new URL("../migrations/" + name, import.meta.url), "utf8"));
  }
  db.exec("PRAGMA user_version=6; INSERT INTO users VALUES(1,'owner','keep-hash',1),(2,'other','keep-other-hash',2)");
  let service = new SubscriptionService(db, "Asia/Shanghai");
  const expected = new Map<string, string>();
  for (const owner of [1, 2]) {
    for (const [oldCategory, newCategory, name] of [
      ...renamed.map(([oldName, newName]) => [oldName, newName, oldName]),
      ["影音娱乐", "设计与创作", "醒图会员"], ["其他服务", "设计与创作", "Xingtu Pro"],
      ["AI 工具", "AI 工具", "ChatGPT"], ["影音娱乐", "影音娱乐", "哔哩哔哩"],
      ["生活服务", "生活服务", "醒图 自选分类"],
      ["生活服务", "购物电商", "盒马"], ["其他服务", "购物电商", "Freshippo X"],
    ]) {
      const created = service.execute(owner, { action: "create", item: item(newCategory, name) }).item!;
      // A historical renewal exercises frozen currency, anchor and ledger fields too.
      service.execute(owner, { action: "renew", id: created.id, version: created.version });
      db.prepare("UPDATE subscriptions SET category=?,updated_at=1 WHERE user_id=? AND id=?").run(oldCategory, owner, created.id);
      expected.set(created.id, newCategory);
    }
  }
  const snapshot = (table: string) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const before = snapshot("subscriptions");
  const otherTables = ["users", "subscription_preferences", "subscription_renewal_logs", "automatic_renewal_events"];
  const others = otherTables.map(snapshot);
  db.close(); db = openDatabase(path);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 7);
    assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
    const after = snapshot("subscriptions");
    assert.equal(after.length, before.length);
    for (const [index, old] of before.entries()) {
      const actual = after[index], category = expected.get(String(old.id))!;
      if (category === old.category) assert.deepEqual(actual, old);
      else {
        assert.ok(Number(actual.updated_at) > Number(old.updated_at));
        assert.deepEqual({ ...actual }, { ...old, category, version: Number(old.version) + 1, updated_at: actual.updated_at });
      }
    }
    otherTables.forEach((table, index) => assert.deepEqual(snapshot(table), others[index]));
    service = new SubscriptionService(db, "Asia/Shanghai");
    const migrated = service.list(1).items.find(record => record.name === "醒图会员")!;
    assert.throws(() => service.execute(1, { action: "update", id: migrated.id, version: migrated.version - 1, item: { ...migrated, category: "影音娱乐" } }), { status: 409 });
    service.execute(1, { action: "update", id: migrated.id, version: migrated.version, item: { ...migrated, category: "生活服务" } });
    const stable = snapshot("subscriptions");
    db.close(); db = openDatabase(path);
    assert.deepEqual(snapshot("subscriptions"), stable, "restarting must not undo a later category choice");
  } finally { db.close(); }
});

test("new categories round-trip, while legacy API and JSON names normalize without dropping records", t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.exec("INSERT INTO users VALUES(1,'owner','test-only',0)");
  const service = new SubscriptionService(db, "Asia/Shanghai"), backups = new BackupService(db);
  for (const category of categories) {
    assert.equal(service.execute(1, { action: "create", item: item(category) }).item!.category, category);
  }
  for (const [oldCategory, newCategory] of renamed) {
    assert.equal(service.execute(1, { action: "create", item: item(oldCategory) }).item!.category, newCategory);
  }
  const backup = {
    application: "vip-manager", formatVersion: 2, currency: "CNY", exportedAt: new Date().toISOString(),
    subscriptions: renamed.map(([category]) => ({ ...item(category), renewalAnchorDate: "2026-09-01" })), renewalLogs: [],
  };
  const result = backups.import(1, { backup, mode: "merge", expectedRevision: backups.preview(1, backup).revision });
  assert.equal(result.importedSubscriptions, renamed.length);
  for (const [index, original] of backup.subscriptions.entries()) {
    const actual = service.list(1).items.find(record => record.id === original.id)!;
    assert.equal(actual.category, renamed[index][1]);
    for (const key of ["amount", "currency", "purchaseDate", "fxRateToCny", "fxRateDate", "startDate", "endDate", "note"] as const) {
      assert.equal(actual[key], original[key], key);
    }
  }
  assert.ok(backups.export(1).subscriptions.every(record => categories.includes(record.category as typeof categories[number])));
  const before = service.list(1).items;
  const invalid = { ...backup, subscriptions: [{ ...backup.subscriptions[0], category: "typo-category" }] };
  assert.throws(() => backups.preview(1, invalid));
  assert.throws(() => backups.import(1, { backup: invalid, mode: "merge", expectedRevision: backups.preview(1, backup).revision }));
  assert.throws(() => service.execute(1, { action: "create", item: item("typo-category") }));
  assert.deepEqual(service.list(1).items, before);
});
