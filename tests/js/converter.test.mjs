import test from "node:test";
import assert from "node:assert/strict";
import {
  amount, buildTable, codesOf, convert, parseAmount, receipt, resolvePair, sanitizeAmount,
} from "../../static/js/modules/converter.js";

const r = (code, rate) => ({ code, rate });
const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

// Casos de ConverterTest.kt (Android)
const table = buildTable([
  r("USD", 520), r("EUR", 585), r("BTC", 52_000_000),
  r("CUP", 99), // el CUP siempre vale 1, venga lo que venga de la API
  r("MLC", 0), // tasa inválida: se descarta
]);

test("USD → CUP", () => near(convert(20, "USD", "CUP", table), 10400));
test("CUP → USD es la inversa", () => near(convert(10400, "CUP", "USD", table), 20));
test("USD → EUR pasa por el CUP", () => near(convert(20, "USD", "EUR", table), (20 * 520) / 585));

test("el CUP siempre vale 1 y las tasas inválidas se descartan", () => {
  assert.equal(table.get("CUP"), 1);
  assert.equal(table.has("MLC"), false);
});

test("moneda desconocida → null", () => {
  assert.equal(convert(1, "USD", "XXX", table), null);
  assert.notEqual(convert(1, "BTC", "USD", table), null);
});

test("orden de códigos: CUP primero y luego el habitual", () => {
  assert.deepEqual(codesOf(table), ["CUP", "EUR", "USD", "BTC"]);
});

// QvaPay: cada valor es «cuánto de ese método por 1 USD»; el pivote es el USD.
const qvapay = buildTable(
  [r("CUP", 980), r("ZELLE", 1.02), r("MLC", 1.5), r("USD", 7), r("BAD", 0)],
  "qvapay",
);

test("QvaPay pivota en USD y el CUP es un método normal", () => {
  assert.equal(qvapay.get("USD"), 1);
  near(convert(20, "USD", "CUP", qvapay), 19600, 1e-6);
  near(convert(19600, "CUP", "USD", qvapay), 20);
  assert.equal(qvapay.has("BAD"), false);
});

test("QvaPay convierte entre métodos pasando por USD", () => {
  near(convert(100, "CUP", "MLC", qvapay), (100 / 980) * 1.5);
});

test("QvaPay: USD primero y luego el orden de los métodos", () => {
  assert.deepEqual(codesOf(qvapay, "qvapay"), ["USD", "CUP", "MLC", "ZELLE"]);
});

// Casos de CalculatorFormatTest.kt
test("amount adapta los decimales al tamaño", () => {
  assert.equal(amount(20), "20");
  assert.equal(amount(17.5), "17,5");
  assert.equal(amount(10400), "10\u00A0400");
  assert.equal(amount(0.01923), "0,0192");
  assert.equal(amount(0.00038), "0,00038");
  assert.equal(amount(0), "0");
});

test("amount: redondeo mitad hacia arriba, miles grandes, negativos y no finitos", () => {
  assert.equal(amount(1.005), "1,01");
  assert.equal(amount(2.675), "2,68");
  assert.equal(amount(52_000_000), "52\u00A0000\u00A0000");
  assert.equal(amount(1234567.891), "1\u00A0234\u00A0567,89");
  assert.equal(amount(0.000000004), "0");
  assert.equal(amount(-17.5), "-17,5");
  assert.equal(amount(Number.NaN), "—");
  assert.equal(amount(null), "—");
});

test("parseAmount acepta coma o punto", () => {
  assert.equal(parseAmount("20"), 20);
  assert.equal(parseAmount("1,5"), 1.5);
  assert.equal(parseAmount("1.5"), 1.5);
  assert.equal(parseAmount(" 7 "), 7);
  assert.equal(parseAmount(",5"), 0.5);
  assert.equal(parseAmount("5,"), 5);
});

test("parseAmount rechaza basura", () => {
  for (const bad of ["", ",", "1.2.3", "-5", "abc", "0x10", "1e5", "Infinity", null, undefined]) {
    assert.equal(parseAmount(bad), null, String(bad));
  }
});

test("sanitizeAmount: solo dígitos y un separador (se muestra coma), con tope", () => {
  assert.equal(sanitizeAmount("12a3"), "123");
  assert.equal(sanitizeAmount("1.5"), "1,5");
  assert.equal(sanitizeAmount("1,2.3"), "1,23");
  assert.equal(sanitizeAmount("-5"), "5");
  assert.equal(sanitizeAmount("1".repeat(30)).length, 14);
  assert.equal(sanitizeAmount(null), "");
});

// Par origen/destino (lógica de CalculatorScreen.kt)
test("resolvePair: lo guardado si existe, y nunca la misma moneda", () => {
  const codes = ["CUP", "EUR", "USD", "BTC"];
  assert.deepEqual(resolvePair("USD", "CUP", codes), { from: "USD", to: "CUP" });
  assert.deepEqual(resolvePair("EUR", "EUR", codes), { from: "EUR", to: "CUP" });
  assert.deepEqual(resolvePair("CUP", "CUP", codes), { from: "CUP", to: "EUR" });
});

test("resolvePair: si la fuente no trae la moneda guardada cae a una válida", () => {
  assert.deepEqual(resolvePair("ZELLE", "MLC", ["CUP", "EUR", "USD"]), { from: "EUR", to: "CUP" });
  assert.deepEqual(resolvePair("USD", "CUP", ["USD", "ZELLE"]), { from: "USD", to: "ZELLE" });
  assert.deepEqual(resolvePair("USD", "CUP", ["CUP"]), { from: "CUP", to: "CUP" });
});

test("tabla con datos raros no revienta ni toca el prototipo", () => {
  const t = buildTable([null, 5, { code: 7, rate: 1 }, { code: "A", rate: "9" }, { code: "__proto__", rate: 3 }, r("B", Number.NaN), r("C", 2)]);
  assert.deepEqual([...t.keys()].sort(), ["C", "CUP", "__proto__"]);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(buildTable(null).size, 1);
});

// Recibo
test("recibo: monto de origen, una línea por moneda y la firma", () => {
  const rows = codesOf(table).filter((c) => c !== "USD");
  assert.equal(
    receipt({ value: 20, from: "USD", sourceTitle: "El Toque", table, rows: ["CUP", "EUR"] }),
    "20 USD · El Toque\n= 10\u00A0400 CUP\n= 17,78 EUR\nTasas con TASALO",
  );
  assert.deepEqual(rows, ["CUP", "EUR", "BTC"]);
});

test("recibo: se salta lo que no se puede convertir", () => {
  assert.equal(
    receipt({ value: 1, from: "USD", sourceTitle: "BCC", table, rows: ["XXX", "CUP"] }),
    "1 USD · BCC\n= 520 CUP\nTasas con TASALO",
  );
});
