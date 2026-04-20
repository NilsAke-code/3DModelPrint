/**
 * modelPipeline.ts
 *
 * Orchestrates the two-path preview pipeline for any 3D model source:
 *
 *   PATH A — Colored renders (3–4 images)
 *     Uses the original loaded Group directly; OBJ/MTL materials preserved.
 *     Camera framed via Box3.setFromObject — no geometry mutation.
 *
 *   PATH B — Export mesh (STL export + STL-style render)
 *     Clones and merges geometries from Group, applies normalization,
 *     exports binary STL, renders STL-style preview.
 *
 * The same normalized mesh is used for both the STL export and the
 * STL-style PNG — they are guaranteed to match.
 *
 * Usage:
 *   const output = await runPipeline(group, spec)
 *   output.stlBlob     → upload to /seed-file
 *   output.renders[0]  → cover (IsCover)
 *   output.renders[1–3] → gallery
 *   output.renders[4]  → STL-style preview (last gallery image)
 */

import * as THREE from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  renderColoredPasses,
  renderStlStylePass,
  renderValidationPass,
} from './generateThumbnail';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AssetTransform {
  /** Skip the default Z-up → Y-up -90° X rotation (set true for Y-up OBJ files). */
  skipZUpFix?: boolean;
  /** Additional export-mesh rotation (applied after Z-up fix). Euler in radians. */
  exportRotation?: { x: number; y: number; z: number };
  /**
   * Rotation applied to a view wrapper Object3D for PATH A colored renders only.
   * Does NOT affect the geometry or PATH B export mesh.
   */
  viewRotation?: { x: number; y: number; z: number };
  /**
   * Override per-axis mesh-filter thresholds (for assets where defaults are too aggressive).
   * minTriCount: default 12. volumeRatio: default 0.00005.
   */
  meshFilter?: { minTriCount?: number; volumeRatio?: number };
  /**
   * Apply a specific PBR MeshStandardMaterial to all meshes for PATH A colored renders.
   * Used when the source OBJ has no MTL/usemtl directives (all current seed models).
   * Does NOT affect PATH B geometry export or the STL-style render.
   */
  materialOverride?: { color: string; metalness: number; roughness: number };
}

export interface ModelMetadata {
  /** Total triangle count in the exported (normalized) mesh. */
  triangleCount: number;
  /** Axis-aligned bounding box dimensions of the normalized mesh, in scene units. */
  boundingBox: { x: number; y: number; z: number };
  /** True if the source OBJ had MTL-assigned textures that loaded successfully. */
  hasTextures: boolean;
}

export interface PipelineOutput {
  /** Binary STL Blob exported from the normalized merged geometry. */
  stlBlob: Blob;
  /**
   * 5 render Blobs:
   * [0] Cover   [1] Front   [2] Side   [3] Elevated   [4] STL-style preview
   */
  renders: Blob[];
  /** Basic mesh statistics computed from the normalized export geometry. */
  metadata: ModelMetadata;
}

// ─── Loader helpers (re-exported from modelLoaders.ts) ───────────────────────

export { loadStlGeometry, loadObjGroup, loadGlbGroup } from './modelLoaders';

// ─── Mesh filtering ───────────────────────────────────────────────────────────

/**
 * Extract and filter child mesh geometries from a Group before merging for PATH B.
 *
 * Filtering removes:
 *  - Non-mesh objects (Points, Lines, helpers)
 *  - Degenerate shards with fewer than minTriCount triangles
 *  - Tiny detached junk geometry smaller than volumeRatio × total model volume
 *
 * NOTE: minTriCount=12 and volumeRatio=0.00005 are starting defaults.
 * Tune per-asset via AssetTransform.meshFilter if legitimate small parts are filtered.
 */
function extractMeshGeometries(
  group: THREE.Group | THREE.Object3D,
  filter: Required<NonNullable<AssetTransform['meshFilter']>>,
): THREE.BufferGeometry[] {
  const totalBox = new THREE.Box3().setFromObject(group);
  const totalVolSq = totalBox.getSize(new THREE.Vector3()).lengthSq();

  const result: THREE.BufferGeometry[] = [];

  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;

    const geo = obj.geometry.clone() as THREE.BufferGeometry;
    obj.updateWorldMatrix(true, false);
    geo.applyMatrix4(obj.matrixWorld);  // bake world transform

    const triCount = geo.index
      ? geo.index.count / 3
      : geo.attributes.position.count / 3;
    if (triCount < filter.minTriCount) return;

    geo.computeBoundingBox();
    const geoVolSq = geo.boundingBox!.getSize(new THREE.Vector3()).lengthSq();
    if (geoVolSq / totalVolSq < filter.volumeRatio) return;

    result.push(geo);
  });

  return result;
}

