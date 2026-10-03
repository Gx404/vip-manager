import { ArrowLeft, BarChart3, CalendarDays, Coins, PieChart, TrendingUp } from "lucide-react";
import { currencyMeta, money } from "../../../shared/currency.ts";
import { spendingReport } from "../../../shared/reports.ts";
import { cycles, monthlyCostCny, type Subscription } from "@/lib/subscriptions";
import { ServiceLogo } from "@/components/service-logo";
type Props = { items: Subscription[]; today: string; onBack: () => void };

/** Read-only budget report; source amounts and their frozen conversion basis remain inspectable. */
export function ReportPage({ items, today, onBack }: Props) {
  const report = spendingReport(items, today);
  const maxCategory = Math.max(...report.categories.map(item => item.monthly), 1);
  return <section className="report-page" aria-label="支出分析">
    <div className="report-heading"><div><p>SPENDING OVERVIEW</p><h2>金额与支出分析</h2><span>哪些会员花得最多，一眼看清。</span></div><button className="button light" onClick={onBack}><ArrowLeft size={16} />返回订阅</button></div>
    <div className="report-kpis">
      <div><span><TrendingUp size={15} />月均折算</span><strong>{money(report.monthly)}</strong><small>维持当前订阅，年化约 {money(report.annual)}</small></div>
      <div><span><PieChart size={15} />未到期订阅</span><strong>{report.active.length}<em>项</em></strong><small>{report.expired} 项已过期，不计入预算</small></div>
      <div><span><Coins size={15} />付款币种</span><strong>{report.currencies.length}<em>种</em></strong><small>统一按购买期锁定汇率折算人民币</small></div>
    </div>
    {!report.active.length && <div className="report-section muted">暂无未到期订阅。添加记录后，这里会展示你的支出结构。</div>}
    <div className="report-columns">
      <section className="report-section"><h3><BarChart3 size={16} />支出类型占比</h3><div className="report-bars">{report.categories.map((item, index) => <div className="report-bar-row" key={item.label}>
        <span>{item.label}<small>{item.count} 项 · {item.share.toFixed(1)}%</small></span>
        <div aria-hidden="true"><i style={{ width: `${item.monthly / maxCategory * 100}%`, background: `hsl(${158 + index * 26} 48% 44%)` }} /></div>
        <b>{money(item.monthly)}<small>/月</small></b>
      </div>)}</div></section>
      <section className="report-section"><h3><TrendingUp size={16} />月均费用排行 · TOP 5</h3><ul className="report-list">{report.ranking.map((item,index) => <li key={item.id}>
        <span className="report-ranked"><em>{index + 1}</em><ServiceLogo name={item.name} color={item.color} /><span><strong>{item.name}</strong><small>{item.category} · {money(item.amount,item.currency)} / {cycles[item.cycle]}</small></span></span>
        <b>{money(monthlyCostCny(item))}<small>/月</small></b>
      </li>)}</ul></section>
      <section className="report-section"><h3><Coins size={16} />按付款币种</h3><ul className="report-list">{report.currencies.map(item => <li key={item.code}>
        <span><strong>{item.code} · {currencyMeta(item.code).label}</strong><small>{item.count} 项 · 原币月均 {money(item.originalMonthly,item.code)}</small></span>
        <b>{money(item.monthly)}<small>/月</small></b>
      </li>)}</ul></section>
      <section className="report-section"><h3><CalendarDays size={16} />周期与续费方式</h3><ul className="report-list">{report.cycles.map(item => <li key={item.label}><span><strong>{cycles[item.label as Subscription["cycle"]]}</strong><small>{item.count} 项 · {item.share.toFixed(1)}% 预算</small></span><b>{money(item.monthly)}<small>/月</small></b></li>)}</ul>
        <div className="report-modes">{report.modes.map(item => <span key={item.label}>{item.label} · {item.count} 项 <b>{money(item.monthly)}/月</b></span>)}</div>
      </section>
    </div>
    <section className="report-section"><h3><Coins size={16} />外币折算依据</h3><div className="report-fx">{report.active.filter(item => item.currency && item.currency !== "CNY").map(item => <div key={item.id}><strong>{item.name}</strong><span>购买日期 {item.purchaseDate}</span><span>1 {item.currency} = ¥{item.fxRateToCny}</span><small>{item.fxRateSource === "frankfurter" ? "历史参考" : "手动结算"} · 报价日期 {item.fxRateDate}</small></div>)}</div>
      {!report.active.some(item => item.currency && item.currency !== "CNY") && <p className="muted">当前均为人民币，无需汇率折算。</p>}
    </section>
    <p className="report-note">统计口径：未过期记录（包括尚未开始的账期）；月付原价、季付 ÷3、年付 ÷12、自定义周期 ÷天数 ×30，再乘每条记录保存的购买期汇率。年化是维持当前订阅的预算估算，不是年度实付；未记录的历史扣款不会被补造。所有金额按未取整值汇总后显示。</p>
  </section>;
}
