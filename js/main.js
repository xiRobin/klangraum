import { getClientId, setClientId, isLoggedIn, login, logout, handleRedirect, redirectUri } from './auth.js';
import { api, fetchAll, session, likes, libraryContains, setAuthLostHandler } from './api.js';
import * as P from './player.js';
import { render, playFromList, toggleLike, markPlaying, paintLike } from './views.js';
import { icon, LOGO } from './icons.js';
import { $, $$, esc, fmtTime, img, artistsHtml, toast, dominantColor } from './util.js';

// Spotify akzeptiert nur 127.0.0.1 als Loopback-Redirect, nicht "localhost".
if (location.hostname === 'localhost') {
  location.replace(location.href.replace('//localhost', '//127.0.0.1'));
}

const root = $('#root');

// ---------- Setup / Login ----------

function showSetup(error) {
  document.title = 'Klangraum';
  const cid = getClientId();
  root.innerHTML = `<div class="setup"><div class="setup-card">
  <div class="brand big">${LOGO}<span>Klangraum</span></div>
  <p class="lead">Dein privater Spotify-Client. Läuft komplett in deinem Browser – kein eigener Server, kein Client Secret, keine Daten bei Dritten.</p>
  ${error ? `<div class="alert">${esc(error)}</div>` : ''}
  <ol class="steps">
    <li>Öffne das <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">Spotify Developer Dashboard</a> und klicke auf <b>Create app</b>.</li>
    <li>Trage als <b>Redirect URI</b> genau diese Adresse ein:
      <div class="copy"><code>${esc(redirectUri())}</code><button type="button" class="btn-ghost" id="copy-ru">Kopieren</button></div></li>
    <li>Wähle bei den APIs <b>Web API</b> und <b>Web Playback SDK</b> aus und speichere.</li>
    <li>Kopiere die <b>Client ID</b> aus den Einstellungen der App hierher:</li>
  </ol>
  <form id="setup-form" class="setup-form">
    <input id="cid" placeholder="Client ID (32 Zeichen)" value="${esc(cid)}" pattern="[0-9a-fA-F]{32}" title="32 Hex-Zeichen" required spellcheck="false" autocomplete="off">
    <button class="btn-primary" type="submit">Mit Spotify verbinden</button>
  </form>
  <p class="fine">Gut zu wissen: Seit 2026 muss der Besitzer der Developer-App Spotify Premium haben, und im Development Mode dürfen höchstens 5 Accounts die App nutzen (weitere unter <i>User Management</i> eintragen). Abspielen direkt im Browser braucht Premium und einen Browser mit DRM-Unterstützung (Chrome, Edge, Firefox). Auf dem iPhone ist Klangraum eine Fernbedienung für die Spotify-App – über „Teilen → Zum Home-Bildschirm“ wird es zur App.</p>
</div></div>`;
  $('#copy-ru').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(redirectUri());
      e.target.textContent = 'Kopiert ✓';
    } catch {
      e.target.textContent = 'Bitte manuell kopieren';
    }
  });
  $('#setup-form').addEventListener('submit', (e) => {
    e.preventDefault();
    setClientId($('#cid').value);
    login().catch((err) => showSetup(err.message));
  });
}

function doLogout() {
  P.disconnectSdk();
  logout();
  location.hash = '';
  location.reload();
}

// ---------- App-Shell ----------

