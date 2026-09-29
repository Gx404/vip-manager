import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root=fileURLToPath(new URL("../",import.meta.url));
let children=[];
let closing=false;
/** Launch separate API and frontend processes; no login or database belongs to the frontend. */
function launch(args,cwd,env) {
  const child=spawn(process.execPath,args,{cwd,env,stdio:"inherit",windowsHide:true});
  child.on("error",error=>{console.error("启动失败：",error.message);stop(1);});
  child.on("exit",code=>{if(!closing)stop(code??1);});
  children.push(child);
  return child;
}
function stop(code=0) {
  if(closing)return;
  closing=true;
  process.exitCode=code;
  for(const child of children){try{if(child.exitCode===null)child.kill("SIGTERM");}catch{console.error("子进程关闭失败，请关闭对应终端。");}}
}
process.on("SIGINT",()=>stop());
process.on("SIGTERM",()=>stop());
try {
  if(!existsSync(join(root,".env")))throw new Error("请先复制 .env.example 为 .env，并设置至少 16 位的 ADMIN_PASSWORD。");
  loadEnvFile(join(root,".env"));
  const backendEnv={...process.env,NODE_ENV:"development",HOST:"127.0.0.1",PORT:"3000",PUBLIC_ORIGIN:"http://127.0.0.1:5173",COOKIE_SECURE:"false",TRUST_PROXY:"false",DATABASE_PATH:join(root,"backend/data/development.sqlite")};
  launch([join(root,"backend/src/index.ts")],root,backendEnv);
  let healthy=false;
  for(let attempt=0;attempt<60&&!closing;attempt++){
    try{healthy=(await fetch("http://127.0.0.1:3000/api/health",{signal:AbortSignal.timeout(500)})).ok;}catch{healthy=false;}
    if(healthy)break;
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(!healthy||closing)throw new Error("后端未正常启动，请查看上方错误或检查 3000 端口。");
  const frontendEnv={...process.env};
  for(const key of ["ADMIN_PASSWORD","DATABASE_PATH","ADMIN_USERNAME"])delete frontendEnv[key];
  launch([join(root,"node_modules/vite/bin/vite.js"),"--host","127.0.0.1"],join(root,"frontend"),frontendEnv);
  console.log("前端：http://127.0.0.1:5173   后端：http://127.0.0.1:3000");
}catch(error){console.error(error instanceof Error?error.message:"启动失败");stop(1);}
