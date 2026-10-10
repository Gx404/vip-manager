import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, CalendarDays, TrendingUp } from "lucide-react";
import { money } from "../../../shared/currency.ts";
import { paymentReport } from "../../../shared/payment-reports.ts";
import type { Subscription } from "@/lib/subscriptions";
import type { RenewalLog } from "../../../shared/renewals.ts";
import { apiRequest } from "@/lib/api";
import { ServiceLogo } from "@/components/service-logo";
type Props={items:Subscription[];today:string;revision:boolean;onBack:()=>void;onHistory:(id?:string)=>void};
export function ReportPage({items,today,revision,onBack,onHistory}:Props) {
  const [logs,setLogs]=useState<RenewalLog[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [range,setRange]=useState("month"),[month,setMonth]=useState(today.slice(0,7)),[retry,setRetry]=useState(0);
  useEffect(()=>{let active=true;setError("");setLoading(true);void apiRequest<{logs:RenewalLog[]}>("/payments").then(data=>{if(active)setLogs(data.logs);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[revision,retry]);
  const report=paymentReport(logs,items,today,range==="all"?"":range==="year"?today.slice(0,4):month);
  const max=Math.max(1,...report.months.map(m=>m.amount));
  const ready=!loading&&!error;
  return <section className="report-page spending-page" aria-label="支出分析">
    <div className="report-heading"><div><p className="report-eyebrow">订阅费用 · 一目了然</p><h2>支出分析</h2><p className="muted">看清已经花了多少，以及接下来需要准备多少。</p></div><button className="button light" onClick={onBack}><ArrowLeft size={16}/>返回订阅</button></div>
    {error&&<div role="alert" className="sync-banner">{error}<button className="text-action" onClick={()=>setRetry(n=>n+1)}>重新读取</button></div>}
    <div className="report-kpis payment-kpis">
      <div><span>本月已支付</span><strong>{ready?(report.monthCount?money(report.monthTotal):"待补录"):"—"}</strong><small>{ready?`${report.monthCount} 笔已确认付款 · ${today.slice(0,7)}`:"正在读取流水…"}</small></div>
      <div><span>今年已支付</span><strong>{ready?(report.yearCount?money(report.yearTotal):"待补录"):"—"}</strong><small>{ready?`${report.yearCount} 笔已确认付款 · ${today.slice(0,4)}`:"正在读取流水…"}</small></div>
      <div className="forecast-kpi"><span>未来 30 天预计续费</span><strong>{money(report.forecast)}</strong><small>{new Set(report.upcoming.map(i=>i.id)).size} 项订阅 · {report.upcoming.length} 次预计续费{report.upcoming.some(i=>i.cny===null)?" · 部分汇率待补全":""}</small></div>
    </div>
    <div className="report-context"><span>当前订阅月均约 <b>{money(report.monthly)}</b>{report.ratePending?`（${report.ratePending} 项汇率待补全，未计入）`:""} · 外币为参考折算</span><button className="text-action" onClick={()=>onHistory()}>管理流水{report.pending>0?` · ${report.pending} 笔待确认`:""}<ArrowUpRight size={14}/></button></div>
    <div className="report-columns report-primary">
      <section className="report-section trend-section"><div className="ledger-subheading"><h3><TrendingUp size={16}/>近 12 个月支出</h3><small>按付款日期</small></div><div className="payment-chart" aria-label="每月已记录支出">{report.months.map(m=><button key={m.key} className={`chart-column${month===m.key&&range==="month"?" selected":""}`} onClick={()=>{setRange("month");setMonth(m.key);}} title={`${m.key}：${m.count?money(m.amount):"未录入付款"}`} aria-label={`${m.key}，${m.count?money(m.amount):"待补录"}`}><span className="chart-value">{ready&&m.count?Math.round(m.amount):"—"}</span><span className="chart-track"><i style={{height:ready&&m.count?`${Math.max(3,m.amount/max*100)}%`:"0%"}}/>{ready&&!m.count&&<em/>}</span><small>{Number(m.key.slice(5))}月</small></button>)}</div><p className="chart-caption">仅展示已确认流水；空缺月份不代表零支出，已有记录也可能尚未补齐。</p></section>
      <section className="report-section upcoming-section"><div className="ledger-subheading"><h3><CalendarDays size={16}/>即将续费</h3><small>未来 30 天</small></div><ul className="report-list upcoming-list">{report.upcoming.map((item,n)=><li key={`${item.id}-${n}`}><time>{item.date.slice(5).replace("-","/")}</time><span><strong>{item.name}</strong><small>{item.plan||"订阅续费"}</small></span><b>{money(item.amount,item.currency)}</b></li>)}</ul>{!report.upcoming.length&&<p className="ledger-empty">未来 30 天暂无预计续费。</p>}<p className="chart-caption">假设继续订阅，按当前价格和已保存汇率估算。</p></section>
    </div>
    <div className="analysis-filter"><div><strong>钱花在哪里</strong><small>所选期间已记录 {ready?report.selectedCount:"—"} 笔 · {ready?money(report.total):"—"}</small></div><div className="analysis-controls"><select aria-label="统计范围" value={range} onChange={e=>setRange(e.target.value)}><option value="month">按月查看</option><option value="year">今年</option><option value="all">全部记录</option></select>{range==="month"&&<input aria-label="统计月份" type="month" value={month} onChange={e=>setMonth(e.target.value)}/>}</div></div>
    <div className="report-columns">
      <section className="report-section"><h3>分类支出</h3>{ready&&report.categories.length?<div className="report-bars">{report.categories.map((c,n)=><div className="report-bar-row" key={c.id}><span>{c.label}<small>{c.count} 笔 · {report.total?(c.amount/report.total*100).toFixed(1):"0"}%</small></span><div aria-hidden="true"><i style={{width:`${report.total?c.amount/report.total*100:0}%`,background:`hsl(160 36% ${38+n*5}%)`}}/></div><b>{money(c.amount)}</b></div>)}</div>:<p className="ledger-empty">{loading?"正在读取…":error?"流水读取失败":"这段时间还没有已确认的支付记录。"}</p>}</section>
      <section className="report-section"><h3>订阅花费排行 · TOP 5</h3><ul className="report-list">{ready&&report.ranking.map((r,n)=><li key={r.id}><span className="report-ranked"><em>{n+1}</em><ServiceLogo name={r.label} color={items.find(i=>i.id===r.id)?.color??"#269979"}/><span><strong>{r.label}</strong><small>{r.plan||`${r.count} 笔付款`}</small></span></span><button className="text-action" onClick={()=>onHistory(r.id)}>{money(r.amount)}<ArrowUpRight size={13}/></button></li>)}</ul>{ready&&!report.ranking.length&&<p className="ledger-empty">补录历史或确认付款后，即可查看排行。</p>}</section>
    </div>
  </section>;
}
