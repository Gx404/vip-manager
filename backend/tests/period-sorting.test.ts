import assert from "node:assert/strict";
import { test } from "node:test";
import { comparePeriodExpiry } from "../../frontend/src/lib/dashboard-helpers.ts";
import type { Subscription } from "../../shared/subscriptions.ts";

const base: Subscription = {id:"base",name:"Example",plan:"",category:"其他服务",amount:10,cycle:"monthly",customDays:30,
  startDate:"2026-09-24",endDate:"2026-10-24",reminderDays:7,autoRenew:false,note:"",color:"#269979",version:0};
const sorted = (items: Subscription[], today: string) => [...items].sort((a,b)=>comparePeriodExpiry(a,b,today)).map(item=>item.id);

test("expiry sort follows the active period for prepaid renewals in both views",()=>{
  const prepaid={...base,id:"prepaid",coverageStartDate:"2026-09-24",startDate:"2026-10-24",endDate:"2026-11-24"};
  const month={...base,id:"month",startDate:"2026-10-20",endDate:"2026-11-20"};
  const tomorrow={...base,id:"tomorrow",startDate:"2026-09-22",endDate:"2026-10-22"};
  const samePeriod={...base,id:"same-period"};
  const items=[month,prepaid,tomorrow,samePeriod];
  assert.deepEqual(sorted(items,"2026-10-21"),["tomorrow","same-period","prepaid","month"]);
  // On the boundary the next prepaid period becomes current, so it moves after November 20.
  assert.deepEqual(sorted(items,"2026-10-24"),["tomorrow","same-period","month","prepaid"]);
  assert.deepEqual(items.map(item=>item.id),["month","prepaid","tomorrow","same-period"]);
});

test("expiry sort preserves yearly/custom boundaries and the existing fallback for ended or future records",()=>{
  const year={...base,id:"year",cycle:"yearly" as const,coverageStartDate:"2026-03-11",startDate:"2027-03-11",endDate:"2028-03-11"};
  const later={...base,id:"later",cycle:"yearly" as const,startDate:"2026-12-01",endDate:"2027-12-01"};
  assert.deepEqual(sorted([later,year],"2026-10-17"),["year","later"]);
  const custom={...base,id:"custom",cycle:"custom" as const,customDays:10,coverageStartDate:"2026-10-01",startDate:"2026-10-21",endDate:"2026-10-31"};
  const ended={...base,id:"ended",endDate:"2026-10-01"};
  const future={...base,id:"future",startDate:"2026-11-01",endDate:"2026-12-01"};
  assert.deepEqual(sorted([future,base,custom,ended],"2026-10-17"),["ended","custom","base","future"]);
});
