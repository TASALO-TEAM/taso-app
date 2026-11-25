// Carrusel de noticias de Mercado (S10 F5): pista con desplazamiento y snap nativos + botones HTML (guia modern-web-guidance
// «carousel»). Sin innerHTML ni estilos en linea (CSP). Las reglas puras (validar, etiquetas, diapositiva actual) viven en news.js.
// shortcut: carrusel FINITO (las flechas se desactivan en los extremos); no se implemento el bucle con `order` de la guia.
import { h, icon, ICONS } from "./dom.js";
import { currentSlide, newsMeta, newsTone, slideLabel, slideStatus } from "./news.js";
import { openLink } from "./sdk.js";
import { serverNow } from "./clock.js";

const SETTLE_MS = 140; // sin evento scrollend, la pista se da por quieta tras este rato sin scroll

/**
 * items: salida de cleanNews (ya validada). Devuelve la tarjeta; `card.refreshMeta(now)` actualiza solo las horas relativas.
 * Con una sola noticia no hay flechas ni segmentos.
 */
export function newsCarousel(items, now = serverNow()) {
  const n = items.length;
  const many = n > 1;
  let active = 0; // la que marcan los segmentos (se mueve en cuanto el usuario decide, no al terminar el desplazamiento)
  let settled = 0; // la ultima anunciada al lector de pantalla
  let pending = null; // destino de un toque en curso: los toques seguidos se apoyan en el, no en la posicion real
  let frame = 0;
  let timer = 0;
  const hasScrollEnd = typeof window !== "undefined" && "onscrollend" in window;

  const metas = items.map((it) => h("span", { class: "mk-news-meta", text: newsMeta(it, now) }));
  const slides = items.map((it, i) =>
    h(
      "div",
      { class: "mk-news-slide", role: "group", "aria-roledescription": "diapositiva", "aria-label": slideLabel(i, n), dataset: { tone: newsTone(it.source) } },
      it.image ? h("img", { class: "mk-news-img", src: it.image, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" }) : null,
      h(
        "div",
        { class: "mk-news-body" },
        metas[i],
        h("a", {
          class: "mk-news-link",
          href: it.url,
          target: "_blank",
          rel: "noopener noreferrer",
          lang: it.lang,
          text: it.title,
          // En Telegram se abre con el navegador del sistema; si no se pudo abrir, manda el enlace normal.
          onClick: (e) => {
            if (openLink(it.url)) e.preventDefault();
          },
        }),
      ),
    ),
  );
  const track = h("div", { class: "mk-news-track", tabindex: "0", role: "group", "aria-label": "Titulares", onScroll }, slides);
  const status = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });

  const prev = h("button", { type: "button", class: "mk-news-btn", "aria-label": "Noticia anterior", disabled: true, onClick: () => goTo((pending ?? active) - 1) }, icon(...ICONS.back));
  const next = h("button", { type: "button", class: "mk-news-btn", "aria-label": "Noticia siguiente", onClick: () => goTo((pending ?? active) + 1) }, icon(...ICONS.chevron));
  const marks = items.map((_, i) =>
    h("button", {
      type: "button",
      class: "mk-news-mark",
      "aria-label": `Ir a la noticia ${slideLabel(i, n)}`,
      "aria-current": i === 0 ? "true" : "false",
      onClick: () => goTo(i),
    }),
  );

  const index = () => currentSlide(slides.map((s) => s.offsetLeft), track.scrollLeft);

  function paint(i) {
    if (i < 0 || i === active) return;
    active = i;
    marks.forEach((m, k) => m.setAttribute("aria-current", k === i ? "true" : "false"));
  }

  // Un boton que se desactiva con el foco no deja al usuario sin foco: el foco pasa al otro.
  function setDisabled(btn, other, value) {
    if (value && document.activeElement === btn) other.focus();
    btn.disabled = value;
  }

  function settle() {
    clearTimeout(timer);
    // Un fin de scroll viejo (de un toque anterior) no cuenta: el desplazamiento pedido aun no termino.
    if (pending !== null && Math.abs(track.scrollLeft - slides[pending].offsetLeft) > 1) return;
    pending = null;
    const i = index();
    if (i < 0) return;
    paint(i);
    setDisabled(prev, next, i <= 0);
    setDisabled(next, prev, i >= n - 1);
    if (i !== settled) {
      settled = i;
      status.textContent = slideStatus(i, n); // solo cuando cambia la noticia: ni la carga ni los ajustes la anuncian
    }
  }

  function onScroll() {
    // Mientras hay un destino pedido no se recalcula en cada cuadro (en Safari se nota); los segmentos ya estan en su sitio.
    if (pending === null && !frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        paint(index());
      });
    }
    if (!hasScrollEnd) {
      clearTimeout(timer);
      timer = setTimeout(settle, SETTLE_MS);
    }
  }

  function goTo(i) {
    const target = Math.min(Math.max(i, 0), n - 1);
    if (target === (pending ?? active)) return;
    pending = target;
    paint(target);
    track.scrollTo({ left: slides[target].offsetLeft }); // el `scroll-behavior: smooth` lo pone el CSS solo si no hay «reducir movimiento»
  }

  if (hasScrollEnd) track.addEventListener("scrollend", settle);

  const card = h(
    "section",
    { class: "card mk-news", "aria-roledescription": "carrusel", "aria-label": "Noticias del mercado" },
    h("div", { class: "mk-head" }, h("h2", { class: "card-title", text: "Noticias" })),
    h("div", { class: "mk-news-stage" }, track, many ? h("div", { class: "mk-news-ctl" }, prev, next) : null),
    many ? h("nav", { class: "mk-news-marks", "aria-label": "Elegir noticia" }, marks) : null,
    status,
  );
  card.refreshMeta = (t) => items.forEach((it, i) => (metas[i].textContent = newsMeta(it, t)));
  return card;
}
