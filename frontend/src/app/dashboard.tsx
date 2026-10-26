import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell, BriefcaseBusiness, Check, Cloud, Archive,
  Download, Info, LayoutGrid, Music2, Plus,
  Search, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, ShoppingBag, Coffee, Gamepad2, GraduationCap, Globe, History, Upload, List, BarChart3, LogOut, Palette,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Toaster } from "@/components/ui/sonner";
import { LoginDialog } from "@/components/login-dialog";
import { apiRequest, ApiError } from "@/lib/api";
import { toast } from "sonner";
import { categories, cycles, dateKey, monthlyCostCny, remaining, renewDate, occupiedCategories, shiftDate, stateOf, type Subscription, type DashboardSnapshot } from "@/lib/subscriptions";
import { money } from "../../../shared/currency.ts";
import { dateInTimeZone } from "../../../shared/billing.ts";
import type { RenewalResult, RenewalMode } from "../../../shared/renewals.ts";
import type { RenewalPaymentInput } from "../../../shared/payments.ts";
import { comparePeriodExpiry, linkedEndDate, updateDraftPeriod, membershipTemplates, requestId, type MembershipTemplate } from "@/lib/dashboard-helpers";
import { HistoryDialog } from "@/components/history-dialog";
import { RenewalDialog } from "@/components/renewal-dialog";
import { BackupDialog } from "@/components/backup-dialog";
import { SubscriptionRow } from "@/components/subscription-row";
import { SubscriptionCard } from "@/components/subscription-card";
import { ReportPage } from "@/components/report-page";
import { CurrencyFields, type CurrencyDraft } from "@/components/currency-fields";
import { DashboardOverview } from "@/components/dashboard-overview";
import { CompactDialogHeader, ContextHelp } from "@/components/context-help";
import { EmailReminders } from "@/components/email-reminders";
import { ThemeToggle } from "@/components/theme-toggle";
import { AmbientRain } from "@/components/ambient-rain";

const categoryIcons = { "影音娱乐": Music2, "购物电商": ShoppingBag, "AI 工具": Sparkles, "云存储": Cloud, "办公效率": BriefcaseBusiness, "设计与创作": Palette, "云服务与网络": Globe, "生活服务": Coffee, "游戏会员": Gamepad2, "学习教育": GraduationCap, "其他服务": LayoutGrid };
type Draft = Omit<Subscription, "amount" | "customDays" | "reminderDays" | keyof CurrencyDraft> & CurrencyDraft & { amount: string; customDays: string; reminderDays: string };
type ConfirmAction = { kind: "delete"; item: Subscription } | null;
type ViewMode = "grid" | "list";


function blankDraft(today: string): Draft {
  return {
    id: requestId(), name: "", plan: "", category: "其他服务", amount: "0", cycle: "monthly", customDays: "30",
    startDate: today, endDate: renewDate(today, "monthly", 30), reminderDays: "7", autoRenew: false, note: "", color: "#269979", version: 0,
    currency: "CNY", purchaseDate: today, fxRateToCny: "1", fxRateDate: today, fxRateSource: "manual",
  };
}

