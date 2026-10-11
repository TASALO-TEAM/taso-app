import assert from "node:assert/strict";
import test from "node:test";

import {
  ACCOUNTS, blogBanner, DEFAULT_ACCOUNT, normalizeAccount, postDate, spotlightLabel, spotlightOf, validPosts,
} from "../../static/js/modules/blog.js";

const NOW = Date.parse("2026-10-10T16:00:00Z"); // 12:00 en Cuba (UTC-4 en octubre)
const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString();

test("cuentas: solo las dos del plan y una desconocida cae a @tasalo", () => {
  assert.deepEqual(ACCOUNTS.map((a) => a.id), ["tasalo", "ersusoficial"]);
  assert.equal(normalizeAccount("ersusoficial"), "ersusoficial");
  for (const bad of ["otro", "", null, undefined, 3, "TASALO"]) assert.equal(normalizeAccount(bad), DEFAULT_ACCOUNT);
});

test("postDate: fecha de Cuba, con el mes en minúscula y sin depender de la zona del teléfono", () => {
  assert.equal(postDate("2026-10-10T14:27:09+00:00"), "10 oct 2026");
  // 02:00 UTC del 11 aún es 10 en Cuba (UTC-4)
  assert.equal(postDate("2026-10-11T02:00:00+00:00"), "10 oct 2026");
  assert.equal(postDate("2026-01-05T12:00:00+00:00"), "05 ene 2026");
  assert.equal(postDate(null), "");
  assert.equal(postDate("basura"), "");
});

const SP = (permlink, created) => ({ permlink, created, spotlight: true, title: "t", author: "tasalo" });
const NORMAL = (permlink, created) => ({ permlink, created, spotlight: false, title: "t", author: "tasalo" });

test("spotlightOf: el más reciente, aunque la lista venga desordenada; null si no hay", () => {
  const posts = [NORMAL("a", "2026-10-10T15:00:00+00:00"), SP("sp-8", "2026-10-08T12:00:00+00:00"), SP("sp-10", "2026-10-10T14:00:00+00:00"), SP("sp-9", "2026-10-09T12:00:00+00:00")];
  assert.equal(spotlightOf(posts).permlink, "sp-10");
  assert.equal(spotlightOf([NORMAL("a", "2026-10-10T15:00:00+00:00")]), null);
  assert.equal(spotlightOf([]), null);
  assert.equal(spotlightOf(null), null);
  assert.equal(spotlightOf([null, { spotlight: "true" }]), null, "solo vale spotlight === true");
});

test("spotlightLabel: «de hoy» solo si es de hoy en Cuba", () => {
  assert.equal(spotlightLabel(SP("x", "2026-10-10T14:27:09+00:00"), NOW), "Spotlight de hoy");
  assert.equal(spotlightLabel(SP("x", "2026-10-09T13:10:57+00:00"), NOW), "Último Spotlight");
  assert.equal(spotlightLabel(SP("x", null), NOW), "Último Spotlight");
  assert.equal(spotlightLabel(null, NOW), "Último Spotlight");
  // las 02:30 UTC del 10 son las 22:30 del 9 en Cuba: aún no es «hoy» si ahora es el 10 por la mañana
  assert.equal(spotlightLabel(SP("x", "2026-10-10T02:30:00+00:00"), NOW), "Último Spotlight");
});

test("blogBanner: sin fallos no avisa, aunque los datos tengan horas", () => {
  assert.equal(blogBanner({ fetchedAt: ago(500), now: NOW }), null);
  assert.equal(blogBanner({ fetchedAt: null, now: NOW }), null);
});

test("blogBanner: sin conexión > no se pudo actualizar, con la edad real si se conoce", () => {
  assert.deepEqual(blogBanner({ fetchedAt: ago(5), now: NOW, offline: true, apiError: true }), { text: "Sin conexión · datos de hace 5 min", error: true });
  assert.deepEqual(blogBanner({ fetchedAt: ago(125), now: NOW, apiError: true }), { text: "No se pudo actualizar · datos de hace 2 h", error: true });
  assert.deepEqual(blogBanner({ fetchedAt: ago(5), now: NOW, stale: true }), { text: "No se pudo actualizar · datos de hace 5 min", error: true });
  assert.deepEqual(blogBanner({ fetchedAt: null, now: NOW, stale: true }), { text: "No se pudo actualizar", error: true });
});

test("validPosts: descarta lo que no parece un post", () => {
  const ok = { permlink: "a", title: "T", author: "tasalo" };
  assert.deepEqual(validPosts({ posts: [ok, null, {}, { permlink: "b" }, "x", 3] }), [ok]);
  for (const bad of [null, undefined, {}, { posts: "no" }, []]) assert.deepEqual(validPosts(bad), []);
});
