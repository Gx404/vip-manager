import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Bell, BriefcaseBusiness, Check, Cloud, Clock3,
  CreditCard, Download, Ellipsis, Info, LayoutGrid, Music2, Plus, RotateCw,
  Search, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Wallet, ShoppingBag, Coffee, Gamepad2, GraduationCap, Globe, History, Upload, List,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/sonner";
import { LoginDialog } from "@/components/login-dialog";
import { ServiceLogo } from "@/components/service-logo";
import { apiRequest, ApiError } from "@/lib/api";
import { toast } from "sonner";
import { categories, cycles, dateKey, monthlyCost, remaining, renewDate, occupiedCategories, dueWithin, durationColor, periodPercentage, shiftDate, stateOf, type Subscription, type DashboardSnapshot } from "@/lib/subscriptions";
import type { RenewalResult } from "../../../shared/renewals.ts";
import { linkedEndDate, updateDraftPeriod, membershipTemplates, requestId, type MembershipTemplate } from "@/lib/dashboard-helpers";
import { HistoryDialog } from "@/components/history-dialog";
import { BackupDialog } from "@/components/backup-dialog";
import { SubscriptionRow } from "@/components/subscription-row";

const categoryIcons = { "影音娱乐": Music2, "购物会员": ShoppingBag, "AI 工具": Sparkles, "云盘存储": Cloud, "效率办公": BriefcaseBusiness, "生活服务": Coffee, "游戏会员": Gamepad2, "学习教育": GraduationCap, "网络服务": Globe, "其他服务": LayoutGrid };
const statusNames = { healthy: "正常使用", soon: "即将到期", expired: "已到期" } as const;
const currency = (n: number) => n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
type Status = keyof typeof statusNames;
type Draft = Omit<Subscription, "amount" | "customDays" | "reminderDays"> & { amount: string; customDays: string; reminderDays: string };
type ConfirmAction = { kind: "delete"; item: Subscription } | null;
type ViewMode = "grid" | "list";


function blankDraft(today: string): Draft {
  return {
    id: "", name: "", plan: "", category: "其他服务", amount: "0", cycle: "monthly", customDays: "30",
    startDate: today, endDate: renewDate(today, "monthly", 30), reminderDays: "7", autoRenew: false, note: "", color: "#269979", version: 0,
  };
}

function toDraft(item: Subscription): Draft {
  return { ...item, amount: String(item.amount), customDays: String(item.customDays), reminderDays: String(item.reminderDays) };
}

function Segments({ value, color, label }: { value: number; color: string; label: string }) {
  return <Progress value={value} aria-label={label} aria-valuetext={label} title={label} className="segments" style={{ "--segment-color": color } as CSSProperties} />;
}

function escapeIcs(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");
}

function downloadCalendar(item: Subscription) {
  const start = item.endDate.replaceAll("-", "");
  const nextDay = shiftDate(item.endDate, 1).replaceAll("-", "");
  const trigger = item.reminderDays > 0 ? `-P${item.reminderDays}D` : "-PT0M";
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Gx404//Memberships//CN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    `UID:${item.id}@gx404-memberships`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`,
    `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${nextDay}`, `SUMMARY:${escapeIcs(`${item.name} 到期`)}`,
    `DESCRIPTION:${escapeIcs(`${item.plan || "会员订阅"} · ¥${currency(item.amount)} · 续费方式：${item.autoRenew ? "自动续费" : "手动续费"}`)}`,
    "BEGIN:VALARM", `TRIGGER:${trigger}`, "ACTION:DISPLAY", `DESCRIPTION:${escapeIcs(`${item.name} 即将到期`)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${item.name}-到期提醒.ics`;
  link.click();
  URL.revokeObjectURL(url);
  toast.success("日历文件已生成", { description: "导入日历后由系统负责提醒；续费后请重新导出一次。" });
}

