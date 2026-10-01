import assert from "node:assert/strict";
import { test } from "node:test";
import { linkedEndDate, updateDraftPeriod, membershipTemplates } from "../../frontend/src/lib/dashboard-helpers.ts";
import { categories, type Subscription } from "../../shared/subscriptions.ts";
import { matchBrand } from "../../shared/brands.ts";

test("draft dates link at month-end, leap years and custom intervals, preserving manually edited dates", () => {
  const draft = { startDate:"2026-01-31", endDate:"2026-02-28", cycle:"monthly" as Subscription["cycle"], customDays:"30" };
  assert.equal(updateDraftPeriod(draft,{startDate:"2026-03-31"},true).endDate,"2026-04-30");
  assert.equal(updateDraftPeriod(draft,{cycle:"quarterly"},true).endDate,"2026-04-30");
  assert.equal(updateDraftPeriod(draft,{startDate:"2028-02-29",cycle:"yearly"},true).endDate,"2029-02-28");
  assert.equal(updateDraftPeriod(draft,{cycle:"custom",customDays:"5"},true).endDate,"2026-02-05");
  assert.equal(updateDraftPeriod(draft,{cycle:"yearly"},false).endDate,draft.endDate);
  assert.equal(updateDraftPeriod(draft,{startDate:""},true).endDate,draft.endDate);
  assert.equal(linkedEndDate("2026-02-30","monthly",30),null);
  assert.equal(linkedEndDate("2200-12-31","monthly",30),null);
  assert.equal(linkedEndDate("2026-01-31","custom",0),null);
  assert.equal(linkedEndDate("2026-01-31","custom",1.5),null);
});

test("all VIP templates have local brand icons, existing categories and no fabricated prices", () => {
  assert.equal(membershipTemplates.length,5);
  for (const template of membershipTemplates) {
    assert.ok(categories.some(category => category === template.category));
    assert.ok(matchBrand(template.name));
    assert.match(template.color,/^#[a-f0-9]{6}$/);
    assert.equal("amount" in template,false);
  }
});
