// Mode hors ligne : l'appli se charge même sans réseau sur le chantier.
const CACHE = 'crm-terrain-v5';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icon.svg',
  './js/app.js', './js/db.js', './js/geometry.js', './js/checks.js', './js/ign.js',
  './js/images.js', './js/overlay.js', './js/editor.js', './js/i18n.js', './js/map.js', './js/view3d.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== 'crm-terrain-tuiles').map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Photos aériennes IGN : gardées en cache pour revoir la vue du dessus hors ligne.
  // La 3D les demande en mode CORS : une copie « opaque » (vue du dessus) ne lui suffit pas.
  if (url.hostname === 'data.geopf.fr' && url.pathname.includes('/wmts')) {
    const cors = e.request.mode === 'cors';
    e.respondWith(caches.open('crm-terrain-tuiles').then(c => c.match(e.request.url).then(hit => {
      if (hit && !(cors && hit.type === 'opaque')) return hit;
      return fetch(cors ? e.request : new Request(e.request.url, { mode: 'cors' })).catch(() => fetch(e.request)).then(res => {
        c.put(e.request.url, res.clone());
        return res;
      });
    })));
    return;
  }
  // Bibliothèque 3D (version figée) : gardée en cache pour la 3D hors ligne.
  if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/three@0.160.0/')) {
    e.respondWith(caches.open('crm-terrain-tuiles').then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  // Autres API IGN : toujours le réseau (les données sont gardées dans la fiche client).
  if (url.hostname === 'data.geopf.fr') return;
  // Appli et polices : réseau d'abord, cache si hors ligne.
  // Pour l'appli, on redemande toujours au serveur s'il y a du nouveau
  // (sinon le téléphone garde l'ancienne version jusqu'à 10 minutes).
  const sameOrigin = url.origin === location.origin;
  e.respondWith(
    fetch(sameOrigin ? new Request(e.request, { cache: 'no-cache' }) : e.request).then(res => {
      if (res.ok && (url.origin === location.origin || url.hostname.includes('fonts.g'))) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});
