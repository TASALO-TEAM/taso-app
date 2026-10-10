import test from "node:test";
import assert from "node:assert/strict";
import {
  addDays, between, chartGeometry, dayRows, daysBetween, lastDays, nearestIndex, normalizeRange,
  rangeById, shortDate, shortHistory, summarize, trendOf,
} from "../../static/js/modules/history-math.js";

const P = (date, rate) => ({ date, rate });

test("addDays y daysBetween: cruzan mes y año y rechazan fechas imposibles", () => {
  assert.equal(addDays("2026-10-10", -9), "2026-10-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(addDays("2024-03-01", -1), "2024-02-29");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-02-30", 1), null);
  assert.equal(addDays("hoy", 1), null);
  assert.equal(daysBetween("2026-10-01", "2026-10-10"), 9);
  assert.equal(daysBetween("2026-10-10", "2026-10-01"), -9);
  assert.equal(daysBetween("x", "2026-10-01"), null);
});

test("shortDate: «08 oct»; lo inválido es vacío", () => {
  assert.equal(shortDate("2026-10-08"), "08 oct");
  assert.equal(shortDate("2026-01-31"), "31 ene");
  assert.equal(shortDate("2026-13-01"), "");
  assert.equal(shortDate(null), "");
});

test("rangos: 7D pide 30 días al servidor; un rango desconocido cae al predeterminado", () => {
  assert.equal(rangeById("7D").fetchDays, 30);
  assert.equal(rangeById("6M").days, 180);
  assert.equal(normalizeRange("90D"), "90D");
  assert.equal(normalizeRange("custom"), "custom");
  assert.equal(normalizeRange("1Y"), "30D");
  assert.equal(normalizeRange(undefined), "30D");
});

test("lastDays: cuenta hoy, ordena y descarta lo inutilizable", () => {
  const pts = [P("2026-10-10", 5), P("2026-10-03", 3), P("2026-10-04", 4), P("malo", 9), P("2026-10-05", NaN), P("2026-10-06", "7")];
  assert.deepEqual(lastDays(pts, 7, "2026-10-10").map((p) => p.date), ["2026-10-04", "2026-10-10"]);
  assert.deepEqual(lastDays(pts, 8, "2026-10-10").map((p) => p.date), ["2026-10-03", "2026-10-04", "2026-10-10"]);
  assert.deepEqual(lastDays([], 7, "2026-10-10"), []);
  assert.deepEqual(lastDays("x", 7, "2026-10-10"), []);
});

test("lastDays: sin fecha de hoy válida usa la del último punto", () => {
  const pts = [P("2026-09-01", 1), P("2026-10-01", 2), P("2026-10-03", 3)];
  assert.deepEqual(lastDays(pts, 3, null).map((p) => p.date), ["2026-10-01", "2026-10-03"]);
});

test("between: inclusivo y tolera fechas al revés", () => {
  const pts = [P("2026-10-01", 1), P("2026-10-02", 2), P("2026-10-03", 3)];
  assert.deepEqual(between(pts, "2026-10-02", "2026-10-03").map((p) => p.rate), [2, 3]);
  assert.deepEqual(between(pts, "2026-10-03", "2026-10-02").map((p) => p.rate), [2, 3]);
  assert.deepEqual(between(pts, "2026-10-02", "basura"), []);
});

test("summarize y trendOf: primero, último, mínimo, máximo y variación", () => {
  const pts = [P("2026-10-01", 500), P("2026-10-02", 520), P("2026-10-03", 490), P("2026-10-04", 510)];
  const s = summarize(pts);
  assert.equal(s.first.rate, 500);
  assert.equal(s.last.rate, 510);
  assert.equal(s.min.date, "2026-10-03");
  assert.equal(s.max.date, "2026-10-02");
  assert.equal(s.change, 10);
  assert.equal(s.percent, 2);
  assert.equal(s.count, 4);
  assert.equal(trendOf(pts), "up");
  assert.equal(trendOf([P("2026-10-01", 5), P("2026-10-02", 4)]), "down");
  assert.equal(trendOf([P("2026-10-01", 5), P("2026-10-02", 5.001)]), "neutral");
  assert.equal(summarize([]), null);
  assert.equal(trendOf([]), "neutral");
});

