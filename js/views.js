import { api, fetchAll, session, likes, libraryContains, librarySave, normTrack } from './api.js';
import { state, playContext } from './player.js';
import { icon } from './icons.js';
import {
  $, $$, esc, fmtTime, fmtLong, fmtDate, img, artistsHtml, plainText, debounce, toast, dominantColor,
} from './util.js';

// ---------- Track-Listen ----------

const lists = new Map();
let listSeq = 0;

function registerList(tracks, play, cols = {}) {
  const id = `L${++listSeq}`;
  lists.set(id, { tracks, play, cols: { cover: true, album: false, added: false, number: 'index', ...cols } });
  return id;
}

/** Spielt einen Song aus einer registrierten Liste. Läuft synchron bis zum ersten await (Autoplay!). */
export function playFromList(listId, i) {
  const l = lists.get(listId);
  const t = l?.tracks[i];
  if (!t) return;
  if (t.is_local) {
    toast('Lokale Dateien können hier nicht abgespielt werden.');
    return;
  }
  Promise.resolve(l.play(i, l.tracks)).catch((e) => toast(e.message, 'error'));
}

// Wie die Liste abgespielt wird:
const playInContext = (ctxUri) => (i, tracks) =>
  playContext({ context_uri: ctxUri, offset: { position: tracks[i].pos ?? i } });

const playAsUris = (i, tracks) => {
  const playable = tracks.filter((t) => t.uri && !t.is_local);
  const idx = Math.max(0, playable.indexOf(tracks[i]));
  const start = Math.max(0, idx - 20);
  const slice = playable.slice(start, start + 100);
  return playContext({ uris: slice.map((t) => t.uri), offset: { position: idx - start } });
};

function trackListHtml(listId, { header = true } = {}) {
  const { cols } = lists.get(listId);
  const cls = `${cols.album ? 'has-album' : ''} ${cols.added ? 'has-added' : ''}`;
  const head = header
    ? `<div class="tl-head"><div class="tr-num">#</div><div>Titel</div>${cols.album ? '<div class="tr-album">Album</div>' : ''}${
        cols.added ? '<div class="tr-added">Hinzugefügt</div>' : ''
      }<div></div><div class="tr-dur">${icon('clock')}</div></div>`
    : '';
  return `<div class="tracklist ${cls}" data-list-wrap="${listId}">${head}<div class="tl-body">${rowsHtml(listId, 0)}</div></div>`;
}

function rowsHtml(listId, start) {
  const { tracks, cols } = lists.get(listId);
  return tracks
    .slice(start)
    .map((t, k) => {
      const i = start + k;
      const num = cols.number === 'track' ? t.track_number ?? i + 1 : i + 1;
      const cover = cols.cover ? img(t.album?.images, 64) : '';
      const isTrack = t.uri?.startsWith('spotify:track:');
      return `<div class="track-row ${t.is_local ? 'is-local' : ''}" data-list="${listId}" data-i="${i}" data-uri="${esc(t.uri)}" tabindex="0">
  <div class="tr-num"><span class="n">${num}</span><span class="pi">${icon('play')}</span><span class="eq"><i></i><i></i><i></i></span></div>
  <div class="tr-main">${
    cols.cover ? `<div class="tr-cover">${cover ? `<img loading="lazy" src="${esc(cover)}" alt="">` : icon('note')}</div>` : ''
  }<div class="tr-text"><div class="tr-title">${esc(t.name)}</div><div class="tr-artists">${
    t.explicit ? '<span class="explicit" title="Explizit">E</span>' : ''
  }${artistsHtml(t.artists)}</div></div></div>
  ${
    cols.album
      ? `<div class="tr-album">${
          t.album?.id ? `<a href="#/album/${esc(t.album.id)}">${esc(t.album.name)}</a>` : esc(t.album?.name || '')
        }</div>`
      : ''
  }
  ${cols.added ? `<div class="tr-added">${esc(fmtDate(t.added_at))}</div>` : ''}
  <div class="tr-actions">${
    isTrack ? `<button class="icon-btn like" data-uri="${esc(t.uri)}" aria-label="Gefällt mir">${icon('heartOutline')}</button>` : ''
  }${
    t.uri && !t.is_local
      ? `<button class="icon-btn" data-queue="${esc(t.uri)}" title="Zur Warteschlange hinzufügen" aria-label="Zur Warteschlange">${icon('queueAdd')}</button>`
      : ''
  }</div>
  <div class="tr-dur">${fmtTime(t.duration_ms)}</div>
</div>`;
    })
    .join('');
}

