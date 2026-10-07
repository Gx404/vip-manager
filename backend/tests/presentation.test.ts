import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { occupiedCategories, dueWithin, durationColor, periodPercentage } from "../../shared/presentation.ts";
import { monthlyCost, type Subscription } from "../../shared/subscriptions.ts";
import { brands, matchBrand } from "../../shared/brands.ts";

const record: Subscription = { id: "test", name: "Example", plan: "", category: "其他服务", amount: 120, cycle: "monthly", customDays: 30, startDate: "2026-09-01", endDate: "2026-10-01", reminderDays: 30, autoRenew: false, note: "", color: "#269979", version: 1 };

test("category filters omit empty categories and do not depend on a search/status filter", () => {
  assert.deepEqual(occupiedCategories([]), []);
  assert.deepEqual(occupiedCategories([{ category: "AI 工具" }, { category: "购物会员" }, { category: "AI 工具" }]), [{ category: "购物会员", count: 1 }, { category: "AI 工具", count: 2 }]);
});

test("the seven-day summary includes today and day seven, but no expired or more distant records", () => {
  for (const [endDate, expected] of [["2026-09-29", false], ["2026-09-30", true], ["2026-10-07", true], ["2026-10-08", false]] as const) {
    assert.equal(dueWithin({ ...record, endDate }, "2026-09-30", 7), expected);
  }
  assert.equal(dueWithin({ ...record, endDate: "2026-10-30" }, "2026-09-30", 30), true);
});

test("period bar and label share a bounded percentage across month-end, leap years and invalid dates", () => {
  assert.equal(periodPercentage(record, "2026-08-31"), 100);
  assert.equal(periodPercentage(record, "2026-09-01"), 100);
  assert.equal(periodPercentage(record, "2026-09-16"), 50);
  assert.equal(periodPercentage(record, "2026-10-01"), 0);
  assert.equal(periodPercentage(record, "2026-10-02"), 0);
  assert.equal(periodPercentage({ startDate: "2026-03-04", endDate: "2027-03-04" }, "2026-09-30"), 42);
  assert.equal(periodPercentage({ startDate: "2028-02-28", endDate: "2028-03-01" }, "2028-02-29"), 50);
  assert.equal(periodPercentage({ startDate: "2026-01-31", endDate: "2026-02-28" }, "2026-02-14"), 50);
  assert.equal(periodPercentage({ startDate: "bad", endDate: record.endDate }, "2026-09-01"), 0);
  assert.equal(periodPercentage({ startDate: record.endDate, endDate: record.endDate }, "2026-09-01"), 0);
  assert.equal(periodPercentage(record, "bad"), 0);
});

test("monthly budget amortizes each billing cycle independently of auto-renewal", () => {
  assert.equal(monthlyCost(record), 120);
  assert.equal(monthlyCost({ ...record, cycle: "quarterly", amount: 90 }), 30);
  assert.equal(monthlyCost({ ...record, cycle: "yearly", amount: 198 }), 16.5);
  assert.equal(monthlyCost({ ...record, cycle: "custom", amount: 60, customDays: 45 }), 40);
  assert.equal(monthlyCost({ ...record, autoRenew: true }), monthlyCost(record));
  assert.equal(monthlyCost({ ...record, amount: 0 }), 0);
});

