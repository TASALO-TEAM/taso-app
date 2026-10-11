import assert from "node:assert/strict";
import test from "node:test";

import { parse, parseInline, safeImageUrl, safeLinkUrl } from "../../static/js/modules/markdown.js";

/** Todos los nodos (bloques e inlines) del árbol, en orden. */
function walk(nodes, out = []) {
  for (const n of nodes) {
    out.push(n);
    for (const key of ["children", "sub"]) if (Array.isArray(n[key])) walk(n[key], out);
    if (Array.isArray(n.items)) for (const it of n.items) walk([{ type: "item", children: it.inline, sub: it.sub }], out);
    if (Array.isArray(n.head)) for (const c of n.head) walk(c, out);
    if (Array.isArray(n.rows)) for (const r of n.rows) for (const c of r) walk(c, out);
  }
  return out;
}
const types = (md) => new Set(walk(parse(md)).map((n) => n.type));
const texts = (md) => walk(parse(md)).filter((n) => n.type === "text").map((n) => n.text).join("");

// ---------- URLs ----------

test("enlaces: solo http y https", () => {
  assert.equal(safeLinkUrl("https://ecency.com/@tasalo"), "https://ecency.com/@tasalo");
  assert.equal(safeLinkUrl("http://ejemplo.com/a"), "http://ejemplo.com/a");
  for (const bad of [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\tscript:alert(1)", " javascript:alert(1)", "\u0001javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd", "tg://resolve?domain=x",
    "mailto:a@b.com", "//evil.com/x", "/ruta/relativa", "ejemplo.com", "", null, undefined, 42,
    "https://banco.com@sitio-malo.com/", "https://u:p@host.com/", "https://con espacio.com/", "https://" + "a".repeat(3000),
  ]) {
    assert.equal(safeLinkUrl(bad), null, `debe rechazar ${JSON.stringify(bad)}`);
  }
});

test("imágenes: solo https (la http y data: no se cargan)", () => {
  assert.equal(safeImageUrl("https://i.ecency.com/a.png"), "https://i.ecency.com/a.png");
  for (const bad of ["http://i.ecency.com/a.png", "data:image/svg+xml;base64,PHN2Zz4=", "javascript:alert(1)", "//x.com/a.png", "blob:https://x.com/1"]) {
    assert.equal(safeImageUrl(bad), null, bad);
  }
});

// ---------- Sanitización dentro del texto ----------

test("HTML crudo se queda como texto: ni script ni iframe ni onerror se convierten en nodos", () => {
  const md = '<script>alert(1)</script>\n\n<iframe src="javascript:alert(1)"></iframe>\n\n<img src=x onerror=alert(1)>';
  const kinds = types(md);
  assert.deepEqual([...kinds].sort(), ["paragraph", "text"]);
  assert.ok(!kinds.has("link") && !kinds.has("image"));
  const all = texts(md);
  assert.ok(all.includes("<script>alert(1)</script>"));
  assert.ok(all.includes('<iframe src="javascript:alert(1)"></iframe>'));
  assert.ok(all.includes("<img src=x onerror=alert(1)>"));
});

test("una URL https dentro de una etiqueta cruda solo es un enlace con su dirección visible", () => {
  const nodes = walk(parse('<iframe src="https://evil.com"></iframe>'));
  assert.ok(!nodes.some((n) => n.type === "image"));
  for (const link of nodes.filter((n) => n.type === "link")) {
    assert.equal(link.children[0].text, "https://evil.com", "el texto del enlace es la dirección real");
  }
});

test("[texto](javascript:…) queda como texto sin enlace", () => {
  for (const url of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "vbscript:x"]) {
    const nodes = walk(parse(`[pulsa aquí](${url})`));
    assert.ok(!nodes.some((n) => n.type === "link"), url);
    assert.equal(nodes.filter((n) => n.type === "text").map((n) => n.text).join(""), "pulsa aquí");
  }
});

test("imagen http o data: no genera nodo de imagen; se muestra su texto alternativo", () => {
  for (const url of ["http://x.com/a.png", "data:image/png;base64,AAAA"]) {
    const nodes = walk(parse(`![descripción](${url})`));
    assert.ok(!nodes.some((n) => n.type === "image"), url);
    assert.equal(nodes.filter((n) => n.type === "text").map((n) => n.text).join(""), "descripción");
  }
});

test("imagen https sí; imagen con enlace https también (patrón común de Hive)", () => {
  const img = walk(parse("![foto](https://i.ecency.com/a.png)")).find((n) => n.type === "image");
  assert.deepEqual(img, { type: "image", url: "https://i.ecency.com/a.png", alt: "foto" });
  const nodes = walk(parse("[![foto](https://i.ecency.com/a.png)](https://ecency.com/x)"));
  const link = nodes.find((n) => n.type === "link");
  assert.equal(link.url, "https://ecency.com/x");
  assert.ok(link.children.some((n) => n.type === "image"));
});

test("enlace con título opcional y con paréntesis en la URL", () => {
  const nodes = walk(parse('[a](https://x.com/p "título") [b](https://es.wikipedia.org/wiki/Cuba_(isla))'));
  const links = nodes.filter((n) => n.type === "link");
  assert.deepEqual(links.map((l) => l.url), ["https://x.com/p", "https://es.wikipedia.org/wiki/Cuba_(isla)"]);
});

