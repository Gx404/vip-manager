import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";
import { assertPasswordLength } from "./password-policy.ts";
import { emailEnvironment } from "./email-settings.ts";

export type Config = {
  host: string; port: number; databasePath: string; publicOrigin: string;
  cookieSecure: boolean; trustProxy: boolean; trustedProxyRanges: string[]; timeZone: string; publicDashboard: boolean;
  adminUsername: string; adminPassword?: string; sessionSeconds: number; email: EmailConfig;
};

export type EmailConfig = {
  enabled: boolean; host: string; port: number; secure: boolean;
  username: string; password?: string; from: string; to: string;
  reminderHour: number; reminderMinute: number;
};

/** Parse server-only configuration; throws before opening a port if unsafe or invalid. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  env = emailEnvironment(env);
  const publicOrigin = env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173";
  const url = new URL(publicOrigin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== publicOrigin || url.username || url.password) {
    throw new Error("PUBLIC_ORIGIN 必须是无路径、无尾部斜杠的 http(s) 网站地址。");
  }
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT 必须是 1–65535 的整数。");
  const boolean = (name: string, fallback: boolean) => {
    const value = env[name];
    if (value === undefined || (value === "" && ["EMAIL_NOTIFICATIONS", "SMTP_SECURE"].includes(name))) return fallback;
    if (!["true", "false"].includes(value)) throw new Error(name + " 必须是 true 或 false。");
    return value === "true";
  };
  const timeZone = env.APP_TIMEZONE ?? "Asia/Shanghai";
  new Intl.DateTimeFormat("en-CA", { timeZone }).format();
  const adminUsername = env.ADMIN_USERNAME ?? "admin";
  if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(adminUsername)) throw new Error("管理员账号应为 3–60 位字母、数字或 _.-。");
  if (env.ADMIN_PASSWORD) assertPasswordLength(env.ADMIN_PASSWORD, "初始管理员密码");
  const emailEnabled = boolean("EMAIL_NOTIFICATIONS", false);
  const emailHost = env.SMTP_HOST || "smtp.qq.com";
  if (!emailHost || /[\r\n\s]/.test(emailHost)) throw new Error("SMTP_HOST 不是有效的服务器地址。");
  const emailPort = Number(env.SMTP_PORT || "465");
  if (!Number.isInteger(emailPort) || emailPort < 1 || emailPort > 65535) throw new Error("SMTP_PORT 必须是 1–65535 的整数。");
  const emailSecure = boolean("SMTP_SECURE", true);
  const emailUsername = env.SMTP_USER ?? "";
  const emailPassword = env.SMTP_PASSWORD;
  const emailFrom = env.EMAIL_FROM || emailUsername;
  const emailTo = env.EMAIL_TO || emailUsername;
  const emailAddress = (value: string) => /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value);
  if ((emailEnabled || emailPassword) && (!emailUsername || !emailPassword || !emailAddress(emailUsername) || !emailAddress(emailFrom) || !emailAddress(emailTo))) {
    throw new Error("启用邮件提醒需要配置 SMTP_USER、SMTP_PASSWORD、EMAIL_FROM 和 EMAIL_TO；密码不会写入日志。");
  }
  if ((emailEnabled || emailPassword) && !emailSecure) throw new Error("邮件提醒要求 SMTP_SECURE=true，避免授权码以明文传输。");
  const emailReminderHour = Number(env.EMAIL_REMINDER_HOUR || "9");
  const emailReminderMinute = Number(env.EMAIL_REMINDER_MINUTE || "0");
  if (!Number.isInteger(emailReminderHour) || emailReminderHour < 0 || emailReminderHour > 23) throw new Error("EMAIL_REMINDER_HOUR 必须是 0–23 的整数。");
  if (!Number.isInteger(emailReminderMinute) || emailReminderMinute < 0 || emailReminderMinute > 59) throw new Error("EMAIL_REMINDER_MINUTE 必须是 0–59 的整数。");
  const trustedProxyRanges = (env.TRUSTED_PROXY_RANGES ?? "loopback,linklocal,uniquelocal").split(",").map(value => value.trim());
  if (!trustedProxyRanges.length || trustedProxyRanges.some(value => {
    if (["loopback", "linklocal", "uniquelocal"].includes(value)) return false;
    const [address, mask, extra] = value.split("/");
    const family = isIP(address);
    return !family || extra !== undefined || (mask !== undefined && (!/^\d+$/.test(mask) || Number(mask) < 1 || Number(mask) > (family === 4 ? 32 : 128)));
  })) throw new Error("TRUSTED_PROXY_RANGES 必须是可信代理 IP/CIDR 或 loopback、linklocal、uniquelocal；不允许信任所有公网地址。");
  return {
    host: env.HOST ?? "127.0.0.1", port, publicOrigin, timeZone, adminUsername,
    adminPassword: env.ADMIN_PASSWORD,
    databasePath: env.DATABASE_PATH ? resolve(env.DATABASE_PATH) : fileURLToPath(new URL("../../data/memberships.sqlite", import.meta.url)),
    cookieSecure: boolean("COOKIE_SECURE", true), trustProxy: boolean("TRUST_PROXY", false), trustedProxyRanges,
    publicDashboard: boolean("PUBLIC_DASHBOARD", false),
    email: { enabled: emailEnabled, host: emailHost, port: emailPort, secure: emailSecure, username: emailUsername,
      password: emailPassword, from: emailFrom, to: emailTo, reminderHour: emailReminderHour, reminderMinute: emailReminderMinute },
    sessionSeconds: 7 * 24 * 60 * 60,
  };
}

/** Return startup warnings without logging from configuration parsing or backup tools. */
export function configurationWarnings(config: Config): string[] {
  const hostname = new URL(config.publicOrigin).hostname;
  return !config.trustProxy && !["localhost", "127.0.0.1", "[::1]"].includes(hostname)
    ? ["TRUST_PROXY 未开启：反向代理可能使登录请求共用一个地址。请配置可信代理网段并开启 TRUST_PROXY；不要直接信任客户端转发头。"] : [];
}
