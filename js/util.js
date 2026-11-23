export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export function fmtTime(ms) {
  if (ms == null || Number.isNaN(ms)) return '–:––';
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function fmtLong(ms) {
  const min = Math.round(ms / 60000);
  if (min >= 60) return `${Math.floor(min / 60)} Std. ${min % 60} Min.`;
  return `${min} Min.`;
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = (Date.now() - d) / 864e5;
  if (days < 1) return 'heute';
  if (days < 2) return 'gestern';
  if (days < 30) return `vor ${Math.floor(days)} Tagen`;
  return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Wählt das kleinste Bild, das mindestens `size` Pixel breit ist. */
export function img(images, size = 300) {
  if (!images?.length) return '';
  const sorted = [...images].sort((a, b) => (a.width || 0) - (b.width || 0));
  return (sorted.find((i) => (i.width || 0) >= size) || sorted[sorted.length - 1]).url;
}

export function artistsHtml(artists) {
  return (artists || [])
    .map((a) => (a.id ? `<a href="#/artist/${esc(a.id)}">${esc(a.name)}</a>` : esc(a.name)))
    .join(', ');
}

/** Playlist-Beschreibungen enthalten HTML-Entities und Links – nur den Text behalten. */
export function plainText(html) {
  if (!html) return '';
  return new DOMParser().parseFromString(html, 'text/html').body.textContent || '';
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

export function toast(msg, kind = 'info') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  box.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 300);
  }, kind === 'error' ? 5000 : 3000);
}

const colorCache = new Map();

/** Ermittelt eine gedämpfte Akzentfarbe aus einem Cover ("r, g, b") – oder null. */
export function dominantColor(url) {
  if (!url) return Promise.resolve(null);
  if (colorCache.has(url)) return colorCache.get(url);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = c.height = 24;
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(im, 0, 0, 24, 24);
        const d = x.getImageData(0, 0, 24, 24).data;
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = 0; i < d.length; i += 4) {
          const R = d[i], G = d[i + 1], B = d[i + 2];
          const max = Math.max(R, G, B), min = Math.min(R, G, B);
          const sat = max ? (max - min) / max : 0;
          const lum = (max + min) / 510;
          const wt = 0.1 + sat * sat * (lum > 0.12 && lum < 0.92 ? 1 : 0.2);
          r += R * wt; g += G * wt; b += B * wt; w += wt;
        }
        r /= w; g /= w; b /= w;
        const k = Math.min(1, 150 / Math.max(r, g, b, 1));
        resolve(`${Math.round(r * k)}, ${Math.round(g * k)}, ${Math.round(b * k)}`);
      } catch {
        resolve(null);
      }
    };
    im.onerror = () => resolve(null);
    im.src = url;
  });
  colorCache.set(url, p);
  return p;
}
