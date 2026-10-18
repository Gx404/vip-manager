import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { occupiedCategories, dueWithin, progressColor, periodPercentage, billingProgress } from "../../shared/presentation.ts";
import { monthlyCost, type Subscription } from "../../shared/subscriptions.ts";
import { brands, matchBrand } from "../../shared/brands.ts";

const record: Subscription = { id: "test", name: "Example", plan: "", category: "其他服务", amount: 120, cycle: "monthly", customDays: 30, startDate: "2026-09-01", endDate: "2026-10-01", reminderDays: 30, autoRenew: false, note: "", color: "#269979", version: 1 };

test("category filters omit empty categories and do not depend on a search/status filter", () => {
  assert.deepEqual(occupiedCategories([]), []);
  assert.deepEqual(occupiedCategories([{ category: "AI 工具" }, { category: "购物电商" }, { category: "AI 工具" }]), [{ category: "购物电商", count: 1 }, { category: "AI 工具", count: 2 }]);
});

test("the seven-day summary includes today and day seven, but no expired or more distant records", () => {
  for (const [endDate, expected] of [["2026-09-29", false], ["2026-09-30", true], ["2026-10-07", true], ["2026-10-08", false]] as const) {
    assert.equal(dueWithin({ ...record, endDate }, "2026-09-30", 7), expected);
  }
  assert.equal(dueWithin({ ...record, endDate: "2026-10-30" }, "2026-09-30", 30), true);
});