/** Endloses Nachladen per IntersectionObserver. mapPage(paging) -> Tracks */
function attachLoadMore(root, listId, nextUrl, mapPage, alive) {
  if (!nextUrl) return;
  let next = nextUrl;
  let busy = false;
  const wrap = root.querySelector(`[data-list-wrap="${listId}"]`);
  const sentinel = document.createElement('div');
  sentinel.className = 'sentinel';
  sentinel.innerHTML = '<div class="spinner"></div>';
  wrap.after(sentinel);
  const io = new IntersectionObserver(
    async ([entry]) => {
      if (!entry.isIntersecting || busy) return;
      if (!alive()) return io.disconnect();
      busy = true;
      try {
        const page = await api(next);
        if (!alive()) return io.disconnect();
        const l = lists.get(listId);
        const start = l.tracks.length;
        l.tracks.push(...mapPage(page, start));
        wrap.querySelector('.tl-body').insertAdjacentHTML('beforeend', rowsHtml(listId, start));
        markPlaying();
        hydrateLikes(wrap);
        next = page?.next;
      } catch (e) {
        toast(e.message, 'error');
        next = null;
      } finally {
        busy = false;
      }
      if (!next) {
        io.disconnect();
        sentinel.remove();
      }
    },
    { root: $('#main'), rootMargin: '800px' },
  );
  io.observe(sentinel);
}

// ---------- Gefällt mir ----------

export function paintLike(btn) {
  const on = likes.get(btn.dataset.uri) === true;
  btn.classList.toggle('on', on);
  btn.innerHTML = icon(on ? 'heart' : 'heartOutline');
  btn.setAttribute('aria-pressed', String(on));
}

export async function hydrateLikes(root = document) {
  const btns = $$('.like[data-uri]', root);
  btns.forEach(paintLike);
  const unknown = [...new Set(btns.map((b) => b.dataset.uri).filter((u) => u && !likes.has(u)))];
  if (!unknown.length) return;
  try {
    const res = await libraryContains(unknown);
    unknown.forEach((u, i) => likes.set(u, !!res[i]));
  } catch (e) {
    console.warn('Like-Status nicht verfügbar:', e.message);
    return;
  }
  $$('.like[data-uri]', document).forEach(paintLike);
}

export async function toggleLike(uri) {
  const was = likes.get(uri) === true;
  likes.set(uri, !was);
  $$('.like[data-uri]').filter((b) => b.dataset.uri === uri).forEach(paintLike);
  try {
    await librarySave(uri, !was);
    toast(was ? 'Aus Lieblingssongs entfernt' : 'Zu Lieblingssongs hinzugefügt');
  } catch (e) {
    likes.set(uri, was);
    $$('.like[data-uri]').filter((b) => b.dataset.uri === uri).forEach(paintLike);
    toast(e.message, 'error');
  }
}

// ---------- „Läuft gerade“-Markierungen ----------

export function markPlaying() {
  const uri = state.track?.uri;
  $$('.track-row').forEach((r) => {
    const on = !!uri && r.dataset.uri === uri;
    r.classList.toggle('playing', on);
    r.classList.toggle('paused', on && !state.isPlaying);
  });
  $$('[data-play-context]').forEach((b) => {
    const on = state.isPlaying && b.dataset.playContext === state.contextUri;
    if (b._on === on) return;
    b._on = on;
    b.classList.toggle('on', on);
    b.innerHTML = icon(on ? 'pause' : 'play');
    b.setAttribute('aria-label', on ? 'Pausieren' : 'Abspielen');
  });
}

// ---------- Bausteine ----------

const loadingHtml = () => '<div class="loading"><div class="spinner"></div></div>';

function errorHtml(e) {
  return `<div class="page"><div class="empty"><h2>Das hat nicht geklappt</h2><p>${esc(e?.message || e)}</p></div></div>`;
}

