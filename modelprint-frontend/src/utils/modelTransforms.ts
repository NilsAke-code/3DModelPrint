import * as THREE from 'three';
import type React from 'react';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadStlGeometry, loadObjGroup, loadGlbGroup } from './modelLoaders';

/**
 * Load a model file (STL/OBJ/GLB), extract all mesh geometries, merge into a
 * single BufferGeometry, then normalize so the longest axis ≈ 50 units and the
 * model is centered on XZ and seated at Y = 0.
 *
 * This is the baseline state stored in originalGeoRef before any user transforms.
 */
export async function loadAndNormalizeGeometry(file: File): Promise<THREE.BufferGeometry> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const objectUrl = URL.createObjectURL(file);

  let geo: THREE.BufferGeometry;

  try {
    if (ext === 'stl') {
      geo = await loadStlGeometry(objectUrl);
    } else if (ext === 'obj') {
      const group = await loadObjGroup(objectUrl);
      geo = extractMergedGeometry(group);
    } else if (ext === 'glb' || ext === 'gltf') {
      const group = await loadGlbGroup(objectUrl);
      geo = extractMergedGeometry(group);
    } else {
      throw new Error(`Unsupported format: .${ext}`);
    }
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  // Normalize scale: longest axis ≈ 50 units
  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const s = 50 / maxDim;
    geo.scale(s, s, s);
  }

  // Center XZ and seat at Y = 0
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  const cx = (box.min.x + box.max.x) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  geo.translate(-cx, -box.min.y, -cz);

  geo.computeBoundingBox();
  geo.computeVertexNormals();
  return geo;
}

/** Extract and merge all mesh geometries from a Group with world transforms applied. */
function extractMergedGeometry(group: THREE.Group): THREE.BufferGeometry {
  group.updateMatrixWorld(true);
  const geos: THREE.BufferGeometry[] = [];

  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.updateWorldMatrix(true, false);
    const clone = (mesh.geometry as THREE.BufferGeometry).clone();
    clone.applyMatrix4(mesh.matrixWorld);
    geos.push(clone);
  });

  if (geos.length === 0) throw new Error('No mesh geometry found in model');

  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  if (geos.length > 1) geos.forEach((g) => g.dispose());
  if (!merged) throw new Error('mergeGeometries failed');

  merged.computeVertexNormals();
  return merged;
}

/** Translate geometry so its XZ bounding-box center is at the world origin. */
export function centerXZ(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const box = geo.boundingBox!;
  geo.translate(-(box.min.x + box.max.x) / 2, 0, -(box.min.z + box.max.z) / 2);
  geo.computeBoundingBox();
}

/** Translate geometry so its lowest Y vertex sits at Y = 0 (print bed). */
export function placeOnBed(geo: THREE.BufferGeometry): void {
  geo.computeBoundingBox();
  const minY = geo.boundingBox!.min.y;
  if (minY !== 0) geo.translate(0, -minY, 0);
  geo.computeBoundingBox();
}

/** Restore working geometry from the stored original clone. Recomputes normals. */
export function resetGeometry(
  geoRef: React.MutableRefObject<THREE.BufferGeometry | null>,
  originalGeoRef: React.MutableRefObject<THREE.BufferGeometry | null>,
): void {
  if (!geoRef.current || !originalGeoRef.current) return;
  geoRef.current.copy(originalGeoRef.current);
  geoRef.current.computeBoundingBox();
  geoRef.current.computeVertexNormals();
}

/** Export geometry as a binary STL Blob (uses the current mutated geometry). */
export function exportSTL(geo: THREE.BufferGeometry): Blob {
  geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const triCount = pos.count / 3;
  const buf = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buf);
  // 80-byte ASCII header (left blank) + uint32 triangle count
  view.setUint32(80, triCount, true);

  let offset = 84;
  const n = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const i3 = i * 3;
    a.fromBufferAttribute(pos, i3);
    b.fromBufferAttribute(pos, i3 + 1);
    c.fromBufferAttribute(pos, i3 + 2);
    // Compute face normal
    n.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();

    for (const v of [n, a, b, c]) {
      view.setFloat32(offset, v.x, true); offset += 4;
      view.setFloat32(offset, v.y, true); offset += 4;
      view.setFloat32(offset, v.z, true); offset += 4;
    }
    view.setUint16(offset, 0, true); // attribute byte count
    offset += 2;
  }

  return new Blob([buf], { type: 'model/stl' });
}
