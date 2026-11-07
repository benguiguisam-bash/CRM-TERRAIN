// Mode hors ligne : l'appli se charge même sans réseau sur le chantier.
const CACHE = 'crm-terrain-v3';
const SHELL = [
  './', './index.html', './styles.css', './manifest.webmanifest', './icon.svg',
  './js/app.js', './js/db.js', './js/geometry.js', './js/checks.js', './js/ign.js',
  './js/images.js', './js/overlay.js', './js/editor.js', './js/i18n.js',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API IGN : toujours le réseau (les données sont gardées dans la fiche client).
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
