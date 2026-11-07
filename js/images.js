// Réduit les photos avant stockage (le téléphone garde de la place).
export async function compress(file, maxSide = 1600, quality = 0.82) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
  const w0 = bmp.width, h0 = bmp.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const w = Math.round(w0 * k), h = Math.round(h0 * k);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  return { blob, width: w, height: h };
}

const urls = new Map();
// Une URL par Blob, réutilisée pour éviter les fuites mémoire.
export function blobUrl(blob) {
  if (!blob) return '';
  if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob));
  return urls.get(blob);
}

import { t } from './i18n.js';

function openPicker(useCamera) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    if (useCamera) input.capture = 'environment';
    input.onchange = () => resolve(input.files?.[0] || null);
    // Si l'utilisateur ferme le sélecteur sans rien choisir.
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

// Demande d'où vient la photo : appareil photo ou galerie, puis renvoie le fichier.
export function pickPhoto() {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.style.zIndex = '40';
    wrap.innerHTML = `
      <div class="sheet-bg"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ptitle">
        <div class="handle"></div>
        <h2 id="ptitle" class="display xs"></h2>
        <button class="btn primary big" data-src="camera">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>
          <span></span>
        </button>
        <button class="btn glass big" data-src="gallery">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>
          <span></span>
        </button>
        <button class="btn big link-btn" data-src="cancel"><span></span></button>
      </div>`;
    wrap.querySelector('#ptitle').textContent = t('photo_source_title');
    wrap.querySelector('[data-src="camera"] span').textContent = t('photo_camera');
    wrap.querySelector('[data-src="gallery"] span').textContent = t('photo_gallery');
    wrap.querySelector('[data-src="cancel"] span').textContent = t('photo_cancel');
    document.body.appendChild(wrap);
    const done = v => { wrap.remove(); resolve(v); };
    wrap.querySelector('.sheet-bg').onclick = () => done(null);
    wrap.querySelector('[data-src="cancel"]').onclick = () => done(null);
    wrap.querySelector('[data-src="camera"]').onclick = () => { wrap.remove(); openPicker(true).then(resolve); };
    wrap.querySelector('[data-src="gallery"]').onclick = () => { wrap.remove(); openPicker(false).then(resolve); };
  });
}
