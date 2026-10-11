// Pestaña Blog: cuentas de Hive (@tasalo, @ersusoficial), tarjeta del Spotlight y lista de posts; el lector es un overlay.
// Sin innerHTML (todo por h()/icon()); sin estilos en línea (CSP). La lógica pura vive en modules/blog.js.
import { ApiError, getBlog } from "../modules/api.js";
import {
  ACCOUNTS, blogBanner, DEFAULT_ACCOUNT, normalizeAccount, postDate, SPOTLIGHT_ALERT_HASH, SPOTLIGHT_ALERT_READY,
  spotlightLabel, spotlightOf, validPosts,
} from "../modules/blog.js";
import { h, icon, ICONS } from "../modules/dom.js";
import { load, save } from "../modules/storage.js";
import { openReader } from "./blog-reader.js";

const ACCOUNT_KEY = "tasalo:blog:account";
const dataKey = (account) => `tasalo:blog:${account}`;
const REFRESH_MS = 10 * 60 * 1000; // el servidor ya cachea 10 min
const FOCUS_REFRESH_MS = 5 * 60 * 1000;

const validCache = (c) => Boolean(c && typeof c === "object" && c.data && Array.isArray(c.data.posts));

/** Monta la pestaña. ctx = { view, actions, setSubtitle }. Devuelve la función que la desmonta. */
export function mount(ctx) {
  let account = normalizeAccount(load(ACCOUNT_KEY, DEFAULT_ACCOUNT));
  const states = new Map();
  const stateOf = (acc) => {
    if (!states.has(acc)) {
      const cache = load(dataKey(acc), null);
      states.set(acc, {
        data: validCache(cache) ? cache.data : null,
        savedAt: validCache(cache) && Number.isFinite(cache.savedAt) ? cache.savedAt : 0,
        apiError: false,
        offlineError: false,
        refreshing: false,
      });
    }
    return states.get(acc);
  };
  let alive = true;
  let now = Date.now();
  let closeReader = null;

  const chipButtons = ACCOUNTS.map((a) =>
    h("button", { type: "button", class: "chip", dataset: { account: a.id }, text: a.label, onClick: () => selectAccount(a.id) }),
  );
  const selector = h("div", { class: "chips", role: "group", "aria-label": "Cuenta del blog" }, chipButtons);
  const bannerSlot = h("div", { class: "slot" });
  const spotlightSlot = h("div", { class: "slot" });
  const listSlot = h("div", { class: "slot" });
  ctx.view.replaceChildren(selector, bannerSlot, spotlightSlot, listSlot);

  const refreshBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "Actualizar blog", onClick: () => refresh() }, icon(...ICONS.refresh));
  ctx.actions.replaceChildren(refreshBtn);

  // ---------- Datos ----------
  async function refresh(acc = account) {
    const st = stateOf(acc);
    if (st.refreshing || !alive) return;
    st.refreshing = true;
    if (acc === account) render();
    try {
      const data = await getBlog(acc);
      if (!alive) return;
      st.data = data;
      st.apiError = false;
      st.offlineError = false;
      st.savedAt = Date.now();
      save(dataKey(acc), { data, savedAt: st.savedAt });
    } catch (e) {
      if (!alive) return;
      st.offlineError = e instanceof ApiError && e.status === 0;
      st.apiError = !st.offlineError;
    }
    st.refreshing = false;
    now = Date.now();
    if (acc === account) render();
  }

  function selectAccount(id) {
    if (id === account) return;
    account = normalizeAccount(id);
    save(ACCOUNT_KEY, account);
    render();
    const st = stateOf(account);
    if (!st.data || Date.now() - st.savedAt > FOCUS_REFRESH_MS) refresh(account);
  }

  // ---------- Render ----------
  function openPost(post) {
    if (closeReader) return;
    closeReader = openReader({
      account,
      post,
      onClose: () => {
        closeReader = null;
      },
      onSubscribe: SPOTLIGHT_ALERT_READY
        ? () => {
            location.hash = SPOTLIGHT_ALERT_HASH;
          }
        : null,
    });
  }

  function postCard(post) {
    const date = postDate(post.created);
    return h(
      "article",
      {
        class: "card post",
        role: "button",
        tabindex: "0",
        "aria-label": `${post.title}. Leer`,
        onClick: () => openPost(post),
        onKeydown: (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPost(post);
          }
        },
      },
      h("h3", { class: "post-title", text: post.title }),
      post.summary ? h("p", { class: "sub post-summary", text: post.summary }) : null,
      h("div", { class: "sub", text: `${date ? `${date} · ` : ""}@${post.author}` }),
    );
  }

  function spotlightCard(post) {
    return h(
      "section",
      { class: "card card-accent", "aria-label": "Spotlight" },
      h("h2", { class: "label", text: spotlightLabel(post, now) }),
      h("h3", { class: "post-title", text: post.title }),
      post.summary ? h("p", { class: "sub", text: post.summary }) : null,
      h(
        "div",
        { class: "post-actions" },
        h("button", { type: "button", class: "btn", text: "Leer", onClick: () => openPost(post) }),
        SPOTLIGHT_ALERT_READY
          ? h("button", { type: "button", class: "btn-ghost", text: "Recibir cada día", onClick: () => { location.hash = SPOTLIGHT_ALERT_HASH; } })
          : null,
      ),
    );
  }

  function render() {
    const st = stateOf(account);
    for (const btn of chipButtons) btn.setAttribute("aria-pressed", btn.dataset.account === account ? "true" : "false");
    ctx.setSubtitle(`@${account} · Hive`);
    refreshBtn.disabled = st.refreshing;
    refreshBtn.classList.toggle("spinning", st.refreshing);

    const banner = st.data
      ? blogBanner({
          fetchedAt: st.data.fetched_at,
          now,
          offline: st.offlineError || navigator.onLine === false,
          apiError: st.apiError,
          stale: Boolean(st.data.stale),
        })
      : null;
    bannerSlot.replaceChildren(...(banner ? [h("div", { class: "notice", role: "status", text: banner.text })] : []));

    if (!st.data) {
      spotlightSlot.replaceChildren();
      if (st.refreshing || (!st.apiError && !st.offlineError)) {
        listSlot.replaceChildren(h("div", { class: "flist", "aria-busy": "true" }, [1, 2, 3].map(() => h("div", { class: "skeleton" }))));
      } else {
        listSlot.replaceChildren(
          h(
            "div",
            { class: "card center" },
            h("p", { text: st.offlineError ? "Sin conexión y sin datos guardados." : "No se pudo cargar el blog." }),
            h("button", { type: "button", class: "btn", text: "Reintentar", onClick: () => refresh() }),
          ),
        );
      }
      return;
    }

    const posts = validPosts(st.data);
    const featured = account === "tasalo" ? spotlightOf(posts) : null;
    spotlightSlot.replaceChildren(...(featured ? [spotlightCard(featured)] : []));
    const rest = posts.filter((p) => p !== featured);
    if (rest.length === 0 && !featured) {
      listSlot.replaceChildren(h("p", { class: "empty", text: "Todavía no hay posts" }));
      return;
    }
    listSlot.replaceChildren(h("div", { class: "flist" }, rest.map(postCard)));
  }

  // ---------- Vida de la pantalla ----------
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    now = Date.now();
    render();
    if (now - stateOf(account).savedAt > FOCUS_REFRESH_MS) refresh();
  };
  const onOnline = () => {
    stateOf(account).offlineError = false;
    refresh();
  };
  const onOffline = () => render();
  const tick = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    now = Date.now();
    if (now - stateOf(account).savedAt > REFRESH_MS) refresh();
    else render();
  }, 60 * 1000);

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);

  render();
  refresh();

  return () => {
    alive = false;
    clearInterval(tick);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    if (closeReader) closeReader();
    ctx.actions.replaceChildren();
    ctx.setSubtitle("");
  };
}
