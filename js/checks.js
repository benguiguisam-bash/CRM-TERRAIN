// Contrôles de cohérence : "faisceau d'indices". Le laser fait foi,
// les autres sources servent à repérer les erreurs.
import { mainMur, rectDims, photoHeightEstimate, totals, edgeValues, SHAPES } from './geometry.js';
import { t, numLocale } from './i18n.js';

export const SEUILS = {
  refVert: 0.05,   // écart surface de référence : vert sous 5 %
  refOrange: 0.15, // orange jusqu'à 15 %, rouge au-delà
  hauteurM_par_niveau: 2.8,
};

// Tolérance propre à chaque source (la photo est la moins précise).
const TOL = { photo: 0.2, niveaux: 0.25, ign: 0.15 };

export function niveauxLabel(n) {
  return n ? t('levels', n) : t('f_unknown');
}

export function hauteurSources(facade, client) {
  const mur = mainMur(facade);
  if (!mur) return null;
  const { hauteur } = rectDims(facade, mur);
  if (hauteur == null) return null;
  const sources = [{ id: 'laser', label: t('src_laser'), v: hauteur }];
  const ph = photoHeightEstimate(facade, mur);
  if (ph) sources.push({ id: 'photo', label: t('src_photo'), v: ph, approx: true });
  const niv = client.niveaux || client.ign?.niveaux;
  if (niv) sources.push({ id: 'niveaux', label: niveauxLabel(niv), v: niv * SEUILS.hauteurM_par_niveau, approx: true });
  if (client.ign?.hauteur && !client.ignIncorrect) sources.push({ id: 'ign', label: t('src_ign'), v: client.ign.hauteur });
  return { mur, hauteur, sources };
}

export function checkHauteur(facade, client) {
  const titre = t('c_height');
  const hs = hauteurSources(facade, client);
  if (!hs) return { id: 'hauteur', niveau: 'gris', titre, message: t('c_height_need') };
  const laser = hs.hauteur;
  const autres = hs.sources.filter(s => s.id !== 'laser');
  autres.forEach(s => { s.ecart = (s.v - laser) / laser; s.ok = Math.abs(s.ecart) <= TOL[s.id]; });
  if (autres.length < 1) {
    return { id: 'hauteur', niveau: 'gris', titre, message: t('c_not_enough'), sources: hs.sources };
  }
  const ko = autres.filter(s => !s.ok);
  if (!ko.length) {
    return { id: 'hauteur', niveau: 'vert', titre, message: t('c_all_agree', hs.sources.length), sources: hs.sources };
  }
  if (autres.length === 1) {
    const s = ko[0];
    return { id: 'hauteur', niveau: 'orange', titre, message: t('c_one_source', s.label, f(s.v), f(laser)), sources: hs.sources };
  }
  if (ko.length >= 2 && ko.length > autres.length / 2) {
    return { id: 'hauteur', niveau: 'rouge', titre, message: t('c_laser_off', f(laser), ko.map(s => s.label).join(', ')), sources: hs.sources };
  }
  return { id: 'hauteur', niveau: 'orange', titre, message: t('c_one_off', ko.map(s => `${s.label} (${f(s.v)} m)`).join(', ')), sources: hs.sources };
}

// Surface de référence du client : comparée au total net de toutes ses façades.
export function checkReference(client, facadesClient) {
  if (!client.surfaceRef) return null;
  const titre = t('c_ref');
  let total = 0, complet = true;
  facadesClient.forEach(fa => { const tt = totals(fa); if (!tt.complet) complet = false; total += tt.net; });
  if (!complet || total === 0) {
    return { id: 'ref', niveau: 'gris', titre, message: t('c_ref_incomplete', f(client.surfaceRef, 1)), total };
  }
  const ecart = (total - client.surfaceRef) / client.surfaceRef;
  const a = Math.abs(ecart);
  const niveau = a <= SEUILS.refVert ? 'vert' : a <= SEUILS.refOrange ? 'orange' : 'rouge';
  const sign = ecart > 0 ? '+' : '−';
  const msg = niveau === 'vert' ? t('c_ref_ok') : niveau === 'orange' ? t('c_ref_warn') : t('c_ref_bad');
  return { id: 'ref', niveau, titre, message: `${t('c_ref_msg', f(total, 1), f(client.surfaceRef, 1), sign, f(a * 100, 1))} ${msg}`, total, ecart };
}

export function checkPlausible(facade) {
  const titre = t('c_plaus');
  const alertes = [];
  for (const s of facade.shapes) {
    const e = edgeValues(facade, s);
    e.forEach((x, i) => {
      if (x.v == null) return;
      if (x.v > 40) alertes.push(t('c_plaus_big', SHAPES[s.type].label, SHAPES[s.type].edges[i], f(x.v)));
      if (x.v < 0.2) alertes.push(t('c_plaus_small', SHAPES[s.type].label, SHAPES[s.type].edges[i], f(x.v)));
    });
  }
  const tt = totals(facade);
  if (tt.erreur) alertes.push(tt.erreur);
  if (tt.complet && tt.ouvertures > tt.brut * 0.6) alertes.push(t('c_plaus_open'));
  if (!alertes.length) return { id: 'plaus', niveau: 'vert', titre, message: t('c_plaus_ok') };
  return { id: 'plaus', niveau: 'orange', titre, message: alertes.join(' ') };
}

export function checkPreuves(facade) {
  const titre = t('c_proofs');
  let total = 0, avec = 0;
  for (const sid in facade.cotes || {}) {
    for (const i in facade.cotes[sid]) {
      const c = facade.cotes[sid][i];
      if (c?.valeur > 0) { total++; if (c.preuve) avec++; }
    }
  }
  if (!total) return { id: 'preuves', niveau: 'gris', titre, message: t('c_proofs_none'), total, avec };
  return {
    id: 'preuves',
    niveau: avec === total ? 'vert' : 'orange',
    titre,
    message: avec === total ? t('c_proofs_ok', avec, total) : t('c_proofs_missing', total - avec),
    total, avec,
  };
}

export function allChecks(facade, client, facadesClient) {
  return [checkHauteur(facade, client), checkReference(client, facadesClient), checkPlausible(facade), checkPreuves(facade)].filter(Boolean);
}

export function pire(checks) {
  const ordre = ['rouge', 'orange', 'vert', 'gris'];
  for (const n of ordre) if (checks.some(c => c.niveau === n)) return n;
  return 'gris';
}

function f(n, d = 2) {
  return n.toLocaleString(numLocale(), { minimumFractionDigits: d, maximumFractionDigits: d });
}
