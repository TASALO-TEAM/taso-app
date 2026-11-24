import assert from "node:assert/strict";
import test from "node:test";

import {
  RANGES, axisPrice, axisTime, cleanSeries, normalizeRange, rangeChange, seriesGeometry,
} from "../../static/js/modules/market.js";

import {
  changes, cleanTop, compact, detailRows, extraRows, kindOf, marketBanner, normalizeSymbol, panoramaError, panoramaParagraphs, PANORAMA_DISCLAIMER, pct, plain, SEED_TOP, sourceNote, usd, usdCompact,
} from "../../static/js/modules/market.js";

const NB = "\u00a0";

test("normalizeSymbol: mayúsculas, quita $ y rechaza lo raro", () => {
  assert.equal(normalizeSymbol("$btc"), "BTC");
  assert.equal(normalizeSymbol(" eth "), "ETH");
  assert.equal(normalizeSymbol("bad sym"), null);
  assert.equal(normalizeSymbol(""), null);
  assert.equal(normalizeSymbol(null), null);
  assert.equal(normalizeSymbol("A".repeat(16)), null);
});

test("cleanTop: válidos, sin repetir, máx. 5; sin nada usa la semilla", () => {
  assert.deepEqual(cleanTop(["btc", "BTC", "x y", "eth"]), ["BTC", "ETH"]);
  assert.equal(cleanTop(["a", "b", "c", "d", "e", "f", "g"]).length, 5);
  assert.deepEqual(cleanTop(null), SEED_TOP);
  assert.deepEqual(cleanTop(["!!"]), SEED_TOP);
});

test("plain/usd: 2 decimales desde 1, miles con NBSP y coma decimal", () => {
  assert.equal(plain(67123.456), `67${NB}123,46`);
  assert.equal(usd(1), "$1,00");
  assert.equal(plain(0.5), "0,5000");
  assert.equal(plain(0.00001234), "0,00001234");
});

test("plain/usd: sin dato, cero o negativo → raya (nunca $0)", () => {
  for (const v of [null, undefined, 0, -1, NaN, "x"]) {
    assert.equal(plain(v), "\u2014");
    assert.equal(usd(v), "\u2014");
  }
});

test("compact: T/B/M/K con coma; por debajo de 1000, tal cual", () => {
  assert.equal(compact(1.234e9), `1,23${NB}B`);
  assert.equal(compact(4.567e6), `4,57${NB}M`);
  assert.equal(compact(2.5e12), `2,50${NB}T`);
  assert.equal(compact(12345), `12,35${NB}K`);
  assert.equal(compact(500), "500,00");
  assert.equal(usdCompact(1.5e9), `$1,50${NB}B`);
  assert.equal(usdCompact(0), "\u2014");
});

test("pct y kindOf: signo, coma y neutral cuando redondea a 0", () => {
  assert.equal(pct(2.345), `+2,35${NB}%`);
  assert.equal(pct(-0.5), `-0,50${NB}%`);
  assert.equal(pct(-0.004), `0,00${NB}%`);
  assert.equal(pct(null), "\u2014");
  assert.equal(kindOf(1), "up");
  assert.equal(kindOf(-1), "down");
  assert.equal(kindOf(-0.004), "neutral");
  assert.equal(kindOf(null), "neutral");
});

test("changes: omite las variaciones sin dato (CoinGecko no trae 1 h)", () => {
  const out = changes({ change_1h: null, change_24h: 1.5, change_7d: -2 });
  assert.deepEqual(out.map((c) => c.label), ["24 h", "7 d"]);
  assert.deepEqual(out.map((c) => c.kind), ["up", "down"]);
  assert.deepEqual(changes({}), []);
});

test("detailRows: sin datos no hay filas y ETH/BTC no se comparan consigo mismos", () => {
  assert.deepEqual(detailRows({ symbol: "SOL" }), []);
  const eth = detailRows({ symbol: "ETH", price_eth: 1, price_btc: 0.05, high_24h: 3000, low_24h: 2900 });
  assert.ok(!eth.some((r) => r.label === "En ETH"));
  assert.ok(eth.some((r) => r.label === "En BTC"));
  const btc = detailRows({ symbol: "BTC", price_eth: 20, price_btc: 1 });
  assert.ok(btc.some((r) => r.label === "En ETH"));
  assert.ok(!btc.some((r) => r.label === "En BTC"));
});

test("extraRows: bloque de CoinGecko solo con lo que tiene", () => {
  assert.deepEqual(extraRows({}), []);
  const rows = extraRows({
    enrichment: { ath: 69000, ath_change_pct: -12.3, ath_date: "2021-11-10T14:24:11.939Z", atl: null, category: "Layer 1", circulating_supply: 19.5e6, cg_rank: 1 },
  });
  const ath = rows.find((r) => r.label === "Máx. histórico");
  assert.equal(ath.value, `$69${NB}000,00`);
  assert.match(ath.sub, /-12,30/);
  assert.ok(!rows.some((r) => r.label === "Mín. histórico"));
  assert.ok(rows.some((r) => r.label === "Categoría" && r.value === "Layer 1"));
  assert.ok(rows.some((r) => r.label === "Ranking en CoinGecko"));
});

test("sourceNote: solo avisa cuando no es CoinMarketCap", () => {
  assert.equal(sourceNote({ source: "coinmarketcap" }), null);
  assert.match(sourceNote({ source: "coingecko" }), /CoinGecko/);
});

