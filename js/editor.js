// Éditeur : le commercial trace la façade au doigt sur SA photo,
// puis touche chaque côté pour saisir le métrage laser + la photo de preuve.
import { facades as dbF, clients as dbC, uid } from './db.js';
import { SHAPES, normalize, edgePoints, edgeValues, totals, requiredStatus, fmt, parseNum } from './geometry.js';
import { shapesSvg, verticesSvg, esc } from './overlay.js';
import { blobUrl, compress, pickPhoto } from './images.js';
import { t } from './i18n.js';

const TOOLS = [
  { id: 'coter', icon: '<path d="M4 20 20 4M7 20H4v-3M17 4h3v3"/>' },
  { id: 'mur', icon: '<rect x="3" y="6" width="18" height="12"/>' },
  { id: 'pignon', icon: '<path d="M3 18 12 6l9 12z"/>' },
  { id: 'ouverture', icon: '<rect x="6" y="4" width="12" height="16" stroke-dasharray="3 2"/>' },
];

const HINTS = {
  coter: () => t('hint_coter'),
  mur: n => t('hint_mur', n),
  pignon: n => t('hint_pignon', n),
  ouverture: n => t('hint_ouv', n),
};

// Réglette façon molette : on la fait glisser pour ajuster la valeur par pas de 10 cm,
// avec de l'élan quand on la lance. La saisie au clavier la repositionne.
const STEP = 0.1; // un trait = 10 cm
const snap = v => Math.round(v / STEP) * STEP;

function setupRuler(el, input, initial) {
  const cv = el.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const PX = 16; // pixels par trait (10 cm)
  let val = parseNum(input.value) ?? initial ?? 0;
  let raf = 0, drag = null, alive = true;

  function draw() {
    const w = el.clientWidth, h = el.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const center = val / STEP, span = Math.ceil(w / 2 / PX) + 2;
    for (let i = -span; i <= span; i++) {
      const t = Math.round(center) + i; // index du trait (1 trait = 10 cm)
      if (t < 0) continue;
      const x = w / 2 + (t - center) * PX;
      const major = t % 10 === 0, mid = t % 5 === 0;
      const len = major ? h * 0.5 : mid ? h * 0.34 : h * 0.22;
      ctx.strokeStyle = major ? 'rgba(165,243,252,0.95)' : 'rgba(34,211,238,0.5)';
      ctx.lineWidth = major ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, h); ctx.lineTo(x, h - len); ctx.stroke();
      if (major) {
        ctx.fillStyle = '#A5F3FC';
        ctx.font = '700 11px "JetBrains Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${t / 10} m`, x, 12);
      }
    }
    el.setAttribute('aria-valuenow', val.toFixed(2));
  }

  function setVal(v, fromInput = false) {
    const before = Math.round(val / STEP);
    val = Math.max(0, Math.min(100, v));
    if (!fromInput) {
      input.value = fmt(snap(val));
      if (Math.round(val / STEP) !== before && navigator.vibrate) navigator.vibrate(6);
    }
    draw();
  }

  el.addEventListener('pointerdown', e => {
    cancelAnimationFrame(raf);
    el.setPointerCapture(e.pointerId);
    input.blur(); // cache le clavier pendant qu'on fait glisser
    drag = { x: e.clientX, start: val, lastX: e.clientX, lastT: performance.now(), v: 0 };
  });
  el.addEventListener('pointermove', e => {
    if (!drag) return;
    const now = performance.now(), dt = Math.max(1, now - drag.lastT);
    drag.v = (e.clientX - drag.lastX) / dt;
    drag.lastX = e.clientX; drag.lastT = now;
    setVal(drag.start - ((e.clientX - drag.x) / PX) * STEP);
  });
  const release = () => {
    if (!drag) return;
    // Élan limité : un geste rapide fait défiler, sans partir trop loin.
    let v = Math.max(-1.2, Math.min(1.2, drag.v)); // px / ms
    const recent = performance.now() - drag.lastT < 80;
    drag = null;
    if (!recent) v = 0;
    let last = performance.now();
    const step = now => {
      const dt = now - last; last = now;
      v *= Math.pow(0.88, dt / 16);
      if (Math.abs(v) < 0.02 || !alive) { setVal(snap(val)); return; }
      setVal(val - ((v * dt) / PX) * STEP);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setVal(snap(val) + STEP); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setVal(snap(val) - STEP); }
  });
  input.addEventListener('input', () => { const v = parseNum(input.value); if (v != null) setVal(v, true); });

  requestAnimationFrame(draw);
  return () => { alive = false; cancelAnimationFrame(raf); };
}

