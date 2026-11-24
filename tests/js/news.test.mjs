import assert from "node:assert/strict";
import test from "node:test";

import { MAX_NEWS, TONES, cleanNews, currentSlide, newsMeta, newsTone, slideLabel, slideStatus } from "../../static/js/modules/news.js";

const good = (n, extra = {}) => ({
  title: `Titular ${n}`,
  url: `https://a.example/${n}`,
  source: "BeInCrypto",
  lang: "es",
  published: "2026-11-23T10:00:00Z",
  image: null,
  ...extra,
});

test("cleanNews: entrada que no es lista -> vacia", () => {
  for (const bad of [null, undefined, {}, "x", 5]) assert.deepEqual(cleanNews(bad), []);
});

test("cleanNews: normaliza, convierte la fecha a milisegundos y conserva el orden", () => {
  const out = cleanNews([good(1), good(2, { published: "2026-11-23T08:00:00Z", lang: "en", image: "https://assets.beincrypto.com/a.jpg" })]);
  assert.equal(out.length, 2);
  assert.equal(out[0].published, Date.parse("2026-11-23T10:00:00Z"));
  assert.deepEqual([out[1].lang, out[1].image], ["en", "https://assets.beincrypto.com/a.jpg"]);
});

test("cleanNews: descarta titulares vacios, enlaces no https, fechas rotas y repetidos", () => {
  const out = cleanNews([
    good(1, { title: "   " }),
    good(2, { url: "http://a.example/2" }),
    good(3, { url: "javascript:alert(1)" }),
    good(4, { url: "https://user@a.example/4" }),
    good(5, { published: "ayer" }),
    good(6, { published: 12345 }),
    good(7, { title: "x".repeat(201) }),
    null,
    "texto",
    good(8),
    good(8, { title: "repetida" }),
  ]);
  assert.deepEqual(out.map((n) => n.title), ["Titular 8"]);
});

test("cleanNews: imagen no https se ignora (la noticia se queda sin imagen) y la lengua rara pasa a es", () => {
  const [n] = cleanNews([good(1, { image: "http://x.example/a.jpg", lang: "fr" })]);
  assert.equal(n.image, null);
  assert.equal(n.lang, "es");
});

test("cleanNews: como mucho MAX_NEWS", () => {
  const many = Array.from({ length: MAX_NEWS + 4 }, (_, i) => good(i));
  assert.equal(cleanNews(many).length, MAX_NEWS);
});

test("newsMeta: fuente y hora relativa; sin fuente, solo la hora", () => {
  const now = Date.parse("2026-11-23T12:00:00Z");
  const [n] = cleanNews([good(1)]);
  assert.equal(newsMeta(n, now), "BeInCrypto · hace 2 h");
  assert.equal(newsMeta({ ...n, source: "" }, now), "hace 2 h");
});

test("newsTone: estable, dentro de rango y no depende de mayusculas raras del texto vacio", () => {
  assert.equal(newsTone("BeInCrypto"), newsTone("BeInCrypto"));
  for (const s of ["BeInCrypto", "CriptoNoticias", "reuters.com", "", null, undefined, "😀"]) {
    const t = newsTone(s);
    assert.ok(Number.isInteger(t) && t >= 0 && t < TONES, `${s} -> ${t}`);
  }
});

test("currentSlide: la de inicio mas cercana al desplazamiento; -1 sin diapositivas", () => {
  const lefts = [0, 300, 600, 900];
  assert.equal(currentSlide(lefts, 0), 0);
  assert.equal(currentSlide(lefts, 140), 0);
  assert.equal(currentSlide(lefts, 160), 1);
  assert.equal(currentSlide(lefts, 5000), 3);
  assert.equal(currentSlide([], 10), -1);
});

test("etiquetas de posicion", () => {
  assert.equal(slideLabel(0, 8), "1 de 8");
  assert.equal(slideStatus(3, 8), "Noticia 4 de 8");
});
