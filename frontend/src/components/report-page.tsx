import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, TrendingUp } from "lucide-react";
import { money } from "../../../shared/currency.ts";
import { paymentReport } from "../../../shared/payment-reports.ts";
import type { Subscription } from "@/lib/subscriptions";
import type { BillingFact, RenewalLog } from "../../../shared/renewals.ts";
import { apiRequest } from "@/lib/api";
import { ServiceLogo } from "@/components/service-logo";

type Props={items:Subscription[];today:string;revision:boolean;onBack:()=>void;onHistory:(id?:string)=>void};
export function ReportPage({items,today,revision,onBack,onHistory}:Props) {
  const [logs,setLogs]=useState<RenewalLog[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [billingFacts,setBillingFacts]=useState<BillingFact[]>([]);
  const [range,setRange]=useState("month"),[month,setMonth]=useState(today.slice(0,7)),[retry,setRetry]=useState(0);
  useEffect(()=>{let active=true;setError("");setLoading(true);void apiRequest<{logs:RenewalLog[];billingFacts?:BillingFact[]}>("/payments").then(data=>{if(active){setLogs(data.logs);setBillingFacts(data.billingFacts??[]);}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[revision,retry]);
  useEffect(()=>{const refresh=()=>{if(document.visibilityState==="visible")setRetry(n=>n+1);};const timer=window.setInterval(refresh,60_000);document.addEventListener("visibilitychange",refresh);return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",refresh);};},[]);
  const selectedMonth=/^\d{4}-(0[1-9]|1[0-2])$/.test(month)?month:today.slice(0,7);
  const year=selectedMonth.slice(0,4);
  const report=paymentReport(logs,items,today,range==="all"?"":range==="year"?year:selectedMonth,"accrual",billingFacts);
  const chart=range==="all"?report.years:report.months;
  const availableYears=[...new Set([...report.years.map(row=>row.key),year])].sort().reverse();
  const periodLabel=range==="all"?"全部记录":range==="year"?`${year} 年`:`${year} 年 ${Number(selectedMonth.slice(5))} 月`;
  const selectedMonthTotal=report.months.find(row=>row.key===selectedMonth)?.amount??0;
  const selectedYearTotal=report.years.find(row=>row.key===year)?.amount??0;
  const selectedMonthMissing=report.months.find(row=>row.key===selectedMonth)?.missingRates??0;
  const selectedYearMissing=report.years.find(row=>row.key===year)?.missingRates??0;
  const selectedMonthLabel=`${Number(selectedMonth.slice(5))}月消费`;
  const selectedYearLabel=`${year}年消费`;
  const max=Math.max(1,...chart.map(row=>row.amount));
  const ready=!loading&&!error;
  function selectBar(key:string) {
    if(range==="all") {setRange("year");setMonth(`${key}-01`);}
    else {setRange("month");setMonth(key);}
  }
  return <section className="report-page spending-page" aria-label="支出分析">
    <div className="report-heading"><div><p className="report-eyebrow">订阅费用 · 一目了然</p><h2>支出分析</h2><p className="muted">看清已经花了多少，以及订阅费用明细。</p></div><button className="button light" onClick={onBack}><ArrowLeft size={16}/>返回订阅</button></div>
    {error&&<div role="alert" className="sync-banner">{error}<button className="text-action" onClick={()=>setRetry(n=>n+1)}>重新读取</button></div>}
    <div className="report-context"><span>月均支出 <b>{money(report.monthly)}</b>{report.ratePending?`（${report.ratePending} 项汇率待补全，未计入）`:""} · 按当前有效订阅摊算</span><button className="text-action" onClick={()=>onHistory()}>管理流水{report.pending>0?` · ${report.pending} 笔待确认`:""}<ArrowUpRight size={14}/></button></div>
    <div className="report-kpis payment-kpis spending-kpis">
      <div><span>{selectedYearLabel}</span><strong>{ready?(selectedYearMissing>0&&selectedYearTotal===0?"汇率待补":money(selectedYearTotal)):"—"}</strong>{ready&&selectedYearMissing>0&&<small>{selectedYearMissing} 笔汇率待补，未计入合计</small>}</div>
      <div><span>{selectedMonthLabel}</span><strong>{ready?(selectedMonthMissing>0&&selectedMonthTotal===0?"汇率待补":money(selectedMonthTotal)):"—"}</strong>{ready&&selectedMonthMissing>0&&<small>{selectedMonthMissing} 笔汇率待补，未计入合计</small>}</div>
    </div>
    <div className="report-columns report-primary">
      <section className="report-section trend-section" aria-label="消费趋势">
        <div className="analysis-filter report-filter">
          <h3><TrendingUp size={16}/>{range==="all"?"历年消费趋势":`${year} 年消费趋势`}</h3>
          <div className="analysis-controls">
            <select aria-label="统计范围" value={range} onChange={e=>setRange(e.target.value)}><option value="month">按月查看</option><option value="year">按年查看</option><option value="all">全部记录</option></select>
            {range!=="all"&&<select aria-label="统计年份" value={year} onChange={e=>setMonth(`${e.target.value}-${selectedMonth.slice(5)}`)}>{availableYears.map(value=><option key={value} value={value}>{value}年</option>)}</select>}
            {range==="month"&&<select aria-label="统计月份" value={selectedMonth.slice(5)} onChange={e=>setMonth(`${year}-${e.target.value}`)}>{Array.from({length:12},(_,index)=><option key={index} value={String(index+1).padStart(2,"0")}>{index+1}月</option>)}</select>}
          </div>
        </div>
        <div className="chart-scroll"><div className="payment-chart" aria-label={range==="all"?"历年消费金额":`${year} 年每月消费金额`} style={{gridTemplateColumns:`repeat(${chart.length},minmax(0,1fr))`,minWidth:chart.length>12?`${chart.length*42}px`:undefined}}>
          {chart.map(row=><button key={row.key} data-period={row.key} className={`chart-column${range==="month"&&selectedMonth===row.key?" selected":""}`} onClick={()=>selectBar(row.key)} title={`${row.key}：${ready?`${money(row.amount)}${row.missingRates>0?`，${row.missingRates} 笔汇率待补`:""}`:"正在读取"}`} aria-label={`${row.key}，${ready?`${money(row.amount)}${row.missingRates>0?`，${row.missingRates} 笔汇率待补`:""}`:"正在读取"}`} aria-pressed={range==="month"&&selectedMonth===row.key}>
            <span className="chart-track">{ready&&row.amount>0&&<span className="chart-bar" style={{height:`${Math.max(3,row.amount/max*100)}%`}}><i/><span className="chart-value">{Math.round(row.amount)}</span></span>}</span>
            <small>{range==="all"?`${row.key}年`:`${Number(row.key.slice(5))}月`}</small>
          </button>)}
        </div></div>
      </section>
      <section className="report-section report-details" aria-label="订阅费用明细">
        <div className="report-details-heading"><div><h3>费用明细</h3><small>{periodLabel}{ready&&report.missingRates>0?` · ${report.missingRates} 笔汇率待补`:""}</small></div><b className="report-period-total">{ready?(report.missingRates>0&&report.total===0?"汇率待补":money(report.total)):"—"}</b></div>
        <ul className="report-list">{ready&&report.details.map((r,n)=><li key={r.id} data-source={r.source}>
          <span className="report-ranked"><em>{n+1}</em><ServiceLogo name={r.label} color={items.find(i=>i.id===r.subscriptionId)?.color??"#269979"}/><span><strong>{r.label}</strong>{r.plan&&<small>{r.plan}</small>}<small>{r.startDate} — {r.endDate}</small></span></span><b>{r.allocated===null?<>{money(r.originalAmount,r.currency)}<small className="report-fx-pending">汇率待补</small></>:money(r.allocated)}</b>
        </li>)}</ul>{ready&&!report.details.length&&<p className="ledger-empty">这段时间暂无消费记录。</p>}
      </section>
    </div>
  </section>;
}
