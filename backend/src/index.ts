import { readConfig } from "./config.ts";
import { openDatabase } from "./database.ts";
import { bootstrapAdmin } from "./auth.ts";
import { createApp } from "./app.ts";
import type { DatabaseSync } from "node:sqlite";

let db: DatabaseSync | undefined;
try {
  const config = readConfig();
  db = openDatabase(config.databasePath);
  await bootstrapAdmin(db,config);
  const server = createApp(db,config).listen(config.port,config.host,() => {
    console.log("Membership API listening on " + config.host + ":" + config.port);
  });
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;
  server.on("error", error => {
    console.error("后端启动失败：",error.message);
    try { db?.close(); } catch { console.error("数据库关闭失败。"); }
    process.exitCode=1;
  });
  let stopping=false;
  const stop = () => {
    if (stopping) return;
    stopping=true;
    const timer=setTimeout(() => { server.closeAllConnections(); },10_000);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      try { db?.close(); } catch { console.error("数据库关闭失败。"); process.exitCode=1; }
    });
  };
  process.on("SIGINT",stop);
  process.on("SIGTERM",stop);
} catch (error) {
  console.error("启动失败：",error instanceof Error ? error.message : "未知错误");
  try { db?.close(); } catch { console.error("数据库关闭失败。"); }
  process.exitCode=1;
}
