import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import nodemailer from "nodemailer";
import { readConfig } from "../src/config.ts";
import { SmtpMailer, safeMailError, type MailMessage } from "../src/email.ts";

const env = { SMTP_USER:"owner@qq.com", SMTP_PASSWORD:"test-only-secret", EMAIL_FROM:"", EMAIL_TO:"", EMAIL_NOTIFICATIONS:"true" };
const message: MailMessage = { from:"owner@qq.com", to:"owner@qq.com", subject:"会员到期提醒", text:"百度网盘将在七天后到期。" };

test("邮件默认关闭，空地址回退到发件邮箱，禁止明文及地址注入", () => {
  assert.equal(readConfig({}).email.enabled, false);
  assert.equal(readConfig(env).email.to, "owner@qq.com");
  assert.throws(() => readConfig({ ...env, SMTP_SECURE:"false" }), /SMTP_SECURE/);
  assert.throws(() => readConfig({ ...env, EMAIL_TO:"owner@qq.com\r\nBcc:other@example.com" }));
  assert.throws(() => readConfig({ ...env, SMTP_PORT:"0" }));
  assert.throws(() => readConfig({ ...env, EMAIL_REMINDER_HOUR:"24" }));
});

test("私有文件读取与显式环境覆盖；损坏文件不回显授权码", async t => {
  const folder = await mkdtemp(join(tmpdir(), "vip-mail-settings-"));
  t.after(() => rm(folder, { recursive:true, force:true, maxRetries:3, retryDelay:100 }));
  const filename = join(folder, "email.json");
  await writeFile(filename, JSON.stringify(env), { mode:0o600 });
  assert.equal(readConfig({ EMAIL_CONFIG_FILE:filename, SMTP_USER:"", EMAIL_NOTIFICATIONS:"" }).email.enabled, true);
  assert.equal(readConfig({ EMAIL_CONFIG_FILE:filename, EMAIL_NOTIFICATIONS:"false" }).email.enabled, false);
  await writeFile(filename, "test-only-secret");
  assert.throws(() => readConfig({ EMAIL_CONFIG_FILE:filename }), error => error instanceof Error && !error.message.includes("test-only-secret"));
  assert.equal(readConfig({ EMAIL_CONFIG_FILE:join(folder,"absent") }).email.enabled, false);
});

test("传输强制 TLS 验证、禁用协议日志及外部内容，关闭资源", async () => {
  let closed = false;
  const mailer = new SmtpMailer(readConfig(env).email, options => {
    assert.equal(options.secure, true); assert.equal(options.tls?.rejectUnauthorized, true);
    assert.equal(options.tls?.minVersion, "TLSv1.2"); assert.equal(options.logger, false); assert.equal(options.debug, false);
    assert.equal(options.disableFileAccess, true); assert.equal(options.disableUrlAccess, true);
    return { sendMail:async mail => { assert.deepEqual(mail, message); return { accepted:[mail.to], rejected:[] }; }, close:() => { closed = true; } };
  });
  await mailer.send(message); assert.ok(closed);
  await assert.rejects(mailer.send({ ...message, to:"owner@qq.com\r\nRCPT TO:<other@example.com>" }));
  const error = safeMailError(Object.assign(new Error("test-only-secret"), { code:"EAUTH" }));
  assert.equal(error.retryable, false); assert.ok(!String(error).includes("test-only-secret"));
});

test("真实 SMTP 协议：多行 EHLO、中文 MIME、接受 DATA 后断开仍成功", async t => {
  // Only this loopback fixture is plaintext. Production options are asserted above and stay TLS-only.
  let wire = "", completed = false;
  const server = createServer(socket => {
    socket.on("error", () => undefined);
    socket.write("220 fixture ESMTP\r\n");
    let buffer = "", data = false;
    socket.on("data", chunk => {
      buffer += chunk.toString();
      let index: number;
      while ((index = buffer.indexOf("\r\n")) >= 0) {
        const line = buffer.slice(0,index); buffer = buffer.slice(index+2);
        if (data) {
          if (line === ".") { completed = true; data = false; socket.end("250 accepted\r\n"); }
          else wire += line + "\r\n";
        } else if (line.startsWith("EHLO")) socket.write("250-fixture\r\n250 AUTH PLAIN\r\n");
        else if (line.startsWith("AUTH")) socket.write("235 authenticated\r\n");
        else if (line.startsWith("MAIL FROM") || line.startsWith("RCPT TO")) socket.write("250 ok\r\n");
        else if (line === "DATA") { data = true; socket.write("354 proceed\r\n"); }
        else socket.write("500 unexpected\r\n");
      }
    });
  });
  server.listen(0,"127.0.0.1");
  await new Promise<void>((resolve,reject) => { server.once("listening",resolve); server.once("error",reject); });
  t.after(() => new Promise<void>((resolve,reject) => server.close(error => error ? reject(error) : resolve())));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const mailer = new SmtpMailer(readConfig(env).email, options => nodemailer.createTransport({ ...options, host:"127.0.0.1", port:address.port, secure:false, ignoreTLS:true }));
  await mailer.send(message);
  assert.ok(completed); assert.match(wire, /Subject: =\?UTF-8\?/i);
  assert.match(wire, /charset=utf-8/i); assert.ok(!wire.includes("test-only-secret"));
});

test("总时限关闭在途传输，结果未确认不作为可安全重试", async t => {
  t.mock.timers.enable({ apis:["setTimeout"] });
  let closed = false;
  const mailer = new SmtpMailer(readConfig(env).email, () => ({ sendMail:() => new Promise(() => undefined), close:() => { closed = true; } }));
  const pending = mailer.send(message);
  t.mock.timers.tick(12_000);
  await assert.rejects(pending, { uncertain:true, retryable:false });
  assert.ok(closed);
});
