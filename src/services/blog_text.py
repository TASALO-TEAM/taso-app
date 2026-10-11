"""Limpieza del texto de los posts de Hive (puerto de ``BlogText.kt`` de taso-android).

Los posts nuevos de Ecency son Markdown, pero los de otras apps (y los antiguos) pueden traer HTML: se
convierte a Markdown (tablas, citas, listas, enlaces, imágenes, código, vídeos embebidos como enlace) o se
quita (scripts, estilos, etiquetas de maquetación). Los bloques de código Markdown no se tocan y una
``<etiqueta>`` que no sea HTML conocido se deja como texto.

La salida es Markdown estándar. El cliente NUNCA lo interpreta como HTML (``modules/markdown.js`` construye
nodos de DOM), así que lo que quede sin convertir se ve como texto, no se ejecuta.
"""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urlsplit

_I = re.I
_S = re.S | re.I

# Un post de Hive pesa unos KB; más de esto no es un post, y las expresiones con «.*?» no deben recorrer MB.
MAX_BODY_CHARS = 200_000

_FENCE = re.compile(r"```.*?```", re.S)

_TAGS = (
    "p|div|span|a|b|i|u|s|em|strong|br|hr|h[1-6]|ul|ol|li|table|thead|tbody|tfoot|tr|th|td|caption|colgroup|col|"
    "blockquote|pre|code|center|img|sup|sub|del|ins|strike|details|summary|iframe|video|audio|source|embed|"
    "font|figure|figcaption|section|article|small|big|mark|cite|dl|dt|dd|abbr|kbd|var|samp|tt|picture|nav|"
    "header|footer|main|aside|label|noscript|script|style|head|body|html|meta|link|title|svg|math|canvas|"
    "object|param|track|wbr"
)

# Marcas privadas (no pueden aparecer en un post) para guardar bloques mientras se limpia el resto.
_STASH = "\ue000"
_QUOTE_OPEN = "\ue001"
_QUOTE_CLOSE = "\ue002"

_COMMENT = re.compile(r"<!--.*?-->", re.S)
_SCRIPT_STYLE = re.compile(r"<(script|style|head|noscript|svg|canvas)\b[^>]*>.*?</\1>", _S)
_PRE = re.compile(r"<pre\b[^>]*>(.*?)</pre>", _S)
_TABLE = re.compile(r"<table\b[^>]*>(.*?)</table>", _S)
_TABLE_ROW = re.compile(r"<tr\b[^>]*>(.*?)</tr>", _S)
_TABLE_CELL = re.compile(r"<(?:th|td)\b[^>]*>(.*?)</(?:th|td)>", _S)
_SUMMARY_TAG = re.compile(r"<summary\b[^>]*>(.*?)</summary>", _S)
_EMBED = re.compile(
    r"""<(?:iframe|video|audio|source|embed)\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>(?:\s*</(?:iframe|video|audio|embed)>)?""",
    _S,
)
_AUTOLINK = re.compile(r"<(https?://[^>\s]+)>")
_LINKED_IMG = re.compile(r"<a\b[^>]*>\s*(<img\b[^>]*>)\s*</a>", _S)
_IMG = re.compile(r"""<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>""", _I)
_ALT_ATTR = re.compile(r"""\balt\s*=\s*["']([^"']*)["']""", _I)
_LINK = re.compile(r"""<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>""", _S)
_HEADING = re.compile(r"<h([1-6])\b[^>]*>(.*?)</h\1>", _S)
_BOLD = re.compile(r"<(?:b|strong)\b[^>]*>(.*?)</(?:b|strong)>", _S)
_ITALIC = re.compile(r"<(?:i|em)\b[^>]*>(.*?)</(?:i|em)>", _S)
_STRIKE = re.compile(r"<(?:del|s|strike)\b[^>]*>(.*?)</(?:del|s|strike)>", _S)
_INLINE_CODE = re.compile(r"<code\b[^>]*>(.*?)</code>", _S)
_BLOCKQUOTE = re.compile(r"<blockquote\b[^>]*>", _I)
_BLOCKQUOTE_END = re.compile(r"</blockquote>", _I)
_ORDERED_LIST = re.compile(r"<ol\b[^>]*>(.*?)</ol>", _S)
_LINE_BREAK = re.compile(r"<br\s*/?>", _I)
_RULE = re.compile(r"<hr\b[^>]*>", _I)
_LIST_ITEM = re.compile(r"<li\b[^>]*>", _I)
_LIST_ITEM_END = re.compile(r"</li>", _I)
_BLOCK_END = re.compile(r"</(?:p|div|ul|ol|center|table|tr|dd|dt|figure|figcaption|section|article|details)>", _I)
_ANY_TAG = re.compile(r"</?(?:" + _TAGS + r")\b[^>\n]*>", _I)
_MANY_BLANK_LINES = re.compile(r"\n{3,}")
_WHITESPACE = re.compile(r"\s+")
_ENTITY = re.compile(r"&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);")
_STASHED = re.compile(_STASH + r"(\d+)" + _STASH)
_YOUTUBE_EMBED = re.compile(r"^https://(?:www\.)?youtube(?:-nocookie)?\.com/embed/([\w-]+)")
_INNERMOST_QUOTE = re.compile(_QUOTE_OPEN + "((?:(?!" + _QUOTE_OPEN + ").)*?)" + _QUOTE_CLOSE, re.S)

