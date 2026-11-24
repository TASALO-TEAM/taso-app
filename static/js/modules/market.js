// Mercado (/p del bot, S10): formato y reglas puras de la pantalla. Sin DOM ni red (se prueba con node --test).
// Formato es-CU como el resto de la app: coma decimal y espacio fino (NBSP) como separador de miles en importes.
import { cubaDateKey, cubaDateText, cubaParts, toMs } from "./cuba-time.js";
import { isStale, relative, roundHalfUp } from "./format.js";
import { shortDate } from "./history-math.js";

export const SEED_TOP = ["BTC", "ETH", "SOL", "BNB", "HIVE"];
export const TOP_N = 5;
export const MARKET_STALE_MINUTES = 15;
const SYMBOL_RE = /^[A-Z0-9]{1,15}$/;
const NBSP = "\u00a0";
const DASH = "\u2014";

/** Símbolo en mayúsculas (admite «$btc»); null si no es válido. Misma regla que el servidor. */
export function normalizeSymbol(raw) {
  const symbol = String(raw ?? "").trim().replace(/^\$+/, "").toUpperCase();
  return SYMBOL_RE.test(symbol) ? symbol : null;
}

/** Lista del top que manda el servidor → hasta 5 símbolos válidos y sin repetir; si no hay ninguno, la semilla. */
export function cleanTop(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const symbol = normalizeSymbol(item);
    if (symbol && !out.includes(symbol)) out.push(symbol);
    if (out.length >= TOP_N) break;
  }
  return out.length ? out : SEED_TOP.slice();
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isPos = (v) => isNum(v) && v > 0;