function shellHtml() {
  return `<div id="app">
  <aside class="sidebar">
    <nav class="side-box nav" aria-label="Hauptnavigation">
      <div class="brand">${LOGO}<span>Klangraum</span></div>
      <a href="#/home" data-nav="home">${icon('home')}<span>Start</span></a>
      <a href="#/search" data-nav="search">${icon('search')}<span>Suche</span></a>
      <a href="#/library" data-nav="library">${icon('library')}<span>Bibliothek</span></a>
    </nav>
    <div class="side-box side-lib">
      <div class="side-head">Deine Sammlung</div>
      <a class="side-item" href="#/liked" data-nav="liked">
        <div class="side-thumb liked-thumb">${icon('heart')}</div>
        <div class="si-text"><div class="si-title">Lieblingssongs</div><div class="si-sub">Playlist</div></div>
      </a>
      <div id="side-playlists"></div>
    </div>
    <div class="side-box side-user" id="side-user"></div>
  </aside>
  <main id="main">
    <div class="topbar">
      <button class="round-btn" id="nav-back" aria-label="Zurück">${icon('back')}</button>
      <button class="round-btn" id="nav-fwd" aria-label="Vor">${icon('forward')}</button>
    </div>
    <div id="view" class="view"></div>
  </main>
  <footer class="player" id="player">
    <div class="pl-left">
      <a class="pl-cover" id="pl-cover-link"><img id="pl-cover" alt="" hidden><div class="pl-cover-ph">${icon('note')}</div></a>
      <div class="pl-meta"><div class="pl-title" id="pl-title">Nichts läuft</div><div class="pl-artist" id="pl-artist"></div></div>
      <button class="icon-btn like" id="pl-like" hidden aria-label="Gefällt mir">${icon('heartOutline')}</button>
    </div>
    <div class="pl-center">
      <div class="pl-controls">
        <button class="icon-btn" id="btn-shuffle" aria-label="Zufallswiedergabe">${icon('shuffle')}</button>
        <button class="icon-btn" id="btn-prev" aria-label="Zurück">${icon('prev')}</button>
        <button class="play-btn" id="btn-play" aria-label="Abspielen">${icon('play')}</button>
        <button class="icon-btn" id="btn-next" aria-label="Weiter">${icon('next')}</button>
        <button class="icon-btn" id="btn-repeat" aria-label="Wiederholen">${icon('repeat')}</button>
      </div>
      <div class="pl-progress">
        <span class="t" id="t-cur">0:00</span>
        <input type="range" id="seek" min="0" max="1000" value="0" aria-label="Position">
        <span class="t" id="t-dur">0:00</span>
      </div>
    </div>
    <div class="pl-right">
      <a class="icon-btn" href="#/queue" aria-label="Warteschlange" title="Warteschlange">${icon('queue')}</a>
      <div class="dev-wrap">
        <button class="icon-btn" id="btn-devices" aria-label="Geräte" title="Geräte">${icon('speaker')}</button>
        <div class="dev-pop" id="dev-pop" hidden></div>
      </div>
      <button class="icon-btn" id="btn-mute" aria-label="Stumm">${icon('volume')}</button>
      <input type="range" id="vol" min="0" max="100" aria-label="Lautstärke">
    </div>
    <div class="pl-device" id="pl-device" hidden></div>
    <div class="pl-mini-progress"><i id="mini-bar"></i></div>
  </footer>
  <section class="np" id="np" hidden aria-label="Jetzt läuft">
    <div class="np-top">
      <button class="icon-btn" id="np-close" aria-label="Schließen">${icon('down')}</button>
      <div class="np-label">Jetzt läuft</div>
      <a class="icon-btn" href="#/queue" aria-label="Warteschlange">${icon('queue')}</a>
    </div>
    <div class="np-cover"><img id="np-img" alt="" hidden><div class="np-ph">${icon('note')}</div></div>
    <div class="np-row">
      <div class="np-meta"><div class="np-title" id="np-title">Nichts läuft</div><div class="np-artist" id="np-artist"></div></div>
      <button class="icon-btn like" id="np-like" hidden aria-label="Gefällt mir">${icon('heartOutline')}</button>
    </div>
    <input type="range" id="np-seek" min="0" max="1000" value="0" aria-label="Position">
    <div class="np-times"><span id="np-cur">0:00</span><span id="np-dur">0:00</span></div>
    <div class="np-controls">
      <button class="icon-btn" data-act="shuffle" aria-label="Zufallswiedergabe">${icon('shuffle')}</button>
      <button class="icon-btn np-skip" data-act="prev" aria-label="Zurück">${icon('prev')}</button>
      <button class="np-play" data-act="play" aria-label="Abspielen">${icon('play')}</button>
      <button class="icon-btn np-skip" data-act="next" aria-label="Weiter">${icon('next')}</button>
      <button class="icon-btn" data-act="repeat" aria-label="Wiederholen">${icon('repeat')}</button>
    </div>
    <button class="np-device" id="np-devices">${icon('speaker')}<span id="np-devname">Gerät wählen</span></button>
    <div class="dev-pop np-devpop" id="np-devpop" hidden></div>
  </section>
</div>`;
}

