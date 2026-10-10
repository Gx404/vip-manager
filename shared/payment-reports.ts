import type { RenewalLog } from "./renewals.ts";
import { paymentCny, paymentState } from "./payments.ts";
import { monthlyCostCny, type Subscription } from "./subscriptions.ts";
import { allocatedEntry, entryAmount, reportEntries, type ReportEntry } from "./report-entries.ts";

export type ReportBasis = "cash" | "accrual";
/** Put a confirmed payment in the month it was actually paid. */
export function allocatedPayment(log: RenewalLog, period: string): number {
  const p=log.payment!;
  return !period || p.paidOn.startsWith(period) ? paymentCny(p) : 0;
}

/** Known subscription periods supplement the ledger; confirmed cash remains separately identifiable. */
export function paymentReport(logs: RenewalLog[], items: Subscription[], today: string, period = today.slice(0,7), basis: ReportBasis = "cash") {
  const paid = logs.filter(log => paymentState(log)==="paid" && log.payment!.paidOn<=today);
  const sum = (rows: RenewalLog[]) => rows.reduce((n,log)=>n+paymentCny(log.payment!),0);
  const sources=reportEntries(logs,items,today), entries=sources[basis];
  // Both report views use one billing bucket: a known payment belongs to its
  // paid month, while an estimate uses the saved period start as its record
  // month. The cash view still filters out inferred entries whose period is
  // blocked by a pending/confirmed ledger event.
  const matches=(entry:ReportEntry,key:string)=>!key || entry.paidOn.startsWith(key);
  const value=(entry:ReportEntry,key:string)=>basis==="cash"?entryAmount(entry):allocatedEntry(entry,key);
  const selected=entries.filter(entry=>matches(entry,period));
  const details=selected.map(entry=>({...entry,allocated:value(entry,period)})).sort((a,b)=>b.allocated-a.allocated||a.label.localeCompare(b.label));
  function group(by: "category" | "subscription") {
    const groups = new Map<string,{id:string;label:string;plan:string;amount:number;count:number}>();
    for(const entry of selected) {
      const id=by==="category"?entry.category:entry.subscriptionId;
      const group=groups.get(id)??{id,label:by==="category"?entry.category:entry.label,plan:by==="category"?"":entry.plan,amount:0,count:0};
      group.amount+=value(entry,period);group.count++;groups.set(id,group);
    }
    return [...groups.values()].sort((a,b)=>b.amount-a.amount);
  }
  const bucket=(key:string)=>{
    const rows=entries.filter(entry=>matches(entry,key));
    return {key,amount:rows.reduce((n,entry)=>n+value(entry,key),0),count:rows.length};
  };
  // Month and year filters share the selected calendar year's January–December chart.
  const chartYear=period.slice(0,4)||today.slice(0,4);
  const months=Array.from({length:12},(_,n)=>bucket(`${chartYear}-${String(n+1).padStart(2,"0")}`));
  const firstYear=Math.min(Number(today.slice(0,4)),...entries.map(entry=>Number(entry.paidOn.slice(0,4))));
  const years=Array.from({length:Number(today.slice(0,4))-firstYear+1},(_,n)=>bucket(String(firstYear+n)));
  const upcoming:{id:string;name:string;plan:string;date:string;amount:number;currency:Subscription["currency"];cny:number|null}[]=[];
  for(const item of items) {
    // Outstanding monthly renewals stay inside this calendar month. Paid bills
    // and next month's renewals must not reappear in the expected bill total.
    const date=item.endDate;
    if(item.cycle!=="monthly" || item.amount<=0 || date<today || !date.startsWith(today.slice(0,7)))continue;
    if(paid.some(log=>log.subscriptionId===item.id&&log.payment!.startDate<=date&&log.payment!.endDate>date))continue;
    upcoming.push({id:item.id,name:item.name,plan:item.plan,date,amount:item.amount,currency:item.currency,cny:item.ratePending?null:item.amount*(item.fxRateToCny??1)});
  }
  upcoming.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
  const recordedYear=entries.filter(entry=>entry.paidOn.startsWith(today.slice(0,4)));
  const confirmedCount=selected.filter(entry=>entry.source==="payment").length, subscriptionCount=selected.length-confirmedCount;
  return {monthTotal:sum(paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,7)))),yearTotal:sum(paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,4)))),
    monthCount:paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,7))).length,yearCount:paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,4))).length,
    total:selected.reduce((n,entry)=>n+value(entry,period),0),selectedCount:selected.length,confirmedCount,subscriptionCount,details,
    recordedMonthTotal:bucket(today.slice(0,7)).amount,
    recordedYearTotal:bucket(today.slice(0,4)).amount,recordedYearCount:recordedYear.length,recordedYearSubscriptionCount:recordedYear.filter(entry=>entry.source==="subscription").length,
    months,years,categories:group("category"),ranking:group("subscription"),
    upcoming,forecast:upcoming.reduce((n,p)=>n+(p.cny??0),0),pending:logs.filter(log=>paymentState(log)==="pending").length,
    monthly:items.filter(i=>i.endDate>=today).reduce((n,i)=>n+monthlyCostCny(i),0),ratePending:items.filter(i=>i.ratePending).length};
}