function groupThousands(intText) {
  return intText.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** Número de un precio sin símbolo: 2 decimales desde 1; por debajo, 4 cifras significativas (mínimo 4 decimales). */
export function plain(value) {
  if (!isPos(value)) return DASH;
  if (value >= 1) {
    const [int, dec] = roundHalfUp(value, 2).toFixed(2).split(".");
    return `${groupThousands(int)},${dec}`;
  }
  const decimals = Math.min(12, Math.max(4, 3 - Math.floor(Math.log10(value))));
  const text = value.toFixed(decimals);
  const [int, dec] = text.split(".");
  let trimmed = dec;
  while (trimmed.length > 4 && trimmed.endsWith("0")) trimmed = trimmed.slice(0, -1);
  return `${int},${trimmed}`;
}

export const usd = (value) => (isPos(value) ? `$${plain(value)}` : DASH);

const SUFFIXES = [
  [1e12, "T"],
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
];

/** Cantidades grandes (capitalización, volumen, suministro): 1,23 B / 456,7 M. Por debajo de 1000, el número tal cual. */
export function compact(value) {
  if (!isPos(value)) return DASH;
  for (const [limit, suffix] of SUFFIXES) {
    if (value >= limit) return `${String(roundHalfUp(value / limit, 2).toFixed(2)).replace(".", ",")}${NBSP}${suffix}`;
  }
  return plain(value);
}

export const usdCompact = (value) => (isPos(value) ? `$${compact(value)}` : DASH);

/** Variación con signo y coma: +2,35 % / -0,50 %. Sin dato → raya. */
export function pct(value) {
  if (!isNum(value)) return DASH;
  const rounded = roundHalfUp(Math.abs(value), 2);
  const sign = rounded === 0 ? "" : value < 0 ? "-" : "+";
  return `${sign}${rounded.toFixed(2).replace(".", ",")}${NBSP}%`;
}

export function kindOf(value) {
  if (!isNum(value) || roundHalfUp(value, 2) === 0) return "neutral";
  return value > 0 ? "up" : "down";
}

/** Fecha de Cuba (dd/MM/yyyy) de un ISO de CoinGecko; null si no es válida. */
export function dateText(iso) {
  const ms = toMs(iso);
  return ms === null ? null : cubaDateText(ms);
}

/** Variaciones 1 h / 24 h / 7 d que sí tienen dato (CoinGecko no trae la de 1 h). */
export function changes(m) {
  return [
    ["1 h", m.change_1h],
    ["24 h", m.change_24h],
    ["7 d", m.change_7d],
  ]
    .filter(([, v]) => isNum(v))
    .map(([label, v]) => ({ label, text: pct(v), kind: kindOf(v) }));
}

/** Filas de detalle ya formateadas. Lo que no tiene dato no aparece (nunca «$0»). */
export function detailRows(m) {
  const symbol = String(m.symbol || "").toUpperCase();
  const rows = [];
  const add = (label, value, sub) => {
    if (value && value !== DASH) rows.push({ label, value, sub: sub || null });
  };
  add("Máx. 24 h", usd(m.high_24h));
  add("Mín. 24 h", usd(m.low_24h));
  if (symbol !== "ETH") add("En ETH", isPos(m.price_eth) ? plain(m.price_eth) : null);
  if (symbol !== "BTC") add("En BTC", isPos(m.price_btc) ? plain(m.price_btc) : null);
  add("Capitalización", usdCompact(m.market_cap));
  add("Volumen 24 h", usdCompact(m.volume_24h));
  return rows;
}

/** Bloque de CoinGecko (ATH/ATL, suministro, categoría); lista vacía si no hay datos. */
export function extraRows(m) {
  const e = m.enrichment;
  if (!e) return [];
  const rows = [];
  const add = (label, value, sub) => {
    if (value && value !== DASH) rows.push({ label, value, sub: sub || null });
  };
  const athSub = [isNum(e.ath_change_pct) ? `${pct(e.ath_change_pct)} desde el máximo` : null, dateText(e.ath_date)].filter(Boolean);
  add("Máx. histórico", usd(e.ath), athSub.join(" · "));
  add("Mín. histórico", usd(e.atl), dateText(e.atl_date));
  add("Suministro circulante", compact(e.circulating_supply));
  add("Suministro total", compact(e.total_supply));
  add("Suministro máximo", compact(e.max_supply));
  add("Categoría", e.category || null);
  add("Sentimiento alcista", isNum(e.sentiment_up_pct) ? pct(e.sentiment_up_pct).replace(/^\+/, "") : null);
  if (isPos(e.cg_rank)) add("Ranking en CoinGecko", `#${e.cg_rank}`);
  return rows;
}

/** Nota de procedencia cuando los datos no vienen de CoinMarketCap. */
export function sourceNote(m) {
  return m.source === "coingecko" ? "Datos de CoinGecko: CoinMarketCap no tiene esta moneda o no respondió." : null;
}

/** Aviso sobre la frescura. `stale` lo marca el servidor (sirvió lo último que tenía). Sin dato → nunca afirma que es fresco. */
export function marketBanner({ stale, fetchedAt, now, offline }) {
  if (offline) return { kind: "offline", text: "Sin conexión. Mostrando los últimos datos guardados." };
  const known = toMs(fetchedAt) !== null;
  const when = known ? relative(fetchedAt, now) : null;
  if (stale) {
    return { kind: "stale", text: known ? `No se pudo actualizar; datos de ${when}.` : "No se pudo actualizar; mostrando lo último que había." };
  }
  if (!known) return { kind: "stale", text: "No se sabe cuándo se actualizó este dato." };
  if (isStale(fetchedAt, now, MARKET_STALE_MINUTES)) return { kind: "stale", text: `Datos de ${when}.` };
  return null;
}

// ---------- Panorama IA (S10 F3) ----------
export const PANORAMA_DISCLAIMER = "Análisis generado por IA. No constituye asesoramiento financiero.";

/** Texto del servidor -> lista de párrafos (el cliente los pinta con textContent; nunca se interpreta como HTML). */
export function panoramaParagraphs(text) {
  if (typeof text !== "string") return [];
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 8);
}

/** Mensaje para el usuario según el fallo. Texto propio: no se muestra lo que diga el servidor. */
export function panoramaError({ status } = {}) {
  if (status === 0) return "Sin conexión. Inténtalo cuando tengas internet.";
  if (status === 401) return "Inicia sesión con Telegram para usar el Panorama IA.";
  if (status === 429) return "Llegaste al límite de análisis de IA de esta hora. Inténtalo más tarde.";
  if (status === 404 || status === 400) return "No encontré esa moneda.";
  return "La IA no está disponible ahora. Inténtalo en un momento.";
}

