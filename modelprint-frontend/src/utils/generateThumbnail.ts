/**
 * Thumbnail / preview rendering utilities.
 *
 * Exports low-level render primitives used by modelPipeline.ts and the
 * convenience wrappers used by the Upload page.
 *
 * Two scene modes:
 *   buildOutputScene()     – light-blue Tinkercad floor + high-quality shadows
 *   buildValidationScene() – NO floor (clean white bg for unambiguous silhouette detection)
 *
 * Five render passes per model:
 *   1–4  colored   (Cover, Front, Side, Elevated) — with output scene
 *   5    STL-style (Cover angle, gray material)   — with output scene
 *   val  validation (Cover angle, gray material)  — with validation scene, NOT saved
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadStlGeometry, loadObjGroup, loadGlbGroup } from './modelLoaders';

export interface GalleryMetadata {
  triangleCount: number;
  boundingBox: { x: number; y: number; z: number };
  hasTextures: boolean;
}

export interface GalleryResult {
  blobs: Blob[];
  metadata: GalleryMetadata;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WIDTH = 1024;
const HEIGHT = 1024;
const PIXEL_RATIO = 2;

/** Default colored material used when the source has no material data (STL uploads). */
const DEFAULT_COLOR = '#e8e4dc';

/** Gray material for STL-style and validation renders. */
const STL_PREVIEW_COLOR = '#606068';

// ─── Angle configs ────────────────────────────────────────────────────────────

interface AngleConfig {
  name: string;
  getPosition: (d: number, h: number) => [number, number, number];
  getLookAt:   (h: number) => [number, number, number];
}

export const COLORED_ANGLES: AngleConfig[] = [
  { name: 'Cover',
    getPosition: (d)    => [d * 0.7, d * 0.5, d * 0.7],
    getLookAt:   (h)    => [0, h * 0.45, 0] },
  { name: 'Front',
    getPosition: (d, h) => [0, h * 0.5, d * 1.1],
    getLookAt:   (h)    => [0, h * 0.4, 0] },
  { name: 'Side',
    getPosition: (d, h) => [d * 1.1, h * 0.4, 0],
    getLookAt:   (h)    => [0, h * 0.4, 0] },
  { name: 'Elevated',
    getPosition: (d)    => [d * 0.45, d * 0.9, d * 0.45],
    getLookAt:   (h)    => [0, h * 0.2, 0] },
];

const COVER_ANGLE = COLORED_ANGLES[0];

// ─── Scene builders ───────────────────────────────────────────────────────────

/**
 * Full output scene: near-white background, standard lighting rig,
 * large floor plane that receives shadows (used for colored passes only).
 */
function buildOutputScene(): { scene: THREE.Scene; dirLight: THREE.DirectionalLight } {
  const floorSize  = 400;
  const floorColor = '#f0f0ee';
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f5f5f5');

  const hemi = new THREE.HemisphereLight('#ffffff', '#e8e4e0', 0.7);
  const dir  = new THREE.DirectionalLight('#ffffff', 2.2);
  dir.position.set(5, 8, 5);
  dir.castShadow = true;
  dir.shadow.mapSize.set(4096, 4096);
  dir.shadow.bias   = -0.001;
  dir.shadow.radius = 3;
  const fill = new THREE.DirectionalLight('#fff8f0', 0.3);
  fill.position.set(-4, 2, -4);
  const rim  = new THREE.DirectionalLight('#e8f0ff', 0.8);
  rim.position.set(-3, 6, -6);
  const amb  = new THREE.AmbientLight('#ffffff', 0.3);

  const floorMat = new THREE.MeshStandardMaterial({ color: floorColor, roughness: 1.0, metalness: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(floorSize, floorSize), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;

  scene.add(hemi, dir, fill, rim, amb, floor);
  return { scene, dirLight: dir };
}

/**
 * Validation scene: NO floor, slightly reduced hemi intensity.
 * Clean white + gray model = unambiguous silhouette for pixel analysis.
 */
function buildValidationScene(): { scene: THREE.Scene; dirLight: THREE.DirectionalLight } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f5f5f5');

  const hemi = new THREE.HemisphereLight('#ffffff', '#cccccc', 0.6);
  const dir  = new THREE.DirectionalLight('#ffffff', 1.5);
  dir.position.set(5, 8, 5);
  dir.castShadow = true;
  dir.shadow.mapSize.set(2048, 2048);
  dir.shadow.bias   = -0.001;
  dir.shadow.radius = 3;
  const amb  = new THREE.AmbientLight('#ffffff', 0.4);

  scene.add(hemi, dir, amb);
  return { scene, dirLight: dir };
}

// ─── Shadow + camera helpers ──────────────────────────────────────────────────

function fitShadowCamera(dir: THREE.DirectionalLight, bounds: THREE.Box3): void {
  const size = bounds.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const pad = maxDim * 1.1;
  dir.shadow.camera.near   = 0.5;
  dir.shadow.camera.far    = maxDim * 7;
  dir.shadow.camera.left   = -pad;
  dir.shadow.camera.right  =  pad;
  dir.shadow.camera.top    =  pad;
  dir.shadow.camera.bottom = -pad;
  dir.shadow.camera.updateProjectionMatrix();
}

function positionCamera(
  camera: THREE.PerspectiveCamera,
  bounds: THREE.Box3,
  angle: AngleConfig,
): void {
  const size   = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const d = maxDim * 2.4;
  const h = size.y;

  const [px, py, pz] = angle.getPosition(d, h);
  const [lx, ly, lz] = angle.getLookAt(h);

  camera.position.set(px + center.x, py, pz + center.z);
  camera.lookAt(lx + center.x, ly, lz + center.z);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
}

// ─── Capture ──────────────────────────────────────────────────────────────────

function captureFrame(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): Promise<Blob> {
  renderer.render(scene, camera);
  return new Promise<Blob>((resolve, reject) =>
    renderer.domElement.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
      'image/webp',
      0.95,
    ),
  );
}

