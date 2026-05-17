/**
 * Runtime VRAM guard: downscale oversized image-based maps on loaded FBX graphs.
 * Does not replace authoring smaller textures (still best), but prevents 4K×N maps
 * embedded in FBX from exploding browser GPU memory.
 */

import * as THREE from 'three';

/** Material keys that commonly reference image textures on FBX / Mixamo imports. */
const MAP_KEYS = [
  'map',
  'lightMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'roughnessMap',
  'metalnessMap',
  'alphaMap',
  'specularMap',
  'gradientMap',
  'clearcoatNormalMap'
];

function drawableImage(tex) {
  const img = tex?.image;
  if (!img) return null;
  if (typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement) return null;
  const w = img.naturalWidth ?? img.width ?? img.videoWidth;
  const h = img.naturalHeight ?? img.height ?? img.videoHeight;
  if (!w || !h) return null;
  return { img, w, h };
}

function cloneTextureToMax(tex, maxSize) {
  const d = drawableImage(tex);
  if (!d) return tex;
  const { img, w, h } = d;
  const maxDim = Math.max(w, h);
  if (maxDim <= maxSize) return tex;

  const scale = maxSize / maxDim;
  const nw = Math.max(1, Math.floor(w * scale));
  const nh = Math.max(1, Math.floor(h * scale));

  const canvas = document.createElement('canvas');
  canvas.width = nw;
  canvas.height = nh;
  const ctx = canvas.getContext('2d');
  if (!ctx) return tex;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'medium';
  try {
    ctx.drawImage(img, 0, 0, nw, nh);
  } catch (e) {
    return tex;
  }

  const nt = new THREE.CanvasTexture(canvas);
  nt.wrapS = tex.wrapS;
  nt.wrapT = tex.wrapT;
  nt.repeat.copy(tex.repeat);
  nt.offset.copy(tex.offset);
  nt.rotation = tex.rotation;
  if (tex.center) nt.center.copy(tex.center);
  if ('colorSpace' in tex && 'colorSpace' in nt) {
    nt.colorSpace = tex.colorSpace;
  }
  nt.flipY = tex.flipY;
  nt.generateMipmaps = true;
  nt.minFilter = THREE.LinearMipmapLinearFilter;
  nt.magFilter = THREE.LinearFilter;
  nt.anisotropy = Math.min(tex.anisotropy ?? 1, 8);
  if (tex.name) nt.name = `${tex.name}_tb`;
  return nt;
}

/**
 * Walks skinned/static meshes under `root` and replaces oversized Texture maps.
 * @param {THREE.Object3D} root
 * @param {{ maxSize?: number }} options  Pass maxSize <= 0 to disable.
 * @returns {number} How many textures were replaced (not counting shared refs twice).
 */
export function applyFbxTextureBudget(root, options = {}) {
  const maxSize = options.maxSize ?? 1024;
  if (!root || maxSize <= 0) return 0;

  const oldToNew = new Map();

  function shouldSkipTexture(tex) {
    if (!tex?.isTexture) return true;
    if (tex.isCompressedTexture || tex.isDataTexture || tex.isDepthTexture) return true;
    if (tex.isVideoTexture) return true;
    return false;
  }

  function ensure(tex) {
    if (shouldSkipTexture(tex)) return tex;
    if (oldToNew.has(tex)) return oldToNew.get(tex);
    const nt = cloneTextureToMax(tex, maxSize);
    if (nt !== tex) {
      oldToNew.set(tex, nt);
      return nt;
    }
    return tex;
  }

  function visitMaterial(mat) {
    if (!mat) return;
    for (const key of MAP_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(mat, key)) continue;
      const t = mat[key];
      if (t && t.isTexture) mat[key] = ensure(t);
    }
  }

  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const mat of mats) visitMaterial(mat);
  });

  for (const oldTex of oldToNew.keys()) {
    try {
      oldTex.dispose();
    } catch (e) {}
  }

  return oldToNew.size;
}
