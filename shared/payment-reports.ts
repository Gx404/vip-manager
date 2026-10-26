import type { BillingFact, RenewalLog } from "./renewals.ts";
import { paymentCny, paymentState } from "./payments.ts";
import type { Subscription } from "./subscriptions.ts";
import { allocatedEntry, entryAmount, reportEntries, type ReportEntry } from "./report-entries.ts";

export type ReportBasis = "cash" | "accrual";
export type SpendingSummary = {
  monthTotal: number; yearTotal: number; monthCount: number; yearCount: number;
  monthMissingRates: number; yearMissingRates: number;
};
/** Safe aggregate for the dashboard; no estimates, names, dates, or private receipt details. */
export function spendingSummary(logs: RenewalLog[], today: string): SpendingSummary {
  const paid=logs.filter(log=>paymentState(log)==="paid"&&log.payment!.paidOn<=today);
  const month=paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,7)));
  const year=paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,4)));
  const sum=(rows:RenewalLog[])=>rows.reduce((n,log)=>n+(paymentCny(log.payment!)??0),0);
  const missing=(rows:RenewalLog[])=>rows.filter(log=>paymentCny(log.payment!)===null).length;
  return {monthTotal:sum(month),yearTotal:sum(year),monthCount:month.length,yearCount:year.length,monthMissingRates:missing(month),yearMissingRates:missing(year)};
}
/** Put a confirmed payment in the month it was actually paid. */
export function allocatedPayment(log: RenewalLog, period: string): number | null {
  const p=log.payment!;
  return !period || p.paidOn.startsWith(period) ? paymentCny(p) : 0;
}

/** An automatic catch-up remains actionable only while part of its new coverage is unconfirmed. */
export function pendingRenewals(logs: RenewalLog[], today: string, billingFacts: BillingFact[] = []): RenewalLog[] {
  return logs.filter(log => {
    if (paymentState(log) !== "pending") return false;
    const start = log.kind === "automatic" && log.periods > 1 ? log.previousEndDate : log.newStartDate;
    let cursor = start;
    const intervals = [
      ...logs.filter(row => row.subscriptionId === log.subscriptionId && paymentState(row) === "paid" && row.payment!.paidOn <= today)
        .map(row => row.payment!),
      ...billingFacts.filter(fact => fact.subscriptionId === log.subscriptionId && fact.excludedPeriod).map(fact => fact.excludedPeriod!),
    ].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
    for (const interval of intervals) {
      if (interval.startDate > cursor) break;
      if (interval.endDate > cursor) cursor = interval.endDate;
      if (cursor >= log.newEndDate) return false;
    }
    return cursor < log.newEndDate;
  });
}

/** Paid-only reporting; legacy basis and billing-fact parameters remain API-compatible. */
export function paymentReport(logs: RenewalLog[], items: Subscription[], today: string, period = today.slice(0,7), basis: ReportBasis = "cash", billingFacts: BillingFact[] = []) {
  const paid = logs.filter(log => paymentState(log)==="paid" && log.payment!.paidOn<=today);
  const sum = (rows: RenewalLog[]) => rows.reduce((n,log)=>n+(paymentCny(log.payment!) ?? 0),0);
  const missing = (rows: RenewalLog[]) => rows.filter(log=>paymentCny(log.payment!) === null).length;
  const sources=reportEntries(logs,items,today,billingFacts), entries=sources[basis];
  // Actual payment dates drive every calendar bucket. Coverage and prices never create expenditure.
  const matches=(entry:ReportEntry,key:string)=>!key || entry.paidOn.startsWith(key);
  const value=(entry:ReportEntry,key:string)=>basis==="cash"?entryAmount(entry):allocatedEntry(entry,key);
  const selected=entries.filter(entry=>matches(entry,period));
  const details=selected.map(entry=>({...entry,allocated:value(entry,period)})).sort((a,b)=>(b.allocated ?? -1)-(a.allocated ?? -1)||a.label.localeCompare(b.label));
  function group(by: "category" | "subscription") {
    const groups = new Map<string,{id:string;label:string;plan:string;amount:number;count:number;missingRates:number}>();
    for(const entry of selected) {
      const id=by==="category"?entry.category:entry.subscriptionId;
      const group=groups.get(id)??{id,label:by==="category"?entry.category:entry.label,plan:by==="category"?"":entry.plan,amount:0,count:0,missingRates:0};
      const amount=value(entry,period);
      if(amount === null) group.missingRates++; else group.amount+=amount;
      group.count++;groups.set(id,group);
    }
    return [...groups.values()].sort((a,b)=>b.amount-a.amount);
  }
  const bucket=(key:string)=>{
    const rows=entries.filter(entry=>matches(entry,key));
    return {key,amount:rows.reduce((n,entry)=>n+(value(entry,key) ?? 0),0),count:rows.length,missingRates:rows.filter(entry=>value(entry,key) === null).length};
  };
  // Month and year filters share the selected calendar year's January–December chart.
  const chartYear=period.slice(0,4)||today.slice(0,4);
  const months=Array.from({length:12},(_,n)=>bucket(`${chartYear}-${String(n+1).padStart(2,"0")}`));
  const firstYear=Math.min(Number(today.slice(0,4)),...entries.map(entry=>Number(entry.paidOn.slice(0,4))));
  const years=Array.from({length:Number(today.slice(0,4))-firstYear+1},(_,n)=>bucket(String(firstYear+n)));
  const upcoming:{id:string;name:string;plan:string;date:string;amount:number;currency:Subscription["currency"];cny:number|null}[]=[];
  const recordedYear=entries.filter(entry=>entry.paidOn.startsWith(today.slice(0,4)));
  const confirmedCount=selected.filter(entry=>entry.source==="payment").length, subscriptionCount=selected.length-confirmedCount;
  return {monthTotal:sum(paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,7)))),yearTotal:sum(paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,4)))),
    monthCount:paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,7))).length,yearCount:paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,4))).length,
    monthMissingRates:missing(paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,7)))),yearMissingRates:missing(paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,4)))),
    total:selected.reduce((n,entry)=>n+(value(entry,period) ?? 0),0),missingRates:selected.filter(entry=>value(entry,period) === null).length,selectedCount:selected.length,confirmedCount,subscriptionCount,details,
    recordedMonthTotal:bucket(today.slice(0,7)).amount,
    recordedMonthMissingRates:bucket(today.slice(0,7)).missingRates,recordedYearMissingRates:bucket(today.slice(0,4)).missingRates,
    recordedYearTotal:bucket(today.slice(0,4)).amount,recordedYearCount:recordedYear.length,recordedYearSubscriptionCount:recordedYear.filter(entry=>entry.source==="subscription").length,
    months,years,categories:group("category"),ranking:group("subscription"),
    upcoming,forecast:0,pending:pendingRenewals(logs,today,billingFacts).length,
    monthly:0,ratePending:0,paidRatePending:missing(paid)};
}
