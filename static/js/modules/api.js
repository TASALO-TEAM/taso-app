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

async function request(path, { method = "GET", body, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Authorization: `tma ${initData()}` };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (e) {
    if (e && e.name === "AbortError") throw new ApiError(0, "timeout", "Tardó demasiado");
    throw new ApiError(0, "network", "Sin conexión");
  } finally {
    clearTimeout(timer);
  }
}

function errorFrom(res, data) {
  const err = data && data.error;
  return new ApiError(res.status, (err && err.code) || `http_${res.status}`, (err && err.message) || "Error");
}

export async function apiFetch(path, options) {
  const res = await request(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    /* cuerpo no JSON */
  }
  if (!res.ok || !data || data.ok === false) throw errorFrom(res, data);
  return data;
}

/** Descarga binaria (p. ej. la imagen de El Toque). Si falla, el cuerpo de error es JSON. */
export async function apiBlob(path, options = { timeoutMs: 20000 }) {
  const res = await request(path, options);
  if (!res.ok) {
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* sin cuerpo útil */
    }
    throw errorFrom(res, data);
  }
  return res.blob();
}

export const getMe = () => apiFetch("/me");
export const getRates = () => apiFetch("/rates");
export const getFuel = () => apiFetch("/fuel");
export const getYear = () => apiFetch("/year");
export const getEltoqueImage = () => apiBlob("/image/eltoque");
export const getHistorySummary = () => apiFetch("/history/summary");
export const getBlog = (account) => apiFetch(`/blog/${encodeURIComponent(account)}`);
export const getBlogPost = (account, permlink) =>
  apiFetch(`/blog/${encodeURIComponent(account)}/${encodeURIComponent(permlink)}`);
export const getHistoryDaily = (source, currency, days) =>
  apiFetch(`/history/daily?source=${encodeURIComponent(source)}&currency=${encodeURIComponent(currency)}&days=${days}`);
