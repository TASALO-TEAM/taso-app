// Único punto de contacto con window.Telegram.WebApp. El resto de módulos importa de aquí.
// Fuera de Telegram (navegador normal) nada lanza: simplemente no hay identidad.
import { isVersionAtLeast } from "./version.js";

const webApp = () => (window.Telegram && window.Telegram.WebApp) || null;

/** initData CRUDO (el que valida el servidor). Vacío si no estamos dentro de Telegram. */
export function initData() {
  const tg = webApp();
  return tg && typeof tg.initData === "string" ? tg.initData : "";
}

export function hasIdentity() {
  return initData().length > 0;
}

/** ¿El cliente de Telegram tiene al menos esta versión del SDK? */
export function supports(minVersion) {
  const tg = webApp();
  return Boolean(tg) && isVersionAtLeast(tg.version, minVersion);
}

/**
 * start_param SOLO para enlaces profundos de la interfaz (p. ej. "tab_alertas").
 * Nunca es identidad: la identidad sale únicamente del initData validado en el servidor.
 */
export function startParam() {
  const tg = webApp();
  const value = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
  return typeof value === "string" ? value : "";
}

const HEX = /^#[0-9a-f]{6}$/i;

function cssColor(name) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return HEX.test(value) ? value : null;
}

/** Tema claro/oscuro según Telegram (o el sistema si no hay Telegram) + colores de cabecera y fondo. */
export function applyTheme() {
  const tg = webApp();
  const scheme =
    (tg && tg.colorScheme) ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.dataset.theme = scheme === "light" ? "light" : "dark";

  if (!tg) return;
  const bg = cssColor("--bg");
  const surface = cssColor("--surface");
  try {
    if (bg && supports("6.1")) {
      tg.setHeaderColor(bg);
      tg.setBackgroundColor(bg);
    }
    if (surface && supports("7.10")) tg.setBottomBarColor(surface);
  } catch (_) {
    /* cliente que no admite estos métodos: se ignora */
  }
}

let initialised = false;

let backHandler = null;

/** Botón «Atrás» de Telegram para overlays. false si el cliente no lo tiene (el overlay trae su propio botón). */
export function showBack(handler) {
  const tg = webApp();
  if (!tg || !tg.BackButton || !supports("6.1")) return false;
  hideBack();
  backHandler = handler;
  try {
    tg.BackButton.onClick(handler);
    tg.BackButton.show();
    return true;
  } catch (_) {
    backHandler = null;
    return false;
  }
}

export function hideBack() {
  const tg = webApp();
  if (!tg || !tg.BackButton) return;
  try {
    if (backHandler) tg.BackButton.offClick(backHandler);
    tg.BackButton.hide();
  } catch (_) {
    /* sin BackButton: nada que ocultar */
  }
  backHandler = null;
}

/** Arranque único: ready() una sola vez, expandir, tema y gestos. Idempotente. */
export function init() {
  if (initialised) return;
  initialised = true;
  applyTheme();
  const tg = webApp();
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    if (supports("7.7")) tg.disableVerticalSwipes();
    tg.onEvent("themeChanged", applyTheme);
  } catch (_) {
    /* un cliente antiguo no debe romper el arranque */
  }
}
