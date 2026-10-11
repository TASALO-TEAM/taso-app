// Calculadora de tasas (sin DOM): tabla con pivote, conversión, formato del monto y recibo para copiar.
// Puerto de Converter.kt, Receipt.kt y Format.amount/parseAmount de Android.
//
// En El Toque, BCC y CADECA cada tasa es cuántos CUP vale una unidad de la moneda (1 USD = 520 CUP), así que
// cualquier par sale de una sola fórmula con el CUP de pivote: monto × tasa(origen) / tasa(destino).
// En QvaPay cada valor es cuánto de un método de pago se obtiene por 1 USD; el pivote es el USD y la tabla guarda
// el valor en USD de una unidad de cada método (1 / tasa), así que la misma fórmula sirve.
import { roundHalfUp } from "./format.js";

export const CUP = "CUP";
export const USD = "USD";

const PREFERRED_ORDER = [
  "EUR", "USD", "MLC", "BTC", "TRX", "USDT", "CAD", "GBP", "CHF", "RUB", "AUD", "JPY", "MXN", "BRL", "COP",
];
const QVAPAY_ORDER = ["CUP", "MLC", "TROPIPAY", "ETECSA", "ZELLE", "CLASICA", "BOLSATM", "BANDECPREPAGO", "SBERBANK"];

const MAX_AMOUNT_CHARS = 14;
const NBSP = "\u00A0";

const isQvapay = (sourceId) => sourceId === "qvapay";
const pivotOf = (sourceId) => (isQvapay(sourceId) ? USD : CUP);

function orderIndex(sourceId, code) {
  const i = (isQvapay(sourceId) ? QVAPAY_ORDER : PREFERRED_ORDER).indexOf(code);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
}

/**
 * Tabla código → valor de una unidad en el pivote de la fuente. El pivote siempre está (vale 1) y se descartan las
 * tasas no válidas. rates = [{code, rate}]. En QvaPay «CUP» es un método de pago más (Banco CUP).
 * Es un Map: los códigos vienen de la API y no deben poder tocar el prototipo de un objeto.
 */
export function buildTable(rates, sourceId = "eltoque") {
  const pivot = pivotOf(sourceId);
  const table = new Map([[pivot, 1]]);
  for (const r of Array.isArray(rates) ? rates : []) {
    if (!r || typeof r.code !== "string" || r.code === pivot) continue;
    if (typeof r.rate !== "number" || !Number.isFinite(r.rate) || r.rate <= 0) continue;
    table.set(r.code, isQvapay(sourceId) ? 1 / r.rate : r.rate);
  }
  return table;
}

/** Pivote primero y después el orden habitual de la fuente (EUR, USD, MLC… o los métodos de QvaPay). */
export function codesOf(table, sourceId = "eltoque") {
  const pivot = pivotOf(sourceId);
  return [...table.keys()].sort((a, b) => {
    const pa = a === pivot ? 0 : 1;
    const pb = b === pivot ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const oa = orderIndex(sourceId, a);
    const ob = orderIndex(sourceId, b);
    if (oa !== ob) return oa - ob;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

/** null si alguna de las dos monedas no está en la tabla. */
export function convert(amount, from, to, table) {
  const f = table.get(from);
  const t = table.get(to);
  if (f === undefined || t === undefined) return null;
  return (amount * f) / t;
}

/**
 * Par origen/destino realmente usable: si lo guardado no existe en esta fuente se cae a uno válido, y nunca son
 * la misma moneda (misma lógica que CalculatorScreen.kt).
 */
export function resolvePair(fromCode, toCode, codes) {
  const other = (code) => codes.find((c) => c !== code);
  const from = codes.includes(fromCode) ? fromCode : codes.find((c) => c !== CUP) || CUP;
  let to = codes.includes(toCode) ? toCode : codes.includes(CUP) ? CUP : other(from) || CUP;
  if (to === from) to = other(from) || to;
  return { from, to };
}

// ---------- Formato del monto ----------

/** 20 → «20», 17,5 → «17,5», 10400 → «10 400», 0,01923 → «0,0192», 0,00038 → «0,00038». */
export function amount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const decimals = abs >= 1 || abs === 0 ? 2 : abs >= 0.01 ? 4 : 8;
  const fixed = roundHalfUp(abs, decimals).toFixed(decimals);
  let [int, frac = ""] = fixed.split(".");
  frac = frac.replace(/0+$/, "");
  int = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  const body = frac ? `${int},${frac}` : int;
  return value < 0 && body !== "0" ? `-${body}` : body;
}

/** Lo que se teclea en el campo de monto: coma o punto como decimal; null si está vacío o no es válido. */
export function parseAmount(text) {
  const clean = String(text ?? "").trim().replace(",", ".");
  if (!/^(\d+\.?\d*|\.\d+)$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** Deja solo dígitos y un separador decimal (se muestra coma), con un tope de longitud. */
export function sanitizeAmount(input) {
  let out = "";
  let hasSeparator = false;
  for (const c of String(input ?? "")) {
    if (c >= "0" && c <= "9") out += c;
    else if ((c === "," || c === ".") && !hasSeparator) {
      hasSeparator = true;
      out += ",";
    }
  }
  return out.slice(0, MAX_AMOUNT_CHARS);
}

// ---------- Recibo ----------

/**
 * Texto listo para pegar en WhatsApp o Telegram:
 *   20 USD · El Toque
 *   = 10 400 CUP
 *   = 17,5 EUR
 *   Tasas con TASALO
 * rows ya viene en el orden de pantalla; el origen no se repite en la lista.
 */
export function receipt({ value, from, sourceTitle, table, rows }) {
  const lines = [];
  for (const code of rows) {
    const converted = convert(value, from, code, table);
    if (converted !== null) lines.push(`= ${amount(converted)} ${code}`);
  }
  return [`${amount(value)} ${from} · ${sourceTitle}`, ...lines, "Tasas con TASALO"].join("\n");
}
