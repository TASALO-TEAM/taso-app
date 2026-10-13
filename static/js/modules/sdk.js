// Único punto de contacto con window.Telegram.WebApp. El resto de módulos importa de aquí.
// Fuera de Telegram (navegador normal) nada lanza: simplemente no hay identidad.
import { getSettings, resolveScheme } from "./settings.js";
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
  const system =
    (tg && tg.colorScheme) ||
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const settings = getSettings(); // el usuario puede forzar claro/oscuro y la convención sube/baja (Ajustes)
  document.documentElement.dataset.theme = resolveScheme(settings.theme, system);
  document.documentElement.toggleAttribute("data-invert", settings.invert);
  // Mercado puede tener su propia convención sube/baja; "auto" no pone nada y hereda la de Tasas.
  if (settings.marketUp === "red" || settings.marketUp === "green") document.documentElement.dataset.marketUp = settings.marketUp;
  else delete document.documentElement.dataset.marketUp;

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

/** Usuario del bot (sin @) tal como lo pone el servidor en la página; vacío si no está. */
export function botUsername() {
  const meta = document.querySelector('meta[name="tasalo-bot"]');
  const value = meta && meta.content ? meta.content.trim() : "";
  return /^[A-Za-z0-9_]{3,64}$/.test(value) ? value : "";
}

/**
 * Abre el selector de chats de Telegram con `text` (y un enlace al bot). false si el cliente no puede hacerlo
 * (navegador normal o Telegram antiguo): el llamador decide el plan B.
 */
export function shareText(text) {
  const tg = webApp();
  if (!tg || typeof tg.openTelegramLink !== "function" || !supports("6.1")) return false;
  const bot = botUsername();
  const link = bot ? `https://t.me/${bot}` : "https://t.me/";
  try {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Abre un enlace externo en el navegador (solo http/https). Llamar siempre desde un toque del usuario.
 * Fuera de Telegram, o con un cliente antiguo, usa window.open sin dar acceso a la miniapp (noopener).
 */
export function openLink(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
  const tg = webApp();
  if (tg && typeof tg.openLink === "function" && supports("6.1")) {
    try {
      tg.openLink(url);
      return true;
    } catch (_) {
      /* cae al plan B */
    }
  }
  try {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch (_) {
    return false;
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

// ---------- Formularios (S6): háptica, confirmaciones, botón principal, cierre con cambios y permiso del bot ----------

/** Vibración corta: "success" | "error" | "warning" (notificación) o "select" (cambio de selección). Sin soporte: nada. */
export function haptic(kind) {
  const tg = webApp();
  if (!tg || !tg.HapticFeedback || !supports("6.1")) return;
  try {
    if (kind === "select") tg.HapticFeedback.selectionChanged();
    else tg.HapticFeedback.notificationOccurred(kind);
  } catch (_) {
    /* sin háptica: no pasa nada */
  }
}

/**
 * Pregunta sí/no (borrar, descartar). Usa el diálogo nativo de Telegram (6.2+); en navegador, window.confirm.
 * El mensaje de Telegram admite hasta 256 caracteres.
 */
export function confirmAction(message) {
  const tg = webApp();
  const text = String(message).slice(0, 250);
  if (tg && typeof tg.showConfirm === "function" && supports("6.2")) {
    return new Promise((resolve) => {
      try {
        tg.showConfirm(text, (ok) => resolve(Boolean(ok)));
      } catch (_) {
        resolve(window.confirm(text));
      }
    });
  }
  return Promise.resolve(typeof window.confirm === "function" ? window.confirm(text) : false);
}

/** Pide a Telegram confirmar antes de cerrar la miniapp (para formularios con cambios sin guardar). */
export function setClosingConfirmation(on) {
  const tg = webApp();
  if (!tg || !supports("6.2")) return;
  try {
    if (on) tg.enableClosingConfirmation();
    else tg.disableClosingConfirmation();
  } catch (_) {
    /* cliente sin esta función */
  }
}

let mainHandler = null;

/** Muestra el botón principal de Telegram. false si el cliente no lo tiene: el formulario pinta el suyo. */
export function showMain(text, handler) {
  const tg = webApp();
  if (!tg || !tg.MainButton) return false;
  hideMain();
  mainHandler = handler;
  try {
    tg.MainButton.setText(text);
    tg.MainButton.onClick(handler);
    tg.MainButton.show();
    return true;
  } catch (_) {
    mainHandler = null;
    return false;
  }
}

/** Botón principal en curso (círculo de progreso y sin toques) o libre. */
export function setMainBusy(busy) {
  const tg = webApp();
  if (!tg || !tg.MainButton || !mainHandler) return;
  try {
    if (busy) {
      tg.MainButton.showProgress(false);
      tg.MainButton.disable();
    } else {
      tg.MainButton.hideProgress();
      tg.MainButton.enable();
    }
  } catch (_) {
    /* cliente sin progreso */
  }
}

export function hideMain() {
  const tg = webApp();
  if (!tg || !tg.MainButton) return;
  try {
    if (mainHandler) tg.MainButton.offClick(mainHandler);
    tg.MainButton.hideProgress();
    tg.MainButton.enable();
    tg.MainButton.hide();
  } catch (_) {
    /* nada que ocultar */
  }
  mainHandler = null;
}

/**
 * ¿El bot puede escribirle al usuario? true/false según `allows_write_to_pm` del initData; null si no se sabe
 * (navegador o cliente antiguo): en ese caso no se bloquea nada.
 */
export function canWriteToPm() {
  const tg = webApp();
  const user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
  if (!user || typeof user.allows_write_to_pm !== "boolean") return null;
  return user.allows_write_to_pm;
}

/** Pide permiso para que el bot escriba al usuario (6.9+). true si lo concede o no hace falta pedirlo. */
export function requestWriteAccess() {
  const tg = webApp();
  if (!tg || typeof tg.requestWriteAccess !== "function" || !supports("6.9")) return Promise.resolve(true);
  return new Promise((resolve) => {
    try {
      tg.requestWriteAccess((allowed) => resolve(Boolean(allowed)));
    } catch (_) {
      resolve(true);
    }
  });
}
