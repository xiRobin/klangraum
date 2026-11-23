// Wiedergabe-Zustand: lokales Web Playback SDK ("dieser Browser") + Spotify Connect (andere Geräte).

import { api, normTrack } from './api.js';
import { getToken } from './auth.js';
import { toast } from './util.js';

const VOL_KEY = 'kr.volume';

// Spotify unterstützt das Web Playback SDK nicht in mobilen Browsern (iOS/Android).
// Dort ist Klangraum eine Fernbedienung für die Spotify-App oder andere Geräte.
export const IS_MOBILE =
  /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const NO_DEVICE_MOBILE =
  'Kein Gerät gefunden. Öffne kurz die Spotify-App (Lautsprecher-Symbol unten → „Spotify-App öffnen“) und versuch es nochmal.';

export const state = {
  sdk: null,
  localDeviceId: null,
  sdkReady: false,
  sdkError: null,
  remoteOnly: false,
  track: null,
  isPlaying: false,
  progress: 0,
  duration: 0,
  ts: 0,
  shuffle: false,
  repeat: 'off',
  device: null,
  contextUri: null,
  volume: Number(localStorage.getItem(VOL_KEY) ?? 60),
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn(state));

export const isLocal = () => !!state.localDeviceId && state.device?.id === state.localDeviceId;

export function currentProgress() {
  if (!state.isPlaying) return state.progress;
  return Math.min(state.duration || Infinity, state.progress + (performance.now() - state.ts));
}

// ---------- SDK ----------

export function initSdk() {
  if (state.sdk || document.getElementById('spotify-sdk')) return;
  if (IS_MOBILE) {
    state.remoteOnly = true;
    state.sdkError =
      'Auf dem Handy erlaubt Spotify kein Abspielen im Browser. Klangraum steuert stattdessen die Spotify-App oder ein anderes Gerät.';
    emit();
    return;
  }
  window.onSpotifyWebPlaybackSDKReady = () => {
    const p = new window.Spotify.Player({
      name: 'Klangraum',
      getOAuthToken: (cb) => getToken().then(cb).catch(() => {}),
      volume: state.volume / 100,
    });
    const fail = (msg) => {
      state.sdkError = msg;
      emit();
    };
    p.addListener('ready', ({ device_id }) => {
      state.localDeviceId = device_id;
      state.sdkReady = true;
      state.sdkError = null;
      emit();
      refresh();
    });
    p.addListener('not_ready', () => {
      state.sdkReady = false;
      emit();
    });
    p.addListener('initialization_error', ({ message }) =>
      fail(`Dieser Browser kann Spotify nicht direkt abspielen (DRM fehlt): ${message}`),
    );
    p.addListener('authentication_error', ({ message }) => fail(`SDK-Login fehlgeschlagen: ${message}`));
    p.addListener('account_error', () => fail('Abspielen im Browser braucht Spotify Premium.'));
    p.addListener('playback_error', ({ message }) => toast(`Wiedergabefehler: ${message}`, 'error'));
    p.addListener('autoplay_failed', () =>
      toast('Der Browser hat Autoplay blockiert – einmal auf Play klicken.'),
    );
    p.addListener('player_state_changed', (s) => {
      if (!s) {
        // Wiedergabe wurde auf ein anderes Gerät verschoben
        refresh();
        return;
      }
      applySdkState(s);
    });
    p.connect();
    state.sdk = p;
  };
  const sc = document.createElement('script');
  sc.id = 'spotify-sdk';
  sc.src = 'https://sdk.scdn.co/spotify-player.js';
  sc.onerror = () => {
    state.sdkError = 'Das Web Playback SDK konnte nicht geladen werden.';
    emit();
  };
  document.head.append(sc);
}

export function disconnectSdk() {
  state.sdk?.disconnect();
}

function applySdkState(s) {
  const t = s.track_window?.current_track;
  state.track = t ? normTrack(t) : null;
  state.isPlaying = !s.paused;
  state.progress = s.position;
  state.duration = s.duration;
  state.ts = performance.now();
  state.shuffle = s.shuffle;
  state.repeat = ['off', 'context', 'track'][s.repeat_mode] || 'off';
  state.contextUri = s.context?.uri || null;
  state.device = { id: state.localDeviceId, name: 'Klangraum (dieser Browser)', type: 'Computer' };
  emit();
}

function applyApiState(s) {
  const it = s.item;
  state.track = it ? normTrack(it) : null;
  state.isPlaying = !!s.is_playing;
  state.progress = s.progress_ms ?? 0;
  state.duration = it?.duration_ms ?? 0;
  state.ts = performance.now();
  state.shuffle = !!s.shuffle_state;
  state.repeat = s.repeat_state || 'off';
  state.device = s.device || null;
  state.contextUri = s.context?.uri || null;
  if (s.device?.volume_percent != null && !isLocal()) state.volume = s.device.volume_percent;
  emit();
}

// ---------- Synchronisation ----------

