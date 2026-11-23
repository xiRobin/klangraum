// Spotify-Login per Authorization Code Flow mit PKCE.
// Kein Client Secret nötig – alles läuft im Browser.

import { DEFAULT_CLIENT_ID } from './config.js';

const LS = {
  clientId: 'kr.clientId',
  tokens: 'kr.tokens',
  verifier: 'kr.verifier',
  state: 'kr.state',
};

export const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
  'user-library-read',
  'user-library-modify',
  'user-follow-read',
  'playlist-read-private',
  'playlist-read-collaborative',
];

export class AuthError extends Error {}

// Funktioniert lokal (http://127.0.0.1:8888/) und gehostet in Unterordnern (https://name.github.io/klangraum/).
export const redirectUri = () => `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
export const getClientId = () => localStorage.getItem(LS.clientId) || DEFAULT_CLIENT_ID || '';
export const setClientId = (id) => localStorage.setItem(LS.clientId, id.trim());

function base64url(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(len) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return base64url(a);
}

function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(LS.tokens) || 'null');
  } catch {
    return null;
  }
}

function saveTokens(t) {
  localStorage.setItem(LS.tokens, JSON.stringify(t));
}

export const isLoggedIn = () => !!readTokens()?.refresh_token;

export function logout() {
  localStorage.removeItem(LS.tokens);
}

export async function login() {
  const verifier = randomString(64);
  const challenge = base64url(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
  );
  const state = randomString(16);
  localStorage.setItem(LS.verifier, verifier);
  localStorage.setItem(LS.state, state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: getClientId(),
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    redirect_uri: redirectUri(),
    state,
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AuthError(json.error_description || json.error || `Token-Fehler (${res.status})`);
  }
  const old = readTokens();
  saveTokens({
    access_token: json.access_token,
    refresh_token: json.refresh_token || old?.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  });
}

/** Verarbeitet die Rückkehr von accounts.spotify.com. Gibt true zurück, wenn ein Login stattfand. */
export async function handleRedirect() {
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) return false;
  history.replaceState(null, '', location.pathname + location.hash);

  if (p.get('error')) throw new AuthError(`Login abgebrochen (${p.get('error')}).`);
  if (p.get('state') !== localStorage.getItem(LS.state)) {
    throw new AuthError('Ungültiger Login-Status – bitte noch einmal verbinden.');
  }
  await tokenRequest(
    new URLSearchParams({
      client_id: getClientId(),
      grant_type: 'authorization_code',
      code: p.get('code'),
      redirect_uri: redirectUri(),
      code_verifier: localStorage.getItem(LS.verifier) || '',
    }),
  );
  localStorage.removeItem(LS.verifier);
  localStorage.removeItem(LS.state);
  return true;
}

let refreshing = null;

/** Liefert ein gültiges Access Token und erneuert es bei Bedarf. */
export async function getToken(force = false) {
  const t = readTokens();
  if (!t?.refresh_token) throw new AuthError('Nicht eingeloggt.');
  if (!force && t.expires_at - 60_000 > Date.now()) return t.access_token;

  if (!refreshing) {
    refreshing = tokenRequest(
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: t.refresh_token,
        client_id: getClientId(),
      }),
    ).finally(() => (refreshing = null));
  }
  await refreshing;
  return readTokens().access_token;
}
