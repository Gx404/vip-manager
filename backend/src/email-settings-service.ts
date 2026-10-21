import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, copyFileSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { EmailSettingsValue, EmailSettingsView } from "../../shared/notifications.ts";
import type { Config, EmailConfig } from "./config.ts";
import { ApiError } from "./errors.ts";

const address = z.string().trim().max(254).refine(value => !value || /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value));
const settingsSchema = z.object({
  enabled:z.boolean(), host:z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/),
  port:z.number().int().min(1).max(65535), username:address, from:address, to:address,
  reminderHour:z.number().int().min(0).max(23), reminderMinute:z.number().int().min(0).max(59),
  password:z.string().max(1024).optional(),
}).strict();
const inputSchema = z.object({revision:z.string().regex(/^[a-f0-9]{64}$/),settings:settingsSchema}).strict();
const names: Record<keyof EmailSettingsValue | "password", string> = {
  enabled:"EMAIL_NOTIFICATIONS",host:"SMTP_HOST",port:"SMTP_PORT",username:"SMTP_USER",password:"SMTP_PASSWORD",
  from:"EMAIL_FROM",to:"EMAIL_TO",reminderHour:"EMAIL_REMINDER_HOUR",reminderMinute:"EMAIL_REMINDER_MINUTE",
};

/** Owner-only, atomic private settings. Runtime objects update only after the file is replaced. */
export class EmailSettingsService {
  private readonly db: DatabaseSync;
  private readonly config: Config;
  private readonly revisionKey = randomBytes(32);
  constructor(db: DatabaseSync, config: Config) { this.db=db; this.config=config; }

  private authorize(user: number): void {
    const owner=this.db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get();
    if (!owner || Number(owner.id)!==user) throw new ApiError(403,"邮件设置仅供主管理员使用。","EMAIL_OWNER_REQUIRED");
  }
  private values(): EmailSettingsValue {
    const email=this.config.email;
    return {enabled:email.enabled,host:email.host,port:email.port,username:email.username,from:email.from,to:email.to,
      reminderHour:email.reminderHour,reminderMinute:email.reminderMinute};
  }
  private fingerprint(): string {
    const filename=this.config.emailSettings?.file;
    let file="";
    if (filename) {
      try {
        const stat=statSync(filename);
        if (!stat.isFile() || stat.size>16_384) throw new Error();
        file=readFileSync(filename,"utf8");
      } catch(error) { if((error as NodeJS.ErrnoException).code!=="ENOENT") throw new ApiError(503,"邮件配置读取失败，请检查服务器文件权限。","EMAIL_SETTINGS_UNAVAILABLE"); }
    }
    return createHmac("sha256",this.revisionKey).update(JSON.stringify({email:this.config.email,file})).digest("hex");
  }
  private locked(): EmailSettingsView["lockedFields"] {
    const overrides=this.config.emailSettings?.overrides ?? {};
    const locked=(Object.keys(names) as Array<keyof typeof names>).filter(name=>Boolean(overrides[names[name]]));
    // A server-managed secret must never be redirected to a different destination.
    if(overrides.SMTP_PASSWORD) for(const name of ["host","port","username"] as const) if(!locked.includes(name)) locked.push(name);
    return locked;
  }
  get(user: number): EmailSettingsView {
    this.authorize(user);
    return {...this.values(),passwordConfigured:Boolean(this.config.email.password),timeZone:this.config.timeZone,
      revision:this.fingerprint(),editable:Boolean(this.config.emailSettings?.file),lockedFields:this.locked()};
  }
  save(user: number, value: unknown): EmailSettingsView {
    this.authorize(user);
    const parsed=inputSchema.safeParse(value);
    if(!parsed.success) throw new ApiError(400,"邮件设置不正确，请检查邮箱、服务器和提醒时间。","INVALID_EMAIL_SETTINGS");
    const filename=this.config.emailSettings?.file;
    if(!filename) throw new ApiError(409,"服务器未启用邮件配置文件，请设置 EMAIL_CONFIG_FILE 后重启。","EMAIL_SETTINGS_READ_ONLY");
    const input=parsed.data;
    if(input.revision!==this.fingerprint()) throw new ApiError(409,"邮件设置已变化，请重新打开配置后再保存。","VERSION_CONFLICT");
    const current=this.values(), suppliedPassword=input.settings.password?.trim() ?? "";
    const {password:_password,...values}=input.settings;
    const normalized: EmailSettingsValue={...values,from:values.from || values.username,to:values.to || values.username};
    for(const name of this.locked()) {
      if(name==="password" ? Boolean(suppliedPassword && suppliedPassword!==this.config.email.password) : normalized[name]!==current[name]) {
        throw new ApiError(409,"部分邮件设置由服务器环境变量管理，请保持锁定字段不变。","EMAIL_SETTINGS_LOCKED");
      }
    }
    if(this.config.emailSettings?.overrides.SMTP_SECURE==="false") throw new ApiError(409,"服务器 SMTP_SECURE 必须启用，才能保存安全的邮件设置。","EMAIL_SETTINGS_LOCKED");
    const destinationChanged=normalized.host!==current.host || normalized.port!==current.port || normalized.username!==current.username;
    if(destinationChanged && this.config.email.password && !suppliedPassword) throw new ApiError(400,"更换邮箱或邮件服务器时，请重新填写 SMTP 授权码。","EMAIL_PASSWORD_REQUIRED");
    const password=suppliedPassword || this.config.email.password;
    if((normalized.enabled || password) && (!normalized.username || !normalized.from || !normalized.to || !password)) {
      throw new ApiError(400,"请填写邮箱地址和 SMTP 授权码后再启用邮件提醒。","EMAIL_PASSWORD_REQUIRED");
    }
    const next: EmailConfig={...normalized,password,secure:true};
    const settings: Record<string,string>={SMTP_SECURE:"true"};
    for(const name of Object.keys(names) as Array<keyof typeof names>) {
      settings[names[name]]=name==="password" ? password ?? "" : String(normalized[name]);
    }
    const temporary=filename+"."+randomUUID()+".tmp";
    try {
      mkdirSync(dirname(filename),{recursive:true,mode:0o700});
      writeFileSync(temporary,JSON.stringify(settings),{encoding:"utf8",mode:0o600,flag:"wx"});
      try { copyFileSync(filename,filename+".previous"); chmodSync(filename+".previous",0o600); }
      catch(error) { if((error as NodeJS.ErrnoException).code!=="ENOENT") throw error; }
      renameSync(temporary,filename);
    } catch {
      try { unlinkSync(temporary); } catch { /* Only remove this operation's private temporary file. */ }
      throw new ApiError(503,"邮件配置保存失败，请检查服务器文件权限，原设置仍然有效。","EMAIL_SETTINGS_WRITE_FAILED");
    }
    // SmtpMailer captures connection options synchronously at each send. Existing in-flight
    // sends retain their transport and message; future sends read this shared config object.
    Object.assign(this.config.email,next);
    return this.get(user);
  }
}
