
import test from "node:test";
import assert from "node:assert/strict";
import { flagFor, groupRates, nameFor } from "../../static/js/modules/rates.js";

test("flagFor: monedas con bandera, QvaPay con iconos de método de pago", () => {
  assert.equal(flagFor("eltoque", "USD"), "🇺🇸");
  assert.equal(flagFor("bcc", "EUR"), "🇪🇺");
  assert.equal(flagFor("qvapay", "ZELLE"), "⚡");
  assert.equal(flagFor("qvapay", "CUP"), "🏦");
});

test("flagFor: en QvaPay cae a la moneda si no es método; lo desconocido es vacío", () => {
  assert.equal(flagFor("qvapay", "USD"), "🇺🇸");
  assert.equal(flagFor("eltoque", "XYZ"), "");
});

test("flagFor: El Toque tiene icono para ZELLE y CLA", () => {
  assert.equal(flagFor("eltoque", "ZELLE"), "⚡");
  assert.equal(flagFor("eltoque", "CLA"), "💳");
});

test("nameFor: nombre local primero, luego el de la API, luego el código", () => {
  assert.equal(nameFor("eltoque", "USD", "Dólar de la API"), "Dólar");
  assert.equal(nameFor("eltoque", "ZELLE", " Zelle "), "Zelle");
  assert.equal(nameFor("eltoque", "ZELLE"), "ZELLE");
  assert.equal(nameFor("eltoque", "ZELLE", "  "), "ZELLE");
});

test("groupRates: sin group (QvaPay, BCC, API vieja) devuelve null", () => {
  assert.equal(groupRates([{ code: "USD", rate: 1 }]), null);
  assert.equal(groupRates([]), null);
  assert.equal(groupRates(null), null);
});

test("groupRates: secciones de mercado en orden y referencia aparte", () => {
  const rates = [
    { code: "EUR", group: "main", tier: "market" },
    { code: "ZELLE", group: "main", tier: "market" },
    { code: "BTC", group: "crypto", tier: "market" },
    { code: "CAD", group: "other", tier: "market" },
    { code: "BNB", group: "crypto", tier: "reference" },
    { code: "AUD", group: "other", tier: "reference" },
  ];
  const out = groupRates(rates);
  assert.deepEqual(out.sections.map((s) => s.id), ["main", "crypto", "other"]);
  assert.deepEqual(out.sections[0].rates.map((r) => r.code), ["EUR", "ZELLE"]);
  assert.deepEqual(out.reference.map((r) => r.code), ["BNB", "AUD"]);
});

test("groupRates: omite secciones vacías y trata la falta de tier como mercado", () => {
  const out = groupRates([{ code: "BTC", group: "crypto" }, { code: "AUD", group: "other", tier: "reference" }]);
  assert.deepEqual(out.sections.map((s) => s.id), ["crypto"]);
  assert.equal(out.reference.length, 1);
});
