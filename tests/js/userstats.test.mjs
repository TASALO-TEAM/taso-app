import test from "node:test";
import assert from "node:assert/strict";
import {
  allDown, coinRows, commandRows, dateLabel, DEFAULT_WINDOW, isEmpty, normalizeWindow, sinceLine, sourceRows, successLabel,
} from "../../static/js/modules/userstats.js";
import { resolveRoute } from "../../static/js/modules/tabs.js";

const BOT = {
  ok: true, found: true, total: 12, successful: 11, failed: 1, success_rate: 91.7,
  commands: [{ name: "/p", count: 9 }, { name: "ms", count: 3 }],
  sources: [{ name: "eltoque", count: 8 }, { name: "bcc", count: 2 }],
  total_all_time: 340, first_seen: "2026-01-03T10:00:00Z", last_seen: "2026-10-12T11:00:00Z",
};
const APP = { ok: true, mercado_queries: 4, mercado_days: 2, coins: [{ name: "BTC", count: 3 }, { name: "ETH", count: 1 }], alerts_active: 2, alerts_triggered: 1 };

test("normalizeWindow: por defecto 7 días; valida 24h/7d/30d", () => {
  assert.equal(DEFAULT_WINDOW, "7d");
  for (const w of ["24h", "7d", "30d"]) assert.equal(normalizeWindow(w), w);
  for (const bad of [undefined, null, "1y", "", 7, {}]) assert.equal(normalizeWindow(bad), "7d", String(bad));
});

test("commandRows: pone la barra «/», ordena por el servidor y calcula porcentajes", () => {
  const rows = commandRows(BOT);
  assert.deepEqual(rows.map((r) => r.label), ["/p", "/ms"]);
  assert.equal(rows[0].pct, 100);
  assert.equal(rows[1].pct, 33);
});

test("sourceRows y coinRows: etiquetas sin tocar y vacío si el bloque está caído", () => {
  assert.deepEqual(sourceRows(BOT).map((r) => r.label), ["eltoque", "bcc"]);
  assert.deepEqual(coinRows(APP).map((r) => r.label), ["BTC", "ETH"]);
  assert.deepEqual(commandRows({ ok: false }), []);
  assert.deepEqual(sourceRows(null), []);
  assert.deepEqual(coinRows(undefined), []);
});

test("datos hostiles: sin NaN, sin elementos raros, sin romper", () => {
  const evil = { ok: true, commands: [null, 5, { name: null, count: NaN }, { name: "<img onerror=x>", count: Infinity }, { name: "p", count: -3 }] };
  const rows = commandRows(evil);
  assert.ok(rows.every((r) => Number.isFinite(r.value) && r.value >= 0 && Number.isFinite(r.pct)));
  assert.ok(rows.some((r) => r.label === "/<img onerror=x>"), "es texto; el DOM lo pinta con textContent");
});

test("successLabel: «—» sin comandos o sin porcentaje", () => {
  assert.equal(successLabel(BOT), "91,7 %");
  assert.equal(successLabel({ ok: true, total: 0, success_rate: null }), "—");
  assert.equal(successLabel({ ok: true, total: 5, success_rate: null }), "—");
  assert.equal(successLabel({ ok: false }), "—");
  assert.equal(successLabel(null), "—");
});

test("dateLabel y sinceLine: solo con fechas válidas", () => {
  assert.match(dateLabel("2026-01-03T10:00:00Z"), /^3 ene 2026$/);
  assert.equal(dateLabel("no es fecha"), "");
  assert.equal(dateLabel(null), "");
  const now = Date.parse("2026-10-12T13:00:00Z");
  assert.equal(sinceLine(BOT, now), "Usas el bot desde 3 ene 2026 · último uso hace 2 h");
  assert.equal(sinceLine({ ok: true }, now), "");
  assert.equal(sinceLine({ ok: false }, now), "");
});

test("isEmpty / allDown", () => {
  assert.equal(isEmpty({ bot: BOT, app: APP }), false);
  assert.equal(isEmpty({ bot: { ok: true, total: 0 }, app: { ok: true, mercado_queries: 0, alerts_active: 0, alerts_triggered: 0 } }), true);
  assert.equal(isEmpty({ bot: { ok: false }, app: { ok: true, mercado_queries: 0, alerts_active: 1, alerts_triggered: 0 } }), false);
  assert.equal(allDown({ bot: { ok: false }, app: { ok: false } }), true);
  assert.equal(allDown({ bot: { ok: false }, app: APP }), false);
  assert.equal(allDown(null), true);
});

test("ruta #/estadisticas cuelga de Perfil", () => {
  const TABS = { tasas: "Tasas", mercado: "Mercado", calculadora: "Calculadora", blog: "Blog", perfil: "Perfil" };
  assert.deepEqual(resolveRoute("estadisticas", TABS), { name: "estadisticas", tab: "perfil", title: "Mis estadísticas" });
});
