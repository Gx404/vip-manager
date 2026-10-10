import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/** Open persistent SQLite and apply each checked-in schema migration exactly once. */
export function openDatabase(filename: string): DatabaseSync {
  let db: DatabaseSync | undefined;
  try {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    db = new DatabaseSync(filename, { enableForeignKeyConstraints: true, timeout: 5000 });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    const version = Number(db.prepare("PRAGMA user_version").get()?.user_version);
    const migrations = ["001_initial.sql", "002_automatic_renewals.sql", "003_subscription_history.sql", "004_multi_currency.sql", "005_purchase_rate_snapshots.sql", "006_email_notifications.sql", "007_subscription_categories.sql", "008_payment_ledger.sql"];
    if (version > migrations.length) throw new Error("数据库版本高于当前程序，请勿降级运行。");
    for (let index = version; index < migrations.length; index++) {
      const sql = readFileSync(new URL("../migrations/" + migrations[index], import.meta.url), "utf8");
      transaction(db, () => {
        db!.exec(sql);
        db!.exec("PRAGMA user_version = " + (index + 1));
      });
      db.exec("PRAGMA optimize");
    }
    return db;
  } catch (error) {
    try { db?.close(); } catch { /* Preserve the original open/migration error. */ }
    throw new Error("数据库打开或迁移失败，请检查文件权限与磁盘空间。", { cause: error });
  }
}

/** Execute related statements atomically. Rollback never masks the original failure. */
export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* Original exception is reported by the request boundary. */ }
    throw error;
  }
}
