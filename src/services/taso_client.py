"""Cliente HTTP de taso-api para el BFF. Solo endpoints públicos de lectura.

Los tests lo sustituyen (monkeypatch) para no tocar la red.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from config import settings
from src.services.cache import UpstreamError, UpstreamNotFound

logger = logging.getLogger("taso-miniapp.upstream")

JSON_TIMEOUT = 8.0
FILE_TIMEOUT = 15.0
MAX_FILE_BYTES = 8 * 1024 * 1024  # una captura de El Toque pesa mucho menos; tope defensivo


def _url(path: str) -> str:
    return settings.tasalo_api_url.rstrip("/") + path


def get_json(path: str, timeout: float = JSON_TIMEOUT) -> Any:
    """GET → JSON. Lanza UpstreamError (o UpstreamNotFound si 404)."""
    try:
        resp = httpx.get(_url(path), timeout=timeout, headers={"Accept": "application/json"})
    except httpx.HTTPError as exc:
        logger.warning("taso-api %s falló: %s", path, type(exc).__name__)
        raise UpstreamError(path) from exc
    if resp.status_code == 404:
        raise UpstreamNotFound(path)
    if resp.status_code != 200:
        logger.warning("taso-api %s respondió %s", path, resp.status_code)
        raise UpstreamError(path)
    try:
        return resp.json()
    except ValueError as exc:
        raise UpstreamError(path) from exc


def get_file(path: str, timeout: float = FILE_TIMEOUT) -> tuple[bytes, str]:
    """GET → (bytes, content-type). Lanza UpstreamNotFound si 404, UpstreamError si falla o pesa demasiado."""
    try:
        resp = httpx.get(_url(path), timeout=timeout)
    except httpx.HTTPError as exc:
        logger.warning("taso-api %s falló: %s", path, type(exc).__name__)
        raise UpstreamError(path) from exc
    if resp.status_code == 404:
        raise UpstreamNotFound(path)
    if resp.status_code != 200 or len(resp.content) > MAX_FILE_BYTES:
        raise UpstreamError(path)
    return resp.content, resp.headers.get("content-type", "application/octet-stream")


def call(method: str, path: str, *, json: Any = None, params: dict | None = None, timeout: float = JSON_TIMEOUT) -> tuple[int, Any]:
    """Llamada AUTENTICADA a taso-api (``X-API-Key``) para las alertas del usuario.

    Devuelve ``(status, cuerpo_json_o_None)`` sin juzgar el código: quien llama decide qué es 404 o 409.
    Lanza UpstreamError solo si no hubo respuesta (red, timeout). La clave nunca se registra.
    """
    headers = {"Accept": "application/json"}
    key = settings.admin_key
    if key:
        headers["X-API-Key"] = key
    try:
        resp = httpx.request(method, _url(path), json=json, params=params, headers=headers, timeout=timeout)
    except httpx.HTTPError as exc:
        logger.warning("taso-api %s %s falló: %s", method, path, type(exc).__name__)
        raise UpstreamError(path) from exc
    try:
        body = resp.json()
    except ValueError:
        body = None
    return resp.status_code, body


def probe(path: str, timeout: float = JSON_TIMEOUT) -> bool:
    """¿Responde 200? No descarga el cuerpo."""
    try:
        with httpx.stream("GET", _url(path), timeout=timeout) as resp:
            return resp.status_code == 200
    except httpx.HTTPError:
        return False
