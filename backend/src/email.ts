import nodemailer from "nodemailer";
import { Socket } from "node:net";
import type { SMTPTransportOptions } from "nodemailer/lib/smtp-transport";
import type { EmailConfig } from "./config.ts";

export type MailMessage = { from: string; to: string; subject: string; text: string; messageId?: string };
type Transport = { sendMail: (message: MailMessage) => Promise<{ accepted: unknown[]; rejected: unknown[] }>; close: () => void };
export type TransportFactory = (options: SMTPTransportOptions) => Transport;

/** Own the underlying socket so a total deadline closes active SMTP work too. */
const defaultTransport: TransportFactory = options => {
  const socket = new Socket();
  const transport = nodemailer.createTransport({ ...options, socket });
  return { sendMail: message => transport.sendMail(message), close: () => { socket.destroy(); transport.close(); } };
};

/** Safe delivery failure: never retain SMTP responses, credentials, or provider error text. */
export class MailDeliveryError extends Error {
  readonly uncertain: boolean;
  readonly retryable: boolean;
  constructor(message: string, uncertain = false, retryable = true) {
    super(message); this.uncertain = uncertain; this.retryable = retryable;
  }
}

/** Convert an untrusted SMTP error to a fixed, user-safe diagnosis. */
export function safeMailError(error: unknown): MailDeliveryError {
  if (error instanceof MailDeliveryError) return error;
  const detail = error as { code?: string; responseCode?: number; command?: string } | null;
  if (detail?.code === "EAUTH") return new MailDeliveryError("邮箱验证失败，请检查 SMTP 授权码。", false, false);
  if (detail?.command === "DATA" && !detail.responseCode) return new MailDeliveryError("邮件提交结果未确认，请先检查收件箱，避免重复发送。", true, false);
  if (detail?.responseCode && detail.responseCode >= 500) return new MailDeliveryError("邮件服务器拒收，请检查发件和收件设置。", false, false);
  return new MailDeliveryError("邮件服务连接或发送失败，请检查网络和 SMTP 设置。");
}

/** Send over verified TLS; completion means SMTP acceptance, not inbox delivery. */
export class SmtpMailer {
  private readonly config: EmailConfig;
  private readonly factory: TransportFactory;
  constructor(config: EmailConfig, factory: TransportFactory = defaultTransport) {
    this.config = config; this.factory = factory;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.config.password || !this.config.username || !this.config.secure) throw new MailDeliveryError("邮件发送尚未安全配置。", false, false);
    if ([message.from, message.to].some(value => !/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value))) throw new MailDeliveryError("邮箱地址格式不正确。", false, false);
    let transport: Transport | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      transport = this.factory({
        host: this.config.host, port: this.config.port, secure: true,
        auth: { user: this.config.username, pass: this.config.password },
        tls: { minVersion: "TLSv1.2", rejectUnauthorized: true },
        connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000, dnsTimeout: 5000,
        logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true,
      });
      const info = await Promise.race([
        transport.sendMail(message),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new MailDeliveryError("邮件发送超时，结果未确认，请先检查收件箱。", true, false)), 12_000);
        }),
      ]);
      if (!info.accepted.length || info.rejected.length) throw new MailDeliveryError("收件地址未获邮件服务器接受。", false, false);
    } catch (error) { throw safeMailError(error); }
    finally { if (timer) clearTimeout(timer); try { transport?.close(); } catch { /* Do not log sensitive transport errors. */ } }
  }
}