_NAMED_ENTITIES = {
    "amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " ",
    "hellip": "\u2026", "ndash": "\u2013", "mdash": "\u2014",
}


def clean(body: str) -> str:
    """Cuerpo → Markdown estándar: HTML convertido o quitado; el código no se toca."""
    text = (body or "")[:MAX_BODY_CHARS].replace("\r\n", "\n")
    out: list[str] = []
    last = 0
    for m in _FENCE.finditer(text):
        out.append(_clean_html(text[last:m.start()]))
        out.append(m.group(0))
        last = m.end()
    out.append(_clean_html(text[last:]))
    return "".join(out).strip()


def _clean_html(chunk: str) -> str:
    if "<" not in chunk and "&" not in chunk:
        return chunk

    code: list[str] = []

    def stash_pre(m: re.Match) -> str:
        code.append("```\n" + _decode_entities(_ANY_TAG.sub("", m.group(1))).strip("\n") + "\n```")
        return f"\n\n{_STASH}{len(code) - 1}{_STASH}\n\n"

    t = _COMMENT.sub("", chunk)
    t = _SCRIPT_STYLE.sub("", t)
    t = _PRE.sub(stash_pre, t)
    t = _TABLE.sub(lambda m: _table_to_markdown(m.group(1)), t)
    t = _SUMMARY_TAG.sub(lambda m: f"\n\n**{_strip_tags(m.group(1))}**\n\n", t)
    t = _EMBED.sub(lambda m: _embed_link(m.group(1)), t)
    t = _AUTOLINK.sub(lambda m: f"[{m.group(1)}]({m.group(1)})", t)
    t = _LINKED_IMG.sub(lambda m: m.group(1), t)
    t = _IMG.sub(lambda m: "\n\n" + _image_markdown(m) + "\n\n", t)
    t = _LINK.sub(_link_markdown, t)
    t = _HEADING.sub(lambda m: "\n\n" + "#" * int(m.group(1)) + " " + m.group(2).strip() + "\n\n", t)
    t = _inline_formatting(t)
    t = _BLOCKQUOTE.sub("\n\n" + _QUOTE_OPEN, t)
    t = _BLOCKQUOTE_END.sub(_QUOTE_CLOSE + "\n\n", t)

    def number_items(m: re.Match) -> str:
        n = [0]

        def item(_: re.Match) -> str:
            n[0] += 1
            return f"\n{n[0]}. "

        return _LIST_ITEM.sub(item, m.group(1))

    t = _ORDERED_LIST.sub(number_items, t)
    t = _LIST_ITEM.sub("\n- ", t)
    t = _LIST_ITEM_END.sub("", t)
    t = _LINE_BREAK.sub("\n", t)
    t = _RULE.sub("\n\n---\n\n", t)
    t = _BLOCK_END.sub("\n\n", t)
    t = _ANY_TAG.sub("", t)
    t = _decode_entities(t)
    t = _apply_quotes(t)
    t = _STASHED.sub(lambda m: code[int(m.group(1))], t)
    return _MANY_BLANK_LINES.sub("\n\n", t)


def _inline_formatting(text: str) -> str:
    t = _BOLD.sub(lambda m: f"**{m.group(1)}**", text)
    t = _ITALIC.sub(lambda m: f"*{m.group(1)}*", t)
    t = _STRIKE.sub(lambda m: f"~~{m.group(1)}~~", t)
    return _INLINE_CODE.sub(lambda m: f"`{m.group(1)}`", t)


def _strip_tags(text: str) -> str:
    return _decode_entities(_ANY_TAG.sub("", text)).strip()


def _absolute(src: str) -> Optional[str]:
    s = src.strip()
    low = s.lower()
    if low.startswith("https://"):
        return s
    if low.startswith("http://"):
        return "https://" + s[7:]
    if s.startswith("//"):
        return "https:" + s
    return None


def _image_markdown(m: re.Match) -> str:
    src = _absolute(m.group(1))
    if src is None:
        return ""
    alt_match = _ALT_ATTR.search(m.group(0))
    alt = (alt_match.group(1) if alt_match else "").replace("]", "").replace("\n", " ")
    return f"![{alt}]({src})"


def _link_markdown(m: re.Match) -> str:
    label = m.group(2).strip() or m.group(1)
    return f"[{label}]({m.group(1)})"


