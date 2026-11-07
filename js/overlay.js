// Dessin des formes (SVG) par-dessus la photo : partagé par l'éditeur et les vignettes.
import { SHAPES, edgePoints, edgeValues, fmt } from './geometry.js';

export const COLORS = {
  mesure: '#A3E635',
  lie: '#A3E635',
  manquant: '#FBBF24',
  cyan: '#22D3EE',
};

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// k = nombre de pixels photo par pixel écran (pour garder des traits lisibles).
export function shapesSvg(facade, k, { labels = true, selected = null } = {}) {
  let out = '';
  for (const s of facade.shapes) {
    const pts = s.points.map(p => `${p.x},${p.y}`).join(' ');
    if (s.type === 'ouverture') {
      out += `<polygon points="${pts}" fill="rgba(226,232,240,0.12)" stroke="#E2E8F0" stroke-width="${1.6 * k}" stroke-dasharray="${5 * k} ${4 * k}"/>`;
    } else {
      out += `<polygon points="${pts}" fill="rgba(34,211,238,0.10)"/>`;
    }
    const vals = edgeValues(facade, s);
    vals.forEach((v, i) => {
      const [a, b] = edgePoints(s, i);
      const isSel = selected && selected.shapeId === s.id && selected.edge === i;
      const color = isSel ? COLORS.cyan : COLORS[v.etat];
      const dash = v.etat === 'manquant' ? `stroke-dasharray="${10 * k} ${7 * k}"` : v.etat === 'lie' ? `stroke-dasharray="${3 * k} ${4 * k}"` : '';
      const w = (isSel ? 6 : s.type === 'ouverture' ? 2.5 : 3.5) * k;
      if (s.type === 'ouverture' && v.etat === 'lie' && !isSel) return;
      out += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" ${dash} class="edge"/>`;
    });
    if (labels && s.type === 'ouverture') {
      // Une seule étiquette au centre : "1,20 × 1,35" ou "+ cotes".
      const cx = s.points.reduce((a, p) => a + p.x, 0) / 4;
      const cy = s.points.reduce((a, p) => a + p.y, 0) / 4;
      const ok = vals[0].v != null && vals[1].v != null;
      const txt = ok ? `${fmt(vals[0].v)}×${fmt(vals[1].v)}` : '+ cotes';
      const fs = 10 * k, wbox = txt.length * 0.62 * fs + 12 * k, hbox = fs + 10 * k;
      out += `<g class="lbl"><rect x="${cx - wbox / 2}" y="${cy - hbox / 2}" width="${wbox}" height="${hbox}" rx="${hbox / 2}" fill="${ok ? 'rgba(26,46,5,0.92)' : '#FBBF24'}" ${ok ? `stroke="#A3E635" stroke-width="${k}"` : ''}/>` +
        `<text x="${cx}" y="${cy + fs * 0.36}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-weight="700" font-size="${fs}" fill="${ok ? '#ECFCCB' : '#05070D'}">${esc(txt)}</text></g>`;
    } else if (labels) {
      const hasMur = facade.shapes.some(x => x.type === 'mur');
      const cx = s.points.reduce((a, p) => a + p.x, 0) / s.points.length;
      const cy = s.points.reduce((a, p) => a + p.y, 0) / s.points.length;
      vals.forEach((v, i) => {
        if (v.etat === 'lie') return;
        if (s.type === 'ouverture' && v.etat === 'manquant' && (i === 0 || i === 1)) return;
        if (s.type === 'mur' && v.etat === 'manquant' && (i === 0 || i === 1)) return;
        if (s.type === 'pignon' && i === 2 && v.etat === 'manquant' && hasMur) return;
        if (s.type === 'pignon' && i === 1 && v.etat === 'manquant' && facade.symetrique?.[s.id] !== false) return;
        const [a, b] = edgePoints(s, i);
        const txt = v.etat === 'mesure' ? `${fmt(v.v)} m` : '+ cote';
        const fs = (s.type === 'ouverture' ? 11 : 13) * k;
        const wbox = (txt.length * 0.62 * fs) + 16 * k;
        const hbox = fs + 12 * k;
        // Étiquette décalée vers l'extérieur (vers l'intérieur pour une ouverture)
        // pour ne pas se superposer aux formes voisines.
        let mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const dx = mx - cx, dy = my - cy, dl = Math.hypot(dx, dy) || 1;
        const dir = s.type === 'ouverture' ? -1 : 1;
        const off = (Math.abs(dx / dl) * wbox + Math.abs(dy / dl) * hbox) / 2 + 4 * k;
        mx += dir * (dx / dl) * off;
        my += dir * (dy / dl) * off;
        mx = Math.max(wbox / 2 + 2 * k, Math.min(facade.photoW - wbox / 2 - 2 * k, mx));
        my = Math.max(hbox / 2 + 2 * k, Math.min(facade.photoH - hbox / 2 - 2 * k, my));
        const fill = v.etat === 'mesure' ? 'rgba(26,46,5,0.92)' : '#FBBF24';
        const tcol = v.etat === 'mesure' ? '#ECFCCB' : '#05070D';
        const stroke = v.etat === 'mesure' ? `stroke="#A3E635" stroke-width="${1 * k}"` : '';
        out += `<g class="lbl"><rect x="${mx - wbox / 2}" y="${my - hbox / 2}" width="${wbox}" height="${hbox}" rx="${hbox / 2}" fill="${fill}" ${stroke}/>` +
          `<text x="${mx}" y="${my + fs * 0.36}" text-anchor="middle" font-family="JetBrains Mono, ui-monospace, monospace" font-weight="700" font-size="${fs}" fill="${tcol}">${esc(txt)}</text></g>`;
      });
    }
  }
  return out;
}

export function verticesSvg(facade, k) {
  let out = '';
  const seen = new Set();
  for (const s of facade.shapes) {
    for (const p of s.points) {
      const key = `${Math.round(p.x)}_${Math.round(p.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out += `<circle cx="${p.x}" cy="${p.y}" r="${6.5 * k}" fill="#05070D" stroke="#22D3EE" stroke-width="${2.5 * k}"/>`;
    }
  }
  return out;
}

// Vignette : photo + tracé, en SVG autonome.
export function thumbSvg(facade, url, widthPx) {
  const k = facade.photoW / widthPx;
  return `<svg viewBox="0 0 ${facade.photoW} ${facade.photoH}" preserveAspectRatio="xMidYMid slice" class="thumb-svg" aria-hidden="true">` +
    `<image href="${url}" x="0" y="0" width="${facade.photoW}" height="${facade.photoH}"/>` +
    shapesSvg(facade, k * 1.4, { labels: false }) + `</svg>`;
}

export { SHAPES };
