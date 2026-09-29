import express, { type ErrorRequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DatabaseSync } from "node:sqlite";
import { AuthService } from "./auth.ts";
import { SubscriptionService } from "./subscriptions.ts";
import { ApiError } from "./errors.ts";
import type { Config } from "./config.ts";

const cookieName = "membership_session";
function tokenFromCookie(value: string | undefined): string {
  const matches = (value ?? "").split(";").map(v => v.trim()).filter(v => v.startsWith(cookieName + "="));
  return matches.length === 1 ? matches[0].slice(cookieName.length + 1) : "";
}
const loginSchema = z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(256) }).strict();

/** Build the independent HTTP API. Caller owns server lifecycle and database cleanup. */
export function createApp(db: DatabaseSync, config: Config) {
  const app = express();
  const auth = new AuthService(db, config);
  const subscriptions = new SubscriptionService(db, config.timeZone);
  const cookieOptions = { httpOnly: true, sameSite: "lax" as const, secure: config.cookieSecure, path: "/" };
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ? 1 : false);
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.set({
      "X-Request-ID": res.locals.requestId,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-site",
    });
    const origin = req.get("Origin");
    if (origin && origin !== config.publicOrigin) return next(new ApiError(403, "请求来源未获允许。", "ORIGIN_DENIED"));
    if (origin) {
      res.set("Access-Control-Allow-Origin", config.publicOrigin);
      res.set("Access-Control-Allow-Credentials", "true");
      res.vary("Origin");
    }
    if (req.method === "OPTIONS") {
      res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.set("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
      res.sendStatus(204);
      return;
    }
    if (!["GET","HEAD"].includes(req.method)) {
      if (req.get("X-Requested-With") !== "membership-dashboard") return next(new ApiError(403,"请求校验失败，请刷新页面。","CSRF_REJECTED"));
      if (!req.is("application/json")) return next(new ApiError(415,"接口只接受 JSON 请求。"));
    }
    next();
  });
  app.use(express.json({ limit: "20kb", strict: true }));

  app.get("/api/health", (_req,res) => {
    db.prepare("SELECT 1").get();
    res.json({ status:"ok" });
  });
  app.post("/api/auth/login", async (req,res) => {
    const body = loginSchema.parse(req.body);
    const result = await auth.login(body.username,body.password,req.ip ?? "unknown");
    const previous = tokenFromCookie(req.get("Cookie"));
    if (previous) auth.logout(previous);
    res.cookie(cookieName,result.token,{ ...cookieOptions,maxAge:config.sessionSeconds*1000 });
    res.json({ user:result.user });
  });
  app.post("/api/auth/logout", (req,res) => {
    auth.logout(tokenFromCookie(req.get("Cookie")));
    res.clearCookie(cookieName,cookieOptions);
    res.json({ signedOut:true });
  });
  // Public reading is an explicit deployment choice. Editing always goes through authentication below.
  app.get("/api/dashboard", (req,res) => {
    const user = auth.session(tokenFromCookie(req.get("Cookie")));
    if (user) {
      res.json({ items: subscriptions.list(user.id).items, canManage: true, publicDashboard: config.publicDashboard });
      return;
    }
    if (!config.publicDashboard) throw new ApiError(401,"请先登录自己的管理员账号。","AUTH_REQUIRED");
    res.json({ items: subscriptions.listPublic(), canManage: false, publicDashboard: true });
  });
  app.use("/api", (req,res,next) => {
    const user = auth.session(tokenFromCookie(req.get("Cookie")));
    if (!user) return next(new ApiError(401,"请先登录自己的管理员账号。","AUTH_REQUIRED"));
    res.locals.user = user;
    next();
  });
  app.get("/api/auth/session", (_req,res) => res.json({ user:res.locals.user }));
  app.get("/api/subscriptions", (_req,res) => res.json(subscriptions.list(res.locals.user.id)));
  app.post("/api/subscriptions", (req,res) => {
    const result = subscriptions.execute(res.locals.user.id,req.body);
    res.status(req.body.action === "create" ? 201 : 200).json(result);
  });
  app.use((_req,_res,next) => next(new ApiError(404,"接口不存在。","NOT_FOUND")));
  const handleError: ErrorRequestHandler = (error,_req,res,_next) => {
    if (error instanceof ApiError) {
      if (error.status === 429) res.set("Retry-After","900");
      res.status(error.status).json({ error:error.message,code:error.code });
    } else if (error instanceof z.ZodError) {
      res.status(400).json({ error:"提交内容不正确：" + (error.issues[0]?.message ?? "请检查输入。"),code:"INVALID_INPUT" });
    } else if (error?.type === "entity.parse.failed") {
      res.status(400).json({ error:"JSON 格式不正确。",code:"INVALID_JSON" });
    } else if (error?.type === "entity.too.large") {
      res.status(413).json({ error:"提交内容超过大小限制。",code:"BODY_TOO_LARGE" });
    } else {
      console.error("API error", { requestId:res.locals.requestId,name:error instanceof Error ? error.name : "UnknownError" });
      res.status(500).json({ error:"服务暂时不可用，数据未确认保存，请稍后重试。",code:"INTERNAL_ERROR",requestId:res.locals.requestId });
    }
  };
  app.use(handleError);
  return app;
}
