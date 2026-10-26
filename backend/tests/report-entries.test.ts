import assert from "node:assert/strict";
import { test } from "node:test";
import { paymentReport, pendingRenewals, spendingSummary } from "../../shared/payment-reports.ts";
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

test("过期未续费不会推算费用，真实历史付款仍保留购物分类",()=>{
  const jd:Subscription={...base,id:"expired-jd",name:"京东",plan:"Plus",category:"购物电商",amount:98,
    cycle:"yearly",startDate:"2025-10-23",endDate:"2026-10-23",purchaseDate:"2025-10-23"};
  const report=paymentReport([], [jd], "2026-10-24", "2025", "accrual");
  assert.equal(report.total,0);assert.equal(report.confirmedCount,0);assert.equal(report.subscriptionCount,0);
  assert.deepEqual(report.details,[]);
  assert.equal(report.monthly,0);assert.equal(report.forecast,0);assert.equal(report.upcoming.length,0);
  assert.equal(report.years.find(row=>row.key==="2025")?.amount??0,0);
  const confirmed=paymentReport([payment(jd)],[jd],"2026-10-24","2025");
  assert.equal(confirmed.total,98);assert.equal(confirmed.details[0].category,"购物电商");
  assert.equal(confirmed.details[0].startDate,"2025-10-23");assert.equal(confirmed.confirmedCount,1);
});

test("过期项缺少汇率不再提示当前预算待补，但已支付历史缺价仍保留提示",()=>{
  const expired:Subscription={...base,endDate:"2024-10-20",currency:"USD",ratePending:true};
  const paid=payment(expired,{currency:"USD",rate:null,rateDate:null});
  const report=paymentReport([paid],[expired],"2024-11-01","2024-10");
  assert.equal(report.ratePending,0);assert.equal(report.monthly,0);
  assert.equal(report.paidRatePending,1);assert.equal(report.missingRates,1);
  assert.equal(report.details[0].originalAmount,expired.amount);
});

test("all billing cycles require explicit payment records, including older expired periods",()=>{
  const items: Subscription[]=[
    base,
    {...base,id:"yearly",name:"百度云网盘",cycle:"yearly",amount:366,startDate:"2024-01-01",endDate:"2025-01-01"},
    {...base,id:"quarterly",cycle:"quarterly",amount:92,startDate:"2024-10-01",endDate:"2025-01-01"},
    {...base,id:"custom",cycle:"custom",amount:30,startDate:"2024-10-16",endDate:"2024-11-15"},
  ];
  const before=structuredClone(items), october=paymentReport([],items,"2026-10-10","2024-10","accrual");
  assert.equal(october.ranking.length,0);assert.equal(october.selectedCount,0);assert.equal(october.total,0);
  assert.equal(october.confirmedCount,0);assert.equal(october.subscriptionCount,0);
  const february=paymentReport([],items,"2026-10-10","2024-02","accrual");assert.equal(february.total,0);
  assert.equal(paymentReport([],items,"2026-10-10","2023-12","accrual").total,0,"no invented earlier renewals");
  const cash=paymentReport([],items,"2024-10-31","2024-10","cash");assert.equal(cash.total,0);
  assert.equal(cash.yearTotal,0);assert.equal(cash.recordedYearTotal,0);
  const logs=items.map(item=>payment(item));
  const recorded=paymentReport(logs,items,"2026-10-10","2024-10","accrual");
  assert.equal(recorded.total,153);assert.equal(recorded.confirmedCount,3);assert.equal(recorded.subscriptionCount,0);
  assert.equal(recorded.details.find(x=>x.subscriptionId==="quarterly")!.allocated,92);
  const whole=paymentReport(logs,items,"2026-10-10","","accrual");assert.equal(whole.total,519);
  const monthlySum=Array.from({length:13},(_,n)=>paymentReport(logs,items,"2026-10-10",new Date(Date.UTC(2024,n,1)).toISOString().slice(0,7),"accrual").total).reduce((a,b)=>a+b,0);
  near(monthlySum,whole.total);assert.deepEqual(items,before);
});

