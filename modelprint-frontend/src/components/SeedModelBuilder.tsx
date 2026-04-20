/**
 * SeedModelBuilder.tsx
 *
 * Replaces ThumbnailAutoGen. Runs silently on mount and processes every seed
 * model that has FilePath === "" (created by Phase 1 C# seeder but not yet
 * completed by the browser).
 *
 * For each incomplete model:
 *   1. Look up the asset spec in seedModelConfig (by title)
 *   2. HEAD /seed-assets/{folder}/{objFile} — verify asset exists
 *   3. Load OBJ (+MTL if present)
 *   4. Extract + filter geometries for PATH B; normalise
 *   5. renderForValidation() → validateAsset() — check framing quality
 *   6. If validation fails → retry with +15° Y viewRotation adjustment
 *   7. If still fails → seed-cleanup (delete incomplete record)
 *   8. If passed → runPipelineFromGroup() → upload STL + 5 images
 *   9. onRefresh() so the gallery reloads with the new assets
 *
 * Processes one model at a time to avoid exhausting the GPU.
 */

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { Model3D } from '../types';
import seedModelConfig from '../utils/seedModelConfig';
import { loadObjGroup, loadGlbGroup, runPipelineFromGroup, renderForValidation } from '../utils/modelPipeline';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { validateAsset } from '../utils/geometryValidator';
import { uploadSeedFile, uploadSeedModelImages, seedCleanup, fetchPendingSeeds } from '../services/api';
import type { AssetTransform } from '../utils/modelPipeline';

interface Props {
  onRefresh: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractNormalizedForValidation(
  group: THREE.Group,
  transform: AssetTransform,
): THREE.BufferGeometry | null {
  const filter = {
    minTriCount: transform.meshFilter?.minTriCount ?? 12,
    volumeRatio: transform.meshFilter?.volumeRatio ?? 0.00005,
  };

  const totalBox = new THREE.Box3().setFromObject(group);
  const totalVolSq = totalBox.getSize(new THREE.Vector3()).lengthSq();
  const geos: THREE.BufferGeometry[] = [];

  group.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const geo = (obj.geometry as THREE.BufferGeometry).clone();
    obj.updateWorldMatrix(true, false);
    geo.applyMatrix4(obj.matrixWorld);
    const triCount = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
    if (triCount < filter.minTriCount) return;
    geo.computeBoundingBox();
    const volSq = geo.boundingBox!.getSize(new THREE.Vector3()).lengthSq();
    if (volSq / totalVolSq < filter.volumeRatio) return;
    geos.push(geo);
  });

  if (geos.length === 0) return null;
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (!merged) { geos.forEach((g) => g.dispose()); return null; }

  // Apply normalization
  if (!transform.skipZUpFix) {
    merged.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  }
  if (transform.exportRotation) {
    const { x, y, z } = transform.exportRotation;
    merged.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(x, y, z)));
  }
  merged.computeBoundingBox();
  const { min, max } = merged.boundingBox!;
  merged.translate(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
  merged.computeBoundingBox();
  const size = merged.boundingBox!.getSize(new THREE.Vector3());
  const scale = 50 / Math.max(size.x, size.y, size.z);
  merged.scale(scale, scale, scale);
  merged.computeVertexNormals();

  return merged;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SeedModelBuilder({ onRefresh }: Props) {
  const runningRef = useRef(false);

  useEffect(() => {
    if (runningRef.current) return;
    runningRef.current = true;

    (async () => {
      const pending = await fetchPendingSeeds().catch(() => [] as Model3D[]);
      if (pending.length === 0) { runningRef.current = false; return; }
      await processPending(pending);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function processPending(pending: Model3D[]) {
    let didBuild = false;

      for (const model of pending) {
        const spec = seedModelConfig[model.title];

        if (!spec) {
          console.warn(`SeedModelBuilder: no config for "${model.title}" — cleaning up record`);
          await seedCleanup(model.id).catch(() => {});
          continue;
        }

        const isGlb    = !!spec.glbFile;
        const assetUrl = isGlb
          ? `/seed-assets/${spec.folder}/${spec.glbFile}`
          : `/seed-assets/${spec.folder}/${spec.objFile}`;
        const mtlUrl   = spec.mtlFile ? `/seed-assets/${spec.folder}/${spec.mtlFile}` : undefined;

        // ── Step 1: verify asset exists ──
        try {
          const head = await fetch(assetUrl, { method: 'HEAD' });
          if (!head.ok) throw new Error(`HEAD ${head.status}`);
        } catch {
          console.warn(`SeedModelBuilder: asset not found for "${model.title}" (${assetUrl}) — cleaning up`);
          await seedCleanup(model.id).catch(() => {});
          continue;
        }

        // ── Step 2: load GLB or OBJ ──
        let group: THREE.Group;
        try {
          group = isGlb
            ? await loadGlbGroup(assetUrl)
            : await loadObjGroup(assetUrl, mtlUrl);
        } catch (err) {
          console.warn(`SeedModelBuilder: failed to load "${model.title}"`, err, '— cleaning up');
          await seedCleanup(model.id).catch(() => {});
          continue;
        }

        // ── Step 3: validate (try up to 2 times) ──
        const transform = spec.transform ?? {};
        let passedValidation = false;
        let finalTransform   = transform;

        for (let attempt = 0; attempt < 2; attempt++) {
          const normalizedForVal = extractNormalizedForValidation(group, finalTransform);

          if (!normalizedForVal) {
            console.warn(`SeedModelBuilder: "${model.title}" produced empty geometry after filtering`);
            break;
          }

          try {
            const validationBlob = await renderForValidation(normalizedForVal);
            const result = await validateAsset(
              normalizedForVal,
              validationBlob,
              spec.validationOverrides,
            );
            normalizedForVal.dispose();

            if (result.passed) {
              passedValidation = true;
              break;
            }

            if (attempt === 0) {
              // Retry with +15° Y view rotation adjustment
              console.info(
                `SeedModelBuilder: "${model.title}" failed validation (${result.reason}) — retrying with adjusted viewRotation`,
                result.metrics,
              );
              finalTransform = {
                ...finalTransform,
                viewRotation: {
                  x: finalTransform.viewRotation?.x ?? 0,
                  y: (finalTransform.viewRotation?.y ?? 0) + Math.PI * (15 / 180),
                  z: finalTransform.viewRotation?.z ?? 0,
                },
              };
            } else {
              console.warn(
                `SeedModelBuilder: "${model.title}" failed validation after retry (${result.reason}) — cleaning up`,
                result.metrics,
              );
            }
          } catch (err) {
            normalizedForVal.dispose();
            console.warn(`SeedModelBuilder: validation error for "${model.title}"`, err);
            break;
          }
        }

        if (!passedValidation) {
          await seedCleanup(model.id).catch(() => {});
          continue;
        }

        // ── Step 4: run full pipeline ──
        try {
          const output = await runPipelineFromGroup(group, finalTransform);
          const [cover, ...gallery] = output.renders;

          await uploadSeedFile(model.id, output.stlBlob);
          await uploadSeedModelImages(model.id, cover, gallery);

          console.info(`SeedModelBuilder: "${model.title}" completed ✓`);
          didBuild = true;
        } catch (err) {
          console.warn(`SeedModelBuilder: pipeline/upload failed for "${model.title}"`, err);
          await seedCleanup(model.id).catch(() => {});
        }
      }

      runningRef.current = false;
      if (didBuild) onRefresh();
  }

  return null;
}
