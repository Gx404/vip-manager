import assert from "node:assert/strict";
import { test } from "node:test";
import { paymentReport } from "../../shared/payment-reports.ts";
import type { Subscription } from "../../shared/subscriptions.ts";
import type { RenewalLog } from "../../shared/renewals.ts";

const base: Subscription = {id:"monthly",name:"Monthly",plan:"",category:"AI 工具",amount:31,currency:"CNY",fxRateToCny:1,
  cycle:"monthly",customDays:30,startDate:"2024-10-01",endDate:"2024-11-01",reminderDays:7,autoRenew:false,note:"",color:"#269979",version:0};
function payment(item: Subscription, patch: Partial<NonNullable<RenewalLog["payment"]>> = {}): RenewalLog {
  return {id:`payment:${item.id}`,subscriptionId:item.id,subscriptionName:item.name,kind:"manual",periods:1,amount:item.amount,
    previousStartDate:item.startDate,previousEndDate:item.endDate,newStartDate:item.startDate,newEndDate:item.endDate,
    createdAt:"2024-10-10T00:00:00Z",undoneAt:null,payment:{amount:item.amount,currency:"CNY",rate:1,rateDate:item.startDate,
      paidOn:item.startDate,startDate:item.startDate,endDate:item.endDate,category:item.category,plan:item.plan,note:"",source:"backfill",
      confirmedAt:"2024-10-10T00:00:00Z",voidedAt:null,...patch}};
}
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-8,`${actual} != ${expected}`);

test("all stored cycles contribute without a separate ledger, including older expired periods",()=>{
  const items: Subscription[]=[
    base,
    {...base,id:"yearly",name:"百度云网盘",cycle:"yearly",amount:366,startDate:"2024-01-01",endDate:"2025-01-01"},
    {...base,id:"quarterly",cycle:"quarterly",amount:92,startDate:"2024-10-01",endDate:"2025-01-01"},
    {...base,id:"custom",cycle:"custom",amount:30,startDate:"2024-10-16",endDate:"2024-11-15"},
  ];
  const before=structuredClone(items), october=paymentReport([],items,"2026-10-10","2024-10","accrual");
  assert.equal(october.ranking.length,3);assert.equal(october.selectedCount,3);assert.equal(october.total,153);
  assert.equal(october.confirmedCount,0);assert.equal(october.subscriptionCount,3);
  assert.equal(october.details.find(x=>x.subscriptionId==="quarterly")!.allocated,92);
  const february=paymentReport([],items,"2026-10-10","2024-02","accrual");assert.equal(february.total,0);
  assert.equal(paymentReport([],items,"2026-10-10","2023-12","accrual").total,0,"no invented earlier renewals");
  const cash=paymentReport([],items,"2024-10-31","2024-10","cash");assert.equal(cash.total,153);
  assert.equal(cash.yearTotal,0,"estimates must never be labeled confirmed cash");assert.equal(cash.recordedYearTotal,519);
  const whole=paymentReport([],items,"2026-10-10","","accrual");assert.equal(whole.total,519);
  const monthlySum=Array.from({length:13},(_,n)=>paymentReport([],items,"2026-10-10",new Date(Date.UTC(2024,n,1)).toISOString().slice(0,7),"accrual").total).reduce((a,b)=>a+b,0);
  near(monthlySum,whole.total);assert.deepEqual(items,before);
});

test("yearly subscription starts mid-month and older monthly backfills join the saved current month",()=>{
  const yearly={...base,id:"annual",name:"醒图",cycle:"yearly" as const,amount:108,startDate:"2026-10-03",endDate:"2027-10-03"};
  assert.equal(paymentReport([],[yearly],"2026-10-10","2026-10","accrual").total,108);
  assert.equal(paymentReport([],[yearly],"2026-10-10","2026-09","accrual").total,0);
  assert.equal(paymentReport([],[yearly],"2026-10-10","2026-10","cash").total,108);
  const current={...base,startDate:"2024-10-20",endDate:"2024-11-20"};
  const previous=payment({...base,startDate:"2024-09-20",endDate:"2024-10-20"},{amount:60});
  const report=paymentReport([previous],[current],"2024-10-31","2024-10","accrual");
  assert.equal(report.total,31);assert.equal(report.selectedCount,1);
  assert.equal(paymentReport([previous],[current],"2024-10-31","2024-09","accrual").total,60);
});

