import { clients as dbC, facades as dbF, uid } from './db.js';
import { totals, missingCount, fmt, parseNum } from './geometry.js';
import { allChecks, pire, checkReference, niveauxLabel } from './checks.js';
import { fetchBatiment } from './ign.js';
import { compress, blobUrl, pickPhoto } from './images.js';
import { thumbSvg, esc, shapesSvg } from './overlay.js';
import { renderEditor } from './editor.js';

const app = document.getElementById('app');
const ui = { filtre: 'jour', recherche: '' };

const ICON = {
  back: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg>',
  chevron: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>',
  plus: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  search: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  phone: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
  route: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 11 18-8-8 18-2-8z"/></svg>',
  edit: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  camera: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
  check: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
};

// ---------- utilitaires ----------
export function go(hash) { location.hash = hash; }

export function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function heure(iso) {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function jourCourt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

export function facadeEtat(f) {
  if (f.valide) return { id: 'valide', label: 'Validée', dot: 'vert' };
  if (!f.shapes.length) return { id: 'vide', label: 'À tracer', dot: 'orange' };
  const m = missingCount(f);
  if (m > 0 || !totals(f).complet) return { id: 'amesurer', label: `${m || 'Des'} cote${m > 1 ? 's' : ''} à mesurer`, dot: 'orange' };
  return { id: 'complet', label: `${fmt(totals(f).net, 1)} m² · à valider`, dot: 'cyan' };
}

function clientEtat(c, fs) {
  if (!fs.length) return { label: 'Aucune façade', dot: 'violet' };
  const aMesurer = fs.filter(f => ['vide', 'amesurer'].includes(facadeEtat(f).id)).length;
  if (aMesurer) return { label: `${aMesurer} façade${aMesurer > 1 ? 's' : ''} à mesurer`, dot: 'orange' };
  const net = fs.reduce((s, f) => s + totals(f).net, 0);
  const toutes = fs.every(f => f.valide);
  return { label: `${toutes ? 'Métrage validé' : 'Métrage terminé'} · ${fmt(net, 1)} m²`, dot: toutes ? 'vert' : 'cyan' };
}

async function refreshIgn(client, { silent = false } = {}) {
  if (!navigator.onLine) { if (!silent) toast('Pas de réseau : IGN indisponible pour le moment.'); return client; }
  try {
    const ign = await fetchBatiment(client.adresse);
    client.ign = ign;
    client.ignErreur = null;
  } catch (e) {
    client.ignErreur = e.message || 'Erreur IGN';
  }
  await dbC.put(client);
  return client;
}

// ---------- écran : tournée ----------
async function viewTournee() {
  const [cs, fs] = await Promise.all([dbC.all(), dbF.all()]);
  const byClient = id => fs.filter(f => f.clientId === id);
  const auj = cs.filter(c => isToday(c.rdv));
  const aMesurer = fs.filter(f => ['vide', 'amesurer'].includes(facadeEtat(f).id)).length;
  const m2jour = fs.filter(f => isToday(f.updatedAt) && totals(f).complet).reduce((s, f) => s + totals(f).net, 0);

  let liste = cs;
  if (ui.filtre === 'jour') liste = auj;
  if (ui.filtre === 'amesurer') liste = cs.filter(c => { const f = byClient(c.id); return !f.length || f.some(x => ['vide', 'amesurer'].includes(facadeEtat(x).id)); });
  const q = ui.recherche.trim().toLowerCase();
  if (q) liste = cs.filter(c => [c.nom, c.adresse, c.telephone].join(' ').toLowerCase().includes(q));
  liste = [...liste].sort((a, b) => (a.rdv || '9').localeCompare(b.rdv || '9'));

  const dateStr = new Date().toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();

  app.innerHTML = `
  <div class="screen">
    <div class="glow g1"></div><div class="glow g2"></div>
    <header class="top">
      <div class="col">
        <span class="mono muted small">${esc(dateStr)}</span>
        <h1 class="display">Ma tournée</h1>
      </div>
    </header>

    <section class="holo">
      <div class="holo-grid" aria-hidden="true"></div>
      <div class="holo-stat">
        <span class="big-num">${String(auj.length).padStart(2, '0')}</span>
        <span class="muted2">visite${auj.length > 1 ? 's' : ''} aujourd'hui</span>
      </div>
      <div class="holo-side">
        <span class="pill-line"><span class="dot orange"></span>${aMesurer} façade${aMesurer > 1 ? 's' : ''} à mesurer</span>
        <span class="pill-line"><span class="dot vert"></span>${fmt(m2jour, 1)} m² mesurés</span>
      </div>
    </section>

    <label class="search">
      ${ICON.search}
      <input type="search" id="q" placeholder="Rechercher un client…" value="${esc(ui.recherche)}" aria-label="Rechercher un client">
    </label>

    <div class="chips" role="tablist">
      ${[['jour', `Aujourd'hui · ${auj.length}`], ['amesurer', 'À mesurer'], ['tous', `Tous · ${cs.length}`]].map(([id, l]) =>
        `<button class="chip ${ui.filtre === id && !q ? 'on' : ''}" data-filtre="${id}">${l}</button>`).join('')}
    </div>

    <div class="list">
      ${liste.length ? liste.map(c => {
        const e = clientEtat(c, byClient(c.id));
        const live = isToday(c.rdv);
        return `<a class="card client ${live && e.dot === 'orange' ? 'live' : ''}" href="#/client/${c.id}">
          <div class="time"><span class="mono strong">${heure(c.rdv)}</span><span class="mono tiny muted">${isToday(c.rdv) ? 'AUJ.' : esc(jourCourt(c.rdv))}</span></div>
          <div class="col grow">
            <span class="name">${esc(c.nom)}</span>
            <span class="muted small ellipsis">${esc(c.adresse)}</span>
            <span class="status"><span class="dot ${e.dot}"></span>${esc(e.label)}</span>
          </div>
          <span class="go">${ICON.chevron}</span>
        </a>`;
      }).join('') : `<div class="empty">
          <p>${cs.length ? 'Aucun client dans ce filtre.' : 'Aucun client pour le moment.'}</p>
          ${cs.length ? '' : '<a class="btn primary" href="#/client/nouveau">Ajouter mon premier client</a>'}
        </div>`}
    </div>

    <a class="fab" href="#/client/nouveau" aria-label="Nouveau client">${ICON.plus}</a>
  </div>`;

  app.querySelectorAll('[data-filtre]').forEach(b => b.onclick = () => { ui.filtre = b.dataset.filtre; ui.recherche = ''; viewTournee(); });
  const qi = app.querySelector('#q');
  qi.oninput = () => {
    ui.recherche = qi.value;
    const pos = qi.selectionStart;
    viewTournee().then(() => { const n = app.querySelector('#q'); n.focus(); n.setSelectionRange(pos, pos); });
  };
}

// ---------- écran : formulaire client ----------
async function viewClientForm(id) {
  const c = id ? await dbC.get(id) : { id: uid(), createdAt: new Date().toISOString() };
  if (!c) return go('#/');
  const rdvLocal = c.rdv ? new Date(new Date(c.rdv).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '';
  app.innerHTML = `
  <div class="screen">
    <header class="bar">
      <a class="round" href="${id ? `#/client/${id}` : '#/'}" aria-label="Retour">${ICON.back}</a>
      <span class="bar-title">${id ? 'Modifier le client' : 'Nouveau client'}</span>
      <span class="round ghost"></span>
    </header>
    <form class="form" id="f" novalidate>
      <label class="field"><span>Nom du client *</span><input name="nom" required value="${esc(c.nom)}" placeholder="Famille Martin"></label>
      <label class="field"><span>Adresse du chantier *</span><input name="adresse" required value="${esc(c.adresse)}" placeholder="12 rue des Lilas, 69100 Villeurbanne" autocomplete="street-address"></label>
      <label class="field"><span>Téléphone</span><input name="telephone" type="tel" value="${esc(c.telephone)}" placeholder="06 12 34 56 78"></label>
      <label class="field"><span>Rendez-vous</span><input name="rdv" type="datetime-local" value="${rdvLocal}"></label>
      <div class="row2">
        <label class="field"><span>Niveaux</span>
          <select name="niveaux">
            <option value="">Je ne sais pas</option>
            ${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${c.niveaux === n ? 'selected' : ''}>${niveauxLabel(n)}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>Surface de référence (m²)</span><input name="surfaceRef" inputmode="decimal" value="${c.surfaceRef ? fmt(c.surfaceRef, 1) : ''}" placeholder="ex. 84"></label>
      </div>
      <p class="hint">La surface de référence (ancien devis, métreur…) sert à vérifier que les mesures restent cohérentes.</p>
      <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="Accès, code portail, remarques…">${esc(c.notes)}</textarea></label>
      <p class="error" id="err" hidden></p>
      <button class="btn primary" type="submit">${id ? 'Enregistrer' : 'Créer le client'}</button>
      ${id ? '<button class="btn danger" type="button" id="del">Supprimer ce client</button>' : ''}
    </form>
  </div>`;

  const form = app.querySelector('#f');
  form.onsubmit = async e => {
    e.preventDefault();
    const d = new FormData(form);
    const nom = d.get('nom').trim(), adresse = d.get('adresse').trim();
    const err = app.querySelector('#err');
    if (!nom || !adresse) { err.textContent = 'Le nom et l\'adresse sont obligatoires.'; err.hidden = false; return; }
    const adresseChangee = adresse !== c.adresse;
    Object.assign(c, {
      nom, adresse,
      telephone: d.get('telephone').trim(),
      rdv: d.get('rdv') ? new Date(d.get('rdv')).toISOString() : null,
      niveaux: d.get('niveaux') ? Number(d.get('niveaux')) : null,
      surfaceRef: parseNum(d.get('surfaceRef')),
      notes: d.get('notes').trim(),
      updatedAt: new Date().toISOString(),
    });
    if (adresseChangee) { c.ign = null; c.ignIncorrect = false; }
    await dbC.put(c);
    go(`#/client/${c.id}`);
    if (adresseChangee) refreshIgn(c, { silent: true }).then(() => { if (location.hash === `#/client/${c.id}`) route(); });
  };
  const del = app.querySelector('#del');
  if (del) del.onclick = async () => {
    if (!confirm(`Supprimer ${c.nom} et toutes ses façades ? C'est définitif.`)) return;
    await dbC.remove(c.id);
    go('#/');
  };
}