def _embed_link(source: str) -> str:
    """Vídeos y contenido embebido no se pueden mostrar dentro del post: se dejan como enlace al original."""
    url = _absolute(source)
    if url is None:
        return ""
    yt = _YOUTUBE_EMBED.match(url)
    watch = f"https://www.youtube.com/watch?v={yt.group(1)}" if yt else url
    try:
        host = urlsplit(watch).hostname or "enlace"
    except ValueError:
        host = "enlace"
    if host.startswith("www."):
        host = host[4:]
    return f"\n\n[\u25b6 Ver en {host}]({watch})\n\n"


def _table_to_markdown(html: str) -> str:
    rows = []
    for row in _TABLE_ROW.finditer(html):
        cells = [_clean_cell(c.group(1)) for c in _TABLE_CELL.finditer(row.group(1))]
        if cells:
            rows.append(cells)
    if not rows:
        return ""
    columns = max(len(r) for r in rows)

    def line(cells: list[str]) -> str:
        return "| " + " | ".join(cells[i] if i < len(cells) else "" for i in range(columns)) + " |"

    out = ["\n\n", line(rows[0]), "\n", "|", " --- |" * columns]
    for r in rows[1:]:
        out.append("\n" + line(r))
    out.append("\n\n")
    return "".join(out)


def _clean_cell(html: str) -> str:
    """Una celda cabe en una sola línea: el formato en línea se conserva, el resto de etiquetas se quita."""
    t = _LINE_BREAK.sub(" ", html)
    t = _LINKED_IMG.sub(lambda m: m.group(1), t)
    t = _IMG.sub(_image_markdown, t)
    t = _LINK.sub(_link_markdown, t)
    t = _inline_formatting(t)
    t = _BLOCK_END.sub(" ", t)
    t = _ANY_TAG.sub("", t)
    return _WHITESPACE.sub(" ", t).strip().replace("|", "\\|")


def _apply_quotes(text: str) -> str:
    t = text
    for _ in range(8):

        def quote(m: re.Match) -> str:
            lines = m.group(1).strip("\n ").split("\n")
            return "\n\n" + "\n".join(">" if not ln.strip() else "> " + ln.rstrip() for ln in lines) + "\n\n"

        nxt = _INNERMOST_QUOTE.sub(quote, t)
        if nxt == t:
            break
        t = nxt
    return t.replace(_QUOTE_OPEN, "").replace(_QUOTE_CLOSE, "")


def _code_point(n: int) -> Optional[str]:
    if 0 < n <= 0x10FFFF and not 0xD800 <= n <= 0xDFFF:
        return chr(n)
    return None


def _decode_entities(text: str) -> str:
    def repl(m: re.Match) -> str:
        e = m.group(1)
        if e in _NAMED_ENTITIES:
            return _NAMED_ENTITIES[e]
        try:
            if e[:2] in ("#x", "#X"):
                return _code_point(int(e[2:], 16)) or m.group(0)
            if e.startswith("#"):
                return _code_point(int(e[1:])) or m.group(0)
        except ValueError:
            pass
        return m.group(0)

    return _ENTITY.sub(repl, text)


# ---------- Resumen y portada ----------

_S_HEADING = re.compile(r"^\s{0,3}#{1,6}\s.*$", re.M)
_S_TABLE = re.compile(r"^\s*\|.*$", re.M)
_S_IMAGE = re.compile(r"!\[[^\]]*]\([^)]*\)")
_S_LINK = re.compile(r"\[([^\]]*)]\([^)]*\)")
_S_MARKER = re.compile(r"^\s{0,3}(?:>|[-*+]|\d+[.)])\s+", re.M)
_S_RULE = re.compile(r"^\s*([-*_])(\s*\1){2,}\s*$", re.M)
_S_EMPHASIS = re.compile(r"[*`~]+")
_S_URL = re.compile(r"https?://\S+")
_FIRST_IMAGE = re.compile(r"!\[[^\]]*]\((https://[^)\s]+)")


def summary(markdown: str, max_chars: int = 140) -> str:
    """Resumen de hasta ``max_chars``: sin títulos, tablas, imágenes, enlaces ni marcas de Markdown; corta en una palabra."""
    t = _FENCE.sub(" ", markdown)
    t = _S_HEADING.sub(" ", t)
    t = _S_TABLE.sub(" ", t)
    t = _S_IMAGE.sub(" ", t)
    t = _S_LINK.sub(lambda m: m.group(1), t)
    t = _S_RULE.sub(" ", t)
    t = _S_MARKER.sub("", t)
    t = _S_EMPHASIS.sub("", t)
    t = _S_URL.sub("", t)
    t = _WHITESPACE.sub(" ", t).strip()
    if len(t) <= max_chars:
        return t
    cut = t[:max_chars]
    space = cut.rfind(" ")
    base = cut[:space] if space > max_chars // 2 else cut
    return base.rstrip(" ,.;:-") + "\u2026"


def first_image(markdown: str) -> Optional[str]:
    """Primera imagen https del cuerpo ya limpio, para usarla de portada si el post no declara ninguna."""
    m = _FIRST_IMAGE.search(markdown)
    return m.group(1) if m else None