const section = (title, body, extra = '') =>
  `<section class="shelf ${extra}"><h2>${esc(title)}</h2>${body}</section>`;

const grid = (cards) => `<div class="grid">${cards.join('')}</div>`;

function card({ href, image, title, sub = '', round = false, playUri }) {
  return `<div class="card" data-href="${esc(href)}" tabindex="0" role="link">
  <div class="card-img ${round ? 'round' : ''}">${
    image ? `<img loading="lazy" src="${esc(image)}" alt="">` : `<div class="ph">${icon('note')}</div>`
  }${playUri ? `<button class="card-play" data-play-context="${esc(playUri)}" aria-label="Abspielen">${icon('play')}</button>` : ''}</div>
  <div class="card-title">${esc(title)}</div>
  <div class="card-sub">${sub}</div>
</div>`;
}

function quickTile({ href, title, image, playUri, liked }) {
  return `<div class="quick-tile" data-href="${esc(href)}" tabindex="0" role="link">
  <div class="qt-img ${liked ? 'liked-thumb' : ''}">${
    liked ? icon('heart') : image ? `<img loading="lazy" src="${esc(image)}" alt="">` : icon('note')
  }</div>
  <div class="qt-title">${esc(title)}</div>
  ${playUri ? `<button class="card-play small" data-play-context="${esc(playUri)}" aria-label="Abspielen">${icon('play')}</button>` : ''}
</div>`;
}

function hero({ image, kind, title, meta = '', desc = '', round = false, liked = false, playUri }) {
  return `<header class="hero">
  <div class="hero-img ${round ? 'round' : ''} ${liked ? 'liked-thumb' : ''}">${
    liked ? icon('heart') : image ? `<img src="${esc(image)}" alt="">` : icon('note')
  }</div>
  <div class="hero-text">
    <div class="hero-kind">${esc(kind)}</div>
    <h1 class="hero-title ${title.length > 26 ? 'long' : ''}">${esc(title)}</h1>
    ${desc ? `<p class="hero-desc">${esc(desc)}</p>` : ''}
    <div class="hero-meta">${meta}</div>
  </div>
</header>
${playUri ? `<div class="actions"><button class="big-play" data-play-context="${esc(playUri)}" aria-label="Abspielen">${icon('play')}</button></div>` : ''}`;
}

