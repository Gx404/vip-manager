import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/api";

type Props = { open:boolean; onOpenChange:(value:boolean)=>void; onSuccess:()=>Promise<void> };
/** Server-admin sign-in. Passwords and session tokens are never stored in browser storage. */
export function LoginDialog({open,onOpenChange,onSuccess}:Props) {
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  async function submit(event:FormEvent) {
    event.preventDefault();
    setBusy(true);setError("");
    try {
      await apiRequest("/auth/login",{username,password});
      setPassword("");
      await onSuccess();
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "登录失败，请重试。");
    } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value=>{if(!busy){setPassword("");setError("");onOpenChange(value);}}}>
    <DialogContent className="membership-dialog"><DialogHeader><DialogTitle>登录你的会员看板</DialogTitle>
    <DialogDescription>使用部署时设置的管理员账号，不需要 ChatGPT 登录。</DialogDescription></DialogHeader>
    <form className="login-form" onSubmit={submit}>
      <label className="form-field"><span>管理员账号</span><input required autoComplete="username" maxLength={60} value={username} onChange={e=>setUsername(e.target.value)}/></label>
      <label className="form-field"><span>密码</span><input required type="password" autoComplete="current-password" maxLength={256} value={password} onChange={e=>setPassword(e.target.value)}/></label>
      {error&&<p className="login-error" role="alert">{error}</p>}
      <button className="button primary" disabled={busy} type="submit"><LockKeyhole size={16}/>{busy?"登录中…":"登录"}</button>
    </form></DialogContent>
  </Dialog>;
}
