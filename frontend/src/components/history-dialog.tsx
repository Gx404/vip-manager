import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/api";
import type { HistoryPage } from "../../../shared/renewals.ts";
import { formatDateTime } from "@/lib/dashboard-helpers";
import { money, amountInCny } from "../../../shared/currency.ts";

type HistoryDialogProps = { open: boolean; onOpenChange: (open: boolean) => void; subscriptionId?: string; subscriptionName?: string };
/** Read paginated, private renewal entries, including retained records for deleted subscriptions. */
export function HistoryDialog({ open, onOpenChange, subscriptionId, subscriptionName }: HistoryDialogProps) {
  const [page, setPage] = useState<HistoryPage>({ logs: [], total: 0 });
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(null); setPage({ logs: [], total: 0 });
    const query = new URLSearchParams({ offset: String(offset), limit: "50" });
    if (subscriptionId) query.set("subscriptionId", subscriptionId);
    void apiRequest<HistoryPage>(`/subscriptions/history?${query.toString()}`).then(result => {
      if (active) setPage(result);
    }).catch(reason => {
      if (active) setError(reason instanceof Error ? reason.message : "读取续费流水失败。");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, offset, subscriptionId]);
  useEffect(() => { if (!open) { setOffset(0); setPage({ logs: [], total: 0 }); } }, [open]);
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="membership-dialog history-dialog">
    <DialogHeader><DialogTitle>{subscriptionName ? `${subscriptionName} · 续费流水` : "续费流水"}</DialogTitle><DialogDescription>这里只记录看板账期变化和金额估算，不代表平台真实扣款。</DialogDescription></DialogHeader>
    {loading && <p className="muted">读取中…</p>}
    {error && <div className="sync-banner" role="alert">{error}</div>}
    {!loading && !error && !page.logs.length && <p className="muted">还没有续费记录。</p>}
    <div className="history-list">{!error && page.logs.map(log => <div className="history-entry" key={log.id}>
      <div><strong>{log.subscriptionName}</strong><small>{log.kind === "automatic" ? "自动续费" : "手动续费"} · {log.periods} 个周期</small><small>{formatDateTime(log.createdAt)}</small></div>
      <div className="history-dates"><span>{log.previousStartDate} → {log.previousEndDate}</span><b>→ {log.newStartDate} → {log.newEndDate}</b></div>
      <div className="history-amount">{log.amount === null ? "金额未记录" : <>{money(log.amount, log.currency)}{log.currency && log.currency !== "CNY" && <small>折合 {money(amountInCny(log.amount, log.fxRateToCny))}</small>}</>}{log.undoneAt ? <em>已撤销</em> : null}</div>
    </div>)}</div>
    {page.total > 50 && <div className="history-pagination"><button className="button light" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</button><span>{offset + 1}–{Math.min(offset + 50, page.total)} / {page.total}</span><button className="button light" disabled={offset + 50 >= page.total} onClick={() => setOffset(offset + 50)}>下一页</button></div>}
  </DialogContent></Dialog>;
}
