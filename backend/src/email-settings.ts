import { readFileSync, statSync } from "node:fs";

const allowed = new Set(["EMAIL_NOTIFICATIONS", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASSWORD", "EMAIL_FROM", "EMAIL_TO", "EMAIL_REMINDER_HOUR", "EMAIL_REMINDER_MINUTE"]);

/** Read an optional private JSON file; nonempty environment values take precedence. */
export function emailEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!env.EMAIL_CONFIG_FILE) return env;
  let saved: Record<string, string>;
  try {
    const stat = statSync(env.EMAIL_CONFIG_FILE);
    if (!stat.isFile() || stat.size > 16_384) throw new Error("invalid file");
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) throw new Error("insecure permissions");
    const value: unknown = JSON.parse(readFileSync(env.EMAIL_CONFIG_FILE, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.entries(value).some(([key, item]) => !allowed.has(key) || typeof item !== "string")) throw new Error("invalid content");
    saved = value as Record<string, string>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return env;
    throw new Error("邮件配置文件读取失败，请检查 JSON 格式和 600 文件权限。授权码不会写入日志。");
  }
  return { ...saved, ...Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined && value !== "")) };
}
