import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { automaticPeriod, billingAnchor, cycleBoundary, dateInTimeZone } from "../../shared/billing.ts";
import type { Subscription } from "../../shared/subscriptions.ts";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { startRenewalScheduler } from "../src/renewal-scheduler.ts";

const record = (changes: Partial<Subscription> = {}): Subscription => ({
  id: randomUUID(), name: "Test recurring membership", plan: "monthly", category: "AI 工具", amount: 10,
  cycle: "monthly", customDays: 30, startDate: "2026-08-30", endDate: "2026-09-30", reminderDays: 7,
  autoRenew: true, note: "unchanged private note", color: "#269979", version: 0, ...changes,
});
const at = (day: string) => new Date(day + "T12:00:00Z");
function createDatabase(filename = ":memory:") {
  const db = openDatabase(filename);
  db.prepare("INSERT OR IGNORE INTO users(id,username,password_hash,created_at) VALUES(1,'owner','test-only',0)").run();
  return { db, service: new SubscriptionService(db, "Asia/Shanghai") };
}

test("automatic billing changes only at the boundary in APP_TIMEZONE, never in the reminder window", t => {
  const { db, service } = createDatabase(); t.after(() => db.close());
  service.execute(1, { action: "create", item: record() });
  assert.equal(service.advanceAutomaticRenewals(new Date("2026-09-29T15:59:59Z")), 0);
  assert.equal(service.advanceAutomaticRenewals(new Date("2026-09-29T16:00:00Z")), 1);
  const next = service.list(1).items[0];
  assert.equal(next.startDate, "2026-09-30"); assert.equal(next.endDate, "2026-10-30");
  assert.equal(dateInTimeZone(new Date("2026-09-29T16:00:00Z"), "Asia/Shanghai"), "2026-09-30");
});

test("automatic processing is idempotent, creates an audit event and preserves non-date fields", t => {
  const { db, service } = createDatabase(); t.after(() => db.close());
  const original = record(); service.execute(1, { action: "create", item: original });
  assert.equal(service.advanceAutomaticRenewals(at("2026-09-30")), 1);
  assert.equal(service.advanceAutomaticRenewals(at("2026-09-30")), 0);
  const next = service.list(1).items[0];
  assert.equal(next.version, 1); assert.equal(next.amount, original.amount); assert.equal(next.note, original.note);
  assert.equal(db.prepare("SELECT count(*) AS count FROM automatic_renewal_events").get()?.count, 1);
  const event = db.prepare("SELECT * FROM automatic_renewal_events").get()!;
  assert.equal(event.previous_end_date, original.endDate); assert.equal(event.new_end_date, next.endDate);
  assert.throws(() => service.execute(1, { action: "update", id: original.id, version: 0, item: original }), { status: 409 });
});

test("disabled subscriptions and future subscriptions stay untouched", t => {
  const { db, service } = createDatabase(); t.after(() => db.close());
  service.execute(1, { action: "create", item: record({ autoRenew: false }) });
  service.execute(1, { action: "create", item: record({ startDate: "2027-01-01", endDate: "2027-02-01" }) });
  assert.equal(service.advanceAutomaticRenewals(at("2026-10-20")), 0);
  assert.ok(service.list(1).items.every(item => item.version === 0));
});

test("a January 31 billing anchor survives February and returns to day 31", t => {
  const { db, service } = createDatabase(); t.after(() => db.close());
  service.execute(1, { action: "create", item: record({ startDate: "2026-01-31", endDate: "2026-02-28" }) });
  for (const [today, end] of [["2026-02-28", "2026-03-31"], ["2026-03-31", "2026-04-30"], ["2026-04-30", "2026-05-31"]]) {
    assert.equal(service.advanceAutomaticRenewals(at(today)), 1);
    assert.equal(service.list(1).items[0].endDate, end);
  }
});

test("yearly and quarterly anchors retain leap-year/month-end intent", () => {
  const yearly = record({ cycle: "yearly", startDate: "2024-02-29", endDate: "2025-02-28" });
  const next = automaticPeriod(yearly, billingAnchor(yearly), "2027-02-28")!;
  assert.equal(next.endDate, "2028-02-29"); assert.equal(next.periods, 3);
  assert.equal(cycleBoundary("2025-10-31", "quarterly", 30, 2), "2026-04-30");
  assert.equal(cycleBoundary("2025-10-31", "quarterly", 30, 3), "2026-07-31");
});

