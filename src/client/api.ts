import type { ApiErrorBody } from "../shared/api";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: { code: string; message: string } | null;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, status: 0, data: null, error: { code: "network", message: "Немає з'єднання з сервером" } };
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* без тіла */
  }
  if (res.ok) return { ok: true, status: res.status, data: (json as T) ?? null, error: null };
  const error = (json as ApiErrorBody | null)?.error ?? { code: "error", message: `Помилка (${res.status})` };
  return { ok: false, status: res.status, data: null, error };
}

export const apiGet = <T>(path: string) => api<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => api<T>("POST", path, body);
export const apiPut = <T>(path: string, body?: unknown) => api<T>("PUT", path, body);
export const apiPatch = <T>(path: string, body?: unknown) => api<T>("PATCH", path, body);
export const apiDelete = <T>(path: string, body?: unknown) => api<T>("DELETE", path, body);
