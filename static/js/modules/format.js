// Formato es-CU (puerto de Format.kt de Android): coma decimal, sin separador de miles. Módulo puro.
import { cubaDateText, toMs } from "./cuba-time.js";

/** Redondeo «mitad hacia arriba» (como DecimalFormat HALF_UP), sin los fallos de toFixed(1.005). */
export function roundHalfUp(value, decimals) {
  if (!Number.isFinite(value)) return value;
  const text = String(Math.abs(value));
  const sign = value < 0 ? -1 : 1;
  if (/e/i.test(text)) return Number(value.toFixed(decimals));
  return sign * Number(`${Math.round(Number(`${text}e${decimals}`))}e-${decimals}`);
}

/** 0–2 decimales sin ceros sobrantes: 750, 857,5, 485,07. */
export function rate(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const rounded = roundHalfUp(value, 2);
  return String(Object.is(rounded, -0) ? 0 : rounded).replace(".", ",");
}

function oneDecimal(value) {
  const fixed = roundHalfUp(Math.abs(value), 1).toFixed(1);
  return fixed.replace(".", ",");
}

export function percent(value) {
  return `${value < 0 ? "-" : ""}${oneDecimal(value)}%`;
}

function signedPercent(value) {
  return `${value < 0 ? "-" : "+"}${oneDecimal(value)}%`;
}

export function arrow(change) {
  if (change === "up") return "▲";
  if (change === "down") return "▼";
  return "—";
}

/** Variación respecto a la lectura anterior (prev_rate), no a «ayer». null si no hay con qué comparar. */
export function changePct(r) {
  if (r.prev_rate === null || r.prev_rate === undefined || r.prev_rate === 0) return null;
  return ((r.rate - r.prev_rate) / r.prev_rate) * 100;
}

/** «▲ 2,5 (+0,4%)»; el % solo aparece si hay prev_rate. Neutral = «—». */
export function change(r) {
  const symbol = arrow(r.change);
  if (r.change === "neutral" || !r.change) return "—";
  if (r.prev_rate === null || r.prev_rate === undefined) return symbol;
  const delta = Math.abs(r.rate - r.prev_rate);
  const pct = changePct(r);
  return pct === null ? `${symbol} ${rate(delta)}` : `${symbol} ${rate(delta)} (${signedPercent(pct)})`;
}

/** Texto para lectores de pantalla: el cambio nunca se indica solo con color. */
export function changeDescription(changeValue) {
  if (changeValue === "up") return "sube";
  if (changeValue === "down") return "baja";
  return "sin cambios";
}

/** ahora / hace 3 min / hace 2 h / dd/MM/yyyy (más de 24 h, fecha de Cuba). Sin dato → «sin datos». */
export function relative(then, now) {
  const t = toMs(then);
  const n = toMs(now);
  if (t === null || n === null) return "sin datos";
  const minutes = Math.floor((n - t) / 60000);
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return cubaDateText(t);
}

/** ¿El dato es viejo? Sin hora de lectura cuenta como viejo (nunca se afirma que es fresco). */
export function isStale(fetchedAt, now, minutes = 60) {
  const t = toMs(fetchedAt);
  const n = toMs(now);
  if (t === null || n === null) return true;
  return (n - t) / 60000 >= minutes;
}
