import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, RotateCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { apiRequest } from "@/lib/api";
import { ContextHelp } from "@/components/context-help";
import { EmailSettingsForm } from "@/components/email-settings-form";
import type { EmailStatus } from "../../../shared/notifications.ts";

const stateLabel = { pending: "发送中", sent: "已提交", failed: "发送失败", uncertain: "待核实" };

/** Owner-only settings and delivery status; tests only send after an explicit click. */
export function EmailReminders({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(false);
  const inFlight = useRef(false);
  const load = useCallback(async () => {
    try { const value = await apiRequest<EmailStatus>("/notifications/status"); if (alive.current) { setStatus(value); setNow(Date.now()); setError(""); } }
    catch (error) { if (alive.current) setError(error instanceof Error ? error.message : "邮件状态加载失败"); }
  }, []);
  useEffect(() => {
    alive.current = true; void load();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { alive.current = false; clearInterval(timer); };
  }, [load]);
  const send = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setSending(true);
    try {
      await apiRequest("/notifications/test", {});
      if (alive.current) toast.success("测试邮件已提交", { description: "请检查收件箱和垃圾邮件；是否通知由 QQ 邮箱客户端设置决定。" });
    } catch (error) { if (alive.current) toast.error(error instanceof Error ? error.message : "测试发送失败"); }
    finally { inFlight.current = false; if (alive.current) { setSending(false); await load(); } }
  };
  const cooldown = Math.max(0, Math.ceil(((status?.testAvailableAt ?? 0) - now) / 1000));
  return <section className="email-reminders" aria-label="邮件提醒">
    <div className="email-reminder-heading"><strong><Mail size={17} />邮件提醒</strong>
      <ContextHelp label="邮件提醒说明"><p>后台按每条订阅的提前天数提醒，不需要开着网页。同一到期日成功提交后不再重复发送；汇总邮件不含私人备注。</p><p>连接失败会间隔重试，最多 5 次；提交结果不明或进程中断会标为待核实，避免盲目重发。已提交不代表已进入收件箱。</p><p>点击“配置”可设置邮箱、授权码和提醒时间，保存后立即生效。授权码不会回显，也不会放入 JSON 订阅备份。保存配置不会发送测试邮件。</p></ContextHelp>
      <button type="button" className="button light email-settings-toggle" aria-label={configuring ? "收起邮件配置" : "配置邮件提醒"} aria-expanded={configuring} disabled={sending || savingSettings} onClick={() => setConfiguring(value => !value)}><Settings2 size={14} />{configuring ? "收起" : "配置"}</button>
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="email-reminder-controls"><span>{status ? status.configured ? `${status.recipient} · ${status.enabled ? `每日 ${String(status.reminderHour).padStart(2, "0")}:${String(status.reminderMinute).padStart(2, "0")}` : "自动提醒已暂停"}` : "尚未配置" : "正在读取设置…"}</span>
      <button type="button" className="icon-button" aria-label="刷新邮件状态" disabled={savingSettings} onClick={() => void load()}><RotateCw size={16} /></button>
      <button type="button" className="button secondary" disabled={!status?.configured || sending || savingSettings || configuring || cooldown > 0} onClick={() => void send()}>{sending ? "发送中…" : cooldown ? `${cooldown} 秒后可重试` : "发送测试邮件"}</button>
    </div>
    {configuring && <EmailSettingsForm onCancel={() => setConfiguring(false)} onSaved={() => { setConfiguring(false); void load(); toast.success("邮件配置已保存并生效"); }} onBusyChange={busy => { setSavingSettings(busy); onBusyChange?.(busy); }} />}
    {!!status?.recent.length && <details className="email-results"><summary>最近发送记录</summary><ul>{status.recent.map((item, index) => <li key={`${item.kind}-${item.updatedAt}-${index}`}><span>{item.name} · {stateLabel[item.status]}</span><time dateTime={new Date(item.updatedAt).toISOString()}>{new Date(item.updatedAt).toLocaleString("zh-CN", { timeZone: status.timeZone })}</time>{item.error && <small role="status">{item.error}</small>}</li>)}</ul></details>}
  </section>;
}