function tint(el, imageUrl, fallback) {
  el.style.setProperty('--tint', fallback || '70, 60, 80');
  if (!imageUrl) return;
  dominantColor(imageUrl).then((c) => c && el.style.setProperty('--tint', c));
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// ---------- Views ----------

const VIEWS = {
  async home(route, el, alive) {
    const [recent, top, artists, pls] = await Promise.allSettled([
      api('/me/player/recently-played', { query: { limit: 40 } }),
      api('/me/top/tracks', { query: { limit: 10, time_range: 'short_term' } }),
      api('/me/top/artists', { query: { limit: 12, time_range: 'medium_term' } }),
      api('/me/playlists', { query: { limit: 24 } }),
    ]);
    if (!alive()) return;

    const name = session.me?.display_name?.split(' ')[0] || '';
    const h = new Date().getHours();
    const greet = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 18 ? 'Guten Tag' : 'Guten Abend';
    let html = `<div class="page"><h1 class="greet">${greet}${name ? `, ${esc(name)}` : ''}</h1>`;

    const playlists = (pls.value?.items || []).filter(Boolean);
    html += `<div class="quick">${quickTile({ href: '#/liked', title: 'Lieblingssongs', liked: true })}${playlists
      .slice(0, 7)
      .map((p) => quickTile({ href: `#/playlist/${p.id}`, title: p.name, image: img(p.images, 64), playUri: p.uri }))
      .join('')}</div>`;

    let cols = '';
    if (recent.value?.items?.length) {
      const seen = new Set();
      const tracks = recent.value.items
        .map((x) => normTrack(x.track))
        .filter((t) => t && !seen.has(t.uri) && seen.add(t.uri))
        .slice(0, 8);
      cols += section('Zuletzt gehört', trackListHtml(registerList(tracks, playAsUris), { header: false }));
    }
    if (top.value?.items?.length) {
      const tracks = top.value.items.map((t) => normTrack(t)).slice(0, 8);
      cols += section('Deine Top-Songs · 4 Wochen', trackListHtml(registerList(tracks, playAsUris), { header: false }));
    }
    if (cols) html += `<div class="two-col">${cols}</div>`;

    if (artists.value?.items?.length) {
      html += section(
        'Deine Top-Künstler',
        grid(
          artists.value.items.map((a) =>
            card({ href: `#/artist/${a.id}`, image: img(a.images, 300), title: a.name, sub: 'Künstler', round: true, playUri: a.uri }),
          ),
        ),
      );
    }
    if (playlists.length) {
      html += section(
        'Deine Playlists',
        grid(
          playlists.map((p) =>
            card({
              href: `#/playlist/${p.id}`,
              image: img(p.images, 300),
              title: p.name,
              sub: esc(`von ${p.owner?.display_name || '–'}`),
              playUri: p.uri,
            }),
          ),
        ),
      );
    }
    const failed = [recent, top, artists, pls].filter((r) => r.status === 'rejected');
    if (failed.length === 4) throw failed[0].reason;
    el.innerHTML = `${html}</div>`;
    tint(el, null, '72, 52, 64');
  },

  async search(route, el, alive) {
    const q0 = route.arg || '';
    el.innerHTML = `<div class="page">
      <label class="search-bar">${icon('search')}<input id="q" type="search" placeholder="Was willst du hören?" value="${esc(q0)}" autocomplete="off" spellcheck="false"></label>
      <div id="search-results"></div></div>`;
    tint(el, null, '40, 48, 70');
    const input = $('#q', el);
    const out = $('#search-results', el);
    let token = 0;

    const run = async (q) => {
      const my = ++token;
      if (!q.trim()) {
        out.innerHTML = recentSearchesHtml();
        return;
      }
      out.innerHTML = loadingHtml();
      try {
        const r = await api('/search', { query: { q, type: 'track,artist,album,playlist', limit: 10 } });
        if (my !== token || !alive()) return;
        out.innerHTML = searchResultsHtml(r);
        markPlaying();
        hydrateLikes(out);
      } catch (e) {
        if (my === token) out.innerHTML = errorHtml(e);
      }
    };
    const go = debounce((q) => {
      history.replaceState(null, '', `#/search/${encodeURIComponent(q)}`);
      run(q);
    }, 300);

    input.addEventListener('input', () => go(input.value));
    input.addEventListener('keydown', (e) => e.key === 'Enter' && saveRecentSearch(input.value));
    out.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-q]');
      if (chip) {
        input.value = chip.dataset.q;
        go(chip.dataset.q);
        return;
      }
      if (e.target.closest('[data-clear-recent]')) {
        localStorage.removeItem('kr.recentSearches');
        out.innerHTML = recentSearchesHtml();
        return;
      }
      if (e.target.closest('.track-row, [data-href], a')) saveRecentSearch(input.value);
    });
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    run(q0);
  },

  async library(route, el, alive) {
    const tab = route.arg || 'playlists';
    const tabs = [
      ['playlists', 'Playlists'],
      ['albums', 'Alben'],
      ['artists', 'Künstler'],
    ];
    const head = `<div class="lib-head"><h1>Bibliothek</h1><div class="tabs">${tabs
      .map(([k, label]) => `<a class="chip ${k === tab ? 'on' : ''}" href="#/library/${k}">${label}</a>`)
      .join('')}</div></div>`;
    let cards = [];
    if (tab === 'albums') {
      const items = await fetchAll('/me/albums', {}, 150);
      cards = items.map(({ album: a }) =>
        card({ href: `#/album/${a.id}`, image: img(a.images, 300), title: a.name, sub: esc(a.artists.map((x) => x.name).join(', ')), playUri: a.uri }),
      );
    } else if (tab === 'artists') {
      const r = await api('/me/following', { query: { type: 'artist', limit: 50 } });
      cards = (r?.artists?.items || []).map((a) =>
        card({ href: `#/artist/${a.id}`, image: img(a.images, 300), title: a.name, sub: 'Künstler', round: true, playUri: a.uri }),
      );
    } else {
      const items = await fetchAll('/me/playlists', {}, 300);
      cards = [
        `<div class="card liked-card" data-href="#/liked" tabindex="0" role="link"><div class="card-img liked-thumb">${icon('heart')}</div><div class="card-title">Lieblingssongs</div><div class="card-sub">Deine gespeicherten Songs</div></div>`,
        ...items.map((p) =>
          card({
            href: `#/playlist/${p.id}`,
            image: img(p.images, 300),
            title: p.name,
            sub: esc(`${plural((p.items ?? p.tracks)?.total ?? 0, 'Song', 'Songs')} · ${p.owner?.display_name || ''}`),
            playUri: p.uri,
          }),
        ),
      ];
    }
    if (!alive()) return;
    el.innerHTML = `<div class="page">${head}${cards.length ? grid(cards) : '<div class="empty"><p>Hier ist noch nichts.</p></div>'}
      <button class="btn-ghost mobile-only" data-logout>${icon('logout')} Abmelden</button></div>`;
    tint(el, null, '44, 58, 66');
  },

  async liked(route, el, alive) {
    const r = await api('/me/tracks', { query: { limit: 50 } });
    if (!alive()) return;
    const map = (page) => (page?.items || []).filter((x) => x?.track).map((x) => ({ ...normTrack(x.track), added_at: x.added_at }));
    const tracks = map(r);
    const ctx = session.me ? `spotify:user:${session.me.id}:collection` : null;
    const play = (i, ts) =>
      ctx ? playContext({ context_uri: ctx, offset: { uri: ts[i].uri } }).catch(() => playAsUris(i, ts)) : playAsUris(i, ts);
    const id = registerList(tracks, play, { album: true, added: true });
    el.innerHTML = `<div class="page">${hero({
      liked: true,
      kind: 'Playlist',
      title: 'Lieblingssongs',
      meta: `${esc(session.me?.display_name || '')} · ${plural(r.total, 'Song', 'Songs')}`,
      playUri: ctx,
    })}${tracks.length ? trackListHtml(id) : '<div class="empty"><p>Noch keine Songs gespeichert. Tipp auf das Herz neben einem Song.</p></div>'}</div>`;
    tint(el, null, '92, 70, 150');
    attachLoadMore(el, id, r.next, map, alive);
  },

  async playlist(route, el, alive) {
    const pl = await api(`/playlists/${encodeURIComponent(route.arg)}`);
    if (!alive()) return;
    // Seit 2026: Feld heißt "items" (früher "tracks"), Einträge "item" (früher "track").
    const page = pl.items ?? pl.tracks;
    const entries = Array.isArray(page?.items) ? page.items : null;
    const map = (pg, start = 0) =>
      (pg?.items || [])
        .map((e, k) => {
          const t = normTrack(e.item ?? e.track);
          return t && { ...t, added_at: e.added_at, pos: start + k };
        })
        .filter(Boolean);
    const tracks = entries ? map(page) : [];
    // pos muss über alle Seiten fortlaufen – Offset der Folgeseiten kommt aus dem Paging-Objekt.
    const mapNext = (pg) => map(pg, pg?.offset ?? 0);
    const id = registerList(tracks, playInContext(pl.uri), { album: true, added: true });
    const total = page?.total;
    const dur = tracks.reduce((s, t) => s + (t.duration_ms || 0), 0);
    const meta = [
      `<b>${esc(pl.owner?.display_name || '')}</b>`,
      total != null ? plural(total, 'Song', 'Songs') : '',
      dur && tracks.length === total ? esc(fmtLong(dur)) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const image = img(pl.images, 300);
    el.innerHTML = `<div class="page">${hero({
      image,
      kind: pl.public ? 'Öffentliche Playlist' : 'Playlist',
      title: pl.name,
      desc: plainText(pl.description),
      meta,
      playUri: pl.uri,
    })}${
      entries
        ? tracks.length
          ? trackListHtml(id)
          : '<div class="empty"><p>Diese Playlist ist leer.</p></div>'
        : `<div class="notice">Spotify gibt die Songliste im Development Mode nur für Playlists heraus, die dir gehören oder an denen du mitarbeitest. Abspielen klappt trotzdem – einfach auf Play.</div>`
    }</div>`;
    tint(el, image);
    if (entries) attachLoadMore(el, id, page.next, mapNext, alive);
  },

  async album(route, el, alive) {
    const al = await api(`/albums/${encodeURIComponent(route.arg)}`);
    if (!alive()) return;
    const albumInfo = { id: al.id, name: al.name, images: al.images };
    const map = (pg) => (pg?.items || []).map((t) => normTrack(t, albumInfo));
    const tracks = map(al.tracks);
    const id = registerList(
      tracks,
      (i, ts) => playContext({ context_uri: al.uri, offset: { uri: ts[i].uri } }),
      { cover: false, number: 'track' },
    );
    const kind = { single: 'Single', compilation: 'Compilation' }[al.album_type] || 'Album';
    const dur = tracks.reduce((s, t) => s + (t.duration_ms || 0), 0);
    const meta = [
      `<b>${artistsHtml(al.artists)}</b>`,
      esc((al.release_date || '').slice(0, 4)),
      plural(al.total_tracks ?? tracks.length, 'Song', 'Songs'),
      esc(fmtLong(dur)),
    ]
      .filter(Boolean)
      .join(' · ');
    const image = img(al.images, 300);
    el.innerHTML = `<div class="page">${hero({ image, kind, title: al.name, meta, playUri: al.uri })}${trackListHtml(id)}
      ${al.copyrights?.[0]?.text ? `<p class="fine">${esc(al.copyrights[0].text)}</p>` : ''}
      <div id="more-by"></div></div>`;
    tint(el, image);
    attachLoadMore(el, id, al.tracks?.next, map, alive);

    const main = al.artists?.[0];
    if (main?.id) {
      api(`/artists/${main.id}/albums`, { query: { include_groups: 'album,single', limit: 10 } })
        .then((r) => {
          const more = (r?.items || []).filter((a) => a && a.id !== al.id);
          if (!alive() || !more.length) return;
          $('#more-by', el).innerHTML = section(
            `Mehr von ${main.name}`,
            grid(more.map((a) => card({ href: `#/album/${a.id}`, image: img(a.images, 300), title: a.name, sub: esc((a.release_date || '').slice(0, 4)), playUri: a.uri }))),
          );
          markPlaying();
        })
        .catch(() => {});
    }
  },

  async artist(route, el, alive) {
    const ar = await api(`/artists/${encodeURIComponent(route.arg)}`);
    if (!alive()) return;
    // /artists/{id}/top-tracks gibt es im Development Mode nicht mehr → Songs über die Suche.
    const [albums, singles, songs] = await Promise.allSettled([
      api(`/artists/${ar.id}/albums`, { query: { include_groups: 'album', limit: 20 } }),
      api(`/artists/${ar.id}/albums`, { query: { include_groups: 'single', limit: 20 } }),
      api('/search', { query: { q: `artist:"${ar.name}"`, type: 'track', limit: 10 } }),
    ]);
    if (!alive()) return;
    const tracks = (songs.value?.tracks?.items || [])
      .filter((t) => t?.artists?.some((a) => a.id === ar.id))
      .map((t) => normTrack(t));
    const image = img(ar.images, 300);
    const meta = (ar.genres || []).slice(0, 4).map(esc).join(' · ');
    let html = `<div class="page">${hero({ image, kind: 'Künstler', title: ar.name, meta, round: true, playUri: ar.uri })}`;
    if (tracks.length) html += section('Songs', trackListHtml(registerList(tracks, playAsUris, { album: true }), { header: false }));
    const albumCards = (r) =>
      (r.value?.items || [])
        .filter(Boolean)
        .map((a) => card({ href: `#/album/${a.id}`, image: img(a.images, 300), title: a.name, sub: esc((a.release_date || '').slice(0, 4)), playUri: a.uri }));
    const a1 = albumCards(albums);
    const a2 = albumCards(singles);
    if (a1.length) html += section('Alben', grid(a1));
    if (a2.length) html += section('Singles & EPs', grid(a2));
    el.innerHTML = `${html}</div>`;
    tint(el, image);
  },

  async queue(route, el, alive) {
    const q = await api('/me/player/queue');
    if (!alive()) return;
    const now = q?.currently_playing ? [normTrack(q.currently_playing)] : [];
    const upcoming = (q?.queue || []).map((t) => normTrack(t)).filter(Boolean);
    let html = '<div class="page"><h1 class="page-title">Warteschlange</h1>';
    if (!now.length && !upcoming.length) {
      html += '<div class="empty"><p>Gerade läuft nichts.</p></div>';
    } else {
      if (now.length) html += section('Läuft gerade', trackListHtml(registerList(now, playAsUris, { album: true }), { header: false }));
      if (upcoming.length) html += section('Als Nächstes', trackListHtml(registerList(upcoming, playAsUris, { album: true }), { header: false }));
    }
    el.innerHTML = `${html}</div>`;
    tint(el, img(now[0]?.album?.images, 64), '50, 50, 60');
  },
};

