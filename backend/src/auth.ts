import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.ts";
import { ApiError } from "./errors.ts";
import { transaction } from "./database.ts";
import { assertPasswordLength, PASSWORD_MIN_LENGTH } from "./password-policy.ts";

const scryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, scryptOptions, (error, key) => error ? reject(error) : resolve(key));
});

/** Hash a password using a unique random salt; never persist plaintext passwords. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return "scrypt:" + salt + ":" + (await derive(password, salt)).toString("hex");
}

/** Constant-time hash comparison for passwords created by hashPassword. */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, salt, digest] = encoded.split(":");
  if (scheme !== "scrypt" || !/^[a-f0-9]{32}$/.test(salt ?? "") || !/^[a-f0-9]{128}$/.test(digest ?? "")) return false;
  return timingSafeEqual(await derive(password, salt), Buffer.from(digest, "hex"));
}

export const digestToken = (token: string) => createHash("sha256").update(token).digest("hex");
export type User = { id: number; username: string };

/** Normalize IPv4-mapped peers so the same client cannot get separate IPv4/IPv6 buckets. */
export function normalizeClientIp(ip: string): string { return ip.trim().toLowerCase().replace(/^::ffff:/, ""); }
export function isLoopbackIp(ip: string): boolean { return ip === "::1" || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(ip); }
/** A username cannot lock every other account sharing its client/proxy address. */
export function loginAttemptKey(ip: string, username: string): string { return digestToken(`${normalizeClientIp(ip)}:${username}`); }

/** Bootstrap a single owner only on an empty database; environment changes never reset passwords. */
export async function bootstrapAdmin(db: DatabaseSync, config: Config): Promise<void> {
  if (db.prepare("SELECT id FROM users LIMIT 1").get()) return;
  if (!config.adminPassword) throw new Error(`首次启动必须配置 ADMIN_PASSWORD（至少 ${PASSWORD_MIN_LENGTH} 个字符）。`);
  assertPasswordLength(config.adminPassword, "初始管理员密码");
  const hash = await hashPassword(config.adminPassword);
  db.prepare("INSERT INTO users (username,password_hash,created_at) VALUES (?,?,?)").run(config.adminUsername, hash, Date.now());
}

/** Persistent composite login limits with bounded password work and short loopback recovery. */
export class AuthService {
  private db: DatabaseSync;
  private config: Config;
  private clock: () => number;
  private pending = 0;
  private warnedLoopback = false;
  constructor(db: DatabaseSync, config: Config, clock: () => number = Date.now) { this.db = db; this.config = config; this.clock = clock; }

  async login(username: string, password: string, ip: string): Promise<{ token: string; user: User }> {
    const now = this.clock();
    const loopback = isLoopbackIp(normalizeClientIp(ip));
    const windowMs = loopback ? 30_000 : 900_000;
    if (loopback && !this.warnedLoopback) {
      this.warnedLoopback = true;
      console.warn("登录来源为回环地址：使用 30 秒短限流窗口。若经过反向代理，请检查 TRUST_PROXY、可信代理网段和 X-Forwarded-For 传递；不会自动信任转发头。");
    }
    const key = loginAttemptKey(ip, username);
    this.db.prepare("DELETE FROM login_attempts WHERE expires_at<=?").run(now);
    const limit = this.db.prepare("SELECT failures,expires_at FROM login_attempts WHERE key=?").get(key);
    if (limit && Number(limit.expires_at) > now && Number(limit.failures) >= 10) {
      const seconds = Math.max(1, Math.ceil((Number(limit.expires_at) - now) / 1000));
      throw new ApiError(429, `尝试次数过多，请 ${seconds} 秒后再试。`, "RATE_LIMITED", seconds);
    }
    if (this.pending >= 2) throw new ApiError(429, "登录校验繁忙，请稍后重试。", "LOGIN_BUSY", 1);
    if (!limit && Number(this.db.prepare("SELECT count(*) AS count FROM login_attempts").get()?.count) >= 10_000) {
      throw new ApiError(429, "登录请求较多，请稍后重试。", "LOGIN_BUSY", 30);
    }
    // Reserve an attempt before awaiting scrypt, so parallel requests cannot bypass the limit.
    this.db.prepare(`INSERT INTO login_attempts(key,failures,expires_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN expires_at<=? THEN 1 ELSE failures+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`)
      .run(key, now + windowMs, now, now);
    const owner = this.db.prepare("SELECT id,username,password_hash FROM users ORDER BY id LIMIT 1").get();
    this.pending++;
    let verified: boolean;
    try { verified = owner ? await verifyPassword(password, String(owner.password_hash)) : false; }
    finally { this.pending--; }
    if (!owner || String(owner.username) !== username || !verified) throw new ApiError(401, "账号或密码不正确。", "INVALID_CREDENTIALS");
    const token = randomBytes(32).toString("base64url");
    transaction(this.db, () => {
      this.db.prepare("DELETE FROM login_attempts WHERE key=? OR expires_at<=?").run(key, now);
      this.db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now);
      this.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)").run(digestToken(token), Number(owner.id), now + this.config.sessionSeconds * 1000);
    });
    return { token, user: { id: Number(owner.id), username: String(owner.username) } };
  }

  session(token: string): User | null {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = this.db.prepare(`SELECT users.id,users.username FROM sessions JOIN users ON users.id=sessions.user_id
      WHERE sessions.token_hash=? AND sessions.expires_at>?`).get(digestToken(token), Date.now());
    return row ? { id: Number(row.id), username: String(row.username) } : null;
  }

  logout(token: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digestToken(token));
  }
}
