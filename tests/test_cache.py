"""Tests de la caché con stale-if-error y del limitador por usuario (src/services/cache.py)."""

import pytest

from src.services.cache import RateLimiter, TTLCache, UpstreamError


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def loader_factory(values):
    """Devuelve un loader que consume ``values``; una excepción en la lista se lanza."""
    calls = {"n": 0}
    seq = list(values)

    def load():
        calls["n"] += 1
        item = seq.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    return load, calls


def test_primera_llamada_carga_y_no_es_stale():
    cache = TTLCache(Clock())
    load, calls = loader_factory(["A"])
    r = cache.fetch("k", ttl=30, max_stale=3600, loader=load)
    assert (r.value, r.stale, calls["n"]) == ("A", False, 1)


def test_dentro_del_ttl_no_vuelve_a_cargar():
    clock = Clock()
    cache = TTLCache(clock)
    load, calls = loader_factory(["A", "B"])
    cache.fetch("k", 30, 3600, load)
    clock.t += 29
    r = cache.fetch("k", 30, 3600, load)
    assert (r.value, r.stale, calls["n"]) == ("A", False, 1)


def test_pasado_el_ttl_recarga():
    clock = Clock()
    cache = TTLCache(clock)
    load, calls = loader_factory(["A", "B"])
    cache.fetch("k", 30, 3600, load)
    clock.t += 31
    r = cache.fetch("k", 30, 3600, load)
    assert (r.value, r.stale, calls["n"]) == ("B", False, 2)


def test_si_el_origen_falla_sirve_lo_ultimo_marcado_stale():
    clock = Clock()
    cache = TTLCache(clock)
    load, _ = loader_factory(["A", UpstreamError("caído")])
    cache.fetch("k", 30, 3600, load)
    clock.t += 100
    r = cache.fetch("k", 30, 3600, load)
    assert r.value == "A" and r.stale is True and r.age_seconds == pytest.approx(100)


def test_si_falla_y_lo_guardado_es_demasiado_viejo_lanza():
    clock = Clock()
    cache = TTLCache(clock)
    load, _ = loader_factory(["A", UpstreamError("caído")])
    cache.fetch("k", 30, 3600, load)
    clock.t += 3601
    with pytest.raises(UpstreamError):
        cache.fetch("k", 30, 3600, load)


def test_si_falla_y_no_hay_nada_guardado_lanza():
    cache = TTLCache(Clock())
    load, _ = loader_factory([UpstreamError("caído")])
    with pytest.raises(UpstreamError):
        cache.fetch("k", 30, 3600, load)


def test_un_fallo_no_borra_lo_guardado_y_tras_recuperarse_vuelve_a_fresco():
    clock = Clock()
    cache = TTLCache(clock)
    load, _ = loader_factory(["A", UpstreamError("x"), "C"])
    cache.fetch("k", 30, 3600, load)
    clock.t += 40
    assert cache.fetch("k", 30, 3600, load).stale is True
    clock.t += 1
    r = cache.fetch("k", 30, 3600, load)
    assert (r.value, r.stale) == ("C", False)


def test_claves_independientes():
    cache = TTLCache(Clock())
    la, _ = loader_factory(["A"])
    lb, _ = loader_factory(["B"])
    assert cache.fetch("a", 30, 3600, la).value == "A"
    assert cache.fetch("b", 30, 3600, lb).value == "B"


def test_errores_que_no_son_del_origen_no_se_tragan():
    cache = TTLCache(Clock())

    def boom():
        raise KeyError("bug")

    with pytest.raises(KeyError):
        cache.fetch("k", 30, 3600, boom)


# ---------- RateLimiter ----------

def test_limitador_permite_hasta_el_limite_y_luego_bloquea():
    clock = Clock()
    rl = RateLimiter(3, 60, clock)
    assert [rl.allow(1) for _ in range(5)] == [True, True, True, False, False]


def test_limitador_la_ventana_se_desliza():
    clock = Clock()
    rl = RateLimiter(2, 60, clock)
    assert rl.allow(1) and rl.allow(1) and not rl.allow(1)
    clock.t += 61
    assert rl.allow(1)


def test_limitador_por_usuario_independiente():
    rl = RateLimiter(1, 60, Clock())
    assert rl.allow(1) and not rl.allow(1)
    assert rl.allow(2)


def test_limitador_cero_es_sin_limite():
    rl = RateLimiter(0, 60, Clock())
    assert all(rl.allow(1) for _ in range(1000))


def test_limitador_purga_claves_viejas_sin_crecer_sin_fin():
    clock = Clock()
    rl = RateLimiter(5, 60, clock)
    for i in range(RateLimiter.MAX_KEYS + 10):
        rl.allow(i)
    clock.t += 120
    rl.allow("nuevo")
    assert len(rl._hits) < RateLimiter.MAX_KEYS
