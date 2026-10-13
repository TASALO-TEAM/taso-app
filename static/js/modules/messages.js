// Novedades (plan Perfil, P5): formato puro de GET /api/messages (sin DOM). Todo dato se trata como no confiable:
// ids no válidos se descartan, textos acotados, y el cuerpo solo llega a pantalla como Markdown seguro (modules/markdown.js).

export const SEEN_KEY = "tasalo:news:seen";
export const MAX_ITEMS = 20;

/** Lista válida y ordenada (más nuevos primero) a partir de lo que mande el servidor. */
export function normalizeMessages(items) {
  const out = [];
  for (const m of Array.isArray(items) ? items : []) {
    if (!m || typeof m !== "object" || !Number.isSafeInteger(m.id) || m.id <= 0) continue;
    const title = typeof m.title === "string" ? m.title.slice(0, 120).trim() : "";
    const body = typeof m.body === "string" ? m.body.slice(0, 4096) : "";
    if (!title && !body.trim()) continue;
    const t = typeof m.created_at === "string" ? Date.parse(m.created_at) : NaN;
    out.push({ id: m.id, title, body, format: m.format === "telegram" ? "telegram" : "markdown", createdAt: Number.isFinite(t) ? new Date(t).toISOString() : null });
  }
  return out.sort((a, b) => b.id - a.id).slice(0, MAX_ITEMS);
}

/**
 * Markdown «legacy» de Telegram (*negrita*, _cursiva_) → Markdown estándar (**negrita**, *cursiva*).
 * Solo toca marcadores con límite de palabra, así `snake_case` y los enlaces no se estropean.
 */
export function telegramToMarkdown(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/(^|[^\w*])\*([^\s*](?:[^*\n]*[^\s*])?)\*(?![\w*])/g, "$1**$2**")
    .replace(/(^|[^\w_])_([^\s_](?:[^_\n]*[^\s_])?)_(?![\w_])/g, "$1*$2*");
}

/** Cuerpo listo para el parser de Markdown. */
export const bodyMarkdown = (m) => (m && m.format === "telegram" ? telegramToMarkdown(m.body) : m && typeof m.body === "string" ? m.body : "");

export const latestId = (items) => items.reduce((max, m) => (m.id > max ? m.id : max), 0);

/** Cuántos mensajes son más nuevos que el último visto. */
export function unreadCount(items, seenId) {
  const seen = Number.isSafeInteger(seenId) && seenId > 0 ? seenId : 0;
  return items.filter((m) => m.id > seen).length;
}

export const unreadLabel = (n) => (n > 0 ? (n === 1 ? "1 nueva" : `${n} nuevas`) : "");

/** Último id visto (guardado en local); 0 si no hay o el almacenamiento no está disponible. */
export function readSeen(storage = globalThis.localStorage) {
  try {
    const n = Number.parseInt(storage.getItem(SEEN_KEY), 10);
    return Number.isSafeInteger(n) && n > 0 ? n : 0;
  } catch (_) {
    return 0;
  }
}

/** Guarda el id visto sin retroceder nunca (un id menor no pisa a uno mayor). */
export function writeSeen(id, storage = globalThis.localStorage) {
  if (!Number.isSafeInteger(id) || id <= 0) return;
  try {
    if (id > readSeen(storage)) storage.setItem(SEEN_KEY, String(id));
  } catch (_) {
    /* sin almacenamiento: se volverán a marcar como nuevas, sin más */
  }
}