test("a service period is recorded once in its payment month, even when it spans two calendar months",()=>{
  const september={...base,id:"september",name:"百度云网盘",cycle:"yearly" as const,amount:198,startDate:"2026-09-04",endDate:"2027-09-04"};
  assert.equal(paymentReport([],[september],"2026-10-10","2026-09","accrual").total,198);
  assert.equal(paymentReport([],[september],"2026-10-10","2026-10","accrual").total,0);
  const future={...base,id:"future-monthly",startDate:"2026-10-26",endDate:"2026-11-26"};
  assert.equal(paymentReport([],[future],"2026-10-10","2026-10","accrual").total,0,"a future renewal date is not an October payment");
});

test("actual payment replaces estimates, with different original currency rates and corrected payment dates",()=>{
  const foreign={...base,currency:"USD" as const,amount:10,fxRateToCny:7};
  const log=payment(foreign,{currency:"USD",amount:9,rate:6,paidOn:"2024-09-30"});
  const before=structuredClone(log);
  const report=paymentReport([log],[foreign],"2024-10-31","2024-10","accrual");
  assert.equal(report.total,0);assert.equal(report.selectedCount,0);assert.equal(report.subscriptionCount,0);
  assert.equal(paymentReport([log],[foreign],"2024-10-31","2024-10","cash").total,0);
  assert.equal(paymentReport([log],[foreign],"2024-10-31","2024-09","cash").total,54);
  assert.deepEqual(log,before);
});

test("partial payments replace only their coverage, with no duplicate fallback cash or revived voids",()=>{
  const partial=payment(base,{startDate:"2024-10-10",endDate:"2024-10-20",amount:20});
  const report=paymentReport([partial],[base],"2024-10-31","2024-10","accrual");
  assert.equal(report.total,41);assert.equal(report.selectedCount,2);
  assert.equal(paymentReport([partial],[base],"2024-10-31","2024-10","cash").total,20);
  const voided=payment(base,{voidedAt:"2024-10-11T00:00:00Z"});
  assert.equal(paymentReport([voided],[base],"2024-10-31","2024-10","accrual").total,0);
  assert.equal(paymentReport([voided],[base],"2024-10-31","2024-10","cash").total,0);
  const replacement=payment(base,{amount:35});replacement.id="replacement";
  assert.equal(paymentReport([voided,replacement],[base],"2024-10-31","2024-10","accrual").total,35);
});

test("known previous renewal periods are retained and pending renewals never become confirmed cash",()=>{
  const next={...base,startDate:"2024-11-01",endDate:"2024-12-01",amount:90};
  const audit: RenewalLog={...payment(base),payment:null,newStartDate:next.startDate,newEndDate:next.endDate,currency:"CNY",fxRateToCny:1};
  const old=paymentReport([audit],[next],"2024-11-10","2024-10","accrual");assert.equal(old.total,31);
  const current=paymentReport([audit],[next],"2024-11-10","2024-11","accrual");assert.equal(current.total,90);
  assert.equal(paymentReport([audit],[next],"2024-11-10","2024-11","cash").total,0);
  assert.equal(paymentReport([audit],[base],"2024-11-10","2024-10","accrual").total,31,"audit and current record cannot double-count");
});

test("future starts and missing rates stay out, while free subscriptions remain visible and all groups reconcile",()=>{
  const future={...base,id:"future",startDate:"2027-10-01",endDate:"2027-11-01"};
  const pending={...base,id:"rate",currency:"USD" as const,ratePending:true};
  const free={...base,id:"free",amount:0};
  const many=Array.from({length:9},(_,n)=>({...base,id:`row-${n}`,name:`Subscription ${n}`,category:n%2?"云存储":"AI 工具"}));
  const report=paymentReport([],[future,pending,free,...many],"2026-10-10","2024-10","accrual");
  assert.equal(report.ranking.length,10);assert.equal(report.details.length,10);assert.equal(report.total,279);
  near(report.categories.reduce((sum,c)=>sum+c.amount,0),report.total);near(report.ranking.reduce((sum,c)=>sum+c.amount,0),report.total);
  near(report.details.reduce((sum,c)=>sum+c.allocated,0),report.total);
});

