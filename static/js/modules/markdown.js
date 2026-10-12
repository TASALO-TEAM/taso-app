// Markdown de los posts de Hive → árbol de nodos. Sin DOM y SIN interpretar HTML nunca.
//
// El servidor ya convirtió el HTML de los posts a Markdown (src/services/blog_text.py). Aquí lo que parezca una
// etiqueta (<script>, <iframe>, <img onerror=…>) se queda como TEXTO: el renderizador (views/blog.js) solo crea
// nodos con textContent. Enlaces: solo http(s) sin usuario:clave. Imágenes: solo https. Todo lo demás se degrada
// a texto, así un post (propio o ajeno, de Hive o pegado) no puede ejecutar nada ni cargar contenido inseguro.

const MAX_INPUT = 150_000; // caracteres; un post real pesa una fracción
const MAX_URL = 2048;
const MAX_DEPTH = 6; // anidación de citas, listas y énfasis
const SCAN_WINDOW = 2000; // hasta dónde se busca el cierre de un énfasis o de un enlace

// ---------- Seguridad de URLs ----------

function parseUrl(raw, protocols) {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL) return null;
  // Espacios o caracteres de control dentro de la URL (p. ej. "java\tscript:") la vuelven sospechosa.
  if (/[\u0000-\u0020\u007f-\u009f]/.test(s)) return null;
  let url;
  try {
    url = new URL(s);
  } catch (_) {
    return null; // relativa o sin esquema
  }
  if (!protocols.includes(url.protocol) || !url.hostname) return null;
  if (url.username || url.password) return null; // https://banco.com@sitio-malo.com
  return url.href;
}

/** Enlace permitido (http o https) → URL normalizada; cualquier otra cosa → null. */
export function safeLinkUrl(raw) {
  return parseUrl(raw, ["https:", "http:"]);
}

/** Imagen permitida (solo https) → URL normalizada; cualquier otra cosa → null. */
export function safeImageUrl(raw) {
  return parseUrl(raw, ["https:"]);
}

// ---------- Inline ----------

const ESCAPABLE = "\\`*_{}[]()#+-.!~|>";
const TARGET = String.raw`\(\s*<?((?:[^\s()<>]|\([^\s()<>]*\))+)>?(?:\s+"[^"]*")?\s*\)`;
const IMAGE_RE = new RegExp(String.raw`^!\[([^\]]*)\]` + TARGET);
const LINK_TARGET_RE = new RegExp("^" + TARGET);
const AUTOLINK_RE = /^https?:\/\/[^\s<>[\]]+/i;
const MENTION_RE = /^@([a-z][a-z0-9-]{1,14}[a-z0-9](?:\.[a-z][a-z0-9-]{1,14}[a-z0-9])*)/;
const isWord = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function pushText(out, text) {
  if (!text) return;
  const last = out[out.length - 1];
  if (last && last.type === "text") last.text += text;
  else out.push({ type: "text", text });
}

/** Cierre de un corchete abierto en `src[start]`; null si no hay (dentro de la ventana). */
function closingBracket(src, start) {
  let depth = 0;
  const end = Math.min(src.length, start + SCAN_WINDOW);
  for (let i = start; i < end; i++) {
    const c = src[i];
    if (c === "\\") i++;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return i;
  }
  return null;
}

/** Cierre de un énfasis: la primera `marker` desde `from` que no abra otra, con contenido que no empiece ni termine en espacio. */
function findClose(src, marker, from) {
  if (from >= src.length || /\s/.test(src[from])) return -1; // el contenido no puede empezar en espacio: no abre
  const single = marker.length === 1;
  const limit = Math.min(src.length, from + SCAN_WINDOW);
  let at = from;
  while (at < limit) {
    const idx = src.indexOf(marker, at);
    if (idx === -1 || idx >= limit) return -1;
    // «*» suelto no cierra si es parte de «**»
    if (single && (src[idx + 1] === marker || src[idx - 1] === marker)) {
      at = idx + 1;
      continue;
    }
    if (idx > from && !/\s/.test(src[idx - 1])) return idx; // contenido no vacío y que no termina en espacio
    at = idx + marker.length;
  }
  return -1;
}

