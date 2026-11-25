import test from "node:test";
import assert from "node:assert/strict";
import { learnSkew, serverNow, getSkew, resetSkew } from "../../static/js/modules/clock.js";
import { relative, isStale } from "../../static/js/modules/format.js";

test("sin respuesta del servidor el desfase es 0", () => {
  resetSkew();
  assert.equal(getSkew(), 0);
  assert.ok(Math.abs(serverNow() - Date.now()) < 50);
});

test("un reloj adelantado 1 h se corrige con la cabecera Date", () => {
  resetSkew();
  const real = Date.parse("2026-11-24T23:32:13Z");
  const device = real + 59 * 60000 + 26000; // el PC de Ernesto: ~59 min adelantado
  learnSkew("Tue, 24 Nov 2026 23:32:13 GMT", device);
  assert.equal(getSkew(), real - device);
  // Con el reloj del dispositivo un dato recien traido parece de hace 59 min; con el corregido, de "ahora".
  const fetchedAt = "2026-11-24T23:32:00Z";
  assert.equal(relative(fetchedAt, device), "hace 59 min");
  assert.equal(relative(fetchedAt, real), "ahora");
  assert.equal(isStale(fetchedAt, real, 15), false);
  resetSkew();
});

test("una cabecera invalida o vacia no cambia el desfase", () => {
  resetSkew();
  learnSkew("Tue, 24 Nov 2026 23:32:13 GMT", Date.parse("2026-11-24T23:32:15Z"));
  const before = getSkew();
  learnSkew("", Date.now());
  learnSkew(null, Date.now());
  learnSkew("no es una fecha", Date.now());
  assert.equal(getSkew(), before);
  resetSkew();
});