test("period bar uses the current billing cycle and preserves extra prepaid time", () => {
  assert.equal(periodPercentage(record, "2026-08-31"), 103);
  assert.equal(periodPercentage(record, "2026-09-01"), 100);
  assert.equal(periodPercentage(record, "2026-09-16"), 50);
  assert.equal(periodPercentage(record, "2026-10-01"), 0);
  assert.equal(periodPercentage(record, "2026-10-02"), 0);
  assert.equal(periodPercentage({ ...record, startDate: "2026-09-01", endDate: "2026-10-31" }, "2026-09-16"), 150);
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

test("progress colors smoothly follow the active period with 100/80/60/40/20 anchors", () => {
  assert.equal(progressColor(0), "#d35e62");
  assert.equal(progressColor(20), "#dc7954");
  assert.equal(progressColor(40), "#e0a04c");
  assert.equal(progressColor(60), "#b5bb58");
  assert.equal(progressColor(80), "#79b88a");
  assert.equal(progressColor(100), "#2f9e7a");
  assert.notEqual(progressColor(70), progressColor(60), "values between anchors still interpolate");
  assert.notEqual(progressColor(70), progressColor(80), "values between anchors still interpolate");
  for (const value of [-1, NaN, Infinity]) assert.equal(progressColor(value), progressColor(0));
  assert.equal(progressColor(150), progressColor(100));
  const monthly = periodPercentage(record, "2026-09-16");
  const yearly = periodPercentage({ startDate: "2026-01-01", endDate: "2027-01-01" }, "2026-07-02");
  assert.equal(progressColor(monthly), progressColor(yearly), "equivalent fractions use the same color across billing cycles");
});

test("prepaid progress separates the active monthly/yearly period from the wholly unused next period", () => {
  const monthly = { ...record, coverageStartDate: "2026-09-24", startDate: "2026-10-24", endDate: "2026-11-24" };
  assert.deepEqual(billingProgress(monthly, "2026-10-17"), {
    current: { startDate: "2026-09-24", endDate: "2026-10-24", used: 77, remaining: 23 },
    next: { startDate: "2026-10-24", endDate: "2026-11-24", remaining: 100 }, futurePeriods: 1,
  });
  assert.deepEqual(billingProgress({ ...record, cycle: "yearly", coverageStartDate: "2026-03-11", startDate: "2027-03-11", endDate: "2028-03-11" }, "2026-10-17"), {
    current: { startDate: "2026-03-11", endDate: "2027-03-11", used: 60, remaining: 40 },
    next: { startDate: "2027-03-11", endDate: "2028-03-11", remaining: 100 }, futurePeriods: 1,
  });
  assert.deepEqual(billingProgress(monthly, "2026-10-24"), {
    current: { startDate: "2026-10-24", endDate: "2026-11-24", used: 0, remaining: 100 }, next: null, futurePeriods: 0,
  });
});

test("multiple prepaid periods do not shrink the current period and expose only the nearest future row", () => {
  const multi = { ...record, coverageStartDate: "2026-09-24", startDate: "2027-01-24", endDate: "2027-02-24" };
  assert.deepEqual(billingProgress(multi, "2026-10-17"), {
    current: { startDate: "2026-09-24", endDate: "2026-10-24", used: 77, remaining: 23 },
    next: { startDate: "2026-10-24", endDate: "2026-11-24", remaining: 100 }, futurePeriods: 4,
  });
  const withoutExtra = billingProgress({ ...multi, startDate: "2026-10-24", endDate: "2026-11-24" }, "2026-10-17");
  assert.deepEqual(billingProgress(multi, "2026-10-17").current, withoutExtra.current);
});

test("progress restores month-end and leap-year boundaries from the original coverage anchor", () => {
  const monthly = { ...record, coverageStartDate: "2026-01-31", startDate: "2026-03-31", endDate: "2026-04-30" };
  assert.deepEqual(billingProgress(monthly, "2026-02-28"), {
    current: { startDate: "2026-02-28", endDate: "2026-03-31", used: 0, remaining: 100 },
    next: { startDate: "2026-03-31", endDate: "2026-04-30", remaining: 100 }, futurePeriods: 1,
  });
  assert.deepEqual(billingProgress(monthly, "2026-03-01").current, {
    startDate: "2026-02-28", endDate: "2026-03-31", used: 3, remaining: 97,
  });
  assert.deepEqual(billingProgress({ ...record, cycle: "yearly", coverageStartDate: "2024-02-29", startDate: "2027-02-28", endDate: "2028-02-29" }, "2027-02-28"), {
    current: { startDate: "2027-02-28", endDate: "2028-02-29", used: 0, remaining: 100 }, next: null, futurePeriods: 0,
  });
});

test("the explicit latest interval stays indivisible across restored month-end and leap-day billing dates", () => {
  const monthly = { ...record, startDate: "2026-02-28", endDate: "2026-03-31" };
  assert.deepEqual(billingProgress(monthly, "2026-03-15"), {
    current: { startDate: "2026-02-28", endDate: "2026-03-31", used: 48, remaining: 52 },
    next: null, futurePeriods: 0,
  });
  assert.deepEqual(billingProgress(monthly, "2026-03-28"), {
    current: { startDate: "2026-02-28", endDate: "2026-03-31", used: 90, remaining: 10 },
    next: null, futurePeriods: 0,
  });
  assert.deepEqual(billingProgress(monthly, "2026-02-27"), {
    current: null, next: { startDate: "2026-02-28", endDate: "2026-03-31", remaining: 100 }, futurePeriods: 1,
  });
  assert.deepEqual(billingProgress({ ...record, cycle: "yearly", startDate: "2027-02-28", endDate: "2028-02-29" }, "2028-02-28"), {
    current: { startDate: "2027-02-28", endDate: "2028-02-29", used: 100, remaining: 0 },
    next: null, futurePeriods: 0,
  });
});

test("a future subscription has no fictional current period and expired or invalid schedules are empty", () => {
  assert.deepEqual(billingProgress(record, "2026-08-31"), {
    current: null, next: { startDate: "2026-09-01", endDate: "2026-10-01", remaining: 100 }, futurePeriods: 1,
  });
  const empty = { current: null, next: null, futurePeriods: 0 };
  for (const today of ["2026-10-01", "2026-10-02", "bad", "2026-02-30"]) assert.deepEqual(billingProgress(record, today), empty);
  for (const changes of [{ startDate: "bad" }, { endDate: "bad" }, { endDate: record.startDate }, { endDate: "2026-08-31" }, { cycle: "custom" as const, customDays: 0 }]) {
    assert.deepEqual(billingProgress({ ...record, ...changes }, "2026-09-15"), empty);
  }
  assert.deepEqual(billingProgress({ ...record, coverageStartDate: "bad" }, "2026-09-15"), billingProgress(record, "2026-09-15"));
});

test("custom and irregular final periods retain separate used and scheduled coverage", () => {
  assert.deepEqual(billingProgress({ ...record, cycle: "custom", customDays: 10, coverageStartDate: "2026-10-01", startDate: "2026-10-21", endDate: "2026-10-31" }, "2026-10-17"), {
    current: { startDate: "2026-10-11", endDate: "2026-10-21", used: 60, remaining: 40 },
    next: { startDate: "2026-10-21", endDate: "2026-10-31", remaining: 100 }, futurePeriods: 1,
  });
  assert.deepEqual(billingProgress({ ...record, coverageStartDate: "2026-01-31", startDate: "2026-03-30", endDate: "2026-04-15" }, "2026-03-15"), {
    current: { startDate: "2026-02-28", endDate: "2026-03-30", used: 50, remaining: 50 },
    next: { startDate: "2026-03-30", endDate: "2026-04-15", remaining: 100 }, futurePeriods: 1,
  });
  assert.deepEqual(billingProgress({ ...record, coverageStartDate: "2026-01-31", startDate: "2026-03-30", endDate: "2026-04-15" }, "2026-03-30"), {
    current: { startDate: "2026-03-30", endDate: "2026-04-15", used: 0, remaining: 100 },
    next: null, futurePeriods: 0,
  });
  assert.deepEqual(billingProgress({ ...record, coverageStartDate: "2026-01-31", startDate: "2026-03-30", endDate: "2026-04-15" }, "2026-04-07"), {
    current: { startDate: "2026-03-30", endDate: "2026-04-15", used: 50, remaining: 50 },
    next: null, futurePeriods: 0,
  });
  assert.deepEqual(billingProgress({ ...record, startDate: "2026-09-01", endDate: "2026-09-11" }, "2026-09-06").current, {
    startDate: "2026-09-01", endDate: "2026-09-11", used: 50, remaining: 50,
  });
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
    "YUNYOO 云服务器": "yunyoo", "云悠": "yunyoo", "ISVORO VPS": "isvoro",
    "Steam": "steam", "Vultr VPS": "vultr", "Digital Ocean": "digitalocean", "Cloudflare Pro": "cloudflare",
    "GitHub Pro": "github", "GitHub Copilot Pro": "github-copilot", "Bitwarden Premium": "bitwarden",
    "1Password 家庭版": "1password", "QQ 超级会员": "qq-vip", "Slack Pro": "slack",
    "Zoom Workplace": "zoom", "Linear": "linear", "Tailscale": "tailscale", "剪映专业版": "capcut",
    "京东PLUS": "jd", "JD PLUS": "jd", "盒马X会员": "hema", "Freshippo": "hema",
  };
  for (const [name, key] of Object.entries(samples)) assert.equal(matchBrand(name)?.key, key, name);
  for (const name of ["", "   ", "我的 Netflix 账户", "javascript:alert(1)", "QQ音乐", "Microsoft Copilot"]) {
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