// ---------- écran : fiche client ----------
async function viewClient(id) {
  const c = await dbC.get(id);
  if (!c) return go('#/');
  const fs = (await dbF.byClient(id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ref = checkReference(c, fs);
  const ign = c.ign;
  const ignBloc = !ign && !c.ignErreur
    ? `<div class="ign-line muted small">${navigator.onLine ? 'Recherche du bâtiment IGN…' : 'Hors ligne : données IGN plus tard.'}</div>`
    : c.ignErreur ? `<div class="ign-line small"><span class="dot orange"></span>IGN : ${esc(c.ignErreur)}</div>`
    : !ign.trouve ? `<div class="ign-line small"><span class="dot gris"></span>IGN : aucun bâtiment trouvé à cette adresse.</div>`
    : '';

  app.innerHTML = `
  <div class="screen">
    <div class="glow g3"></div>
    <header class="bar">
      <a class="round" href="#/" aria-label="Retour à la tournée">${ICON.back}</a>
      <span class="mono cyan tiny tracking"><span class="dot cyan"></span>${isToday(c.rdv) ? 'VISITE DU JOUR' : 'FICHE CLIENT'}</span>
      <a class="round" href="#/client/${c.id}/modifier" aria-label="Modifier la fiche">${ICON.edit}</a>
    </header>

    <div class="pad col gap4">
      <h1 class="display sm">${esc(c.nom)}</h1>
      <span class="muted2">${esc(c.adresse)}</span>
      ${c.rdv ? `<span class="mono muted small">RDV ${new Date(c.rdv).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>` : ''}
    </div>

    <div class="actions3">
      ${c.telephone ? `<a class="btn glass" href="tel:${esc(c.telephone.replace(/\s/g, ''))}">${ICON.phone}Appeler</a>` : '<span class="btn glass disabled">Pas de tél.</span>'}
      <a class="btn glass" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.adresse)}">${ICON.route}Itinéraire</a>
      <a class="btn glass" href="#/client/${c.id}/modifier">${ICON.edit}Modifier</a>
    </div>

    <section class="stats4">
      <div><span class="mono strong">${ign?.hauteur ? fmt(ign.hauteur, 1) + ' m' : '—'}</span><span>Haut. IGN</span></div>
      <div><span class="mono strong">${c.niveaux ? niveauxLabel(c.niveaux) : ign?.niveaux ? niveauxLabel(ign.niveaux) : '—'}</span><span>Niveaux${!c.niveaux && ign?.niveaux ? ' (IGN)' : ''}</span></div>
      <div><span class="mono strong ellipsis">${esc(ign?.materiaux || '—')}</span><span>Murs</span></div>
      <div><span class="mono strong cyan">${c.surfaceRef ? fmt(c.surfaceRef, 0) + ' m²' : '—'}</span><span>Référence</span></div>
    </section>
    ${ignBloc}
    ${ign?.trouve ? `<div class="ign-tools">
        <span class="mono tiny muted">IGN · ${ign.certitude === 'sur' ? 'bâtiment à l\'adresse' : 'bâtiment le plus proche'}${ign.usage ? ' · ' + esc(ign.usage) : ''}</span>
        <label class="toggle small"><input type="checkbox" id="ignko" ${c.ignIncorrect ? 'checked' : ''}> Données IGN fausses</label>
      </div>` : ''}
    ${ign || c.ignErreur ? `<button class="link small" id="ignrefresh">${ICON.refresh} Actualiser IGN</button>` : ''}

    ${ref ? `<div class="check ${ref.niveau}"><span class="dot ${ref.niveau}"></span><div class="col"><strong>${ref.titre}</strong><span>${esc(ref.message)}</span></div></div>` : ''}

    <div class="section-label mono">// FAÇADES</div>
    <div class="thumbs">
      ${fs.map(f => {
        const e = facadeEtat(f);
        return `<a class="thumb ${e.dot}" href="#/facade/${f.id}">
          <span class="thumb-img">${thumbSvg(f, blobUrl(f.photo), 110)}</span>
          <span class="thumb-name">${esc(f.nom)}</span>
          <span class="thumb-status"><span class="dot ${e.dot}"></span>${esc(e.label)}</span>
        </a>`;
      }).join('')}
      <button class="thumb add" id="add2" type="button">
        <span class="thumb-img add-img">${ICON.camera}</span>
        <span class="thumb-name">Nouvelle photo</span>
      </button>
    </div>

    ${c.notes ? `<div class="notes"><span class="mono tiny muted">NOTES</span><p>${esc(c.notes)}</p></div>` : ''}

    <div class="spacer"></div>
    <div class="bottom">
      <button class="btn primary big" id="add">${ICON.camera}Photographier une façade</button>
    </div>
  </div>`;

  const addFacade = async () => {
    const file = await pickPhoto();
    if (!file) return;
    toast('Préparation de la photo…');
    const { blob, width, height } = await compress(file, 1600);
    const f = {
      id: uid(), clientId: c.id, nom: `Façade ${fs.length + 1}`,
      photo: blob, photoW: width, photoH: height,
      shapes: [], cotes: {}, symetrique: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    await dbF.put(f);
    go(`#/facade/${f.id}`);
  };
  app.querySelector('#add').onclick = addFacade;
  app.querySelector('#add2').onclick = addFacade;
  const ko = app.querySelector('#ignko');
  if (ko) ko.onchange = async () => { c.ignIncorrect = ko.checked; await dbC.put(c); viewClient(id); };
  const rf = app.querySelector('#ignrefresh');
  if (rf) rf.onclick = async () => { rf.disabled = true; rf.textContent = 'Recherche…'; await refreshIgn(c); viewClient(id); };

  if (!ign && !c.ignErreur && navigator.onLine && !c._ignTried) {
    c._ignTried = true;
    refreshIgn(c, { silent: true }).then(() => { if (location.hash === `#/client/${id}`) viewClient(id); });
  }
}

// ---------- écran : résultat ----------
async function viewResultat(id) {
  const f = await dbF.get(id);
  if (!f) return go('#/');
  const c = await dbC.get(f.clientId);
  const fs = await dbF.byClient(f.clientId);
  const t = totals(f);
  const checks = allChecks(f, c, fs);
  const niveau = pire(checks);
  const hauteur = checks.find(x => x.titre === 'Hauteur du mur');
  const ratio = t.brut ? t.net / t.brut : 0;
  const circ = 2 * Math.PI * 44;
  const label = { vert: 'Cohérent', orange: 'À vérifier', rouge: 'Incohérent', gris: 'Incomplet' }[niveau];
  const typeLabel = { mur: 'Mur', pignon: 'Pignon', ouverture: 'Ouverture' };
  const k = f.photoW / 358;

  let barres = '';
  if (hauteur?.sources) {
    const max = Math.max(...hauteur.sources.map(s => s.v)) * 1.1;
    barres = `<div class="bars">${hauteur.sources.map(s => `
      <div class="bar-col ${s.id}">
        <span class="mono small strong">${s.approx ? '≈' : ''}${fmt(s.v, s.approx ? 1 : 2)}</span>
        <span class="prism" style="height:${Math.round((s.v / max) * 110)}px"><span class="body"></span><span class="top"></span></span>
        <span class="mono tiny ${s.ok === false ? 'warn' : 'muted'}">${esc(s.label.toUpperCase())}</span>
      </div>`).join('')}</div>`;
  }

  app.innerHTML = `
  <div class="screen">
    <div class="glow g4 ${niveau}"></div>
    <header class="bar">
      <a class="round" href="#/facade/${f.id}" aria-label="Retour au tracé">${ICON.back}</a>
      <div class="col center"><span class="bar-title">${esc(f.nom)} · Résultat</span><span class="mono tiny muted">${esc(c.nom.toUpperCase())}</span></div>
      <button class="round" id="print" aria-label="Imprimer ou exporter en PDF"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/></svg></button>
    </header>

    <section class="hero ${niveau}">
      <svg width="100" height="100" viewBox="0 0 110 110" role="img" aria-label="Surface nette : ${Math.round(ratio * 100)} % de la surface brute">
        <circle cx="55" cy="55" r="44" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10"/>
        <circle cx="55" cy="55" r="44" fill="none" class="ring" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(ratio * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 55 55)"/>
        <text x="55" y="54" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="18" font-weight="700" fill="#F1F5F9">${Math.round(ratio * 100)}%</text>
        <text x="55" y="70" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" fill="#94A3B8">NET/BRUT</text>
      </svg>
      <div class="col gap6">
        <span class="mono tiny tracking lvl">SURFACE NETTE</span>
        <span class="hero-num">${t.complet ? fmt(t.net, 1) : '—'}<small> m²</small></span>
        <span class="badge ${niveau}">${niveau === 'vert' ? ICON.check : ''}${label}</span>
      </div>
    </section>

    <div class="photo-recap">
      <img src="${blobUrl(f.photo)}" alt="Photo de ${esc(f.nom)}">
      <svg viewBox="0 0 ${f.photoW} ${f.photoH}" aria-hidden="true">${shapesSvg(f, k)}</svg>
    </div>

    <section class="panel">
      <span class="mono tiny muted tracking">// DÉTAIL DU CALCUL</span>
      ${t.lignes.map(l => `<div class="line"><span>${typeLabel[l.shape.type]}${l.largeur ? ` · ${fmt(l.largeur)} × ${fmt(l.hauteur)}` : l.base ? ` · base ${fmt(l.base)}, pentes ${fmt(l.pentes[0])} / ${fmt(l.pentes[1])}` : ''}</span><span class="mono strong ${l.shape.type === 'ouverture' ? 'neg' : ''}">${l.shape.type === 'ouverture' ? '− ' : ''}${fmt(l.aire)} m²</span></div>`).join('')}
      <div class="sep"></div>
      <div class="line"><span>Surface brute</span><span class="mono strong">${fmt(t.brut)} m²</span></div>
      <div class="line"><span>Ouvertures déduites</span><span class="mono strong neg">− ${fmt(t.ouvertures)} m²</span></div>
      <div class="line total"><span>Surface nette</span><span class="mono">${fmt(t.net)} m²</span></div>
      ${!t.complet ? '<p class="hint warn">Il manque des cotes : le total est incomplet.</p>' : ''}
    </section>

    ${barres ? `<section class="panel"><div class="line"><span class="mono tiny muted tracking">// HAUTEUR DU MUR · ${hauteur.sources.length} SOURCES</span></div>${barres}</section>` : ''}

    <section class="panel">
      <span class="mono tiny muted tracking">// CONTRÔLES</span>
      ${checks.map(x => `<div class="check-row"><span class="dot ${x.niveau}"></span><div class="col"><strong>${esc(x.titre)}</strong><span>${esc(x.message)}</span></div></div>`).join('')}
    </section>

    ${f.valide ? `<div class="check vert"><span class="dot vert"></span><div class="col"><strong>Métrage validé</strong><span>Le ${new Date(f.valideAt).toLocaleString('fr-FR')}${f.justification ? ` · Explication : ${esc(f.justification)}` : ''}</span></div></div>` : ''}

    ${!f.valide && niveau === 'rouge' && t.complet ? `<label class="field pad-x"><span>Explication obligatoire (écart important)</span><textarea id="justif" rows="3" placeholder="Ex. : extension récente non prise en compte dans la référence"></textarea></label>` : ''}

    <div class="spacer"></div>
    <div class="bottom">
      ${f.valide
        ? `<button class="btn glass big" id="unvalid">Rouvrir le métrage</button>`
        : `<button class="btn primary big" id="valid" ${t.complet ? '' : 'disabled'}>${t.complet ? 'Valider le métrage' : 'Cotes manquantes'}</button>`}
    </div>
  </div>`;

  app.querySelector('#print').onclick = () => window.print();
  const v = app.querySelector('#valid');
  if (v) v.onclick = async () => {
    const j = app.querySelector('#justif');
    if (j && !j.value.trim()) { j.focus(); toast('Explique l\'écart avant de valider.'); return; }
    f.valide = true;
    f.valideAt = new Date().toISOString();
    f.niveauControle = niveau;
    f.justification = j ? j.value.trim() : null;
    await dbF.put(f);
    toast('Métrage validé');
    go(`#/client/${c.id}`);
  };
  const u = app.querySelector('#unvalid');
  if (u) u.onclick = async () => { f.valide = false; await dbF.put(f); viewResultat(id); };
}

// ---------- routeur ----------
export async function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const parts = h.split('/').filter(Boolean);
  window.scrollTo(0, 0);
  document.body.classList.toggle('editor-mode', parts[0] === 'facade' && !parts[2]);
  try {
    if (!parts.length) return await viewTournee();
    if (parts[0] === 'client' && parts[1] === 'nouveau') return await viewClientForm(null);
    if (parts[0] === 'client' && parts[2] === 'modifier') return await viewClientForm(parts[1]);
    if (parts[0] === 'client') return await viewClient(parts[1]);
    if (parts[0] === 'facade' && parts[2] === 'resultat') return await viewResultat(parts[1]);
    if (parts[0] === 'facade') return await renderEditor(app, parts[1], { go, toast });
    go('#/');
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="screen pad"><h1 class="display sm">Oups</h1><p class="muted2">${esc(e.message)}</p><a class="btn primary" href="#/">Retour</a></div>`;
  }
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
