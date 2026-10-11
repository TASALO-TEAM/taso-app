// Lector de posts del Blog (overlay) y renderizado seguro de Markdown a DOM.
// Todo texto entra por textContent (nunca innerHTML); los enlaces se abren con openLink y las imágenes ya vienen
// filtradas a https por modules/markdown.js. Sin estilos en línea (CSP).
import { ApiError, getBlogPost } from "../modules/api.js";
import { postDate } from "../modules/blog.js";
import { h, icon, ICONS } from "../modules/dom.js";
import { parse, safeLinkUrl } from "../modules/markdown.js";
import { hideBack, openLink, showBack } from "../modules/sdk.js";

// ---------- Markdown → DOM ----------

export function renderInline(nodes) {
  return nodes.map((n) => {
    switch (n.type) {
      case "text":
        return document.createTextNode(n.text);
      case "br":
        return h("br");
      case "strong":
        return h("strong", null, renderInline(n.children));
      case "em":
        return h("em", null, renderInline(n.children));
      case "del":
        return h("del", null, renderInline(n.children));
      case "code":
        return h("code", { text: n.text });
      case "link":
        return h(
          "a",
          {
            href: n.url,
            rel: "noopener noreferrer",
            onClick: (e) => {
              e.preventDefault();
              openLink(n.url);
            },
          },
          renderInline(n.children),
        );
      case "image":
        return h("img", {
          src: n.url,
          alt: n.alt || "",
          loading: "lazy",
          decoding: "async",
          referrerpolicy: "no-referrer",
          onError: (e) => e.target.replaceWith(h("span", { class: "md-img-fail", text: n.alt || "Imagen no disponible" })),
        });
      default:
        return document.createTextNode("");
    }
  });
}

function renderCells(tag, cells) {
  return cells.map((c) => h(tag, tag === "th" ? { scope: "col" } : null, renderInline(c)));
}

export function renderBlocks(blocks) {
  return blocks.map((b) => {
    switch (b.type) {
      case "paragraph":
        return h("p", null, renderInline(b.children));
      case "heading": {
        const tag = b.level <= 2 ? "h3" : b.level === 3 ? "h4" : "h5";
        return h(tag, { class: `md-h md-h${Math.min(b.level, 3)}` }, renderInline(b.children));
      }
      case "quote":
        return h("blockquote", null, renderBlocks(b.children));
      case "ul":
      case "ol":
        return h(
          b.type,
          null,
          b.items.map((it) => h("li", null, renderInline(it.inline), it.sub.length ? renderBlocks(it.sub) : null)),
        );
      case "code":
        return h("pre", null, h("code", { text: b.text }));
      case "hr":
        return h("hr");
      case "table":
        return h(
          "div",
          { class: "md-table" },
          h(
            "table",
            null,
            h("thead", null, h("tr", null, renderCells("th", b.head))),
            h("tbody", null, b.rows.map((row) => h("tr", null, renderCells("td", row)))),
          ),
        );
      default:
        return null;
    }
  });
}

export function renderMarkdown(markdown) {
  return h("div", { class: "md" }, renderBlocks(parse(markdown)));
}

// ---------- Lector (overlay) ----------

/**
 * Abre el post en pantalla completa. `post` es el de la lista (trae título, fecha y enlace aunque el cuerpo falle).
 * Devuelve la función que lo cierra. `onSubscribe` (opcional) añade «Recibir cada día» a los Spotlight.
 */
export function openReader({ account, post, onClose, onSubscribe }) {
  const opener = document.activeElement;
  const loading = () => [h("div", { class: "spinner", "aria-hidden": "true" }), h("p", { class: "sub", text: "Cargando…" })];
  const body = h("div", { class: "md-slot" }, loading());
  const ecency = safeLinkUrl(post.url);

  const meta = `@${post.author}${postDate(post.created) ? ` · ${postDate(post.created)}` : ""}`;
  const actions = h(
    "div",
    { class: "reader-actions" },
    post.spotlight && onSubscribe
      ? h("button", { type: "button", class: "btn", text: "Recibir cada día", onClick: () => { close(); onSubscribe(); } })
      : null,
    ecency ? h("button", { type: "button", class: "btn-ghost", text: "Abrir en Ecency", onClick: () => openLink(ecency) }) : null,
  );
  const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Cerrar post", onClick: () => close() }, icon(...ICONS.close));
  const scroller = h(
    "div",
    { class: "ov-body top" },
    h("article", { class: "reader" }, h("p", { class: "sub", text: meta }), h("h2", { class: "reader-title", text: post.title }), body, actions),
  );
  const overlay = h(
    "div",
    { class: "overlay", role: "dialog", "aria-modal": "true", "aria-label": post.title },
    h("div", { class: "ov-head" }, h("h2", { class: "ov-title", text: "Blog" }), closeBtn),
    scroller,
  );
  let open = true;
  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  function close() {
    if (!open) return;
    open = false;
    document.removeEventListener("keydown", onKey);
    hideBack();
    overlay.remove();
    if (opener && typeof opener.focus === "function") opener.focus();
    if (onClose) onClose();
  }

  async function loadBody() {
    body.replaceChildren(...loading());
    try {
      const data = await getBlogPost(account, post.permlink);
      if (!open) return;
      body.replaceChildren(renderMarkdown(data.post && data.post.body ? data.post.body : ""));
    } catch (e) {
      if (!open) return;
      const gone = e instanceof ApiError && e.status === 404;
      body.replaceChildren(
        h("p", { text: gone ? "Este post ya no está entre los últimos. Puedes leerlo en Ecency." : e instanceof ApiError && e.status === 0 ? "Sin conexión." : "No se pudo cargar el post." }),
        gone ? null : h("button", { type: "button", class: "btn", text: "Reintentar", onClick: loadBody }),
      );
    }
  }

  document.addEventListener("keydown", onKey);
  document.getElementById("app").append(overlay);
  showBack(close);
  closeBtn.focus();
  loadBody();
  return close;
}
