import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { dateInTimeZone } from "../../shared/billing.ts";
import { remaining, type Subscription } from "../../shared/subscriptions.ts";
import type { DeliveryState, EmailStatus } from "../../shared/notifications.ts";
import { money } from "../../shared/currency.ts";
import type { Config } from "./config.ts";
import { ApiError } from "./errors.ts";
import { transaction } from "./database.ts";
import { SubscriptionService } from "./subscriptions.ts";
import { SmtpMailer, safeMailError, type MailMessage } from "./email.ts";

type Candidate = { key: string; item: Subscription; days: number; advanced?: boolean };
const retryMinutes = [5, 30, 120, 360];
const testCooldown = 60_000;
const leaseMs = 120_000;

function maskedEmail(value: string): string {
  const [local, domain] = value.split("@");
  return local && domain ? `${local.slice(0, 2)}***@${domain}` : "未配置";
}

/** Durable single-owner email digests; never include other accounts or private notes. */
export class EmailNotificationService {
  private readonly db: DatabaseSync;
  private readonly config: Config;
  private readonly subscriptions: SubscriptionService;
  private readonly sender: Pick<SmtpMailer, "send">;
  private readonly clock: () => Date;
  private readonly inFlight = new Set<Promise<unknown>>();

  constructor(db: DatabaseSync, config: Config, sender: Pick<SmtpMailer, "send"> = new SmtpMailer(config.email), clock: () => Date = () => new Date()) {
    this.db = db; this.config = config; this.subscriptions = new SubscriptionService(db, config.timeZone); this.sender = sender; this.clock = clock;
  }

  private owner(): number | undefined {
    const row = this.db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get();
    return row ? Number(row.id) : undefined;
  }

  private authorize(user: number): void {
    if (user !== this.owner()) throw new ApiError(403, "邮件设置仅供主管理员使用。", "EMAIL_OWNER_REQUIRED");
  }

  private expireLeases(now: number): void {
    const message = "上次发送中断，结果未确认；请先检查收件箱，不会自动重发。";
    this.db.prepare("UPDATE email_notification_deliveries SET status='uncertain',last_error=?,next_attempt_at=NULL WHERE status='pending' AND updated_at<?").run(message, now - leaseMs);
    this.db.prepare("UPDATE email_test_attempts SET status='uncertain',last_error=? WHERE status='pending' AND attempted_at<?").run(message, now - leaseMs);
  }

  /** Return only masked settings and safe recent results for the authenticated owner. */
  status(user: number): EmailStatus {
    this.authorize(user);
    this.expireLeases(this.clock().getTime());
    const recent = this.db.prepare(`SELECT 'reminder' AS kind,COALESCE(s.name,'已删除订阅') AS name,d.status,d.updated_at AS time,d.last_error AS error
      FROM email_notification_deliveries d LEFT JOIN subscriptions s ON s.user_id=d.user_id AND s.id=d.subscription_id
      WHERE d.user_id=? UNION ALL SELECT 'test','测试邮件',status,attempted_at,last_error FROM email_test_attempts WHERE user_id=? ORDER BY time DESC LIMIT 5`).all(user, user);
    const attempt = this.db.prepare("SELECT attempted_at FROM email_test_attempts WHERE user_id=?").get(user);
    const email = this.config.email;
    return { enabled: email.enabled, configured: Boolean(email.password && email.username && email.from && email.to), recipient: maskedEmail(email.to),
      timeZone: this.config.timeZone, reminderHour: email.reminderHour, reminderMinute: email.reminderMinute,
      testAvailableAt: attempt ? Number(attempt.attempted_at) + testCooldown : 0,
      recent: recent.map(row => ({ kind: row.kind as "test" | "reminder", name: String(row.name), status: row.status as DeliveryState, updatedAt: Number(row.time), error: row.error ? String(row.error) : null })) };
  }

  private async track<T>(pending: Promise<T>): Promise<T> {
    this.inFlight.add(pending);
    try { return await pending; } finally { this.inFlight.delete(pending); }
  }

  /** Wait for pending SMTP work before the caller closes SQLite. */
  async drain(): Promise<void> { await Promise.allSettled([...this.inFlight]); }

  /** Persist a one-minute test cooldown before contacting SMTP, including across process restarts. */
  sendTest(user: number): Promise<void> { return this.track(this.sendTestInternal(user)); }

  private async sendTestInternal(user: number): Promise<void> {
    this.authorize(user);
    if (!this.config.email.password) throw new ApiError(503, "邮件尚未配置，请在服务器运行邮件配置向导。", "EMAIL_NOT_CONFIGURED");
    const now = this.clock().getTime();
    transaction(this.db, () => {
      const last = this.db.prepare("SELECT attempted_at FROM email_test_attempts WHERE user_id=?").get(user);
      const wait = last ? Number(last.attempted_at) + testCooldown - now : 0;
      if (wait > 0) throw new ApiError(429, "测试邮件每分钟最多发送一次，请稍后再试。", "EMAIL_TEST_LIMIT", Math.ceil(wait / 1000));
      this.db.prepare(`INSERT INTO email_test_attempts(user_id,attempted_at,status) VALUES(?,?,'pending')
        ON CONFLICT(user_id) DO UPDATE SET attempted_at=excluded.attempted_at,status='pending',last_error=NULL`).run(user, now);
    });
    try {
      await this.sender.send(this.message("Gx404 会员提醒测试", `这是一封会员看板测试邮件。\n\n看板：${this.config.publicOrigin}\n你可以关闭网页，后端仍会按设置发送提醒。\n邮件服务器接受邮件不等于已进入收件箱，请同时检查垃圾邮件。`));
    } catch (error) {
      const safe = safeMailError(error);
      this.db.prepare("UPDATE email_test_attempts SET status=?,last_error=? WHERE user_id=? AND attempted_at=?").run(safe.uncertain ? "uncertain" : "failed", safe.message, user, now);
      throw new ApiError(502, safe.message, safe.uncertain ? "EMAIL_UNCERTAIN" : "EMAIL_SEND_FAILED");
    }
    this.db.prepare("UPDATE email_test_attempts SET status='sent',last_error=NULL WHERE user_id=? AND attempted_at=?").run(user, now);
  }