async function loadSidebar() {
  try {
    const pls = await fetchAll('/me/playlists', {}, 200);
    $('#side-playlists').innerHTML = pls
      .map(
        (p) => `<a class="side-item" href="#/playlist/${esc(p.id)}" data-pl="${esc(p.id)}">
        <div class="side-thumb">${img(p.images, 64) ? `<img loading="lazy" src="${esc(img(p.images, 64))}" alt="">` : icon('note')}</div>
        <div class="si-text"><div class="si-title">${esc(p.name)}</div><div class="si-sub">Playlist · ${esc(p.owner?.display_name || '')}</div></div></a>`,
      )
      .join('');
    highlightNav();
  } catch (e) {
    $('#side-playlists').innerHTML = `<div class="si-sub pad">${esc(e.message)}</div>`;
  }
  const me = session.me;
  if (me) {
    const av = img(me.images, 64);
    $('#side-user').innerHTML = `<div class="avatar">${av ? `<img src="${esc(av)}" alt="">` : esc((me.display_name || '?')[0])}</div>
      <div class="si-text"><div class="si-title">${esc(me.display_name || me.id)}</div><div class="si-sub">verbunden</div></div>
      <button class="icon-btn" data-logout aria-label="Abmelden" title="Abmelden">${icon('logout')}</button>`;
  }
}

// ---------- Router ----------

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const name = parts.shift() || 'home';
  let arg = parts.join('/');
  try {
    arg = decodeURIComponent(arg);
  } catch {
    /* roh lassen */
  }
  return { name, arg };
}

let route = parseRoute();

