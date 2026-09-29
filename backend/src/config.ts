import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Config = {
  host: string; port: number; databasePath: string; publicOrigin: string;
  cookieSecure: boolean; trustProxy: boolean; timeZone: string; publicDashboard: boolean;
  adminUsername: string; adminPassword?: string; sessionSeconds: number;
};

/** Parse server-only configuration; throws before opening a port if unsafe or invalid. */
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const publicOrigin = env.PUBLIC_ORIGIN ?? "http://127.0.0.1:5173";
  const url = new URL(publicOrigin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== publicOrigin || url.username || url.password) {
    throw new Error("PUBLIC_ORIGIN 必须是无路径、无尾部斜杠的 http(s) 网站地址。");
  }
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT 必须是 1–65535 的整数。");
  const boolean = (name: string, fallback: boolean) => {
    const value = env[name];
    if (value === undefined) return fallback;
    if (!["true", "false"].includes(value)) throw new Error(name + " 必须是 true 或 false。");
    return value === "true";
  };
  const timeZone = env.APP_TIMEZONE ?? "Asia/Shanghai";
  new Intl.DateTimeFormat("en-CA", { timeZone }).format();
  const adminUsername = env.ADMIN_USERNAME ?? "admin";
  if (!/^[a-zA-Z0-9_.-]{3,60}$/.test(adminUsername)) throw new Error("管理员账号应为 3–60 位字母、数字或 _.-。");
  if (env.ADMIN_PASSWORD && (env.ADMIN_PASSWORD.length < 16 || env.ADMIN_PASSWORD.length > 256)) {
    throw new Error("初始管理员密码必须为 16–256 个字符。");
  }
  return {
    host: env.HOST ?? "127.0.0.1", port, publicOrigin, timeZone, adminUsername,
    adminPassword: env.ADMIN_PASSWORD,
    databasePath: env.DATABASE_PATH ? resolve(env.DATABASE_PATH) : fileURLToPath(new URL("../../data/memberships.sqlite", import.meta.url)),
    cookieSecure: boolean("COOKIE_SECURE", true), trustProxy: boolean("TRUST_PROXY", false),
    publicDashboard: boolean("PUBLIC_DASHBOARD", false),
    sessionSeconds: 7 * 24 * 60 * 60,
  };
}
