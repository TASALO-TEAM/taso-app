// Copiar al portapapeles con plan B: la API moderna solo existe en contextos seguros y a veces el webview la niega.
// Debe llamarse desde un gesto de la persona (clic). Devuelve true si el texto quedó copiado.
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {
    /* se prueba el plan B */
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.setAttribute("aria-hidden", "true");
    area.className = "clip-fallback";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return Boolean(ok);
  } catch (_) {
    return false;
  }
}