export function parseInline(src, depth = 0) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === "\\" && i + 1 < src.length && ESCAPABLE.includes(src[i + 1])) {
      pushText(out, src[i + 1]);
      i += 2;
      continue;
    }

    if (c === "\n") {
      out.push({ type: "br" });
      i++;
      continue;
    }

    if (c === "`") {
      let run = 1;
      while (src[i + run] === "`") run++;
      const fence = "`".repeat(run);
      const close = src.indexOf(fence, i + run);
      if (close !== -1 && close - i < SCAN_WINDOW) {
        out.push({ type: "code", text: src.slice(i + run, close).replace(/\n/g, " ").trim() });
        i = close + run;
        continue;
      }
      pushText(out, fence);
      i += run;
      continue;
    }

    if (c === "!" && src[i + 1] === "[") {
      const m = IMAGE_RE.exec(src.slice(i, i + SCAN_WINDOW));
      if (m) {
        const url = safeImageUrl(m[2]);
        // Imagen no permitida (http, data:…): se muestra el texto alternativo, nunca se carga.
        if (url) out.push({ type: "image", url, alt: m[1] });
        else pushText(out, m[1]);
        i += m[0].length;
        continue;
      }
    }

    if (c === "[") {
      const close = closingBracket(src, i);
      if (close !== null) {
        const m = LINK_TARGET_RE.exec(src.slice(close + 1, close + 1 + SCAN_WINDOW));
        if (m) {
          const label = src.slice(i + 1, close);
          const url = safeLinkUrl(m[1]);
          const children = depth < MAX_DEPTH ? parseInline(label, depth + 1) : [{ type: "text", text: label }];
          if (url) out.push({ type: "link", url, children });
          else out.push(...children); // enlace no permitido: solo el texto
          i = close + 1 + m[0].length;
          continue;
        }
      }
    }

    if ((c === "h" || c === "H") && !isWord(src[i - 1]) && src.slice(i, i + 4).toLowerCase() === "http") {
      const m = AUTOLINK_RE.exec(src.slice(i, i + MAX_URL));
      if (m) {
        const raw = m[0].replace(/[.,;:!?'")*_~]+$/, "");
        const url = safeLinkUrl(raw);
        if (url) {
          out.push({ type: "link", url, children: [{ type: "text", text: raw }] });
          i += raw.length;
          continue;
        }
      }
    }

    if (c === "@" && !isWord(src[i - 1]) && src[i - 1] !== "@" && src[i - 1] !== "/") {
      const m = MENTION_RE.exec(src.slice(i, i + 40));
      if (m) {
        out.push({ type: "link", url: `https://ecency.com/@${m[1]}`, children: [{ type: "text", text: `@${m[1]}` }] });
        i += m[0].length;
        continue;
      }
    }

    if ((c === "*" || c === "~" || c === "_") && depth < MAX_DEPTH) {
      const triple = c === "*" && src.startsWith("***", i);
      const marker = triple ? "***" : src.startsWith(c + c, i) ? c + c : c;
      const underscoreOk = c !== "_" || (!isWord(src[i - 1]) && !/\s/.test(src[i + marker.length] || " "));
      if ((c !== "~" || marker === "~~") && underscoreOk) {
        const close = findClose(src, marker, i + marker.length);
        const closeOk = c !== "_" || !isWord(src[close + marker.length]);
        if (close !== -1 && closeOk) {
          const inner = parseInline(src.slice(i + marker.length, close), depth + 1);
          if (marker === "***") out.push({ type: "strong", children: [{ type: "em", children: inner }] });
          else if (marker === "~~") out.push({ type: "del", children: inner });
          else if (marker.length === 2) out.push({ type: "strong", children: inner });
          else out.push({ type: "em", children: inner });
          i = close + marker.length;
          continue;
        }
      }
    }

    pushText(out, c);
    i++;
  }
  return out;
}

// ---------- Bloques ----------

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/;
const RULE_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const UL_RE = /^(\s*)[-*+]\s+(.*)$/;
const OL_RE = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const isRule = (line) => RULE_RE.test(line);
const isBlockStart = (line) =>
  FENCE_RE.test(line) || HEADING_RE.test(line) || isRule(line) || QUOTE_RE.test(line) || UL_RE.test(line) || OL_RE.test(line);

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cell = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cell += "|";
      i++;
    } else if (s[i] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += s[i];
  }
  cells.push(cell.trim());
  return cells;
}

/** Alineación de cada columna según la fila separadora (`:--`, `:-:`, `--:`); siempre `cols` valores. */
function tableAligns(sepLine, cols) {
  const out = splitRow(sepLine).map((c) => {
    const left = c.startsWith(":");
    const right = c.endsWith(":");
    return left && right ? "center" : right ? "end" : "start";
  });
  while (out.length < cols) out.push("start");
  return out.slice(0, cols);
}

