"""El VPS corre Python 3.11: ahí un f-string no admite barra invertida dentro de {}.

Los tests locales pueden correr en un Python más nuevo y no lo detectarían
(así se cayó el despliegue del checker de alertas, 0.41.0.1).
"""
import re
from pathlib import Path

SRC = Path(__file__).resolve().parent.parent / "src"
# Línea con f-string cuya expresión {…} contiene una barra invertida.
_BAD = re.compile(r"""\bf(?:"[^"\n]*\{[^}\n]*\\[^}\n]*\}|'[^'\n]*\{[^}\n]*\\[^}\n]*\})""")


def test_patron_detecta_el_caso_que_rompio_el_vps():
    linea = """x = f"{'\\U0001F4C8' if a else 'b'} {body}\""""
    assert _BAD.search(linea)
    assert not _BAD.search('x = f"{arrow} {body}"')
    assert not _BAD.search('x = f"{a[\'k\']}"')


def test_src_sin_barra_invertida_en_expresiones_fstring():
    malos = []
    for py in sorted(SRC.rglob("*.py")):
        for n, linea in enumerate(py.read_text(encoding="utf-8").splitlines(), 1):
            if _BAD.search(linea):
                malos.append(f"{py.relative_to(SRC.parent)}:{n}: {linea.strip()}")
    assert not malos, "Python 3.11 (VPS) no admite esto:\n" + "\n".join(malos)
