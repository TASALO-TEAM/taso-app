import test from "node:test";
import assert from "node:assert/strict";
import { resolveTab, TAB_ALIASES } from "../../static/js/modules/tabs.js";
import { displayName, handleOf, initialOf, languageLabel, profileChips, safePhotoUrl } from "../../static/js/modules/profile.js";

const TABS = { tasas: "Tasas", mercado: "Mercado", calculadora: "Calculadora", blog: "Blog", perfil: "Perfil" };

test("resolveTab: pestañas conocidas se devuelven tal cual", () => {
  for (const k of Object.keys(TABS)) assert.equal(resolveTab(k, TABS), k);
});

test("resolveTab: «alertas» (enlaces antiguos) abre Perfil", () => {
  assert.equal(resolveTab("alertas", TABS), "perfil");
  assert.deepEqual(Object.keys(TAB_ALIASES), ["alertas"]);
});

test("resolveTab: desconocidas, no-cadenas y claves del prototipo → null", () => {
  for (const bad of ["nada", "", "constructor", "__proto__", "toString", "hasOwnProperty", null, undefined, 3, {}]) {
    assert.equal(resolveTab(bad, TABS), null, String(bad));
  }
});

test("resolveTab: un alias hacia una pestaña que no existe → null", () => {
  assert.equal(resolveTab("alertas", { tasas: "Tasas" }), null);
});

test("displayName: nombre y apellido, solo nombre, solo @usuario y nada", () => {
  assert.equal(displayName({ first_name: "Ernesto", last_name: "Suárez" }), "Ernesto Suárez");
  assert.equal(displayName({ first_name: "  Ana  ", last_name: "" }), "Ana");
  assert.equal(displayName({ first_name: "", username: "ersus93" }), "ersus93");
  assert.equal(displayName({ username: "@ersus93" }), "ersus93");
  assert.equal(displayName({}), "Usuario");
  assert.equal(displayName(null), "Usuario");
  assert.equal(displayName({ first_name: 5, last_name: {} }), "Usuario");
});

test("initialOf: mayúscula, Unicode completo y respaldo", () => {
  assert.equal(initialOf({ first_name: "ernesto" }), "E");
  assert.equal(initialOf({ first_name: "ñandú" }), "Ñ");
  assert.equal(initialOf({ first_name: "😀 Pepe" }), "😀"); // un carácter Unicode, no media pareja sustituta
  assert.equal(initialOf({}), "U");
});

test("handleOf: con y sin arroba, vacío si no hay", () => {
  assert.equal(handleOf({ username: "ersus93" }), "@ersus93");
  assert.equal(handleOf({ username: "@ersus93" }), "@ersus93");
  assert.equal(handleOf({ username: "" }), "");
  assert.equal(handleOf({}), "");
  assert.equal(handleOf(undefined), "");
});

test("languageLabel: conocidos, regionales, raros y vacíos", () => {
  assert.equal(languageLabel("es"), "Español");
  assert.equal(languageLabel("es-419"), "Español");
  assert.equal(languageLabel("EN"), "English");
  assert.equal(languageLabel("xx"), "XX");
  assert.equal(languageLabel("constructor"), "CONSTRUCTOR");
  assert.equal(languageLabel(""), "");
  assert.equal(languageLabel(null), "");
});

test("safePhotoUrl: solo https sin credenciales y de tamaño razonable", () => {
  assert.equal(safePhotoUrl("https://t.me/i/userpic/320/abc.jpg"), "https://t.me/i/userpic/320/abc.jpg");
  for (const bad of [
    "http://t.me/a.jpg", "javascript:alert(1)", "data:image/png;base64,AAAA", "//t.me/a.jpg", "https://u:p@t.me/a.jpg",
    "https://t.me/a b.jpg", "no es url", "", null, undefined, 7, `https://t.me/${"a".repeat(600)}`,
  ]) {
    assert.equal(safePhotoUrl(bad), "", String(bad).slice(0, 30));
  }
});

test("profileChips: id, idioma, Premium y Admin en ese orden", () => {
  const chips = profileChips({ id: 12345, language_code: "es", is_premium: true, is_admin: true });
  assert.deepEqual(chips.map((c) => c.key), ["id", "lang", "premium", "admin"]);
  assert.equal(chips[0].text, "ID 12345");
  assert.equal(chips[1].text, "Español");
  assert.equal(chips[2].tone, "accent");
  assert.equal(chips[3].tone, "accent");
});

test("profileChips: usuario normal sin extras y datos inválidos", () => {
  assert.deepEqual(profileChips({ id: 7, is_premium: false, is_admin: false }).map((c) => c.key), ["id"]);
  assert.deepEqual(profileChips({ id: "7", is_admin: "true" }), []); // nada de truthy: solo true exacto e id entero
  assert.deepEqual(profileChips(null), []);
});