test("URL suelta se vuelve enlace sin la puntuación final; @usuario enlaza a Ecency; un correo no", () => {
  const links = walk(parse("Mira https://ecency.com/a, y @tasalo. Escribe a x@tasalo.com")).filter((n) => n.type === "link");
  assert.deepEqual(links.map((l) => l.url), ["https://ecency.com/a", "https://ecency.com/@tasalo"]);
  assert.equal(links[0].children[0].text, "https://ecency.com/a");
});

// ---------- Estructura ----------

test("títulos, párrafos, separador y saltos de línea", () => {
  const blocks = parse("# Uno\n\nlínea a\nlínea b\n\n---\n\n### Tres");
  assert.deepEqual(blocks.map((b) => b.type), ["heading", "paragraph", "hr", "heading"]);
  assert.equal(blocks[0].level, 1);
  assert.equal(blocks[3].level, 3);
  assert.deepEqual(blocks[1].children.map((n) => n.type), ["text", "br", "text"]);
});

test("#etiqueta sin espacio no es un título", () => {
  assert.deepEqual(parse("#cuba #tasas").map((b) => b.type), ["paragraph"]);
});

test("énfasis: negrita, cursiva, tachado y snake_case intacto", () => {
  const kinds = types("**fuerte** *suave* ~~fuera~~ ***ambos***");
  for (const k of ["strong", "em", "del"]) assert.ok(kinds.has(k), k);
  assert.ok(!types("nombre_de_variable_larga").has("em"));
  assert.equal(texts("2 * 3 * 4"), "2 * 3 * 4");
  assert.ok(!types("** no cierra").has("strong"));
});

test("el código en línea y el bloque de código no se interpretan", () => {
  const blocks = parse("`**x**` y\n\n```js\n**no** [a](https://x.com)\n<b>y</b>\n```");
  assert.equal(blocks[0].children.find((n) => n.type === "code").text, "**x**");
  assert.deepEqual(blocks[1], { type: "code", text: "**no** [a](https://x.com)\n<b>y</b>" });
});

test("listas con y sin orden, y una sublista", () => {
  const [ul] = parse("- a\n- b\n  - b1\n  - b2\n- c");
  assert.equal(ul.type, "ul");
  assert.equal(ul.items.length, 3);
  assert.equal(ul.items[1].sub[0].type, "ul");
  assert.equal(ul.items[1].sub[0].items.length, 2);
  const [ol] = parse("1. uno\n2. dos");
  assert.equal(ol.type, "ol");
  assert.equal(ol.items.length, 2);
});

test("citas, anidadas también", () => {
  const [q] = parse("> uno\n> > dos\n> tres");
  assert.equal(q.type, "quote");
  assert.ok(q.children.length >= 1);
  assert.ok(types("> > > profunda").has("quote"));
});

test("tabla", () => {
  const [t] = parse("| A | B |\n| --- | :-: |\n| 1 | **2** |\n| solo uno |");
  assert.equal(t.type, "table");
  assert.equal(t.head.length, 2);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[1].length, 2, "una fila corta se completa");
  assert.ok(t.rows[0][1].some((n) => n.type === "strong"));
});

test("escapes de Markdown", () => {
  assert.equal(texts("\\*no cursiva\\* y \\[no enlace\\]"), "*no cursiva* y [no enlace]");
});

// ---------- Robustez ----------

test("entradas raras no lanzan", () => {
  for (const v of [null, undefined, 42, {}, "", "\0\0", "\r\n\r\n", "[", "![", "![](", "[a](", "`", "```", "|", "| a |\n|"]) {
    assert.doesNotThrow(() => parse(v), String(v));
  }
  assert.deepEqual(parse(null), []);
});

test("anidación extrema no desborda la pila", () => {
  assert.doesNotThrow(() => parse(">".repeat(5000) + " x"));
  assert.doesNotThrow(() => parse("*".repeat(5000)));
  assert.doesNotThrow(() => parse(Array.from({ length: 3000 }, (_, i) => " ".repeat(i * 2) + "- x").join("\n")));
  assert.doesNotThrow(() => parseInline("[".repeat(3000) + "a" + "]".repeat(3000)));
});

test("texto adversarial se analiza rápido (sin explosión cuadrática)", () => {
  const started = Date.now();
  parse("*a ".repeat(40000));
  parse("[a](".repeat(20000));
  parse("_".repeat(100000));
  parse("`".repeat(50000));
  assert.ok(Date.now() - started < 5000, `tardó ${Date.now() - started} ms`);
});

test("un post de verdad con todo mezclado", () => {
  const md = [
    "# TASALO Spotlight",
    "",
    "El **dólar** sube. Fuente: [El Toque](https://eltoque.com) y @tasalo.",
    "",
    "![gráfico](https://i.ecency.com/g.png)",
    "",
    "| Moneda | Tasa |",
    "| --- | --- |",
    "| USD | 520 |",
    "",
    "- uno",
    "- dos",
    "",
    "> cita",
  ].join("\n");
  const kinds = types(md);
  for (const k of ["heading", "paragraph", "strong", "link", "image", "table", "ul", "quote"]) assert.ok(kinds.has(k), k);
});
