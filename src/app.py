import logging
import os
from flask import Flask, jsonify, render_template
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

    @app.route("/health")
    def health():
        """Health check endpoint."""
        return jsonify({"ok": True})
    
    logger.info("TASALO Miniapp initialized")
    
    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=settings.port)