test("long offline gaps catch up in one update, including daily custom plans", t => {
  const { db, service } = createDatabase(); t.after(() => db.close());
  service.execute(1, { action: "create", item: record({ startDate: "2024-01-31", endDate: "2024-02-29" }) });
  assert.equal(service.advanceAutomaticRenewals(at("2026-09-30")), 1);
  const next = service.list(1).items[0];
  assert.equal(next.startDate, "2026-09-30"); assert.equal(next.endDate, "2026-10-31"); assert.equal(next.version, 1);
  assert.ok(Number(db.prepare("SELECT periods_advanced FROM automatic_renewal_events").get()?.periods_advanced) > 30);
  const daily = record({ cycle: "custom", customDays: 1, startDate: "1900-01-01", endDate: "1900-01-02" });
  assert.equal(automaticPeriod(daily, daily.startDate, "2026-09-30")?.endDate, "2026-10-01");
});

test("turning automatic renewal off stops it; editing dates establishes a new anchor", t => {
  const { db, service } = createDatabase(); t.after(() => db.close());
  let item = service.execute(1, { action: "create", item: record() }).item!;
  item = service.execute(1, { action: "update", id: item.id, version: item.version, item: { ...item, autoRenew: false } }).item!;
  assert.equal(service.advanceAutomaticRenewals(at("2026-10-30")), 0);
  item = service.execute(1, { action: "update", id: item.id, version: item.version, item: { ...item, autoRenew: true, startDate: "2026-09-15", endDate: "2026-10-15" } }).item!;
  assert.equal(service.advanceAutomaticRenewals(at("2026-10-15")), 1);
  assert.equal(service.list(1).items[0].endDate, "2026-11-15");
});

test("scheduler runs without any page request, retries failures and stops cleanly", t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let calls = 0, failures = 0, updated = 0;
  const stop = startRenewalScheduler({ advanceAutomaticRenewals: () => {
    calls++; if (calls === 1) throw new Error("temporary database failure"); return calls === 2 ? 1 : 0;
  } }, { onError: () => { failures++; }, onRenewed: count => { updated += count; } });
  assert.equal(calls, 1); assert.equal(failures, 1);
  t.mock.timers.tick(60_000); assert.equal(calls, 2); assert.equal(updated, 1);
  stop(); stop(); t.mock.timers.tick(120_000); assert.equal(calls, 2);
});

test("startup scheduler advances already-due data and repeated starts do not renew twice", t => {
  const { db, service } = createDatabase(); t.after(() => db.close());
  service.execute(1, { action: "create", item: record() });
  const options = { now: () => at("2026-09-30"), onRenewed: () => {} };
  const first = startRenewalScheduler(service, options); first();
  const second = startRenewalScheduler(service, options); second();
  assert.equal(service.list(1).items[0].version, 1);
});

test("v1 migration preserves records, and anchors survive database reopen", async t => {
  const directory = await mkdtemp(join(tmpdir(), "vip-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "v1.sqlite");
  const legacy = new DatabaseSync(filename);
  try {
    legacy.exec(await readFile(new URL("../migrations/001_initial.sql", import.meta.url), "utf8"));
    legacy.exec("PRAGMA user_version=1; INSERT INTO users VALUES(1,'owner','test-hash',0)");
    legacy.prepare(`INSERT INTO subscriptions VALUES(1,?,'Legacy','monthly','其他服务',1000,'monthly',30,
      '2026-01-31','2026-02-28',7,1,'private','#269979',0,0)`).run(randomUUID());
  } finally { legacy.close(); }
  let db = openDatabase(filename);
  try {
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 2);
    let service = new SubscriptionService(db, "Asia/Shanghai");
    assert.equal(service.list(1).items[0].endDate, "2026-02-28");
    assert.equal(service.advanceAutomaticRenewals(at("2026-02-28")), 1);
    db.close(); db = openDatabase(filename); service = new SubscriptionService(db, "Asia/Shanghai");
    assert.equal(service.advanceAutomaticRenewals(at("2026-03-31")), 1);
    assert.equal(service.list(1).items[0].endDate, "2026-04-30");
    assert.equal(service.list(1).items[0].note, "private");
  } finally { db.close(); }
});
