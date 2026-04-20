/**
 * modelLoaders.ts
 *
 * Pure loader helpers — no rendering, no pipeline logic.
 * Imported by both generateThumbnail.ts and modelPipeline.ts to avoid circular deps.
 */

import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Load an STL from a URL and return a BufferGeometry with vertex normals computed. */
export async function loadStlGeometry(stlUrl: string): Promise<THREE.BufferGeometry> {
  const geo = await new Promise<THREE.BufferGeometry>((res, rej) =>
    new STLLoader().load(stlUrl, res, undefined, rej),
  );
  geo.computeVertexNormals();
  return geo;
}

/** Load a GLB from an absolute URL. Returns gltf.scene as a THREE.Group. */
export async function loadGlbGroup(glbUrl: string): Promise<THREE.Group> {
  return new Promise<THREE.Group>((res, rej) =>
    new GLTFLoader().load(glbUrl, (gltf) => res(gltf.scene), undefined, rej),
  );
}

// MTL directives that may reference texture filenames (case-insensitive).
// This list is intentionally broad — real-world MTL files are inconsistently capitalised.
const MTL_MAP_DIRECTIVES = [
  'map_kd', 'map_ks', 'map_ka', 'map_bump', 'bump',
  'map_d', 'map_ns', 'disp', 'decal', 'map_refl', 'norm',
  'map_ke',  // emissive (extended)
];

/**
 * Parse an MTL File and return every unique texture basename it references.
 * Tolerant of poor formatting: blank lines, comments, extra whitespace, and
 * option flags like `-bm 1.0` before the filename are all handled gracefully.
 */
export async function parseMtlTextures(mtlFile: File): Promise<string[]> {
  let text: string;
  try {
    text = await mtlFile.text();
  } catch {
    return [];
  }
  const names = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;           // skip blanks and comments
    const lower = line.toLowerCase();
    for (const directive of MTL_MAP_DIRECTIVES) {
      if (lower.startsWith(directive + ' ') || lower.startsWith(directive + '\t')) {
        const parts = line.split(/\s+/);
        // Skip option tokens like -bm, -o, -s, -t, -texres, -clamp, -type, -imfchan
        // The filename is the last non-option token.
        let filename = '';
        for (let i = parts.length - 1; i >= 1; i--) {
          if (!parts[i].startsWith('-') && isNaN(Number(parts[i]))) {
            filename = parts[i];
            break;
          }
        }
        if (filename) {
          // Strip any directory prefix the MTL author may have embedded
          const basename = filename.split('/').pop()!.split('\\').pop()!;
          if (basename) names.add(basename);
        }
        break;
      }
    }
  }
  return Array.from(names);
}

/**
 * Convert all non-PBR materials in a loaded OBJ Group to MeshStandardMaterial,
 * transferring every relevant texture map so colors and details are preserved.
 * Meshes with broken/missing textures receive a clean neutral fallback rather than
 * being left with a dark or incorrect appearance.
 */