function highlightNav() {
  $$('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === route.name));
  $$('[data-pl]').forEach((a) => a.classList.toggle('on', route.name === 'playlist' && a.dataset.pl === route.arg));
}

function onRoute() {
  route = parseRoute();
  highlightNav();
  $('#main').scrollTop = 0;
  render(route, $('#view'));
}

// ---------- Player-Leiste ----------

let seeking = false;
let lastTrackUri = null;
let lastVolume = 60;

function setRange(el, pct) {
  el.style.setProperty('--p', `${Math.max(0, Math.min(100, pct))}%`);
}

function renderPlayer(s) {
  const t = s.track;
  const cover = img(t?.album?.images, 64);
  const coverEl = $('#pl-cover');
  if (coverEl.dataset.src !== cover) {
    coverEl.dataset.src = cover;
    coverEl.hidden = !cover;
    if (cover) coverEl.src = cover;
  }
  const link = $('#pl-cover-link');
  if (t?.album?.id) link.href = `#/album/${t.album.id}`;
  else link.removeAttribute('href');
  $('#pl-title').innerHTML = t
    ? t.album?.id
      ? `<a href="#/album/${esc(t.album.id)}">${esc(t.name)}</a>`
      : esc(t.name)
    : 'Nichts läuft';
  $('#pl-artist').innerHTML = t
    ? artistsHtml(t.artists)
    : esc(s.remoteOnly ? 'Tippe einen Song an' : s.sdkError ? '' : s.sdkReady ? 'Bereit zum Abspielen' : '');

  const play = $('#btn-play');
  play.innerHTML = icon(s.isPlaying ? 'pause' : 'play');
  play.setAttribute('aria-label', s.isPlaying ? 'Pausieren' : 'Abspielen');
  $('#btn-shuffle').classList.toggle('on', s.shuffle);
  const rep = $('#btn-repeat');
  rep.classList.toggle('on', s.repeat !== 'off');
  rep.innerHTML = icon(s.repeat === 'track' ? 'repeatOne' : 'repeat');
  $('#t-dur').textContent = fmtTime(s.duration);

  const vol = $('#vol');
  if (document.activeElement !== vol) vol.value = s.volume;
  setRange(vol, s.volume);
  $('#btn-mute').innerHTML = icon(s.volume === 0 ? 'mute' : s.volume < 50 ? 'volumeLow' : 'volume');

  // Hinweis, wenn auf einem anderen Gerät gespielt wird
  const dev = $('#pl-device');
  const remote = s.device && !P.isLocal();
  dev.hidden = !remote;
  if (remote) dev.innerHTML = `${icon('speaker')} Wiedergabe auf <b>${esc(s.device.name)}</b>`;
  $('#btn-devices').classList.toggle('on', !!remote);

  // Like-Button des aktuellen Songs
  const like = $('#pl-like');
  const isTrack = t?.uri?.startsWith('spotify:track:');
  like.hidden = !isTrack;
  if (isTrack) {
    like.dataset.uri = t.uri;
    if (t.uri !== lastTrackUri && !likes.has(t.uri)) {
      libraryContains([t.uri])
        .then(([v]) => {
          likes.set(t.uri, !!v);
          $$('.like[data-uri]').filter((b) => b.dataset.uri === t.uri).forEach(paintLike);
        })
        .catch(() => {});
    }
    paintLike(like);
  }
  renderNowPlaying(s);

  if (t?.uri !== lastTrackUri) {
    lastTrackUri = t?.uri;
    if (route.name === 'queue') render(route, $('#view'));
  }

  document.title = t ? `${s.isPlaying ? '▶ ' : ''}${t.name} · ${t.artists.map((a) => a.name).join(', ')}` : 'Klangraum';
  updateMediaSession(s);
  markPlaying();
}

// ---------- Vollbild-Player „Jetzt läuft“ (Handy) ----------

function renderNowPlaying(s) {
  const np = $('#np');
  if (!np) return;
  const t = s.track;
  const big = img(t?.album?.images, 640);
  const im = $('#np-img');
  if (im.dataset.src !== big) {
    im.dataset.src = big;
    im.hidden = !big;
    if (big) im.src = big;
    dominantColor(big).then((c) => np.style.setProperty('--tint', c || '60, 50, 70'));
  }
  $('#np-title').innerHTML = t
    ? t.album?.id
      ? `<a href="#/album/${esc(t.album.id)}">${esc(t.name)}</a>`
      : esc(t.name)
    : 'Nichts läuft';
  $('#np-artist').innerHTML = t ? artistsHtml(t.artists) : esc(s.remoteOnly ? 'Wähle unten ein Gerät oder tippe einen Song an.' : '');
  const like = $('#np-like');
  const isTrack = t?.uri?.startsWith('spotify:track:');
  like.hidden = !isTrack;
  if (isTrack) {
    like.dataset.uri = t.uri;
    paintLike(like);
  }
  const play = $('#np [data-act="play"]');
  play.innerHTML = icon(s.isPlaying ? 'pause' : 'play');
  play.setAttribute('aria-label', s.isPlaying ? 'Pausieren' : 'Abspielen');
  $('#np [data-act="shuffle"]').classList.toggle('on', s.shuffle);
  const rep = $('#np [data-act="repeat"]');
  rep.classList.toggle('on', s.repeat !== 'off');
  rep.innerHTML = icon(s.repeat === 'track' ? 'repeatOne' : 'repeat');
  $('#np-dur').textContent = fmtTime(s.duration);
  $('#np-devname').textContent = s.device ? s.device.name : 'Gerät wählen';
  $('#np-devices').classList.toggle('on', !!s.device);
}

function openNowPlaying() {
  const np = $('#np');
  np.hidden = false;
  tickProgress();
  requestAnimationFrame(() => np.classList.add('open'));
}

function closeNowPlaying() {
  const np = $('#np');
  if (!np || np.hidden) return;
  np.classList.remove('open');
  $('#np-devpop').hidden = true;
  setTimeout(() => {
    if (!np.classList.contains('open')) np.hidden = true;
  }, 260);
}

function updateMediaSession(s) {
  if (!('mediaSession' in navigator) || !s.track) return;
  const t = s.track;
  const art = img(t.album?.images, 300);
  const ms = navigator.mediaSession;
  if (ms.metadata?.title !== t.name) {
    ms.metadata = new MediaMetadata({
      title: t.name,
      artist: t.artists.map((a) => a.name).join(', '),
      album: t.album?.name || '',
      artwork: art ? [{ src: art, sizes: '300x300', type: 'image/jpeg' }] : [],
    });
  }
  ms.playbackState = s.isPlaying ? 'playing' : 'paused';
}

function tickProgress() {
  if (seeking) return;
  const cur = P.currentProgress();
  const dur = P.state.duration || 0;
  const pct = dur ? (cur / dur) * 100 : 0;
  const seek = $('#seek');
  if (!seek) return;
  seek.value = dur ? Math.round((cur / dur) * 1000) : 0;
  setRange(seek, pct);
  $('#t-cur').textContent = fmtTime(cur);
  $('#mini-bar').style.width = `${pct}%`;
  if (!$('#np').hidden) {
    const ns = $('#np-seek');
    ns.value = seek.value;
    setRange(ns, pct);
    $('#np-cur').textContent = fmtTime(cur);
  }
}

const run = (fn) => () => {
  try {
    Promise.resolve(fn()).catch((e) => toast(e.message, 'error'));
  } catch (e) {
    toast(e.message, 'error');
  }
};

async function openDevices(pop = $('#dev-pop')) {
  pop.hidden = false;
  pop.innerHTML = '<div class="dev-title">Mit Gerät verbinden</div><div class="loading small"><div class="spinner"></div></div>';
  try {
    const devs = await P.listDevices();
    const typeIcon = (d) => (d.type === 'Smartphone' ? 'phone' : d.type === 'Computer' ? 'computer' : 'speaker');
    pop.innerHTML = `<div class="dev-title">Mit Gerät verbinden</div>${
      devs.length
        ? devs
            .map((d) => {
              const active = d.is_active || P.state.device?.id === d.id;
              const local = d.id === P.state.localDeviceId;
              return `<button class="dev-item ${active ? 'on' : ''}" data-device="${esc(d.id)}">${icon(typeIcon(d))}
                <span><b>${esc(local ? 'Dieser Browser' : d.name)}</b><small>${active ? 'Aktiv' : esc(local ? 'Klangraum' : d.type)}</small></span></button>`;
            })
            .join('')
        : '<p class="fine">Keine Geräte gefunden. Öffne Spotify auf deinem Handy oder PC.</p>'
    }${
      P.IS_MOBILE
        ? `<a class="btn-ghost dev-open" href="spotify:">${icon('phone')} Spotify-App öffnen</a>
           <p class="fine">Die Musik läuft in der Spotify-App, Klangraum ist die Fernbedienung. Danach einfach hierher zurückwechseln.</p>`
        : P.state.sdkError
          ? `<p class="fine warn">${esc(P.state.sdkError)}</p>`
          : ''
    }`;
  } catch (e) {
    pop.innerHTML = `<p class="fine warn">${esc(e.message)}</p>`;
  }
}

function bindPlayer() {
  $('#btn-play').addEventListener('click', run(P.togglePlay));
  $('#btn-next').addEventListener('click', run(P.next));
  $('#btn-prev').addEventListener('click', run(P.prev));
  $('#btn-shuffle').addEventListener('click', run(P.toggleShuffle));
  $('#btn-repeat').addEventListener('click', run(P.cycleRepeat));

  const bindSeek = (input, curEl) => {
    input.addEventListener('input', () => {
      seeking = true;
      const ms = (input.value / 1000) * (P.state.duration || 0);
      setRange(input, input.value / 10);
      curEl.textContent = fmtTime(ms);
    });
    input.addEventListener('change', () => {
      const ms = (input.value / 1000) * (P.state.duration || 0);
      seeking = false;
      run(() => P.seek(ms))();
    });
  };
  bindSeek($('#seek'), $('#t-cur'));
  bindSeek($('#np-seek'), $('#np-cur'));

  // Vollbild-Player
  const ACTS = { play: P.togglePlay, next: P.next, prev: P.prev, shuffle: P.toggleShuffle, repeat: P.cycleRepeat };
  $$('#np [data-act]').forEach((b) => b.addEventListener('click', run(ACTS[b.dataset.act])));
  const mobile = matchMedia('(max-width: 760px)');
  $('.pl-left').addEventListener('click', (e) => {
    if (!mobile.matches || e.target.closest('.like')) return;
    e.preventDefault();
    e.stopPropagation();
    openNowPlaying();
  });
  $('#np-close').addEventListener('click', closeNowPlaying);
  window.addEventListener('hashchange', closeNowPlaying);
  document.addEventListener('keydown', (e) => e.key === 'Escape' && closeNowPlaying());
  // Nach unten wischen schließt
  let touchY = null;
  $('#np').addEventListener('touchstart', (e) => {
    touchY = e.target.closest('input') ? null : e.touches[0].clientY;
  }, { passive: true });
  $('#np').addEventListener('touchend', (e) => {
    if (touchY != null && e.changedTouches[0].clientY - touchY > 120) closeNowPlaying();
    touchY = null;
  });
  $('#np-devices').addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = $('#np-devpop');
    if (pop.hidden) openDevices(pop);
    else pop.hidden = true;
  });

  const vol = $('#vol');
  vol.addEventListener('input', () => P.setVolume(Number(vol.value)));
  $('#btn-mute').addEventListener('click', () => {
    if (P.state.volume > 0) {
      lastVolume = P.state.volume;
      P.setVolume(0);
    } else P.setVolume(lastVolume || 60);
  });

  $('#btn-devices').addEventListener('click', (e) => {
    e.stopPropagation();
    const pop = $('#dev-pop');
    if (pop.hidden) openDevices();
    else pop.hidden = true;
  });
  $$('.dev-pop').forEach((pop) =>
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      if (e.target.closest('.dev-open')) return; // Link zur Spotify-App normal öffnen
      const b = e.target.closest('[data-device]');
      if (!b) return;
      pop.hidden = true;
      run(() => P.transferTo(b.dataset.device))();
    }),
  );
  document.addEventListener('click', () => $$('.dev-pop').forEach((p) => (p.hidden = true)));

  $('#nav-back').addEventListener('click', () => history.back());
  $('#nav-fwd').addEventListener('click', () => history.forward());

  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', run(P.togglePlay));
    ms.setActionHandler('pause', run(P.togglePlay));
    ms.setActionHandler('nexttrack', run(P.next));
    ms.setActionHandler('previoustrack', run(P.prev));
  }
}

