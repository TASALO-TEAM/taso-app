// Matemática pura del historial de precios (sin DOM; probada con node --test).
// Un punto = {date: "YYYY-MM-DD", rate: número}: UNO por día de Cuba, ya elegido por el servidor (la lectura
// más cercana a las 7:00 a. m.). Aquí nunca se interpola: un día sin dato simplemente no tiene punto.

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAY_MS = 86400000;

/** Rangos del gráfico. `fetchDays` es lo que se pide al servidor (solo admite 30/90/180/365). */
export const RANGES = [
  { id: "7D", days: 7, fetchDays: 30 },
  { id: "30D", days: 30, fetchDays: 30 },
  { id: "90D", days: 90, fetchDays: 90 },
  { id: "6M", days: 180, fetchDays: 180 },
];
export const DEFAULT_RANGE = "30D";
export const CUSTOM_RANGE = "custom";
export const CUSTOM_FETCH_DAYS = 365;
export const LIST_SIZES = [7, 14, 30];
export const SUMMARY_DAYS = 30;

export function rangeById(id) {
  return RANGES.find((r) => r.id === id) || null;
}

/** Rango válido (incluido «Fechas») o el predeterminado; nunca confía en un valor guardado. */
export function normalizeRange(id) {
  return id === CUSTOM_RANGE || rangeById(id) ? id : DEFAULT_RANGE;
}

function dayNumber(key) {
  if (typeof key !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const date = new Date(ms);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

export function isDateKey(key) {
  return dayNumber(key) !== null;
}

/** «2026-10-10» + n días (n puede ser negativo). Fecha inválida → null. */
export function addDays(key, n) {
  const d = dayNumber(key);
  return d === null ? null : new Date((d + n) * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** «2026-10-08» → «08 oct». */
export function shortDate(key) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(typeof key === "string" ? key : "");
  if (!m || !isDateKey(key)) return "";
  return `${m[2]} ${MONTHS[Number(m[1]) - 1]}`;
}

/** Copia ordenada por fecha con solo los puntos utilizables. */
function cleanPoints(points) {
  if (!Array.isArray(points)) return [];
  return points
    .filter((p) => p && isDateKey(p.date) && typeof p.rate === "number" && Number.isFinite(p.rate))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Puntos de los últimos `days` días de Cuba, contando hoy (`todayKey`). */
export function lastDays(points, days, todayKey) {
  const list = cleanPoints(points);
  const end = isDateKey(todayKey) ? todayKey : list.length ? list[list.length - 1].date : null;
  if (end === null) return [];
  const from = addDays(end, -(days - 1));
  return list.filter((p) => p.date >= from && p.date <= end);
}

/** Puntos entre dos fechas (inclusive); si vienen al revés se intercambian. */
export function between(points, from, to) {
  if (!isDateKey(from) || !isDateKey(to)) return [];
  const [a, b] = from <= to ? [from, to] : [to, from];
  return cleanPoints(points).filter((p) => p.date >= a && p.date <= b);
}

/** Sube/baja/igual con el mismo redondeo a 2 decimales que se muestra (sin ruido de coma flotante). */
function direction(delta) {
  const d = Math.round(delta * 100) / 100;
  if (d > 0) return "up";
  if (d < 0) return "down";
  return "neutral";
}

export function summarize(points) {
  const list = cleanPoints(points);
  if (list.length === 0) return null;
  const first = list[0];
  const last = list[list.length - 1];
  let min = first;
  let max = first;
  for (const p of list) {
    if (p.rate < min.rate) min = p;
    if (p.rate > max.rate) max = p;
  }
  const change = last.rate - first.rate;
  return { first, last, min, max, change, percent: first.rate !== 0 ? (change / first.rate) * 100 : null, count: list.length };
}

/** Tendencia de una serie (último frente al primero): «up» | «down» | «neutral». */
export function trendOf(points) {
  const s = summarize(points);
  return s ? direction(s.change) : "neutral";
}

/**
 * Filas de la lista diaria: los últimos `count` días de calendario hacia atrás. Termina hoy si ya hay lectura de hoy
 * y, si no, ayer (antes de las 7:00 no se muestra un «sin dato» de hoy). Un día sin lectura sale con rate null.
 * La variación se calcula contra el punto anterior disponible, no contra «ayer».
 */
export function dayRows(points, count, todayKey) {
  const list = cleanPoints(points);
  if (!isDateKey(todayKey) || !(count >= 1)) return [];
  const rateOf = new Map();
  const prevOf = new Map();
  list.forEach((p, i) => {
    rateOf.set(p.date, p.rate);
    prevOf.set(p.date, i > 0 ? list[i - 1].rate : null);
  });
  const end = rateOf.has(todayKey) ? todayKey : addDays(todayKey, -1);
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const date = addDays(end, -i);
    if (!rateOf.has(date)) {
      rows.push({ date, rate: null, delta: null, change: null });
      continue;
    }
    const rate = rateOf.get(date);
    const prev = prevOf.get(date);
    if (prev === null) {
      rows.push({ date, rate, delta: null, change: null });
      continue;
    }
    const delta = rate - prev;
    rows.push({ date, rate, delta: Math.abs(Math.round(delta * 100) / 100), change: direction(delta) });
  }
  return rows;
}

/**
 * ¿La serie cubre bastante menos que lo pedido? Devuelve la fecha del primer dato (para avisar «solo hay datos
 * desde…») o null si cubre el rango (con 2 días de margen). Típico de QvaPay, que tiene poco historial.
 */
export function shortHistory(points, days, todayKey) {
  const list = cleanPoints(points);
  if (list.length === 0 || !isDateKey(todayKey)) return null;
  const covered = daysBetween(list[0].date, todayKey) + 1;
  return covered < days - 2 ? list[0].date : null;
}

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Geometría del gráfico en unidades del viewBox. El eje X es la fecha real (un hueco se ve como hueco y la línea
 * lo une sin inventar valores); el eje Y va de mínimo a máximo (serie plana → línea al centro).
 * Devuelve {coords, line, area, min, max, single} o null sin puntos.
 */
export function chartGeometry(points, { width, height, padX = 0, padTop = 0, padBottom = 0 }) {
  const list = cleanPoints(points);
  if (list.length === 0) return null;
  const innerW = width - 2 * padX;
  const innerH = height - padTop - padBottom;
  const start = dayNumber(list[0].date);
  const span = dayNumber(list[list.length - 1].date) - start;
  let min = Infinity;
  let max = -Infinity;
  for (const p of list) {
    if (p.rate < min) min = p.rate;
    if (p.rate > max) max = p.rate;
  }
  const coords = list.map((p) => {
    const x = span === 0 ? width / 2 : padX + ((dayNumber(p.date) - start) / span) * innerW;
    const y = max === min ? padTop + innerH / 2 : padTop + (1 - (p.rate - min) / (max - min)) * innerH;
    return { x: round2(x), y: round2(y), date: p.date, rate: p.rate };
  });
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x} ${c.y}`).join(" ");
  const last = coords[coords.length - 1];
  const area = coords.length > 1 ? `${line} L${last.x} ${height} L${coords[0].x} ${height} Z` : "";
  return { coords, line, area, min, max, single: coords.length === 1 };
}

/** Índice del punto más cercano a una posición X (para el cursor del gráfico); -1 si no hay puntos. */
export function nearestIndex(coords, x) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < coords.length; i += 1) {
    const dist = Math.abs(coords[i].x - x);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}
