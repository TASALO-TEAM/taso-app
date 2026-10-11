// Lógica de la pestaña Alertas (sin DOM): horas Cuba↔UTC con cambio de horario, y el texto de estado de cada alerta.
//
// D7: la UI muestra y pide hora de CUBA; año y Spotlight se guardan en UTC (contrato de taso-api) y la imagen guarda
// «HH:MM» de Cuba tal cual el bot. Cuba cambia entre UTC−5 y UTC−4, así que NUNCA se usa un desfase fijo: se calcula
// con la fecha de ese momento.
import { cubaParts } from "./cuba-time.js";

const pad = (n) => String(n).padStart(2, "0");
const mod = (n, m) => ((n % m) + m) % m;
const DAY_MS = 24 * 3600 * 1000;

/** Desfase de Cuba respecto a UTC en horas enteras (−4 con horario de verano, −5 sin él) en ese instante. */
export function cubaOffsetHours(ms) {
  const p = cubaParts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 3600000);
}

/** Hora (0-23) de Cuba → hora UTC con el desfase vigente en `nowMs`. */
export function cubaHourToUtc(hour, nowMs) {
  return mod(hour - cubaOffsetHours(nowMs), 24);
}

/** Hora UTC guardada → hora de Cuba con el desfase vigente en `nowMs`. */
export function utcHourToCuba(hour, nowMs) {
  return mod(hour + cubaOffsetHours(nowMs), 24);
}

/** ¿Cuba cambia de horario en los próximos `days` días? (el envío guardado en UTC se movería 1 h). */
export function dstChangeSoon(nowMs, days = 45) {
  return cubaOffsetHours(nowMs) !== cubaOffsetHours(nowMs + days * DAY_MS);
}

export const DST_NOTE = "Cuba cambia de horario pronto: tras el cambio, guarda de nuevo para mantener la hora.";

export const hourLabel = (hour) => `${pad(hour)}:00`;

/** Horarios sugeridos (hora de Cuba) para el Spotlight y el año: mañana, mediodía y tarde. */
export const PRESET_HOURS = [7, 13, 19];

export const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);

/** Texto y tono de estado de cada alerta para el resumen. tone: "on" | "off" | "warn". */
export function priceStatus(section) {
  if (!section || !section.ok) return { text: "No disponible", tone: "warn" };
  const n = section.items.length;
  return n === 0 ? { text: "Sin alertas", tone: "off" } : { text: n === 1 ? "1 activa" : `${n} activas`, tone: "on" };
}

export function imageStatus(section) {
  if (!section || !section.ok) return { text: "No disponible", tone: "warn" };
  const c = section.config;
  if (!c) return { text: "Sin configurar", tone: "off" };
  return c.enabled ? { text: `Activa · ${c.alert_time}`, tone: "on" } : { text: `Pausada · ${c.alert_time}`, tone: "off" };
}

export function yearStatus(section, nowMs) {
  if (!section || !section.ok) return { text: "No disponible", tone: "warn" };
  if (section.hour === null || section.hour === undefined) return { text: "Sin configurar", tone: "off" };
  return { text: `Activa · ${hourLabel(utcHourToCuba(section.hour, nowMs))}`, tone: "on" };
}

export function spotlightStatus(section, nowMs) {
  if (!section || !section.ok) return { text: "No disponible", tone: "warn" };
  const hours = Array.isArray(section.hours) ? section.hours : [];
  if (hours.length === 0) return { text: "Sin configurar", tone: "off" };
  const labels = hours.map((h) => utcHourToCuba(h, nowMs)).sort((a, b) => a - b).map(hourLabel);
  return { text: `Activa · ${labels.join(", ")}`, tone: "on" };
}

/** «Sube a 70000 (precio al crear: 65000,5)»: descripción de una alerta de precio. */
export function priceLine(alert, fmtRate) {
  const verb = alert.condition === "ABOVE" ? "Sube a" : "Baja a";
  const base = `${verb} ${fmtRate(alert.target_price)}`;
  return alert.price_at_creation === null || alert.price_at_creation === undefined
    ? base
    : `${base} · al crear: ${fmtRate(alert.price_at_creation)}`;
}

/** Mensaje claro para un error de la API de alertas. */
export function errorMessage(err) {
  if (!err) return "No se pudo guardar. Inténtalo de nuevo.";
  if (err.code === "max_subscriptions_reached") return "Ya tienes 2 horarios de Spotlight. Quita uno para añadir otro.";
  if (err.status === 0) return "Sin conexión. Inténtalo de nuevo cuando vuelva.";
  if (err.status === 404) return "Esa alerta ya no existe.";
  if (err.status === 429) return "Demasiadas acciones seguidas. Espera un momento.";
  return "No se pudo guardar. Inténtalo de nuevo.";
}

/** Precio de una criptomoneda con los decimales que hacen falta (un precio de 0,00001234 no se redondea a 0). */
export function fmtPrice(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const decimals = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 8;
  return value.toFixed(decimals).replace(/\.?0+$/, "").replace(".", ",");
}
