import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../../static/js/modules/markdown.js";
import {
  bodyMarkdown, latestId, normalizeMessages, readSeen, SEEN_KEY, telegramToMarkdown, unreadCount, unreadLabel, writeSeen,
} from "../../static/js/modules/messages.js";

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
};

test("normalizeMessages: válidos, ordenados por id y acotados", () => {
  const out = normalizeMessages([
    { id: 2, title: " Viejo ", body: "x", format: "telegram", created_at: "2026-10-12T10:00:00Z" },
    { id: 9, title: "Nuevo", body: "", format: "otro", created_at: "basura" },
  ]);
  assert.deepEqual(out.map((m) => m.id), [9, 2]);
  assert.equal(out[1].title, "Viejo");
  assert.equal(out[0].format, "markdown", "formato raro → markdown");
  assert.equal(out[0].createdAt, null);
  assert.equal(out[1].createdAt, "2026-10-12T10:00:00.000Z");
});

test("normalizeMessages: basura fuera, sin NaN ni ids falsos", () => {
  const bad = [null, 1, "x", [], {}, { id: "3", title: "t" }, { id: 0, title: "t" }, { id: -4, title: "t" }, { id: 1.5, title: "t" }, { id: 5, title: "", body: "  " }, { id: NaN, title: "t" }];
  assert.deepEqual(normalizeMessages(bad), []);
  assert.deepEqual(normalizeMessages(null), []);
  assert.deepEqual(normalizeMessages({ not: "list" }), []);
  const many = normalizeMessages(Array.from({ length: 50 }, (_, i) => ({ id: i + 1, title: "t" })));
  assert.equal(many.length, 20);
  assert.equal(many[0].id, 50);
  const long = normalizeMessages([{ id: 1, title: "T".repeat(500), body: "B".repeat(9000) }])[0];
  assert.equal(long.title.length, 120);
  assert.equal(long.body.length, 4096);
});

test("telegramToMarkdown: *negrita* y _cursiva_ legacy → Markdown estándar", () => {
  assert.equal(telegramToMarkdown("Hola *mundo* y _tú_."), "Hola **mundo** y *tú*.");
  assert.equal(telegramToMarkdown("*Título*\nlínea _dos_"), "**Título**\nlínea *dos*");
});

test("telegramToMarkdown: no rompe snake_case, enlaces, código ni multiplicaciones", () => {
  assert.equal(telegramToMarkdown("usa mi_variable_larga aquí"), "usa mi_variable_larga aquí");
  assert.equal(telegramToMarkdown("[doc](https://x.com/a_b_c)"), "[doc](https://x.com/a_b_c)");
  assert.equal(telegramToMarkdown("2 * 3 * 4"), "2 * 3 * 4");
  assert.equal(telegramToMarkdown("ya **negrita** estándar"), "ya **negrita** estándar");
  assert.equal(telegramToMarkdown(null), "");
  assert.equal(telegramToMarkdown(42), "");
});

test("el resultado se parsea a negrita y cursiva reales", () => {
  const nodes = parse(bodyMarkdown({ format: "telegram", body: "Hola *mundo* y _tú_" }))[0].children;
  assert.ok(nodes.some((n) => n.type === "strong"));
  assert.ok(nodes.some((n) => n.type === "em"));
});

test("el HTML hostil se queda como texto (el parser nunca lo interpreta)", () => {
  const blocks = parse(bodyMarkdown({ format: "markdown", body: "<img src=x onerror=alert(1)> y <script>alert(1)</script>" }));
  const dump = JSON.stringify(blocks);
  assert.ok(!/"type":"(html|script|image)"/.test(dump));
});

test("unread: cuenta solo lo posterior al último visto", () => {
  const items = normalizeMessages([{ id: 3, title: "a" }, { id: 7, title: "b" }, { id: 9, title: "c" }]);
  assert.equal(unreadCount(items, 0), 3);
  assert.equal(unreadCount(items, 7), 1);
  assert.equal(unreadCount(items, 9), 0);
  for (const bad of [undefined, null, NaN, -1, "7", 1.5]) assert.equal(unreadCount(items, bad), 3, String(bad));
  assert.equal(latestId(items), 9);
  assert.equal(latestId([]), 0);
  assert.equal(unreadLabel(0), "");
  assert.equal(unreadLabel(1), "1 nueva");
  assert.equal(unreadLabel(4), "4 nuevas");
});

test("seen: se guarda sin retroceder y tolera almacenamiento roto", () => {
  const s = mem();
  assert.equal(readSeen(s), 0);
  writeSeen(5, s);
  writeSeen(3, s);
  assert.equal(readSeen(s), 5, "un id menor no pisa a uno mayor");
  writeSeen(NaN, s);
  writeSeen(-2, s);
  writeSeen("9", s);
  assert.equal(readSeen(s), 5);
  s.setItem(SEEN_KEY, "basura");
  assert.equal(readSeen(s), 0);
  const roto = { getItem() { throw new Error("denegado"); }, setItem() { throw new Error("denegado"); } };
  assert.equal(readSeen(roto), 0);
  assert.doesNotThrow(() => writeSeen(4, roto));
});
