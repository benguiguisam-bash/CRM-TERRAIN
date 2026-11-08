// Formes dessinées sur la photo et calcul des surfaces à partir des cotes laser.
// Les surfaces viennent des métrages saisis : la photo sert de croquis
// (pour une forme libre, elle donne seulement la direction de chaque côté).

import { t, numLocale } from './i18n.js';

// Libellés traduits à la volée (getters) : on peut changer de langue sans recharger.
function shapeDef(labelKey, points, edgeKeys) {
  return {
    points,
    get label() { return t(labelKey); },
    get edges() { return edgeKeys.map(k => t(k)); },
  };
}

export const SHAPES = {
  mur: shapeDef('shape_mur', 4, ['e_top', 'e_right', 'e_bottom', 'e_left']),
  pignon: shapeDef('shape_pignon', 3, ['e_slope_l', 'e_slope_r', 'e_base']),
  ouverture: shapeDef('shape_ouverture', 4, ['e_width', 'e_height', 'e_width_b', 'e_height_l']),
  // Forme libre (3, 5, 6… points) : role 'mur' (surface) ou 'ouverture' (à déduire).
  poly: shapeDef('shape_poly', null, []),
};

export function isDeduction(shape) {
  return shape.type === 'ouverture' || (shape.type === 'poly' && shape.role === 'ouverture');
}

export function shapeLabel(shape) {
  if (shape.type === 'poly') return shape.role === 'ouverture' ? t('shape_ouverture') : t('shape_poly');
  return SHAPES[shape.type].label;
}

export function edgeName(shape, i) {
  if (shape.type === 'poly') return `${t('e_side')} ${i + 1}`;
  return SHAPES[shape.type].edges[i];
}

// Remet les points dans un ordre fixe, quel que soit l'ordre des touches.
// Mur / ouverture : haut-gauche, haut-droite, bas-droite, bas-gauche.
// Pignon : gauche, sommet, droite.
export function normalize(type, pts) {
  if (type === 'pignon') {
    const sorted = [...pts].sort((a, b) => a.y - b.y);
    const apex = sorted[0];
    const [l, r] = sorted.slice(1).sort((a, b) => a.x - b.x);
    return [l, apex, r];
  }
  const byY = [...pts].sort((a, b) => a.y - b.y);
  const [tl, tr] = byY.slice(0, 2).sort((a, b) => a.x - b.x);
  const [bl, br] = byY.slice(2).sort((a, b) => a.x - b.x);
  return [tl, tr, br, bl];
}

