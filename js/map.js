// Vue du dessus : photo aérienne IGN + contour de la maison, chaque côté = une façade.
import { fmt } from './geometry.js';
import { esc } from './overlay.js';

const Z = 19; // zoom maximum des photos aériennes IGN
const WORLD = 256 * 2 ** Z;

export function project(lon, lat) {
  const x = ((lon + 180) / 360) * WORLD;
  const s = Math.sin((lat * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
  return [x, y];
}

function tileUrl(x, y) {
  return `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${Z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`;
}

export const LETTRES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// Longueur réelle de chaque côté du contour, en mètres.
export function edgeLengths(contour) {
  if (!contour?.length) return [];
  const lat0 = contour[0][1];
  const k = Math.cos((lat0 * Math.PI) / 180);
  return contour.map((p, i) => {
    const q = contour[(i + 1) % contour.length];
    return Math.hypot((q[0] - p[0]) * 111320 * k, (q[1] - p[1]) * 110540);
  });
}

// Calcule le cadrage : la maison au centre, avec de la marge autour.
export function frame(ign, aspect = 1, pad = 1.9) {
  const pts = (ign.contour?.length ? ign.contour : [[ign.lon, ign.lat]]).map(([lo, la]) => project(lo, la));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  let minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  let w = Math.max(maxX - minX, 40) * pad, h = Math.max(maxY - minY, 40) * pad;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

// Les coordonnées du monde au zoom 19 sont énormes (~10^8) : le SVG perd en précision.
// On dessine donc tout relativement au coin du cadrage (ox, oy).
function tilesSvg(fr) {
  let out = '';
  const x0 = Math.floor(fr.x / 256), x1 = Math.floor((fr.x + fr.w) / 256);
  const y0 = Math.floor(fr.y / 256), y1 = Math.floor((fr.y + fr.h) / 256);
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      out += `<image href="${tileUrl(tx, ty)}" x="${(tx * 256 - fr.x).toFixed(2)}" y="${(ty * 256 - fr.y).toFixed(2)}" width="256.6" height="256.6" preserveAspectRatio="none"/>`;
    }
  }
  return out;
}

// Dessin complet. assign : { indexCôté: { url, nom } } ; k = unités SVG par pixel écran.
export function mapSvg(ign, { widthPx = 360, aspect = 1, assign = {}, selected = null, candidats = false, interactive = false } = {}) {
  const fr = frame(ign, aspect, interactive ? 2.3 : 1.6);
  const k = fr.w / widthPx;
  const rel = ([lo, la]) => { const [x, y] = project(lo, la); return [x - fr.x, y - fr.y]; };
  const pts = (ign.contour || []).map(rel);
  const lens = edgeLengths(ign.contour);
  const cx = pts.reduce((s, p) => s + p[0], 0) / (pts.length || 1);
  const cy = pts.reduce((s, p) => s + p[1], 0) / (pts.length || 1);
  let svg = `<svg viewBox="0 0 ${fr.w} ${fr.h}" preserveAspectRatio="xMidYMid slice" class="map-svg" ${interactive ? '' : 'aria-hidden="true"'}>`;
  svg += `<rect x="0" y="0" width="${fr.w}" height="${fr.h}" fill="#1E293B"/>`;
  svg += tilesSvg(fr);
  svg += `<rect x="0" y="0" width="${fr.w}" height="${fr.h}" fill="rgba(5,7,13,0.25)"/>`;

  if (candidats && ign.candidats?.length) {
    // Mode « choisir la bonne maison » : les plus grandes dessous, les petites au-dessus
    // pour qu'on puisse toutes les toucher ; la maison actuelle en cyan.
    const cur = JSON.stringify(ign.contour?.[0]);
    ign.candidats
      .map((b, i) => ({ b, i }))
      .sort((x, y) => (y.b.surfaceSol || 0) - (x.b.surfaceSol || 0))
      .forEach(({ b, i }) => {
        const cp = b.contour.map(rel);
        const isCur = JSON.stringify(b.contour[0]) === cur;
        svg += `<polygon data-cand="${i}" points="${cp.map(p => p.join(',')).join(' ')}" fill="${isCur ? 'rgba(34,211,238,0.30)' : 'rgba(167,139,250,0.25)'}" stroke="${isCur ? '#22D3EE' : '#C4B5FD'}" stroke-width="${(isCur ? 3 : 2) * k}" style="cursor:pointer"/>`;
      });
    svg += '</svg>';
    return { svg, frame: fr, pts, lens };
  }

  if (pts.length >= 3) {
    svg += `<polygon points="${pts.map(p => p.join(',')).join(' ')}" fill="rgba(34,211,238,0.16)"/>`;
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const a = assign[i];
      const isSel = selected === i;
      const col = isSel ? '#22D3EE' : a ? '#A3E635' : '#F8FAFC';
      const dash = a || isSel ? '' : `stroke-dasharray="${6 * k} ${5 * k}"`;
      svg += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${col}" stroke-width="${(isSel ? 6 : 4) * k}" stroke-linecap="round" ${dash}/>`;
      if (interactive) svg += `<line data-edge="${i}" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="transparent" stroke-width="${30 * k}" stroke-linecap="round" style="cursor:pointer"/>`;
    });
    // Étiquettes à l'extérieur de la maison.
    pts.forEach((p, i) => {
      const q = pts[(i + 1) % pts.length];
      if (lens[i] < 1.5 && !assign[i]) return; // petits décrochements : pas d'étiquette
      if (!interactive && !assign[i]) return; // aperçu : seulement les façades placées
      let mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      const dx = mx - cx, dy = my - cy, dl = Math.hypot(dx, dy) || 1;
      const a = assign[i];
      const off = (a ? 30 : 20) * k;
      mx += (dx / dl) * off; my += (dy / dl) * off;
      const txt = interactive ? `${LETTRES[i] || i + 1} · ${fmt(lens[i], 1)} m` : `${LETTRES[i] || i + 1}`;
      const fs = 11 * k, wb = txt.length * 0.62 * fs + 14 * k, hb = fs + 10 * k;
      if (a) {
        const r = 17 * k;
        svg += `<clipPath id="cp${i}"><circle cx="${mx}" cy="${my - hb / 2 - r + 2 * k}" r="${r}"/></clipPath>`;
        svg += `<image href="${esc(a.url)}" x="${mx - r}" y="${my - hb / 2 - 2 * r + 2 * k}" width="${2 * r}" height="${2 * r}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cp${i})"/>`;
        svg += `<circle cx="${mx}" cy="${my - hb / 2 - r + 2 * k}" r="${r}" fill="none" stroke="#A3E635" stroke-width="${2.5 * k}"/>`;
      }
      svg += `<rect x="${mx - wb / 2}" y="${my - hb / 2}" width="${wb}" height="${hb}" rx="${hb / 2}" fill="${a ? 'rgba(26,46,5,0.92)' : 'rgba(5,7,13,0.85)'}" stroke="${a ? '#A3E635' : 'rgba(255,255,255,0.5)'}" stroke-width="${k}"/>`;
      svg += `<text x="${mx}" y="${my + fs * 0.36}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-weight="700" font-size="${fs}" fill="${a ? '#ECFCCB' : '#F1F5F9'}">${esc(txt)}</text>`;
    });
  } else {
    const [x, y] = rel([ign.lon, ign.lat]);
    svg += `<circle cx="${x}" cy="${y}" r="${8 * k}" fill="#22D3EE" stroke="#05070D" stroke-width="${3 * k}"/>`;
  }
  svg += '</svg>';
  return { svg, frame: fr, pts, lens };
}
