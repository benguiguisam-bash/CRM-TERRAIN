// Formes dessinées sur la photo et calcul des surfaces à partir des cotes laser.
// Les surfaces viennent UNIQUEMENT des métrages saisis : la photo sert de croquis.

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
};

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

// Surface d'une forme en m², ou null s'il manque des cotes.
export function shapeArea(facade, shape) {
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

// Cotes réellement nécessaires (une largeur + une hauteur par rectangle, etc.).
export function requiredStatus(facade) {
  let total = 0, missing = 0;
  const hasMur = facade.shapes.some(s => s.type === 'mur');
  for (const s of facade.shapes) {
    const e = edgeValues(facade, s);
    if (s.type === 'pignon') {
      const sym = facade.symetrique?.[s.id] !== false;
      total += 1; if (e[0].v == null) missing++;
      if (!sym || e[1].etat === 'mesure') { total += 1; if (e[1].v == null) missing++; }
      else if (e[0].v == null) { /* déduite de la pente gauche */ }
      if (!hasMur || e[2].etat === 'mesure') { total += 1; if (e[2].v == null) missing++; }
      else if (e[2].v == null) { total += 0; }
    } else {
      total += 2;
      if (e[0].v == null) missing++;
      if (e[1].v == null) missing++;
    }
  }
  return { total, missing };
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
    if (s.type === 'ouverture') ouvertures += r.aire;
    else brut += r.aire;
  }
  if (!facade.shapes.some(s => s.type !== 'ouverture')) complet = false;
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
