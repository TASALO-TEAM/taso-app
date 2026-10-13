import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULTS, hiddenCount, hiddenKey, hiddenSet, normalize, resolveScheme, withHidden,
} from "../../static/js/modules/settings.js";
import { resolveRoute } from "../../static/js/modules/tabs.js";
import { avisosSummary } from "../../static/js/modules/profile.js";

const TABS = { tasas: "Tasas", mercado: "Mercado", calculadora: "Calculadora", blog: "Blog", perfil: "Perfil" };

test("normalize: valores por defecto con cualquier entrada rara", () => {
  for (const bad of [null, undefined, 5, "x", [], [1], true]) {
    assert.deepEqual(normalize(bad), { theme: "auto", invert: false, hidden: [] }, String(bad));
  }
  assert.deepEqual({ ...DEFAULTS, hidden: [...DEFAULTS.hidden] }, { theme: "auto", invert: false, hidden: [] });
});

test("normalize: tema, convención y ocultas válidos se conservan; lo inválido se descarta", () => {
  const s = normalize({ theme: "dark", invert: true, hidden: ["ELTOQUE:USD", "ELTOQUE:USD", "x", 5, "ELTOQUE:<b>", "BCC:EUR"], extra: 1 });
  assert.deepEqual(s, { theme: "dark", invert: true, hidden: ["ELTOQUE:USD", "BCC:EUR"] });
  assert.equal(normalize({ theme: "neon" }).theme, "auto");
  assert.equal(normalize({ invert: "true" }).invert, false, "solo true exacto");
  assert.equal(normalize({ hidden: "ELTOQUE:USD" }).hidden.length, 0);
});

test("normalize: tope de monedas ocultas", () => {
  const many = Array.from({ length: 500 }, (_, i) => `SRC:C${i}`);
  assert.equal(normalize({ hidden: many }).hidden.length, 200);
});

test("resolveScheme: auto sigue al sistema; claro/oscuro mandan", () => {
  assert.equal(resolveScheme("auto", "light"), "light");
  assert.equal(resolveScheme("auto", "dark"), "dark");
  assert.equal(resolveScheme("auto", undefined), "dark");
  assert.equal(resolveScheme("light", "dark"), "light");
  assert.equal(resolveScheme("dark", "light"), "dark");
  assert.equal(resolveScheme("raro", "light"), "light");
});

test("monedas ocultas: clave, conjunto, añadir, quitar y contar por fuente", () => {
  assert.equal(hiddenKey("eltoque", "usd"), "ELTOQUE:USD");
  let s = normalize({});
  s = withHidden(s, "eltoque", "USD", true);
  s = withHidden(s, "eltoque", "EUR", true);
  s = withHidden(s, "bcc", "USD", true);
  s = withHidden(s, "eltoque", "USD", true); // repetido: no duplica
  assert.deepEqual(s.hidden, ["ELTOQUE:EUR", "BCC:USD", "ELTOQUE:USD"]);
  assert.equal(s.hidden.length, 3);
  assert.equal(hiddenCount(s, "eltoque"), 2);
  assert.equal(hiddenCount(s, "bcc"), 1);
  assert.ok(hiddenSet(s).has("BCC:USD"));
  s = withHidden(s, "eltoque", "USD", false);
  assert.equal(hiddenCount(s, "eltoque"), 1);
  assert.equal(hiddenSet(s).has("ELTOQUE:USD"), false);
});

test("resolveRoute: pestañas, alias y sub-pantallas con su pestaña padre", () => {
  assert.deepEqual(resolveRoute("tasas", TABS), { name: "tasas", tab: "tasas", title: "Tasas" });
  assert.deepEqual(resolveRoute("alertas", TABS), { name: "perfil", tab: "perfil", title: "Perfil" });
  assert.deepEqual(resolveRoute("ajustes", TABS), { name: "ajustes", tab: "perfil", title: "Ajustes" });
  assert.deepEqual(resolveRoute("avisos", TABS), { name: "avisos", tab: "perfil", title: "Mis avisos" });
});

test("resolveRoute: desconocidas, prototipo y padre inexistente → null", () => {
  for (const bad of ["nada", "", "constructor", "__proto__", null, undefined, 3]) assert.equal(resolveRoute(bad, TABS), null, String(bad));
  assert.equal(resolveRoute("ajustes", { tasas: "Tasas" }), null);
});

test("avisosSummary: sin datos, todo apagado, algo activo y secciones caídas", () => {
  const now = Date.UTC(2026, 9, 12, 12);
  assert.deepEqual(avisosSummary(null, now), { text: "Ver mis avisos", tone: "off" });
  const off = { price: { ok: true, items: [] }, image: { ok: true, config: null }, year: { ok: true, hour: null }, spotlight: { ok: true, hours: [] } };
  assert.deepEqual(avisosSummary(off, now), { text: "Sin avisos activos", tone: "off" });
  const two = { ...off, price: { ok: true, items: [{ id: 1 }] }, year: { ok: true, hour: 12 } };
  assert.deepEqual(avisosSummary(two, now), { text: "2 de 4 activos", tone: "on" });
  assert.deepEqual(avisosSummary({ ...off, spotlight: { ok: true, hours: [13] } }, now), { text: "1 de 4 activo", tone: "on" });
  const down = { price: { ok: false }, image: { ok: false }, year: { ok: false }, spotlight: { ok: false } };
  assert.deepEqual(avisosSummary(down, now), { text: "No disponible", tone: "warn" });
  assert.equal(avisosSummary({ price: { ok: true } }, now).tone, "warn", "datos mal formados no lanzan");
});
