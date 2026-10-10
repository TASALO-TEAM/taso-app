import test from "node:test";
import assert from "node:assert/strict";
import { flagFor } from "../../static/js/modules/rates.js";

test("flagFor: monedas con bandera, QvaPay con iconos de método de pago", () => {
  assert.equal(flagFor("eltoque", "USD"), "🇺🇸");
  assert.equal(flagFor("bcc", "EUR"), "🇪🇺");
  assert.equal(flagFor("qvapay", "ZELLE"), "⚡");
  assert.equal(flagFor("qvapay", "CUP"), "🏦");
});

test("flagFor: en QvaPay cae a la moneda si no es método; lo desconocido es vacío", () => {
  assert.equal(flagFor("qvapay", "USD"), "🇺🇸");
  assert.equal(flagFor("eltoque", "XYZ"), "");
  assert.equal(flagFor("eltoque", "ZELLE"), "");
});
