import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { CompactDialogHeader } from "@/components/context-help";
import { apiRequest } from "@/lib/api";
import type { HistoryPage, RenewalLog } from "../../../shared/renewals.ts";
import { formatDateTime } from "@/lib/dashboard-helpers";
import { money, amountInCny } from "../../../shared/currency.ts";

type HistoryDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; subscriptionId?: string; subscriptionName?: string };
/** Read private renewal entries and explicitly confirm removal of already-undone records. */
export function HistoryDialog({ open, onOpenChange, subscriptionId, subscriptionName }: HistoryDialogProps) {
  const [page, setPage] = useState<HistoryPage>({ logs: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RenewalLog | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [revision, setRevision] = useState(0);
  const scope = useRef(0);
  useEffect(() => {
    scope.current++;
    setDeleteTarget(null); setDeleteError(null); setDeleting(false);
    return () => { scope.current++; };
  }, [open, subscriptionId]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(null); setPage({ logs: [], total: 0 });
    const query = new URLSearchParams({ offset: String(offset), limit: "50" });
    if (subscriptionId) query.set("subscriptionId", subscriptionId);
    void apiRequest<HistoryPage>(`/subscriptions/history?${query.toString()}`).then(result => {
      if (!active) return;
      if (offset > 0 && offset >= result.total) {
        setOffset(Math.max(0, Math.floor((result.total - 1) / 50) * 50));
        return;
      }
      setPage(result);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "读取续费流水失败。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, offset, subscriptionId, revision]);
  useEffect(() => { if (!open) { setOffset(0); setPage({ logs: [], total: 0 }); } }, [open]);

  async function deleteEntry() {
    if (!deleteTarget || deleting) return;
    const currentScope = scope.current;
    setDeleting(true); setDeleteError(null);
    try {
      await apiRequest<{ id: string }>("/subscriptions/history/delete", { id: deleteTarget.id });
      if (scope.current !== currentScope) return;
      setDeleteTarget(null); setRevision(value => value + 1);
      toast.success("已删除撤销流水");
    } catch (reason) {
      if (scope.current === currentScope) setDeleteError(reason instanceof Error ? reason.message : "删除失败，请刷新确认后重试。");
    } finally { if (scope.current === currentScope) setDeleting(false); }
  }

  return <><Dialog open={open} onOpenChange={value => { if (!deleting) onOpenChange(value); }}><DialogContent className="membership-dialog history-dialog">
    <CompactDialogHeader title={subscriptionName ? `${subscriptionName} · 续费流水` : "续费流水"} helpLabel="续费流水说明" help="这里只记录看板账期变化和金额估算，不代表平台真实扣款。未撤销的流水不能删除；已撤销的流水可手动删除。删除订阅仍保留历史流水。" />
    {loading && <p className="muted">读取中…</p>}
    {error && <div className="sync-banner" role="alert">{error}</div>}
    {!loading && !error && !page.logs.length && <p className="muted">还没有续费记录。</p>}
    <div className="history-list">{!error && page.logs.map(log => <div className="history-entry" key={log.id}>
      <div><strong>{log.subscriptionName}</strong><small>{log.kind === "automatic" ? "自动续费" : "手动续费"} · {log.periods} 个周期</small><small>{formatDateTime(log.createdAt)}</small></div>
      <div className="history-dates"><span>{log.previousStartDate} → {log.previousEndDate}</span><b>→ {log.newStartDate} → {log.newEndDate}</b></div>
      <div className="history-amount">{log.amount === null ? "金额未记录" : <>{money(log.amount, log.currency)}{log.currency && log.currency !== "CNY" && <small>折合 {money(amountInCny(log.amount, log.fxRateToCny))}</small>}</>}{log.undoneAt !== null && <><em>已撤销</em><button className="button light history-delete" disabled={loading || deleting} aria-label={`删除${log.subscriptionName}的已撤销流水`} onClick={() => { setDeleteTarget(log); setDeleteError(null); }}>删除</button></>}</div>
    </div>)}</div>
    {page.total > 50 && <div className="history-pagination"><button className="button light" disabled={loading || deleting || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button><span>{offset + 1}–{Math.min(offset + 50, page.total)} / {page.total}</span><button className="button light" disabled={loading || deleting || offset + 50 >= page.total} onClick={() => setOffset(offset + 50)}>下一页</button></div>}
  </DialogContent></Dialog>
  <AlertDialog open={open && deleteTarget !== null} onOpenChange={value => { if (!value && !deleting) { setDeleteTarget(null); setDeleteError(null); } }}>
    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这条撤销流水？</AlertDialogTitle><AlertDialogDescription>“{deleteTarget?.subscriptionName}”在 {deleteTarget ? formatDateTime(deleteTarget.createdAt) : ""} 的已撤销流水将永久删除，不会改变会员当前账期。删除后不能在页面内恢复。</AlertDialogDescription></AlertDialogHeader>
      {deleteError && <div className="sync-banner" role="alert">{deleteError}</div>}
      <AlertDialogFooter><AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deleting} onClick={event => { event.preventDefault(); void deleteEntry(); }}>{deleting ? "删除中…" : "确认删除"}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog></>;
}