test("calendar filters drive the chart and details without changing the current month/year summaries",()=>{
  const items=[{...base,id:"current",amount:80,startDate:"2026-10-03",endDate:"2027-10-03",cycle:"yearly" as const},
    {...base,id:"last-year",amount:20,startDate:"2025-12-20",endDate:"2026-01-20"}];
  const older=payment(base,{paidOn:"2024-05-15"}), before=structuredClone({items,older});
  for(const period of ["2024","2024-05","2025-12",""]) {
    const report=paymentReport([older],items,"2026-10-11",period,"accrual");
    assert.equal(report.recordedMonthTotal,80);assert.equal(report.recordedYearTotal,80);
    assert.equal(report.months.length,12);
    assert.equal(report.months[0].key,`${period.slice(0,4)||"2026"}-01`);
    assert.equal(report.months[11].key,`${period.slice(0,4)||"2026"}-12`);
    near(report.categories.reduce((sum,c)=>sum+c.amount,0),report.total);
    near(report.details.reduce((sum,c)=>sum+c.allocated,0),report.total);
  }
  const annual=paymentReport([older],items,"2026-10-11","2024","accrual");
  assert.equal(annual.total,31);assert.equal(annual.months[4].amount,31);
  assert.equal(annual.months.reduce((sum,m)=>sum+m.amount,0),annual.total);
  const all=paymentReport([older],items,"2026-10-11","","accrual");
  assert.deepEqual(all.years.map(({key,amount})=>[key,amount]),[["2024",31],["2025",20],["2026",80]]);
  assert.equal(all.years.reduce((sum,y)=>sum+y.amount,0),all.total);
  assert.deepEqual({items,older},before);
});

test("this month's expected bills exclude next month, settled coverage, expired and non-monthly subscriptions",()=>{
  const due=(id:string,date:string):Subscription=>({...base,id,amount:10,startDate:"2024-09-11",endDate:date});
  const prepaid=due("prepaid","2024-10-25"), cancelled=due("voided","2024-10-26");
  const paid=payment(prepaid,{paidOn:"2024-10-01",startDate:"2024-10-25",endDate:"2024-11-25"});
  const voided=payment(cancelled,{paidOn:"2024-10-01",startDate:"2024-10-26",endDate:"2024-11-26",voidedAt:"2024-10-02T00:00:00Z"});
  const items=[due("today","2024-10-11"),due("month-end","2024-10-31"),due("next-month","2024-11-01"),
    due("expired","2024-10-10"),{...due("yearly","2024-10-23"),cycle:"yearly" as const},
    {...due("quarterly","2024-10-20"),cycle:"quarterly" as const},{...due("free","2024-10-12"),amount:0},prepaid,cancelled];
  const report=paymentReport([paid,voided],items,"2024-10-11","2024-09","accrual");
  assert.deepEqual(report.upcoming.map(item=>[item.id,item.date]),[["today","2024-10-11"],["voided","2024-10-26"],["month-end","2024-10-31"]]);
  assert.equal(report.forecast,30);
  assert.equal(report.upcoming.reduce((sum,item)=>sum+(item.cny??0),0),report.forecast);
  assert.equal(report.recordedMonthTotal,10,"expected bills do not become current spending");
});

test("expected bills use calendar boundaries for long months, leap February and December",()=>{
  for(const [today,startDate,lastDay,nextMonth] of [["2024-01-01","2023-12-31","2024-01-31","2024-02-01"],
    ["2024-02-01","2024-01-29","2024-02-29","2024-03-01"],["2024-12-20","2024-11-30","2024-12-31","2025-01-01"]]) {
    const report=paymentReport([],[{...base,id:"last-day",startDate,endDate:lastDay},
      {...base,id:"next-month",startDate:`${today.slice(0,7)}-01`,endDate:nextMonth}],today);
    assert.deepEqual(report.upcoming.map(item=>item.date),[lastDay]);assert.equal(report.forecast,31);
  }
});