// ─── PATH B normalization ─────────────────────────────────────────────────────

/**
 * Normalize a merged BufferGeometry for export:
 *   1. Z-up → Y-up rotation (unless skipZUpFix)
 *   2. Optional per-asset export rotation
 *   3. Center XZ, seat bottom at y=0
 *   4. Scale so longest axis = 50 units
 *   5. Recompute vertex normals
 */
function normalizeGeometry(
  geo: THREE.BufferGeometry,
  transform: AssetTransform,
): THREE.BufferGeometry {
  if (!transform.skipZUpFix) {
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  }
  if (transform.exportRotation) {
    const { x, y, z } = transform.exportRotation;
    geo.applyMatrix4(
      new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z)),
    );
  }

  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox!;
  geo.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);

  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const scale = 50 / Math.max(size.x, size.y, size.z);
  geo.scale(scale, scale, scale);

  geo.computeVertexNormals();
  return geo;
}

// ─── View wrapper for PATH A ──────────────────────────────────────────────────

/**
 * Wrap a group in a parent Object3D that applies the same orientation as
 * PATH B normalization (Z-up fix + exportRotation + y=0 seating) for PATH A
 * colored renders, without mutating geometry.
 */
function buildOrientationWrapper(group: THREE.Object3D, transform: AssetTransform): THREE.Object3D {
  const wrapper = new THREE.Object3D();
  let m = new THREE.Matrix4();
  if (!transform.skipZUpFix) {
    m.makeRotationX(-Math.PI / 2);
  }
  if (transform.exportRotation) {
    const { x, y, z } = transform.exportRotation;
    m.premultiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z)));
  }
  wrapper.setRotationFromMatrix(m);
  wrapper.add(group);
  wrapper.updateMatrixWorld(true);
  // Seat bottom at y=0 (mirrors normalizeGeometry's translate step)
  const bounds = new THREE.Box3().setFromObject(wrapper);
  wrapper.position.y = -bounds.min.y;
  return wrapper;
}

/**
 * Wrap an Object3D in a parent that applies viewRotation correction
 * for colored renders, without mutating the object's own transform.
 */
function applyViewWrapper(group: THREE.Object3D, transform: AssetTransform): THREE.Object3D {
  const wrapper = new THREE.Object3D();
  if (transform.viewRotation) {
    const { x, y, z } = transform.viewRotation;
    wrapper.rotation.set(x, y, z);
  }
  wrapper.add(group);
  return wrapper;
}

// ─── STL export ───────────────────────────────────────────────────────────────

function exportStl(geo: THREE.BufferGeometry): Blob {
  const exporter = new STLExporter();
  const mesh = new THREE.Mesh(geo);
  const binary = exporter.parse(mesh, { binary: true }) as unknown as Uint8Array;
  return new Blob([binary], { type: 'model/stl' });
}

// ─── Main pipeline entry point ────────────────────────────────────────────────

function makeRenderer(): THREE.WebGLRenderer {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(600, 600);
  r.setPixelRatio(2);
  r.shadowMap.enabled = true;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.2;
  r.outputColorSpace = THREE.SRGBColorSpace;
  return r;
}

/**
 * Run the full pipeline from a loaded THREE.Group.
 * Used for OBJ seed models and OBJ user uploads.
 *
 * @param group   Loaded OBJ group (materials already applied by OBJLoader)
 * @param transform  Per-asset transform overrides from seedModelConfig
 * @returns { stlBlob, renders[5] }
 */