export async function renderEditor(root, id, { go, toast }) {
  const f = await dbF.get(id);
  if (!f) return go('#/');
  const client = await dbC.get(f.clientId);
  const url = blobUrl(f.photo);
  const W = f.photoW, H = f.photoH;
  const st = { tool: f.shapes.length ? 'coter' : 'mur', temp: [], drag: null, sel: null };

  root.innerHTML = `
  <div class="editor">
    <div class="stage" id="stage">
      <svg id="svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(t('photo_aria'))}">
        <image href="${url}" x="0" y="0" width="${W}" height="${H}"/>
        <g id="layer"></g>
      </svg>
      <div class="loupe" id="loupe" hidden><span class="cross"></span></div>
      <div class="hud-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <header class="ed-top">
        <a class="round blur" href="#/client/${f.clientId}" aria-label="${esc(t('back_card'))}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></a>
        <button class="ed-title blur" id="rename"><span id="fname">${esc(f.nom)}</span><span class="mono tiny cyan">${esc(client?.nom || '')}</span></button>
        <button class="round blur" id="del" aria-label="${esc(t('delete_facade_aria'))}"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg></button>
      </header>
    </div>

    <div class="dock" role="toolbar" aria-label="${esc(t('toolbar_aria'))}">
      ${TOOLS.map(tl => `<button class="tool" data-tool="${tl.id}" aria-pressed="false"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${tl.icon}</svg>${esc(t('tool_' + tl.id))}</button>`).join('')}
      <button class="tool" id="undo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>${esc(t('undo'))}</button>
    </div>

    <div class="ed-info">
      <div class="ed-hint" id="hint"></div>
      <div class="progress" id="prog"></div>
    </div>
    <div class="ed-bottom"><button class="btn primary big" id="result"></button></div>
    <div class="sheet-wrap" id="sheet" hidden></div>
  </div>`;

  const svg = root.querySelector('#svg');
  const layer = root.querySelector('#layer');
  const stage = root.querySelector('#stage');
  const loupe = root.querySelector('#loupe');
  loupe.style.backgroundImage = `url("${url}")`;

  const scale = () => { const m = svg.getScreenCTM(); return m ? m.a : stage.clientWidth / W; }; // px écran par px photo
  const kk = () => 1 / scale();

  // Enregistrements en file d'attente : l'écran réagit tout de suite,
  // la base suit dans l'ordre (pas de retour en arrière si on tape vite).
  let queue = Promise.resolve();
  function save({ invalidate = true } = {}) {
    f.updatedAt = new Date().toISOString();
    if (invalidate) f.valide = false;
    queue = queue.then(() => dbF.put(f)).catch(err => { console.error(err); toast(t('save_error')); });
    return queue;
  }

  function toPhoto(e) {
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.max(0, Math.min(W, p.x)), y: Math.max(0, Math.min(H, p.y)) };
  }

  function allVertices() {
    const out = [];
    f.shapes.forEach(s => s.points.forEach((p, i) => out.push({ s, i, p })));
    return out;
  }

  function snap(p) {
    const r = 26 * kk();
    let best = null, bd = r;
    for (const v of allVertices()) { const d = Math.hypot(v.p.x - p.x, v.p.y - p.y); if (d < bd) { bd = d; best = v.p; } }
    for (const t of st.temp) { const d = Math.hypot(t.x - p.x, t.y - p.y); if (d < bd) { bd = d; best = t; } }
    return best ? { x: best.x, y: best.y } : p;
  }

  function insideOuverture(p) {
    for (const s of [...f.shapes].reverse()) {
      if (s.type !== 'ouverture') continue;
      let inside = false;
      const q = s.points;
      for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
        if ((q[i].y > p.y) !== (q[j].y > p.y) && p.x < ((q[j].x - q[i].x) * (p.y - q[i].y)) / (q[j].y - q[i].y) + q[i].x) inside = !inside;
      }
      if (inside) return s;
    }
    return null;
  }

  function nearestVertex(p) {
    const r = 14 * kk();
    let best = null, bd = r;
    for (const v of allVertices()) { const d = Math.hypot(v.p.x - p.x, v.p.y - p.y); if (d < bd) { bd = d; best = v; } }
    return best;
  }

  function segDist(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }

  function nearestEdge(p) {
    const r = 22 * kk();
    let best = null, bd = r;
    for (const s of f.shapes) {
      for (let i = 0; i < s.points.length; i++) {
        const [a, b] = edgePoints(s, i);
        // Les ouvertures sont petites : on les favorise légèrement.
        const d = segDist(p, a, b) * (s.type === 'ouverture' ? 0.8 : 1);
        if (d < bd) { bd = d; best = { shapeId: s.id, edge: i }; }
      }
    }
    return best;
  }

  function redraw() {
    const k = kk();
    let tmp = '';
    const pts = [...st.temp];
    if (st.drag?.kind === 'new') pts.push(snap(st.drag.p));
    if (pts.length) {
      tmp += `<polyline points="${pts.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="#FBBF24" stroke-width="${3 * k}" stroke-dasharray="${8 * k} ${6 * k}"/>`;
      pts.forEach((p, i) => {
        tmp += `<circle cx="${p.x}" cy="${p.y}" r="${8 * k}" fill="#FBBF24" stroke="#05070D" stroke-width="${2 * k}"/>` +
          `<text x="${p.x}" y="${p.y + 4 * k}" text-anchor="middle" font-size="${10 * k}" font-weight="700" font-family="JetBrains Mono, monospace" fill="#05070D">${i + 1}</text>`;
      });
    }
    layer.innerHTML = shapesSvg(f, k, { selected: st.sel }) + verticesSvg(f, k) + tmp;
    updateChrome();
  }

  function updateChrome() {
    root.querySelectorAll('[data-tool]').forEach(b => {
      const on = b.dataset.tool === st.tool;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on);
    });
    root.querySelector('#hint').textContent = st.tool === 'coter' && !f.shapes.length ? t('hint_start') : HINTS[st.tool](st.temp.length);
    const { missing: miss, total: nbEdges } = requiredStatus(f);
    const tt = totals(f);
    const prog = root.querySelector('#prog');
    prog.innerHTML = f.shapes.length
      ? `<span class="mono small ${miss ? 'amber' : 'lime'}">${esc(miss ? t('missing_sides', miss) : t('all_cotes'))}</span>
         <span class="bar-track"><span style="width:${nbEdges ? Math.round(((nbEdges - miss) / nbEdges) * 100) : 0}%"></span></span>`
      : '';
    const btn = root.querySelector('#result');
    btn.disabled = !tt.complet;
    btn.textContent = tt.complet ? t('see_result', fmt(tt.net, 1)) : (f.shapes.length ? t('enter_missing') : t('draw_wall_first'));
  }

  function showLoupe(e, p) {
    const s = scale(), zoom = 2.6, size = 130;
    const rect = stage.getBoundingClientRect();
    let left = e.clientX - rect.left - size / 2;
    let top = e.clientY - rect.top - size - 70;
    if (top < 8) top = e.clientY - rect.top + 50;
    left = Math.max(6, Math.min(rect.width - size - 6, left));
    loupe.style.left = left + 'px';
    loupe.style.top = top + 'px';
    loupe.style.backgroundSize = `${W * s * zoom}px ${H * s * zoom}px`;
    loupe.style.backgroundPosition = `${-(p.x * s * zoom - size / 2)}px ${-(p.y * s * zoom - size / 2)}px`;
    loupe.hidden = false;
  }

  // ---------- gestes ----------
  svg.addEventListener('pointerdown', e => {
    if (e.button && e.button !== 0) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const p = toPhoto(e);
    const start = { x: e.clientX, y: e.clientY };
    if (st.tool !== 'coter') {
      st.drag = { kind: 'new', p, start };
      showLoupe(e, snap(p));
      redraw();
      return;
    }
    const v = nearestVertex(p);
    if (v) {
      const refs = allVertices().filter(x => Math.abs(x.p.x - v.p.x) < 0.5 && Math.abs(x.p.y - v.p.y) < 0.5);
      st.drag = { kind: 'move', refs, start, moved: false };
      showLoupe(e, v.p);
      return;
    }
    // Toucher l'intérieur d'une fenêtre/porte : largeur, puis hauteur.
    const o = insideOuverture(p);
    if (o) {
      const ev = edgeValues(f, o);
      st.drag = { kind: 'tap', edge: { shapeId: o.id, edge: ev[0].v == null ? 0 : ev[1].v == null ? 1 : 0 }, start };
      return;
    }
    const edge = nearestEdge(p);
    if (edge) st.drag = { kind: 'tap', edge, start };
  });

  svg.addEventListener('pointermove', e => {
    const d = st.drag;
    if (!d) return;
    const p = toPhoto(e);
    const movedPx = Math.hypot(e.clientX - d.start.x, e.clientY - d.start.y);
    if (d.kind === 'new') { d.p = p; showLoupe(e, snap(p)); redraw(); }
    else if (d.kind === 'move') {
      if (movedPx > 3) d.moved = true;
      d.refs.forEach(r => { r.s.points[r.i] = { x: p.x, y: p.y }; });
      showLoupe(e, p);
      redraw();
    } else if (d.kind === 'tap' && movedPx > 12) st.drag = null;
  });

  const end = e => {
    const d = st.drag;
    st.drag = null;
    loupe.hidden = true;
    if (!d) return;
    if (d.kind === 'new' && e.type === 'pointerup') {
      st.temp.push(snap(toPhoto(e)));
      const need = SHAPES[st.tool].points;
      if (st.temp.length >= need) {
        const type = st.tool;
        f.shapes.push({ id: uid(), type, points: normalize(type, st.temp) });
        st.temp = [];
        save();
        if (type === 'mur') { st.tool = 'coter'; toast(t('wall_drawn')); }
        else if (type === 'pignon') { st.tool = 'coter'; toast(t('pignon_drawn')); }
        else toast(t('opening_added'));
      }
      if (navigator.vibrate) navigator.vibrate(12);
    } else if (d.kind === 'move' && d.moved) {
      save();
    } else if (d.kind === 'tap' && e.type === 'pointerup') {
      openSheet(d.edge);
    }
    redraw();
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);

  root.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => {
    st.tool = b.dataset.tool;
    st.temp = [];
    redraw();
  });

  root.querySelector('#undo').onclick = async () => {
    if (st.temp.length) { st.temp.pop(); return redraw(); }
    const last = f.shapes[f.shapes.length - 1];
    if (!last) return;
    const hasCotes = f.cotes[last.id] && Object.keys(f.cotes[last.id]).length;
    if (hasCotes && !confirm(t('confirm_remove_last', SHAPES[last.type].label))) return;
    f.shapes.pop();
    delete f.cotes[last.id];
    await save();
    redraw();
  };

  root.querySelector('#rename').onclick = async () => {
    const n = prompt(t('rename_prompt'), f.nom);
    if (n && n.trim()) { f.nom = n.trim(); root.querySelector('#fname').textContent = f.nom; await save({ invalidate: false }); }
  };

  root.querySelector('#del').onclick = async () => {
    if (!confirm(t('confirm_delete_facade', f.nom))) return;
    await dbF.remove(f.id);
    go(`#/client/${f.clientId}`);
  };

  root.querySelector('#result').onclick = () => go(`#/facade/${f.id}/resultat`);

  // ---------- fiche de saisie d'une cote ----------
  function openSheet(sel) {
    const shape = f.shapes.find(s => s.id === sel.shapeId);
    if (!shape) return;
    st.sel = sel;
    redraw();
    const edgeName = SHAPES[shape.type].edges[sel.edge];
    const vals = edgeValues(f, shape);
    const cur = f.cotes[shape.id]?.[sel.edge] || null;
    const lie = vals[sel.edge].etat === 'lie' ? vals[sel.edge] : null;
    let preuve = cur?.preuve || null;
    const isPente = shape.type === 'pignon' && sel.edge < 2;
    const sym = f.symetrique?.[shape.id] !== false;
    const index = f.shapes.filter(s => s.type === shape.type).indexOf(shape) + 1;
    const nbType = f.shapes.filter(s => s.type === shape.type).length;

    const wrap = root.querySelector('#sheet');
    wrap.hidden = false;
    wrap.innerHTML = `
      <div class="sheet-bg" id="sbg"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="stitle">
        <div class="handle"></div>
        <span class="mono tiny cyan tracking">${esc(SHAPES[shape.type].label.toUpperCase())}${nbType > 1 ? ' ' + index : ''}</span>
        <h2 id="stitle" class="display xs">${shape.type === 'ouverture' ? esc(edgeName.charAt(0).toUpperCase() + edgeName.slice(1)) : esc(t('side', edgeName))}</h2>
        ${lie ? `<span class="muted small">${esc(t('deduced_now', fmt(lie.v), lie.source))}</span>` : ''}
        <div class="readout">
          <label for="val" class="mono tiny tracking">${esc(t('laser_measure'))}</label>
          <span class="row"><input id="val" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${cur ? fmt(cur.valeur) : ''}"><span class="unit">m</span></span>
          <div class="ruler" id="ruler" role="slider" aria-label="${esc(t('ruler_aria'))}" tabindex="0"><canvas></canvas><span class="needle"></span></div>
          <span class="mono tiny muted ruler-hint">${esc(t('ruler_hint'))}</span>
        </div>
        <p class="error" id="serr" hidden></p>
        <div class="proof" id="proof"></div>
        ${isPente ? `<label class="toggle box"><span class="col"><strong>${esc(t('sym_title'))}</strong><span class="small muted2">${esc(t('sym_desc'))}</span></span><input type="checkbox" id="sym" ${sym ? 'checked' : ''}></label>` : ''}
        <button class="btn primary big" id="ok">${esc(t('validate_cote'))}</button>
        <div class="row-btns">
          ${cur ? `<button class="btn glass" id="clear">${esc(t('clear_cote'))}</button>` : ''}
          <button class="btn glass danger-text" id="rm">${esc(shape.type === 'ouverture' ? t('remove_opening') : t('remove_shape'))}</button>
        </div>
      </div>`;

    const proofEl = wrap.querySelector('#proof');
    const renderProof = () => {
      proofEl.innerHTML = preuve
        ? `<img src="${blobUrl(preuve)}" alt="${esc(t('proof_desc'))}"><span class="col grow"><strong class="lime small">${esc(t('proof_ok'))}</strong><span class="mono tiny muted">${esc(t('proof_desc'))}</span></span><button class="btn glass sm" id="pp">${esc(t('retake'))}</button>`
        : `<button class="btn glass full" id="pp"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>${esc(t('take_laser_photo'))}</button>`;
      proofEl.querySelector('#pp').onclick = async () => {
        const file = await pickPhoto();
        if (!file) return;
        preuve = (await compress(file, 1000, 0.8)).blob;
        renderProof();
      };
    };
    renderProof();

    let stopRuler = () => {};
    const close = () => { stopRuler(); wrap.hidden = true; wrap.innerHTML = ''; st.sel = null; redraw(); };
    wrap.querySelector('#sbg').onclick = close;
    const input = wrap.querySelector('#val');
    setTimeout(() => input.focus(), 50);
    stopRuler = setupRuler(wrap.querySelector('#ruler'), input, cur?.valeur ?? lie?.v ?? 0);

    wrap.querySelector('#ok').onclick = async () => {
      const v = parseNum(input.value);
      const err = wrap.querySelector('#serr');
      if (v == null || v <= 0) { err.textContent = t('err_value'); err.hidden = false; return; }
      if (v > 100) { err.textContent = t('err_too_big'); err.hidden = false; return; }
      f.cotes[shape.id] = f.cotes[shape.id] || {};
      f.cotes[shape.id][sel.edge] = { valeur: v, preuve, at: new Date().toISOString() };
      if (isPente) { f.symetrique = f.symetrique || {}; f.symetrique[shape.id] = wrap.querySelector('#sym').checked; }
      save();
      if (!preuve) toast(t('saved_no_proof'));
      close();
      // Ouverture : enchaîne sur la hauteur si elle manque encore.
      if (shape.type === 'ouverture' && (sel.edge === 0 || sel.edge === 2) && edgeValues(f, shape)[1].v == null) {
        openSheet({ shapeId: shape.id, edge: 1 });
      }
    };
    input.onkeydown = e => { if (e.key === 'Enter') wrap.querySelector('#ok').click(); };
    const clear = wrap.querySelector('#clear');
    if (clear) clear.onclick = async () => { delete f.cotes[shape.id][sel.edge]; await save(); close(); };
    wrap.querySelector('#rm').onclick = async () => {
      if (!confirm(t('confirm_remove_shape'))) return;
      f.shapes = f.shapes.filter(s => s.id !== shape.id);
      delete f.cotes[shape.id];
      await save();
      close();
    };
  }

  const ro = new ResizeObserver(() => redraw());
  ro.observe(stage);
  window.addEventListener('hashchange', () => ro.disconnect(), { once: true });
  requestAnimationFrame(redraw);
}
