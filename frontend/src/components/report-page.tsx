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
  const selectedMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:today.slice(0,7);
  const year=selectedMonth.slice(0,4);
  const report=paymentReport(logs,items,today,range==="all"?"":range==="year"?year:selectedMonth,"accrual");
  const chart=range==="all"?report.years:report.months;
  const availableYears=[...new Set([...report.years.map(row=>row.key),year])].sort().reverse();
  const periodLabel=range==="all"?"全部记录":range==="year"?`${year} 年`:`${year} 年 ${Number(selectedMonth.slice(5))} 月`;
  const max=Math.max(1,...chart.map(row=>row.amount));
  const ready=!loading&&!error;
  function selectBar(key:string) {
    if(range==="all") {setRange("year");setMonth(`${key}-01`);}
    else {setRange("month");setMonth(key);}
  }
  return <section className="report-page spending-page" aria-label="支出分析">
    <div className="report-heading"><div><p className="report-eyebrow">订阅费用 · 一目了然</p><h2>支出分析</h2><p className="muted">看清已经花了多少，以及接下来需要准备多少。</p></div><button className="button light" onClick={onBack}><ArrowLeft size={16}/>返回订阅</button></div>
    {error&&<div role="alert" className="sync-banner">{error}<button className="text-action" onClick={()=>setRetry(n=>n+1)}>重新读取</button></div>}
    <div className="report-kpis payment-kpis">
      <div><span>本月消费金额</span><strong>{ready?money(report.recordedMonthTotal):"—"}</strong></div>
      <div><span>本年消费金额</span><strong>{ready?money(report.recordedYearTotal):"—"}</strong></div>
      <div className="forecast-kpi"><span>本月预计付费账单</span><strong>{ready?money(report.forecast):"—"}</strong></div>
    </div>
    <div className="report-context"><span>当前订阅月均约 <b>{money(report.monthly)}</b>{report.ratePending?`（${report.ratePending} 项汇率待补全，未计入）`:""} · 外币为参考折算</span><button className="text-action" onClick={()=>onHistory()}>管理流水{report.pending>0?` · ${report.pending} 笔待确认`:""}<ArrowUpRight size={14}/></button></div>
    <div className="report-columns report-primary">
      <section className="report-section trend-section" aria-label="消费趋势">
        <div className="analysis-filter report-filter">
          <h3><TrendingUp size={16}/>{range==="all"?"历年消费趋势":`${year} 年消费趋势`}</h3>
          <div className="analysis-controls">
            <select aria-label="统计范围" value={range} onChange={e=>setRange(e.target.value)}><option value="month">按月查看</option><option value="year">按年查看</option><option value="all">全部记录</option></select>
            {range==="month"&&<input aria-label="统计月份" type="month" min="1900-01" max="2200-12" value={month} onChange={e=>setMonth(e.target.value)}/>}
            {range==="year"&&<select aria-label="统计年份" value={year} onChange={e=>setMonth(`${e.target.value}-${selectedMonth.slice(5)}`)}>{availableYears.map(value=><option key={value} value={value}>{value} 年</option>)}</select>}
          </div>
        </div>
        <div className="chart-scroll"><div className="payment-chart" aria-label={range==="all"?"历年消费金额":`${year} 年每月消费金额`} style={{gridTemplateColumns:`repeat(${chart.length},minmax(0,1fr))`,minWidth:chart.length>12?`${chart.length*42}px`:undefined}}>
          {chart.map(row=><button key={row.key} data-period={row.key} className={`chart-column${range==="month"&&selectedMonth===row.key?" selected":""}`} onClick={()=>selectBar(row.key)} title={`${row.key}：${ready?money(row.amount):"正在读取"}`} aria-label={`${row.key}，${ready?money(row.amount):"正在读取"}`}>
            <span className="chart-value">{ready&&row.amount>0?Math.round(row.amount):""}</span>
            <span className="chart-track">{ready&&row.amount>0&&<i style={{height:`${Math.max(3,row.amount/max*100)}%`}}/>}</span>
            <small>{range==="all"?`${row.key}年`:`${Number(row.key.slice(5))}月`}</small>
          </button>)}
        </div></div>
      </section>
      <section className="report-section upcoming-section">
        <div className="ledger-subheading"><h3><CalendarDays size={16}/>本月预计付费账单</h3></div>
        <ul className="report-list upcoming-list">{ready&&report.upcoming.map(item=><li key={`${item.id}-${item.date}`}><time>{item.date.slice(5).replace("-","/")}</time><span><strong>{item.name}</strong>{item.plan&&<small>{item.plan}</small>}</span><b>{money(item.amount,item.currency)}</b></li>)}</ul>
        {(!ready||!report.upcoming.length)&&<p className="ledger-empty">{loading?"正在读取…":error?"账单读取失败":"本月暂无待付账单。"}</p>}
      </section>
    </div>
    <div className="analysis-filter report-detail-heading"><div><strong>费用明细</strong><small>{periodLabel}</small></div><b className="report-period-total">{ready?money(report.total):"—"}</b></div>
    <div className="report-columns">
      <section className="report-section"><h3>分类支出</h3>{ready&&report.categories.length?<div className="report-bars">{report.categories.map((c,n)=><div className="report-bar-row" key={c.id}><span>{c.label}<small>{report.total?(c.amount/report.total*100).toFixed(1):"0"}%</small></span><div aria-hidden="true"><i style={{width:`${report.total?c.amount/report.total*100:0}%`,background:`hsl(160 36% ${38+n*5}%)`}}/></div><b>{money(c.amount)}</b></div>)}</div>:<p className="ledger-empty">{loading?"正在读取…":error?"流水读取失败":"这段时间暂无消费记录。"}</p>}</section>
      <section className="report-section report-details" aria-label="订阅费用明细"><h3>订阅费用明细 · {report.ranking.length} 项</h3><ul className="report-list">{ready&&report.details.map((r,n)=><li key={r.id} data-source={r.source}>
        <span className="report-ranked"><em>{n+1}</em><ServiceLogo name={r.label} color={items.find(i=>i.id===r.subscriptionId)?.color??"#269979"}/><span><strong>{r.label}</strong>{r.plan&&<small>{r.plan}</small>}<small>{r.startDate} — {r.endDate}</small></span></span><b>{money(r.allocated)}</b>
      </li>)}</ul>{ready&&!report.details.length&&<p className="ledger-empty">这段时间暂无消费记录。</p>}</section>
    </div>
  </section>;
}