// ---------- Gráfica de precio (S10 F4): rangos, variación del rango y geometría del SVG ----------
// Una serie es [[ms, precio], ...]. Aquí solo hay matemática y texto; el dibujo vive en charts.js.
export const RANGES = [
  { id: "1d", label: "24 h" },
  { id: "7d", label: "1 S" },
  { id: "1m", label: "1 mes" },
  { id: "1y", label: "1 año" },
  { id: "max", label: "Máx." },
];
export const DEFAULT_RANGE = "1d";

/** Rango válido o el predeterminado (nunca se confía en lo que haya guardado o venga de fuera). */
export function normalizeRange(id) {
  return RANGES.some((r) => r.id === id) ? id : DEFAULT_RANGE;
}

/** Serie del servidor → solo pares [ms, precio > 0] válidos, ordenados por tiempo. */
export function cleanSeries(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => Array.isArray(p) && isNum(p[0]) && isPos(p[1]))
    .map((p) => [p[0], p[1]])
    .sort((a, b) => a[0] - b[0]);
}

/** Variación del primer al último punto: {abs, percent, kind, text}; null con menos de 2 puntos. */
export function rangeChange(raw) {
  const list = cleanSeries(raw);
  if (list.length < 2) return null;
  const abs = list[list.length - 1][1] - list[0][1];
  const percent = (abs / list[0][1]) * 100;
  const kind = kindOf(percent);
  const text = kind === "neutral" ? pct(percent) : `${abs < 0 ? "-" : "+"}${plain(Math.abs(abs))} (${pct(percent)})`;
  return { abs, percent, kind, text };
}

/**
 * Geometría en unidades del viewBox. X por tiempo real; Y de mínimo a máximo. Devuelve null con menos de 2 puntos.
 * {coords, line, area, yTicks: [{y, value}], xTicks: [{x, time}], base: {y, value}} (base = precio al inicio del rango).
 */
export function seriesGeometry(raw, { width, height, padLeft = 0, padRight = 0, padTop = 0, padBottom = 0 }) {
  const list = cleanSeries(raw);
  if (list.length < 2) return null;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const t0 = list[0][0];
  const span = list[list.length - 1][0] - t0;
  const values = list.map((p) => p[1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const round2 = (v) => Math.round(v * 100) / 100;
  const xOf = (t) => round2(padLeft + (span === 0 ? 0 : (t - t0) / span) * innerW);
  const yOf = (v) => round2(max === min ? padTop + innerH / 2 : padTop + (1 - (v - min) / (max - min)) * innerH);
  const coords = list.map(([t, v]) => ({ x: xOf(t), y: yOf(v), time: t, value: v }));
  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x} ${c.y}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const floor = height - padBottom;
  const steps = max === min ? [0] : [0, 1, 2, 3];
  return {
    coords,
    line,
    area: `${line} L${last.x} ${floor} L${first.x} ${floor} Z`,
    yTicks: steps.map((i) => {
      const value = min + ((max - min) * i) / 3;
      return { y: yOf(value), value };
    }),
    xTicks: [0.12, 0.5, 0.88].map((f) => {
      const time = t0 + span * f;
      return { x: xOf(time), time };
    }),
    base: { y: first.y, value: list[0][1] },
  };
}

/** Etiqueta del eje de precios: entero con NBSP desde 1000 (61 282); por debajo, igual que el precio. */
export function axisPrice(value) {
  if (!isPos(value)) return DASH;
  return value >= 1000 ? groupThousands(String(Math.round(value))) : plain(value);
}

/** Etiqueta del eje de tiempo en hora de Cuba: «14:30» en 24 h, «08 oct» hasta 1 año y solo el año en Máx. */
export function axisTime(ms, rangeId) {
  if (!isNum(ms)) return "";
  const p = cubaParts(ms);
  if (rangeId === "1d") return `${p.hour}:${String(p.minute).padStart(2, "0")}`;
  return rangeId === "max" ? String(p.year) : shortDate(cubaDateKey(ms));
}

/** Lectura al tocar la gráfica: «23/11/2026 14:30 · $61 282,44» (con hora en 24 h y 1 S; solo fecha en el resto). */
export function readoutText(ms, value, rangeId) {
  if (!isNum(ms) || !isPos(value)) return "";
  const date = cubaDateText(ms);
  const when = rangeId === "1d" || rangeId === "7d" ? `${date} ${axisTime(ms, "1d")}` : date;
  return `${when} \u00b7 ${usd(value)}`;
}
