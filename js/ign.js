// Données gratuites de l'IGN (Géoplateforme) : adresse -> bâtiment BD TOPO.
import { t } from './i18n.js';

const GEOCODE = 'https://data.geopf.fr/geocodage/search';
const WFS = 'https://data.geopf.fr/wfs/ows';

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

// Mètres locaux autour d'un point (suffisant à l'échelle d'une maison).
function toMeters(lon, lat, lat0) {
  return [lon * 111320 * Math.cos((lat0 * Math.PI) / 180), lat * 110540];
}

function ringArea(ring, lat0) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = toMeters(...ring[i], lat0), [x2, y2] = toMeters(...ring[(i + 1) % ring.length], lat0);
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

// Simplifie le contour (Douglas-Peucker, en mètres) pour garder les vrais murs.
function simplify(ring, lat0, tol = 0.35) {
  if (ring.length < 4) return ring;
  const m = ring.map(p => toMeters(p[0], p[1], lat0));
  const keep = new Array(ring.length).fill(false);
  keep[0] = keep[ring.length - 1] = true;
  // Contour fermé (début = fin) : on le coupe au point le plus éloigné du départ.
  let far = 1, fd = 0;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = Math.hypot(m[i][0] - m[0][0], m[i][1] - m[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  keep[far] = true;
  const stack = [[0, far], [far, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let best = -1, bd = 0;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = m[i], [x1, y1] = m[a], [x2, y2] = m[b];
      const dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1;
      const d = Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / l;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0 && bd > tol) { keep[best] = true; stack.push([a, best], [best, b]); }
  }
  return ring.filter((_, i) => keep[i]);
}

function parseBatiment(f, lat0) {
  const polys = polygons(f.geometry);
  if (!polys.length) return null;
  const outer = polys.map(p => p[0].map(c => [c[0], c[1]])).reduce((a, b) => (ringArea(a, lat0) >= ringArea(b, lat0) ? a : b));
  let ring = outer.slice();
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  const closed = [...ring, ring[0]];
  ring = simplify(closed, lat0);
  ring.pop();
  const p = f.properties;
  return {
    contour: ring.map(([x, y]) => [Math.round(x * 1e7) / 1e7, Math.round(y * 1e7) / 1e7]),
    hauteur: p.hauteur ?? null,
    faitage: p.altitude_maximale_toit != null && p.altitude_minimale_sol != null ? p.altitude_maximale_toit - p.altitude_minimale_sol : null,
    niveaux: p.nombre_d_etages ?? null,
    materiauxCode: p.materiaux_des_murs ?? null,
    usage: p.usage_1 ?? null,
    surfaceSol: Math.round(ringArea(outer, lat0)),
    _outer: outer,
  };
}

// Suggestions d'adresses pendant la saisie (Base Adresse Nationale, via l'IGN).
export async function suggestAdresses(texte, signal) {
  const url = `https://data.geopf.fr/geocodage/completion?text=${encodeURIComponent(texte)}&type=StreetAddress&maximumResponses=6`;
  const r = await fetch(url, { signal });
  if (!r.ok) return [];
  const d = await r.json();
  return (d.results || []).map(x => ({ label: x.fulltext, lon: x.x, lat: x.y, kind: x.kind }));
}

// coords : position déjà connue (adresse choisie dans les suggestions) -> pas de géocodage.
export async function fetchBatiment(adresse, coords = null) {
  const pos = coords ? { lat: coords.lat, lon: coords.lon, label: adresse, score: 1 } : await geocode(adresse);
  const d = 0.0005; // ~50 m autour de l'adresse
  const bbox = `${pos.lat - d},${pos.lon - d},${pos.lat + d},${pos.lon + d},urn:ogc:def:crs:EPSG::4326`;
  const url = `${WFS}?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&OUTPUTFORMAT=application/json&COUNT=80&BBOX=${bbox}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(t('err_ign_service'));
  const data = await r.json();
  const bats = (data.features || []).map(f => parseBatiment(f, pos.lat)).filter(Boolean);
  if (!bats.length) return { ...pos, trouve: false, candidats: [] };

  const [px, py] = toMeters(pos.lon, pos.lat, pos.lat);
  bats.forEach(b => {
    b.inside = pointInRing(pos.lon, pos.lat, b._outer);
    b.dist = b.inside ? 0 : Math.min(...b._outer.map(c => { const [x, y] = toMeters(c[0], c[1], pos.lat); return Math.hypot(x - px, y - py); }));
  });
  bats.sort((a, b) => a.dist - b.dist);
  // Les petites annexes (garage, abri) passent après la maison la plus proche.
  const choisi = bats.find(b => b.inside) || bats.find(b => b.surfaceSol >= 40 && b.dist < 25) || bats[0];
  const clean = b => { const { _outer, inside, dist, ...rest } = b; return rest; };
  return {
    ...pos,
    trouve: true,
    certitude: choisi.inside ? 'sur' : 'proche',
    ...clean(choisi),
    candidats: bats.slice(0, 15).map(clean),
    fetchedAt: new Date().toISOString(),
  };
}

// Change le bâtiment retenu parmi les candidats (si l'IGN a pris le voisin).
export function choisirBatiment(ign, index) {
  const b = ign.candidats?.[index];
  if (!b) return ign;
  return { ...ign, ...b, certitude: 'choisi' };
}
