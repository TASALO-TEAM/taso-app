import test from "node:test";
import assert from "node:assert/strict";
import { fuelBanner, fuelRange, metaFor } from "../../static/js/modules/fuel.js";

const NOW = Date.parse("2026-10-10T16:00:00Z");
const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString();

test("metaFor: nombres de Android; un tipo desconocido cae al código", () => {
  assert.deepEqual(metaFor("B-94"), { name: "Gasolina B-94", subtype: "Especial", unit: "CUP/L" });
  assert.equal(metaFor("Petroleo").name, "Petróleo / Diésel");
  assert.equal(metaFor("Gas_LP").unit, "CUP/balón");
  assert.deepEqual(metaFor("Raro"), { name: "Raro", subtype: "", unit: "CUP" });
});

test("fuelRange: rango, valor único y sin datos", () => {
  assert.equal(fuelRange({ min: 600, max: 620 }), "600-620");
  assert.equal(fuelRange({ min: 857.5, max: 900 }), "857,5-900");
  assert.equal(fuelRange({ min: 1800, max: 1800 }), "1800");
  assert.equal(fuelRange({ min: null, max: 520 }), "520");
  assert.equal(fuelRange({ min: 510, max: null }), "510");
  assert.equal(fuelRange({ min: null, max: null }), "—");
  assert.equal(fuelRange(null), "—");
  assert.equal(fuelRange({ min: Number.NaN, max: 5 }), "5");
});

test("fuelBanner: dato fresco no avisa", () => {
  assert.equal(fuelBanner({ fetchedAt: ago(10), now: NOW }), null);
});

test("fuelBanner: más de 60 min es desactualizado, con la edad real", () => {
  assert.deepEqual(fuelBanner({ fetchedAt: ago(125), now: NOW }), { text: "Datos desactualizados · hace 2 h", error: true });
});

test("fuelBanner: prioridad sin conexión > no se pudo actualizar", () => {
  assert.match(fuelBanner({ fetchedAt: ago(5), now: NOW, offline: true, apiError: true }).text, /^Sin conexión · datos de hace 5 min$/);
  assert.match(fuelBanner({ fetchedAt: ago(5), now: NOW, apiError: true }).text, /^No se pudo actualizar · datos de hace 5 min$/);
  assert.match(fuelBanner({ fetchedAt: ago(5), now: NOW, stale: true }).text, /^No se pudo actualizar/);
});

test("fuelBanner: sin hora de lectura nunca se afirma que es fresco", () => {
  assert.match(fuelBanner({ fetchedAt: null, now: NOW }).text, /Sin marca de actualización/);
  assert.match(fuelBanner({ fetchedAt: null, now: NOW, offline: true }).text, /^Sin conexión/);
});
