// Lógica de la pantalla de Combustible (sin DOM): nombres, rango de precio y aviso de datos viejos.
// Puerto de Fuel.META / Format.fuelRange de Android. El orden de los tipos lo fija el servidor.
import { rate } from "./format.js";
import { bannerFor } from "./rates.js";

const META = {
  "B-94": { name: "Gasolina B-94", subtype: "Especial", unit: "CUP/L" },
  "B-90": { name: "Gasolina B-90", subtype: "Regular", unit: "CUP/L" },
  "B-83": { name: "Gasolina B-83", subtype: "Motor", unit: "CUP/L" },
  Petroleo: { name: "Petróleo / Diésel", subtype: "Diésel", unit: "CUP/L" },
  Gas_LP: { name: "Gas licuado", subtype: "Balón", unit: "CUP/balón" },
};

/** Nombre, subtipo y unidad; un tipo desconocido cae al código y a «CUP». */
export function metaFor(key) {
  return META[key] || { name: key, subtype: "", unit: "CUP" };
}

/** «600-620» si hay rango, un solo valor si mínimo = máximo o falta uno, «—» sin ninguno. */
export function fuelRange(item) {
  const min = item ? item.min : null;
  const max = item ? item.max : null;
  const has = (v) => typeof v === "number" && Number.isFinite(v);
  if (has(min) && has(max) && min !== max) return `${rate(min)}-${rate(max)}`;
  if (has(max)) return rate(max);
  if (has(min)) return rate(min);
  return "—";
}

/** Aviso de estado de los datos; si la API no trae la hora de la lectura, no se afirma que sean frescos. */
export function fuelBanner({ fetchedAt, now, offline = false, apiError = false, stale = false }) {
  if (!fetchedAt) {
    if (offline) return { text: "Sin conexión · sin marca de actualización", error: true };
    return { text: "Sin marca de actualización: no se sabe qué tan recientes son estos precios.", error: true };
  }
  return bannerFor({ fetchedAt, now, offline, apiError, stale });
}
