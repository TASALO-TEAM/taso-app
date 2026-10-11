"""Cabeceras de seguridad y middleware de prefijo.

La CSP estricta (sin ``unsafe-inline``) se aplica a las rutas nuevas (shell y API del BFF).
Las páginas heredadas siguen con su política hasta que cada sección las reemplace.
"""

from __future__ import annotations

# Nada en línea: scripts y estilos van en ficheros propios. El SDK de Telegram viene de telegram.org.
CSP = "; ".join(
    [
        "default-src 'none'",
        "script-src 'self' https://telegram.org",
        "style-src 'self'",
        "font-src 'self'",
        "img-src 'self' data: blob: https:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors https://web.telegram.org https://*.telegram.org",
    ]
)

STRICT_BLUEPRINTS = frozenset({"pages", "api", "api_alerts", "api_market"})


def apply_security_headers(response, blueprint: str | None, is_api: bool):
    """Añade cabeceras de seguridad a las respuestas de las rutas nuevas."""
    if blueprint not in STRICT_BLUEPRINTS:
        return response
    response.headers["Content-Security-Policy"] = CSP
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
    response.headers["Cache-Control"] = "no-store" if is_api else "no-cache"
    return response


class PrefixStripMiddleware:
    """Acepta las rutas con y sin prefijo (p. ej. ``/miniapp``): quita el prefijo si viene.

    Así la app funciona tanto si Caddy hace ``strip`` del prefijo como si lo reenvía.
    """

    def __init__(self, wsgi_app, prefix: str):
        self.wsgi_app = wsgi_app
        self.prefix = prefix.rstrip("/")

    def __call__(self, environ, start_response):
        if self.prefix:
            path = environ.get("PATH_INFO", "")
            if path == self.prefix or path.startswith(self.prefix + "/"):
                environ["PATH_INFO"] = path[len(self.prefix):] or "/"
        return self.wsgi_app(environ, start_response)
