/** The only frontend-to-backend transport. No hosting-provider SDK or database code. */
const base = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
export class ApiError extends Error {
  code: string; status: number;
  constructor(message: string, status: number, code: string) {
    super(message); this.status=status; this.code=code;
  }
}

/** Call the configured API with HttpOnly session cookies and bounded network time. */
export async function apiRequest<T>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(base+path, {
      method:body===undefined ? "GET" : "POST",
      credentials:"include", cache:"no-store",
      headers:body===undefined ? {} : { "Content-Type":"application/json","X-Requested-With":"membership-dashboard" },
      body:body===undefined ? undefined : JSON.stringify(body),
      signal:AbortSignal.timeout(path.startsWith("/payments/") ? 120000 : 15000),
    });
  } catch {
    throw new ApiError("暂时连接不上后端，请检查服务是否运行；如刚刚提交过，请先刷新确认再重试。",0,"NETWORK_ERROR");
  }
  const result = await response.json().catch(() => null);
  if (!result) throw new ApiError("后端返回了无效内容，请检查 /api 反向代理。",response.status,"INVALID_RESPONSE");
  if (!response.ok) throw new ApiError(result.error || "请求失败，请重试。",response.status,result.code || "REQUEST_FAILED");
  return result as T;
}