test("yearly saved prices never imply payment and older monthly backfills stay in their paid month",()=>{
  const yearly={...base,id:"annual",name:"醒图",cycle:"yearly" as const,amount:108,startDate:"2026-10-03",endDate:"2027-10-03"};
  assert.equal(paymentReport([],[yearly],"2026-10-10","2026-10","accrual").total,0);
  assert.equal(paymentReport([],[yearly],"2026-10-10","2026-09","accrual").total,0);
  assert.equal(paymentReport([],[yearly],"2026-10-10","2026-10","cash").total,0);
  assert.equal(paymentReport([payment(yearly)],[yearly],"2026-10-10","2026-10","cash").total,108);
  const current={...base,startDate:"2024-10-20",endDate:"2024-11-20"};
  const previous=payment({...base,startDate:"2024-09-20",endDate:"2024-10-20"},{amount:60});
  const report=paymentReport([previous],[current],"2024-10-31","2024-10","accrual");
  assert.equal(report.total,0);assert.equal(report.selectedCount,0);
  assert.equal(paymentReport([previous],[current],"2024-10-31","2024-09","accrual").total,60);
});

test("a service period is recorded once in its payment month, even when it spans two calendar months",()=>{
  const september={...base,id:"september",name:"百度云网盘",cycle:"yearly" as const,amount:198,startDate:"2026-09-04",endDate:"2027-09-04"};
  assert.equal(paymentReport([payment(september)],[september],"2026-10-10","2026-09","accrual").total,198);
  assert.equal(paymentReport([payment(september)],[september],"2026-10-10","2026-10","accrual").total,0);
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

test("partial payments count only the real amount, with no uncovered estimates or revived voids",()=>{
  const partial=payment(base,{startDate:"2024-10-10",endDate:"2024-10-20",amount:20});
  const report=paymentReport([partial],[base],"2024-10-31","2024-10","accrual");
  assert.equal(report.total,20);assert.equal(report.selectedCount,1);assert.equal(report.subscriptionCount,0);
  assert.equal(paymentReport([partial],[base],"2024-10-31","2024-10","cash").total,20);
  const voided=payment(base,{voidedAt:"2024-10-11T00:00:00Z"});
  assert.equal(paymentReport([voided],[base],"2024-10-31","2024-10","accrual").total,0);
  assert.equal(paymentReport([voided],[base],"2024-10-31","2024-10","cash").total,0);
  const replacement=payment(base,{amount:35});replacement.id="replacement";
  assert.equal(paymentReport([voided,replacement],[base],"2024-10-31","2024-10","accrual").total,35);
});

test("known previous renewal periods and pending renewals never become expenditure",()=>{
  const next={...base,startDate:"2024-11-01",endDate:"2024-12-01",amount:90};
  const audit: RenewalLog={...payment(base),payment:null,newStartDate:next.startDate,newEndDate:next.endDate,currency:"CNY",fxRateToCny:1};
  const old=paymentReport([audit],[next],"2024-11-10","2024-10","accrual");assert.equal(old.total,0);
  const current=paymentReport([audit],[next],"2024-11-10","2024-11","accrual");assert.equal(current.total,0);
  assert.equal(paymentReport([audit],[next],"2024-11-10","2024-11","cash").total,0);
  assert.equal(paymentReport([audit],[base],"2024-11-10","2024-10","accrual").total,0,"audit and saved price cannot invent a payment");
});

test("future payments and voids stay out, while confirmed zero payments and all groups reconcile",()=>{
  const future={...base,id:"future",startDate:"2027-10-01",endDate:"2027-11-01"};
  const pending={...base,id:"rate",currency:"USD" as const,ratePending:true};
  const free={...base,id:"free",amount:0};
  const many=Array.from({length:9},(_,n)=>({...base,id:`row-${n}`,name:`Subscription ${n}`,category:n%2?"云存储":"AI 工具"}));
  const report=paymentReport([payment(future),payment(pending,{currency:"USD",rate:null,rateDate:null}),payment(free),...many.map(item=>payment(item))],[future,pending,free,...many],"2026-10-10","2024-10","accrual");
  assert.equal(report.ranking.length,11);assert.equal(report.details.length,11);assert.equal(report.total,279);assert.equal(report.missingRates,1);
  near(report.categories.reduce((sum,c)=>sum+c.amount,0),report.total);near(report.ranking.reduce((sum,c)=>sum+c.amount,0),report.total);
  near(report.details.reduce((sum,c)=>sum+(c.allocated ?? 0),0),report.total);
});

test("calendar filters drive the chart and details without changing the current month/year summaries",()=>{
  const items=[{...base,id:"current",amount:80,startDate:"2026-10-03",endDate:"2027-10-03",cycle:"yearly" as const},
    {...base,id:"last-year",amount:20,startDate:"2025-12-20",endDate:"2026-01-20"}];
  const older=payment(base,{paidOn:"2024-05-15"}), logs=[older,...items.map(item=>payment(item))],before=structuredClone({items,older});
  for(const period of ["2024","2024-05","2025-12",""]) {
    const report=paymentReport(logs,items,"2026-10-11",period,"accrual");
    assert.equal(report.recordedMonthTotal,80);assert.equal(report.recordedYearTotal,80);
    assert.equal(report.months.length,12);
    assert.equal(report.months[0].key,`${period.slice(0,4)||"2026"}-01`);
    assert.equal(report.months[11].key,`${period.slice(0,4)||"2026"}-12`);
    near(report.categories.reduce((sum,c)=>sum+c.amount,0),report.total);
    near(report.details.reduce((sum,c)=>sum+(c.allocated ?? 0),0),report.total);
  }
  const annual=paymentReport(logs,items,"2026-10-11","2024","accrual");
  assert.equal(annual.total,31);assert.equal(annual.months[4].amount,31);
  assert.equal(annual.months.reduce((sum,m)=>sum+m.amount,0),annual.total);
  const all=paymentReport(logs,items,"2026-10-11","","accrual");
  assert.deepEqual(all.years.map(({key,amount})=>[key,amount]),[["2024",31],["2025",20],["2026",80]]);
  assert.equal(all.years.reduce((sum,y)=>sum+y.amount,0),all.total);
  assert.deepEqual({items,older},before);
});

test("saved due dates and prices never produce expected bills or forecasts",()=>{
  const due=(id:string,date:string):Subscription=>({...base,id,amount:10,startDate:"2024-09-11",endDate:date});
  const prepaid=due("prepaid","2024-10-25"), cancelled=due("voided","2024-10-26");
  const paid=payment(prepaid,{paidOn:"2024-10-01",startDate:"2024-10-25",endDate:"2024-11-25"});
  const voided=payment(cancelled,{paidOn:"2024-10-01",startDate:"2024-10-26",endDate:"2024-11-26",voidedAt:"2024-10-02T00:00:00Z"});
  const items=[due("today","2024-10-11"),due("month-end","2024-10-31"),due("next-month","2024-11-01"),
    due("expired","2024-10-10"),{...due("yearly","2024-10-23"),cycle:"yearly" as const},
    {...due("quarterly","2024-10-20"),cycle:"quarterly" as const},{...due("free","2024-10-12"),amount:0},prepaid,cancelled];
  const report=paymentReport([paid,voided],items,"2024-10-11","2024-09","accrual");
  assert.deepEqual(report.upcoming,[]);
  assert.equal(report.forecast,0);
  assert.equal(report.recordedMonthTotal,10,"expected bills do not become current spending");
});

test("long months, leap February and December cannot turn schedules into payments",()=>{
  for(const [today,startDate,lastDay,nextMonth] of [["2024-01-01","2023-12-31","2024-01-31","2024-02-01"],
    ["2024-02-01","2024-01-29","2024-02-29","2024-03-01"],["2024-12-20","2024-11-30","2024-12-31","2025-01-01"]]) {
    const report=paymentReport([],[{...base,id:"last-day",startDate,endDate:lastDay},
      {...base,id:"next-month",startDate:`${today.slice(0,7)}-01`,endDate:nextMonth}],today);
    assert.deepEqual(report.upcoming,[]);assert.equal(report.forecast,0);assert.equal(report.total,0);
  }
});

test("deleted Gemini estimate facts cannot leave a residual prorated charge",()=>{
  const gemini={...base,id:"deleted-gemini",name:"Gemini",amount:38,startDate:"2026-08-18",endDate:"2027-08-18"};
  const facts=[{id:"removed",subscriptionId:gemini.id,excludedPeriod:{startDate:"2026-10-18",endDate:"2027-08-18"},schedule:{
    subscriptionName:gemini.name,plan:"Pro",category:"AI 工具",previousStartDate:gemini.startDate,previousEndDate:gemini.endDate,
    newStartDate:"2027-08-18",newEndDate:"2028-08-18",amount:38,currency:"CNY" as const,fxRateToCny:1,previousRatePending:false,periods:1,createdAt:"2026-10-18T00:00:00Z"}}];
  for(const basis of ["cash","accrual"] as const)for(const period of ["","2026","2026-08"]){
    const report=paymentReport([],[],"2026-10-26",period,basis,facts);
    assert.equal(report.total,0);assert.deepEqual(report.details,[]);assert.equal(report.recordedYearTotal,0);
  }
});

test("dashboard aggregates only actual paid dates, retaining deleted-member payments and missing FX counts",()=>{
  const logs=[payment({...base,id:"a"},{paidOn:"2026-10-02",amount:20}),payment({...base,id:"b"},{paidOn:"2026-09-30",amount:30}),
    payment({...base,id:"old"},{paidOn:"2025-12-31",amount:50}),payment({...base,id:"pending-rate"},{paidOn:"2026-10-03",currency:"USD",rate:null,amount:9}),
    payment({...base,id:"void"},{paidOn:"2026-10-03",amount:40,voidedAt:"2026-10-04T00:00:00Z"}),
    payment({...base,id:"future"},{paidOn:"2026-10-27",amount:70})];
  assert.deepEqual(spendingSummary(logs,"2026-10-26"),{monthTotal:20,yearTotal:50,monthCount:2,yearCount:3,monthMissingRates:1,yearMissingRates:1});
  const report=paymentReport(logs,[],"2026-10-26");
  assert.equal(report.total,20);assert.equal(report.yearTotal,50);assert.equal(report.missingRates,1);assert.equal(report.details.length,2);
});

test("multi-period automatic catchup stops prompting only after every period is explicitly paid",()=>{
  const auto:RenewalLog={...payment(base),id:"auto",payment:null,kind:"automatic",periods:2,
    previousStartDate:"2026-08-22",previousEndDate:"2026-09-22",newStartDate:"2026-10-22",newEndDate:"2026-11-22"};
  const first=payment({...base,id:auto.subscriptionId},{startDate:"2026-09-22",endDate:"2026-10-22",paidOn:"2026-10-01"});first.id="first";
  const second=payment({...base,id:auto.subscriptionId},{startDate:"2026-10-22",endDate:"2026-11-22",paidOn:"2026-10-22"});second.id="second";
  assert.equal(pendingRenewals([auto],"2026-10-26").length,1);
  assert.equal(pendingRenewals([auto,first],"2026-10-26").length,1);
  assert.equal(pendingRenewals([auto,first,second],"2026-10-26").length,0);
  assert.equal(paymentReport([auto,first,second],[],"2026-10-26").pending,0);
  assert.equal(pendingRenewals([auto,first,{...second,payment:{...second.payment!,voidedAt:"2026-10-24T00:00:00Z"}}],"2026-10-26").length,1);
  assert.equal(pendingRenewals([auto,first],"2026-10-26",[{id:"excluded",subscriptionId:auto.subscriptionId,excludedPeriod:{startDate:"2026-10-22",endDate:"2026-11-22"}}]).length,0);
});
