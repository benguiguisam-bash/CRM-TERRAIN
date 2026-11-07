// Contrôles de cohérence : "faisceau d'indices". Le laser fait foi,
// les autres sources servent à repérer les erreurs.
import { mainMur, rectDims, photoHeightEstimate, totals, edgeValues, SHAPES } from './geometry.js';

export const SEUILS = {
  refVert: 0.05,   // écart surface de référence : vert sous 5 %
  refOrange: 0.15, // orange jusqu'à 15 %, rouge au-delà
  hauteurM_par_niveau: 2.8,
};

// Tolérance propre à chaque source (la photo est la moins précise).
const TOL = { photo: 0.2, niveaux: 0.25, ign: 0.15 };

export function niveauxLabel(n) {
  if (!n) return 'inconnu';
  return n === 1 ? 'RDC' : `R+${n - 1}`;
}

export function hauteurSources(facade, client) {
  const mur = mainMur(facade);
  if (!mur) return null;
  const { hauteur } = rectDims(facade, mur);
  if (hauteur == null) return null;
  const sources = [{ id: 'laser', label: 'Laser', v: hauteur }];
  const ph = photoHeightEstimate(facade, mur);
  if (ph) sources.push({ id: 'photo', label: 'Photo', v: ph, approx: true });
  const niv = client.niveaux || client.ign?.niveaux;
  if (niv) sources.push({ id: 'niveaux', label: niveauxLabel(niv), v: niv * SEUILS.hauteurM_par_niveau, approx: true });
  if (client.ign?.hauteur && !client.ignIncorrect) sources.push({ id: 'ign', label: 'IGN', v: client.ign.hauteur });
  return { mur, hauteur, sources };
}

export function checkHauteur(facade, client) {
  const hs = hauteurSources(facade, client);
  if (!hs) return { niveau: 'gris', titre: 'Hauteur du mur', message: 'Saisis la hauteur du mur pour lancer le contrôle.' };
  const laser = hs.hauteur;
  const autres = hs.sources.filter(s => s.id !== 'laser');
  autres.forEach(s => { s.ecart = (s.v - laser) / laser; s.ok = Math.abs(s.ecart) <= TOL[s.id]; });
  if (autres.length < 1) {
    return { niveau: 'gris', titre: 'Hauteur du mur', message: 'Pas assez de sources pour comparer.', sources: hs.sources };
  }
  const ko = autres.filter(s => !s.ok);
  if (!ko.length) {
    return { niveau: 'vert', titre: 'Hauteur du mur', message: `Les ${hs.sources.length} sources sont d'accord.`, sources: hs.sources };
  }
  if (autres.length === 1) {
    const s = ko[0];
    return { niveau: 'orange', titre: 'Hauteur du mur', message: `${s.label} donne ${f(s.v)} m, ta mesure ${f(laser)} m. Une seule source pour comparer : vérifie.`, sources: hs.sources };
  }
  if (ko.length >= 2 && ko.length > autres.length / 2) {
    return { niveau: 'rouge', titre: 'Hauteur du mur', message: `Ta mesure (${f(laser)} m) ne colle pas avec ${ko.map(s => s.label).join(', ')}. Vérifie-la.`, sources: hs.sources };
  }
  return { niveau: 'orange', titre: 'Hauteur du mur', message: `${ko.map(s => `${s.label} (${f(s.v)} m)`).join(', ')} semble décalé. La majorité confirme ta mesure.`, sources: hs.sources };
}

// Surface de référence du client : comparée au total net de toutes ses façades.
export function checkReference(client, facadesClient) {
  if (!client.surfaceRef) return null;
  let total = 0, complet = true;
  facadesClient.forEach(fa => { const t = totals(fa); if (!t.complet) complet = false; total += t.net; });
  if (!complet || total === 0) {
    return { niveau: 'gris', titre: 'Surface de référence', message: `Référence ${f(client.surfaceRef, 1)} m² : termine toutes les façades pour comparer.`, total };
  }
  const ecart = (total - client.surfaceRef) / client.surfaceRef;
  const a = Math.abs(ecart);
  const niveau = a <= SEUILS.refVert ? 'vert' : a <= SEUILS.refOrange ? 'orange' : 'rouge';
  const sign = ecart > 0 ? '+' : '−';
  const msg = niveau === 'vert' ? 'Cohérent avec la référence.'
    : niveau === 'orange' ? 'Écart notable : vérifie tes mesures.'
    : 'Gros écart : une explication sera demandée à la validation.';
  return { niveau, titre: 'Surface de référence', message: `${f(total, 1)} m² mesurés pour ${f(client.surfaceRef, 1)} m² de référence (${sign}${f(a * 100, 1)} %). ${msg}`, total, ecart };
}

export function checkPlausible(facade) {
  const alertes = [];
  for (const s of facade.shapes) {
    const e = edgeValues(facade, s);
    e.forEach((x, i) => {
      if (x.v == null) return;
      if (x.v > 40) alertes.push(`${SHAPES[s.type].label} : ${SHAPES[s.type].edges[i]} de ${f(x.v)} m, c'est beaucoup.`);
      if (x.v < 0.2) alertes.push(`${SHAPES[s.type].label} : ${SHAPES[s.type].edges[i]} de ${f(x.v)} m, c'est très petit.`);
    });
  }
  const t = totals(facade);
  if (t.erreur) alertes.push(t.erreur);
  if (t.complet && t.ouvertures > t.brut * 0.6) alertes.push('Les ouvertures font plus de 60 % de la façade : vérifie.');
  if (!alertes.length) return { niveau: 'vert', titre: 'Valeurs plausibles', message: 'Aucune valeur anormale.' };
  return { niveau: 'orange', titre: 'Valeurs plausibles', message: alertes.join(' ') };
}

export function checkPreuves(facade) {
  let total = 0, avec = 0;
  for (const sid in facade.cotes || {}) {
    for (const i in facade.cotes[sid]) {
      const c = facade.cotes[sid][i];
      if (c?.valeur > 0) { total++; if (c.preuve) avec++; }
    }
  }
  if (!total) return { niveau: 'gris', titre: 'Photos du laser', message: 'Aucune cote saisie.', total, avec };
  return {
    niveau: avec === total ? 'vert' : 'orange',
    titre: 'Photos du laser',
    message: avec === total ? `${avec}/${total} cotes prouvées par une photo.` : `${total - avec} cote(s) sans photo du laser.`,
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
  return n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
