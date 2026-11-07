import { clients as dbC, facades as dbF, uid } from './db.js';
import { totals, missingCount, fmt, parseNum } from './geometry.js';
import { allChecks, pire, checkReference, niveauxLabel } from './checks.js';
import { fetchBatiment, decodeMateriaux, choisirBatiment, suggestAdresses } from './ign.js';
import { mapSvg } from './map.js';
import { compress, blobUrl, pickPhoto } from './images.js';
import { thumbSvg, esc, shapesSvg } from './overlay.js';
import { renderEditor } from './editor.js';
import { t, lang, setLang, LANGS, dateLocale } from './i18n.js';

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
  globe: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  print: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/></svg>',
};

// ---------- utilitaires ----------
export function go(hash) { location.hash = hash; }

export function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 2600);
}

function isToday(iso) {
  if (!iso) return false;
  const d = new Date(iso), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function heure(iso) {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' });
}

function jourCourt(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(dateLocale(), { day: '2-digit', month: 'short' });
}

function materiaux(ign) {
  if (!ign) return null;
  return ign.materiauxCode != null ? decodeMateriaux(ign.materiauxCode) : ign.materiaux || null;
}

export function facadeEtat(f) {
  if (f.valide) return { id: 'valide', label: t('st_validated'), dot: 'vert' };
  if (!f.shapes.length) return { id: 'vide', label: t('st_to_draw'), dot: 'orange' };
  const m = missingCount(f);
  if (m > 0 || !totals(f).complet) return { id: 'amesurer', label: t('st_missing', m || 1), dot: 'orange' };
  return { id: 'complet', label: t('st_to_validate', fmt(totals(f).net, 1)), dot: 'cyan' };
}

function clientEtat(c, fs) {
  if (!fs.length) return { label: t('cl_no_facade'), dot: 'violet' };
  const aMesurer = fs.filter(f => ['vide', 'amesurer'].includes(facadeEtat(f).id)).length;
  if (aMesurer) return { label: t('cl_facades_missing', aMesurer), dot: 'orange' };
  const net = fmt(fs.reduce((s, f) => s + totals(f).net, 0), 1);
  const toutes = fs.every(f => f.valide);
  return { label: toutes ? t('cl_validated', net) : t('cl_done', net), dot: toutes ? 'vert' : 'cyan' };
}

async function refreshIgn(client, { silent = false } = {}) {
  if (!navigator.onLine) { if (!silent) toast(t('ign_offline')); return client; }
  try {
    const geo = client.geo && client.geo.label === client.adresse ? client.geo : null;
    client.ign = await fetchBatiment(client.adresse, geo);
    client.ignErreur = null;
  } catch (e) {
    client.ignErreur = e.message || 'IGN';
  }
  await dbC.put(client);
  return client;
}

// ---------- choix de la langue ----------
function openLangSheet() {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-bg"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ltitle">
      <div class="handle"></div>
      <h2 id="ltitle" class="display xs">${esc(t('lang'))}</h2>
      <div class="lang-list">
        ${LANGS.map(l => `<button class="lang-item ${l.id === lang() ? 'on' : ''}" data-lang="${l.id}" lang="${l.id === 'ro' ? 'ro-MD' : l.id}">
          <span>${esc(l.label)}</span><span class="mono tiny">${l.id.toUpperCase()}</span></button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('.sheet-bg').onclick = close;
  wrap.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => { setLang(b.dataset.lang); close(); route(); });
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

  const dateStr = new Date().toLocaleDateString(dateLocale(), { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase();

  app.innerHTML = `
  <div class="screen">
    <div class="glow g1"></div><div class="glow g2"></div>
    <header class="top">
      <div class="col">
        <span class="mono muted small">${esc(dateStr)}</span>
        <h1 class="display">${esc(t('tour_title'))}</h1>
      </div>
      <button class="lang-btn" id="lang" aria-label="${esc(t('lang'))}">${ICON.globe}<span class="mono">${lang().toUpperCase()}</span></button>
    </header>

    <section class="holo">
      <div class="holo-grid" aria-hidden="true"></div>
      <div class="holo-stat">
        <span class="big-num">${String(auj.length).padStart(2, '0')}</span>
        <span class="muted2">${esc(t('tour_visits', auj.length))}</span>
      </div>
      <div class="holo-side">
        <span class="pill-line"><span class="dot orange"></span>${esc(t('tour_to_measure', aMesurer))}</span>
        <span class="pill-line"><span class="dot vert"></span>${esc(t('tour_m2', fmt(m2jour, 1)))}</span>
      </div>
    </section>

    <label class="search">
      ${ICON.search}
      <input type="search" id="q" placeholder="${esc(t('search_ph'))}" value="${esc(ui.recherche)}" aria-label="${esc(t('search_aria'))}">
    </label>

    <div class="chips" role="tablist">
      ${[['jour', t('chip_today', auj.length)], ['amesurer', t('chip_to_measure')], ['tous', t('chip_all', cs.length)]].map(([id, l]) =>
        `<button class="chip ${ui.filtre === id && !q ? 'on' : ''}" data-filtre="${id}">${esc(l)}</button>`).join('')}
    </div>

    <div class="list">
      ${liste.length ? liste.map(c => {
        const e = clientEtat(c, byClient(c.id));
        const live = isToday(c.rdv);
        return `<a class="card client ${live && e.dot === 'orange' ? 'live' : ''}" href="#/client/${c.id}">
          <div class="time"><span class="mono strong">${heure(c.rdv)}</span><span class="mono tiny muted">${isToday(c.rdv) ? esc(t('today_short')) : esc(jourCourt(c.rdv))}</span></div>
          <div class="col grow">
            <span class="name">${esc(c.nom)}</span>
            <span class="muted small ellipsis">${esc(c.adresse)}</span>
            <span class="status"><span class="dot ${e.dot}"></span>${esc(e.label)}</span>
          </div>
          <span class="go">${ICON.chevron}</span>
        </a>`;
      }).join('') : `<div class="empty">
          <p>${esc(cs.length ? t('empty_filter') : t('empty_none'))}</p>
          ${cs.length ? '' : `<a class="btn primary" href="#/client/nouveau">${esc(t('add_first'))}</a>`}
        </div>`}
    </div>

    <a class="fab" href="#/client/nouveau" aria-label="${esc(t('new_client'))}">${ICON.plus}</a>
  </div>`;

  app.querySelector('#lang').onclick = openLangSheet;
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
      <a class="round" href="${id ? `#/client/${id}` : '#/'}" aria-label="${esc(t('back'))}">${ICON.back}</a>
      <span class="bar-title">${esc(id ? t('edit_client') : t('new_client'))}</span>
      <span class="round ghost"></span>
    </header>
    <form class="form" id="f" novalidate>
      <label class="field"><span>${esc(t('f_name'))}</span><input name="nom" required value="${esc(c.nom)}" placeholder="${esc(t('f_name_ph'))}"></label>
      <div class="field addr">
        <label for="adresse">${esc(t('f_address'))}</label>
        <input id="adresse" name="adresse" required value="${esc(c.adresse)}" placeholder="${esc(t('f_address_ph'))}" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="addr-list">
        <ul class="addr-list" id="addr-list" role="listbox" hidden></ul>
      </div>
      <label class="field"><span>${esc(t('f_phone'))}</span><input name="telephone" type="tel" value="${esc(c.telephone)}" placeholder="06 12 34 56 78"></label>
      <label class="field"><span>${esc(t('f_rdv'))}</span><input name="rdv" type="datetime-local" value="${rdvLocal}"></label>
      <div class="row2">
        <label class="field"><span>${esc(t('f_levels'))}</span>
          <select name="niveaux">
            <option value="">${esc(t('f_unknown'))}</option>
            ${[1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${c.niveaux === n ? 'selected' : ''}>${esc(niveauxLabel(n))}</option>`).join('')}
          </select>
        </label>
        <label class="field"><span>${esc(t('f_ref'))}</span><input name="surfaceRef" inputmode="decimal" value="${c.surfaceRef ? fmt(c.surfaceRef, 1) : ''}" placeholder="${esc(t('f_ref_ph'))}"></label>
      </div>
      <p class="hint">${esc(t('f_ref_hint'))}</p>
      <label class="field"><span>${esc(t('f_notes'))}</span><textarea name="notes" rows="3" placeholder="${esc(t('f_notes_ph'))}">${esc(c.notes)}</textarea></label>
      <p class="error" id="err" hidden></p>
      <button class="btn primary" type="submit">${esc(id ? t('save') : t('create_client'))}</button>
      ${id ? `<button class="btn danger" type="button" id="del">${esc(t('delete_client'))}</button>` : ''}
    </form>
  </div>`;

  const form = app.querySelector('#f');

  // Adresse : suggestions dès les premières lettres (Base Adresse Nationale).
  const addr = form.querySelector('#adresse');
  const list = form.querySelector('#addr-list');
  let picked = c.geo && c.geo.label === c.adresse ? c.geo : null;
  let timer = 0, ctrl = null, items = [], active = -1;
  const closeList = () => { list.hidden = true; addr.setAttribute('aria-expanded', 'false'); active = -1; };
  const showList = () => {
    list.innerHTML = items.map((s, i) => `<li role="option" id="addr-${i}" data-i="${i}" class="${i === active ? 'on' : ''}" aria-selected="${i === active}">${esc(s.label)}</li>`).join('');
    list.hidden = !items.length;
    addr.setAttribute('aria-expanded', String(!!items.length));
    addr.setAttribute('aria-activedescendant', active >= 0 ? `addr-${active}` : '');
  };
  const choose = s => { addr.value = s.label; picked = s; items = []; closeList(); };
  addr.addEventListener('input', () => {
    picked = null;
    clearTimeout(timer);
    const q = addr.value.trim();
    if (q.length < 3 || !navigator.onLine) { items = []; closeList(); return; }
    timer = setTimeout(async () => {
      ctrl?.abort(); ctrl = new AbortController();
      try { items = await suggestAdresses(q, ctrl.signal); active = -1; showList(); } catch { /* frappe suivante */ }
    }, 220);
  });
  addr.addEventListener('keydown', e => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(items.length - 1, active + 1); showList(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); showList(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') closeList();
  });
  // pointerdown (et pas click) : le choix passe avant que le champ perde le focus.
  list.addEventListener('pointerdown', e => {
    const li = e.target.closest('[data-i]');
    if (!li) return;
    e.preventDefault();
    choose(items[Number(li.dataset.i)]);
  });
  addr.addEventListener('blur', () => setTimeout(closeList, 150));

  form.onsubmit = async e => {
    e.preventDefault();
    const d = new FormData(form);
    const nom = d.get('nom').trim(), adresse = d.get('adresse').trim();
    const err = app.querySelector('#err');
    if (!nom || !adresse) { err.textContent = t('f_required'); err.hidden = false; return; }
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
    if (picked && picked.label === adresse) c.geo = { label: picked.label, lon: picked.lon, lat: picked.lat };
    if (adresseChangee) { c.ign = null; c.ignErreur = null; c.ignIncorrect = false; }
    await dbC.put(c);
    go(`#/client/${c.id}`);
    if (adresseChangee) refreshIgn(c, { silent: true }).then(() => { if (location.hash === `#/client/${c.id}`) route(); });
  };
  const del = app.querySelector('#del');
  if (del) del.onclick = async () => {
    if (!confirm(t('confirm_delete_client', c.nom))) return;
    await dbC.remove(c.id);
    go('#/');
  };
}

// ---------- écran : fiche client ----------
const ignTried = new Set();

async function viewClient(id) {
  const c = await dbC.get(id);
  if (!c) return go('#/');
  const fs = (await dbF.byClient(id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const ref = checkReference(c, fs);
  const ign = c.ign;
  const ignBloc = !ign && !c.ignErreur
    ? `<div class="ign-line muted small">${esc(navigator.onLine ? t('ign_searching') : t('ign_offline_later'))}</div>`
    : c.ignErreur ? `<div class="ign-line small"><span class="dot orange"></span>${esc(t('ign_error', c.ignErreur))}</div>`
    : !ign.trouve ? `<div class="ign-line small"><span class="dot gris"></span>${esc(t('ign_none'))}</div>`
    : '';
  const niv = c.niveaux ? niveauxLabel(c.niveaux) : ign?.niveaux ? niveauxLabel(ign.niveaux) : '—';

  app.innerHTML = `
  <div class="screen">
    <div class="glow g3"></div>
    <header class="bar">
      <a class="round" href="#/" aria-label="${esc(t('back_tour'))}">${ICON.back}</a>
      <span class="mono cyan tiny tracking"><span class="dot cyan"></span>${esc(isToday(c.rdv) ? t('visit_today') : t('client_card'))}</span>
      <a class="round" href="#/client/${c.id}/modifier" aria-label="${esc(t('edit_card'))}">${ICON.edit}</a>
    </header>

    <div class="pad col gap4">
      <h1 class="display sm">${esc(c.nom)}</h1>
      <span class="muted2">${esc(c.adresse)}</span>
      ${c.rdv ? `<span class="mono muted small">${esc(t('rdv'))} ${esc(new Date(c.rdv).toLocaleString(dateLocale(), { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>` : ''}
    </div>

    <div class="actions3">
      ${c.telephone ? `<a class="btn glass" href="tel:${esc(c.telephone.replace(/\s/g, ''))}">${ICON.phone}${esc(t('call'))}</a>` : `<span class="btn glass disabled">${esc(t('no_phone'))}</span>`}
      <a class="btn glass" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.adresse)}">${ICON.route}${esc(t('route'))}</a>
      <a class="btn glass" href="#/client/${c.id}/modifier">${ICON.edit}${esc(t('edit'))}</a>
    </div>

    <section class="stats4">
      <div><span class="mono strong">${ign?.hauteur ? fmt(ign.hauteur, 1) + ' m' : '—'}</span><span>${esc(t('s_ign_height'))}</span></div>
      <div><span class="mono strong">${esc(niv)}</span><span>${esc(t('s_levels'))}${!c.niveaux && ign?.niveaux ? esc(t('s_ign_suffix')) : ''}</span></div>
      <div><span class="mono strong ellipsis">${esc(materiaux(ign) || '—')}</span><span>${esc(t('s_walls'))}</span></div>
      <div><span class="mono strong cyan">${c.surfaceRef ? fmt(c.surfaceRef, 0) + ' m²' : '—'}</span><span>${esc(t('s_reference'))}</span></div>
    </section>
    ${ignBloc}
    ${ign?.trouve ? `<div class="ign-tools">
        <span class="mono tiny muted">IGN · ${esc(ign.certitude === 'sur' ? t('ign_at_address') : t('ign_nearest'))}${ign.usage ? ' · ' + esc(ign.usage) : ''}</span>
        <label class="toggle small"><input type="checkbox" id="ignko" ${c.ignIncorrect ? 'checked' : ''}> ${esc(t('ign_wrong'))}</label>
      </div>` : ''}
    ${ign || c.ignErreur ? `<button class="link small" id="ignrefresh">${ICON.refresh} ${esc(t('ign_refresh'))}</button>` : ''}

    ${ref ? `<div class="check ${ref.niveau}"><span class="dot ${ref.niveau}"></span><div class="col"><strong>${esc(ref.titre)}</strong><span>${esc(ref.message)}</span></div></div>` : ''}

    ${ign?.trouve && ign.contour?.length >= 3 ? `
    <div class="section-label mono">${esc(t('plan_section'))}</div>
    <a class="plan-preview" href="#/client/${c.id}/plan">
      ${mapSvg(ign, { widthPx: 358, aspect: 358 / 190, assign: assignMap(fs) }).svg}
      <span class="plan-badge">${esc(t('plan_placed', { a: fs.filter(f => f.ignCote != null).length, t: fs.length }))}</span>
    </a>` : ''}

    <div class="section-label mono">${esc(t('facades_label'))}</div>
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
        <span class="thumb-name">${esc(t('new_photo'))}</span>
      </button>
    </div>

    ${c.notes ? `<div class="notes"><span class="mono tiny muted">${esc(t('notes_label'))}</span><p>${esc(c.notes)}</p></div>` : ''}

    <div class="spacer"></div>
    <div class="bottom">
      <button class="btn primary big" id="add">${ICON.camera}${esc(t('take_photo'))}</button>
    </div>
  </div>`;

  const addFacade = async () => {
    const file = await pickPhoto();
    if (!file) return;
    toast(t('preparing_photo'));
    const { blob, width, height } = await compress(file, 1600);
    const f = {
      id: uid(), clientId: c.id, nom: t('facade_default', fs.length + 1),
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
  if (rf) rf.onclick = async () => { rf.disabled = true; rf.textContent = t('searching'); await refreshIgn(c); viewClient(id); };

  if (!ign && !c.ignErreur && navigator.onLine && !ignTried.has(id)) {
    ignTried.add(id);
    refreshIgn(c, { silent: true }).then(() => { if (location.hash === `#/client/${id}`) viewClient(id); });
  }
}

// ---------- écran : vue du dessus (photo aérienne IGN) ----------
function assignMap(fs) {
  const out = {};
  fs.forEach(f => { if (f.ignCote != null) out[f.ignCote] = { url: blobUrl(f.photo), nom: f.nom }; });
  return out;
}

function segDist(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const k = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + k * dx), py - (a[1] + k * dy));
}

const plan = { clientId: null, sel: null, pick: false };

async function viewPlan(id) {
  const c = await dbC.get(id);
  if (!c) return go('#/');
  const fs = (await dbF.byClient(id)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (plan.clientId !== id) Object.assign(plan, { clientId: id, sel: null, pick: false });
  const ign = c.ign;
  const hasContour = ign?.trouve && ign.contour?.length >= 3;
  const selF = fs.find(f => f.id === plan.sel);

  app.innerHTML = `
  <div class="screen">
    <header class="bar">
      <a class="round" href="#/client/${c.id}" aria-label="${esc(t('back'))}">${ICON.back}</a>
      <div class="col center"><span class="bar-title">${esc(t('plan_title'))}</span><span class="mono tiny muted">${esc(c.nom.toUpperCase())}</span></div>
      <span class="round ghost"></span>
    </header>
    <div class="plan-map" id="pm">${hasContour ? '' : `<div class="plan-empty"><p>${esc(t('plan_no_contour'))}</p><button class="btn glass" id="ignrefresh">${ICON.refresh}${esc(t('ign_refresh'))}</button></div>`}</div>
    <p class="plan-hint ${plan.pick ? 'violet' : ''}" id="ph">${esc(plan.pick ? t('plan_pick_house') : selF ? t('plan_hint_selected', selF.nom) : fs.length ? t('plan_hint') : t('plan_no_facades'))}</p>
    <div class="plan-tray">
      ${fs.map(f => `<button class="plan-thumb ${plan.sel === f.id ? 'on' : ''} ${f.ignCote != null ? 'placed' : ''}" data-fid="${f.id}" aria-pressed="${plan.sel === f.id}">
          <img src="${blobUrl(f.photo)}" alt="" draggable="false">
          <span class="badge-letter">${f.ignCote != null ? (String.fromCharCode(65 + f.ignCote)) : '?'}</span>
          <span class="thumb-name ellipsis">${esc(f.nom)}</span>
        </button>`).join('')}
    </div>
    <div class="plan-actions">
      ${selF && selF.ignCote != null ? `<button class="btn glass" id="unplace">${esc(t('plan_remove'))}</button>` : ''}
      ${hasContour && ign.candidats?.length > 1 ? `<button class="link small" id="pick">${esc(plan.pick ? t('plan_cancel_pick') : t('plan_wrong_house'))}</button>` : ''}
    </div>
  </div>`;

  const rerender = () => viewPlan(id);
  const rf = app.querySelector('#ignrefresh');
  if (rf) rf.onclick = async () => { rf.disabled = true; await refreshIgn(c); rerender(); };
  const pickBtn = app.querySelector('#pick');
  if (pickBtn) pickBtn.onclick = () => { plan.pick = !plan.pick; plan.sel = null; rerender(); };
  const un = app.querySelector('#unplace');
  if (un) un.onclick = async () => { selF.ignCote = null; await dbF.put(selF); plan.sel = null; rerender(); };

  const assignTo = async (fid, edge) => {
    for (const f of fs) {
      if (f.id === fid) f.ignCote = edge;
      else if (f.ignCote === edge) f.ignCote = null;
      else continue;
      await dbF.put(f);
    }
    if (navigator.vibrate) navigator.vibrate(15);
    plan.sel = null;
    rerender();
  };

  // Photos du bas : on touche pour choisir, ou on fait glisser sur un côté.
  let res = null;
  const pm = app.querySelector('#pm');
  const edgeAt = (x, y) => {
    const svg = pm.querySelector('svg');
    if (!svg || !res) return null;
    const r = pm.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
    const m = svg.getScreenCTM();
    const pt = svg.createSVGPoint(); pt.x = x; pt.y = y;
    const p = pt.matrixTransform(m.inverse());
    let best = null, bd = 40 / m.a;
    res.pts.forEach((a, i) => { const d = segDist(p.x, p.y, a, res.pts[(i + 1) % res.pts.length]); if (d < bd) { bd = d; best = i; } });
    return best;
  };
  const highlight = edge => {
    const svg = pm.querySelector('svg');
    if (!svg) return;
    let hl = svg.querySelector('#hl');
    if (edge == null) { hl?.remove(); return; }
    const a = res.pts[edge], b = res.pts[(edge + 1) % res.pts.length];
    if (!hl) { hl = document.createElementNS('http://www.w3.org/2000/svg', 'line'); hl.id = 'hl'; svg.appendChild(hl); }
    const k = 1 / svg.getScreenCTM().a;
    Object.entries({ x1: a[0], y1: a[1], x2: b[0], y2: b[1], stroke: '#22D3EE', 'stroke-width': 9 * k, 'stroke-linecap': 'round' }).forEach(([n, v]) => hl.setAttribute(n, v));
  };

  app.querySelectorAll('[data-fid]').forEach(btn => {
    btn.addEventListener('pointerdown', e => {
      if (plan.pick) return;
      e.preventDefault();
      const fid = btn.dataset.fid;
      const start = { x: e.clientX, y: e.clientY };
      let ghost = null, over = null;
      const move = ev => {
        if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 8) {
          ghost = document.createElement('div');
          ghost.className = 'drag-ghost';
          ghost.innerHTML = `<img src="${btn.querySelector('img').src}" alt="">`;
          document.body.appendChild(ghost);
        }
        if (ghost) {
          ghost.style.transform = `translate(${ev.clientX - 36}px, ${ev.clientY - 80}px)`;
          const o = edgeAt(ev.clientX, ev.clientY - 44);
          if (o !== over) { over = o; highlight(over); }
        }
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        if (ghost) {
          ghost.remove();
          if (over != null) assignTo(fid, over); else highlight(null);
        } else {
          plan.sel = plan.sel === fid ? null : fid;
          rerender();
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  });

  if (!hasContour) return;
  // Carte dessinée après coup : il faut sa taille réelle à l'écran.
  const w = pm.clientWidth, h = pm.clientHeight;
  res = mapSvg(ign, {
    widthPx: w, aspect: w / h, assign: assignMap(fs), interactive: true,
    selected: selF?.ignCote ?? null, candidats: plan.pick,
  });
  pm.innerHTML = res.svg;
  const svg = pm.querySelector('svg');
  svg.addEventListener('click', async e => {
    const cand = e.target.closest('[data-cand]');
    if (plan.pick && cand) {
      c.ign = choisirBatiment(c.ign, Number(cand.dataset.cand));
      for (const f of fs) if (f.ignCote != null) { f.ignCote = null; await dbF.put(f); }
      await dbC.put(c);
      plan.pick = false;
      toast(t('plan_house_changed'));
      return rerender();
    }
    if (plan.pick) return;
    const edgeEl = e.target.closest('[data-edge]');
    const edge = edgeEl ? Number(edgeEl.dataset.edge) : edgeAt(e.clientX, e.clientY);
    if (edge == null) return;
    if (plan.sel) return assignTo(plan.sel, edge);
    const owner = fs.find(f => f.ignCote === edge);
    if (owner) { plan.sel = owner.id; rerender(); } else toast(t('plan_tap_photo_first'));
  });
}

// ---------- écran : résultat ----------
async function viewResultat(id) {
  const f = await dbF.get(id);
  if (!f) return go('#/');
  const c = await dbC.get(f.clientId);
  const fs = await dbF.byClient(f.clientId);
  const tt = totals(f);
  const checks = allChecks(f, c, fs);
  const niveau = pire(checks);
  const hauteur = checks.find(x => x.id === 'hauteur');
  const ratio = tt.brut ? tt.net / tt.brut : 0;
  const circ = 2 * Math.PI * 44;
  const label = t('lvl_' + niveau);
  const typeLabel = { mur: t('type_mur'), pignon: t('type_pignon'), ouverture: t('type_ouverture') };
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
      <a class="round" href="#/facade/${f.id}" aria-label="${esc(t('back_trace'))}">${ICON.back}</a>
      <div class="col center"><span class="bar-title">${esc(f.nom)} · ${esc(t('result_suffix'))}</span><span class="mono tiny muted">${esc(c.nom.toUpperCase())}</span></div>
      <button class="round" id="print" aria-label="${esc(t('print_aria'))}">${ICON.print}</button>
    </header>

    <section class="hero ${niveau}">
      <svg width="100" height="100" viewBox="0 0 110 110" role="img" aria-label="${esc(t('ring_aria', Math.round(ratio * 100)))}">
        <circle cx="55" cy="55" r="44" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="10"/>
        <circle cx="55" cy="55" r="44" fill="none" class="ring" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(ratio * circ).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 55 55)"/>
        <text x="55" y="54" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="18" font-weight="700" fill="#F1F5F9">${Math.round(ratio * 100)}%</text>
        <text x="55" y="70" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" fill="#94A3B8">${esc(t('net_gross'))}</text>
      </svg>
      <div class="col gap6">
        <span class="mono tiny tracking lvl">${esc(t('net_area'))}</span>
        <span class="hero-num">${tt.complet ? fmt(tt.net, 1) : '—'}<small> m²</small></span>
        <span class="badge ${niveau}">${niveau === 'vert' ? ICON.check : ''}${esc(label)}</span>
      </div>
    </section>

    <div class="photo-recap">
      <img src="${blobUrl(f.photo)}" alt="${esc(f.nom)}">
      <svg viewBox="0 0 ${f.photoW} ${f.photoH}" aria-hidden="true">${shapesSvg(f, k)}</svg>
    </div>

    <section class="panel">
      <span class="mono tiny muted tracking">${esc(t('calc_detail'))}</span>
      ${tt.lignes.map(l => `<div class="line"><span>${esc(typeLabel[l.shape.type])}${l.largeur ? ` · ${fmt(l.largeur)} × ${fmt(l.hauteur)}` : l.base ? ` · ${esc(t('base_slopes', fmt(l.base), fmt(l.pentes[0]), fmt(l.pentes[1])))}` : ''}</span><span class="mono strong ${l.shape.type === 'ouverture' ? 'neg' : ''}">${l.shape.type === 'ouverture' ? '− ' : ''}${fmt(l.aire)} m²</span></div>`).join('')}
      <div class="sep"></div>
      <div class="line"><span>${esc(t('gross_area'))}</span><span class="mono strong">${fmt(tt.brut)} m²</span></div>
      <div class="line"><span>${esc(t('openings_deducted'))}</span><span class="mono strong neg">− ${fmt(tt.ouvertures)} m²</span></div>
      <div class="line total"><span>${esc(t('net_area_line'))}</span><span class="mono">${fmt(tt.net)} m²</span></div>
      ${!tt.complet ? `<p class="hint warn">${esc(t('incomplete_total'))}</p>` : ''}
    </section>

    ${barres ? `<section class="panel"><div class="line"><span class="mono tiny muted tracking">${esc(t('height_sources', hauteur.sources.length))}</span></div>${barres}</section>` : ''}

    <section class="panel">
      <span class="mono tiny muted tracking">${esc(t('checks_label'))}</span>
      ${checks.map(x => `<div class="check-row"><span class="dot ${x.niveau}"></span><div class="col"><strong>${esc(x.titre)}</strong><span>${esc(x.message)}</span></div></div>`).join('')}
    </section>

    ${f.valide ? `<div class="check vert"><span class="dot vert"></span><div class="col"><strong>${esc(t('validated_title'))}</strong><span>${esc(t('validated_on', new Date(f.valideAt).toLocaleString(dateLocale())))}${f.justification ? ` · ${esc(t('explanation', f.justification))}` : ''}</span></div></div>` : ''}

    ${!f.valide && niveau === 'rouge' && tt.complet ? `<label class="field pad-x"><span>${esc(t('justif_label'))}</span><textarea id="justif" rows="3" placeholder="${esc(t('justif_ph'))}"></textarea></label>` : ''}

    <div class="spacer"></div>
    <div class="bottom">
      ${f.valide
        ? `<button class="btn glass big" id="unvalid">${esc(t('reopen'))}</button>`
        : `<button class="btn primary big" id="valid" ${tt.complet ? '' : 'disabled'}>${esc(tt.complet ? t('validate') : t('missing_cotes'))}</button>`}
    </div>
  </div>`;

  app.querySelector('#print').onclick = () => window.print();
  const v = app.querySelector('#valid');
  if (v) v.onclick = async () => {
    const j = app.querySelector('#justif');
    if (j && !j.value.trim()) { j.focus(); toast(t('explain_first')); return; }
    f.valide = true;
    f.valideAt = new Date().toISOString();
    f.niveauControle = niveau;
    f.justification = j ? j.value.trim() : null;
    await dbF.put(f);
    toast(t('validated_toast'));
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
    if (parts[0] === 'client' && parts[2] === 'plan') return await viewPlan(parts[1]);
    if (parts[0] === 'client') return await viewClient(parts[1]);
    if (parts[0] === 'facade' && parts[2] === 'resultat') return await viewResultat(parts[1]);
    if (parts[0] === 'facade') return await renderEditor(app, parts[1], { go, toast });
    go('#/');
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="screen pad"><h1 class="display sm">${esc(t('oops'))}</h1><p class="muted2">${esc(e.message)}</p><a class="btn primary" href="#/">${esc(t('back'))}</a></div>`;
  }
}

window.addEventListener('hashchange', route);
route();

// Mises à jour automatiques : quand une nouvelle version est publiée,
// l'appli la récupère et se recharge d'elle-même (sauf en plein tracé).
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloaded) return;
    reloaded = true;
    const reload = () => location.reload();
    if (document.body.classList.contains('editor-mode')) {
      toast(t('update_ready'));
      window.addEventListener('hashchange', reload, { once: true });
    } else reload();
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(reg => {
    const check = () => reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    setInterval(check, 30 * 60 * 1000);
  }).catch(() => {});
}