// Globale Klick-Delegation für alles, was in den Views gerendert wird.
function bindDelegation() {
  document.addEventListener('click', (e) => {
    const t = e.target;
    const likeBtn = t.closest('.like[data-uri]');
    if (likeBtn) {
      e.preventDefault();
      e.stopPropagation();
      toggleLike(likeBtn.dataset.uri);
      return;
    }
    const q = t.closest('[data-queue]');
    if (q) {
      e.stopPropagation();
      run(async () => {
        await P.addToQueue(q.dataset.queue);
        toast('Zur Warteschlange hinzugefügt');
      })();
      return;
    }
    const pc = t.closest('[data-play-context]');
    if (pc) {
      e.preventDefault();
      e.stopPropagation();
      const uri = pc.dataset.playContext;
      if (uri === P.state.contextUri && P.state.track) run(P.togglePlay)();
      else run(() => P.playContext({ context_uri: uri }))();
      return;
    }
    if (t.closest('[data-logout]')) {
      doLogout();
      return;
    }
    const row = t.closest('.track-row');
    if (row && !t.closest('a')) {
      playFromList(row.dataset.list, Number(row.dataset.i));
      return;
    }
    const cardEl = t.closest('[data-href]');
    if (cardEl && !t.closest('a')) location.hash = cardEl.dataset.href;
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (e.code === 'Space' && !e.target.closest('button, a')) {
      e.preventDefault();
      run(P.togglePlay)();
    } else if (e.key === 'ArrowRight' && e.shiftKey) run(P.next)();
    else if (e.key === 'ArrowLeft' && e.shiftKey) run(P.prev)();
    else if (e.key === '/') {
      e.preventDefault();
      location.hash = '#/search';
    } else if (e.key === 'Enter') {
      const row = e.target.closest('.track-row');
      if (row) playFromList(row.dataset.list, Number(row.dataset.i));
      const c = e.target.closest('[data-href]');
      if (c) location.hash = c.dataset.href;
    }
  });
}

