// Panel admin (plan Perfil, P4): formato puro de GET /api/admin/overview (sin DOM). Todo dato se trata como no confiable:
// números no finitos → 0, textos acotados. Los gráficos son barras con ancho en % (CSS); aquí solo se calculan los porcentajes.

export const WINDOWS = Object.freeze(["24h", "7d", "30d"]);
export const WINDOW_LABELS = Object.freeze({ "24h": "24 h", "7d": "7 días", "30d": "30 días" });
const DAY_LETTERS = ["D", "L", "M", "X", "J", "V", "S"];

const num = (v) => (Number.isFinite(v) ? v : 0);

export function normalizeWindow(w) {
  return WINDOWS.includes(w) ? w : "24h";
}

/** Entero legible: 1234 → «1234», 12345 → «12 345» (espacio fino, sin depender de la configuración regional). */
export function fmtInt(n) {
  const s = String(Math.round(num(n)));
  return s.length > 4 ? s.replace(/\B(?=(\d{3})+(?!\d))/g, "\u202f") : s;
}

export function fmtPct(n) {
  return `${num(n).toFixed(1).replace(".", ",")} %`;
}

export function fmtMs(n) {
  const ms = Math.round(num(n));
  return ms >= 1000 ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : `${ms} ms`;
}

/** «hace 3 min» a partir de una fecha ISO; vacío si no es válida. */
export function agoLabel(iso, nowMs) {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return "";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const hh = Math.round(m / 60);
  return hh < 48 ? `hace ${hh} h` : `hace ${Math.round(hh / 24)} d`;
}

/** Salud (`health.level`) → clase de color y píldora. El color nunca va solo: siempre hay texto. */
export function healthTone(level) {
  if (level === "ok") return { dot: "ok", pill: "on" };
  if (level === "warn") return { dot: "warn", pill: "warn" };
  if (level === "bad") return { dot: "bad", pill: "warn" };
  return { dot: "unknown", pill: "off" };
}

/** Filas para barras horizontales: porcentaje respecto al mayor valor (mínimo 3 % si hay algo, para que se vea). */
export function barRows(items, labelKey, valueKey, limit = 8) {
  const rows = (Array.isArray(items) ? items : [])
    .filter((i) => i && typeof i === "object")
    .map((i) => ({ label: String(i[labelKey] ?? "").slice(0, 60), value: Math.max(0, num(i[valueKey])) }))
    .slice(0, limit);
  const max = Math.max(0, ...rows.map((r) => r.value));
  return rows.map((r) => ({ ...r, pct: max === 0 ? 0 : r.value === 0 ? 0 : Math.max(3, Math.round((r.value / max) * 100)) }));
}

/** Uso de la API por cliente: peticiones, errores y su parte del total (para la barra apilada). */
export function clientShares(byClient) {
  const rows = (Array.isArray(byClient) ? byClient : [])
    .filter((c) => c && typeof c === "object")
    .map((c) => ({ label: String(c.client_id ?? "").slice(0, 40) || "desconocido", requests: Math.max(0, num(c.requests)), errors: Math.max(0, num(c.errors)) }));
  const total = rows.reduce((a, r) => a + r.requests, 0);
  return rows.map((r) => ({ ...r, share: total === 0 ? 0 : Math.round((r.requests / total) * 100) }));
}

/** Serie por día de la miniapp: letra del día de la semana, cantidad y altura relativa (0–100). */
export function daySeries(days) {
  const rows = (Array.isArray(days) ? days : [])
    .filter((d) => d && typeof d.day === "string")
    .map((d) => {
      const t = Date.parse(`${d.day}T12:00:00Z`);
      return { day: d.day, label: Number.isFinite(t) ? DAY_LETTERS[new Date(t).getUTCDay()] : "?", count: Math.max(0, num(d.count)) };
    });
  const max = Math.max(0, ...rows.map((r) => r.count));
  return rows.map((r) => ({ ...r, pct: max === 0 ? 0 : r.count === 0 ? 0 : Math.max(6, Math.round((r.count / max) * 100)) }));
}

/** Tareas del scheduler con errores, las peores primero (máx. `limit`). */
export function jobProblems(scheduler, limit = 5) {
  const jobs = scheduler && scheduler.ok && Array.isArray(scheduler.jobs) ? scheduler.jobs : [];
  return jobs
    .filter((j) => j && num(j.error_count) > 0)
    .sort((a, b) => num(b.error_count) - num(a.error_count))
    .slice(0, limit)
    .map((j) => ({ name: String(j.name || j.id || "").slice(0, 80), errors: num(j.error_count), lastError: j.last_error ? String(j.last_error).slice(0, 150) : "" }));
}

/** Texto de la tarjeta de Perfil (solo admins): estado general en una píldora. */
export function overviewPill(overview) {
  const level = overview && overview.health ? overview.health.level : "unknown";
  const t = healthTone(level);
  const text = overview && overview.health && overview.health.text ? String(overview.health.text) : "Ver estado";
  return { text, tone: t.pill };
}
