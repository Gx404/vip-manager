import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../src/database.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { RenewalHistory } from "../src/renewal-history.ts";
import { BackupService } from "../src/backups.ts";
import { ExchangeRates } from "../src/exchange-rates.ts";
import { currencyCatalog, money } from "../../shared/currency.ts";
import { monthlyCostCny, type Subscription } from "../../shared/subscriptions.ts";
import { spendingReport } from "../../shared/reports.ts";

const record = (patch: Partial<Subscription> = {}): Subscription => ({
  id: randomUUID(), name: "Rate fixture", plan: "", category: "AI 工具", amount: 20, cycle: "monthly",
  customDays: 30, startDate: "2026-09-01", endDate: "2026-10-01", reminderDays: 7, autoRenew: false,
  note: "", color: "#269979", version: 0, ...patch,
});
const fx = { currency: "USD", purchaseDate: "2024-05-05", fxRateDate: "2024-05-03", fxRateToCny: 7.2352, fxRateSource: "frankfurter" } as const;
function setup() {
  const db = openDatabase(":memory:");
  db.exec("INSERT INTO users VALUES(1,'owner','test-only',0)");
  return { db, service: new SubscriptionService(db, "Asia/Shanghai", () => new Date("2026-09-30T00:00:00Z")), backups: new BackupService(db), history: new RenewalHistory(db) };
}
test("30 currencies, frozen conversion and source-currency labels are unambiguous", () => {
  assert.equal(currencyCatalog.length, 30);
  assert.equal(new Set(currencyCatalog.map(item => item.code)).size, 30);
  assert.equal(monthlyCostCny(record({ ...fx, cycle: "yearly", amount: 120 })), 72.352);
  for (const { code } of currencyCatalog) {
    assert.equal(money(25, code), `${code === "CNY" ? "¥" : code + " "}25.00`);
  }
});
test("currency snapshots survive editing, new periods, undo and JSON v3", t => {
  const { db,service,history,backups } = setup(); t.after(() => db.close());
  const initial = service.execute(1, { action: "create", item: record(fx) }).item!;
  assert.equal(initial.amount, 20); assert.equal(initial.fxRateToCny, fx.fxRateToCny);
  const renewed = service.execute(1, { action: "renew", id: initial.id, version: 0 });
  assert.equal(renewed.item!.purchaseDate, renewed.item!.startDate); assert.equal(renewed.item!.ratePending,true);
  assert.equal(renewed.renewal!.currency, "USD"); assert.equal(renewed.renewal!.amount, 20);
  service.execute(1, { action: "undoRenew", id: initial.id, version: 1, logId: renewed.renewal!.id });
  const current = service.list(1).items[0];
  service.execute(1, { action: "update", id: current.id, version: current.version, item: { ...current, autoRenew: true, fxRateToCny: 8, fxRateSource: "manual" } });
  service.advanceAutomaticRenewals(new Date("2027-01-01T00:00:00Z"));
  const latest = service.list(1).items[0];
  assert.equal(latest.purchaseDate, latest.startDate); assert.equal(latest.ratePending,true); assert.equal(latest.fxRateToCny, 8);
  assert.equal(history.list(1).logs.find(log => log.id === renewed.renewal!.id)!.fxRateToCny, fx.fxRateToCny);
  const backup = backups.export(1); assert.equal(backup.formatVersion, 3);
  backups.import(1, { backup, mode: "replace", confirmReplace: true, expectedRevision: backups.preview(1, backup).revision });
  assert.equal(service.list(1).items[0].amount, 20); assert.equal(service.list(1).items[0].fxRateToCny, 8);
  assert.equal(history.list(1).total, 2);
});
test("invalid foreign data is rejected before saving and legacy v4 JSON keeps its original amount", t => {
  const { db,service,backups } = setup(); t.after(() => db.close());
  for (const patch of [{ currency:"USD" }, { ...fx, fxRateToCny:0 }, { ...fx, fxRateDate:"2025-01-01" }, { currency:"CNY", fxRateToCny:2 }, { ...fx, currency:"XYZ" }]) {
    assert.throws(() => service.execute(1, { action:"create", item:{ ...record(), ...patch } }));
  }
  assert.equal(service.list(1).items.length, 0);
  const legacy = { ...record(), amount:119.22, billingAmount:25, billingCurrency:"AUD", exchangeRate:4.7689, exchangeRateDate:"2026-08-31", renewalAnchorDate:"2026-09-01" };
  const backup = { application:"vip-manager", formatVersion:1, currency:"CNY", exportedAt:new Date().toISOString(), subscriptions:[legacy], renewalLogs:[] };
  backups.import(1, { backup, mode:"merge", expectedRevision:backups.preview(1,backup).revision });
  const saved=service.list(1).items[0];
  assert.equal(saved.amount,25); assert.equal(saved.currency,"AUD"); assert.equal(saved.fxRateToCny,4.7689);
  assert.equal(saved.purchaseDate,"2026-09-01"); assert.equal(saved.fxRateDate,"2026-08-31");
  const mixed={...legacy,currency:"CNY"}; assert.throws(()=>backups.preview(1,{...backup,subscriptions:[mixed]}));
  const broken=backups.export(1); delete broken.subscriptions[0].fxRateToCny;
  assert.throws(()=>backups.preview(1,broken)); assert.equal(service.list(1).items.length,1);
});
test("deployed v4 migration preserves original AUD/CNY amounts, dates, user hash and CNY ledger", t => {
  const directory=mkdtempSync(join(tmpdir(),"vip-fx-migration-")); const path=join(directory,"db.sqlite");
  t.after(()=>rmSync(directory,{recursive:true,force:true,maxRetries:3,retryDelay:100}));
  let db=new DatabaseSync(path);
  for(const filename of ["001_initial.sql","002_automatic_renewals.sql","003_subscription_history.sql","004_multi_currency.sql"])db.exec(readFileSync(new URL("../migrations/"+filename,import.meta.url),"utf8"));
  db.exec("PRAGMA user_version=4; INSERT INTO users VALUES(1,'owner','hash-must-stay',0)");
  const id=randomUUID();
  db.prepare("INSERT INTO subscriptions(user_id,id,name,plan,category,amount_cents,cycle,custom_days,start_date,end_date,reminder_days,auto_renew,note,color,updated_at,billing_amount_cents,billing_currency,exchange_rate_micros,exchange_rate_date) VALUES(1,?,'AUD','','AI 工具',11922,'monthly',30,'2026-09-20','2026-10-20',7,0,'private','#269979',0,2500,'AUD',4768900,'2026-09-18')").run(id);
  db.close(); db=openDatabase(path);
  try {
    const item=new SubscriptionService(db,"Asia/Shanghai").list(1).items[0];
    assert.equal(item.amount,25); assert.equal(item.currency,"AUD"); assert.equal(item.fxRateToCny,4.7689);
    assert.equal(item.purchaseDate,"2026-09-20"); assert.equal(item.fxRateDate,"2026-09-18");
    assert.equal(db.prepare("SELECT amount_cents FROM subscriptions").get()!.amount_cents,11922);
    assert.equal(db.prepare("SELECT password_hash FROM users").get()!.password_hash,"hash-must-stay");
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version,8);
    assert.equal(db.prepare("PRAGMA integrity_check").get()!.integrity_check,"ok");
  } finally { db.close(); }
});
test("historical lookup sends the purchase date, retains weekend fixing, shares concurrent requests and expires cache", async t => {
  let calls=0, clock=Date.now(); t.mock.method(Date,"now",()=>clock);
  const rates=new ExchangeRates(async input => { calls++; const url=new URL(String(input)); assert.equal(url.searchParams.get("date"),"2024-05-05"); assert.ok(!url.toString().includes("latest")); return Response.json({date:"2024-05-03",base:"USD",quote:"CNY",rate:7.2352}); });
  const [a,b]=await Promise.all([rates.lookup({currency:"USD",date:"2024-05-05"}),rates.lookup({currency:"USD",date:"2024-05-05"})]);
  assert.deepEqual(a,b); assert.equal(a.rateDate,"2024-05-03"); assert.equal(calls,1);
  await rates.lookup({currency:"USD",date:"2024-05-05"});assert.equal(calls,1);
  clock+=86_400_001;await rates.lookup({currency:"USD",date:"2024-05-05"});assert.equal(calls,2);
  await assert.rejects(rates.lookup({currency:"USD",date:"2200-01-01"}),{status:400});
  await assert.rejects(rates.lookup({currency:"../private",date:"2024-05-05"}));
});
test("lookup failures, zero/mismatched/current/stale rates never become valid historical snapshots", async () => {
  const responses=[new Response("down",{status:503}),Response.json({date:"2024-05-03",base:"USD",quote:"CNY",rate:0}),
    Response.json({date:"2024-05-03",base:"EUR",quote:"CNY",rate:7}),
    Response.json({date:"2026-10-01",base:"USD",quote:"CNY",rate:7}),
    Response.json({date:"2023-01-01",base:"USD",quote:"CNY",rate:7}),new Response("broken JSON"),
    Response.json({date:"2024-05-03",base:"USD",quote:"CNY",rate:7.2352})];
  const rates=new ExchangeRates(async()=>responses.shift()!);
  for(let i=0;i<6;i++)await assert.rejects(rates.lookup({currency:"USD",date:"2024-05-05"}),{code:"FX_UNAVAILABLE"});
  assert.equal((await rates.lookup({currency:"USD",date:"2024-05-05"})).rate,7.2352);
});
test("reports reconcile categories, currencies, cycles and renewal modes, excluding expired records", () => {
  const records=[record({...fx,amount:10}),record({category:"云存储",cycle:"yearly",amount:120}),record({amount:999,endDate:"2026-08-01",startDate:"2026-07-01"}),record({amount:0,autoRenew:true})];
  const result=spendingReport(records,"2026-09-30");
  assert.equal(result.expired,1); assert.equal(result.active.length,3);
  assert.equal(result.monthly,82.352); assert.equal(result.annual,result.monthly*12);
  for(const groups of [result.categories,result.currencies,result.cycles,result.modes])assert.ok(Math.abs(groups.reduce((sum,item)=>sum+item.monthly,0)-result.monthly)<1e-9);
  assert.equal(result.ranking[0].currency,"USD");
  assert.equal(spendingReport([],"2026-09-30").monthly,0);
  assert.equal(spendingReport([record({amount:0})],"2026-09-30").categories[0].share,0);
});
