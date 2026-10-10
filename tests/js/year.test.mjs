import test from "node:test";
import assert from "node:assert/strict";
import { compute, dayOfYear, daysInYear, isLeapYear, local, resolveQuote } from "../../static/js/modules/year.js";
import {
  bannerFor, DEFAULT_SOURCE, isHidden, nameFor, normalizeSource, sourceById, SOURCES, visibleRates,
} from "../../static/js/modules/rates.js";

const T = (iso) => Date.parse(iso);
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ---------- Año ----------

test("años bisiestos", () => {
  assert.equal(isLeapYear(2028), true);
  assert.equal(isLeapYear(2026), false);
  assert.equal(isLeapYear(2100), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(daysInYear(2028), 366);
  assert.equal(daysInYear(2026), 365);
});

test("dayOfYear", () => {
  assert.equal(dayOfYear(2026, 1, 1), 1);
  assert.equal(dayOfYear(2026, 10, 10), 283);
  assert.equal(dayOfYear(2026, 12, 31), 365);
  assert.equal(dayOfYear(2028, 12, 31), 366);
  assert.equal(dayOfYear(2028, 3, 1), 61);
});

test("local: medianoche de Cuba del 10 oct 2026", () => {
  const r = local(T("2026-10-10T04:00:00Z")); // 00:00 en Cuba (UTC−4)
  assert.equal(r.year, 2026);
  assert.equal(r.daysPassed, 283);
  assert.equal(r.daysLeft, 82);
  assert.equal(r.weeksLeft, 12);
  close(r.percent, (282 / 365) * 100);
});

test("local: mediodía de Cuba suma medio día", () => {
  close(local(T("2026-10-10T16:00:00Z")).percent, (282.5 / 365) * 100);
});

test("local: el año cambia a medianoche de Cuba, no de UTC", () => {
  const r = local(T("2026-01-01T04:59:59Z")); // 23:59:59 del 31 dic 2025 en Cuba
  assert.equal(r.year, 2025);
  assert.ok(r.percent > 99.99 && r.percent <= 100);
  const n = local(T("2026-01-01T05:00:00Z"));
  assert.equal(n.year, 2026);
  assert.equal(n.percent, 0);
  assert.equal(n.daysLeft, 364);
});

test("local en año bisiesto usa 366 días", () => {
  assert.equal(local(T("2028-12-31T17:00:00Z")).daysLeft, 0);
  assert.equal(local(T("2028-01-01T05:00:00Z")).daysLeft, 365);
});

test("compute prefiere la API y completa con el cálculo local", () => {
  const now = T("2026-10-10T16:00:00Z");
  const r = compute(now, { percent: 80, days_left: 70 });
  assert.equal(r.percent, 80);
  assert.equal(r.daysLeft, 70);
  assert.equal(r.daysPassed, 295);
  assert.equal(r.weeksLeft, 10);
  const parcial = compute(now, { percent: null, days_left: null });
  assert.deepEqual(parcial, local(now));
  assert.deepEqual(compute(now, null), local(now));
});

test("compute acota valores absurdos de la API", () => {
  const now = T("2026-10-10T16:00:00Z");
  assert.equal(compute(now, { percent: 150, days_left: 999 }).percent, 100);
  assert.equal(compute(now, { percent: 150, days_left: 999 }).daysLeft, 365);
  assert.equal(compute(now, { percent: -5, days_left: -3 }).percent, 0);
  assert.equal(compute(now, { percent: -5, days_left: -3 }).daysLeft, 0);
});

// ---------- Frase del día ----------

test("resolveQuote: la frase de hoy ya guardada no cambia", () => {
  assert.deepEqual(resolveQuote("Vieja", "2026-10-10", "Nueva", "2026-10-10"), ["Vieja", "2026-10-10"]);
});

test("resolveQuote: otro día se toma la nueva con la fecha de hoy", () => {
  assert.deepEqual(resolveQuote("Ayer", "2026-10-09", "Nueva", "2026-10-10"), ["Nueva", "2026-10-10"]);
});

test("resolveQuote: sin frase nueva se conserva la guardada; sin nada, null", () => {
  assert.deepEqual(resolveQuote("Ayer", "2026-10-09", null, "2026-10-10"), ["Ayer", "2026-10-09"]);
  assert.deepEqual(resolveQuote(null, null, null, "2026-10-10"), [null, null]);
  assert.deepEqual(resolveQuote(undefined, undefined, "", "2026-10-10"), [null, null]);
});

// ---------- Fuentes y nombres ----------

test("las 4 fuentes en el orden de Android y con compra/venta donde toca", () => {
  assert.deepEqual(SOURCES.map((s) => s.id), ["eltoque", "qvapay", "bcc", "cadeca"]);
  assert.equal(sourceById("cadeca").hasBuySell, true);
  assert.equal(sourceById("qvapay").hasBuySell, true);
  assert.equal(sourceById("eltoque").hasBuySell, false);
  assert.equal(sourceById("binance"), null);
});

test("normalizeSource nunca confía en un valor guardado", () => {
  assert.equal(normalizeSource("bcc"), "bcc");
  for (const bad of ["", null, undefined, "BCC", "binance", 7]) assert.equal(normalizeSource(bad), DEFAULT_SOURCE);
});

test("nameFor: QvaPay son métodos de pago; lo desconocido cae al código", () => {
  assert.equal(nameFor("eltoque", "USD"), "Dólar");
  assert.equal(nameFor("qvapay", "CUP"), "Banco CUP");
  assert.equal(nameFor("qvapay", "ZELLE"), "Zelle");
  assert.equal(nameFor("eltoque", "CUP"), "CUP");
  assert.equal(nameFor("bcc", "XXX"), "XXX");
});

test("monedas ocultas con formato FUENTE:MONEDA", () => {
  const hidden = new Set(["ELTOQUE:BTC"]);
  assert.equal(isHidden(hidden, "eltoque", "BTC"), true);
  assert.equal(isHidden(hidden, "bcc", "BTC"), false);
  assert.equal(isHidden(null, "eltoque", "BTC"), false);
  const data = { rates: [{ code: "USD" }, { code: "BTC" }] };
  assert.deepEqual(visibleRates(data, "eltoque", hidden).map((r) => r.code), ["USD"]);
  assert.deepEqual(visibleRates(null, "eltoque", hidden), []);
  assert.deepEqual(visibleRates({ rates: "x" }, "eltoque", hidden), []);
});

// ---------- Avisos ----------

const NOW = T("2026-10-10T16:00:00Z");
const fresh = new Date(NOW - 5 * 60_000).toISOString();
const old = new Date(NOW - 3 * 3_600_000).toISOString();

test("bannerFor: sin dato no avisa (lo maneja el estado de error)", () => {
  assert.equal(bannerFor({ fetchedAt: null, now: NOW, offline: true }), null);
});

test("bannerFor: fresco y sin errores → sin aviso", () => {
  assert.equal(bannerFor({ fetchedAt: fresh, now: NOW }), null);
});

test("bannerFor: prioridad sin conexión > no se pudo actualizar > desactualizado", () => {
  assert.deepEqual(bannerFor({ fetchedAt: fresh, now: NOW, offline: true, apiError: true }),
    { text: "Sin conexión · datos de hace 5 min", error: true });
  assert.deepEqual(bannerFor({ fetchedAt: fresh, now: NOW, apiError: true }),
    { text: "No se pudo actualizar · datos de hace 5 min", error: true });
  assert.deepEqual(bannerFor({ fetchedAt: fresh, now: NOW, stale: true }),
    { text: "No se pudo actualizar · datos de hace 5 min", error: true });
  assert.deepEqual(bannerFor({ fetchedAt: old, now: NOW }),
    { text: "Datos desactualizados · hace 3 h", error: true });
});
