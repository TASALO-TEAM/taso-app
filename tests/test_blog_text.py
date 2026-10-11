"""Tests de la limpieza del texto de los posts de Hive (HTML → Markdown, resumen y portada)."""

import pytest

from src.services import blog_text


def test_texto_sin_html_ni_entidades_no_se_toca():
    md = "# Título\n\nUn párrafo con **negrita** y [enlace](https://ecency.com)."
    assert blog_text.clean(md) == md


def test_cuerpo_vacio_o_none():
    assert blog_text.clean("") == ""
    assert blog_text.clean(None) == ""


@pytest.mark.parametrize(
    "html, esperado",
    [
        ("<p>Hola <b>mundo</b></p>", "Hola **mundo**"),
        ("<h2>Subtítulo</h2><p>texto</p>", "## Subtítulo\n\ntexto"),
        ("<p>uno<br>dos</p>", "uno\ndos"),
        ('<a href="https://x.com/a">enlace</a>', "[enlace](https://x.com/a)"),
        ("<em>cursiva</em> y <del>tachado</del>", "*cursiva* y ~~tachado~~"),
        ("<ul><li>a</li><li>b</li></ul>", "- a\n- b"),
        ("<ol><li>a</li><li>b</li></ol>", "1. a\n2. b"),
        ("<hr>", "---"),
    ],
)
def test_html_comun_a_markdown(html, esperado):
    assert blog_text.clean(html) == esperado


def test_script_y_estilos_se_quitan_con_su_contenido():
    out = blog_text.clean("antes<script>alert(1)</script><style>p{color:red}</style>después")
    assert "alert" not in out and "color" not in out
    assert out == "antesdespués"


def test_iframe_se_deja_como_enlace_y_youtube_se_normaliza():
    out = blog_text.clean('<iframe src="https://www.youtube.com/embed/abc123"></iframe>')
    assert "[\u25b6 Ver en youtube.com](https://www.youtube.com/watch?v=abc123)" in out
    assert "<iframe" not in out


def test_imagen_http_pasa_a_https_y_relativa_se_descarta():
    assert blog_text.clean('<img src="http://i.ecency.com/a.png" alt="foto">') == "![foto](https://i.ecency.com/a.png)"
    assert blog_text.clean('<img src="/local.png">') == ""


def test_tabla_a_markdown():
    out = blog_text.clean("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>")
    assert out == "| A | B |\n| --- | --- |\n| 1 | 2 |"


def test_cita():
    assert blog_text.clean("<blockquote>dicho</blockquote>") == "> dicho"


def test_los_bloques_de_codigo_markdown_no_se_tocan():
    md = "texto\n\n```\n<b>no tocar</b> &amp;\n```\n\nfin"
    assert blog_text.clean(md) == md


def test_pre_se_convierte_en_bloque_de_codigo_sin_etiquetas():
    out = blog_text.clean("<pre><code>a &lt; b</code></pre>")
    assert out == "```\na < b\n```"


def test_entidades():
    assert blog_text.clean("5 &gt; 3 &amp; 2 &lt; 4 &#x41;&#66;") == "5 > 3 & 2 < 4 AB"
    # entidad desconocida o inválida: se deja
    assert blog_text.clean("&inventada; &#0;") == "&inventada; &#0;"


def test_una_etiqueta_desconocida_se_deja_como_texto():
    assert blog_text.clean("usa <mi-etiqueta> aquí & allá") == "usa <mi-etiqueta> aquí & allá"


def test_cuerpo_gigante_se_recorta():
    out = blog_text.clean("a" * (blog_text.MAX_BODY_CHARS + 5000))
    assert len(out) == blog_text.MAX_BODY_CHARS


# ---------- Resumen y portada ----------

def test_resumen_sin_marcas_ni_enlaces_ni_imagenes():
    md = "# Título\n\n![x](https://a.png)\n\nHola **mundo**, mira [esto](https://x.com) https://suelta.com\n\n- punto"
    assert blog_text.summary(md) == "Hola mundo, mira esto punto"


def test_resumen_corta_en_palabra_con_puntos_suspensivos():
    out = blog_text.summary("palabra " * 40, max_chars=30)
    assert out.endswith("\u2026") and len(out) <= 31
    assert " \u2026" not in out


def test_primera_imagen_solo_https():
    assert blog_text.first_image("![a](http://x/1.png) ![b](https://x/2.png)") == "https://x/2.png"
    assert blog_text.first_image("sin imágenes") is None