test("dayRows: los días sin lectura salen como «sin dato» y la variación va contra el punto anterior", () => {
  const pts = [P("2026-10-04", 519), P("2026-10-06", 519), P("2026-10-07", 521), P("2026-10-08", 520)];
  const rows = dayRows(pts, 5, "2026-10-08");
  assert.deepEqual(rows.map((r) => r.date), ["2026-10-08", "2026-10-07", "2026-10-06", "2026-10-05", "2026-10-04"]);
  assert.deepEqual(rows[0], { date: "2026-10-08", rate: 520, delta: 1, change: "down" });
  assert.deepEqual(rows[1], { date: "2026-10-07", rate: 521, delta: 2, change: "up" });
  assert.deepEqual(rows[2], { date: "2026-10-06", rate: 519, delta: 0, change: "neutral" }); // vs 04 oct (519)
  assert.deepEqual(rows[3], { date: "2026-10-05", rate: null, delta: null, change: null });
  assert.deepEqual(rows[4], { date: "2026-10-04", rate: 519, delta: null, change: null }); // primer punto
});

test("dayRows: antes de la lectura de hoy empieza en ayer; con lectura de hoy empieza hoy", () => {
  const pts = [P("2026-10-08", 520), P("2026-10-09", 525)];
  assert.equal(dayRows(pts, 3, "2026-10-10")[0].date, "2026-10-09");
  assert.equal(dayRows([...pts, P("2026-10-10", 530)], 3, "2026-10-10")[0].date, "2026-10-10");
  assert.deepEqual(dayRows(pts, 0, "2026-10-10"), []);
  assert.deepEqual(dayRows(pts, 3, "mal"), []);
});

test("dayRows: la variación no cae en coma flotante (0,1 + 0,2 vs 0,3)", () => {
  const rows = dayRows([P("2026-10-08", 0.1 + 0.2), P("2026-10-09", 0.3)], 2, "2026-10-09");
  assert.equal(rows[0].change, "neutral");
  assert.equal(rows[0].delta, 0);
});

test("shortHistory: avisa solo cuando la serie cubre bastante menos que lo pedido", () => {
  const corto = [P("2026-10-05", 1), P("2026-10-09", 2)];
  assert.equal(shortHistory(corto, 30, "2026-10-10"), "2026-10-05");
  assert.equal(shortHistory(corto, 7, "2026-10-10"), null); // cubre 6 días de 7 (margen 2)
  assert.equal(shortHistory([P("2026-09-11", 1)], 30, "2026-10-10"), null);
  assert.equal(shortHistory([], 30, "2026-10-10"), null);
});

test("chartGeometry: X por fecha real (el hueco se ve), Y de mínimo a máximo", () => {
  const g = chartGeometry([P("2026-10-01", 100), P("2026-10-02", 200), P("2026-10-05", 150)], { width: 400, height: 100, padX: 0, padTop: 10, padBottom: 10 });
  assert.deepEqual(g.coords.map((c) => c.x), [0, 100, 400]);
  assert.deepEqual(g.coords.map((c) => c.y), [90, 10, 50]);
  assert.equal(g.min, 100);
  assert.equal(g.max, 200);
  assert.equal(g.single, false);
  assert.equal(g.line, "M0 90 L100 10 L400 50");
  assert.equal(g.area, "M0 90 L100 10 L400 50 L400 100 L0 100 Z");
});

test("chartGeometry: serie plana al centro, un solo punto sin área, sin puntos null", () => {
  const plana = chartGeometry([P("2026-10-01", 5), P("2026-10-02", 5)], { width: 200, height: 100, padTop: 10, padBottom: 10 });
  assert.deepEqual(plana.coords.map((c) => c.y), [50, 50]);
  const uno = chartGeometry([P("2026-10-01", 5)], { width: 200, height: 100 });
  assert.equal(uno.single, true);
  assert.equal(uno.coords[0].x, 100);
  assert.equal(uno.area, "");
  assert.equal(chartGeometry([], { width: 200, height: 100 }), null);
});

test("chartGeometry: respeta el margen lateral", () => {
  const g = chartGeometry([P("2026-10-01", 1), P("2026-10-03", 2)], { width: 340, height: 150, padX: 6 });
  assert.deepEqual(g.coords.map((c) => c.x), [6, 334]);
});

test("nearestIndex: el punto más cercano a la posición; -1 sin puntos", () => {
  const coords = [{ x: 0 }, { x: 100 }, { x: 400 }];
  assert.equal(nearestIndex(coords, -50), 0);
  assert.equal(nearestIndex(coords, 60), 1);
  assert.equal(nearestIndex(coords, 300), 2);
  assert.equal(nearestIndex([], 10), -1);
});
