import logging
import os
import httpx
from flask import Flask, jsonify, render_template, request, session, redirect, url_for
from datetime import timedelta
from config import settings


def create_app():
    """Factory de aplicación Flask."""
    # Obtener la raíz del proyecto (padre de src/)
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    app = Flask(
        __name__,
        template_folder=os.path.join(root_dir, 'templates'),
        static_folder=os.path.join(root_dir, 'static')
    )

    # Configuración
    app.secret_key = settings.flask_secret_key
    app.config["DEBUG"] = settings.debug
    app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=24)

    # Logging
    logging.basicConfig(
        level=getattr(logging, settings.log_level),
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
    )
    logger = logging.getLogger("taso-miniapp")

    # Rutas
    @app.route("/")
    def index():
        """Vista principal - tasas actuales."""
        return render_template("index.html", tasalo_api_url=settings.tasalo_api_url)

    @app.route("/history")
    def history():
        """Vista historial - gráfica de evolución."""
        return render_template("history.html", tasalo_api_url=settings.tasalo_api_url)

    @app.route("/provincias")
    def provincias():
        """Vista provincias - tasas por provincia."""
        return render_template("provincias.html", tasalo_api_url=settings.tasalo_api_url)

    @app.route("/settings")
    def settings_view():
        """Vista configuración - preferencias de usuario."""
        return render_template("settings.html", tasalo_api_url=settings.tasalo_api_url)

    @app.route("/stats")
    def stats():
        """Vista de estadísticas del bot (solo admin)."""
        # Verificar autenticación
        if not session.get('is_admin'):
            return redirect(url_for('stats_login'))
        return render_template("stats.html", tasalo_api_url=settings.tasalo_api_url)

    @app.route("/stats/login", methods=["GET", "POST"])
    def stats_login():
        """Login para acceder a estadísticas."""
        error = None
        if request.method == "POST":
            api_key = request.form.get("api_key")
            if api_key == settings.admin_api_key and api_key:
                session['is_admin'] = True
                session.permanent = True
                return redirect(url_for('stats'))
            error = "Clave API inválida"
        return render_template("stats_login.html", error=error)

    @app.route("/stats/logout")
    def stats_logout():
        """Cerrar sesión de estadísticas."""
        session.pop('is_admin', None)
        return redirect(url_for('index'))

    @app.route("/api/stats")
    def api_stats():
        """API endpoint para obtener estadísticas (solo admin)."""
        if not session.get('is_admin'):
            return jsonify({"ok": False, "error": "Unauthorized"}), 401
        
        # Proxy a taso-api
        try:
            headers = {"X-API-Key": settings.admin_api_key}
            with httpx.Client(timeout=10) as client:
                response = client.get(
                    f"{settings.tasalo_api_url}/api/v1/admin/stats/summary",
                    headers=headers
                )
                return jsonify(response.json()), response.status_code
        except Exception as e:
            logger.error(f"Error fetching stats: {e}")
            return jsonify({"ok": False, "error": "Failed to fetch stats"}), 500

    @app.route("/health")
    def health():
        """Health check endpoint."""
        return jsonify({"ok": True})

    # Error Handlers
    @app.errorhandler(404)
    def not_found(error):
        """Handler para 404."""
        if request.path.startswith('/api/'):
            return jsonify({"ok": False, "error": "Not found"}), 404
        return render_template("error.html", message="Página no encontrada", status_code=404), 404

    @app.errorhandler(500)
    def internal_error(error):
        """Handler para 500."""
        logger.error(f"Internal error: {error}")
        if request.path.startswith('/api/'):
            return jsonify({"ok": False, "error": "Internal server error"}), 500
        return render_template("error.html", message="Error interno del servidor", status_code=500), 500

    logger.info("TASALO Miniapp initialized")
    
    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=settings.port)