// 4 points qui forment à peu près un rectangle (angles proches de 90°, perspective comprise) ?
export function isRectLike(pts) {
  if (pts.length !== 4) return false;
  const n = normalize('mur', pts);
  for (let i = 0; i < 4; i++) {
    const a = n[(i + 3) % 4], b = n[i], c = n[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y }, v2 = { x: c.x - b.x, y: c.y - b.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    if (Math.abs(Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI - 90) > 20) return false;
  }
  return true;
}

export function edgePoints(shape, i) {
  const p = shape.points;
  return [p[i], p[(i + 1) % p.length]];
}

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function cote(facade, shape, i) {
  const c = facade.cotes?.[shape.id]?.[i];
  return c && c.valeur > 0 ? c.valeur : null;
}

// Plus grand mur (en pixels) : sert de mur principal pour les contrôles.
export function mainMur(facade) {
  const murs = facade.shapes.filter(s => s.type === 'mur');
  if (!murs.length) return null;
  return murs.reduce((best, s) => (pxArea(s) > pxArea(best) ? s : best));
}

function pxArea(s) {
  let a = 0;
  const p = s.points;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return Math.abs(a) / 2;
}

// Pour chaque côté : 'mesure' (cote saisie), 'lie' (déduit d'un autre côté) ou 'manquant'.
export function edgeValues(facade, shape) {
  const out = [];
  if (shape.type === 'poly') {
    return shape.points.map((_, i) => {
      const v = cote(facade, shape, i);
      return v != null ? { v, etat: 'mesure' } : { v: null, etat: 'manquant' };
    });
  }
  if (shape.type === 'pignon') {
    const pg = cote(facade, shape, 0);
    const pdOwn = cote(facade, shape, 1);
    const sym = facade.symetrique?.[shape.id] !== false;
    const baseOwn = cote(facade, shape, 2);
    const mur = mainMur(facade);
    const murW = mur ? rectDims(facade, mur).largeur : null;
    out[0] = pg != null ? { v: pg, etat: 'mesure' } : { v: null, etat: 'manquant' };
    if (pdOwn != null) out[1] = { v: pdOwn, etat: 'mesure' };
    else if (sym && pg != null) out[1] = { v: pg, etat: 'lie', source: t('lie_sym') };
    else out[1] = { v: null, etat: 'manquant' };
    if (baseOwn != null) out[2] = { v: baseOwn, etat: 'mesure' };
    else if (murW != null) out[2] = { v: murW, etat: 'lie', source: t('lie_wall_width') };
    else out[2] = { v: null, etat: 'manquant' };
    return out;
  }
  const own = [0, 1, 2, 3].map(i => cote(facade, shape, i));
  const opposite = [2, 3, 0, 1];
  for (let i = 0; i < 4; i++) {
    if (own[i] != null) out[i] = { v: own[i], etat: 'mesure' };
    else if (own[opposite[i]] != null) out[i] = { v: own[opposite[i]], etat: 'lie', source: t('lie_side', SHAPES[shape.type].edges[opposite[i]]) };
    else out[i] = { v: null, etat: 'manquant' };
  }
  return out;
}

function rectDims(facade, shape) {
  const e = edgeValues(facade, shape);
  const largeur = e[0].v != null && e[2].v != null ? (e[0].v + e[2].v) / 2 : null;
  const hauteur = e[1].v != null && e[3].v != null ? (e[1].v + e[3].v) / 2 : null;
  return { largeur, hauteur };
}

// Forme libre : on « marche » le long des côtés avec les longueurs laser et la direction
// de chaque côté sur la photo (redressée à l'horizontale/verticale si elle en est proche),
// on répartit le petit défaut de fermeture, puis on calcule la surface.
// Le redressement le plus fort qui « referme » bien la forme est retenu :
// un mur penché par la perspective est redressé, une vraie pente de toit est gardée.
function polyArea(shape, lengths) {
  let best = null;
  for (const snapDeg of [15, 10, 6, 3, 0]) {
    const r = polyAreaSnap(shape, lengths, snapDeg);
    if (r.fermeture < 0.01) return r;
    if (!best || r.fermeture < best.fermeture - 0.002) best = r;
  }
  return best;
}

function polyAreaSnap(shape, lengths, snapDeg) {
  const p = shape.points;
  const n = p.length;
  const vecs = [];
  let per = 0;
  for (let i = 0; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    let ang = Math.atan2(b.y - a.y, b.x - a.x);
    const deg = ang * 180 / Math.PI;
    const nearest = Math.round(deg / 90) * 90;
    if (Math.abs(deg - nearest) <= snapDeg) ang = nearest * Math.PI / 180;
    vecs.push({ x: Math.cos(ang) * lengths[i], y: Math.sin(ang) * lengths[i] });
    per += lengths[i];
  }
  const cx = vecs.reduce((s, v) => s + v.x, 0), cy = vecs.reduce((s, v) => s + v.y, 0);
  const fermeture = Math.hypot(cx, cy) / (per || 1);
  let x = 0, y = 0, area = 0;
  for (let i = 0; i < n; i++) {
    const k = lengths[i] / (per || 1);
    const nx = x + vecs[i].x - cx * k, ny = y + vecs[i].y - cy * k;
    area += x * ny - nx * y;
    x = nx; y = ny;
  }
  return { aire: Math.abs(area) / 2, fermeture };
}

// Surface d'une forme en m², ou null s'il manque des cotes.
export function shapeArea(facade, shape) {
  if (shape.type === 'poly') {
    const ls = edgeValues(facade, shape).map(e => e.v);
    if (ls.some(v => v == null)) return { aire: null };
    if (shape.points.length === 3) {
      const [a, b, c] = ls, s = (a + b + c) / 2, h2 = s * (s - a) * (s - b) * (s - c);
      if (h2 <= 0) return { aire: null, erreur: t('tri_error') };
      return { aire: Math.sqrt(h2), cotes: ls };
    }
    const r = polyArea(shape, ls);
    return { aire: r.aire, cotes: ls, erreur: r.fermeture > 0.05 ? t('poly_close_error') : null };
  }
  if (shape.type === 'pignon') {
    const [a, b, c] = edgeValues(facade, shape).map(e => e.v);
    if (a == null || b == null || c == null) return { aire: null };
    const s = (a + b + c) / 2;
    const h2 = s * (s - a) * (s - b) * (s - c);
    if (h2 <= 0) return { aire: null, erreur: t('tri_error') };
    return { aire: Math.sqrt(h2), base: c, pentes: [a, b] };
  }
  const { largeur, hauteur } = rectDims(facade, shape);
  if (largeur == null || hauteur == null) return { aire: null };
  return { aire: largeur * hauteur, largeur, hauteur };
}

// Liste des cotes réellement nécessaires, dans l'ordre où on les saisit
// (une largeur + une hauteur par rectangle, chaque côté d'une forme libre, etc.).
export function requiredEdges(facade) {
  const out = [];
  const hasMur = facade.shapes.some(s => s.type === 'mur');
  for (const s of facade.shapes) {
    const e = edgeValues(facade, s);
    const add = i => out.push({ shapeId: s.id, edge: i, ok: e[i].v != null });
    if (s.type === 'poly') s.points.forEach((_, i) => add(i));
    else if (s.type === 'pignon') {
      const sym = facade.symetrique?.[s.id] !== false;
      add(0);
      if (!sym || e[1].etat === 'mesure') add(1);
      if (!hasMur || e[2].etat === 'mesure') add(2);
    } else if (s.type === 'ouverture') {
      out.push({ shapeId: s.id, edge: e[0].etat === 'mesure' || e[2].etat !== 'mesure' ? 0 : 2, ok: e[0].v != null });
      out.push({ shapeId: s.id, edge: e[1].etat === 'mesure' || e[3].etat !== 'mesure' ? 1 : 3, ok: e[1].v != null });
    } else {
      // Mur : on mesure plutôt le bas (au sol) et le côté gauche.
      out.push({ shapeId: s.id, edge: e[0].etat === 'mesure' ? 0 : 2, ok: e[0].v != null });
      out.push({ shapeId: s.id, edge: e[1].etat === 'mesure' ? 1 : 3, ok: e[1].v != null });
    }
  }
  return out;
}

export function requiredStatus(facade) {
  const r = requiredEdges(facade);
  return { total: r.length, missing: r.filter(x => !x.ok).length };
}

// Prochaine cote à saisir (d'abord dans la même forme si on en donne une).
export function nextMissing(facade, shapeId = null) {
  const r = requiredEdges(facade).filter(x => !x.ok);
  return (shapeId && r.find(x => x.shapeId === shapeId)) || (shapeId ? null : r[0] || null);
}

export function missingCount(facade) {
  return requiredStatus(facade).missing;
}

export function totals(facade) {
  let brut = 0, ouvertures = 0, complet = facade.shapes.length > 0;
  const lignes = [];
  let erreur = null;
  for (const s of facade.shapes) {
    const r = shapeArea(facade, s);
    if (r.erreur) erreur = r.erreur;
    if (r.aire == null) { complet = false; continue; }
    lignes.push({ shape: s, ...r });
    if (isDeduction(s)) ouvertures += r.aire;
    else brut += r.aire;
  }
  if (!facade.shapes.some(s => !isDeduction(s))) complet = false;
  return { brut, ouvertures, net: Math.max(0, brut - ouvertures), complet, lignes, erreur };
}

export function fmt(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return n.toLocaleString(numLocale(), { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function parseNum(str) {
  if (str == null) return null;
  const v = parseFloat(String(str).replace(/\s/g, '').replace(',', '.'));
  return isNaN(v) ? null : v;
}

// Estimation de hauteur par la photo : proportions du mur × largeur mesurée.
// Faussée par la perspective : sert seulement de contrôle.
export function photoHeightEstimate(facade, mur) {
  const p = mur.points;
  const pxW = (dist(p[0], p[1]) + dist(p[3], p[2])) / 2;
  const pxH = (dist(p[0], p[3]) + dist(p[1], p[2])) / 2;
  const { largeur } = rectDims(facade, mur);
  if (!largeur || !pxW) return null;
  return largeur * (pxH / pxW);
}

export { rectDims };
