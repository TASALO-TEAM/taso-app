import assert from "node:assert/strict";
import test from "node:test";
import { fmtPrice, marketAlertLine, priceStatusAll } from "../../static/js/modules/alerts.js";

const active = (over = {}) => ({ id: 1, symbol: "BTC", target: 100000, direction: "ABOVE", status: "ACTIVE", price_at_creation: 90000, notified: false, ...over });

test("marketAlertLine: activa que sube, con el precio al crear", () => {
  assert.equal(marketAlertLine(active()), "Sube a $100000 · al crear: $90000");
});

test("marketAlertLine: activa que baja y sin precio al crear", () => {
  assert.equal(marketAlertLine(active({ direction: "BELOW", target: 0.00001234, price_at_creation: null })), "Baja a $0,00001234");
});

test("marketAlertLine: disparada avisada y disparada con el aviso por enviar", () => {
  const done = active({ status: "TRIGGERED", triggered_price: 100500, notified: true });
  assert.equal(marketAlertLine(done), "Se cumplió: llegó a $100500");
  assert.equal(marketAlertLine({ ...done, notified: false }), "Se cumplió a $100500 · aviso por enviar");
});

test("priceStatusAll: suma las del bot y solo las ACTIVAS propias", () => {
  const bot = { ok: true, items: [{ id: 1 }] };
  const market = { ok: true, alerts: [active(), active({ id: 2, status: "TRIGGERED" })] };
  assert.deepEqual(priceStatusAll(bot, market), { text: "2 activas", tone: "on" });
  assert.deepEqual(priceStatusAll({ ok: true, items: [] }, { ok: true, alerts: [] }), { text: "Sin alertas", tone: "off" });
  assert.deepEqual(priceStatusAll({ ok: true, items: [{}] }, { ok: true, alerts: [] }), { text: "1 activa", tone: "on" });
});

test("priceStatusAll: si una fuente falla cuenta la otra; si fallan las dos, no disponible", () => {
  assert.deepEqual(priceStatusAll({ ok: false }, { ok: true, alerts: [active()] }), { text: "1 activa", tone: "on" });
  assert.deepEqual(priceStatusAll({ ok: true, items: [{}, {}] }, null), { text: "2 activas", tone: "on" });
  assert.deepEqual(priceStatusAll({ ok: false }, null), { text: "No disponible", tone: "warn" });
});

test("fmtPrice sigue igual (lo usa marketAlertLine)", () => {
  assert.equal(fmtPrice(0.00001234), "0,00001234");
});
