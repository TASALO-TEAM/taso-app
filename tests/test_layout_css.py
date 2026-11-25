"""Contrato de layout: rejilla 12-8-4 y un solo scroll en los overlays (sin navegador: lee el CSS)."""
import re
from pathlib import Path

CSS = Path(__file__).resolve().parent.parent / "static" / "css"
SHELL = (CSS / "shell.css").read_text(encoding="utf-8")
COMPONENTS = (CSS / "components.css").read_text(encoding="utf-8")


def _bloque(css: str, apertura: str) -> str:
    """Cuerpo del primer bloque `apertura { ... }` (sin anidar mas de un nivel)."""
    i = css.index(apertura)
    return css[css.index("{", i) + 1 : css.index("}", i)]


def test_rejilla_movil_4_columnas():
    base = re.search(r":root \{ ([^}]*--cols: 4[^}]*) \}", SHELL)
    assert base, "falta el :root base con --cols: 4"
    assert "--margin: 1rem" in base.group(1) and "--gutter: 1rem" in base.group(1)


def test_rejilla_tablet_8_y_escritorio_12():
    tablet = _bloque(SHELL, "@media (min-width: 37.5rem)")
    assert "--cols: 8" in tablet
    escritorio = SHELL[SHELL.index("@media (min-width: 64.0625rem)") :]
    assert "--cols: 12" in escritorio
    assert "--page-max: 72rem" in escritorio  # contenedor centrado en escritorio


def test_margen_y_separacion_dentro_de_la_regla():
    tablet = _bloque(SHELL, "@media (min-width: 48rem)")
    assert "--margin: 2rem" in tablet  # 32px
    assert "--gutter: 1.5rem" in tablet  # 24px


def test_tarjetas_ocupan_columnas_de_la_rejilla():
    assert "repeat(var(--cols), minmax(0, 1fr))" in COMPONENTS
    assert ".grid > * { grid-column: span var(--span); }" in COMPONENTS


def test_overlay_un_solo_scroll():
    overlay = _bloque(COMPONENTS, ".overlay {")
    assert "overflow-y: auto" in overlay and "overscroll-behavior: contain" in overlay
    assert "html:has(.overlay) { overflow: hidden; }" in COMPONENTS  # la pagina de detras no scrollea
    # el cuerpo del overlay no tiene scroll propio (era el origen de la doble barra)
    assert "overflow" not in _bloque(COMPONENTS, ".ov-body {")