test("marketBanner: nunca afirma frescura sin hora de lectura", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  assert.equal(marketBanner({ stale: false, fetchedAt: "2026-10-12T11:59:30Z", now }), null);
  assert.equal(marketBanner({ stale: false, fetchedAt: "2026-10-12T10:00:00Z", now }).kind, "stale");
  assert.equal(marketBanner({ stale: true, fetchedAt: "2026-10-12T11:59:30Z", now }).kind, "stale");
  assert.equal(marketBanner({ stale: false, fetchedAt: null, now }).kind, "stale");
  assert.match(marketBanner({ stale: true, fetchedAt: null, now }).text, /lo último/);
  assert.equal(marketBanner({ offline: true, now }).kind, "offline");
});

test("normalizeRange: solo rangos conocidos; lo demás cae al de 24 h", () => {
  assert.deepEqual(RANGES.map((r) => r.id), ["1d", "7d", "1m", "1y", "max"]);
  assert.equal(normalizeRange("1y"), "1y");
  for (const v of ["5y", "", null, undefined, 7]) assert.equal(normalizeRange(v), "1d");
});

test("cleanSeries: descarta pares inválidos y ordena por tiempo", () => {
  assert.deepEqual(cleanSeries([[3, 30], [1, 10], [2, 0], [4, "x"], null, [NaN, 5], [5]]), [[1, 10], [3, 30]]);
  assert.deepEqual(cleanSeries(null), []);
});

test("rangeChange: variación del primer al último punto, con signo y coma", () => {
  const up = rangeChange([[1, 100], [2, 150]]);
  assert.equal(up.kind, "up");
  assert.equal(up.percent, 50);
  assert.equal(up.text, `+50,00 (+50,00${NB}%)`);
  const down = rangeChange([[1, 200], [2, 150]]);
  assert.equal(down.kind, "down");
  assert.equal(down.text, `-50,00 (-25,00${NB}%)`);
  const flat = rangeChange([[1, 100], [2, 100]]);
  assert.equal(flat.kind, "neutral");
  assert.equal(flat.text, `0,00${NB}%`);
  assert.equal(rangeChange([[1, 100]]), null);
  assert.equal(rangeChange(null), null);
});

const BOX = { width: 100, height: 50, padLeft: 0, padRight: 0, padTop: 5, padBottom: 5 };

test("seriesGeometry: X por tiempo real, Y de mínimo (abajo) a máximo (arriba) y base al inicio", () => {
  const g = seriesGeometry([[0, 10], [10, 30], [40, 20]], BOX);
  assert.deepEqual(g.coords.map((c) => [c.x, c.y]), [[0, 45], [25, 5], [100, 25]]);
  assert.equal(g.line, "M0 45 L25 5 L100 25");
  assert.ok(g.area.endsWith("L100 45 L0 45 Z"));
  assert.deepEqual(g.base, { y: 45, value: 10 });
  assert.equal(g.yTicks.length, 4);
  assert.deepEqual([g.yTicks[0].value, g.yTicks[3].value], [10, 30]);
  assert.equal(g.xTicks.length, 3);
});

test("seriesGeometry: serie plana al centro con una sola marca; menos de 2 puntos → null", () => {
  const g = seriesGeometry([[0, 5], [1, 5]], BOX);
  assert.deepEqual(g.coords.map((c) => c.y), [25, 25]);
  assert.equal(g.yTicks.length, 1);
  assert.equal(seriesGeometry([[0, 5]], BOX), null);
  assert.equal(seriesGeometry(null, BOX), null);
});

test("axisPrice: enteros con NBSP desde 1000 y el formato del precio por debajo", () => {
  assert.equal(axisPrice(61282.44), `61${NB}282`);
  assert.equal(axisPrice(999.5), "999,50");
  assert.equal(axisPrice(0.15), "0,1500");
  assert.equal(axisPrice(0), "\u2014");
});

test("axisTime: hora de Cuba en 24 h, fecha corta de 1 S a 1 año y año en Máx.", () => {
  const ms = Date.parse("2026-11-23T19:30:00Z"); // Cuba en noviembre: UTC−5
  assert.equal(axisTime(ms, "1d"), "14:30");
  assert.equal(axisTime(ms, "7d"), "23 nov");
  assert.equal(axisTime(ms, "1y"), "23 nov");
  assert.equal(axisTime(ms, "max"), "2026");
  assert.equal(axisTime(null, "1d"), "");
});

test("panoramaParagraphs: separa por línea en blanco, limpia espacios y no interpreta HTML", () => {
  assert.deepEqual(panoramaParagraphs("Uno  dos\n\n\nTres\r\n\r\nCuatro"), ["Uno dos", "Tres", "Cuatro"]);
  assert.deepEqual(panoramaParagraphs("<b>hola</b>"), ["<b>hola</b>"]); // se pinta con textContent: queda como texto
  for (const v of [null, undefined, 42, {}, "", "   \n\n  "]) assert.deepEqual(panoramaParagraphs(v), []);
  assert.equal(panoramaParagraphs(Array.from({ length: 20 }, (_, i) => `p${i}`).join("\n\n")).length, 8);
});

test("panoramaError: texto propio según el estado, sin usar lo que diga el servidor", () => {
  assert.match(panoramaError({ status: 0 }), /Sin conexión/);
  assert.match(panoramaError({ status: 429 }), /límite/);
  assert.match(panoramaError({ status: 404 }), /No encontré/);
  assert.match(panoramaError({ status: 400 }), /No encontré/);
  assert.match(panoramaError({ status: 503 }), /no está disponible/);
  assert.match(panoramaError({ status: 502 }), /no está disponible/);
  assert.match(panoramaError(), /no está disponible/);
  assert.match(PANORAMA_DISCLAIMER, /asesoramiento financiero/);
});
