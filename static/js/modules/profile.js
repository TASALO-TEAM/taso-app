// Perfil (plan Perfil, P2): formato puro de los datos del usuario que entra (sin DOM).
// Todo sale del `user` que devuelve GET /api/me, que el servidor arma SOLO con el initData validado.

import { imageStatus, priceStatus, spotlightStatus, yearStatus } from "./alerts.js";

const LANGUAGES = Object.freeze({
  es: "Español", en: "English", pt: "Português", fr: "Français", it: "Italiano", de: "Deutsch", ru: "Русский", uk: "Українська",
});

const text = (v) => (typeof v === "string" ? v.trim() : "");

/** Nombre para mostrar: «Nombre Apellido»; si no hay, el @usuario; si tampoco, «Usuario». */
export function displayName(user) {
  const u = user || {};
  const full = [text(u.first_name), text(u.last_name)].filter(Boolean).join(" ");
  return full || text(u.username).replace(/^@/, "") || "Usuario";
}

/** Inicial en mayúscula para el avatar cuando no hay foto (un solo carácter Unicode). */
export function initialOf(user) {
  const first = Array.from(displayName(user))[0] || "?";
  return first.toLocaleUpperCase("es");
}

/** «@usuario» o cadena vacía si no tiene. */
export function handleOf(user) {
  const name = text((user || {}).username).replace(/^@/, "");
  return name ? `@${name}` : "";
}

/** Nombre del idioma de Telegram («es» → «Español»); un código raro se muestra tal cual en mayúsculas. */
export function languageLabel(code) {
  const base = text(code).toLowerCase().split("-")[0];
  if (!base) return "";
  return Object.hasOwn(LANGUAGES, base) ? LANGUAGES[base] : base.toUpperCase();
}

/** Foto solo si es https sin credenciales y de tamaño razonable (el servidor ya filtra; aquí se repite por seguridad). */
export function safePhotoUrl(url) {
  if (typeof url !== "string" || url.length === 0 || url.length > 512 || /\s/.test(url)) return "";
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password ? u.href : "";
  } catch (_) {
    return "";
  }
}

/** Etiquetas de la tarjeta de perfil, en orden. tone: "accent" resalta (admin/premium), "plain" es neutra. */
export function profileChips(user) {
  const u = user || {};
  const chips = [];
  if (Number.isSafeInteger(u.id) && u.id > 0) chips.push({ key: "id", text: `ID ${u.id}`, tone: "plain" });
  const lang = languageLabel(u.language_code);
  if (lang) chips.push({ key: "lang", text: lang, tone: "plain" });
  if (u.is_premium === true) chips.push({ key: "premium", text: "Premium", tone: "accent" });
  if (u.is_admin === true) chips.push({ key: "admin", text: "Admin", tone: "accent" });
  return chips;
}

/** Resumen de la tarjeta «Mis avisos»: cuántos de los 4 tipos están activos. `data` = respuesta de GET /api/alerts (o null). */
export function avisosSummary(data, now) {
  if (!data || typeof data !== "object") return { text: "Ver mis avisos", tone: "off" };
  const safe = (fn) => {
    try {
      return fn() || {};
    } catch (_) {
      return {};
    }
  };
  const statuses = [
    safe(() => priceStatus(data.price)),
    safe(() => imageStatus(data.image)),
    safe(() => yearStatus(data.year, now)),
    safe(() => spotlightStatus(data.spotlight, now)),
  ];
  const on = statuses.filter((st) => st.tone === "on").length;
  if (on === 0) {
    // Si alguna sección no cargó, no se puede afirmar que no haya avisos.
    return statuses.some((st) => st.tone === "warn") ? { text: "No disponible", tone: "warn" } : { text: "Sin avisos activos", tone: "off" };
  }
  return { text: on === 1 ? "1 de 4 activo" : `${on} de 4 activos`, tone: "on" };
}
