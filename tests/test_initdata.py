"""Tests de la validación de initData (src/auth/initdata.py)."""

import hashlib
import hmac
import json
from urllib.parse import urlencode

import pytest

from src.auth.initdata import InitDataError, compute_hash, validate_init_data

TOKEN = "123456:TEST-TOKEN-not-real"
NOW = 1_800_000_000
USER = {"id": 424242, "first_name": "Ernesto", "language_code": "es", "allows_write_to_pm": True}


def make_init_data(fields=None, token=TOKEN, sign=True, tamper_hash=None):
    """Construye un initData firmado como lo haría Telegram."""
    base = {
        "query_id": "AAH-test",
        "user": json.dumps(USER, separators=(",", ":")),
        "auth_date": str(NOW - 60),
        "signature": "c2lnbmF0dXJlLWRlLXBydWViYQ",  # campo extra: SÍ entra en data_check_string
    }
    if fields:
        base.update(fields)
    base = {k: v for k, v in base.items() if v is not None}
    if sign:
        base["hash"] = compute_hash(base, token)
    if tamper_hash is not None:
        base["hash"] = tamper_hash
    return urlencode(base)


def test_valido_devuelve_identidad():
    data = validate_init_data(make_init_data(), TOKEN, now=NOW)
    assert data.user_id == 424242
    assert data.first_name == "Ernesto"
    assert data.language_code == "es"
    assert data.allows_write_to_pm is True


def test_el_hash_coincide_con_la_receta_oficial_independiente():
    """Reimplementa la receta de la doc paso a paso (sin usar compute_hash)."""
    fields = {"auth_date": str(NOW - 5), "user": json.dumps(USER, separators=(",", ":")), "start_param": "tab_alertas"}
    dcs = "\n".join(f"{k}={v}" for k, v in sorted(fields.items()))
    secret = hmac.new(b"WebAppData", TOKEN.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, dcs.encode(), hashlib.sha256).hexdigest()
    qs = urlencode({**fields, "hash": expected})
    data = validate_init_data(qs, TOKEN, now=NOW)
    assert data.start_param == "tab_alertas"


def test_signature_forma_parte_del_data_check_string():
    sin_signature = make_init_data({"signature": None})
    con_signature = make_init_data()
    assert validate_init_data(sin_signature, TOKEN, now=NOW).user_id == 424242
    assert validate_init_data(con_signature, TOKEN, now=NOW).user_id == 424242
    # Si alguien añade/quita signature DESPUÉS de firmar, el hash deja de valer.
    firmado = make_init_data()
    manipulado = firmado.replace("signature=", "signature=x")
    with pytest.raises(InitDataError) as e:
        validate_init_data(manipulado, TOKEN, now=NOW)
    assert e.value.code == "bad_hash"


def test_manipulado_cambiar_user_id():
    init_data = make_init_data()
    otro = urlencode({"user": json.dumps({**USER, "id": 1}, separators=(",", ":"))})
    # Reemplaza el campo user conservando el hash viejo
    partes = dict(p.split("=", 1) for p in init_data.split("&"))
    partes["user"] = otro.split("=", 1)[1]
    manipulado = "&".join(f"{k}={v}" for k, v in partes.items())
    with pytest.raises(InitDataError) as e:
        validate_init_data(manipulado, TOKEN, now=NOW)
    assert e.value.code == "bad_hash"


def test_token_equivocado():
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data(), "999:otro-token", now=NOW)
    assert e.value.code == "bad_hash"


def test_hash_basura():
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data(tamper_hash="0" * 64), TOKEN, now=NOW)
    assert e.value.code == "bad_hash"


def test_expirado():
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data({"auth_date": str(NOW - 86401)}), TOKEN, now=NOW)
    assert e.value.code == "expired"


def test_justo_en_el_limite_de_edad_es_valido():
    ok = validate_init_data(make_init_data({"auth_date": str(NOW - 86400)}), TOKEN, now=NOW)
    assert ok.user_id == 424242


def test_max_age_configurable():
    with pytest.raises(InitDataError):
        validate_init_data(make_init_data({"auth_date": str(NOW - 120)}), TOKEN, max_age_seconds=60, now=NOW)


def test_auth_date_en_el_futuro():
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data({"auth_date": str(NOW + 3600)}), TOKEN, now=NOW)
    assert e.value.code == "auth_date_in_future"


def test_pequeno_desfase_de_reloj_se_tolera():
    ok = validate_init_data(make_init_data({"auth_date": str(NOW + 30)}), TOKEN, now=NOW)
    assert ok.user_id == 424242


@pytest.mark.parametrize("valor", ["abc", "0", "-5", ""])
def test_auth_date_invalido(valor):
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data({"auth_date": valor}), TOKEN, now=NOW)
    assert e.value.code == "bad_auth_date"


def test_sin_auth_date():
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data({"auth_date": None}), TOKEN, now=NOW)
    assert e.value.code == "bad_auth_date"


def test_sin_hash():
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data(sign=False), TOKEN, now=NOW)
    assert e.value.code == "missing_hash"


def test_user_json_mal_formado():
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data({"user": "{no-es-json"}), TOKEN, now=NOW)
    assert e.value.code == "bad_user"


@pytest.mark.parametrize("user", ["[]", '"texto"', "123", "null", '{"first_name":"X"}',
                                  '{"id":"7"}', '{"id":true}', '{"id":0}', '{"id":-3}', '{"id":1.5}'])
def test_user_sin_id_entero_positivo(user):
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data({"user": user}), TOKEN, now=NOW)
    assert e.value.code == "bad_user"


def test_sin_user():
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data({"user": None}), TOKEN, now=NOW)
    assert e.value.code == "missing_user"


@pytest.mark.parametrize("valor", ["", None])
def test_vacio_o_none(valor):
    with pytest.raises(InitDataError) as e:
        validate_init_data(valor, TOKEN, now=NOW)
    assert e.value.code == "missing"


def test_token_del_bot_vacio_nunca_acepta():
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data(token=""), "", now=NOW)
    assert e.value.code == "server_misconfigured"


def test_campo_duplicado_se_rechaza():
    firmado = make_init_data()
    with pytest.raises(InitDataError) as e:
        validate_init_data(firmado + "&auth_date=1", TOKEN, now=NOW)
    assert e.value.code == "duplicate_field"


def test_demasiado_grande():
    with pytest.raises(InitDataError) as e:
        validate_init_data("a=" + "b" * 9000, TOKEN, now=NOW)
    assert e.value.code == "too_large"


def test_no_es_query_string():
    with pytest.raises(InitDataError) as e:
        validate_init_data("esto no es un query string", TOKEN, now=NOW)
    assert e.value.code in {"malformed", "missing_hash"}


def test_el_error_no_filtra_detalles_del_token():
    with pytest.raises(InitDataError) as e:
        validate_init_data(make_init_data(), "999:otro-token", now=NOW)
    assert "otro-token" not in str(e.value) and TOKEN not in str(e.value)
