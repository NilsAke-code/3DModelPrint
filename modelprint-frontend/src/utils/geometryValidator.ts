/**
 * geometryValidator.ts
 *
 * Rule-based validation for 3D model assets before they are published.
 * Runs two layers of checks:
 *
 *   Layer 1 — Geometry checks  (on BufferGeometry, fast, no rendering)
 *   Layer 2 — Pixel checks     (on the validation render Blob from buildValidationScene)
 *
 * The validation render has NO floor plane so the light-blue floor does not
 * interfere with silhouette detection. The background is near-white (#f5f5f5)
 * and the model is gray (#b8b8b8), giving reliable R-channel separation.
 *
 * Default thresholds are conservative starting points. If a model is falsely
 * rejected, adjust via ValidationOverrides in seedModelConfig.
 */

import * as THREE from 'three';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationOverrides {
  minCoverage?: number;
  maxCoverage?: number;
  minSilhouetteAspect?: number;
  maxSilhouetteAspect?: number;
  maxBalanceOffset?: number;
}

export interface ValidationMetrics {
  /** Triangle count of the merged geometry. */
  triCount: number;
  /** Fraction of image pixels that belong to the model silhouette [0–1]. */
  coverage: number;
  /** height / width of the silhouette pixel bounding box. */
  silhouetteAspect: number;
  /** Horizontal centroid offset from image center as fraction of image width [-0.5 – 0.5]. */
  balanceX: number;
  /** Axis ratios of the geometry bounding box. */
  aspectXY: number;  // width / height
  aspectXZ: number;  // width / depth
}

export interface ValidationResult {
  passed: boolean;
  reason?: string;
  metrics: ValidationMetrics;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_MIN_COVERAGE        = 0.04;
const DEFAULT_MAX_COVERAGE        = 0.55;
const DEFAULT_MIN_SILHOUETTE_ASPECT = 0.20;
const DEFAULT_MAX_SILHOUETTE_ASPECT = 6.00;
const DEFAULT_MAX_BALANCE_OFFSET  = 0.20;

const MIN_TRI_COUNT    = 20;    // below this = degenerate mesh
const MIN_AXIS_RATIO   = 0.005; // any axis < 0.5% of longest = effectively flat

// Silhouette pixel threshold: R < this is "model" (bg R≈245, model R≈140–192, shadows darker)
const SILHOUETTE_R_THRESHOLD = 220;

const VALIDATION_IMAGE_SIZE = 600;

// ─── Layer 1: Geometry checks ─────────────────────────────────────────────────

function checkGeometry(geo: THREE.BufferGeometry): { passed: boolean; reason?: string } {
  const triCount = geo.index
    ? geo.index.count / 3
    : geo.attributes.position.count / 3;

  if (triCount < MIN_TRI_COUNT) {
    return { passed: false, reason: `Degenerate mesh: only ${triCount} triangles (minimum ${MIN_TRI_COUNT})` };
  }

  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  if (maxDim === 0) {
    return { passed: false, reason: 'Geometry has zero extent — all vertices at the same point' };
  }

  const minAxis = Math.min(size.x, size.y, size.z);
  if (minAxis / maxDim < MIN_AXIS_RATIO) {
    const axisName = size.x < size.y && size.x < size.z ? 'X' : size.y < size.z ? 'Y' : 'Z';
    return { passed: false, reason: `Geometry is effectively flat on the ${axisName} axis (ratio ${(minAxis / maxDim).toFixed(4)})` };
  }

  return { passed: true };
}

// ─── Layer 2: Pixel checks ────────────────────────────────────────────────────

async function analyseValidationRender(blob: Blob): Promise<{
  coverage: number;
  silhouetteAspect: number;
  balanceX: number;
}> {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(VALIDATION_IMAGE_SIZE, VALIDATION_IMAGE_SIZE);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0, VALIDATION_IMAGE_SIZE, VALIDATION_IMAGE_SIZE);
  bitmap.close();

  const { data } = ctx.getImageData(0, 0, VALIDATION_IMAGE_SIZE, VALIDATION_IMAGE_SIZE);
  const total = VALIDATION_IMAGE_SIZE * VALIDATION_IMAGE_SIZE;

  let modelPixels = 0;
  let minX = VALIDATION_IMAGE_SIZE, maxX = 0;
  let minY = VALIDATION_IMAGE_SIZE, maxY = 0;
  let sumX = 0, sumY = 0;

