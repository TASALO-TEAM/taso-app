// Mercado (/p del bot, S10): formato y reglas puras de la pantalla. Sin DOM ni red (se prueba con node --test).
// Formato es-CU como el resto de la app: coma decimal y espacio fino (NBSP) como separador de miles en importes.
import { cubaDateText, toMs } from "./cuba-time.js";
import { isStale, relative, roundHalfUp } from "./format.js";

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