function toDraft(item: Subscription): Draft {
  return { ...item, amount: String(item.amount), customDays: String(item.customDays), reminderDays: String(item.reminderDays),
    currency: item.currency ?? "CNY", purchaseDate: item.purchaseDate ?? item.startDate, fxRateToCny: String(item.fxRateToCny ?? 1),
    fxRateDate: item.fxRateDate ?? item.purchaseDate ?? item.startDate, fxRateSource: item.fxRateSource ?? "manual" };
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
    `DESCRIPTION:${escapeIcs(`${item.plan || "会员订阅"} · ${money(item.amount, item.currency)} · 续费方式：${item.autoRenew ? "自动续费" : "手动续费"}`)}`,
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
  const [timeZone, setTimeZone] = useState("Asia/Shanghai");
  const [today, setToday] = useState(() => dateInTimeZone(new Date(), "Asia/Shanghai"));
  const [spending, setSpending] = useState<DashboardSnapshot["spending"]>();
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
  const [emailSettingsBusy, setEmailSettingsBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selected, setSelected] = useState<Subscription | null>(null);
  const [draft, setDraft] = useState<Draft>(() => blankDraft(dateKey()));
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const [saving, setSaving] = useState(false);
  const [createPaid, setCreatePaid] = useState(true);
  const [deleteMode, setDeleteMode] = useState<"keep-payments" | "purge">("keep-payments");
  const [purgeConfirmed, setPurgeConfirmed] = useState(false);
  const editorGeneration = useRef(0);
  const [clock, setClock] = useState(() => new Date());
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try { return localStorage.getItem("membership-view") === "list" ? "list" : "grid"; } catch { return "grid"; }
  });
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItem, setHistoryItem] = useState<Subscription | null>(null);
  const [renewalItem, setRenewalItem] = useState<Subscription | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [dateLinked, setDateLinked] = useState(true);
  const [periodPrompt, setPeriodPrompt] = useState<string | null>(null);
  const [quickRenewing, setQuickRenewing] = useState<Set<string>>(() => new Set());
  const [undoReceipts, setUndoReceipts] = useState<Record<string, { result: RenewalResult; until: number }>>({});
  const quickRenewTimers = useRef<Record<string, number>>({});
  const pendingRenewals = useRef(new Set<string>());
  const mutationEpoch = useRef(0);

  useEffect(() => {
    if (!authRequired) return;
    // Polling can discover session expiry while a secondary page is open.
    ++mutationEpoch.current;
    toast.dismiss();
    ++editorGeneration.current;
    setSaving(false);
    setReportOpen(false); setShowReminders(false); setEmailSettingsBusy(false);
    setEditorOpen(false); setHistoryOpen(false); setBackupOpen(false); setConfirmAction(null);
    setSelected(null); setHistoryItem(null); setRenewalItem(null); setDraft(blankDraft(dateKey())); setUndoReceipts({});
  }, [authRequired]);

  useEffect(() => {
    const timer = setInterval(() => setToday(dateInTimeZone(new Date(), timeZone)), 30_000);
    return () => clearInterval(timer);
  }, [timeZone]);

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
      setSpending(payload.spending);
      if (payload.today) setToday(payload.today);
      if (payload.timeZone) setTimeZone(payload.timeZone);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      if (background && !(error instanceof ApiError && error.status === 401)) {
        setSyncError(error instanceof Error ? error.message : "自动刷新失败，请重试。");
        return;
      }
      setItems([]);
      setSpending(undefined);
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
      if (document.visibilityState === "visible" && !editorOpen && !renewalItem && !loginOpen && !saving && !confirmAction) {
        setToday(dateInTimeZone(new Date(), timeZone));
        void loadRecords(true);
      }
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [editorOpen, renewalItem, loginOpen, saving, confirmAction, loadRecords, timeZone]);

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
        return { items: items.map(({ id, name, plan, endDate, amount, currency, cycle, autoRenew }) => ({ id, name, plan, endDate, amount, currency: currency ?? "CNY", cycle, autoRenew })) };
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
        if (saving) return { opened: false, busy: true };
        ++editorGeneration.current; setCreatePaid(true);
        setSelected(null);
        setDateLinked(true); setPeriodPrompt(null);
        setDraft({ ...blankDraft(today), name: String(values.name ?? ""), plan: String(values.plan ?? "") });
        setEditorOpen(true);
        return new Promise(resolve => requestAnimationFrame(() => resolve({ opened: true })));
      },
    });
    return () => lifecycle.abort();
  }, [authRequired, items, today, saving]);

  const active = items.filter(i => remaining(i, today) >= 0);
  const expiredCount = items.length - active.length;
  const visibleCategories = occupiedCategories(active);
  const due = active.filter(i => stateOf(i, today) === "soon").sort((a, b) => a.endDate.localeCompare(b.endDate));
  const filtered = useMemo(() => items.filter(i =>
    (category === "已过期" ? i.endDate < today : i.endDate >= today && (category === "全部" || i.category === category)) &&
    `${i.name} ${i.plan} ${i.note}`.toLowerCase().includes(query.toLowerCase()),
  ).sort((a, b) => sort === "price" ? monthlyCostCny(b) - monthlyCostCny(a) : sort === "name" ? a.name.localeCompare(b.name, "zh-CN") : comparePeriodExpiry(a, b, today)), [items, category, query, sort, today]);

  useEffect(() => {
    if (category !== "全部" && category !== "已过期" && !items.some(item => item.endDate >= today && item.category === category)) setCategory("全部");
  }, [items, category, today]);

  function edit(item: Subscription | null = null) {
    if (authRequired) { setLoginOpen(true); return; }
    if (saving) return;
    ++editorGeneration.current; setCreatePaid(true);
    setSelected(item);
    setDraft(item ? toDraft(item) : blankDraft(today));
    setDateLinked(!item || linkedEndDate(item.startDate,item.cycle,item.customDays) === item.endDate);
    setPeriodPrompt(null);
    setEditorOpen(true);
  }

  async function postAction<T = unknown>(action: string, body: Record<string, unknown> = {}): Promise<T> {
    try { return await apiRequest("/subscriptions", { action, ...body }); }
    catch (error) {
      if (error instanceof ApiError && error.status === 401) { setAuthRequired(true); setEditorOpen(false); setLoginOpen(true); void loadRecords(); }
      throw error;
    }
  }

  /** Record a renewal from details only and keep a short server-validated undo window. */
  async function quickRenew(item: Subscription, payment: RenewalPaymentInput, renewalMode: RenewalMode) {
    if (authRequired || item.autoRenew || pendingRenewals.current.has(item.id) || undoReceipts[item.id]) throw new Error("暂时无法续费，请刷新后再试。");
    const epoch = mutationEpoch.current;
    pendingRenewals.current.add(item.id);
    setQuickRenewing(current => new Set(current).add(item.id));
    try {
      const result = await postAction<RenewalResult>("renew", { id: item.id, version: item.version, requestId: requestId(), payment, renewalMode });
      if (epoch !== mutationEpoch.current) return;
      const until = result.undoUntil ? new Date(result.undoUntil).getTime() : 0;
      if (until) {
        setUndoReceipts(current => ({ ...current, [item.id]: { result, until } }));
        quickRenewTimers.current[item.id] = window.setTimeout(() => setUndoReceipts(current => { const next = { ...current }; delete next[item.id]; return next; }), Math.max(100, until - Date.now() + 250));
      }
      setItems(current => current.map(value => value.id === item.id ? result.item : value));
      await loadRecords(true);
      if (epoch !== mutationEpoch.current) return;
      setShowReminders(false); setEditorOpen(false); setRenewalItem(null);
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
      toast.success("本次续费已保存", { description: `${money(payment.amount,payment.currency)} · ${result.item.endDate} 到期${result.renewal.payment?.rate === null ? " · 汇率稍后自动补齐" : ""} · 30 秒内可撤销`, duration: Math.max(1000, until ? until - Date.now() : 30000), action: until ? { label: "撤销", onClick: () => void undo() } : undefined });
      void loadRecords(true);
    } catch (reason) {
      if (epoch !== mutationEpoch.current) return;
      void loadRecords(true);
      throw reason;
    } finally { pendingRenewals.current.delete(item.id); setQuickRenewing(current => { const next = new Set(current); next.delete(item.id); return next; }); }
  }

  function changeDraft(field: keyof Draft, value: string | boolean) {
    setDraft(current => {
      const next = updateDraftPeriod(current, { [field]: value } as Partial<Draft>, dateLinked);
      return field === "startDate" && current.purchaseDate === current.startDate ? { ...next, purchaseDate: String(value), fxRateDate: String(value), fxRateToCny: next.currency === "CNY" ? "1" : "", fxRateSource: "manual", ratePending: next.currency !== "CNY" } : next;
    });
    if (field === "endDate") { setDateLinked(false); setPeriodPrompt(null); }
    else if (["startDate","cycle","customDays"].includes(field) && !dateLinked) {
      const next = {...draft,[field]:value} as Draft;
      setPeriodPrompt(linkedEndDate(next.startDate,next.cycle,Number(next.customDays)));
    }
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
      ++editorGeneration.current;
      setBackupOpen(false); setHistoryOpen(false); setReportOpen(false); setHistoryItem(null); setRenewalItem(null); setUndoReceipts({});
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
    const currencyCode = draft.currency;
    const purchaseDate = draft.purchaseDate;
    const rate = currencyCode === "CNY" || draft.ratePending ? 1 : Number(draft.fxRateToCny);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("请输入有效的购买期汇率。");
    return { ...draft, id: draft.id, amount, customDays, reminderDays,
      currency: currencyCode, purchaseDate, fxRateToCny: rate, fxRateDate: draft.fxRateDate ?? purchaseDate, fxRateSource: draft.fxRateSource ?? "manual", version: selected?.version ?? 0 };
  }

  async function saveDraft() {
    if (saving) return;
    const generation = editorGeneration.current, epoch = mutationEpoch.current;
    setSaving(true);
    try {
      const payload = draftPayload();
      const action = selected ? "update" : "create";
      const payment = createPaid ? {amount:payload.amount,currency:payload.currency,paidOn:payload.purchaseDate,note:""} : undefined;
      await postAction(action, action === "update" ? { id: selected?.id, version: selected?.version, item: payload } : { item: payload, ...(payment ? {payment} : {}) });
      if (generation !== editorGeneration.current || epoch !== mutationEpoch.current) return;
      await loadRecords();
      if (generation !== editorGeneration.current || epoch !== mutationEpoch.current) return;
      setEditorOpen(false);
      toast.success(action === "update" ? "订阅已更新" : "订阅已保存");
    } catch (error) {
      if (generation === editorGeneration.current && epoch === mutationEpoch.current) toast.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      if (generation === editorGeneration.current && epoch === mutationEpoch.current) setSaving(false);
    }
  }

  /** Explicitly reset a custom due date and re-enable linking for the open form. */
  function suggestEndDate() {
    const endDate = linkedEndDate(draft.startDate, draft.cycle, Number(draft.customDays));
    if (!endDate) { toast.error("请填写有效的开始日期和周期，到期日不能超过 2200 年。"); return; }
    setDraft(current => ({ ...current, endDate })); setDateLinked(true); setPeriodPrompt(null);
  }

  async function confirmChange() {
    if (!confirmAction || saving || (deleteMode === "purge" && !purgeConfirmed)) return;
    setSaving(true);
    try {
      await postAction("delete", { id: confirmAction.item.id, version: confirmAction.item.version, deleteMode });
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

  const editableDraft = (value: Draft) => { const {purchaseDate: _date, fxRateToCny: _rate, fxRateDate: _quote, fxRateSource: _source, ratePending: _pending, ...rest} = value; return rest; };
  const draftChanged = selected !== null && JSON.stringify(editableDraft(draft)) !== JSON.stringify(editableDraft(toDraft(selected)));
  const footerTime = clock.toLocaleString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).replaceAll("/", ".");

  return <div className="app-shell">
    <AmbientRain />
    <main className="dashboard">
      <header className={`topbar${authRequired ? " guest-topbar" : ""}`}>
        <div className="brand"><h1>Gx404<span className="brand-dot">.</span></h1><span className="brand-divider" /><span className="brand-caption">会员看板</span></div>
        <div className="header-actions">
          <ThemeToggle />
          {!authRequired && <div className="header-toolbox" role="toolbar" aria-label="会员工具">
            <button className={`button header-utility${reportOpen ? " is-active" : ""}`} aria-label={reportOpen ? "返回看板" : "支出分析"} title={reportOpen ? "返回看板" : "支出分析"} onClick={() => setReportOpen(value => !value)}><BarChart3 size={17} /><span>{reportOpen ? "返回看板" : "支出分析"}</span></button>
            <button className={`button header-utility notification-button${due.length ? " has-reminders" : ""}`} aria-label={`提醒中心${due.length ? `，${due.length} 项待查看` : ""}`} title="提醒中心" onClick={() => setShowReminders(true)}><Bell size={17} /><span>提醒中心</span>{due.length > 0 && <b aria-hidden="true">{due.length}</b>}</button>
            <button className="button header-utility" aria-label="续费记录" title="续费记录" onClick={() => { setHistoryItem(null); setHistoryOpen(true); }}><History size={17} /><span>续费记录</span></button>
            <button className="button header-utility" aria-label="备份" title="数据备份与恢复" onClick={() => setBackupOpen(true)}><Upload size={17} /><span>备份</span></button>
            <button className="button header-utility sign-out" aria-label="退出" title="退出登录" onClick={() => void signOut()}><LogOut size={17} /><span>退出</span></button>
          </div>}
          {authRequired ? <button className="button primary" onClick={() => setLoginOpen(true)}>管理员登录</button> : <button className="button primary add-subscription" onClick={() => edit()}><Plus size={17} />添加订阅</button>}
        </div>
      </header>

      {syncError && <div className="sync-banner" role="status"><Info size={16} /><span>{syncError}</span><button onClick={() => void loadRecords()}>重新读取</button></div>}
      {!loading && authRequired && !publicDashboard && !syncError && <div className="auth-banner"><ShieldCheck size={16} /><span>请登录查看订阅。</span><button onClick={() => setLoginOpen(true)}>登录后管理</button></div>}

      {!authRequired && reportOpen ? <ReportPage items={items} today={today} revision={historyOpen} onHistory={id => { setHistoryItem(items.find(item=>item.id===id) ?? null); setHistoryOpen(true); }} onBack={() => setReportOpen(false)} /> : <>
      <DashboardOverview items={items} today={today} spending={spending} canManage={!authRequired} onCosts={() => setReportOpen(true)} />

      <div className="section-toolbar"><div className="section-caption"><span className="live-dot" /><span>我的订阅</span><span className="muted">{items.length} 项</span></div><div className="toolbar-actions"><label className="search"><Search size={15} /><input aria-label="搜索订阅" placeholder="搜索订阅…" value={query} onChange={e => setQuery(e.target.value)} /></label><Select value={sort} onValueChange={setSort}><SelectTrigger className="sort-control" aria-label="排序方式"><SlidersHorizontal size={15} /><SelectValue /></SelectTrigger><SelectContent><SelectItem value="expiry">到期时间</SelectItem><SelectItem value="price">月均费用从高到低</SelectItem><SelectItem value="name">名称排序</SelectItem></SelectContent></Select><div className="view-toggle" role="group" aria-label="视图切换"><button className={viewMode === "grid" ? "active" : ""} aria-pressed={viewMode === "grid"} title="卡片视图" onClick={() => { setViewMode("grid"); try { localStorage.setItem("membership-view", "grid"); } catch { /* storage can be unavailable */ } }}><LayoutGrid size={15} /></button><button className={viewMode === "list" ? "active" : ""} aria-pressed={viewMode === "list"} title="紧凑列表视图" onClick={() => { setViewMode("list"); try { localStorage.setItem("membership-view", "list"); } catch { /* storage can be unavailable */ } }}><List size={15} /></button></div></div></div>
      <Tabs value={category} onValueChange={setCategory} className="category-tabs"><TabsList className="category-list" aria-label="会员分类"><TabsTrigger value="全部"><LayoutGrid />全部<span>{active.length}</span></TabsTrigger>{visibleCategories.map(({ category: c, count }) => { const Icon = categoryIcons[c]; return <TabsTrigger key={c} value={c}><Icon />{c}<span>{count}</span></TabsTrigger>; })}<TabsTrigger value="已过期"><Archive />已过期<span>{expiredCount}</span></TabsTrigger></TabsList></Tabs>

      <section className={`subscription-grid ${viewMode === "list" ? "compact-view" : ""}`} aria-label="会员列表">
        {loading && <div className="loading-state"><span className="loading-pulse" />正在读取你的会员清单…</div>}
        {!loading && filtered.map(item => viewMode === "list"
          ? <SubscriptionRow key={item.id} item={item} today={today} canManage={!authRequired} onEdit={() => edit(item)} />
          : <SubscriptionCard key={item.id} item={item} today={today} canManage={!authRequired} onEdit={() => edit(item)} />)}
        {!loading && !syncError && filtered.length === 0 && <div className="empty-state">
          <LayoutGrid size={32} />
          <h2>{category === "已过期" && !query.trim() ? "暂无已过期订阅" : items.length && !active.length && category !== "已过期" ? "暂无有效订阅" : items.length ? "没有找到符合条件的订阅" : authRequired ? publicDashboard ? "还没有会员记录" : "登录查看你的会员" : "把你的第一个会员加进来"}</h2>
          {category === "已过期" && !query.trim() ? <p className="muted">到期后的订阅会自动移到这里，历史费用继续保留。</p> : items.length > 0 && !active.length && category !== "已过期" && <p className="muted">订阅保留在「已过期」中，可随时查看和续费。</p>}
          <button className="button primary" onClick={() => {
            if (!items.length && category !== "已过期") { edit(); return; }
            if (category === "已过期" && query.trim()) { setQuery(""); return; }
            setCategory(!active.length && expiredCount > 0 && category !== "已过期" ? "已过期" : "全部");
            setQuery("");
          }}>{category === "已过期" ? query.trim() ? "清除搜索" : "查看有效订阅" : items.length ? !active.length ? "查看已过期" : "清除筛选" : authRequired ? "管理员登录" : "添加订阅"}</button>
        </div>}
      </section>
      </>}
      <footer className="page-footer"><time dateTime={clock.toISOString()}>{footerTime}</time></footer>
    </main>

    <Dialog open={!authRequired && editorOpen} onOpenChange={open => {if (!saving) {if (!open) ++editorGeneration.current; setEditorOpen(open);}}}><DialogContent className="membership-dialog" showCloseButton={!saving} onEscapeKeyDown={event => {if (saving) event.preventDefault();}} onPointerDownOutside={event => {if (saving) event.preventDefault();}}><CompactDialogHeader title={selected ? `管理 ${selected.name}` : "添加订阅"} helpLabel="会员设置说明" help="填写会员名称、费用和到期时间。这里只记录信息，不会操作服务商账号或扣款。私人备注仅登录后可见，请勿保存密码。" /><form className="membership-form" onSubmit={event => { event.preventDefault(); void saveDraft(); }}><fieldset disabled={saving} className="membership-fields">
      {!selected && <div className="template-picker"><span>常用模板</span><div>{membershipTemplates.map(template => <button type="button" key={template.key} className="template-chip" onClick={() => applyTemplate(template)}>{template.name}</button>)}</div></div>}
      <div className="form-grid"><label className="form-field wide"><span>会员名称 *</span><input autoFocus required maxLength={60} value={draft.name} onChange={e => changeDraft("name", e.target.value)} placeholder="例如：Netflix" /></label><label className="form-field"><span>套餐名称</span><input maxLength={80} value={draft.plan} onChange={e => changeDraft("plan", e.target.value)} placeholder="例如：标准会员" /></label><label className="form-field"><span>分类</span><select aria-label="分类" value={draft.category} onChange={e => changeDraft("category", e.target.value)}>{categories.map(c => <option key={c}>{c}</option>)}</select></label><label className="form-field"><span>费用 *</span><input required min="0" step="0.01" type="number" value={draft.amount} onChange={e => changeDraft("amount", e.target.value)} /></label><CurrencyFields key={selected?.id ?? "new"} value={draft} onChange={patch => setDraft(current => ({ ...current, ...patch }))} /><label className="form-field"><span>续费周期</span><select aria-label="续费周期" value={draft.cycle} onChange={e => changeDraft("cycle", e.target.value as Draft["cycle"])}>{Object.entries(cycles).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>{draft.cycle === "custom" && <label className="form-field"><span>自定义天数</span><input min="1" max="3650" type="number" value={draft.customDays} onChange={e => changeDraft("customDays", e.target.value)} /></label>}<label className="form-field"><span>本期开始日期 *</span><input required type="date" value={draft.startDate} onChange={e => changeDraft("startDate", e.target.value)} /></label><label className="form-field"><span>本期到期日期 *</span><input required type="date" value={draft.endDate} onChange={e => changeDraft("endDate", e.target.value)} /></label><label className="form-field"><span>提前提醒</span><select aria-label="提前提醒" value={draft.reminderDays} onChange={e => changeDraft("reminderDays", e.target.value)}><option value="0">到期当天</option><option value="1">提前 1 天</option><option value="3">提前 3 天</option><option value="7">提前 7 天</option><option value="14">提前 14 天</option><option value="30">提前 30 天</option></select></label><div className="switch-field"><Switch id="auto-renew-toggle" aria-label="自动续费" checked={draft.autoRenew} onCheckedChange={checked => changeDraft("autoRenew", checked)} /><span className="field-label-with-help"><label htmlFor="auto-renew-toggle">自动续费</label><ContextHelp label="自动续费说明">到期日自动更新下一期，关掉网页也生效。只更新看板、不实际扣款；停订或扣款失败时请关闭。</ContextHelp></span></div><label className="form-field wide"><span>私人备注</span><textarea maxLength={500} value={draft.note} onChange={e => changeDraft("note", e.target.value)} placeholder="填写备注" /></label></div>
      {!selected && <div className="initial-payment-choice"><label><input type="checkbox" checked={createPaid} onChange={event => setCreatePaid(event.target.checked)} />本期已付款</label>{createPaid ? <><p className="muted">保存时登记本期实付 {money(Number(draft.amount) || 0,draft.currency)}，计入付款日期所在月份的支出。</p><label className="form-field"><span>首次付款日期</span><input aria-label="首次付款日期" required type="date" min="1900-01-01" max={today} value={draft.purchaseDate} onChange={event => setDraft(current => ({...current,purchaseDate:event.target.value,fxRateDate:event.target.value,fxRateToCny:current.currency === "CNY" ? "1" : "",fxRateSource:"manual",ratePending:current.currency !== "CNY"}))} /></label></> : <p className="muted">仅保存会员，不生成付款记录；以后可在“待核对付款”中补录。</p>}</div>}
      {selected && !selected.autoRenew && <div className="renewal-action"><div><div className="field-label-with-help"><strong>已经付款，续下一期</strong><ContextHelp label="续费说明">填写这次实付的金额、币种和付款日期。保存后直接记为已支付；已过期时可选择接原到期日补一期，或从付款日重新开始，保存前核对有效期预览。</ContextHelp></div>{draftChanged && <small role="status">请先保存或取消表单修改。</small>}</div><button type="button" className="button light" disabled={saving || draftChanged || quickRenewing.has(selected.id) || Boolean(undoReceipts[selected.id])} onClick={() => {setRenewalItem(selected);setEditorOpen(false);}}><Plus size={16} />记录续费</button></div>}
      {periodPrompt && <div className="period-prompt" role="status"><span>到期日曾手动调整，是否改为 {periodPrompt}？</span><button type="button" className="button light" onClick={suggestEndDate}>重新计算</button><button type="button" className="text-action" onClick={()=>setPeriodPrompt(null)}>保留原日期</button></div>}
      <div className="dialog-actions"><div className="dialog-left-actions">{selected && <button type="button" className="text-danger" onClick={() => {setDeleteMode("keep-payments");setPurgeConfirmed(false);setConfirmAction({ kind: "delete", item: selected });}}><Trash2 size={15} />删除</button>}{selected && <button type="button" className="text-action" onClick={() => void downloadCalendar(selected)}><Download size={15} />导出日历</button>}{selected && <button type="button" className="text-action" onClick={() => { setHistoryItem(selected); setEditorOpen(false); setHistoryOpen(true); }}><History size={15} />续费流水</button>}</div><div className="dialog-right-actions"><button type="button" className="button light" onClick={() => setEditorOpen(false)}>取消</button><button type="submit" className="button primary" disabled={saving}>{saving ? "保存中…" : <><Check size={15} />保存</>}</button></div></div>
    </fieldset></form></DialogContent></Dialog>

    <Dialog open={!authRequired && showReminders} onOpenChange={open => {if (!emailSettingsBusy) setShowReminders(open);}}><DialogContent className="membership-dialog" showCloseButton={!emailSettingsBusy} onEscapeKeyDown={event => {if(emailSettingsBusy) event.preventDefault();}} onPointerDownOutside={event => {if(emailSettingsBusy) event.preventDefault();}}>
      <CompactDialogHeader title="到期提醒" helpLabel="到期提醒说明" help={<><p>只按未过期订阅的提前提醒设置展示。已过期订阅保留在分类栏的「已过期」中，不再催续。</p><p>网页内提醒只在打开页面时显示。导出 .ics 并导入日历后，可由日历应用通知；续费后需重新导出。</p></>} />
      {!authRequired && showReminders && <EmailReminders onBusyChange={setEmailSettingsBusy} />}
      <div className="reminder-list">{due.length ? due.map(item => <div key={item.id}><span><strong>{item.name}</strong><small>{item.endDate} · {money(item.amount, item.currency)}</small></span><b className="amber">{remaining(item, today) === 0 ? "今日到期" : `${remaining(item, today)} 天后到期`}</b><button className="button light" disabled={emailSettingsBusy} aria-label={`管理${item.name}`} onClick={() => { setShowReminders(false); edit(item); }}>管理</button><button aria-label={`导出${item.name}日历`} className="icon-button" onClick={() => void downloadCalendar(item)}><Download size={16} /></button></div>) : <p className="muted">暂无到期提醒。已过期订阅可在分类栏的「已过期」中查看。</p>}</div>
    </DialogContent></Dialog>

    <AlertDialog open={!authRequired && Boolean(confirmAction)} onOpenChange={open => { if (!open && !saving) setConfirmAction(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除“{confirmAction?.item.name}”？</AlertDialogTitle><AlertDialogDescription>请选择是否保留已付款历史。删除后不能在页面内撤销；到期不续费也可留在“已过期”。</AlertDialogDescription></AlertDialogHeader>
      <fieldset disabled={saving} className="delete-options"><label><input type="radio" name="delete-mode" checked={deleteMode === "keep-payments"} onChange={() => {setDeleteMode("keep-payments");setPurgeConfirmed(false);}} />保留已付款记录</label><p className="muted">移除会员，真实付款继续计入历史支出。</p><label><input type="radio" name="delete-mode" checked={deleteMode === "purge"} onChange={() => setDeleteMode("purge")} />彻底删除</label><p className="muted">移除该会员及其全部付款、历史和提醒记录，不影响其他会员。</p>{deleteMode === "purge" && <label className="red"><input type="checkbox" checked={purgeConfirmed} onChange={event => setPurgeConfirmed(event.target.checked)} />确认同时删除这条会员的全部历史</label>}</fieldset>
      <AlertDialogFooter><AlertDialogCancel disabled={saving}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={saving || (deleteMode === "purge" && !purgeConfirmed)} onClick={event => { event.preventDefault(); void confirmChange(); }}>{saving ? "处理中…" : deleteMode === "purge" ? "彻底删除" : "删除并保留付款"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    {!authRequired && renewalItem && <RenewalDialog key={renewalItem.id} item={renewalItem} today={today} onClose={() => setRenewalItem(null)} onSave={(payment,mode) => quickRenew(renewalItem,payment,mode)} />}
    {!authRequired && historyOpen && <HistoryDialog key={historyItem?.id || "all"} open={historyOpen} onOpenChange={setHistoryOpen} subscriptionId={historyItem?.id} subscriptionName={historyItem?.name} today={today} items={items} onChanged={() => void loadRecords(true)} onRenew={item => {setHistoryOpen(false);setRenewalItem(item);}} />}
    {!authRequired && backupOpen && <BackupDialog open={backupOpen} onOpenChange={setBackupOpen} onImported={async () => { await loadRecords(); }} />}
    <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSuccess={loadRecords} />
    <Toaster position="bottom-right" richColors theme="light" />
  </div>;
}
