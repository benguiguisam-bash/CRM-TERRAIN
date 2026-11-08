// Maquette 3D : la maison sort du plan IGN, avec les photos de façade plaquées sur les murs.
// Animation : vue d'en haut -> plongée -> les murs montent -> le toit se pose -> on tourne autour.
import { project, LETTRES } from './map.js';
import { mainMur, rectDims } from './geometry.js';
import { esc } from './overlay.js';
import { t } from './i18n.js';

const Z = 19;

const ease = x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const clamp01 = x => Math.max(0, Math.min(1, x));

async function loadImage(src, cors = false) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Découpe la photo autour du mur (et du pignon si demandé) pour la plaquer sur le mur 3D.
async function photoCanvas(facade, withPignon) {
  const bmp = await createImageBitmap(facade.photo);
  const shapes = facade.shapes.filter(s => s.type === 'mur' || (s.type === 'poly' && s.role !== 'ouverture') || (withPignon && s.type === 'pignon'));
  let x0 = 0, y0 = 0, x1 = facade.photoW, y1 = facade.photoH;
  if (shapes.length) {
    const ps = shapes.flatMap(s => s.points);
    x0 = Math.min(...ps.map(p => p.x)); x1 = Math.max(...ps.map(p => p.x));
    y0 = Math.min(...ps.map(p => p.y)); y1 = Math.max(...ps.map(p => p.y));
  }
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const k = Math.min(1, 1024 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(bmp, x0, y0, w, h, 0, 0, c.width, c.height);
  return c;
}

export async function render3d(root, client, facades, { go }) {
  const ign = client.ign;
  root.innerHTML = `
  <div class="v3d">
    <div class="v3d-stage" id="st"></div>
    <header class="ed-top">
      <a class="round blur" href="#/client/${client.id}" aria-label="${esc(t('back'))}"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6"/></svg></a>
      <div class="ed-title blur"><span>${esc(t('v3d_title'))}</span><span class="mono tiny cyan">${esc(client.nom)}</span></div>
      <button class="round blur" id="replay" aria-label="${esc(t('v3d_replay'))}"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg></button>
    </header>
    <div class="v3d-hint" id="hint">${esc(t('v3d_loading'))}</div>
  </div>`;
  const stage = root.querySelector('#st');
  const hint = root.querySelector('#hint');

  if (!ign?.contour || ign.contour.length < 3) { hint.textContent = t('plan_no_contour'); return; }

  let THREE, OrbitControls;
  try {
    THREE = await import('three');
    ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
  } catch {
    hint.textContent = t('v3d_need_net');
    return;
  }
  if (!stage.isConnected) return;

  // ---------- repère en mètres, centré sur la maison (x = est, z = sud) ----------
  const lat0 = ign.contour[0][1];
  const mpp = (156543.03392 * Math.cos((lat0 * Math.PI) / 180)) / 2 ** Z; // mètres par pixel de tuile
  const px = ign.contour.map(([lo, la]) => project(lo, la));
  const cx = px.reduce((s, p) => s + p[0], 0) / px.length;
  const cy = px.reduce((s, p) => s + p[1], 0) / px.length;
  const pts = px.map(([x, y]) => new THREE.Vector2((x - cx) * mpp, (y - cy) * mpp));
  const size = Math.max(...pts.map(p => p.length())) * 2 || 10;

  // Hauteur des murs : moyenne des hauteurs laser, sinon IGN.
  const hs = facades.map(f => { const m = mainMur(f); return m ? rectDims(f, m).hauteur : null; }).filter(Boolean);
  const H = hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : ign.hauteur || 6;
  const ridge = ign.faitage && ign.faitage > H + 0.4 ? ign.faitage : null;
  const byEdge = {};
  facades.forEach(f => { if (f.ignCote != null) byEdge[f.ignCote] = f; });

  // ---------- scène ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#05070D');
  scene.fog = new THREE.Fog('#05070D', size * 10, size * 22);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);

  scene.add(new THREE.HemisphereLight('#dbeafe', '#334155', 1.1));
  const sun = new THREE.DirectionalLight('#fff7ed', 1.6);
  sun.position.set(size * 1.2, size * 2.2, size * 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -size * 1.5, right: size * 1.5, top: size * 1.5, bottom: -size * 1.5, near: 0.5, far: size * 8 });
  scene.add(sun);

  // ---------- sol : photo aérienne IGN ----------
  const margin = Math.max(45, size * 3) / mpp;
  const minX = Math.min(...px.map(p => p[0])) - margin, maxX = Math.max(...px.map(p => p[0])) + margin;
  const minY = Math.min(...px.map(p => p[1])) - margin, maxY = Math.max(...px.map(p => p[1])) + margin;
  const tx0 = Math.floor(minX / 256), tx1 = Math.floor(maxX / 256), ty0 = Math.floor(minY / 256), ty1 = Math.floor(maxY / 256);
  const gc = document.createElement('canvas');
  gc.width = (tx1 - tx0 + 1) * 256; gc.height = (ty1 - ty0 + 1) * 256;
  const gx = gc.getContext('2d');
  gx.fillStyle = '#1E293B'; gx.fillRect(0, 0, gc.width, gc.height);
  const groundTex = new THREE.CanvasTexture(gc);
  groundTex.colorSpace = THREE.SRGBColorSpace;
  const tiles = [];
  for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
    const url = `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${Z}&TILEROW=${y}&TILECOL=${x}&FORMAT=image/jpeg`;
    tiles.push(loadImage(url, true).then(img => { gx.drawImage(img, (x - tx0) * 256, (y - ty0) * 256); groundTex.needsUpdate = true; }).catch(() => {}));
  }
  const gw = gc.width * mpp, gh = gc.height * mpp;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(((tx0 * 256 + gc.width / 2) - cx) * mpp, 0, ((ty0 * 256 + gc.height / 2) - cy) * mpp);
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- maison ----------
  const house = new THREE.Group();
  scene.add(house);
  const enduit = new THREE.MeshStandardMaterial({ color: '#d8d1c3', roughness: 0.95, side: THREE.DoubleSide });

  // Toit à deux pans si le bâtiment est un rectangle et que l'IGN donne un faîtage.
  let gable = null;
  if (ridge && pts.length === 4) {
    const L = i => pts[i].distanceTo(pts[(i + 1) % 4]);
    gable = L(0) + L(2) < L(1) + L(3) ? [0, 2] : [1, 3]; // côtés courts = pignons
  }

  const walls = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const isGableEnd = gable && gable.includes(i);
    const top = isGableEnd ? ridge : H;
    // Normale vers l'extérieur : sert à mettre la photo dans le bon sens (gauche/droite).
    const mid = a.clone().add(b).multiplyScalar(0.5);
    let n = new THREE.Vector2(b.y - a.y, -(b.x - a.x)).normalize();
    if (n.dot(mid) < 0) n.negate();
    const right = new THREE.Vector2(n.y, -n.x); // à droite quand on regarde le mur de dehors
    const aLeft = b.clone().sub(a).dot(right) > 0;
    const ua = aLeft ? 0 : 1, ub = 1 - ua;

    const pos = [], uv = [], idx = [];
    const push = (x, y, z, u, v) => { pos.push(x, y, z); uv.push(u, v); return pos.length / 3 - 1; };
    const v0 = push(a.x, 0, a.y, ua, 0), v1 = push(b.x, 0, b.y, ub, 0);
    const v2 = push(b.x, H, b.y, ub, H / top), v3 = push(a.x, H, a.y, ua, H / top);
    idx.push(v0, v1, v2, v0, v2, v3);
    if (isGableEnd) {
      const v4 = push(mid.x, ridge, mid.y, 0.5, 1);
      idx.push(v3, v2, v4);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const f = byEdge[i];
    const mesh = new THREE.Mesh(geo, enduit);
    mesh.castShadow = true;
    house.add(mesh);
    walls.push(mesh);
    if (f) {
      photoCanvas(f, isGableEnd).then(c => {
        const tex = new THREE.CanvasTexture(c);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        mesh.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide });
      }).catch(() => {});
    }
  }

  // Toit
  const roof = new THREE.Group();
  const roofMat = new THREE.MeshStandardMaterial({ color: '#8a4b3a', roughness: 0.85, side: THREE.DoubleSide });
  if (gable) {
    const [g1, g2] = gable;
    const R = i => { const m = pts[i].clone().add(pts[(i + 1) % 4]).multiplyScalar(0.5); return new THREE.Vector3(m.x, ridge, m.y); };
    const r1 = R(g1), r2 = R(g2);
    const P = i => new THREE.Vector3(pts[i % 4].x, H, pts[i % 4].y);
    const long = [0, 1, 2, 3].filter(i => !gable.includes(i));
    long.forEach(i => {
      const a = P(i), b = P(i + 1);
      // Le pan rejoint le faîtage côté pignon le plus proche de chaque extrémité.
      const ra = a.distanceTo(r1) < a.distanceTo(r2) ? r1 : r2;
      const rb = ra === r1 ? r2 : r1;
      const geo = new THREE.BufferGeometry().setFromPoints([a, b, rb, a, rb, ra]);
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, roofMat);
      m.castShadow = true;
      roof.add(m);
    });
  } else {
    const shape = new THREE.Shape(pts.map(p => new THREE.Vector2(p.x, -p.y)));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshStandardMaterial({ color: '#4b5563', roughness: 0.9, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2;
    m.position.y = H;
    m.castShadow = true;
    roof.add(m);
  }
  house.add(roof);

  // Lettres des façades placées, flottant devant chaque mur.
  for (let i = 0; i < pts.length; i++) {
    if (!byEdge[i]) continue;
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#A3E635'; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#05070D'; g.font = 'bold 72px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(LETTRES[i] || String(i + 1), 64, 70);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    const out = mid.clone().normalize().multiplyScalar(1.2);
    sp.position.set(mid.x + out.x, H + 1.2, mid.y + out.y);
    sp.scale.set(1.4, 1.4, 1.4);
    sp.userData.label = true;
    house.add(sp);
  }

  // ---------- caméra et animation ----------
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.48;
  controls.minDistance = size * 0.6;
  controls.maxDistance = size * 6;
  controls.target.set(0, H * 0.45, 0);
  controls.enabled = false;
  controls.addEventListener('start', () => { controls.autoRotate = false; });

  // Vue finale : en face de la première façade placée, un peu de biais.
  const firstEdge = Object.keys(byEdge).map(Number)[0];
  let dir = new THREE.Vector2(1, 1).normalize();
  if (firstEdge != null) {
    const a = pts[firstEdge], b = pts[(firstEdge + 1) % pts.length];
    dir = a.clone().add(b).multiplyScalar(0.5).normalize().rotateAround(new THREE.Vector2(0, 0), 0.55);
  }
  // Distance de fin calculée pour que toute la maison tienne dans l'écran (téléphone en hauteur).
  let keys = [];
  const makeKeys = () => {
    const hfov = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    const r = Math.max(size / 2, H);
    const d = Math.max(size * 1.6, (r * 1.25) / Math.tan(hfov));
    const flat = d * 0.82, up = d * 0.42;
    keys = [
      { t: 0, p: new THREE.Vector3(0, d * 2.4, 0.01) },
      { t: 2.4, p: new THREE.Vector3(dir.x * d * 0.25, d * 1.2, dir.y * d * 0.25) },
      { t: 6, p: new THREE.Vector3(dir.x * flat, up, dir.y * flat) },
    ];
    controls.maxDistance = d * 2.5;
  };
  const camAt = time => {
    let k = keys.length - 2;
    for (let i = 0; i < keys.length - 1; i++) if (time < keys[i + 1].t) { k = i; break; }
    const A = keys[k], B = keys[k + 1];
    const u = ease(clamp01((time - A.t) / (B.t - A.t)));
    return A.p.clone().lerp(B.p, u);
  };

  let start = performance.now(), raf = 0, alive = true, done = false;
  const setPose = time => {
    house.scale.y = Math.max(0.001, ease(clamp01((time - 2.0) / 2.0)));
    roof.visible = time > 3.9;
    roof.scale.setScalar(roof.visible ? 0.6 + 0.4 * ease(clamp01((time - 3.9) / 0.7)) : 1);
    house.children.forEach(c => { if (c.userData.label) c.visible = time > 4.8; });
  };
  const replay = () => {
    start = performance.now(); done = false;
    controls.enabled = false; controls.autoRotate = false;
    hint.textContent = '';
  };
  root.querySelector('#replay').onclick = replay;

  const resize = () => {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    makeKeys();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();

  const loop = () => {
    if (!alive || !stage.isConnected) { cleanup(); return; }
    const time = (performance.now() - start) / 1000;
    if (!done) {
      setPose(time);
      camera.position.copy(camAt(time));
      camera.lookAt(0, time < 2.4 ? 0 : H * 0.45 * clamp01((time - 2.4) / 1.5), 0);
      if (time > 6.1) {
        done = true;
        controls.enabled = true;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.8;
        hint.textContent = t('v3d_hint');
      }
    } else {
      controls.update();
    }
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  const cleanup = () => {
    alive = false;
    cancelAnimationFrame(raf);
    ro.disconnect();
    controls.dispose();
    renderer.dispose();
  };
  window.addEventListener('hashchange', cleanup, { once: true });

  await Promise.race([Promise.all(tiles), new Promise(r => setTimeout(r, 2500))]);
  hint.textContent = '';
  start = performance.now();
  loop();
}
