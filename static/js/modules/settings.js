// Ajustes del usuario (plan Perfil, P3). Parte pura (normalizar, tema, monedas ocultas) + persistencia tolerante:
// localStorage al instante y CloudStorage de Telegram (si el cliente es ≥ 6.9) para que sigan al usuario entre dispositivos.
// Nada de esto toca el servidor. Un dato raro o ausente cae siempre al valor por defecto.
import { load, save } from "./storage.js";

export const SETTINGS_KEY = "tasalo:settings";
const CLOUD_KEY = "settings";
export const THEMES = Object.freeze(["auto", "light", "dark"]);
// `marketUp`: color de ▲ en Mercado. "auto" = el mismo criterio que Tasas (`invert`); "red"/"green" lo fija solo para Mercado.
export const MARKET_UP = Object.freeze(["auto", "red", "green"]);
export const DEFAULTS = Object.freeze({ theme: "auto", invert: false, marketUp: "auto", hidden: Object.freeze([]) });
const HIDDEN_RE = /^[A-Z0-9_]{1,24}:[A-Z0-9_.-]{1,16}$/;
const MAX_HIDDEN = 200;

/** Ajustes válidos a partir de cualquier cosa guardada (nunca lanza). `hidden` = lista «FUENTE:MONEDA» sin repetidos. */
export function normalize(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const hidden = Array.isArray(r.hidden)
    ? [...new Set(r.hidden.filter((x) => typeof x === "string" && HIDDEN_RE.test(x)))].slice(0, MAX_HIDDEN)
    : [];
  return {
    theme: THEMES.includes(r.theme) ? r.theme : DEFAULTS.theme,
    invert: r.invert === true,
    marketUp: MARKET_UP.includes(r.marketUp) ? r.marketUp : DEFAULTS.marketUp,
    hidden,
  };
}

/** Esquema real a pintar: «auto» sigue a Telegram/sistema (`system`), lo demás manda el usuario. */
export function resolveScheme(theme, system) {
  if (theme === "light" || theme === "dark") return theme;
  return system === "light" ? "light" : "dark";
}

export const hiddenKey = (sourceId, code) => `${String(sourceId).toUpperCase()}:${String(code).toUpperCase()}`;

/** Conjunto para `visibleRates(..., hidden)`. */
export function hiddenSet(settings) {
  return new Set(normalize(settings).hidden);
}

/** Copia de los ajustes con esa moneda mostrada u oculta. */
export function withHidden(settings, sourceId, code, hide) {
  const s = normalize(settings);
  const key = hiddenKey(sourceId, code);
  const rest = s.hidden.filter((k) => k !== key);
  return { ...s, hidden: hide ? [...rest, key] : rest };
}

export const hiddenCount = (settings, sourceId) => {
  const prefix = `${String(sourceId).toUpperCase()}:`;
  return normalize(settings).hidden.filter((k) => k.startsWith(prefix)).length;
};

// ---------- Persistencia ----------

let current = normalize(load(SETTINGS_KEY, null));

export const getSettings = () => current;

/** Aplica un cambio parcial, lo guarda local y en la nube y devuelve los ajustes nuevos. */
export function updateSettings(patch) {
  current = normalize({ ...current, ...(patch || {}) });
  save(SETTINGS_KEY, current);
  cloudSet(current);
  return current;
}

function cloud() {
  try {
    const tg = window.Telegram && window.Telegram.WebApp;
    if (tg && tg.CloudStorage && typeof tg.isVersionAtLeast === "function" && tg.isVersionAtLeast("6.9")) return tg.CloudStorage;
  } catch (_) {
    /* sin CloudStorage */
  }
  return null;
}

function cloudSet(settings) {
  const cs = cloud();
  if (!cs) return;
  try {
    cs.setItem(CLOUD_KEY, JSON.stringify(settings), () => {});
  } catch (_) {
    /* la copia local ya está guardada */
  }
}

/**
 * Trae los ajustes de la nube (si existen) y los adopta. Resuelve true si cambiaron respecto a lo local.
 * Nunca rechaza ni tarda más de `timeoutMs`: sin nube o con error, se queda lo local.
 */
export function syncFromCloud(timeoutMs = 2500) {
  const cs = cloud();
  if (!cs) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    try {
      cs.getItem(CLOUD_KEY, (err, value) => {
        clearTimeout(timer);
        if (err || !value) return resolve(false);
        let parsed = null;
        try {
          parsed = JSON.parse(value);
        } catch (_) {
          return resolve(false);
        }
        const next = normalize(parsed);
        const changed = JSON.stringify(next) !== JSON.stringify(current);
        if (changed) {
          current = next;
          save(SETTINGS_KEY, current);
        }
        resolve(changed);
      });
    } catch (_) {
      clearTimeout(timer);
      resolve(false);
    }
  });
}
