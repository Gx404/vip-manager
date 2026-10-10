import { readConfig, configurationWarnings } from "./config.ts";
import { openDatabase } from "./database.ts";
import { bootstrapAdmin } from "./auth.ts";
import { createApp } from "./app.ts";
import { SubscriptionService } from "./subscriptions.ts";
import { startNotificationScheduler, startRenewalScheduler } from "./renewal-scheduler.ts";
import { EmailNotificationService } from "./notifications.ts";
import type { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | undefined;
let stopRenewals: (() => void) | undefined;
let stopNotifications: (() => Promise<void>) | undefined;
let stopRates: (() => Promise<void>) | undefined;
let notifications: EmailNotificationService | undefined;
try {
  const config = readConfig();
  for (const warning of configurationWarnings(config)) console.warn(warning);
  db = openDatabase(config.databasePath);
  await bootstrapAdmin(db,config);
  stopRenewals = startRenewalScheduler(new SubscriptionService(db,config.timeZone));
  const rateService = new SubscriptionService(db,config.timeZone);
  stopRates = startNotificationScheduler({sendDueReminders:async () => { await rateService.refreshPendingRates(); return 0; }});
  notifications = new EmailNotificationService(db, config);
  if (config.email.enabled) stopNotifications = startNotificationScheduler(notifications);
  const server = createApp(db,config,notifications).listen(config.port,config.host,() => {
    console.log("Membership API listening on " + config.host + ":" + config.port);
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.on("error", async error => {
    console.error("后端启动失败：",error.message);
    stopRenewals?.();
    await stopNotifications?.();
    await stopRates?.();
    await notifications?.drain();
    try { db?.close(); } catch { console.error("数据库关闭失败。"); }
    process.exitCode=1;
  });
  let stopping=false;
  const stop = () => {
    if (stopping) return;
    stopping=true;
    stopRenewals?.();
    const drained = stopNotifications?.();
    const ratesDrained = stopRates?.();
    const timer=setTimeout(() => { server.closeAllConnections(); },10_000);
    timer.unref();
    server.close(async () => {
      await drained;
      await ratesDrained;
      await notifications?.drain();
      clearTimeout(timer);
      try { db?.close(); } catch { console.error("数据库关闭失败。"); process.exitCode=1; }
    });
  };
  process.on("SIGINT",stop);
  process.on("SIGTERM",stop);
} catch (error) {
  stopRenewals?.();
  await stopNotifications?.();
  await stopRates?.();
  await notifications?.drain();
  console.error("启动失败：",error instanceof Error ? error.message : "未知错误");
  try { db?.close(); } catch { console.error("数据库关闭失败。"); }
  process.exitCode=1;
}
