import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { occupiedCategories, durationMeter, durationColor, durationLabel } from "../../shared/presentation.ts";
import { brands, matchBrand } from "../../shared/brands.ts";

test("category filters omit empty categories and do not depend on a search/status filter", () => {
  assert.deepEqual(occupiedCategories([]), []);
  assert.deepEqual(occupiedCategories([{ category: "AI 工具" }, { category: "购物会员" }, { category: "AI 工具" }]), [{ category: "购物会员", count: 1 }, { category: "AI 工具", count: 2 }]);
});

test("remaining-time ruler distinguishes days, months and years independent of billing cycle", () => {
  const widths = [0, 1, 3, 7, 30, 90, 180, 365].map(days => durationMeter(days));
  assert.equal(widths[0], 0); assert.equal(widths.at(-1), 100);
  assert.ok(widths.every((width, index) => index === 0 || width > widths[index - 1]));
  assert.ok(durationMeter(300) > durationMeter(30));
  assert.ok(durationMeter(365, 730) < durationMeter(730, 730));
  assert.equal(durationMeter(-5), 0); assert.equal(durationMeter(NaN), 0);
  assert.equal(durationMeter(730), 100);
});

test("duration colors change smoothly with actual days and use safe bounds", () => {
  const colors = [0, 1, 3, 7, 14, 30, 90, 180, 365, 730].map(durationColor);
  assert.equal(new Set(colors).size, colors.length);
  assert.ok(colors.every(color => /^#[a-f0-9]{6}$/.test(color)));
  assert.equal(durationColor(-1), durationColor(0)); assert.equal(durationColor(Infinity), durationColor(0));
  assert.equal(durationLabel(0), "今天到期"); assert.equal(durationLabel(-1), "已过期");
});

test("subscription names recognize Chinese/English/full-width aliases, while unknown services fall back", () => {
  for (const name of ["Open AI", "chatGPT Plus", "ＯｐｅｎＡＩ pro", "GPT Pro"]) assert.equal(matchBrand(name)?.key, "openai");
  for (const name of ["百度网盘超级会员", "百度云盘", "Baidu Netdisk"]) assert.equal(matchBrand(name)?.key, "baidu-netdisk");
  assert.equal(matchBrand("淘宝88VIP")?.key, "taobao"); assert.equal(matchBrand("88 VIP")?.key, "taobao");
  assert.equal(matchBrand("哔哩哔哩年度大会员")?.key, "bilibili");
  assert.equal(matchBrand("My private membership"), undefined);
  assert.equal(matchBrand("https://attacker.test/a.svg"), undefined);
});

test("all matched icons exist locally and contain no script or external fetch references", async () => {
  for (const brand of brands) {
    assert.match(brand.icon, /^\/brands\/[a-z-]+\.(svg|ico)$/);
    const file = await readFile(new URL("../../frontend/public" + brand.icon, import.meta.url));
    assert.ok(file.length > 100 && file.length < 200_000, brand.key);
    if (brand.icon.endsWith(".svg")) {
      const svg = file.toString("utf8");
      assert.match(svg, /^<svg/);
      assert.doesNotMatch(svg, /<script|\bon\w+=|(?:href|xlink:href)=["'](?:https?:|\/\/)/i);
    } else {
      assert.equal(file.subarray(0, 4).toString("hex"), "00000100", brand.key);
    }
  }
});
