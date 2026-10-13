// «Mis estadísticas» (plan Perfil, P4b): formato puro de GET /api/me/stats (sin DOM). Todo dato se trata como no confiable:
// números no finitos → 0, textos acotados. Reutiliza los formateadores y las barras del panel admin.
import { agoLabel, barRows, fmtInt, fmtPct, normalizeWindow as normalizeAdminWindow, WINDOWS, WINDOW_LABELS } from "./admin.js";

export { WINDOWS, WINDOW_LABELS };
export const DEFAULT_WINDOW = "7d";

const num = (v) => (Number.isFinite(v) ? v : 0);

/** Ventana válida; si no, 7 días (a diferencia del panel admin, que abre en 24 h). */
export function normalizeWindow(w) {
  return WINDOWS.includes(w) ? normalizeAdminWindow(w) : DEFAULT_WINDOW;
}

const withSlash = (name) => (String(name).startsWith("/") ? String(name) : `/${name}`);

/** Barras de comandos del usuario: «/p», «/ms»… ordenados por uso. */
export function commandRows(bot, limit = 8) {
  const items = bot && bot.ok && Array.isArray(bot.commands) ? bot.commands : [];
  return barRows(items.map((c) => ({ label: withSlash(c && c.name != null ? c.name : ""), count: c && c.count })), "label", "count", limit);
}

/** Barras de fuentes consultadas (eltoque, bcc…). */
export function sourceRows(bot, limit = 6) {
  const items = bot && bot.ok && Array.isArray(bot.sources) ? bot.sources : [];
  return barRows(items.map((s) => ({ label: s && s.name != null ? s.name : "", count: s && s.count })), "label", "count", limit);
}

/** Barras de las monedas más consultadas en Mercado. */
export function coinRows(app, limit = 5) {
  const items = app && app.ok && Array.isArray(app.coins) ? app.coins : [];
  return barRows(items.map((c) => ({ label: c && c.name != null ? c.name : "", count: c && c.count })), "label", "count", limit);
}

/** Fecha corta en hora de Cuba («3 ene 2026»); vacío si no es válida. */
export function dateLabel(iso) {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  try {
    return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Havana" }).format(new Date(t)).replace(/\./g, "");
  } catch (_) {
    return "";
  }
}

/** Línea «Usas el bot desde… · último uso…» (solo con lo que haya). */
export function sinceLine(bot, nowMs) {
  if (!bot || !bot.ok) return "";
  const since = dateLabel(bot.first_seen);
  const ago = agoLabel(bot.last_seen, nowMs);
  return [since ? `Usas el bot desde ${since}` : "", ago ? `último uso ${ago}` : ""].filter(Boolean).join(" · ");
}

/** Porcentaje de éxito legible; «—» si no hay comandos en el periodo. */
export const successLabel = (bot) => (bot && bot.ok && bot.success_rate != null && num(bot.total) > 0 ? fmtPct(bot.success_rate) : "—");

/** ¿No hay nada que enseñar en el periodo? (ambos bloques sin actividad o sin datos). */
export function isEmpty(data) {
  const bot = data && data.bot && data.bot.ok ? num(data.bot.total) : 0;
  const app = data && data.app && data.app.ok ? num(data.app.mercado_queries) + num(data.app.alerts_active) + num(data.app.alerts_triggered) : 0;
  return bot === 0 && app === 0;
}

/** Los dos bloques caídos a la vez (la pantalla ofrece reintentar en vez de mostrar ceros). */
export const allDown = (data) => !data || ((!data.bot || !data.bot.ok) && (!data.app || !data.app.ok));

export { fmtInt };