export default function Dashboard() {
  const [today, setToday] = useState(() => dateKey());
  const [items, setItems] = useState<Subscription[]>([]);
  const [publicDashboard, setPublicDashboard] = useState(false);
  const requestSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [category, setCategory] = useState("全部");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("expiry");
  const [showReminders, setShowReminders] = useState(false);
  const [showCostBreakdown, setShowCostBreakdown] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState<Subscription | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blankDraft(dateKey()));
  const [statusFilter, setStatusFilter] = useState("all");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [saving, setSaving] = useState(false);
  const [clock, setClock] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return localStorage.getItem("membership-view") === "list" ? "list" : "grid"; } catch { return "grid"; }
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<Subscription | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [dateLinked, setDateLinked] = useState(true);
  const [quickRenewing, setQuickRenewing] = useState<Set<string>>(() => new Set());
  const [undoReceipts, setUndoReceipts] = useState<Record<string, { result: RenewalResult; until: number }>>({});
  const quickRenewTimers = useRef<Record<string, number>>({});
  const pendingRenewals = useRef(new Set<string>());
  const mutationEpoch = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setToday(dateKey()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => { ++mutationEpoch.current; Object.values(quickRenewTimers.current).forEach(timer => window.clearTimeout(timer)); }, []);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  /** Refresh display data and permissions together; ignore responses superseded by login/logout. */
  const loadRecords = useCallback(async (background = false) => {
    const sequence = ++requestSequence.current;
    if (!background) setLoading(true);
    try {
      const payload = await apiRequest<DashboardSnapshot>("/dashboard");
      if (sequence !== requestSequence.current) return;
      setAuthRequired(!payload.canManage);
      setPublicDashboard(payload.publicDashboard);
      setSyncError(null);
      setItems(payload.items);
      setCategory(current => current === "全部" || payload.items.some(item => item.category === current) ? current : "全部");
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      if (background && !(error instanceof ApiError && error.status === 401)) {
        setSyncError(error instanceof Error ? error.message : "自动刷新失败，请重试。");
        return;
      }
      setItems([]);
      setAuthRequired(true);
      setPublicDashboard(false);
      setSelected(null);
      setEditorOpen(false);
      setDraft(blankDraft(dateKey()));
      setSyncError(error instanceof ApiError && error.status === 401 ? null : error instanceof Error ? error.message : "读取订阅失败。");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadRecords(), 0);
    return () => window.clearTimeout(timer);
  }, [loadRecords]);

  useEffect(() => {
    // Do not overwrite an open editor or create avoidable optimistic-lock conflicts while typing.
    const refresh = () => {
      if (document.visibilityState === "visible" && !editorOpen && !loginOpen && !saving && !confirmAction) {
        setToday(dateKey());
        void loadRecords(true);
      }
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [editorOpen, loginOpen, saving, confirmAction, loadRecords]);

  useEffect(() => {
    type Tool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options?: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Tool) => {
      try {
        void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => {
          console.warn("WebMCP tool registration unavailable.");
        });
      } catch {
        console.warn("WebMCP tool registration unavailable.");
      }
    };
    register({
      name: "list_memberships",
      title: "读取会员清单",
      description: "读取当前可见的真实会员到期清单，不包含私人备注。",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: (input) => {
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length) throw new Error("请传入空对象。");
        return { items: items.map(({ id, name, plan, endDate, amount, cycle, autoRenew }) => ({ id, name, plan, endDate, amount, cycle, autoRenew })) };
      },
    });
    register({
      name: "start_membership_creation",
      title: "打开新增会员表单",
      description: "打开新增表单并预填名称；由用户检查并点击保存，不会扣款。",
      inputSchema: { type: "object", properties: { name: { type: "string", maxLength: 60 }, plan: { type: "string", maxLength: 80 } }, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: (input) => {
        if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("输入必须是对象。");
        const values = input as Record<string, unknown>;
        if (Object.keys(values).some(key => !["name", "plan"].includes(key))) throw new Error("存在不支持的字段。");
        if ((values.name !== undefined && (typeof values.name !== "string" || values.name.length > 60)) || (values.plan !== undefined && (typeof values.plan !== "string" || values.plan.length > 80))) throw new Error("名称或套餐格式不正确。");
        if (authRequired) { setLoginOpen(true); return { opened: false, loginRequired: true }; }
        setSelected(null);
        setDateLinked(true);
        setDraft({ ...blankDraft(today), name: String(values.name ?? ""), plan: String(values.plan ?? "") });
        setEditorOpen(true);
        return new Promise(resolve => requestAnimationFrame(() => resolve({ opened: true })));
      },
    });
    return () => lifecycle.abort();
  }, [authRequired, items, today]);

  const visibleCategories = occupiedCategories(items);
  const active = items.filter(i => remaining(i, today) >= 0);
  const sevenDayDue = items.filter(i => dueWithin(i, today, 7));
  const due = items.filter(i => stateOf(i, today) !== "healthy").sort((a, b) => a.endDate.localeCompare(b.endDate));
  const monthly = active.reduce((sum, item) => sum + monthlyCost(item), 0);
  const upcoming = items.filter(i => dueWithin(i, today, 30)).reduce((sum, item) => sum + item.amount, 0);
  const filtered = useMemo(() => items.filter(i =>
    (category === "全部" || i.category === category) &&
    (statusFilter === "all" || (statusFilter === "deadline7" ? dueWithin(i, today, 7) : stateOf(i, today) === statusFilter)) &&
    `${i.name} ${i.plan} ${i.note}`.toLowerCase().includes(query.toLowerCase()),
  ).sort((a, b) => sort === "price" ? b.amount - a.amount : sort === "name" ? a.name.localeCompare(b.name, "zh-CN") : a.endDate.localeCompare(b.endDate)), [items, category, query, sort, statusFilter, today]);

  function edit(item: Subscription | null = null) {
    if (authRequired) { setLoginOpen(true); return; }
    setSelected(item);
    setDraft(item ? toDraft(item) : blankDraft(today));
    setDateLinked(!item);
    setEditorOpen(true);
  }

  async function postAction<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
    try { return await apiRequest("/subscriptions", { action, ...body }); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { setAuthRequired(true); setEditorOpen(false); setLoginOpen(true); void loadRecords(); }
      throw error;
    }
  }

  /** Record a renewal directly from a card/reminder and keep a short server-validated undo window. */
  async function quickRenew(item: Subscription) {
    if (authRequired || item.autoRenew || pendingRenewals.current.has(item.id) || undoReceipts[item.id]) return;
    const epoch = mutationEpoch.current;
    pendingRenewals.current.add(item.id);
    setQuickRenewing(current => new Set(current).add(item.id));
    try {
      const result = await postAction<RenewalResult>("renew", { id: item.id, version: item.version, requestId: requestId() });
      if (epoch !== mutationEpoch.current) return;
      const until = result.undoUntil ? new Date(result.undoUntil).getTime() : 0;
      if (until) {
        setUndoReceipts(current => ({ ...current, [item.id]: { result, until } }));
        quickRenewTimers.current[item.id] = window.setTimeout(() => setUndoReceipts(current => { const next = { ...current }; delete next[item.id]; return next; }), Math.max(100, until - Date.now() + 250));
      }
      setItems(current => current.map(value => value.id === item.id ? result.item : value));
      setShowReminders(false);
      const undo = async () => {
        if (epoch !== mutationEpoch.current || pendingRenewals.current.has(item.id)) return;
        pendingRenewals.current.add(item.id);
        try {
          await postAction("undoRenew", { id: item.id, version: result.item.version, logId: result.renewal.id });
          if (epoch !== mutationEpoch.current) return;
          setUndoReceipts(current => { const next = { ...current }; delete next[item.id]; return next; });
          await loadRecords(true); toast.success("已撤销本次续费记录");
        } catch (reason) { if (epoch === mutationEpoch.current) { toast.error(reason instanceof Error ? reason.message : "撤销失败，请刷新确认。"); void loadRecords(true); } }
        finally { pendingRenewals.current.delete(item.id); }
      };
      toast.success("已快捷续费", { description: `${result.item.endDate} 到期 · 30 秒内可撤销`, duration: Math.max(1000, until ? until - Date.now() : 30000), action: until ? { label: "撤销", onClick: () => void undo() } : undefined });
      void loadRecords(true);
    } catch (reason) {
      if (epoch !== mutationEpoch.current) return;
      toast.error(reason instanceof Error ? reason.message : "续费记录失败");
      void loadRecords(true);
    } finally { pendingRenewals.current.delete(item.id); setQuickRenewing(current => { const next = new Set(current); next.delete(item.id); return next; }); }
  }

  function changeDraft(field: keyof Draft, value: string | boolean) {
    setDraft(current => updateDraftPeriod(current, { [field]: value } as Partial<Draft>, dateLinked));
    if (field === "endDate") setDateLinked(false);
  }

  function applyTemplate(template: MembershipTemplate) {
    setDraft(current => {
      const end = dateLinked ? linkedEndDate(current.startDate, template.cycle, template.customDays) : current.endDate;
      return { ...current, name: template.name, plan: template.plan, category: template.category, color: template.color, cycle: template.cycle, customDays: String(template.customDays), ...(end ? { endDate: end } : {}) };
    });
  }

  async function signOut() {
    try {
      ++mutationEpoch.current; toast.dismiss();
      ++requestSequence.current;
      await apiRequest("/auth/logout", {});
      setAuthRequired(true); setItems([]);
      setSelected(null); setEditorOpen(false); setConfirmAction(null); setShowReminders(false); setDraft(blankDraft(today));
      setBackupOpen(false); setHistoryOpen(false); setHistoryItem(null); setUndoReceipts({});
      await loadRecords();
      toast.success("已退出登录");
    } catch (error) { toast.error(error instanceof Error ? error.message : "退出失败"); }
  }

  function draftPayload() {
    const amount = Number(draft.amount);
    const customDays = Number(draft.customDays);
    const reminderDays = Number(draft.reminderDays);
    if (!draft.name.trim()) throw new Error("请填写会员名称。");
    if (!Number.isFinite(amount) || amount < 0) throw new Error("费用需要是有效的数字。");
    if (draft.endDate <= draft.startDate) throw new Error("到期日期必须晚于开始日期。");
    return { ...draft, id: selected ? selected.id : (globalThis.crypto?.randomUUID?.() || ""), amount, customDays, reminderDays, version: selected?.version ?? 0 };
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const payload = draftPayload();
      const action = selected ? "update" : "create";
      await postAction(action, action === "update" ? { id: selected?.id, version: selected?.version, item: payload } : { item: payload });
      await loadRecords();
      setEditorOpen(false);
      toast.success(action === "update" ? "订阅已更新" : "订阅已保存");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  /** Explicitly reset a custom due date and re-enable linking for the open form. */
  function suggestEndDate() {
    const endDate = linkedEndDate(draft.startDate, draft.cycle, Number(draft.customDays));
    if (!endDate) { toast.error("请填写有效的开始日期和周期，到期日不能超过 2200 年。"); return; }
    setDraft(current => ({ ...current, endDate })); setDateLinked(true);
  }

  async function confirmChange() {
    if (!confirmAction) return;
    setSaving(true);
    try {
      await postAction("delete", { id: confirmAction.item.id, version: confirmAction.item.version });
      toast.success("订阅已删除");
      if (selected?.id === confirmAction.item.id) setEditorOpen(false);
      await loadRecords();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "操作失败");
    } finally {
      setSaving(false);
      setConfirmAction(null);
    }
  }

  const statusFilterLabel = statusFilter === "all" ? "" : statusFilter === "deadline7" ? "7天内到期" : statusNames[statusFilter as Status];
  const footerTime = clock.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replaceAll("/", ".");

  return <div className="app-shell">
    <div className="ambient" aria-hidden="true" />
    <main className="dashboard">
      <header className="topbar">
        <div className="brand"><h1>Gx404<span className="brand-dot">.</span></h1><span className="brand-divider" /><span className="brand-caption">会员看板</span></div>
        <div className="header-actions">{authRequired ? <button className="button light" onClick={() => setLoginOpen(true)}>管理员登录</button> : <button className="button light" onClick={() => void signOut()}>退出</button>}<span className="header-date">{today.replaceAll("-", ".")}</span><button className="button light notification-button" onClick={() => setShowReminders(true)}><Bell size={17} /><span>提醒中心</span>{due.length > 0 && <b>{due.length}</b>}</button>{!authRequired && <><button className="button light header-utility" title="续费流水" onClick={() => { setHistoryItem(null); setHistoryOpen(true); }}><History size={16} /><span>流水</span></button><button className="button light header-utility" title="数据备份与恢复" onClick={() => setBackupOpen(true)}><Upload size={16} /><span>备份</span></button><button className="button primary" onClick={() => edit()}><Plus size={17} />添加订阅</button></>}</div>
      </header>

      {syncError && <div className="sync-banner" role="status"><Info size={16} /><span>{syncError}</span><button onClick={() => void loadRecords()}>重新读取</button></div>}
      {!loading && authRequired && !publicDashboard && !syncError && <div className="auth-banner"><ShieldCheck size={16} /><span>当前为私人看板，请登录查看和管理会员。不会展示示例数据。</span><button onClick={() => setLoginOpen(true)}>登录后管理</button></div>}

      <section className="overview" aria-label="订阅总览">
        <div className="summary-card"><div className="summary-label">有效订阅<LayoutGrid /></div><div className="summary-number">{active.length}<span>/ {items.length}</span></div><div className="summary-bottom"><div className="overview-bars">{items.map(i => <i key={i.id} className={stateOf(i, today)} />)}</div></div></div>
        <button className="summary-card clickable" onClick={() => { setStatusFilter(statusFilter === "deadline7" ? "all" : "deadline7"); setCategory("全部"); }}><div className="summary-label">7天内到期<Clock3 /></div><div className="summary-number amber">{sevenDayDue.length}<span>项</span></div><div className="summary-bottom line"><span>固定查看未来 7 天</span><span className="tag amber-tag">需要留意</span></div></button>
        <button className="summary-card clickable" onClick={() => setShowCostBreakdown(true)} aria-haspopup="dialog"><div className="summary-label">月均支出<Wallet /></div><div className="summary-number"><small>¥</small>{currency(monthly)}</div><div className="summary-bottom line"><span>按月摊算 · 查看明细</span><span className="green">年约 ¥{currency(monthly * 12)}</span></div></button>
        <div className="summary-card"><div className="summary-label">30 天内到期金额<CreditCard /></div><div className="summary-number"><small>¥</small>{currency(upcoming)}</div><div className="summary-bottom line"><span>{items.filter(i => dueWithin(i, today, 30)).length} 项会员需要留意</span><span className="green">人民币</span></div></div>
      </section>

      <div className="section-toolbar"><div className="section-caption"><span className="live-dot" /><span>我的订阅</span><span className="muted">{items.length} 项</span>{statusFilterLabel && <button className="filter-clear" onClick={() => setStatusFilter("all")}>仅看{statusFilterLabel} ×</button>}</div><div className="toolbar-actions"><label className="search"><Search size={15} /><input aria-label="搜索订阅" placeholder="搜索订阅…" value={query} onChange={e => setQuery(e.target.value)} /></label><Select value={sort} onValueChange={setSort}><SelectTrigger className="sort-control" aria-label="排序方式"><SlidersHorizontal size={15} /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="expiry">到期时间</SelectItem><SelectItem value="price">价格从高到低</SelectItem><SelectItem value="name">名称排序</SelectItem></SelectContent></Select><div className="view-toggle" role="group" aria-label="视图切换"><button className={viewMode === "grid" ? "active" : ""} aria-pressed={viewMode === "grid"} title="大卡片视图" onClick={() => { setViewMode("grid"); try { localStorage.setItem("membership-view", "grid"); } catch { /* storage can be unavailable */ } }}><LayoutGrid size={15} /></button><button className={viewMode === "list" ? "active" : ""} aria-pressed={viewMode === "list"} title="紧凑列表视图" onClick={() => { setViewMode("list"); try { localStorage.setItem("membership-view", "list"); } catch { /* storage can be unavailable */ } }}><List size={15} /></button></div></div></div>
      <Tabs value={category} onValueChange={setCategory} className="category-tabs"><TabsList className="category-list" aria-label="会员分类"><TabsTrigger value="全部"><LayoutGrid />全部<span>{items.length}</span></TabsTrigger>{visibleCategories.map(({ category: c, count }) => { const Icon = categoryIcons[c]; return <TabsTrigger key={c} value={c}><Icon />{c}<span>{count}</span></TabsTrigger>; })}</TabsList></Tabs>

      <section className={`subscription-grid ${viewMode === "list" ? "compact-view" : ""}`} aria-label="会员列表">
        {loading && <div className="loading-state"><span className="loading-pulse" />正在读取你的会员清单…</div>}
        {!loading && filtered.map(item => { const status = stateOf(item, today); const days = remaining(item, today); const progress = periodPercentage(item, today); const color = durationColor(days); const undo = undoReceipts[item.id]; if (viewMode === "list") return <SubscriptionRow key={item.id} item={item} today={today} canManage={!authRequired} busy={quickRenewing.has(item.id) || Boolean(undo)} onRenew={() => void quickRenew(item)} onEdit={() => edit(item)} />; return <article key={item.id} className={`subscription-card ${status}`}>
          <div className="card-heading"><ServiceLogo name={item.name} color={item.color} /><div className="service-name"><h2>{item.name}</h2><p>{item.plan || "会员订阅"}</p></div>{!authRequired && <div className="card-actions">{!item.autoRenew && <button className="quick-renew" disabled={Boolean(quickRenewing.has(item.id) || undo)} aria-label={`快捷续费${item.name}`} title={undo ? "已续费，可在右下角提示中撤销" : "快捷续费（仅更新记录，可撤销）"} onClick={() => void quickRenew(item)}>{quickRenewing.has(item.id) ? <RotateCw className="spin" size={16} /> : <Check size={16} />}</button>}<button className="icon-button" aria-label={`编辑${item.name}`} onClick={() => edit(item)}><Ellipsis size={20} /></button></div>}</div>
          <div className="card-tags"><span className="tag category-tag">{item.category}</span><span className="tag cycle-tag">{item.cycle === "custom" ? `${item.customDays} 天` : cycles[item.cycle]}</span><span className={`card-status ${status}`}>{statusNames[status]}</span></div>
          <div className="remaining-block"><div className="small-label">{days < 0 ? "已过期" : "距离到期还有"}</div><div className="remaining-number" style={{ color }}>{Math.abs(days)}<span>天</span></div><div className="expiry-date">{item.endDate.replaceAll("-", ".")} 到期</div></div>
          <div className="progress-caption"><span>本期剩余</span><span>{progress}%</span></div><Segments value={progress} color={color} label={`${item.name}：本期剩余 ${progress}%，${days < 0 ? "已过期" : `距到期 ${days} 天`}`} />
          <div className="card-metrics"><div><span className="small-label"><CreditCard size={14} />续费金额</span><p>¥ <strong>{currency(item.amount)}</strong><small>/{item.cycle === "custom" ? `${item.customDays}天` : cycles[item.cycle].replace("付", "")}</small></p></div><div><span className="small-label"><RotateCw size={14} />续费方式</span><p className={item.autoRenew ? "green" : ""} title={item.autoRenew ? "到期日自动进入下一期，仅更新看板日期，不实际扣款" : "续费后请手动更新记录"}>{item.autoRenew ? "自动续费" : "手动续费"}</p></div></div>
        </article>; })}
        {!loading && !syncError && filtered.length === 0 && <div className="empty-state"><LayoutGrid size={32} /><h2>{items.length ? "没有找到符合条件的订阅" : authRequired ? publicDashboard ? "还没有会员记录" : "登录查看你的会员" : "把你的第一个会员加进来"}</h2><p>{items.length ? "试试其他关键词或分类。" : authRequired ? "管理员登录后可以添加和管理订阅。" : "记录本期到期日，下次续费之前心里有数。"}</p><button className="button primary" onClick={() => items.length ? (setCategory("全部"), setQuery(""), setStatusFilter("all")) : edit()}>{items.length ? "清除筛选" : authRequired ? "管理员登录" : "添加订阅"}</button></div>}
      </section>
      <footer className="page-footer"><time dateTime={clock.toISOString()}>{footerTime}</time></footer>
    </main>

    <Dialog open={editorOpen} onOpenChange={setEditorOpen}><DialogContent className="membership-dialog"><DialogHeader><DialogTitle>{selected ? `管理 ${selected.name}` : "添加订阅"}</DialogTitle><DialogDescription>填写会员名称、费用和到期时间；这里只记录信息，不会触碰平台扣款。</DialogDescription></DialogHeader><form className="membership-form" onSubmit={event => { event.preventDefault(); void saveDraft(); }}>
      {!selected && <div className="template-picker"><span>常用模板</span><div>{membershipTemplates.map(template => <button type="button" key={template.key} className="template-chip" onClick={() => applyTemplate(template)}>{template.name}</button>)}</div></div>}
      <div className="form-grid"><label className="form-field wide"><span>会员名称 *</span><input autoFocus required maxLength={60} value={draft.name} onChange={e => changeDraft("name", e.target.value)} placeholder="例如：Netflix" /></label><label className="form-field"><span>套餐名称</span><input maxLength={80} value={draft.plan} onChange={e => changeDraft("plan", e.target.value)} placeholder="例如：标准会员" /></label><label className="form-field"><span>分类</span><select aria-label="分类" value={draft.category} onChange={e => changeDraft("category", e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label><label className="form-field"><span>费用（人民币） *</span><input required min="0" step="0.01" type="number" value={draft.amount} onChange={e => changeDraft("amount", e.target.value)} /></label><label className="form-field"><span>续费周期</span><select aria-label="续费周期" value={draft.cycle} onChange={e => changeDraft("cycle", e.target.value as Draft["cycle"])}>{Object.entries(cycles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{draft.cycle === "custom" && <label className="form-field"><span>自定义天数</span><input min="1" max="3650" type="number" value={draft.customDays} onChange={e => changeDraft("customDays", e.target.value)} /></label>}<label className="form-field"><span>本期开始日期 *</span><input required type="date" value={draft.startDate} onChange={e => changeDraft("startDate", e.target.value)} /></label><label className="form-field"><span>本期到期日期 *</span><input required type="date" value={draft.endDate} onChange={e => changeDraft("endDate", e.target.value)} /></label><label className="form-field"><span>提前提醒</span><select aria-label="提前提醒" value={draft.reminderDays} onChange={e => changeDraft("reminderDays", e.target.value)}><option value="0">到期当天</option><option value="1">提前 1 天</option><option value="3">提前 3 天</option><option value="7">提前 7 天</option><option value="14">提前 14 天</option><option value="30">提前 30 天</option></select></label><label className="switch-field"><Switch aria-label="自动续费" checked={draft.autoRenew} onCheckedChange={checked => changeDraft("autoRenew", checked)} /><span><strong>自动续费</strong><small>开启后到期日自动更新下一期，关掉网页也生效。仅更新看板，不实际扣款；停订或扣款失败时请关闭。</small></span></label><label className="form-field wide"><span>私人备注（仅登录后可见）</span><textarea maxLength={500} value={draft.note} onChange={e => changeDraft("note", e.target.value)} placeholder="可记录最初开通时间、账号或付款渠道；不要保存密码" /></label></div>
      <div className="billing-help"><p><strong>{selected ? "修改开始日期或周期不会覆盖你已手动填写的到期日。" : "新建时开始日期和周期会自动联动到期日；如果你直接改到期日，之后将保留自定义日期。"}</strong></p><p>百分比与条形长度表示本期剩余比例；颜色按剩余时间渐变。日期以平台账单为准，自动续费只会在后台顺延看板记录，不会替你扣款。</p>{dateLinked && <span className="linked-hint">日期联动已开启</span>}<button type="button" className="text-action" onClick={suggestEndDate}>重新按开始日期和周期计算</button></div>
      <div className="dialog-actions"><div className="dialog-left-actions">{selected && <button type="button" className="text-danger" onClick={() => setConfirmAction({ kind: "delete", item: selected })}><Trash2 size={15} />删除</button>}{selected && <button type="button" className="text-action" onClick={() => void downloadCalendar(selected)}><Download size={15} />导出日历</button>}{selected && <button type="button" className="text-action" onClick={() => { setHistoryItem(selected); setEditorOpen(false); setHistoryOpen(true); }}><History size={15} />续费流水</button>}</div><div className="dialog-right-actions"><button type="button" className="button light" onClick={() => setEditorOpen(false)}>取消</button><button type="submit" className="button primary" disabled={saving}>{saving ? "保存中…" : <><Check size={15} />保存</>}</button></div></div>
    </form></DialogContent></Dialog>

    <Dialog open={showReminders} onOpenChange={setShowReminders}><DialogContent className="membership-dialog"><DialogHeader><DialogTitle>到期提醒</DialogTitle><DialogDescription>按每条订阅的提前提醒设置展示。快捷续费只更新看板记录，可在 30 秒内撤销。</DialogDescription></DialogHeader><div className="reminder-list">{due.length ? due.map(item => <div key={item.id}><span><strong>{item.name}</strong><small>{item.endDate} · ¥{currency(item.amount)}</small></span><b className={remaining(item, today) < 0 ? "red" : "amber"}>{remaining(item, today) < 0 ? `已过期 ${-remaining(item, today)} 天` : `${remaining(item, today)} 天后到期`}</b>{!authRequired && !item.autoRenew && <button className="quick-renew reminder-renew" disabled={Boolean(quickRenewing.has(item.id) || undoReceipts[item.id])} aria-label={`快捷续费${item.name}`} onClick={() => void quickRenew(item)}><Check size={15} /></button>}<button aria-label={`导出${item.name}日历`} className="icon-button" onClick={() => void downloadCalendar(item)}><Download size={16} /></button></div>) : <p className="muted">暂时没有需要处理的到期提醒。</p>}</div><div className="information-box"><Bell size={16} /><p>网页内提醒只在打开页面时显示。你可以给某条记录导出 .ics，导入手机或电脑日历后由日历应用负责通知；续费后记得重新导出。</p></div></DialogContent></Dialog>

    <AlertDialog open={Boolean(confirmAction)} onOpenChange={open => { if (!open && !saving) setConfirmAction(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除这条订阅？</AlertDialogTitle><AlertDialogDescription>“{confirmAction?.item.name}”将从清单删除，已有续费流水仍保留。删除后不能在页面内撤销。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={saving} onClick={event => { event.preventDefault(); void confirmChange(); }}>{saving ? "处理中…" : "确认删除"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Dialog open={showCostBreakdown} onOpenChange={setShowCostBreakdown}>
      <DialogContent className="membership-dialog cost-dialog">
        <DialogHeader><DialogTitle>月均支出怎么算？</DialogTitle><DialogDescription>把未过期订阅的费用平均摊到每个月，不是本月实际扣款。已过期记录不计入，自动续费开关不影响折算。</DialogDescription></DialogHeader>
        <div className="cost-rules">月付：原价 · 季付：÷3 · 年付：÷12<br />自定义周期：金额 ÷ 周期天数 ×30</div>
        <ul className="cost-list" aria-label="各订阅月均费用">{active.map(item => <li key={item.id}>
          <span><strong>{item.name}</strong><small>¥{currency(item.amount)}{item.cycle === "yearly" ? " ÷ 12" : item.cycle === "quarterly" ? " ÷ 3" : item.cycle === "custom" ? ` ÷ ${item.customDays} × 30` : " / 月"}</small></span>
          <b>¥{currency(monthlyCost(item))}<small>/月</small></b>
        </li>)}</ul>
        {!active.length && <p className="muted">暂无可计入的订阅。</p>}
        <div className="cost-total"><span>合计 / 月</span><strong>¥{currency(monthly)}</strong></div>
        <p className="cost-note">合计按未取整金额相加后保留两位小数；逐项显示金额可能有 0.01 元的舍入差异。它是预算参考，不是账单。</p>
      </DialogContent>
    </Dialog>
    {!authRequired && historyOpen && <HistoryDialog key={historyItem?.id || "all"} open={historyOpen} onOpenChange={setHistoryOpen} subscriptionId={historyItem?.id} subscriptionName={historyItem?.name} />}
    {!authRequired && backupOpen && <BackupDialog open={backupOpen} onOpenChange={setBackupOpen} onImported={async () => { await loadRecords(); }} />}
    <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSuccess={loadRecords} />
    <Toaster position="bottom-right" richColors theme="light" />
  </div>;
}