  for (let i = 0; i < total; i++) {
    const r = data[i * 4];
    if (r < SILHOUETTE_R_THRESHOLD) {
      modelPixels++;
      const px = i % VALIDATION_IMAGE_SIZE;
      const py = Math.floor(i / VALIDATION_IMAGE_SIZE);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      sumX += px;
      sumY += py;
    }
  }

  if (modelPixels === 0) {
    return { coverage: 0, silhouetteAspect: 0, balanceX: 0 };
  }

  const coverage = modelPixels / total;
  const bboxW = maxX - minX + 1;
  const bboxH = maxY - minY + 1;
  const silhouetteAspect = bboxW > 0 ? bboxH / bboxW : 0;
  const centroidX = sumX / modelPixels;
  const balanceX = (centroidX - VALIDATION_IMAGE_SIZE / 2) / VALIDATION_IMAGE_SIZE;

  return { coverage, silhouetteAspect, balanceX };
}

// ─── Geometry metrics helper ──────────────────────────────────────────────────

function geometryAspects(geo: THREE.BufferGeometry): { aspectXY: number; aspectXZ: number; triCount: number } {
  const triCount = geo.index
    ? geo.index.count / 3
    : geo.attributes.position.count / 3;

  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const aspectXY = size.y > 0 ? size.x / size.y : 0;
  const aspectXZ = size.z > 0 ? size.x / size.z : 0;

  return { aspectXY, aspectXZ, triCount };
}

// ─── Main validate function ───────────────────────────────────────────────────

/**
 * Validate a normalized export geometry + its validation render.
 *
 * @param geo          Normalized merged BufferGeometry (from PATH B)
 * @param validationBlob  Blob from renderValidationPass() (no floor, gray model)
 * @param overrides    Per-asset threshold overrides
 */
export async function validateAsset(
  geo: THREE.BufferGeometry,
  validationBlob: Blob,
  overrides: ValidationOverrides = {},
): Promise<ValidationResult> {
  // Layer 1
  const geoCheck = checkGeometry(geo);
  if (!geoCheck.passed) {
    const { aspectXY, aspectXZ, triCount } = geometryAspects(geo);
    return {
      passed: false,
      reason: geoCheck.reason,
      metrics: { triCount, coverage: 0, silhouetteAspect: 0, balanceX: 0, aspectXY, aspectXZ },
    };
  }

  // Layer 2
  const { coverage, silhouetteAspect, balanceX } = await analyseValidationRender(validationBlob);
  const { aspectXY, aspectXZ, triCount } = geometryAspects(geo);

  const metrics: ValidationMetrics = { triCount, coverage, silhouetteAspect, balanceX, aspectXY, aspectXZ };

  const minCov   = overrides.minCoverage          ?? DEFAULT_MIN_COVERAGE;
  const maxCov   = overrides.maxCoverage          ?? DEFAULT_MAX_COVERAGE;
  const minAsp   = overrides.minSilhouetteAspect  ?? DEFAULT_MIN_SILHOUETTE_ASPECT;
  const maxAsp   = overrides.maxSilhouetteAspect  ?? DEFAULT_MAX_SILHOUETTE_ASPECT;
  const maxBal   = overrides.maxBalanceOffset      ?? DEFAULT_MAX_BALANCE_OFFSET;

  if (coverage < minCov) {
    return { passed: false, reason: `Model too small in frame: coverage ${coverage.toFixed(3)} < ${minCov}`, metrics };
  }
  if (coverage > maxCov) {
    return { passed: false, reason: `Model overfills frame: coverage ${coverage.toFixed(3)} > ${maxCov}`, metrics };
  }
  if (silhouetteAspect < minAsp) {
    return { passed: false, reason: `Silhouette too flat: aspect ${silhouetteAspect.toFixed(3)} < ${minAsp}`, metrics };
  }
  if (silhouetteAspect > maxAsp) {
    return { passed: false, reason: `Silhouette too tall/narrow: aspect ${silhouetteAspect.toFixed(3)} > ${maxAsp}`, metrics };
  }
  if (Math.abs(balanceX) > maxBal) {
    return { passed: false, reason: `Model off-center: balanceX ${balanceX.toFixed(3)}, limit ±${maxBal}`, metrics };
  }

  return { passed: true, metrics };
}
