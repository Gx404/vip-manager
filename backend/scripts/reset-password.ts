import { readFileSync } from "node:fs";
import { readConfig } from "../src/config.ts";
import { openDatabase,transaction } from "../src/database.ts";
import { hashPassword } from "../src/auth.ts";
import type { DatabaseSync } from "node:sqlite";

let db:DatabaseSync|undefined;
try {
  const password=readFileSync(0,"utf8").replace(/\r?\n$/,"");
  if(password.length<16||password.length>256)throw new Error("新密码必须为 16–256 字符，通过标准输入提供。");
  db=openDatabase(readConfig().databasePath);
  if(!db.prepare("SELECT id FROM users LIMIT 1").get())throw new Error("管理员尚未创建，请先正常启动服务。");
  const hash=await hashPassword(password);
  transaction(db,()=>{db!.prepare("UPDATE users SET password_hash=?").run(hash);db!.prepare("DELETE FROM sessions").run();});
  console.log("管理员密码已重置，所有旧登录会话已失效。");
} catch(error) {
  console.error("重置失败：",error instanceof Error?error.message:"未知错误");
  process.exitCode=1;
} finally {try{db?.close();}catch{console.error("数据库关闭失败。");process.exitCode=1;}}
