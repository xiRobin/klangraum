// Dünne Hülle um die Spotify Web API.
// Berücksichtigt die Development-Mode-Regeln seit Februar 2026
// (z. B. /playlists/{id}/items statt /tracks, /me/library statt /me/tracks-Writes).

import { getToken, AuthError } from './auth.js';

const BASE = 'https://api.spotify.com/v1';

export const session = { me: null };
export const likes = new Map(); // uri -> boolean

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let onAuthLost = () => {};
export const setAuthLostHandler = (fn) => (onAuthLost = fn);

function germanize(status, msg = '') {
  const m = msg.toLowerCase();
  if (status === 403 && m.includes('premium')) return 'Dafür braucht dein Account Spotify Premium.';
  if (status === 404 && m.includes('device')) {
    return 'Kein aktives Gerät. Wähle unten rechts ein Gerät aus oder öffne Spotify irgendwo.';
  }
  if (status === 403 && m.includes('restriction')) return 'Diese Aktion ist gerade nicht möglich.';
  if (status === 403) return `Kein Zugriff (403): ${msg}`;
  if (status === 429) return 'Zu viele Anfragen – kurz warten.';
  return msg || `Fehler ${status}`;
}

export async function api(path, { method = 'GET', query, body, retry = true } = {}) {
  let url = path.startsWith('http') ? path : BASE + path;
  if (query) {
    const q = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    );
    const qs = q.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  let token;
  try {
    token = await getToken();
  } catch (e) {
    if (e instanceof AuthError) onAuthLost(e);
    throw e;
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry) {
    try {
      await getToken(true);
    } catch (e) {
      onAuthLost(e);
      throw e;
    }
    return api(path, { method, query, body, retry: false });
  }
  if (res.status === 429 && retry) {
    const wait = Number(res.headers.get('Retry-After')) || 2;
    await sleep(Math.min(wait, 10) * 1000);
    return api(path, { method, query, body, retry: false });
  }
  if (res.status === 204 || res.status === 202) return null;

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, germanize(res.status, data?.error?.message || data?.error_description));
  }
  return data;
}

/** Holt alle Seiten eines Paging-Objekts (bis max Einträge). */
export async function fetchAll(path, query = {}, max = 200) {
  let page = await api(path, { query: { limit: 50, ...query } });
  const items = [...(page?.items || [])];
  while (page?.next && items.length < max) {
    page = await api(page.next);
    items.push(...(page?.items || []));
  }
  return items.filter(Boolean);
}

// --- Bibliothek (neue /me/library-Endpunkte, arbeiten mit URIs) ---

export async function libraryContains(uris) {
  const out = [];
  for (let i = 0; i < uris.length; i += 40) {
    const chunk = uris.slice(i, i + 40);
    const r = await api('/me/library/contains', { query: { uris: chunk.join(',') } });
    out.push(...(Array.isArray(r) ? r : chunk.map(() => false)));
  }
  return out;
}

export function librarySave(uri, save) {
  return api('/me/library', { method: save ? 'PUT' : 'DELETE', query: { uris: uri } });
}

// --- Normalisierung: API- und SDK-Tracks auf eine gemeinsame Form bringen ---

export const idFromUri = (uri) => (uri ? uri.split(':').pop() : null);

export function normTrack(t, albumFallback) {
  if (!t) return null;
  const artists = t.artists || (t.show ? [{ name: t.show.name, id: null }] : []);
  return {
    uri: t.uri,
    id: t.id,
    name: t.name,
    type: t.type,
    artists: artists.map((a) => ({ name: a.name, id: a.id ?? (a.uri ? idFromUri(a.uri) : null) })),
    album: t.album
      ? { id: t.album.id ?? idFromUri(t.album.uri), name: t.album.name, images: t.album.images }
      : albumFallback ?? { id: null, name: t.show?.name || '', images: t.images },
    duration_ms: t.duration_ms,
    explicit: t.explicit,
    is_local: t.is_local,
    track_number: t.track_number,
  };
}