test("duration colors change smoothly with actual days and use safe bounds", () => {
  const colors = [0, 1, 3, 7, 14, 30, 90, 180, 365, 730].map(durationColor);
  assert.equal(new Set(colors).size, colors.length);
  assert.ok(colors.every(color => /^#[a-f0-9]{6}$/.test(color)));
  assert.equal(durationColor(-1), durationColor(0)); assert.equal(durationColor(Infinity), durationColor(0));
  assert.equal(periodPercentage({ startDate: "2026-09-01", endDate: "2026-10-01" }, "2026-09-16"), 50);
  assert.equal(periodPercentage({ startDate: "2026-09-01", endDate: "2026-10-01" }, "2026-10-02"), 0);
});

test("subscription names recognize Chinese/English/full-width aliases, while unknown services fall back", () => {
  for (const name of ["Open AI", "chatGPT Plus", "ＯｐｅｎＡＩ pro", "GPT Pro"]) assert.equal(matchBrand(name)?.key, "openai");
  for (const name of ["百度网盘超级会员", "百度云盘", "Baidu Netdisk"]) assert.equal(matchBrand(name)?.key, "baidu-netdisk");
  assert.equal(matchBrand("淘宝88VIP")?.key, "taobao"); assert.equal(matchBrand("88 VIP")?.key, "taobao");
  assert.equal(matchBrand("哔哩哔哩年度大会员")?.key, "bilibili");
  assert.equal(matchBrand("My private membership"), undefined);
  assert.equal(matchBrand("https://attacker.test/a.svg"), undefined);
});

test("expanded local brands recognize common memberships and prefer more specific aliases", () => {
  const samples = {
    "Ｎｅｔｆｌｉｘ Premium": "netflix", "奈飞家庭组": "netflix", "Spotify 家庭会员": "spotify",
    "YouTube Premium": "youtube", "YouTube Music Premium": "youtube-music", "油管音乐": "youtube-music",
    "Apple Music": "apple-music", "Apple TV+": "apple-tv", "Google One 2TB": "google-one",
    "OneDrive": "onedrive", "Microsoft 365 家庭版": "microsoft-office", "Office 365": "microsoft-office",
    "Cursor Pro": "cursor", "Perplexity Pro": "perplexity", "Kimi Coding": "kimi", "通义千问": "qwen",
    "豆包": "doubao", "SuperGrok": "grok", "Midjourney": "midjourney", "海螺AI": "minimax",
    "Trae Pro": "trae", "Manus": "manus", "阿里云 ECS": "alibaba-cloud", "腾讯云": "tencent-cloud",
    "PS Plus": "playstation", "XGPU": "xbox", "Nintendo Switch Online": "nintendo",
  };
  for (const [name, key] of Object.entries(samples)) assert.equal(matchBrand(name)?.key, key, name);
  for (const name of ["", "   ", "我的 Netflix 账户", "javascript:alert(1)"]) {
    // Only deliberate prefixes match; no substring or network lookups.
    assert.equal(matchBrand(name), undefined, name);
  }
});

test("every brand and alias is unique and resolves to the intended service", () => {
  assert.equal(new Set(brands.map(brand => brand.key)).size, brands.length);
  const aliases = new Set<string>();
  for (const brand of brands) for (const alias of brand.aliases) {
    const normalized = alias.normalize("NFKC").trim().toLowerCase().replace(/[\s._+\-]/g, "");
    assert.ok(normalized && !aliases.has(normalized), alias);
    aliases.add(normalized);
    assert.equal(matchBrand(alias)?.key, brand.key, alias);
  }
});

test("all matched icons exist locally and contain no script or external fetch references", async () => {
  for (const brand of brands) {
    assert.match(brand.icon, /^\/brands\/[a-z0-9-]+\.(svg|ico|png)$/);
    const file = await readFile(new URL("../../frontend/public" + brand.icon, import.meta.url));
    assert.ok(file.length > 100 && file.length < 200_000, brand.key);
    if (brand.icon.endsWith(".svg")) {
      const svg = file.toString("utf8");
      assert.match(svg, /^<svg/);
      assert.doesNotMatch(svg, /<script|<foreignObject|<!DOCTYPE|\bon\w+=|(?:href|xlink:href)=["'](?:https?:|\/\/|javascript:)|@import|url\(\s*["']?https?:/i);
    } else if (brand.icon.endsWith(".png")) {
      assert.equal(file.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", brand.key);
      assert.ok(file.readUInt32BE(16) >= 72 && file.readUInt32BE(20) >= 72, "Retina-sized source");
    } else {
      assert.equal(file.subarray(0, 4).toString("hex"), "00000100", brand.key);
    }
  }
});
