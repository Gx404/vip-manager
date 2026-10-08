import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../src/database.ts";
import { readConfig } from "../src/config.ts";
import { SubscriptionService } from "../src/subscriptions.ts";
import { EmailNotificationService } from "../src/notifications.ts";
import { MailDeliveryError, type MailMessage } from "../src/email.ts";
import { startNotificationScheduler } from "../src/renewal-scheduler.ts";
import type { Subscription } from "../../shared/subscriptions.ts";

const config = readConfig({
  PUBLIC_ORIGIN: "https://frontend.test", EMAIL_NOTIFICATIONS: "true", SMTP_USER: "owner@qq.com", SMTP_PASSWORD: "test-only-secret",
  EMAIL_FROM: "owner@qq.com", EMAIL_TO: "owner@qq.com", EMAIL_REMINDER_HOUR: "9", EMAIL_REMINDER_MINUTE: "0",
});
const record = (changes: Partial<Subscription> = {}): Subscription => ({
  id: randomUUID(), name: "百度网盘", plan: "超级会员", category: "云盘存储", amount: 198, cycle: "yearly", customDays: 30,
  startDate: "2025-10-15", endDate: "2026-10-15", reminderDays: 7, autoRenew: false, note: "private", color: "#269979", version: 0,
  currency: "CNY", purchaseDate: "2025-10-15", fxRateToCny: 1, fxRateDate: "2025-10-15", fxRateSource: "manual", ...changes,
});

test("邮件提醒按账期去重，修改到期日后生成新提醒", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(1,'owner','test-only',0)").run();
  const service = new SubscriptionService(db, config.timeZone);
  const item = service.execute(1, { action: "create", item: record() }).item!;
  const messages: MailMessage[] = [];
  const notifications = new EmailNotificationService(db, config, { send: async message => { messages.push(message); } }, () => new Date("2026-10-08T01:00:00Z"));
  assert.equal(await notifications.sendDueReminders(new Date("2026-10-08T00:59:00Z")), 0); // 08:59 local, before configured time.
  assert.equal(await notifications.sendDueReminders(new Date("2026-10-08T01:00:00Z")), 1);
  assert.equal(await notifications.sendDueReminders(new Date("2026-10-08T02:00:00Z")), 0);
  assert.equal(messages.length, 1); assert.match(messages[0].subject, /1 项订阅/); assert.match(messages[0].text, /百度网盘/);
  assert.ok(!messages[0].text.includes("private"));
  const changed = { ...item, endDate: "2026-10-20", version: 0 };
  service.execute(1, { action: "update", id: item.id, version: item.version, item: changed });
  assert.equal(await notifications.sendDueReminders(new Date("2026-10-13T01:00:00Z")), 1);
  assert.equal(messages.length, 2);
  assert.equal(db.prepare("SELECT count(*) AS count FROM email_notification_deliveries WHERE status='sent'").get()?.count, 2);
});

test("邮件发送失败持久化，并按退避时间重试", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(1,'owner','test-only',0)").run();
  new SubscriptionService(db, config.timeZone).execute(1, { action: "create", item: record() });
  let attempts = 0;
  const notifications = new EmailNotificationService(db, config, { send: async () => { attempts++; if (attempts === 1) throw new Error("temporary SMTP outage"); } });
  await assert.rejects(notifications.sendDueReminders(new Date("2026-10-08T01:00:00Z")), /邮件服务/);
  assert.equal(db.prepare("SELECT status FROM email_notification_deliveries").get()?.status, "failed");
  assert.equal(await notifications.sendDueReminders(new Date("2026-10-08T01:01:00Z")), 0);
  assert.equal(await notifications.sendDueReminders(new Date("2026-10-08T01:05:00Z")), 1);
  assert.equal(db.prepare("SELECT attempts FROM email_notification_deliveries").get()?.attempts, 2);
});

test("测试邮件不回显授权码，冷却和状态不会因服务重建而消失", async () => {
  const db = openDatabase(":memory:");
  try {
    db.prepare("INSERT INTO users(id,username,password_hash,created_at) VALUES(1,'owner','test-only',0)").run();
    const messages: MailMessage[] = [];
    const notifications = new EmailNotificationService(db, config, { send: async message => { messages.push(message); } }, () => new Date("2026-10-08T01:00:00Z"));
    await notifications.sendTest(1);
    assert.equal(messages.length, 1); assert.match(messages[0].subject, /会员提醒测试/); assert.ok(!messages[0].text.includes("test-only-secret"));
    const second = new EmailNotificationService(db, config, { send: async message => { messages.push(message); } }, () => new Date("2026-10-08T01:00:30Z"));
    await assert.rejects(second.sendTest(1), { status:429, retryAfterSeconds:30 });
    assert.equal(messages.length, 1);
    const status = second.status(1);
    assert.equal(status.recent[0].status, "sent");
    assert.equal(status.recipient, "ow***@qq.com");
    assert.ok(!JSON.stringify(status).includes("test-only-secret"));
  } finally { db.close(); }
});

test("并发扫描只领取一次，发送期间不会重复提交", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.exec("INSERT INTO users VALUES(1,'owner','test',0)");
  new SubscriptionService(db, config.timeZone).execute(1, { action:"create", item:record() });
  let release!: () => void, sends = 0;
  const sender = { send: () => { sends++; return new Promise<void>(resolve => { release = resolve; }); } };
  const now = new Date("2026-10-08T01:00:00Z");
  const first = new EmailNotificationService(db, config, sender).sendDueReminders(now);
  assert.equal(await new EmailNotificationService(db, config, sender).sendDueReminders(now), 0);
  release(); assert.equal(await first, 1); assert.equal(sends, 1);
});

