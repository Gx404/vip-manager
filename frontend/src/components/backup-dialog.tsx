import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest, ApiError } from "@/lib/api";
import { dateKey } from "@/lib/subscriptions";
import type { BackupDocument, ImportPreview } from "../../../shared/renewals.ts";

type Props = { open: boolean; onOpenChange: (open: boolean) => void; onImported: () => Promise<void> };

/** Preview a validated private backup before an atomic, version-checked merge or explicit replacement. */
export function BackupDialog({ open, onOpenChange, onImported }: Props) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [backup, setBackup] = useState<BackupDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function exportCurrent() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const result = await apiRequest<BackupDocument>("/backup");
      if (!alive.current) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json;charset=utf-8" }));
      try {
        const link = document.createElement("a");
        link.href = url; link.download = `vip-manager-backup-${dateKey()}.json`;
        document.body.append(link); link.click(); link.remove();
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
      setBackupDownloaded(true);
      toast.success("备份下载已发起", { description: "文件含私人备注，请确认保存并妥善保管。" });
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "导出失败，请重试。"); }
    finally { if (alive.current) setBusy(false); }
  }

  async function readBackup(file: File) {
    if (busy) return;
    setError(null); setPreview(null); setBackup(null); setReplaceConfirmed(false); setBackupDownloaded(false);
    if (file.size > 20 * 1024 * 1024) { setError("备份文件不能超过 20 MB。"); return; }
    setBusy(true);
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); }
      catch { throw new Error("无法读取 JSON，请选择本项目导出的完整备份文件。"); }
      if (!alive.current) return;
      const result = await apiRequest<ImportPreview>("/backup/preview", { backup: parsed });
      if (!alive.current) return;
      setBackup(parsed as BackupDocument); setPreview(result);
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "备份文件无效。"); }
    finally { if (alive.current) setBusy(false); }
  }

  async function importBackup() {
    if (!backup || !preview || busy || (mode === "replace" && (!backupDownloaded || !replaceConfirmed))) return;
    setBusy(true); setError(null);
    try {
      const result = await apiRequest<{ importedSubscriptions: number; importedLogs: number; skippedSubscriptions: number }>("/backup/import", {
        backup, mode, expectedRevision: preview.revision, confirmReplace: mode === "replace" && replaceConfirmed,
      });
      if (!alive.current) return;
      await onImported();
      if (!alive.current) return;
      toast.success("恢复完成", { description: `导入 ${result.importedSubscriptions} 条订阅、${result.importedLogs} 条流水；跳过 ${result.skippedSubscriptions} 条已有订阅。` });
      onOpenChange(false);
    } catch (reason) {
      if (!alive.current) return;
      setError(reason instanceof Error ? reason.message : "恢复失败，请刷新确认后重试。");
      if (reason instanceof ApiError && reason.status === 409) setPreview(null);
    } finally { if (alive.current) setBusy(false); }
  }

  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}>
    <DialogContent className="membership-dialog backup-dialog">
      <DialogHeader><DialogTitle>数据备份与恢复</DialogTitle><DialogDescription>JSON 包含完整订阅、私人备注、续费锚点和流水，不含账号密码、登录会话或服务器配置。仅管理员可用。</DialogDescription></DialogHeader>
      <div className="backup-actions">
        <button className="button secondary" disabled={busy} onClick={() => void exportCurrent()}><Download size={16} />下载当前备份</button>
        <label className="backup-file"><Upload size={16} />选择 JSON
          <input aria-label="选择 JSON 备份文件" type="file" accept="application/json,.json" disabled={busy} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ""; if (file) void readBackup(file);
          }} />
        </label>
      </div>
      {busy && <p className="muted" role="status">处理中，请稍候…</p>}
      {error && <div className="sync-banner" role="alert">{error}</div>}
      {preview && backup && <div className="backup-preview">
        <p>文件校验通过：{preview.subscriptions} 条订阅、{preview.logs} 条流水。</p>
        <label><input type="radio" name="restore-mode" checked={mode === "merge"} disabled={busy} onChange={() => setMode("merge")} />合并导入</label>
        {mode === "merge" && <p>新增 {preview.newSubscriptions} 条订阅、{preview.newLogs} 条流水；跳过 {preview.skippedSubscriptions} 条同 ID 订阅，不覆盖已有数据。</p>}
        <label><input type="radio" name="restore-mode" checked={mode === "replace"} disabled={busy} onChange={() => setMode("replace")} />覆盖恢复</label>
        {mode === "replace" && <>
          <p className="red">将用文件替换当前全部订阅与流水，页面内不可撤销。请先下载当前备份。</p>
          <label><input type="checkbox" checked={replaceConfirmed} disabled={busy || !backupDownloaded} onChange={event => setReplaceConfirmed(event.target.checked)} />我已确认备份文件保存成功，同意覆盖当前数据</label>
        </>}
        <p>导入不会执行真实扣款。开启自动续费的到期记录会在后台下一轮检查时推进，导入流水不能使用快捷撤销。</p>
      </div>}
      <p className="cost-note">支持最多 2,000 条订阅、10,000 条流水、20 MB。更大规模或连同账号迁移，请使用服务器 SQLite 备份。</p>
      <div className="dialog-right-actions">
        <button className="button light" disabled={busy} onClick={() => onOpenChange(false)}>关闭</button>
        <button className={mode === "replace" ? "button danger" : "button primary"} disabled={!preview || busy || (mode === "replace" && (!backupDownloaded || !replaceConfirmed))} onClick={() => void importBackup()}>{mode === "replace" ? "确认覆盖恢复" : "确认合并导入"}</button>
      </div>
    </DialogContent>
  </Dialog>;
}
