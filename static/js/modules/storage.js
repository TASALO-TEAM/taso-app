// Almacenamiento local tolerante: si localStorage no existe o falla, la app sigue funcionando sin él.
// (Los ajustes sincronizados llegarán con CloudStorage en S7; aquí solo caché y preferencias menores.)

export function load(key, fallback = null) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

export function save(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (_) {
    return false;
  }
}
