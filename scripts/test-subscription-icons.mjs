/** Local production-build icon QA. Fixed guest fixtures; no database or production writes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { brands, matchBrand } from "../shared/brands.ts";
import { dateKey, shiftDate } from "../shared/subscriptions.ts";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const today = dateKey();
const names = ["iCloud", "Open Ai", "VMISS", "移动云电脑", "Open Ai", "DMIT", "YUNYOO", "Grok", "百度云网盘", "阿里云", "盒马", "ISVORO", "淘宝", "网易云音乐", "醒图", "BiliBili", "京东"];
const items = names.map((name, index) => ({
  id: randomUUID(), name, plan: index === 3 ? "32+200" : index === 2 ? "Tri" : "订阅套餐", category: "云服务与网络",
  amount: index === 3 ? 29.9 : 25, currency: "CNY", cycle: "monthly", customDays: 30,
  startDate: shiftDate(today, -1), endDate: shiftDate(today, 30), reminderDays: 7, autoRenew: false,
  note: "", color: "#269979", version: 0, purchaseDate: shiftDate(today, -1), fxRateToCny: 1,
  fxRateDate: shiftDate(today, -1), fxRateSource: "manual",
}));
const output = fileURLToPath(new URL("../outputs/subscription-icons-tests/", import.meta.url));
const errors = [], layouts = [], checks = [], blocked = new Set(), brokenPaths = new Set();
let server, browser, fallbackMode = false;

try {
  await mkdir(output, { recursive: true });
  assert.equal(matchBrand("VMISS")?.key, "vmiss");
  assert.equal(matchBrand("移动云电脑")?.key, "mobile-cloud-pc");
  assert.equal(brands.length, 63);
  const web = express();
  web.get("/api/dashboard", (_req, res) => res.json({
    items: fallbackMode ? [items[2], { ...items[3], id: randomUUID(), name: "未知品牌测试" }] : items,
    canManage: false, publicDashboard: true,
  }));
  web.get("/api/health", (_req, res) => res.json({ status: "ok" }));
  web.get("/icon-gallery", (_req, res) => res.type("html").send("<!doctype html><html><head><meta charset='utf-8'><title>本地图标检查</title></head><body></body></html>"));
  web.use("/api", (_req, res) => res.status(404).json({ error: "Guest fixture only" }));
  web.use(express.static(fileURLToPath(new URL("../frontend/dist/", import.meta.url))));
  server = web.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", timezoneId: "Asia/Singapore" });
  await context.route("**/*", route => {
    const request = route.request(), url = request.url();
    if (request.method() !== "GET") return route.abort("blockedbyclient");
    if (brokenPaths.has(new URL(url).pathname)) return route.abort("failed");
    if (url.startsWith(origin + "/") || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
    blocked.add(new URL(url).origin); return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  const rows = () => page.locator(".subscription-grid > article");
  await rows().first().waitFor();

  async function assertIcons() {
    assert.equal(await rows().count(), names.length);
    for (const row of await rows().all()) {
      await row.scrollIntoViewIfNeeded();
      const name = await row.getAttribute("aria-label"), expected = matchBrand(name);
      assert.ok(expected, `Known fixture brand: ${name}`);
      assert.equal(await row.locator(".service-logo").getAttribute("data-brand"), expected.key, name);
      const result = await row.locator(".service-logo img").evaluate(async img => {
        try { await img.decode(); } catch { /* Return the actual decoding state. */ }
        return { src: new URL(img.currentSrc || img.src).pathname, loaded: img.complete && img.naturalWidth > 0 };
      });
      assert.equal(result.src, expected.icon, name);
      assert.equal(result.loaded, true, name);
    }
  }
  async function theme(dark) {
    if (await page.locator("html").getAttribute("data-appearance") !== (dark ? "dark" : "light")) {
      await page.getByRole("button", { name: dark ? "切换到黑夜模式" : "切换到明亮模式", exact: true }).click();
    }
  }
  for (const mode of ["grid", "list"]) {
    await page.getByRole("button", { name: mode === "grid" ? "卡片视图" : "紧凑列表视图", exact: true }).click();
    for (const dark of [false, true]) for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await theme(dark); await assertIcons();
      const overflow = await page.evaluate(() => ({ page: document.documentElement.scrollWidth > innerWidth + 1,
        cards: [...document.querySelectorAll(".subscription-grid > article")].some(row => row.scrollWidth > row.clientWidth + 1) }));
      assert.deepEqual(overflow, { page: false, cards: false });
      await page.evaluate(() => scrollTo(0, 0));
      const filename = `${mode}-${width}-${dark ? "dark" : "light"}.png`;
      await page.screenshot({ path: `${output}/${filename}`, fullPage: true, animations: "disabled" });
      layouts.push(filename);
    }
  }
  checks.push("all-17-subscriptions-resolve-to-decoded-local-brand-images", "vmiss-and-mobile-cloud-pc-have-native-brand-artwork", "grid-list-desktop-mobile-light-dark-fit-without-overflow");

  const gallery = await context.newPage();
  await gallery.goto(origin + "/icon-gallery");
  await gallery.evaluate(entries => {
    document.body.style.cssText = "margin:24px;background:#f4f4f5;color:#18181b;font:14px sans-serif;display:grid;grid-template-columns:repeat(7,1fr);gap:16px";
    for (const brand of entries) {
      const tile = document.createElement("div"); tile.style.cssText = "display:flex;align-items:center;gap:12px;padding:12px;background:white;border-radius:12px;min-width:0";
      const img = document.createElement("img"); img.src = brand.icon; img.alt = brand.label; img.style.cssText = "width:44px;height:44px;object-fit:contain;flex-shrink:0";
      const label = document.createElement("span"); label.textContent = brand.label; tile.append(img, label); document.body.append(tile);
    }
  }, brands);
  const decoded = await gallery.locator("img").evaluateAll(async images => {
    await Promise.all(images.map(img => img.decode().catch(() => {})));
    return images.map(img => ({ label: img.alt, loaded: img.complete && img.naturalWidth > 0 }));
  });
  assert.equal(decoded.length, brands.length); assert.ok(decoded.every(icon => icon.loaded));
  await gallery.screenshot({ path: `${output}/all-63-brands.png`, fullPage: true }); await gallery.close();
  checks.push("all-63-curated-brand-assets-decode");

  fallbackMode = true; brokenPaths.add(matchBrand("VMISS").icon);
  await page.reload(); await rows().first().waitFor();
  for (const row of await rows().all()) await row.scrollIntoViewIfNeeded();
  const vmiss = page.getByRole("article", { name: "VMISS", exact: true });
  await vmiss.locator(".service-logo.logo-initial > span").waitFor();
  assert.equal(await vmiss.locator(".service-logo > span").innerText(), "V");
  assert.equal(await vmiss.locator(".service-logo img").count(), 0);
  assert.equal(await page.getByRole("article", { name: "未知品牌测试", exact: true }).locator(".service-logo > span").innerText(), "未");
  checks.push("unknown-brand-and-failed-image-retain-initial-fallback");
  assert.deepEqual(errors, []); checks.push("no-javascript-errors-or-external-icon-fetches");
  const result = { passed: true, checkedAt: new Date().toISOString(), subscriptionCount: names.length, brandCount: brands.length,
    checks, layouts, pageErrors: errors, blockedOrigins: [...blocked], productionDataWritten: false };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(`${output}/result.json`, JSON.stringify({ passed: false, checks, layouts, pageErrors: errors,
    error: error instanceof Error ? error.message : String(error), productionDataWritten: false }, null, 2) + "\n");
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
}
