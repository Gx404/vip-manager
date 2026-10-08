import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { mkdir, writeFile, rename, copyFile, chmod, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.ts";
import { SmtpMailer, safeMailError } from "../src/email.ts";

let muted = false;
let temporary: string | undefined;
const output = new Writable({ write(chunk, _encoding, callback) { if (!muted) process.stdout.write(chunk); callback(); } });
const prompt = createInterface({ input: process.stdin, output, terminal: true });
const abort = new AbortController();
prompt.on("SIGINT", () => abort.abort());

try {
  if (!process.stdin.isTTY) throw new Error("请在自己的交互式 SSH 终端使用 docker compose exec backend 运行配置向导。");
  if (!process.env.EMAIL_CONFIG_FILE) throw new Error("未设置 EMAIL_CONFIG_FILE，请使用新版 Compose 配置。");
  console.log("QQ 邮箱提醒配置。授权码仅存服务器私有文件，不会回显。按 Ctrl+C 可取消。");
  const address = (await prompt.question("完整 QQ 邮箱地址（同时作为发件人和收件人）：", { signal: abort.signal })).trim();
  if (!/^[a-zA-Z0-9._-]+@qq\.com$/i.test(address)) throw new Error("请填写有效的 QQ 邮箱地址。");
  process.stdout.write("新生成的 SMTP 授权码（输入不可见）：");
  muted = true;
  const password = (await prompt.question("", { signal: abort.signal })).trim();
  muted = false; process.stdout.write("\n");
  if (!/^[a-zA-Z]{16}$/.test(password)) throw new Error("QQ SMTP 授权码应为 16 位字母，请重新检查。");
  const settings = { EMAIL_NOTIFICATIONS: "true", SMTP_HOST: "smtp.qq.com", SMTP_PORT: "465", SMTP_SECURE: "true",
    SMTP_USER: address, SMTP_PASSWORD: password, EMAIL_FROM: address, EMAIL_TO: address, EMAIL_REMINDER_HOUR: "9", EMAIL_REMINDER_MINUTE: "0" };
  for (const [key, value] of Object.entries(settings)) {
    if (process.env[key] && process.env[key] !== value) throw new Error(`环境变量 ${key} 覆盖了向导配置。请先清空该变量并重新创建容器，再运行向导。`);
  }
  const config = readConfig({ ...process.env, ...settings, EMAIL_CONFIG_FILE: "" });
  console.log("正在发送一封测试邮件…");
  try {
    await new SmtpMailer(config.email).send({ from: address, to: address, subject: "Gx404 会员提醒测试",
      text: `这是一封配置验证邮件。\n\n看板：${config.publicOrigin}\n\n配置完成并重启后，每天上午 9 点起按订阅设置发送到期提醒。请同时检查收件箱和垃圾邮件。` });
  } catch (error) { throw safeMailError(error); }
  const filename = resolve(process.env.EMAIL_CONFIG_FILE);
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  temporary = filename + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(settings), { encoding: "utf8", mode: 0o600, flag: "wx" });
  try { await copyFile(filename, filename + ".previous"); await chmod(filename + ".previous", 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("旧邮件配置备份失败，未覆盖原配置。"); }
  await rename(temporary, filename); temporary = undefined;
  console.log("测试邮件已获 QQ 邮件服务器接受，私有配置已保存。请检查收件箱，然后执行 docker compose restart backend 生效。");
} catch (error) {
  muted = false;
  if (abort.signal.aborted) console.error("\n已取消，未启用新的邮件设置。");
  else console.error("\n配置未完成：", (error as NodeJS.ErrnoException).code ? "终端或配置文件操作失败，请检查权限。" : error instanceof Error ? error.message : "未知错误");
  process.exitCode = 1;
} finally {
  muted = false; prompt.close(); output.end();
  if (temporary) { try { await unlink(temporary); } catch { console.error("临时文件清理失败，请检查数据目录。该文件权限为 600。"); } }
}
