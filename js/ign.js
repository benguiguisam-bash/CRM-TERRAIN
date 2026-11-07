// Données gratuites de l'IGN (Géoplateforme) : adresse -> bâtiment BD TOPO.
const GEOCODE = 'https://data.geopf.fr/geocodage/search';
const WFS = 'https://data.geopf.fr/wfs/ows';

import { t } from './i18n.js';

// Codes "matériaux des murs" (fichiers fonciers) : un chiffre par matériau.
// Le code est gardé tel quel et traduit à l'affichage, dans la langue choisie.
export function decodeMateriaux(code) {
  if (code == null) return null;
  const mat = t('mat');
  const noms = String(code).split('').map(Number).filter(d => d && mat[d]).map(d => mat[d]);
  return noms.length ? [...new Set(noms)].join(' / ') : null;
}

export async function geocode(adresse) {
  const url = `${GEOCODE}?q=${encodeURIComponent(adresse)}&limit=1`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(t('err_address'));
  const d = await r.json();
  const f = d.features?.[0];
  if (!f) throw new Error(t('err_address'));
  const [lon, lat] = f.geometry.coordinates;
  return { lat, lon, label: f.properties.label, score: f.properties.score };
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polygons(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

function centroidDist(geom, lon, lat) {
  let best = Infinity;
  for (const poly of polygons(geom)) {
    for (const [x, y] of poly[0]) best = Math.min(best, Math.hypot(x - lon, y - lat));
  }
  return best;
}

export async function fetchBatiment(adresse) {
  const pos = await geocode(adresse);
  const d = 0.0004; // ~40 m autour de l'adresse
  const bbox = `${pos.lat - d},${pos.lon - d},${pos.lat + d},${pos.lon + d},urn:ogc:def:crs:EPSG::4326`;
  const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&OUTPUTFORMAT=application/json&COUNT=50&BBOX=${bbox}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(t('err_ign_service'));
  const data = await r.json();
  const feats = data.features || [];
  if (!feats.length) return { ...pos, trouve: false };

  let choisi = feats.find(f => polygons(f.geometry).some(p => pointInRing(pos.lon, pos.lat, p[0])));
  let certitude = 'sur';
  if (!choisi) {
    choisi = feats.reduce((a, b) => (centroidDist(a.geometry, pos.lon, pos.lat) < centroidDist(b.geometry, pos.lon, pos.lat) ? a : b));
    certitude = 'proche';
  }
  const p = choisi.properties;
  const faitage = p.altitude_maximale_toit != null && p.altitude_minimale_sol != null
    ? p.altitude_maximale_toit - p.altitude_minimale_sol : null;
  return {
    ...pos,
    trouve: true,
    certitude,
    hauteur: p.hauteur ?? null,
    faitage,
    niveaux: p.nombre_d_etages ?? null,
    materiauxCode: p.materiaux_des_murs ?? null,
    usage: p.usage_1 ?? null,
    fetchedAt: new Date().toISOString(),
  };
}
