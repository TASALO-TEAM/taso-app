// Cliente del BFF (/api/*). Siempre manda el initData en Authorization; el servidor decide quién eres.
import { initData } from "./sdk.js";

function meta(name) {
  const el = document.querySelector(`meta[name="${name}"]`);
  return el ? el.content : "";
}

export const BASE = meta("tasalo-base");

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status; // 0 = sin respuesta (red/timeout)
    this.code = code;
  }
}

export async function apiFetch(path, { method = "GET", body, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Authorization: `tma ${initData()}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* cuerpo no JSON */
    }
    if (!res.ok || !data || data.ok === false) {
      const err = data && data.error;
      throw new ApiError(res.status, (err && err.code) || `http_${res.status}`, (err && err.message) || "Error");
    }
    return data;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (e && e.name === "AbortError") throw new ApiError(0, "timeout", "Tardó demasiado");
    throw new ApiError(0, "network", "Sin conexión");
  } finally {
    clearTimeout(timer);
  }
}

export const getMe = () => apiFetch("/me");
