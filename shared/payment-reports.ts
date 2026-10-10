import type { RenewalLog } from "./renewals.ts";
import { paymentCny, paymentState } from "./payments.ts";
import { monthlyCostCny, shiftDate, type Subscription } from "./subscriptions.ts";
import { cycleBoundary } from "./billing.ts";

/** Actual recorded payments by payment date; forecast amounts remain explicitly separate. */
export function paymentReport(logs: RenewalLog[], items: Subscription[], today: string, period = today.slice(0,7)) {
  const paid = logs.filter(log => paymentState(log)==="paid" && log.payment!.paidOn<=today);
  const sum = (rows: RenewalLog[]) => rows.reduce((n,log)=>n+paymentCny(log.payment!),0);
  const selected = paid.filter(log=>log.payment!.paidOn.startsWith(period));
  function group(by: "category" | "subscription") {
    const groups = new Map<string,{id:string;label:string;plan:string;amount:number;count:number}>();
    for(const log of selected) {
      const p=log.payment!, id=by==="category"?p.category:log.subscriptionId;
      const value=groups.get(id)??{id,label:by==="category"?p.category:log.subscriptionName,plan:by==="category"?"":p.plan,amount:0,count:0};
      value.amount+=paymentCny(p);value.count++;groups.set(id,value);
    }
    return [...groups.values()].sort((a,b)=>b.amount-a.amount);
  }
  const months=Array.from({length:12},(_,n)=>{
    const d=new Date(Date.UTC(Number(today.slice(0,4)),Number(today.slice(5,7))-12+n,1));
    const key=d.toISOString().slice(0,7), rows=paid.filter(log=>log.payment!.paidOn.startsWith(key));
    return {key,amount:sum(rows),count:rows.length};
  });
  const upcoming:{id:string;name:string;plan:string;date:string;amount:number;currency:Subscription["currency"];cny:number|null}[]=[];
  const until=shiftDate(today,30);
  for(const item of items) {
    if(item.endDate<today)continue;
    for(let n=0;n<31;n++) {
      const date=cycleBoundary(item.endDate,item.cycle,item.customDays,n);
      if(date>=until)break;
      if(paid.some(log=>log.subscriptionId===item.id&&log.payment!.startDate<=date&&log.payment!.endDate>date))continue;
      upcoming.push({id:item.id,name:item.name,plan:item.plan,date,amount:item.amount,currency:item.currency,cny:item.ratePending?null:item.amount*(item.fxRateToCny??1)});
    }
  }
  upcoming.sort((a,b)=>a.date.localeCompare(b.date)||a.name.localeCompare(b.name));
  return {monthTotal:sum(paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,7)))),yearTotal:sum(paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,4)))),
    monthCount:paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,7))).length,yearCount:paid.filter(log=>log.payment!.paidOn.startsWith(today.slice(0,4))).length,
    total:sum(selected),selectedCount:selected.length,months,categories:group("category"),ranking:group("subscription").slice(0,5),
    upcoming,forecast:upcoming.reduce((n,p)=>n+(p.cny??0),0),pending:logs.filter(log=>paymentState(log)==="pending").length,
    monthly:items.filter(i=>i.endDate>=today).reduce((n,i)=>n+monthlyCostCny(i),0),ratePending:items.filter(i=>i.ratePending).length};
}
