import assert from "node:assert/strict";
import test from "node:test";

import { PANORAMA_DISCLAIMER, panoramaError, panoramaParagraphs } from "../../static/js/modules/market.js";

test("panoramaParagraphs: separa por línea en blanco, compacta espacios y quita vacíos", () => {
  assert.deepEqual(panoramaParagraphs("Uno  dos.\n\n\nTres.\r\n\r\nCuatro\ncontinúa."), ["Uno dos.", "Tres.", "Cuatro continúa."]);
});

test("panoramaParagraphs: entradas raras dan lista vacía", () => {
  assert.deepEqual(panoramaParagraphs(null), []);
  assert.deepEqual(panoramaParagraphs(undefined), []);
  assert.deepEqual(panoramaParagraphs(42), []);
  assert.deepEqual(panoramaParagraphs("  \n\n \n"), []);
});

test("panoramaParagraphs: nunca devuelve más de 8 párrafos", () => {
  const text = Array.from({ length: 20 }, (_, i) => `P${i}`).join("\n\n");
  assert.equal(panoramaParagraphs(text).length, 8);
});

test("panoramaParagraphs: el HTML se queda como texto (se pinta con textContent)", () => {
  assert.deepEqual(panoramaParagraphs("<script>alert(1)</script>\n\n<b>x</b>"), ["<script>alert(1)</script>", "<b>x</b>"]);
});

test("panoramaError: mensaje propio según el fallo, sin depender del servidor", () => {
  assert.match(panoramaError({ status: 0 }), /Sin conexión/);
  assert.match(panoramaError({ status: 429 }), /límite/);
  assert.match(panoramaError({ status: 404 }), /No encontré/);
  assert.match(panoramaError({ status: 503 }), /no está disponible/);
  assert.match(panoramaError({ status: 500 }), /no está disponible/);
  assert.match(panoramaError(), /no está disponible/);
});

test("el aviso de que no es asesoramiento financiero existe", () => {
  assert.match(PANORAMA_DISCLAIMER, /no constituye asesoramiento financiero/i);
});
