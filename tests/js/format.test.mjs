import test from "node:test";
import assert from "node:assert/strict";
import { cubaDateKey, cubaDateText, cubaParts, toMs } from "../../static/js/modules/cuba-time.js";
import {
  arrow, change, changeDescription, changePct, isStale, percent, rate, relative, roundHalfUp,
} from "../../static/js/modules/format.js";

const T = (iso) => Date.parse(iso);

// ---------- cuba-time ----------

test("toMs acepta ISO, Date y número; lo inválido es null", () => {
  assert.equal(toMs("2026-10-10T15:40:00+00:00"), T("2026-10-10T15:40:00Z"));
  assert.equal(toMs(new Date(5)), 5);
  assert.equal(toMs(7), 7);
  for (const bad of [null, undefined, "", "ayer", NaN, new Date("x")]) assert.equal(toMs(bad), null);
});

test("hora de Cuba en verano (UTC−4) y en invierno (UTC−5)", () => {
  assert.deepEqual(cubaParts(T("2026-10-10T15:40:00Z")), { year: 2026, month: 10, day: 10, hour: 11, minute: 40, second: 0 });
  assert.deepEqual(cubaParts(T("2026-12-15T15:40:00Z")), { year: 2026, month: 12, day: 15, hour: 10, minute: 40, second: 0 });
});

test("el día cambia a medianoche de Cuba, no de UTC", () => {
  assert.equal(cubaDateKey(T("2026-10-10T03:59:59Z")), "2026-10-09"); // 23:59:59 del 9 en Cuba
  assert.equal(cubaDateKey(T("2026-10-10T04:00:00Z")), "2026-10-10"); // 00:00 del 10
  assert.equal(cubaParts(T("2026-10-10T04:00:00Z")).hour, 0);          // nunca 24
});

test("cambio de horario: el 2 de noviembre ya es UTC−5", () => {
  assert.equal(cubaDateKey(T("2026-11-02T04:30:00Z")), "2026-11-01"); // 23:30 del 1 en horario normal
});

test("cubaDateText es dd/MM/yyyy", () => {
  assert.equal(cubaDateText(T("2026-10-09T18:00:00Z")), "09/10/2026");
});

// ---------- roundHalfUp / rate ----------

test("roundHalfUp no sufre el fallo de toFixed (1.005 → 1.01)", () => {
  assert.equal(roundHalfUp(1.005, 2), 1.01);
  assert.equal(roundHalfUp(520.125, 2), 520.13);
  assert.equal(roundHalfUp(2.5, 0), 3);
});

test("rate: 0–2 decimales, coma decimal, sin separador de miles", () => {
  const casos = [
    [750, "750"], [857.5, "857,5"], [485.07, "485,07"], [520.125, "520,13"], [1.005, "1,01"],
    [0.994, "0,99"], [0, "0"], [52000000, "52000000"], [-1.5, "-1,5"],
  ];
  for (const [valor, esperado] of casos) assert.equal(rate(valor), esperado, String(valor));
});

test("rate: valores pequeños negativos no dan «-0» y lo inválido es «—»", () => {
  assert.equal(rate(-0.001), "0");
  for (const bad of [NaN, Infinity, null, undefined]) assert.equal(rate(bad), "—");
});

test("percent lleva un decimal y signo solo si es negativo", () => {
  assert.equal(percent(0.34), "0,3%");
  assert.equal(percent(-1.55), "-1,6%");
  assert.equal(percent(12), "12,0%");
});

// ---------- cambio ----------

test("arrow y changeDescription: el cambio no depende solo del color", () => {
  assert.equal(arrow("up"), "▲");
  assert.equal(arrow("down"), "▼");
  assert.equal(arrow("neutral"), "—");
  assert.equal(changeDescription("up"), "sube");
  assert.equal(changeDescription("down"), "baja");
  assert.equal(changeDescription("neutral"), "sin cambios");
  assert.equal(changeDescription(undefined), "sin cambios");
});

test("change: flecha, diferencia y % contra la lectura anterior", () => {
  assert.equal(change({ rate: 585, prev_rate: 582.5, change: "up" }), "▲ 2,5 (+0,4%)");
  assert.equal(change({ rate: 520, prev_rate: 521, change: "down" }), "▼ 1 (-0,2%)");
});

test("change: neutral es «—»; sin prev_rate solo la flecha; prev_rate 0 sin porcentaje", () => {
  assert.equal(change({ rate: 410, prev_rate: 410, change: "neutral" }), "—");
  assert.equal(change({ rate: 410, prev_rate: null, change: "up" }), "▲");
  assert.equal(change({ rate: 5, prev_rate: 0, change: "up" }), "▲ 5");
  assert.equal(change({ rate: 5, change: undefined }), "—");
});

test("changePct", () => {
  assert.equal(changePct({ rate: 110, prev_rate: 100 }), 10);
  assert.equal(changePct({ rate: 110, prev_rate: 0 }), null);
  assert.equal(changePct({ rate: 110, prev_rate: null }), null);
});

// ---------- relative / isStale ----------

const NOW = T("2026-10-10T16:00:00Z");

test("relative: ahora, minutos, horas y fecha de Cuba pasadas 24 h", () => {
  const ago = (ms) => new Date(NOW - ms).toISOString();
  assert.equal(relative(ago(30_000), NOW), "ahora");
  assert.equal(relative(ago(-60_000), NOW), "ahora"); // reloj desajustado: nunca «hace -1 min»
  assert.equal(relative(ago(5 * 60_000), NOW), "hace 5 min");
  assert.equal(relative(ago(59 * 60_000), NOW), "hace 59 min");
  assert.equal(relative(ago(60 * 60_000), NOW), "hace 1 h");
  assert.equal(relative(ago(23 * 3_600_000 + 59 * 60_000), NOW), "hace 23 h");
  assert.equal(relative("2026-10-09T15:00:00Z", NOW), "09/10/2026");
});

test("relative sin dato", () => {
  assert.equal(relative(null, NOW), "sin datos");
  assert.equal(relative("ayer", NOW), "sin datos");
});

test("isStale: 60 min o más, y sin hora cuenta como viejo", () => {
  assert.equal(isStale(new Date(NOW - 59 * 60_000).toISOString(), NOW), false);
  assert.equal(isStale(new Date(NOW - 60 * 60_000).toISOString(), NOW), true);
  assert.equal(isStale(null, NOW), true);
  assert.equal(isStale("basura", NOW), true);
  assert.equal(isStale(new Date(NOW - 50 * 60_000).toISOString(), NOW, 45), true);
});