test("跨用户隔离、未来开始和已过期的订阅不发送", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close());
  db.exec("INSERT INTO users VALUES(1,'owner','test',0),(2,'other','test',0)");
  const subscriptions = new SubscriptionService(db, config.timeZone);
  subscriptions.execute(2, { action:"create", item:record({ name:"other-private" }) });
  subscriptions.execute(1, { action:"create", item:record({ startDate:"2026-10-09", endDate:"2026-10-15" }) });
  subscriptions.execute(1, { action:"create", item:record({ endDate:"2026-10-07" }) });
  const service = new EmailNotificationService(db, config, { send: async () => { assert.fail("not due"); } });
  assert.equal(await service.sendDueReminders(new Date("2026-10-08T01:00:00Z")), 0);
  assert.throws(() => service.status(2), { status:403 });
  await assert.rejects(service.sendTest(2), { status:403 });
});

test("自动续期后提前零天的提醒从当日流水恢复，且不会二次发送", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close()); db.exec("INSERT INTO users VALUES(1,'owner','test',0)");
  const subscriptions = new SubscriptionService(db, config.timeZone);
  subscriptions.execute(1, { action:"create", item:record({ autoRenew:true, reminderDays:0, endDate:"2026-10-08" }) });
  subscriptions.advanceAutomaticRenewals(new Date("2026-10-07T16:00:00Z"));
  const messages: MailMessage[] = [];
  const service = new EmailNotificationService(db, config, { send: async mail => { messages.push(mail); } });
  assert.equal(await service.sendDueReminders(new Date("2026-10-08T01:00:00Z")), 1);
  assert.match(messages[0].text, /原账期今日结束/);
  assert.equal(await service.sendDueReminders(new Date("2026-10-08T02:00:00Z")), 0);
});

test("修改提前天数不会重发同一到期日，暂停提醒不会发送", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close()); db.exec("INSERT INTO users VALUES(1,'owner','test',0)");
  const subscriptions = new SubscriptionService(db, config.timeZone), item = subscriptions.execute(1, { action:"create", item:record() }).item!;
  let sends = 0;
  const service = new EmailNotificationService(db, config, { send:async () => { sends++; } });
  const now = new Date("2026-10-08T01:00:00Z");
  assert.equal(await service.sendDueReminders(now), 1);
  subscriptions.execute(1, { action:"update", id:item.id, version:item.version, item:{ ...item, reminderDays:10 } });
  assert.equal(await service.sendDueReminders(now), 0); assert.equal(sends, 1);
  const paused = new EmailNotificationService(db, { ...config, email:{ ...config.email, enabled:false } }, { send:async () => { assert.fail(); } });
  assert.equal(await paused.sendDueReminders(now), 0);
});

test("超时未确认和崩溃遗留领取不自动重发，错误不泄露服务商内容", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close()); db.exec("INSERT INTO users VALUES(1,'owner','test',0)");
  new SubscriptionService(db, config.timeZone).execute(1, { action:"create", item:record() });
  const service = new EmailNotificationService(db, config, { send:async () => { throw Object.assign(new Error("test-only-secret"), { command:"DATA" }); } });
  await assert.rejects(service.sendDueReminders(new Date("2026-10-08T01:00:00Z")), /结果未确认/);
  assert.equal(db.prepare("SELECT status FROM email_notification_deliveries").get()?.status, "uncertain");
  assert.equal(await service.sendDueReminders(new Date("2026-10-08T03:00:00Z")), 0);
  db.exec("UPDATE email_notification_deliveries SET status='pending'");
  assert.equal(await service.sendDueReminders(new Date("2026-10-08T04:00:00Z")), 0);
  assert.equal(db.prepare("SELECT status FROM email_notification_deliveries").get()?.status, "uncertain");
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM email_notification_deliveries").all()).includes("test-only-secret"));
});

test("最多五次发送，永久认证错误停止重试", async t => {
  const db = openDatabase(":memory:"); t.after(() => db.close()); db.exec("INSERT INTO users VALUES(1,'owner','test',0)");
  new SubscriptionService(db, config.timeZone).execute(1, { action:"create", item:record() });
  let sends = 0;
  const service = new EmailNotificationService(db, config, { send:async () => { sends++; throw new Error("test-only-secret"); } });
  for (const minute of [0,5,35,155,515]) await assert.rejects(service.sendDueReminders(new Date(Date.parse("2026-10-08T01:00:00Z") + minute * 60000)));
  assert.equal(await service.sendDueReminders(new Date("2026-10-09T01:00:00Z")), 0); assert.equal(sends, 5);
  db.exec("DELETE FROM email_notification_deliveries");
  const authFailure = new EmailNotificationService(db, config, { send:async () => { throw new MailDeliveryError("邮箱验证失败", false, false); } });
  await assert.rejects(authFailure.sendDueReminders(new Date("2026-10-08T01:00:00Z")));
  assert.equal(await authFailure.sendDueReminders(new Date("2026-10-09T01:00:00Z")), 0);
});

test("邮件调度器停止时等待在途任务，不重叠扫描", async t => {
  t.mock.timers.enable({ apis:["setInterval"] });
  let release!: () => void, runs = 0, stopped = false;
  const stop = startNotificationScheduler({ sendDueReminders: () => { runs++; return new Promise<number>(resolve => { release = () => resolve(0); }); } }, { intervalMs:10 });
  t.mock.timers.tick(100); assert.equal(runs, 1);
  const pending = stop().then(() => { stopped = true; });
  await Promise.resolve(); assert.equal(stopped, false);
  release(); await pending; t.mock.timers.tick(100); assert.equal(runs, 1);
});
