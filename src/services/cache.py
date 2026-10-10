"""Caché en memoria con «servir lo último si falla» (stale-if-error) y límite por usuario.

Sin dependencias externas. Las instancias viven en ``app.config`` (una por app), así los
tests no comparten estado.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from dataclasses import dataclass
from typing import Any, Callable, Deque, Dict, Hashable, Optional


class UpstreamError(Exception):
    """El servicio de origen (taso-api, Hive…) no respondió bien."""


class UpstreamNotFound(UpstreamError):
    """El origen respondió 404 (p. ej. aún no hay imagen de El Toque)."""


@dataclass(frozen=True)
class Cached:
    value: Any
    stale: bool          # True = el origen falló y se sirve lo último guardado
    age_seconds: float   # antigüedad del valor servido


class TTLCache:
    """Caché con TTL por llamada y bloqueo por clave para no martillar al origen."""

    def __init__(self, clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._data: Dict[Hashable, tuple[float, Any]] = {}
        self._locks: Dict[Hashable, threading.Lock] = {}
        self._guard = threading.Lock()

    def _lock_for(self, key: Hashable) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def peek(self, key: Hashable) -> Optional[tuple[float, Any]]:
        with self._guard:
            return self._data.get(key)

    def fetch(
        self,
        key: Hashable,
        ttl: float,
        max_stale: float,
        loader: Callable[[], Any],
    ) -> Cached:
        """Devuelve el valor fresco; si el origen falla, el último guardado (hasta ``max_stale`` s).

        Lanza ``UpstreamError`` solo si no hay nada utilizable que servir.
        """
        now = self._clock()
        entry = self.peek(key)
        if entry and now - entry[0] < ttl:
            return Cached(entry[1], False, now - entry[0])

        with self._lock_for(key):
            # Otro hilo pudo refrescar mientras esperábamos el bloqueo.
            now = self._clock()
            entry = self.peek(key)
            if entry and now - entry[0] < ttl:
                return Cached(entry[1], False, now - entry[0])
            try:
                value = loader()
            except UpstreamError:
                if entry and now - entry[0] <= max_stale:
                    return Cached(entry[1], True, now - entry[0])
                raise
            with self._guard:
                self._data[key] = (self._clock(), value)
            return Cached(value, False, 0.0)


class RateLimiter:
    """Ventana deslizante por clave (p. ej. user_id): ``limit`` peticiones cada ``window`` segundos."""

    MAX_KEYS = 5000

    def __init__(self, limit: int, window: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self.limit = limit
        self.window = window
        self._clock = clock
        self._hits: Dict[Hashable, Deque[float]] = {}
        self._guard = threading.Lock()

    def allow(self, key: Hashable) -> bool:
        if self.limit <= 0:  # 0 = sin límite
            return True
        now = self._clock()
        with self._guard:
            if len(self._hits) > self.MAX_KEYS:
                self._purge(now)
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                return False
            hits.append(now)
            return True

    def _purge(self, now: float) -> None:
        for k in [k for k, h in self._hits.items() if not h or now - h[-1] >= self.window]:
            del self._hits[k]