function makeRenderer(): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(WIDTH, HEIGHT);
  r.setPixelRatio(PIXEL_RATIO);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.2;
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

// ─── Low-level render primitives (used by modelPipeline.ts) ──────────────────

/**
 * Render 4 colored passes from a THREE.Group (OBJ with materials) or
 * a plain BufferGeometry (STL / normalized export mesh).
 * Returns 4 WebP Blobs in angle order: Cover, Front, Side, Elevated.
 *
 * The source object is never disposed — ownership stays with the caller.
 */
export async function renderColoredPasses(
  source: THREE.Group | THREE.BufferGeometry,
  renderer: THREE.WebGLRenderer,
): Promise<Blob[]> {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  const { scene, dirLight } = buildOutputScene();

  // Build the subject — temporary material only for BufferGeometry sources
  let subject: THREE.Object3D;
  let tempMat: THREE.Material | null = null;

  if (source instanceof THREE.BufferGeometry) {
    tempMat = new THREE.MeshStandardMaterial({ color: DEFAULT_COLOR, metalness: 0.1, roughness: 0.65 });
    const mesh = new THREE.Mesh(source, tempMat);
    mesh.castShadow = true;
    subject = mesh;
  } else {
    source.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    subject = source;   // add Group directly — Three.js will update its parent reference
  }

  scene.add(subject);

  const bounds = new THREE.Box3().setFromObject(subject);
  fitShadowCamera(dirLight, bounds);

  const blobs: Blob[] = [];
  for (const angle of COLORED_ANGLES) {
    positionCamera(camera, bounds, angle);
    blobs.push(await captureFrame(renderer, scene, camera));
  }

  // Return ownership of the source to caller — remove from scene without disposing
  scene.remove(subject);
  tempMat?.dispose();

  return blobs;
}

/**
 * Render a single STL-style pass (gray material, bounded light-blue print bed)
 * from a normalized BufferGeometry. Uses the Cover angle.
 * Returns one WebP Blob — this is the 5th saved gallery image.
 *
 * The bed is sized dynamically to ~1.3× the model's XZ footprint so it reads
 * as a distinct platform rather than filling the entire frame. The background
 * outside the bed is near-white.
 */
