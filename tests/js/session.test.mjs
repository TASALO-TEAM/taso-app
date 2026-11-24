import test from "node:test";
import assert from "node:assert/strict";
import { isSignedIn, loginNote, needsLogin, session, setSession } from "../../static/js/modules/session.js";

test("sin sesión: visitante, y solo lo privado pide entrar", () => {
  setSession(null);
  assert.equal(isSignedIn(), false);
  for (const name of ["perfil", "avisos", "estadisticas", "admin"]) assert.equal(needsLogin(name), true, name);
  for (const name of ["tasas", "mercado", "calculadora", "blog", "ajustes"]) assert.equal(needsLogin(name), false, name);
});

test("con sesión nada pide entrar y se recuerda cómo entró", () => {
  setSession({ user: { id: 7 }, via: "web" });
  assert.equal(isSignedIn(), true);
  assert.equal(session().via, "web");
  assert.equal(needsLogin("perfil"), false);
  setSession({ user: { id: 7 }, via: "cualquier-cosa" });
  assert.equal(session().via, "telegram", "solo 'web' cuenta como web");
});

test("respuestas raras no dan sesión", () => {
  for (const bad of [undefined, {}, { user: null }, "x"]) {
    setSession(bad);
    assert.equal(isSignedIn(), false);
  }
});

test("needsLogin acepta el estado explícito", () => {
  assert.equal(needsLogin("perfil", true), false);
  assert.equal(needsLogin("perfil", false), true);
});

test("loginNote: solo valores conocidos", () => {
  assert.match(loginNote("?login=error"), /No se pudo iniciar sesión/);
  assert.match(loginNote("?x=1&login=busy"), /demasiados intentos/);
  assert.match(loginNote("?login=off"), /Telegram/);
  for (const q of ["", "?login=", "?login=hack", "?login=__proto__", "?login=constructor", null, undefined]) assert.equal(loginNote(q), null, String(q));
});
