import { backup, DatabaseSync } from "node:sqlite";
import { mkdir, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.ts";

let db:DatabaseSync|undefined;
try {
  const config=readConfig();
  const output=process.argv[2]?resolve(process.argv[2]):join(dirname(config.databasePath),"backups","memberships-"+new Date().toISOString().replace(/[:.]/g,"-")+"-"+randomUUID().slice(0,8)+".sqlite");
  await mkdir(dirname(output),{recursive:true,mode:0o700});
  let exists=false;
  try { await access(output); exists=true; } catch(error) {
    if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;
  }
  if(exists)throw new Error("备份目标已存在，拒绝覆盖。");
  db=new DatabaseSync(config.databasePath,{readOnly:true});
  await backup(db,output);
  console.log(output);
} catch(error) {
  console.error("备份失败：",error instanceof Error?error.message:"未知错误");
  process.exitCode=1;
} finally { try {db?.close();}catch{console.error("数据库关闭失败。");process.exitCode=1;} }
