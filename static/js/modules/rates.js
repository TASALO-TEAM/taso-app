// Lógica de la pantalla de tasas (sin DOM): fuentes, nombres, ocultas y avisos de datos viejos.
import { isStale, relative } from "./format.js";

export const SOURCES = [
  { id: "eltoque", title: "El Toque", hasBuySell: false },
  { id: "qvapay", title: "QvaPay", hasBuySell: true },
  { id: "bcc", title: "BCC", hasBuySell: false },
  { id: "cadeca", title: "CADECA", hasBuySell: true },
];
export const DEFAULT_SOURCE = "eltoque";

const NAMES = {
  EUR: "Euro", USD: "Dólar", MLC: "MLC", BTC: "Bitcoin", TRX: "TRON", USDT: "Tether",
  CAD: "Canadiense", GBP: "Libra", CHF: "Franco Suizo", RUB: "Rublo Ruso", AUD: "Australiano",
  JPY: "Yen", MXN: "Mexicano", BRL: "Real Brasileño", COP: "Peso Colombiano",
};

// En QvaPay los códigos son métodos de pago, no monedas.
const QVAPAY_NAMES = {
  CUP: "Banco CUP", MLC: "Banco MLC", TROPIPAY: "Tropipay", ETECSA: "Saldo ETECSA", ZELLE: "Zelle",
  CLASICA: "Tarjeta Clásica", BOLSATM: "Bolsa TM", BANDECPREPAGO: "Bandec Prepago", SBERBANK: "Sberbank",
};

// Banderas e iconos como en Android (Models.kt): son decorativos, el nombre va siempre en texto.
const FLAGS = {
  EUR: "🇪🇺", USD: "🇺🇸", MLC: "💳", BTC: "₿", TRX: "⚡", USDT: "💵", CAD: "🇨🇦", GBP: "🇬🇧",
  CHF: "🇨🇭", RUB: "🇷🇺", AUD: "🇦🇺", JPY: "🇯🇵", MXN: "🇲🇽", BRL: "🇧🇷", COP: "🇨🇴",
};
const QVAPAY_FLAGS = {
  CUP: "🏦", MLC: "💳", TROPIPAY: "💸", ETECSA: "📱", ZELLE: "⚡", CLASICA: "💳",
  BOLSATM: "👛", BANDECPREPAGO: "💳", SBERBANK: "🏦",
};

/** Icono/bandera de una moneda o método de pago; vacío si no se conoce. */
export function flagFor(sourceId, code) {
  if (sourceId === "qvapay") return QVAPAY_FLAGS[code] || FLAGS[code] || "";
  return FLAGS[code] || "";
}

export function sourceById(id) {
  return SOURCES.find((s) => s.id === id) || null;
}

/** Fuente válida o la predeterminada (nunca confía en un valor guardado sin comprobarlo). */
export function normalizeSource(id) {
  return sourceById(id) ? id : DEFAULT_SOURCE;
}

/** Nombre legible de una moneda o método de pago; si no se conoce, el propio código. */
export function nameFor(sourceId, code) {
  if (sourceId === "qvapay") return QVAPAY_NAMES[code] || NAMES[code] || code;
  return NAMES[code] || code;
}

/** Monedas ocultas con formato «FUENTE:MONEDA» (como Android, p. ej. «ELTOQUE:BTC»). */
export function isHidden(hidden, sourceId, code) {
  return Boolean(hidden) && hidden.has(`${sourceId.toUpperCase()}:${code}`);
}

export function visibleRates(sourceData, sourceId, hidden) {
  const rates = (sourceData && Array.isArray(sourceData.rates)) ? sourceData.rates : [];
  return rates.filter((r) => !isHidden(hidden, sourceId, r.code));
}

/**
 * Aviso sobre el estado de los datos (misma prioridad que Android):
 * sin conexión > no se pudo actualizar > datos desactualizados.
 * Devuelve {text, error} o null.
 */
export function bannerFor({ fetchedAt, now, offline = false, apiError = false, stale = false }) {
  if (!fetchedAt) return null; // sin datos no hay qué avisar: lo maneja el estado de error/vacío
  const ago = relative(fetchedAt, now);
  if (offline) return { text: `Sin conexión · datos de ${ago}`, error: true };
  if (apiError || stale) return { text: `No se pudo actualizar · datos de ${ago}`, error: true };
  if (isStale(fetchedAt, now)) return { text: `Datos desactualizados · ${ago}`, error: true };
  return null;
}