async function startApp() {
  root.innerHTML = shellHtml();
  bindPlayer();
  bindDelegation();
  setAuthLostHandler((e) => {
    logout();
    showSetup(`Sitzung abgelaufen – bitte neu verbinden. (${e.message})`);
  });

  try {
    session.me = await api('/me');
  } catch (e) {
    if (e.status === 403) {
      showSetup(
        'Spotify verweigert den Zugriff. Prüfe im Developer Dashboard unter „User Management“, ob dein Account eingetragen ist, und ob der App-Besitzer Premium hat.',
      );
      return;
    }
    if (!isLoggedIn()) return;
    toast(e.message, 'error');
  }

  P.onChange(renderPlayer);
  let sdkErrShown = false;
  P.onChange((s) => {
    if (s.sdkError && !s.remoteOnly && !sdkErrShown) {
      sdkErrShown = true;
      toast(`${s.sdkError} Du kannst aber andere Geräte steuern.`, 'error');
    }
  });
  renderPlayer(P.state);
  setInterval(tickProgress, 250);
  P.initSdk();
  P.startPolling();

  window.addEventListener('hashchange', onRoute);
  onRoute();
  loadSidebar();
}

async function boot() {
  try {
    if (await handleRedirect()) toast('Verbunden mit Spotify');
  } catch (e) {
    showSetup(e.message);
    return;
  }
  if (!getClientId() || !isLoggedIn()) {
    showSetup();
    return;
  }
  startApp();
}

boot();
