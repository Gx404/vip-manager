import type { SubscriptionService } from "./subscriptions.ts";

type Options = { intervalMs?: number; now?: () => Date; onError?: (error: unknown) => void; onRenewed?: (count: number) => void };

/** Run once at startup, then each minute. Returns an idempotent stop function for server shutdown. */
export function startRenewalScheduler(service: Pick<SubscriptionService, "advanceAutomaticRenewals">, options: Options = {}): () => void {
  const intervalMs = options.intervalMs ?? 60_000;
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error("自动续期检查间隔无效。");
  const now = options.now ?? (() => new Date());
  let stopped = false;
  const run = () => {
    if (stopped) return;
    try {
      const changed = service.advanceAutomaticRenewals(now());
      if (changed > 0) {
        if (options.onRenewed) options.onRenewed(changed);
        else console.log("Automatic membership periods advanced:", changed);
      }
    } catch (error) {
      if (options.onError) options.onError(error);
      else console.error("自动续期检查失败，下次将重试：", error instanceof Error ? error.name : "UnknownError");
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}

type NotificationOptions = { intervalMs?: number; now?: () => Date; onError?: (error: unknown) => void; onSent?: (count: number) => void };

/** Run asynchronous email reminder scans without overlapping a slow SMTP request. */
export function startNotificationScheduler(service: { sendDueReminders: (now?: Date) => Promise<number> }, options: NotificationOptions = {}): () => Promise<void> {
  const intervalMs = options.intervalMs ?? 60_000;
  if (!Number.isFinite(intervalMs) || intervalMs < 1) throw new Error("邮件提醒检查间隔无效。");
  const now = options.now ?? (() => new Date());
  let stopped = false;
  let running = false;
  let current: Promise<void> = Promise.resolve();
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const sent = await service.sendDueReminders(now());
      if (sent > 0) {
        if (options.onSent) options.onSent(sent);
        else console.log("Email membership reminders sent:", sent);
      }
    } catch (error) {
      if (options.onError) options.onError(error);
      else console.error("邮件提醒检查失败，下次将重试：", error instanceof Error ? error.message : "UnknownError");
    } finally { running = false; }
  };
  const tick = () => { if (!running && !stopped) current = run(); };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return async () => { stopped = true; clearInterval(timer); await current; };
}