export function convertGroupMaterialsToPbr(
  group: THREE.Group,
  fallback: THREE.MeshStandardMaterial,
): void {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;

    const convert = (mat: THREE.Material): THREE.Material => {
      if (!mat) return fallback;
      if (mat.type === 'MeshStandardMaterial') return mat;

      // Access common properties shared by MeshPhongMaterial / MeshLambertMaterial
      const src = mat as THREE.MeshPhongMaterial & {
        emissiveMap?: THREE.Texture | null;
        specularMap?: THREE.Texture | null;
        bumpMap?: THREE.Texture | null;
        bumpScale?: number;
        displacementMap?: THREE.Texture | null;
        displacementScale?: number;
        aoMap?: THREE.Texture | null;
        aoMapIntensity?: number;
      };

      // Texture is only usable if the image decoded successfully (width > 0).
      // A 404'd texture still produces an HTMLImageElement but with width=0.
      const mapOk    = (t?: THREE.Texture | null): THREE.Texture | null =>
        (t && (t as any).image && (t as any).image.width > 0) ? t : null;

      const diffuseMap  = mapOk(src.map);
      const normalMap   = mapOk(src.normalMap);
      const alphaMap    = mapOk(src.alphaMap);
      const emissiveMap = mapOk(src.emissiveMap);
      const aoMap       = mapOk(src.aoMap);
      const bumpMap     = mapOk(src.bumpMap);
      const displacementMap = mapOk(src.displacementMap);

      // If no textures loaded and the base color is near-black, use the neutral fallback.
      // Threshold covers pure black AND very dark MTL colors that would render invisibly.
      const hasAnyTexture = diffuseMap || normalMap || alphaMap || emissiveMap || aoMap || bumpMap || displacementMap;
      const c = src.color;
      const colorIsDark = !c || (c.r < 0.04 && c.g < 0.04 && c.b < 0.04);
      if (!hasAnyTexture && colorIsDark) return fallback;

      return new THREE.MeshStandardMaterial({
        map:              diffuseMap,
        normalMap:        normalMap,
        alphaMap:         alphaMap,
        emissiveMap:      emissiveMap,
        aoMap:            aoMap,
        bumpMap:          bumpMap,
        bumpScale:        src.bumpScale ?? 1,
        displacementMap:  displacementMap,
        displacementScale: src.displacementScale ?? 1,
        color:            diffuseMap ? new THREE.Color(1, 1, 1) : (src.color?.clone() ?? new THREE.Color(0xaaaaaa)),
        emissive:         src.emissive?.clone() ?? new THREE.Color(0x000000),
        metalness:        0.05,
        roughness:        0.75,
        transparent:      src.transparent ?? false,
        opacity:          src.opacity ?? 1,
        side:             src.side ?? THREE.FrontSide,
      });
    };

    mesh.material = Array.isArray(mesh.material)
      ? (mesh.material as THREE.Material[]).map(convert)
      : convert(mesh.material as THREE.Material);
  });
}

/**
 * Load an OBJ + optional MTL from absolute URLs.
 * @param textureFiles  Optional companion texture File objects — mapped by filename
 *   so MTL `map_Kd` references resolve correctly. If MTL/textures fail to load,
 *   the OBJ is loaded with no material (clean fallback applied below).
 *
 * All MTL-assigned materials are converted to MeshStandardMaterial (PBR) before
 * returning so that the group renders correctly under ACESFilmic tone mapping.
 */
export async function loadObjGroup(
  objUrl: string,
  mtlUrl?: string,
  textureFiles?: File[],
): Promise<THREE.Group> {
  const fallbackMat = new THREE.MeshStandardMaterial({
    color: '#909090', metalness: 0.05, roughness: 0.75,
  });

  // Build a LoadingManager that remaps texture basenames → object URLs
  const textureObjectUrls: string[] = [];
  const manager = new THREE.LoadingManager();

  if (textureFiles && textureFiles.length > 0) {
    const nameToUrl = new Map<string, string>();
    for (const file of textureFiles) {
      const url = URL.createObjectURL(file);
      textureObjectUrls.push(url);
      nameToUrl.set(file.name.toLowerCase(), url);
    }
    manager.setURLModifier((url) => {
      const basename = url.split('/').pop()?.split('\\').pop()?.toLowerCase() ?? '';
      return nameToUrl.get(basename) ?? url;
    });
  }

  let materials: ReturnType<MTLLoader['parse']> | undefined;

  if (mtlUrl) {
    try {
      const mtlLoader = new MTLLoader(manager);
      materials = await new Promise<ReturnType<MTLLoader['parse']>>((res, rej) =>
        mtlLoader.load(mtlUrl, res, undefined, rej),
      );
      materials.preload();
    } catch (err) {
      console.warn('[loadObjGroup] MTL load failed, continuing without materials:', err);
      materials = undefined;
    }
  }

  const objLoader = new OBJLoader(manager);
  if (materials) objLoader.setMaterials(materials);

  const group = await new Promise<THREE.Group>((res, rej) =>
    objLoader.load(objUrl, res, undefined, rej),
  );
  // Convert all MTL-assigned (MeshPhongMaterial etc.) to PBR so tone mapping works correctly.
  // Meshes with no material or fully broken materials receive the clean fallback.
  convertGroupMaterialsToPbr(group, fallbackMat);

  // Delay revocation: materials.preload() schedules async GPU uploads.
  // Revoking blob URLs before the GPU has finished reading the image data
  // causes textures to appear black. 1 s is ample for the GPU to commit.
  setTimeout(() => textureObjectUrls.forEach((u) => URL.revokeObjectURL(u)), 1000);

  return group;
}