let refreshing = false;
export async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const s = await api('/me/player', { query: { additional_types: 'episode' } });
    if (s) applyApiState(s);
    else if (!isLocal()) {
      state.device = null;
      state.isPlaying = false;
      emit();
    }
  } catch {
    /* still – nächster Poll versucht es erneut */
  } finally {
    refreshing = false;
  }
}

const later = (ms = 700) => setTimeout(refresh, ms);

let tick = 0;
export function startPolling() {
  setInterval(() => {
    if (document.hidden) return;
    tick++;
    // Lokales Gerät meldet sich selbst; fremde Geräte alle 4 s abfragen.
    if (!isLocal() || tick % 5 === 0) refresh();
  }, 4000);
  document.addEventListener('visibilitychange', () => !document.hidden && refresh());
  refresh();
}

// ---------- Befehle ----------

/** Muss synchron im Klick-Handler laufen, damit der Browser Audio erlaubt. */
function activate() {
  try {
    state.sdk?.activateElement?.();
  } catch {
    /* egal */
  }
}

function noDeviceMessage() {
  if (state.remoteOnly) return NO_DEVICE_MOBILE;
  return (
    state.sdkError ||
    'Kein Abspielgerät verfügbar. Öffne Spotify auf einem Gerät oder warte, bis der Browser-Player bereit ist.'
  );
}

function targetDevice() {
  const id = state.device?.id || state.localDeviceId;
  if (!id) throw new Error(noDeviceMessage());
  return id;
}

/** Wie targetDevice, sucht aber notfalls ein verfügbares Gerät (z. B. die Spotify-App auf dem iPhone). */
async function resolveDevice() {
  const id = state.device?.id || state.localDeviceId;
  if (id) return id;
  const devs = await listDevices().catch(() => []);
  const pick =
    devs.find((d) => d.is_active) ||
    (IS_MOBILE && devs.find((d) => d.type === 'Smartphone')) ||
    devs[0];
  if (!pick) throw new Error(noDeviceMessage());
  return pick.id;
}

export async function playContext(opts = {}) {
  activate();
  const device_id = await resolveDevice();
  await api('/me/player/play', { method: 'PUT', query: { device_id }, body: opts });
  later(500);
}

export async function togglePlay() {
  activate();
  if (isLocal() && state.sdk) {
    await state.sdk.togglePlay();
    return;
  }
  const device_id = await resolveDevice();
  const wasPlaying = state.isPlaying;
  state.progress = currentProgress();
  state.ts = performance.now();
  state.isPlaying = !wasPlaying;
  emit();
  try {
    await api(wasPlaying ? '/me/player/pause' : '/me/player/play', { method: 'PUT', query: { device_id } });
  } catch (e) {
    state.isPlaying = wasPlaying;
    emit();
    throw e;
  }
  later();
}

export async function next() {
  activate();
  if (isLocal() && state.sdk) return state.sdk.nextTrack();
  await api('/me/player/next', { method: 'POST', query: { device_id: targetDevice() } });
  later();
}

export async function prev() {
  activate();
  if (isLocal() && state.sdk) return state.sdk.previousTrack();
  await api('/me/player/previous', { method: 'POST', query: { device_id: targetDevice() } });
  later();
}

export async function seek(ms) {
  state.progress = ms;
  state.ts = performance.now();
  emit();
  if (isLocal() && state.sdk) return state.sdk.seek(ms);
  await api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.round(ms), device_id: targetDevice() } });
  later();
}

let volTimer;
export function setVolume(pct) {
  state.volume = Math.round(pct);
  localStorage.setItem(VOL_KEY, String(state.volume));
  emit();
  if (isLocal() && state.sdk) {
    state.sdk.setVolume(state.volume / 100);
    return;
  }
  clearTimeout(volTimer);
  volTimer = setTimeout(() => {
    if (!state.device?.id) return;
    api('/me/player/volume', { method: 'PUT', query: { volume_percent: state.volume, device_id: state.device.id } }).catch(
      (e) => toast(e.message, 'error'),
    );
  }, 250);
}

export async function toggleShuffle() {
  const v = !state.shuffle;
  state.shuffle = v;
  emit();
  await api('/me/player/shuffle', { method: 'PUT', query: { state: v, device_id: targetDevice() } });
  later();
}

export async function cycleRepeat() {
  const order = ['off', 'context', 'track'];
  const v = order[(order.indexOf(state.repeat) + 1) % 3];
  state.repeat = v;
  emit();
  await api('/me/player/repeat', { method: 'PUT', query: { state: v, device_id: targetDevice() } });
  later();
}

export async function transferTo(deviceId) {
  activate();
  await api('/me/player', { method: 'PUT', body: { device_ids: [deviceId], play: true } });
  later(900);
}

export async function addToQueue(uri) {
  await api('/me/player/queue', { method: 'POST', query: { uri, device_id: targetDevice() } });
}

export async function listDevices() {
  const r = await api('/me/player/devices');
  const devs = r?.devices || [];
  if (state.localDeviceId && !devs.some((d) => d.id === state.localDeviceId)) {
    devs.unshift({ id: state.localDeviceId, name: 'Klangraum', type: 'Computer', is_active: isLocal() });
  }
  return devs;
}
