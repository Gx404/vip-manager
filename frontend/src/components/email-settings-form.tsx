import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api";
import type { EmailSettingsValue, EmailSettingsView } from "../../../shared/notifications.ts";
import "./email-settings.css";

type Props = { onCancel: () => void; onSaved: () => void; onBusyChange: (busy: boolean) => void };

/** Edit server settings; the authorization code is only held for the current save. */
export function EmailSettingsForm({ onCancel, onSaved, onBusyChange }: Props) {
  const [settings, setSettings] = useState<EmailSettingsView | null>(null);
  const [draft, setDraft] = useState<EmailSettingsValue | null>(null);
  const [password, setPassword] = useState("");
  const [time, setTime] = useState("09:00");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(false), inFlight = useRef(false);

  const load = useCallback(async () => {
    setLoading(true); setError(""); setPassword("");
    try {
      const value = await apiRequest<EmailSettingsView>("/notifications/settings");
      if (!alive.current) return;
      setSettings(value);
      setDraft({ enabled: value.enabled, host: value.host, port: value.port, username: value.username,
        from: value.from, to: value.to, reminderHour: value.reminderHour, reminderMinute: value.reminderMinute });
      setTime(`${String(value.reminderHour).padStart(2, "0")}:${String(value.reminderMinute).padStart(2, "0")}`);
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "邮件配置读取失败，请重试。"); }
    finally { if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; }; }, [load]);

  const locked = (field: keyof EmailSettingsValue | "password") => settings?.lockedFields.includes(field) ?? false;
  const updateUsername = (username: string) => setDraft(current => current && ({ ...current, username,
    from: !locked("from") && (!current.from || current.from === current.username) ? username : current.from,
    to: !locked("to") && (!current.to || current.to === current.username) ? username : current.to }));

  async function save() {
    if (!settings || !draft || inFlight.current) return;
    const [reminderHour, reminderMinute] = time.split(":").map(Number);
    if (!time || !Number.isInteger(reminderHour) || reminderHour < 0 || reminderHour > 23 ||
      !Number.isInteger(reminderMinute) || reminderMinute < 0 || reminderMinute > 59) {
      setError("请选择每天的提醒时间。"); return;
    }
    inFlight.current = true; setSaving(true); onBusyChange(true); setError("");
    try {
      await apiRequest<EmailSettingsView>("/notifications/settings", { revision: settings.revision, settings: {
        ...draft, host: draft.host.trim(), username: draft.username.trim(), from: draft.from.trim() || draft.username.trim(),
        to: draft.to.trim() || draft.username.trim(), reminderHour, reminderMinute,
        ...(password ? { password } : {}),
      } });
      if (alive.current) { setPassword(""); onSaved(); }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "配置保存失败，请重试。"); }
    finally {
      inFlight.current = false; onBusyChange(false);
      if (alive.current) { setSaving(false); setPassword(""); }
    }
  }

  if (loading) return <div className="email-settings-loading" role="status">正在读取邮件配置…</div>;
  if (!settings || !draft) return <div className="email-settings-loading"><p className="inline-error" role="alert">{error}</p><div className="email-settings-actions"><button type="button" className="button light" onClick={onCancel}>取消</button><button type="button" className="button secondary" onClick={() => void load()}>重新读取</button></div></div>;
  if (!settings.editable) return <div className="email-settings-loading"><p>当前邮件由服务器管理，暂不支持在这里修改。</p><button type="button" className="button light" onClick={onCancel}>返回</button></div>;

  const changedAccount = draft.username.trim() !== settings.username || draft.host.trim() !== settings.host || draft.port !== settings.port;
  return <form className="email-settings-form" aria-label="邮件配置" autoComplete="off" onSubmit={event => { event.preventDefault(); void save(); }}>
    <fieldset disabled={saving}>
      <label className="email-settings-enabled"><input type="checkbox" aria-label="自动到期提醒" checked={draft.enabled} disabled={locked("enabled")} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} /><span><strong>自动到期提醒</strong><small>按订阅的提前提醒天数发送</small></span></label>
      <div className="email-settings-grid">
        <label className="form-field"><span>发件邮箱</span><input aria-label="发件邮箱" autoFocus type="email" inputMode="email" required={draft.enabled} maxLength={254} placeholder="你的 QQ 邮箱" value={draft.username} disabled={locked("username")} onChange={event => updateUsername(event.target.value)} /></label>
        <label className="form-field"><span>收件邮箱</span><input aria-label="收件邮箱" type="email" inputMode="email" maxLength={254} placeholder="默认发给自己" value={draft.to} disabled={locked("to")} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
        <label className="form-field email-settings-wide"><span>SMTP 授权码{settings.passwordConfigured && <small className="email-settings-existing">已设置</small>}</span><input aria-label="SMTP 授权码" type="password" autoComplete="new-password" maxLength={512} spellCheck={false} placeholder={settings.passwordConfigured && !changedAccount ? "留空继续使用已有授权码" : "填写邮箱的 SMTP 授权码"} value={password} disabled={locked("password")} onChange={event => setPassword(event.target.value)} /><small className="email-settings-field-note">QQ 邮箱使用 16 位授权码，不是登录密码。{changedAccount && settings.passwordConfigured ? "更换邮箱或服务器后需重新填写。" : ""}</small></label>
        <label className="form-field email-settings-wide"><span>每天提醒时间</span><input aria-label="每天提醒时间" type="time" required step={60} value={time} disabled={locked("reminderHour") && locked("reminderMinute")} onChange={event => {
          const [hour, minute] = event.target.value.split(":");
          setTime(event.target.value ? `${locked("reminderHour") ? String(settings.reminderHour).padStart(2, "0") : hour}:${locked("reminderMinute") ? String(settings.reminderMinute).padStart(2, "0") : minute}` : "");
        }} /><small className="email-settings-field-note">时区：{settings.timeZone}{locked("reminderHour") !== locked("reminderMinute") && ` · ${locked("reminderHour") ? "小时" : "分钟"}由服务器固定`}</small></label>
      </div>
      <details className="email-settings-advanced"><summary>其他邮箱 / 高级设置</summary><div className="email-settings-grid">
        <label className="form-field"><span>SMTP 服务器</span><input aria-label="SMTP 服务器" required maxLength={253} placeholder="smtp.qq.com" value={draft.host} disabled={locked("host")} onChange={event => setDraft({ ...draft, host: event.target.value })} /></label>
        <label className="form-field"><span>加密端口</span><input aria-label="加密端口" required type="number" min={1} max={65535} value={draft.port} disabled={locked("port")} onChange={event => setDraft({ ...draft, port: Number(event.target.value) })} /></label>
        <label className="form-field email-settings-wide"><span>发件地址</span><input aria-label="发件地址" type="email" inputMode="email" maxLength={254} placeholder="默认与发件邮箱相同" value={draft.from} disabled={locked("from")} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
      </div><p>使用 SSL/TLS 加密连接，常用端口为 465。</p></details>
    </fieldset>
    {!!settings.lockedFields.length && <p className="email-settings-note">部分设置由服务器管理，灰色字段不可修改。</p>}
    <p className="email-settings-note">保存后立即生效。授权码只保存在服务器，不会回显。</p>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="email-settings-actions"><button type="button" className="button light" disabled={saving} onClick={() => { setPassword(""); onCancel(); }}>取消</button><button type="submit" className="button primary" disabled={saving}>{saving ? "保存中…" : "保存配置"}</button></div>
  </form>;
}