  /** Scan after the local reminder time, atomically claim unsent periods, and send a bounded digest. */
  sendDueReminders(now = this.clock()): Promise<number> { return this.track(this.sendDueInternal(now)); }

  private async sendDueInternal(now: Date): Promise<number> {
    if (!this.config.email.enabled) return 0;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: this.config.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
    const value = (name: string) => Number(parts.find(part => part.type === name)?.value ?? 0);
    if (value("hour") * 60 + value("minute") < this.config.email.reminderHour * 60 + this.config.email.reminderMinute) return 0;
    const owner = this.owner();
    if (!owner) return 0;
    const today = dateInTimeZone(now, this.config.timeZone), token = randomUUID();
    const candidates: Candidate[] = [];
    for (const item of this.subscriptions.list(owner).items) {
      const days = remaining(item, today);
      if (item.startDate <= today && days >= 0 && days <= item.reminderDays) candidates.push({ key: `${item.id}:${item.endDate}`, item, days });
      // Automatic renewal happens at midnight. Preserve same-day notifications for a zero-day lead.
      if (item.autoRenew && item.reminderDays === 0) {
        const log = this.db.prepare(`SELECT * FROM subscription_renewal_logs WHERE user_id=? AND subscription_id=? AND kind='automatic'
          AND previous_end_date=? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(owner, item.id, today);
        if (log) candidates.push({ key: `${item.id}:${today}`, days: 0, advanced: true, item: { ...item, name: String(log.subscription_name),
          startDate: String(log.previous_start_date), endDate: today, amount: log.amount_cents === null ? item.amount : Number(log.amount_cents) / 100 / Number(log.periods), currency: String(log.currency) as Subscription["currency"] } });
      }
    }
    const pending = transaction(this.db, () => {
      this.expireLeases(now.getTime());
      let claimed = 0;
      return candidates.filter(candidate => {
        if (claimed >= 100) return false;
        const result = this.db.prepare(`INSERT INTO email_notification_deliveries(user_id,notification_key,channel,subscription_id,end_date,reminder_days,status,attempts,created_at,updated_at,claim_token)
          VALUES(?,?,'email',?,?,?,'pending',1,?,?,?) ON CONFLICT(user_id,notification_key,channel) DO UPDATE SET
          status='pending',attempts=attempts+1,last_error=NULL,updated_at=excluded.updated_at,claim_token=excluded.claim_token,next_attempt_at=NULL
          WHERE status='failed' AND attempts<5 AND next_attempt_at IS NOT NULL AND next_attempt_at<=excluded.updated_at`)
          .run(owner, candidate.key, candidate.item.id, candidate.item.endDate, candidate.item.reminderDays, now.getTime(), now.getTime(), token);
        if (Number(result.changes) !== 1) return false;
        claimed++;
        return true;
      });
    });
    if (!pending.length) return 0;
    try { await this.sender.send(this.message(`Gx404 会员提醒：${pending.length} 项订阅待关注`, this.body(pending, today))); }
    catch (error) {
      const safe = safeMailError(error);
      transaction(this.db, () => {
        for (const candidate of pending) {
          const row = this.db.prepare("SELECT attempts FROM email_notification_deliveries WHERE user_id=? AND notification_key=? AND claim_token=?").get(owner, candidate.key, token);
          const delay = retryMinutes[Number(row?.attempts) - 1];
          const next = safe.retryable && delay ? now.getTime() + delay * 60_000 : null;
          this.db.prepare("UPDATE email_notification_deliveries SET status=?,last_error=?,next_attempt_at=? WHERE user_id=? AND notification_key=? AND claim_token=?")
            .run(safe.uncertain ? "uncertain" : "failed", safe.message, next, owner, candidate.key, token);
        }
      });
      throw new Error(safe.message);
    }
    // Keep post-acceptance database failures out of the SMTP retry path. Stale claims become uncertain.
    transaction(this.db, () => {
      for (const candidate of pending) this.db.prepare("UPDATE email_notification_deliveries SET status='sent',sent_at=?,last_error=NULL,next_attempt_at=NULL WHERE user_id=? AND notification_key=? AND claim_token=?")
        .run(now.getTime(), owner, candidate.key, token);
    });
    return pending.length;
  }

  private message(subject: string, text: string): MailMessage {
    return { from: this.config.email.from, to: this.config.email.to, subject, text };
  }

  private body(items: Candidate[], today: string): string {
    return ["Gx404 会员到期提醒", `检查日期：${today}（${this.config.timeZone}）`, "",
      ...items.sort((a, b) => a.days - b.days).flatMap(({ item, days, advanced }) => [
        `• ${item.name}${item.plan ? `（${item.plan}）` : ""}`,
        `  ${advanced ? "原账期今日结束，看板已自动进入下一期" : `到期：${item.endDate}（${days === 0 ? "今天" : `${days} 天后`}）`}`,
        `  金额：${money(item.amount, item.currency)} · ${item.autoRenew ? "自动续费" : "手动续费"}`, "",
      ]), "本邮件只作提醒，不代表平台已扣款。", `看板：${this.config.publicOrigin}`].join("\n");
  }
}