export async function renderStlStylePass(
  geo: THREE.BufferGeometry,
  renderer: THREE.WebGLRenderer,
): Promise<Blob> {
  // Measure the model's XZ footprint to size the bed proportionally.
  const geoBox = new THREE.Box3().setFromBufferAttribute(
    geo.attributes.position as THREE.BufferAttribute,
  );
  const geoSize = geoBox.getSize(new THREE.Vector3());

  const BED_SCALE = 1.3;                                  // bed is 130% of model footprint
  const bedW = Math.max(geoSize.x * BED_SCALE, 2);
  const bedD = Math.max(geoSize.z * BED_SCALE, 2);

  // ── Scene: white background + bounded light-blue bed ─────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f8f8f8');

  // Same quality lighting rig as buildOutputScene
  const hemi = new THREE.HemisphereLight('#ffffff', '#e8e4e0', 0.7);
  const dir  = new THREE.DirectionalLight('#ffffff', 2.2);
  dir.position.set(5, 8, 5);
  dir.castShadow = true;
  dir.shadow.mapSize.set(4096, 4096);
  dir.shadow.bias   = -0.0008;
  dir.shadow.radius = 5;                                  // softer shadow edge
  const fill = new THREE.DirectionalLight('#fff8f0', 0.3);
  fill.position.set(-4, 2, -4);
  const rim  = new THREE.DirectionalLight('#e8f0ff', 0.8);
  rim.position.set(-3, 6, -6);
  const amb  = new THREE.AmbientLight('#ffffff', 0.3);
  scene.add(hemi, dir, fill, rim, amb);

  // Light-blue print-bed plane — only this surface receives the model shadow.
  // Width and depth match the model footprint × BED_SCALE; y=0 so the model
  // (already seated at y=0 by extractMergedGeometry) sits flush on it.
  const bedMat = new THREE.MeshStandardMaterial({ color: '#cce0f0', roughness: 1.0, metalness: 0 });
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(bedW, bedD), bedMat);
  bed.rotation.x = -Math.PI / 2;
  bed.position.set(0, 0, 0);
  bed.receiveShadow = true;
  scene.add(bed);

  // Fine grid overlay — helps the viewer read the bed as a print surface.
  // Divisions scale with bed size so cell size stays visually consistent (~0.5 unit).
  const gridDivs = Math.max(4, Math.round(Math.max(bedW, bedD) / 0.5));
  const grid = new THREE.GridHelper(Math.max(bedW, bedD), gridDivs, '#99bbcc', '#99bbcc');
  (grid.material as THREE.LineBasicMaterial).transparent = true;
  (grid.material as THREE.LineBasicMaterial).opacity = 0.45;
  grid.position.set(0, 0.001, 0); // 1 mm above bed to avoid z-fighting
  scene.add(grid);

  // Gray model mesh
  const mat  = new THREE.MeshStandardMaterial({ color: STL_PREVIEW_COLOR, metalness: 0, roughness: 0.75 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  scene.add(mesh);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  const bounds = new THREE.Box3().setFromObject(mesh);
  fitShadowCamera(dir, bounds);
  positionCamera(camera, bounds, COVER_ANGLE);

  const blob = await captureFrame(renderer, scene, camera);
  mat.dispose();
  bedMat.dispose();
  return blob;
}

/**
 * Render a validation pass (gray material, NO floor, clean white bg).
 * Result is NOT saved — used only for pixel-level silhouette analysis.
 * Returns one WebP Blob.
 */
export async function renderValidationPass(
  geo: THREE.BufferGeometry,
  renderer: THREE.WebGLRenderer,
): Promise<Blob> {
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  const { scene, dirLight } = buildValidationScene();
  const mat  = new THREE.MeshStandardMaterial({ color: STL_PREVIEW_COLOR, metalness: 0, roughness: 0.88 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  scene.add(mesh);

  const bounds = new THREE.Box3().setFromObject(mesh);
  fitShadowCamera(dirLight, bounds);
  positionCamera(camera, bounds, COVER_ANGLE);

  const blob = await captureFrame(renderer, scene, camera);
  mat.dispose();
  return blob;
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

/**
 * Extract a merged BufferGeometry from any source for the STL-style pass.
 * - BufferGeometry: returned as-is (already normalized by the STL path).
 * - THREE.Group: all isMesh children are cloned with world transforms baked in,
 *   then merged via mergeGeometries. The result is centered XZ and seated at y=0.
 *   The returned geometry is a CLONE — caller must dispose it after use.
 */
function extractMergedGeometry(
  source: THREE.BufferGeometry | THREE.Object3D,
): THREE.BufferGeometry {
  if (source instanceof THREE.BufferGeometry) {
    return source; // caller owns this — do not clone
  }

  source.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];

  source.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.updateWorldMatrix(true, false);
    const clone = (mesh.geometry as THREE.BufferGeometry).clone();
    clone.applyMatrix4(mesh.matrixWorld);
    geos.push(clone);
  });

  if (geos.length === 0) throw new Error('No mesh geometry found in model');

  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  geos.forEach((g, i) => { if (i > 0 || geos.length > 1) g.dispose(); });

  if (!merged) throw new Error('mergeGeometries failed');

  merged.computeVertexNormals();
  merged.computeBoundingBox();
  const center = merged.boundingBox!.getCenter(new THREE.Vector3());
  merged.translate(-center.x, -center.y, -center.z);
  merged.computeBoundingBox();
  merged.translate(0, -merged.boundingBox!.min.y, 0);

  return merged;
}

// ─── Convenience functions (used by Upload page) ──────────────────────────────

/**
 * Generate 5 preview images from a 3D model File (STL, OBJ, GLB).
 * [0] Cover, [1] Front, [2] Side, [3] Elevated (all colored), [4] STL-style preview.
 * Returns WebP Blobs.
 *
 * @param companions  Optional OBJ companion files: { mtlFile, textureFiles }.
 *   If MTL/textures fail to load, the OBJ is rendered with the default material.
 */
export async function generateModelGallery(
  modelFile: File,
  companions?: { mtlFile?: File; textureFiles?: File[] },
): Promise<GalleryResult> {
  const renderer = makeRenderer();
  const ext = modelFile.name.split('.').pop()?.toLowerCase() ?? '';
  const objectUrl = URL.createObjectURL(modelFile);

  let source: THREE.BufferGeometry | THREE.Group;

  try {
    if (ext === 'stl') {
      const geo = await loadStlGeometry(objectUrl);
      geo.computeBoundingBox();
      const box = geo.boundingBox!;
      const center = box.getCenter(new THREE.Vector3());
      geo.translate(-center.x, -center.y, -center.z);
      geo.computeBoundingBox();
      geo.translate(0, -geo.boundingBox!.min.y, 0);
      source = geo;
    } else if (ext === 'obj') {
      let mtlUrl: string | undefined;
      const mtlObjectUrls: string[] = [];
      if (companions?.mtlFile) {
        mtlUrl = URL.createObjectURL(companions.mtlFile);
        mtlObjectUrls.push(mtlUrl);
      }
      try {
        source = await loadObjGroup(objectUrl, mtlUrl, companions?.textureFiles);
      } finally {
        mtlObjectUrls.forEach((u) => URL.revokeObjectURL(u));
      }
    } else if (ext === 'glb' || ext === 'gltf') {
      source = await loadGlbGroup(objectUrl);
    } else {
      throw new Error(`Unsupported file format: .${ext}`);
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  const coloredBlobs = await renderColoredPasses(source, renderer);

  const mergedGeo = extractMergedGeometry(source);
  const stlBlob = await renderStlStylePass(mergedGeo, renderer);

  // Compute metadata from the merged (export) geometry
  mergedGeo.computeBoundingBox();
  const bbSize = mergedGeo.boundingBox!.getSize(new THREE.Vector3());
  const triCount = (mergedGeo.attributes.position?.count ?? 0) / 3;
  let hasTextures = false;
  if (source instanceof THREE.Group) {
    source.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if ((m as THREE.MeshStandardMaterial).map) hasTextures = true;
      }
    });
  }

  // Only dispose if it's a clone (Group path)
  if (!(source instanceof THREE.BufferGeometry)) mergedGeo.dispose();

  renderer.dispose();
  if (source instanceof THREE.BufferGeometry) source.dispose();

  return {
    blobs: [...coloredBlobs, stlBlob],
    metadata: {
      triangleCount: Math.round(triCount),
      boundingBox: { x: +bbSize.x.toFixed(2), y: +bbSize.y.toFixed(2), z: +bbSize.z.toFixed(2) },
      hasTextures,
    },
  };
}

/**
 * Same as generateModelGallery but loads an STL from a URL.
 */
export async function generateModelGalleryFromUrl(stlUrl: string): Promise<GalleryResult> {
  const response = await fetch(stlUrl);
  if (!response.ok) throw new Error(`Failed to fetch STL: ${stlUrl}`);
  const buffer = await response.arrayBuffer();
  const file   = new File([buffer], 'model.stl', { type: 'application/octet-stream' });
  return generateModelGallery(file);
}