/** Cantidad de caracteres visibles de una celda (los nodos inline no se interpretan: solo se cuenta texto). */
export function inlineLength(nodes) {
  let n = 0;
  for (const node of nodes || []) {
    if (typeof node.text === "string") n += node.text.length;
    else if (node.type === "link" || node.type === "strong" || node.type === "em" || node.type === "del") n += inlineLength(node.children);
  }
  return n;
}

export const TABLE_MIN_CHARS = 5;
export const TABLE_MAX_CHARS = 40;

/**
 * Ancho de cada columna en caracteres: la celda más larga de la columna (cabecera incluida), entre 5 y 40.
 * Es el mismo criterio que la app de Android, para que la tabla no dependa del ancho de la pantalla:
 * si no cabe, se desplaza en horizontal; si una celda es más larga que el máximo, su texto se envuelve.
 */
export function tableColumnChars(table) {
  return table.head.map((headCell, column) => {
    let longest = inlineLength(headCell);
    for (const row of table.rows) longest = Math.max(longest, inlineLength(row[column]));
    return Math.min(TABLE_MAX_CHARS, Math.max(TABLE_MIN_CHARS, longest));
  });
}

function parseList(lines, start, depth) {
  const first = UL_RE.exec(lines[start]) || OL_RE.exec(lines[start]);
  const ordered = Boolean(OL_RE.exec(lines[start])) && !UL_RE.exec(lines[start]);
  const baseIndent = first[1].length;
  const items = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) break;
    const ul = UL_RE.exec(line);
    const ol = ul ? null : OL_RE.exec(line);
    const m = ul || ol;
    if (m) {
      const indent = m[1].length;
      const text = ul ? m[2] : m[3];
      if (indent <= baseIndent + 1) {
        if (Boolean(ol) !== ordered) break; // cambia el tipo de lista: es otra lista
        items.push({ text, sub: [] });
      } else if (items.length) {
        items[items.length - 1].sub.push(line); // sublista: se analiza aparte, sin sangría base
      } else break;
    } else if (items.length && (/^\s{2,}\S/.test(line) || !isBlockStart(line))) {
      const item = items[items.length - 1];
      if (item.sub.length) item.sub.push(line);
      else item.text += "\n" + line.trim();
    } else break;
    i++;
  }
  const nodes = items.map((it) => ({
    inline: parseInline(it.text),
    sub: it.sub.length ? parseBlocks(dedent(it.sub), depth + 1) : [],
  }));
  return [{ type: ordered ? "ol" : "ul", items: nodes }, i];
}

function dedent(lines) {
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut));
}

function parseBlocks(lines, depth = 0) {
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const mark = fence[1];
      const body = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(mark[0].repeat(mark.length)) && /^\s*[`~]+\s*$/.test(lines[i]))) {
        body.push(lines[i]);
        i++;
      }
      i++; // cierre (o fin del texto)
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, children: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (isRule(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    if (QUOTE_RE.test(line) && depth < MAX_DEPTH) {
      const inner = [];
      while (i < lines.length && lines[i].trim() && QUOTE_RE.test(lines[i])) {
        inner.push(QUOTE_RE.exec(lines[i])[1]);
        i++;
      }
      blocks.push({ type: "quote", children: parseBlocks(inner, depth + 1) });
      continue;
    }

    if ((UL_RE.test(line) || OL_RE.test(line)) && depth < MAX_DEPTH) {
      const [node, next] = parseList(lines, i, depth);
      blocks.push(node);
      i = next;
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = splitRow(line).map((c) => parseInline(c));
      const aligns = tableAligns(lines[i + 1], head.length);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        const cells = splitRow(lines[i]).map((c) => parseInline(c));
        while (cells.length < head.length) cells.push([]);
        rows.push(cells.slice(0, head.length));
        i++;
      }
      blocks.push({ type: "table", head, rows, aligns });
      continue;
    }

    // Párrafo: hasta una línea en blanco o el inicio de otro bloque.
    const para = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ type: "paragraph", children: parseInline(para.map((l) => l.trim()).join("\n")) });
  }
  return blocks;
}

/** Markdown → bloques. Nunca lanza: lo que no entiende queda como texto (y si algo raro lo rompe, un párrafo con el texto crudo). */
export function parse(markdown) {
  const text = typeof markdown === "string" ? markdown.slice(0, MAX_INPUT) : "";
  try {
    return parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"));
  } catch (_) {
    return text ? [{ type: "paragraph", children: [{ type: "text", text }] }] : [];
  }
}