// ---------- Suche: Hilfen ----------

function recentSearches() {
  try {
    return JSON.parse(localStorage.getItem('kr.recentSearches') || '[]');
  } catch {
    return [];
  }
}

function saveRecentSearch(q) {
  q = q.trim();
  if (!q) return;
  const list = [q, ...recentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 10);
  try {
    localStorage.setItem('kr.recentSearches', JSON.stringify(list));
  } catch {
    /* egal */
  }
}

function recentSearchesHtml() {
  const list = recentSearches();
  if (!list.length) {
    return '<div class="empty soft"><p>Suche nach Songs, Künstlern, Alben oder Playlists.<br><kbd>/</kbd> springt von überall hierher.</p></div>';
  }
  return `<section class="shelf"><h2>Letzte Suchen <button class="link-btn" data-clear-recent>leeren</button></h2><div class="chips">${list
    .map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`)
    .join('')}</div></section>`;
}

function searchResultsHtml(r) {
  const tracks = (r.tracks?.items || []).filter(Boolean).map((t) => normTrack(t));
  const artists = (r.artists?.items || []).filter(Boolean);
  const albums = (r.albums?.items || []).filter(Boolean);
  const playlists = (r.playlists?.items || []).filter(Boolean);
  if (!tracks.length && !artists.length && !albums.length && !playlists.length) {
    return '<div class="empty"><p>Nichts gefunden.</p></div>';
  }
  let html = '<div class="search-top">';
  const top = artists[0];
  if (top) {
    html += `<section class="shelf"><h2>Top-Ergebnis</h2><div class="top-result" data-href="#/artist/${esc(top.id)}" tabindex="0" role="link">
      <div class="tr-img round">${img(top.images, 160) ? `<img src="${esc(img(top.images, 160))}" alt="">` : icon('note')}</div>
      <div class="tr-name">${esc(top.name)}</div><div class="tr-kind">Künstler</div>
      <button class="card-play" data-play-context="${esc(top.uri)}" aria-label="Abspielen">${icon('play')}</button></div></section>`;
  }
  if (tracks.length) {
    html += section('Songs', trackListHtml(registerList(tracks, playAsUris), { header: false }));
  }
  html += '</div>';
  if (artists.length) {
    html += section('Künstler', grid(artists.map((a) => card({ href: `#/artist/${a.id}`, image: img(a.images, 300), title: a.name, sub: 'Künstler', round: true, playUri: a.uri }))));
  }
  if (albums.length) {
    html += section(
      'Alben',
      grid(albums.map((a) => card({ href: `#/album/${a.id}`, image: img(a.images, 300), title: a.name, sub: esc(`${(a.release_date || '').slice(0, 4)} · ${a.artists.map((x) => x.name).join(', ')}`), playUri: a.uri }))),
    );
  }
  if (playlists.length) {
    html += section(
      'Playlists',
      grid(playlists.map((p) => card({ href: `#/playlist/${p.id}`, image: img(p.images, 300), title: p.name, sub: esc(`von ${p.owner?.display_name || '–'}`), playUri: p.uri }))),
    );
  }
  return html;
}

// ---------- Router-Einstieg ----------

let renderToken = 0;

export async function render(route, el) {
  const my = ++renderToken;
  const alive = () => my === renderToken;
  lists.clear();
  el.innerHTML = loadingHtml();
  try {
    await (VIEWS[route.name] || VIEWS.home)(route, el, alive);
  } catch (e) {
    if (alive()) el.innerHTML = errorHtml(e);
    console.error(e);
  }
  if (alive()) {
    markPlaying();
    hydrateLikes(el);
  }
}
