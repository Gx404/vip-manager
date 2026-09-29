import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "./config.ts";
import { ApiError } from "./errors.ts";
import { transaction } from "./database.ts";

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

/** Bootstrap a single owner only on an empty database; environment changes never reset passwords. */
export async function bootstrapAdmin(db: DatabaseSync, config: Config): Promise<void> {
  if (db.prepare("SELECT id FROM users LIMIT 1").get()) return;
  if (!config.adminPassword) throw new Error("首次启动必须配置 ADMIN_PASSWORD（至少 16 个字符）。");
  const hash = await hashPassword(config.adminPassword);
  db.prepare("INSERT INTO users (username,password_hash,created_at) VALUES (?,?,?)").run(config.adminUsername, hash, Date.now());
}

/** Persistent sessions and a persistent per-client login attempt limit. */
export class AuthService {
  private db: DatabaseSync;
  private config: Config;
  constructor(db: DatabaseSync, config: Config) { this.db = db; this.config = config; }

  async login(username: string, password: string, ip: string): Promise<{ token: string; user: User }> {
    const now = Date.now();
    const key = digestToken(ip);
    const limit = this.db.prepare("SELECT failures,expires_at FROM login_attempts WHERE key=?").get(key);
    if (limit && Number(limit.expires_at) > now && Number(limit.failures) >= 10) {
      throw new ApiError(429, "尝试次数过多，请 15 分钟后再试。", "RATE_LIMITED");
    }
    // Reserve an attempt before awaiting scrypt, so parallel requests cannot bypass the limit.
    this.db.prepare(`INSERT INTO login_attempts(key,failures,expires_at) VALUES(?,1,?)
      ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN expires_at<=? THEN 1 ELSE failures+1 END,
      expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END`)
      .run(key, now + 900_000, now, now);
    const owner = this.db.prepare("SELECT id,username,password_hash FROM users ORDER BY id LIMIT 1").get();
    const verified = owner ? await verifyPassword(password, String(owner.password_hash)) : false;
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
