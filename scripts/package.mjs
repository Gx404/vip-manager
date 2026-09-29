import { cp, mkdir, mkdtemp, rm, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root=fileURLToPath(new URL("../",import.meta.url));
const outputs=join(root,"outputs");
let staging;
/** Assemble a credential-free source release, including built frontend when available. */
try {
  await mkdir(outputs,{recursive:true});
  staging=await mkdtemp(join(outputs,"stage-"));
  const release=join(staging,"gx404-memberships-server");
  await mkdir(release);
  const allowed=new Set(["frontend","backend","shared","docs","scripts",".github","package.json","package-lock.json","README.md","SECURITY.md","CONTRIBUTING.md","CHANGELOG.md","THIRD_PARTY_NOTICES.md","LICENSE","compose.yaml",".env.example",".gitignore",".gitattributes",".dockerignore","启动前后端.bat"]);
  for(const entry of await readdir(root,{withFileTypes:true})) {
    if(!allowed.has(entry.name))continue;
    await cp(join(root,entry.name),join(release,entry.name),{
      recursive:true,
      filter:source=>!source.split(/[\\/]/).some(part=>["node_modules","data","backups",".git"].includes(part))&&!/\.env(?:\.(?!example$).*)?$/.test(source.split(/[\\/]/).at(-1))&&!/\.(?:sqlite(?:-\w+)?|db(?:-\w+)?|pem|key|p12|pfx|log|tsbuildinfo)$/i.test(source),
    });
  }
  const archive=join(outputs,"gx404-memberships-server-"+new Date().toISOString().replace(/[:.]/g,"-")+".zip");
  const args=process.platform==="win32"?["-a","-cf",archive,"-C",staging,"gx404-memberships-server"]:["-r",archive,"gx404-memberships-server"];
  const command=process.platform==="win32"?join(process.env.SystemRoot||"C:/Windows","System32/tar.exe"):"zip";
  await new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:staging,stdio:"inherit",windowsHide:true});
    child.on("error",reject);
    child.on("exit",code=>code===0?resolve():reject(new Error("打包命令退出码："+code)));
  });
  console.log(archive);
}catch(error){console.error("打包失败：",error instanceof Error?error.message:"未知错误");process.exitCode=1;}
finally{if(staging&&dirname(resolve(staging))===resolve(outputs)){try{await rm(staging,{recursive:true,force:true});}catch{console.error("临时打包目录未能清理："+staging);}}}
