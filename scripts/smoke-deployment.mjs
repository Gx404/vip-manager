import assert from "node:assert/strict";

/**
 * Exercise an explicitly opted-in disposable deployment through its public HTTP entry.
 * Parameters: prepare|verify; PUBLIC_ORIGIN, ADMIN_USERNAME and ADMIN_PASSWORD in env.
 * Returns: exit code 0 on success; never prints credentials or response bodies.
 */
async function main() {
  if (process.env.VIP_SMOKE_ALLOW_WRITE !== "true") throw new Error("仅供隔离测试。确认后设置 VIP_SMOKE_ALLOW_WRITE=true。");
  const base = new URL(process.env.PUBLIC_ORIGIN || "http://127.0.0.1:8080").origin;
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) throw new Error("测试账号配置缺失。");
  const phase = process.argv[2];
  if (!["prepare", "verify"].includes(phase)) throw new Error("参数必须为 prepare 或 verify。");
  const id = "8a85d6af-9e66-4ec8-9f47-cc37c342e013";
  let cookie = "";
  const request = (path, body) => fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Origin: base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body === undefined ? {} : {
        "Content-Type": "application/json", "X-Requested-With": "membership-dashboard",
      }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = async (path, body, status = 200) => {
    const response = await request(path, body);
    assert.equal(response.status, status, path + " status");
    return response.json();
  };
  const health = await json("/api/health");
  assert.equal(health.status, "ok");
  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") || "", /text\/html/);
  const html = await page.text();
  assert.match(html, /id="root"/);
  const asset = html.match(/src="(\/assets\/[^"]+\.js)"/);
  assert.ok(asset, "Built JS asset must be present");
  const js = await request(asset[1]);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type") || "", /javascript/);
  assert.equal((await request("/api/subscriptions")).status, 401);
  const publicDashboard = process.env.PUBLIC_DASHBOARD === "true";
  const anonymous = await request("/api/dashboard");
  assert.equal(anonymous.status, publicDashboard ? 200 : 401);
  if (publicDashboard) {
    const state = await anonymous.json();
    assert.equal(state.canManage, false);
    assert.ok(state.items.every(item => item.note === "" && item.version === 0));
    assert.equal(state.items.length, phase === "prepare" ? 0 : 1);
  }
  assert.equal((await request("/api/subscriptions", { action: "initialize" })).status, 401);
  const login = await request("/api/auth/login", { username, password });
  assert.equal(login.status, 200);
  const setCookie = login.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/i);
  cookie = setCookie.split(";")[0];
  const original = await json("/api/subscriptions");
  if (phase === "prepare") {
    assert.equal(original.items.length, 0, "Use a fresh disposable database only");
    const item = {
      id, name: "CI deployment test", plan: "isolated", category: "购物会员",
      amount: 1.23, cycle: "monthly", customDays: 30,
      startDate: "2198-12-31", endDate: "2199-01-31",
      reminderDays: 7, autoRenew: false, note: "", color: "#269979", version: 0,
    };
    const created = await json("/api/subscriptions", { action: "create", item }, 201);
    assert.equal(created.item.id, id);
    const updated = await json("/api/subscriptions", {
      action: "update", id, version: created.item.version,
      item: { ...created.item, note: "survives-restart" },
    });
    const renewed = await json("/api/subscriptions", {
      action: "renew", id, version: updated.item.version,
    });
    assert.equal(renewed.item.endDate, "2199-02-28");
  } else {
    const item = original.items.find(record => record.id === id);
    assert.ok(item, "Record must survive container restart");
    assert.equal(item.note, "survives-restart");
    assert.equal(item.endDate, "2199-02-28");
    assert.equal(item.amount, 1.23);
    await json("/api/subscriptions", { action: "delete", id, version: item.version });
    const state = await json("/api/subscriptions");
    assert.equal(state.items.length, 0);
  }
  await json("/api/auth/logout", {});
  assert.equal((await request("/api/subscriptions")).status, 401);
  if (publicDashboard) {
    const state = await json("/api/dashboard");
    assert.equal(state.canManage, false);
    assert.equal(state.items.length, phase === "prepare" ? 1 : 0);
    assert.ok(state.items.every(item => item.note === "" && item.version === 0));
  }
  console.log("Deployment smoke check passed: " + phase);
}

main().catch(error => {
  console.error("部署冒烟测试失败：", error instanceof Error ? error.message : "未知错误");
  process.exitCode = 1;
});