export async function runPipelineFromGroup(
  group: THREE.Group,
  transform: AssetTransform = {},
): Promise<PipelineOutput> {
  const renderer = makeRenderer();

  // ── PATH A: colored renders ──
  // Apply per-asset material override for OBJ files without usemtl directives.
  // GLB assets already have baked PBR materials — only override when explicitly set.
  if (transform.materialOverride) {
    const { color, metalness, roughness } = transform.materialOverride;
    const overrideMat = new THREE.MeshStandardMaterial({ color, metalness, roughness });
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).material = overrideMat;
    });
  }

  // Wrap in orientation corrector (same transform sequence as PATH B normalizeGeometry)
  // so colored renders match the exported STL orientation.
  const orientedGroup = buildOrientationWrapper(group, transform);
  const viewSource = transform.viewRotation ? applyViewWrapper(orientedGroup, transform) : orientedGroup;
  const coloredBlobs = await renderColoredPasses(viewSource, renderer);
  // Detach group from wrappers so PATH B can traverse it cleanly
  if (transform.viewRotation) (viewSource as THREE.Object3D).remove(orientedGroup);
  orientedGroup.remove(group);

  // ── PATH B: build export mesh ──
  const filter: Required<NonNullable<AssetTransform['meshFilter']>> = {
    minTriCount: transform.meshFilter?.minTriCount ?? 12,
    volumeRatio: transform.meshFilter?.volumeRatio ?? 0.00005,
  };

  const geos = extractMeshGeometries(group, filter);
  if (geos.length === 0) {
    renderer.dispose();
    throw new Error('No usable mesh geometry found after filtering. Asset may be degenerate.');
  }

  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (!merged) {
    renderer.dispose();
    geos.forEach((g) => g.dispose());
    throw new Error('mergeGeometries failed — possibly incompatible attribute layouts.');
  }

  const normalized = normalizeGeometry(merged, transform);

  const stlBlob      = exportStl(normalized);
  const stlStyleBlob = await renderStlStylePass(normalized, renderer);

  // Compute metadata from the normalized export mesh
  normalized.computeBoundingBox();
  const normBox = normalized.boundingBox!.getSize(new THREE.Vector3());
  const triCount = (normalized.attributes.position?.count ?? 0) / 3;
  // Detect whether any mesh in the original group had a successfully-loaded texture
  let hasTextures = false;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if ((m as THREE.MeshStandardMaterial).map) { hasTextures = true; }
    }
  });

  renderer.dispose();
  normalized.dispose();

  return {
    stlBlob,
    renders: [...coloredBlobs, stlStyleBlob],
    metadata: {
      triangleCount: Math.round(triCount),
      boundingBox: { x: +normBox.x.toFixed(2), y: +normBox.y.toFixed(2), z: +normBox.z.toFixed(2) },
      hasTextures,
    },
  };
}

/**
 * Run the full pipeline from an STL BufferGeometry.
 * Used for STL user uploads — PATH A and PATH B share the same normalized geometry.
 */
export async function runPipelineFromStl(
  geo: THREE.BufferGeometry,
  transform: AssetTransform = {},
): Promise<PipelineOutput> {
  const renderer = makeRenderer();

  // Center and seat at y=0
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const center = box.getCenter(new THREE.Vector3());
  geo.translate(-center.x, -center.y, -center.z);
  geo.computeBoundingBox();
  geo.translate(0, -geo.boundingBox!.min.y, 0);

  // Normalize (skip Z-up fix unless explicitly requested for STL, since STL has no canonical orientation)
  const normalized = normalizeGeometry(geo, { skipZUpFix: true, ...transform });

  const coloredBlobs = await renderColoredPasses(normalized, renderer);
  const stlStyleBlob = await renderStlStylePass(normalized, renderer);
  const stlBlob      = exportStl(normalized);

  // Compute metadata from the normalized geometry
  normalized.computeBoundingBox();
  const normBox  = normalized.boundingBox!.getSize(new THREE.Vector3());
  const triCount = (normalized.attributes.position?.count ?? 0) / 3;

  renderer.dispose();
  // Note: caller owns `geo` — we mutated it in place (translate/scale/normalize)
  // The caller should dispose it after use

  return {
    stlBlob,
    renders: [...coloredBlobs, stlStyleBlob],
    metadata: {
      triangleCount: Math.round(triCount),
      boundingBox: { x: +normBox.x.toFixed(2), y: +normBox.y.toFixed(2), z: +normBox.z.toFixed(2) },
      hasTextures: false, // STL has no material data
    },
  };
}

/**
 * Render a validation pass on a normalized geometry.
 * Called by SeedModelBuilder BEFORE the full 5-pass render to check framing.
 * Returns the validation Blob (not saved — pixels analyzed by geometryValidator).
 */
export async function renderForValidation(
  geo: THREE.BufferGeometry,
): Promise<Blob> {
  const renderer = makeRenderer();
  const blob = await renderValidationPass(geo, renderer);
  renderer.dispose();
  return blob;
}
