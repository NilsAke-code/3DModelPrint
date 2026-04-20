/**
 * seedModelConfig.ts
 *
 * Maps every seed model title (must match SeedData.cs exactly) to its
 * asset location and per-asset transform overrides.
 *
 * Assets live in /public/seed-assets/{folder}/
 * and are served as static files by Vite.
 *
 * GLB assets contain baked PBR materials and textures — do NOT add
 * materialOverride for GLB entries unless explicitly needed.
 *
 * Transform overrides:
 *   skipZUpFix       — skip the default -90° X rotation (most GLBs are Y-up)
 *   exportRotation   — extra rotation applied to the PATH B export mesh
 *   viewRotation     — rotation wrapper applied on top of orientation for colored renders
 *   materialOverride — PBR material override (OBJ-only, not needed for GLB)
 *   meshFilter       — override triangle/volume thresholds for the junk filter
 *   validationOverrides — per-model pixel/geometry check thresholds
 *
 * If a model title is not in this map, SeedModelBuilder will log a warning
 * and call seed-cleanup (delete the incomplete DB record).
 */

import type { AssetTransform } from './modelPipeline';
import type { ValidationOverrides } from './geometryValidator';

export interface SeedModelSpec {
  /** Folder name inside /public/seed-assets/. */
  folder: string;
  /** OBJ filename (provide objFile OR glbFile, not both). */
  objFile?: string;
  /** GLB filename — loaded via GLTFLoader, materials preserved as-is. */
  glbFile?: string;
  /** Optional MTL filename (OBJ only). */
  mtlFile?: string;
  /** Per-asset transform overrides for normalization and view correction. */
  transform?: AssetTransform;
  /** Per-asset validation threshold overrides. */
  validationOverrides?: ValidationOverrides;
}

const seedModelConfig: Record<string, SeedModelSpec> = {

  'Damaged Helmet': {
    folder: 'damaged-helmet',
    glbFile: 'DamagedHelmet.glb',
    transform: {
      skipZUpFix: true,
      viewRotation: { x: 0, y: Math.PI * 0.15, z: 0 },
    },
  },

  'Toy Car': {
    folder: 'toy-car',
    glbFile: 'ToyCar.glb',
    transform: {
      skipZUpFix: true,
      viewRotation: { x: 0, y: Math.PI * -0.15, z: 0 },
    },
  },

  'Designer Chair': {
    folder: 'sheen-chair',
    glbFile: 'SheenChair.glb',
    transform: {
      skipZUpFix: true,
      viewRotation: { x: 0, y: Math.PI * 0.1, z: 0 },
    },
  },

  'Medieval Lantern': {
    folder: 'lantern',
    glbFile: 'Lantern.glb',
    transform: {
      skipZUpFix: true,
      viewRotation: { x: 0, y: Math.PI * 0.2, z: 0 },
    },
    validationOverrides: {
      minSilhouetteAspect: 0.2,
      maxSilhouetteAspect: 4.0, // lantern is tall and narrow
    },
  },

  'Glass Vase with Flowers': {
    folder: 'glass-vase-flowers',
    glbFile: 'GlassVaseFlowers.glb',
    transform: {
      skipZUpFix: true,
      viewRotation: { x: 0, y: Math.PI * 0.1, z: 0 },
    },
    validationOverrides: {
      minSilhouetteAspect: 0.2,
      maxSilhouetteAspect: 4.0,
    },
  },

};

export default seedModelConfig;
