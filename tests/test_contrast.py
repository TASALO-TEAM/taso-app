"""Contraste WCAG de los tokens reales de static/css/tokens.css (ambos temas).

Texto: ≥ 4,5:1. Componentes de UI / bordes de control: ≥ 3:1.
Si cambias un color en tokens.css y deja de cumplir, este test falla.
"""

import re
from pathlib import Path

import pytest

TOKENS = Path(__file__).resolve().parent.parent / "static" / "css" / "tokens.css"
HEX = re.compile(r"^#[0-9A-Fa-f]{6}$")


def _block(css: str, selector: str) -> dict[str, str]:
    m = re.search(re.escape(selector) + r"\s*\{(.*?)\}", css, re.S)
    assert m, f"No encuentro el bloque {selector} en tokens.css"
    out = {}
    for name, value in re.findall(r"--([\w-]+)\s*:\s*([^;]+);", m.group(1)):
        out[name] = value.strip()
    return out


def _themes():
    css = TOKENS.read_text(encoding="utf-8")
    dark = _block(css, ":root")
    light_over = _block(css, ':root[data-theme="light"]')
    light = {**dark, **light_over}
    return {"oscuro": dark, "claro": light}


def _lum(hexcolor: str) -> float:
    h = hexcolor.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))

    def f(c):
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a: str, b: str) -> float:
    la, lb = _lum(a), _lum(b)
    if la < lb:
        la, lb = lb, la
    return (la + 0.05) / (lb + 0.05)


# (primer plano, fondos, mínimo)
TEXT_CHECKS = [
    ("text", ["bg", "surface", "card", "card-high"], 4.5),
    ("text2", ["bg", "surface", "card", "card-high"], 4.5),
    ("accent", ["bg", "surface", "card", "card-high"], 4.5),
    ("red", ["bg", "card"], 4.5),
    ("green", ["bg", "card"], 4.5),
    ("neutral", ["bg", "card"], 4.5),
    ("error", ["bg", "error-bg"], 4.5),
    ("on-accent", ["accent"], 4.5),
]
UI_CHECKS = [("outline", ["bg", "card"], 3.0)]


@pytest.mark.parametrize("theme", ["oscuro", "claro"])
def test_tokens_son_hex_validos(theme):
    t = _themes()[theme]
    for name in ["bg", "surface", "card", "card-high", "accent", "on-accent", "text", "text2",
                 "outline", "red", "green", "neutral", "error", "error-bg"]:
        assert name in t, f"Falta --{name} en el tema {theme}"
        assert HEX.match(t[name]), f"--{name} ({theme}) debe ser #RRGGBB: {t[name]}"


@pytest.mark.parametrize("theme", ["oscuro", "claro"])
@pytest.mark.parametrize("fg,bgs,minimo", TEXT_CHECKS + UI_CHECKS)
def test_contraste(theme, fg, bgs, minimo):
    t = _themes()[theme]
    for bg in bgs:
        r = ratio(t[fg], t[bg])
        assert r >= minimo, f"{theme}: --{fg} sobre --{bg} = {r:.2f}:1 (mínimo {minimo}:1)"


def test_la_convencion_invertida_no_crea_ciclos():
    """--up/--down se resuelven desde --red/--green; nunca el uno desde el otro."""
    css = TOKENS.read_text(encoding="utf-8")
    inv = _block(css, ":root[data-invert]")
    assert inv["up"] == "var(--green)" and inv["down"] == "var(--red)"
    for theme_css in (_block(css, ":root"), _block(css, ':root[data-theme="light"]')):
        assert theme_css["up"] == "var(--red)" and theme_css["down"] == "var(--green)"


def test_sin_fuentes_externas_ni_cdn():
    css = TOKENS.read_text(encoding="utf-8")
    assert "googleapis" not in css and "gstatic" not in css and "http" not in css
