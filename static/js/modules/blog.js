// Lógica de la pestaña Blog (sin DOM): cuentas, Spotlight del día, fechas en hora de Cuba y aviso de datos viejos.
import { cubaDateKey, cubaParts, toMs } from "./cuba-time.js";
import { relative } from "./format.js";

export const ACCOUNTS = [
  { id: "tasalo", label: "@tasalo" },
  { id: "ersusoficial", label: "@ersusoficial" },
];
export const DEFAULT_ACCOUNT = "tasalo";

/**
 * «Recibir cada día» lleva a la alerta de Spotlight, que vive en la pestaña Alertas (S6). Hasta que exista,
 * el botón no se muestra (no se deja al usuario en una pantalla vacía). S6 pone esto en true y lee `#/alertas?nueva=tspl`.
 */
export const SPOTLIGHT_ALERT_READY = false;
export const SPOTLIGHT_ALERT_HASH = "#/alertas?nueva=tspl";

/** Una cuenta guardada que ya no existe (o un valor raro) cae a la de TASALO. */
export function normalizeAccount(value) {
  return ACCOUNTS.some((a) => a.id === value) ? value : DEFAULT_ACCOUNT;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** «10 oct 2026» en hora de Cuba; sin fecha válida, cadena vacía. */
export function postDate(created) {
  const ms = toMs(created);
  if (ms === null) return "";
  const p = cubaParts(ms);
  return `${String(p.day).padStart(2, "0")} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** El Spotlight más reciente de la lista (el servidor ya marca `spotlight`); null si no hay ninguno. */
export function spotlightOf(posts) {
  if (!Array.isArray(posts)) return null;
  let best = null;
  for (const post of posts) {
    if (!post || post.spotlight !== true) continue;
    if (best === null || (toMs(post.created) ?? -Infinity) > (toMs(best.created) ?? -Infinity)) best = post;
  }
  return best;
}

/** «Spotlight de hoy» solo si se publicó hoy (fecha de Cuba); si no, «Último Spotlight». */
export function spotlightLabel(post, nowMs) {
  const ms = post ? toMs(post.created) : null;
  return ms !== null && cubaDateKey(ms) === cubaDateKey(nowMs) ? "Spotlight de hoy" : "Último Spotlight";
}

/** Aviso cuando lo que se ve no es lo más reciente. Los posts no «caducan» por edad: solo se avisa de fallos. */
export function blogBanner({ fetchedAt, now, offline = false, apiError = false, stale = false }) {
  if (!offline && !apiError && !stale) return null;
  const age = toMs(fetchedAt) === null ? "" : ` · datos de ${relative(fetchedAt, now)}`;
  if (offline) return { text: `Sin conexión${age}`, error: true };
  return { text: `No se pudo actualizar${age}`, error: true };
}

/** Lista de posts válida (por si lo guardado en el teléfono o la respuesta vienen raros). */
export function validPosts(data) {
  if (!data || !Array.isArray(data.posts)) return [];
  return data.posts.filter((p) => p && typeof p.permlink === "string" && typeof p.title === "string" && typeof p.author === "string");
}
