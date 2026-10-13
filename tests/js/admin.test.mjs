import test from "node:test";
import assert from "node:assert/strict";
import {
  agoLabel, barRows, clientShares, daySeries, fmtInt, fmtMs, fmtPct, healthTone, jobProblems, normalizeWindow, overviewPill,
} from "../../static/js/modules/admin.js";

test("normalizeWindow: solo 24h, 7d y 30d", () => {
  assert.equal(normalizeWindow("7d"), "7d");
  for (const bad of ["1h", "", null, undefined, 7, "7D"]) assert.equal(normalizeWindow(bad), "24h");
});

test("formatos: enteros, porcentaje, milisegundos y NaN → 0", () => {
  assert.equal(fmtInt(1234), "1234");
  assert.equal(fmtInt(12345), "12\u202f345");
  assert.equal(fmtInt(1234567), "1\u202f234\u202f567");
  assert.equal(fmtInt(NaN), "0");
  assert.equal(fmtInt("x"), "0");
  assert.equal(fmtPct(3.456), "3,5 %");
  assert.equal(fmtPct(undefined), "0,0 %");
  assert.equal(fmtMs(850), "850 ms");
  assert.equal(fmtMs(1500), "1,5 s");
  assert.equal(fmtMs(Infinity), "0 ms");
});

test("agoLabel: momento, minutos, horas, días y fechas inválidas", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  assert.equal(agoLabel("2026-10-12T11:59:40Z", now), "hace un momento");
  assert.equal(agoLabel("2026-10-12T11:55:00Z", now), "hace 5 min");
  assert.equal(agoLabel("2026-10-12T09:00:00Z", now), "hace 3 h");
  assert.equal(agoLabel("2026-10-08T12:00:00Z", now), "hace 4 d");
  assert.equal(agoLabel("2026-10-12T12:05:00Z", now), "hace un momento", "futuro no da negativos");
  for (const bad of ["", "nada", null, undefined, 5]) assert.equal(agoLabel(bad, now), "");
});

test("healthTone: ok, warn, bad y desconocido", () => {
  assert.deepEqual(healthTone("ok"), { dot: "ok", pill: "on" });
  assert.deepEqual(healthTone("warn"), { dot: "warn", pill: "warn" });
  assert.deepEqual(healthTone("bad"), { dot: "bad", pill: "warn" });
  assert.deepEqual(healthTone("zzz"), { dot: "unknown", pill: "off" });
  assert.deepEqual(healthTone(undefined), { dot: "unknown", pill: "off" });
});

test("barRows: porcentajes relativos al mayor, mínimo visible y límites", () => {
  const rows = barRows([{ command: "p", count: 100 }, { command: "x", count: 50 }, { command: "y", count: 1 }, { command: "z", count: 0 }], "command", "count");
  assert.deepEqual(rows.map((r) => r.pct), [100, 50, 3, 0]);
  assert.equal(rows[0].label, "p");
  assert.deepEqual(barRows([{ a: "q", b: 0 }], "a", "b").map((r) => r.pct), [0], "todo cero: sin barra");
  assert.equal(barRows(Array.from({ length: 20 }, (_, i) => ({ a: i, b: i })), "a", "b", 5).length, 5);
  assert.deepEqual(barRows(null, "a", "b"), []);
  assert.deepEqual(barRows([null, 3, { a: "ok", b: -5 }, { a: "x".repeat(200), b: NaN }], "a", "b").map((r) => [r.label.length, r.value]), [[2, 0], [60, 0]]);
});

test("clientShares: reparto del total y datos raros", () => {
  const r = clientShares([{ client_id: "taso-app", requests: 75, errors: 3 }, { client_id: "bot", requests: 25, errors: 0 }, { client_id: "", requests: "x" }]);
  assert.deepEqual(r.map((c) => c.share), [75, 25, 0]);
  assert.equal(r[2].label, "desconocido");
  assert.equal(r[0].errors, 3);
  assert.deepEqual(clientShares(undefined), []);
  assert.equal(clientShares([{ client_id: "a", requests: 0 }])[0].share, 0);
});

test("daySeries: letra del día de la semana y altura relativa", () => {
  const s = daySeries([
    { day: "2026-10-12", count: 10 }, // lunes
    { day: "2026-10-13", count: 5 },
    { day: "2026-10-14", count: 0 },
    { day: "2026-10-18", count: 1 }, // domingo
    { day: "no-fecha", count: 2 },
  ]);
  assert.deepEqual(s.map((d) => d.label), ["L", "M", "X", "D", "?"]);
  assert.deepEqual(s.map((d) => d.pct), [100, 50, 0, 10, 20]);
  assert.deepEqual(daySeries([{ day: "2026-10-12", count: 0 }]).map((d) => d.pct), [0]);
  assert.deepEqual(daySeries("x"), []);
  assert.deepEqual(daySeries([{ count: 1 }, null]), []);
});

test("jobProblems: solo con errores, peores primero y con límite", () => {
  const sched = { ok: true, jobs: [
    { id: "a", name: "Tasas", error_count: 0 },
    { id: "b", name: "Alertas", error_count: 7, last_error: "timeout" },
    { id: "c", name: "", error_count: 2 },
    { id: "d", name: "Imagen", error_count: 12 },
  ] };
  const p = jobProblems(sched, 2);
  assert.deepEqual(p.map((j) => j.name), ["Imagen", "Alertas"]);
  assert.equal(p[1].lastError, "timeout");
  assert.equal(jobProblems(sched)[2].name, "c", "sin nombre usa el id");
  assert.deepEqual(jobProblems({ ok: false }), []);
  assert.deepEqual(jobProblems(null), []);
});

test("overviewPill: texto del servidor y respaldo", () => {
  assert.deepEqual(overviewPill({ health: { level: "ok", text: "Todo operativo" } }), { text: "Todo operativo", tone: "on" });
  assert.deepEqual(overviewPill({ health: { level: "bad", text: "Scheduler detenido" } }), { text: "Scheduler detenido", tone: "warn" });
  assert.deepEqual(overviewPill(null), { text: "Ver estado", tone: "off" });
});
