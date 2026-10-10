// Progreso del año y frase del día (puerto de YearMath.kt / QuoteRule de Android). Módulo puro.
// «Hoy» es la fecha de Cuba, no la del teléfono.
import { cubaParts } from "./cuba-time.js";

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365;
}

/** Día del año (1–366) para una fecha civil. */
export function dayOfYear(year, month, day) {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/** Cálculo 100 % local: el bloque del año nunca queda vacío. */
export function local(ms) {
  const p = cubaParts(ms);
  const total = daysInYear(p.year);
  const doy = dayOfYear(p.year, p.month, p.day);
  const secondsOfDay = p.hour * 3600 + p.minute * 60 + p.second;
  const elapsed = doy - 1 + secondsOfDay / 86_400;
  const daysLeft = total - doy;
  return {
    year: p.year,
    percent: clamp((elapsed / total) * 100, 0, 100),
    daysLeft,
    daysPassed: doy,
    weeksLeft: Math.ceil(daysLeft / 7),
  };
}

/** Prefiere percent y days_left de la API (coincide con /y del bot); lo que falte sale del cálculo local. */
export function compute(ms, api) {
  const base = local(ms);
  if (!api) return base;
  const total = daysInYear(base.year);
  const hasDaysLeft = Number.isFinite(api.days_left);
  const daysLeft = hasDaysLeft ? clamp(api.days_left, 0, total) : base.daysLeft;
  return {
    ...base,
    percent: Number.isFinite(api.percent) ? clamp(api.percent, 0, 100) : base.percent,
    daysLeft,
    daysPassed: hasDaysLeft ? total - daysLeft : base.daysPassed,
    weeksLeft: Math.ceil(daysLeft / 7),
  };
}

/**
 * La frase del día se guarda por fecha: el servidor puede devolver otra en cada llamada y la
 * pantalla no debe cambiar de frase durante el día. Devuelve [frase, fecha].
 */
export function resolveQuote(storedQuote, storedDate, fetchedQuote, today) {
  if (storedQuote && storedDate === today) return [storedQuote, storedDate];
  if (fetchedQuote) return [fetchedQuote, today];
  return [storedQuote ?? null, storedDate ?? null];
}
