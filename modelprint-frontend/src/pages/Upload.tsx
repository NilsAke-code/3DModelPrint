import React, { useState, useRef, useEffect, Suspense, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three";
import { createModel } from "../services/api";
import { loginRequest } from "../auth/authConfig";
import { generateModelGallery, type GalleryMetadata } from "../utils/generateThumbnail";
import { loadObjGroup, parseMtlTextures } from "../utils/modelLoaders";
import {
  Upload as UploadIcon, FileBox, LogIn, Loader2, X, RotateCcw,
  CheckCircle2, AlertCircle, Box, Info, ArrowLeft, Paperclip,
} from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "Education", "Art", "Gadgets", "Household",
  "Tools", "Toys & Games", "Mechanical", "Miniatures",
];

const ANGLE_LABELS = ["Cover", "Front", "Side", "Elevated", "STL Preview"];
const TOTAL_PASSES = 5;

// ─── Viewer error boundary ────────────────────────────────────────────────────

class ViewerErrorBoundary extends React.Component<
  { children: React.ReactNode; onError: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode; onError: () => void }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() { this.props.onError(); }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

// ─── Scene content components ─────────────────────────────────────────────────

const VIEWER_MAT_PROPS = { color: '#8aaabb', metalness: 0.1, roughness: 0.65 } as const;

function STLSceneContent({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  const { camera } = useThree();

  const geo = useMemo(() => {
    const g = geometry.clone();
    g.computeVertexNormals();
    g.computeBoundingBox();
    const c = g.boundingBox!.getCenter(new THREE.Vector3());
    g.translate(-c.x, -c.y, -c.z);
    g.computeBoundingBox();
    g.translate(0, -g.boundingBox!.min.y, 0);
    return g;
  }, [geometry]);

  useEffect(() => {
    geo.computeBoundingBox();
    const size = geo.boundingBox!.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const d = maxDim * 2.4;
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.position.set(d * 0.7, d * 0.5, d * 0.7);
      camera.lookAt(0, size.y * 0.45, 0);
      camera.updateProjectionMatrix();
    }
  }, [geo, camera]);

  return (
    <mesh geometry={geo} castShadow receiveShadow>
      <meshStandardMaterial {...VIEWER_MAT_PROPS} />
    </mesh>
  );
}

function OBJSceneContent({ url, companions }: { url: string; companions: File[] }) {
  const { camera } = useThree();
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const defaultMat = useMemo(() => new THREE.MeshStandardMaterial(VIEWER_MAT_PROPS), []);

  useEffect(() => {
    let cancelled = false;
    const mtlFile     = companions.find((f) => f.name.toLowerCase().endsWith(".mtl"));
    const textures    = companions.filter((f) => !f.name.toLowerCase().endsWith(".mtl"));
    const mtlObjUrl   = mtlFile ? URL.createObjectURL(mtlFile) : undefined;

    loadObjGroup(url, mtlObjUrl, textures.length ? textures : undefined)
      .then((g) => {
        if (cancelled) return;
        // Ensure PBR material where MTL didn't provide one
        g.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          if (!mesh.material || (mesh.material as THREE.Material).type !== "MeshStandardMaterial") {
            mesh.material = defaultMat;
          }
        });
        setGroup(g);
      })
      .catch(() => { /* error boundary handles this */ });

    return () => {
      cancelled = true;
      if (mtlObjUrl) URL.revokeObjectURL(mtlObjUrl);
    };
  }, [url, companions, defaultMat]);

  useEffect(() => {
    if (!group || !(camera instanceof THREE.PerspectiveCamera)) return;
    const box = new THREE.Box3().setFromObject(group);
    if (box.isEmpty()) return;
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const d = maxDim * 2.4;
    camera.position.set(center.x + d * 0.7, center.y + d * 0.5, center.z + d * 0.7);
    camera.lookAt(center.x, center.y * 0.45, center.z);
    camera.updateProjectionMatrix();
  }, [group, camera]);

  if (!group) return null;
  return <primitive object={group} />;
}

function GLBSceneContent({ url }: { url: string }) {
  const gltf = useLoader(GLTFLoader, url);
  const { camera } = useThree();

  useEffect(() => {
    const box = new THREE.Box3().setFromObject(gltf.scene);
    if (box.isEmpty()) return;
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const d = maxDim * 2.4;
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.position.set(center.x + d * 0.7, center.y + d * 0.5, center.z + d * 0.7);
      camera.lookAt(center.x, center.y * 0.45, center.z);
      camera.updateProjectionMatrix();
    }
  }, [gltf, camera]);

  return <primitive object={gltf.scene} />;
}

// ─── Upload viewer ─────────────────────────────────────────────────────────────

interface UploadViewerProps {
  url: string | null;
  ext: string;
  companions: File[];
}

function UploadViewer({ url, ext, companions }: UploadViewerProps) {
  const [hasError, setHasError] = useState(false);
  const controlsRef = useRef<any>(null);

  // Reset error state when the source URL changes (new file selected)
  useEffect(() => { setHasError(false); }, [url]);

  if (!url) {
    return (
      <div className="w-full aspect-[4/3] rounded-xl border border-border bg-bg-card flex flex-col items-center justify-center gap-2">
        <Box size={36} className="text-text-secondary opacity-20" />
        <p className="text-xs text-text-secondary">3D preview will appear here</p>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="w-full aspect-[4/3] rounded-xl border border-border bg-bg-card flex flex-col items-center justify-center gap-2">
        <AlertCircle size={28} className="text-text-secondary opacity-30" />
        <p className="text-xs text-text-secondary">3D preview unavailable for this file</p>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden border border-border bg-bg-card">
      <Canvas
        key={url}
        shadows
        camera={{ fov: 45, near: 0.1, far: 10000, position: [10, 10, 10] }}
        onCreated={({ gl }) => {
          gl.setClearColor('#1a1a1a');
          gl.shadowMap.enabled = true;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.2;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <hemisphereLight args={['#ffffff', '#e0ddd8', 0.8]} />
        <directionalLight position={[5, 8, 5]} intensity={2.2} castShadow />
        <directionalLight position={[-4, 2, -4]} intensity={0.3} color="#fff8f0" />
        <ambientLight intensity={0.3} />

        <Suspense fallback={null}>
          <ViewerErrorBoundary key={url} onError={() => setHasError(true)}>
            {ext === 'stl' && <STLSceneContent url={url} />}
            {ext === 'obj' && <OBJSceneContent url={url} companions={companions} />}
            {(ext === 'glb' || ext === 'gltf') && <GLBSceneContent url={url} />}
          </ViewerErrorBoundary>
        </Suspense>

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enablePan
          enableZoom
          enableRotate
          minDistance={0.1}
          maxDistance={10000}
        />
      </Canvas>
    </div>
  );
}

// ─── Main Upload page ─────────────────────────────────────────────────────────

export default function Upload() {
  const navigate = useNavigate();
  const isAuthenticated = useIsAuthenticated();
  const { instance } = useMsal();

  // Form state
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory]       = useState(CATEGORIES[0]);
  const [tags, setTags]               = useState("");

  // File state
  const [modelFile, setModelFile]           = useState<File | null>(null);
  const [viewerUrl, setViewerUrl]           = useState<string | null>(null);
  const [companionFiles, setCompanionFiles] = useState<File[]>([]);

  // Texture validation (populated by parsing the MTL file)
  interface TexValidation { referenced: string[]; found: string[]; missing: string[] }
  const [texValidation, setTexValidation] = useState<TexValidation | null>(null);

  // Gallery state
  const [galleryBlobs, setGalleryBlobs]   = useState<Blob[]>([]);
  const [previewUrls, setPreviewUrls]     = useState<string[]>([]);
  const [generatingStep, setGeneratingStep] = useState<number | null>(null);
  const [genError, setGenError]           = useState("");
  const [modelMetadata, setModelMetadata] = useState<GalleryMetadata | null>(null);

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState("");

  // Refs
  const modelInputRef        = useRef<HTMLInputElement>(null);
  const companionInputRef    = useRef<HTMLInputElement>(null);
  const cancelledRef         = useRef(false);
  const prevViewerUrlRef     = useRef<string | null>(null);
  const skipCompanionRegen   = useRef(false);    // set during model change to suppress effect

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      previewUrls.forEach((u) => URL.revokeObjectURL(u));
      if (prevViewerUrlRef.current) URL.revokeObjectURL(prevViewerUrlRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Viewer URL lifecycle ──────────────────────────────────────────────────

  function updateViewerUrl(file: File | null) {
    if (prevViewerUrlRef.current) {
      URL.revokeObjectURL(prevViewerUrlRef.current);
      prevViewerUrlRef.current = null;
    }
    if (file) {
      const url = URL.createObjectURL(file);
      prevViewerUrlRef.current = url;
      setViewerUrl(url);
    } else {
      setViewerUrl(null);
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────

  function clearUpload() {
    cancelledRef.current = true;
    skipCompanionRegen.current = true;    // suppress regen triggered by clearing companions
    previewUrls.forEach((u) => URL.revokeObjectURL(u));
    updateViewerUrl(null);
    setModelFile(null);
    setCompanionFiles([]);
    setTexValidation(null);
    setGalleryBlobs([]);
    setPreviewUrls([]);
    setGenError("");
    setGeneratingStep(null);
    setModelMetadata(null);
    if (modelInputRef.current) modelInputRef.current.value = "";
    if (companionInputRef.current) companionInputRef.current.value = "";
  }

  async function handleLogin() {
    try { await instance.loginRedirect(loginRequest); }
    catch (err) { console.error("Login failed:", err); }
  }

  async function runGalleryGeneration(
    file: File,
    companions?: { mtlFile?: File; textureFiles?: File[] },
  ) {
    setGalleryBlobs([]);
    setGenError("");
    setModelMetadata(null);
    previewUrls.forEach((u) => URL.revokeObjectURL(u));
    setPreviewUrls([]);
    setGeneratingStep(0);

    try {
      const result = await generateModelGallery(file, companions);
      if (cancelledRef.current) return;

      const urls: string[] = [];
      for (let i = 0; i < result.blobs.length; i++) {
        if (cancelledRef.current) { urls.forEach((u) => URL.revokeObjectURL(u)); return; }
        setGeneratingStep(i);
        urls.push(URL.createObjectURL(result.blobs[i]));
        await new Promise((r) => setTimeout(r, 30));
      }
      if (cancelledRef.current) { urls.forEach((u) => URL.revokeObjectURL(u)); return; }

      setGalleryBlobs(result.blobs);
      setPreviewUrls(urls);
      setModelMetadata(result.metadata);
    } catch {
      if (!cancelledRef.current) {
        setGenError("Preview generation failed. The file may be corrupt or unsupported.");
      }
    } finally {
      if (!cancelledRef.current) setGeneratingStep(null);
    }
  }

  // Auto-regen gallery + live preview when companion files change (not on initial model select)
  useEffect(() => {
    if (skipCompanionRegen.current) { skipCompanionRegen.current = false; return; }
    if (!modelFile) return;
    cancelledRef.current = false;
    const mtlFile      = companionFiles.find((f) => f.name.toLowerCase().endsWith(".mtl"));
    const textureFiles = companionFiles.filter((f) => !f.name.toLowerCase().endsWith(".mtl"));
    runGalleryGeneration(modelFile, { mtlFile, textureFiles });
  }, [companionFiles]); // eslint-disable-line react-hooks/exhaustive-deps

  // Parse MTL to validate which textures are referenced vs. uploaded
  useEffect(() => {
    const mtlFile = companionFiles.find((f) => f.name.toLowerCase().endsWith(".mtl"));
    if (!mtlFile) { setTexValidation(null); return; }
    let cancelled = false;
    parseMtlTextures(mtlFile).then((referenced) => {
      if (cancelled) return;
      const uploadedNames = new Set(
        companionFiles
          .filter((f) => !f.name.toLowerCase().endsWith(".mtl"))
          .map((f) => f.name.toLowerCase()),
      );
      const found   = referenced.filter((n) => uploadedNames.has(n.toLowerCase()));
      const missing = referenced.filter((n) => !uploadedNames.has(n.toLowerCase()));
      setTexValidation({ referenced, found, missing });
    });
    return () => { cancelled = true; };
  }, [companionFiles]);

  async function handleModelFileChange(file: File) {
    cancelledRef.current = false;
    skipCompanionRegen.current = true;   // prevent companion effect from double-firing
    setModelFile(file);
    updateViewerUrl(file);
    setCompanionFiles([]);
    await runGalleryGeneration(file);
  }

  function removeCompanionFile(index: number) {
    setCompanionFiles((prev) => prev.filter((_, i) => i !== index));
    if (companionInputRef.current) companionInputRef.current.value = "";
  }

  function addCompanionFiles(files: File[]) {
    setCompanionFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      const incoming = files.filter((f) => !existing.has(f.name));
      return [...prev, ...incoming];
    });
    if (companionInputRef.current) companionInputRef.current.value = "";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!modelFile)           { setError("Please select a 3D model file."); return; }
    if (galleryBlobs.length === 0) { setError("Waiting for preview generation to finish."); return; }
    setSubmitting(true);
    setError("");

    const formData = new FormData();
    formData.append("modelFile", modelFile);
    formData.append("generatedThumbnail", galleryBlobs[0], "cover.webp");
    for (let i = 1; i < galleryBlobs.length; i++) {
      formData.append(`galleryImage${i - 1}`, galleryBlobs[i], `angle-${i}.webp`);
    }
    formData.append("title", title);
    formData.append("description", description);
    formData.append("category", category);
    formData.append("tags", tags);

    try {
      const { id } = await createModel(formData);
      navigate(`/model/${id}`);
    } catch {
      setError("Failed to upload model. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────

  const isGenerating = generatingStep !== null;
  const hasGallery   = galleryBlobs.length > 0;
  const ext          = modelFile?.name.split('.').pop()?.toLowerCase() ?? '';
  const isObj        = ext === 'obj';

  // ── Sign-in gate ──────────────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <h1 className="text-xl font-bold text-text-primary">Upload New Model</h1>
        <p className="text-text-secondary text-sm">Sign in with your Microsoft account to upload models.</p>
        <button
          onClick={handleLogin}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-bg-primary font-semibold text-sm hover:bg-accent-hover transition-colors"
        >
          <LogIn size={16} /> Sign in with Microsoft
        </button>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="grid grid-cols-1 lg:grid-cols-[460px_1fr] gap-8">

        {/* ── Left column: form ─────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">

          {/* Header */}
          <div>
            <button
              type="button"
              onClick={() => { try { navigate(-1); } catch { navigate("/"); } }}
              className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors mb-3"
            >
              <ArrowLeft size={14} /> Back
            </button>
            <h1 className="text-xl font-bold text-text-primary">Upload Model</h1>
            <p className="text-text-secondary text-sm mt-1">
              Upload a 3D model and preview the generated gallery images before publishing.
            </p>
          </div>

          {/* Format chips */}
          <div className="rounded-xl border border-border bg-input-bg px-4 py-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-text-secondary font-medium">Accepted:</span>
              {["STL", "OBJ", "GLB"].map((fmt) => (
                <span key={fmt} className="px-2 py-0.5 rounded-md bg-bg-card border border-border text-xs text-text-secondary font-mono">
                  {fmt}
                </span>
              ))}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-text-secondary">Best visual quality: <span className="text-text-primary font-medium">GLB</span> (embedded materials &amp; textures)</span>
              <span className="text-[11px] text-text-secondary"><span className="text-text-primary font-medium">OBJ</span> supports optional .mtl + texture files</span>
              <span className="text-[11px] text-text-secondary"><span className="text-text-primary font-medium">STL</span> is geometry only — rendered with a clean default material</span>
            </div>
          </div>

          {/* Drop zone */}
          <div
            onClick={() => !modelFile && modelInputRef.current?.click()}
            className={`flex flex-col items-center justify-center gap-2 p-8 rounded-xl border-2 border-dashed transition-colors bg-input-bg ${
              modelFile
                ? "border-accent/30 cursor-default"
                : "border-border hover:border-accent/40 cursor-pointer"
            }`}
          >
            {modelFile ? (
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-3">
                  <FileBox size={24} className="text-accent shrink-0" />
                  <div>
                    <p className="text-sm text-text-primary font-medium leading-tight">{modelFile.name}</p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {(modelFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); clearUpload(); }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-bg-card border border-border text-xs text-text-secondary hover:text-red-400 hover:border-red-400/40 transition-colors"
                >
                  <X size={12} /> Remove
                </button>
              </div>
            ) : (
              <>
                <FileBox size={32} className="text-text-secondary" />
                <p className="text-sm text-text-secondary">Click to select a 3D model file</p>
                <p className="text-xs text-text-secondary opacity-60">STL · OBJ · GLB</p>
              </>
            )}
            <input
              ref={modelInputRef}
              type="file"
              accept=".stl,.obj,.glb"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleModelFileChange(f); }}
              className="hidden"
            />
          </div>

          {/* OBJ companion files */}
          {isObj && (
            <div className="rounded-xl border border-border bg-input-bg px-4 py-3 flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <Info size={14} className="text-accent shrink-0 mt-0.5" />
                <p className="text-xs text-text-secondary leading-relaxed">
                  Add the <span className="font-mono text-text-primary">.mtl</span> file and any texture
                  images to preserve colors and materials. Previews regenerate automatically.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-xs text-text-secondary font-medium">Companion files (MTL + textures)</label>

                {/* Styled add button */}
                <button
                  type="button"
                  onClick={() => companionInputRef.current?.click()}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-border bg-bg-card text-text-secondary text-sm hover:border-accent/40 hover:text-text-primary transition-colors cursor-pointer"
                >
                  <Paperclip size={14} /> Add .mtl / textures
                </button>
                <input
                  ref={companionInputRef}
                  type="file"
                  accept=".mtl,.png,.jpg,.jpeg,.webp"
                  multiple
                  onChange={(e) => addCompanionFiles(Array.from(e.target.files ?? []))}
                  className="hidden"
                />

                {/* File list */}
                {companionFiles.length > 0 && (
                  <ul className="flex flex-col gap-1 mt-0.5">
                    {companionFiles.map((file, i) => (
                      <li
                        key={`${file.name}-${i}`}
                        className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-bg-card border border-border"
                      >
                        <span className="text-xs text-text-secondary font-mono truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => removeCompanionFile(i)}
                          className="text-text-secondary hover:text-red-400 transition-colors shrink-0 p-0.5 rounded"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X size={12} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Texture validation summary */}
                {texValidation && (() => {
                  const { referenced, found, missing } = texValidation;
                  if (referenced.length === 0) {
                    return (
                      <div className="flex items-center gap-1.5 mt-1 px-1 text-xs text-text-secondary">
                        <Info size={11} className="shrink-0" />
                        MTL has no texture maps — material colors only
                      </div>
                    );
                  }
                  if (missing.length === 0) {
                    return (
                      <div className="flex items-center gap-1.5 mt-1 px-1 text-xs text-accent">
                        <CheckCircle2 size={11} className="shrink-0" />
                        {found.length} / {referenced.length} texture{referenced.length !== 1 ? "s" : ""} found
                      </div>
                    );
                  }
                  return (
                    <div className="mt-1 flex flex-col gap-1 px-1">
                      <div className="flex items-center gap-1.5 text-xs text-yellow-400">
                        <AlertCircle size={11} className="shrink-0" />
                        {found.length} / {referenced.length} texture{referenced.length !== 1 ? "s" : ""} found —
                        {missing.length} missing
                      </div>
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {missing.map((name) => (
                          <span key={name} className="px-1.5 py-0.5 rounded bg-yellow-400/10 border border-yellow-400/20 text-yellow-400 text-[10px] font-mono">
                            {name}
                          </span>
                        ))}
                      </div>
                      <p className="text-[10px] text-text-secondary mt-0.5">
                        Missing textures will use a clean fallback material.
                      </p>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Metadata */}
          <input
            type="text" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} required
            className="px-4 py-2.5 rounded-lg bg-input-bg border border-border text-text-primary placeholder-text-secondary text-sm focus:outline-none focus:border-accent transition-colors"
          />
          <textarea
            placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            className="px-4 py-2.5 rounded-lg bg-input-bg border border-border text-text-primary placeholder-text-secondary text-sm focus:outline-none focus:border-accent transition-colors resize-y"
          />
          <select
            value={category} onChange={(e) => setCategory(e.target.value)}
            className="px-4 py-2.5 rounded-lg bg-input-bg border border-border text-text-primary text-sm focus:outline-none focus:border-accent transition-colors"
          >
            {CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <input
            type="text" placeholder="Tags (comma-separated)" value={tags} onChange={(e) => setTags(e.target.value)}
            className="px-4 py-2.5 rounded-lg bg-input-bg border border-border text-text-primary placeholder-text-secondary text-sm focus:outline-none focus:border-accent transition-colors"
          />

          {error && <p className="text-red-400 text-sm">{error}</p>}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting || isGenerating || !hasGallery}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-bg-primary font-semibold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
          >
            {submitting   ? <><Loader2 size={16} className="animate-spin" /> Uploading…</>
            : isGenerating ? <><Loader2 size={16} className="animate-spin" /> Generating previews…</>
            : <><UploadIcon size={16} /> Upload Model</>}
          </button>
        </form>

        {/* ── Right column: preview panel ───────────────────────────────── */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-6 lg:self-start">

          {/* Status card */}
          <div className="rounded-xl border border-border bg-input-bg px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {!modelFile && (
                <><Box size={15} className="text-text-secondary opacity-50" /><span className="text-xs text-text-secondary">No file selected</span></>
              )}
              {modelFile && isGenerating && (
                <><Loader2 size={15} className="text-accent animate-spin" />
                <span className="text-xs text-accent">Generating {(generatingStep ?? 0) + 1} of {TOTAL_PASSES}…</span></>
              )}
              {modelFile && !isGenerating && hasGallery && (
                <><CheckCircle2 size={15} className="text-accent" />
                <span className="text-xs text-accent font-medium">{TOTAL_PASSES} / {TOTAL_PASSES} previews ready</span></>
              )}
              {modelFile && !isGenerating && !hasGallery && genError && (
                <><AlertCircle size={15} className="text-red-400" />
                <span className="text-xs text-red-400">Generation failed</span></>
              )}
              {modelFile && !isGenerating && !hasGallery && !genError && (
                <><Loader2 size={15} className="text-text-secondary" />
                <span className="text-xs text-text-secondary">Preparing…</span></>
              )}
            </div>
            {hasGallery && !isGenerating && (
              <button
                type="button"
                onClick={clearUpload}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-bg-card border border-border text-xs text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors"
              >
                <RotateCcw size={11} /> Reset
              </button>
            )}
          </div>

          {/* 3D viewer */}
          <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
            <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-black/5">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">3D Preview</p>
              <p className="text-[10px] text-text-secondary/60">Drag to rotate · Scroll to zoom</p>
            </div>
            <div className="p-3">
              <UploadViewer url={viewerUrl} ext={ext} companions={companionFiles} />
            </div>
          </div>

          {/* Generated gallery */}
          <div className="rounded-xl border border-border bg-input-bg overflow-hidden">
            <div className="px-4 pt-3 pb-2 border-b border-border">
              <p className="text-xs font-medium text-text-secondary uppercase tracking-wide">
                Generated Previews
              </p>
            </div>

            {genError && (
              <p className="text-red-400 text-xs px-4 py-3">{genError}</p>
            )}

            {(previewUrls.length > 0 || isGenerating) && (
              <div className="grid grid-cols-3 gap-px bg-border">
                {previewUrls.map((url, i) => (
                  <div key={i} className="relative aspect-square bg-bg-card overflow-hidden">
                    <img
                      src={url}
                      alt={ANGLE_LABELS[i] ?? `Preview ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-black/40 backdrop-blur-sm">
                      <span className="text-text-primary text-[9px] font-semibold uppercase tracking-wider leading-none block">
                        {ANGLE_LABELS[i] ?? `Preview ${i + 1}`}
                      </span>
                      {i === 0 && (
                        <span className="text-accent/80 text-[8px] leading-none block mt-0.5">
                          Card thumbnail
                        </span>
                      )}
                      {i === 4 && (
                        <span className="text-text-secondary/80 text-[8px] leading-none block mt-0.5">
                          STL-style
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {isGenerating && Array.from({ length: TOTAL_PASSES - previewUrls.length }).map((_, i) => (
                  <div key={`skel-${i}`} className="aspect-square bg-bg-secondary animate-pulse flex items-center justify-center">
                    <Loader2 size={16} className="text-text-secondary/20 animate-spin" />
                  </div>
                ))}
              </div>
            )}

            {modelMetadata && !isGenerating && (
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 px-1 pt-1 pb-0.5">
                <span className="text-xs text-text-secondary">
                  <span className="text-text-primary font-medium">{modelMetadata.triangleCount.toLocaleString()}</span> triangles
                </span>
                <span className="text-xs text-text-secondary">
                  <span className="text-text-primary font-medium">
                    {modelMetadata.boundingBox.x} × {modelMetadata.boundingBox.y} × {modelMetadata.boundingBox.z}
                  </span> units
                </span>
                <span className={`text-xs font-medium ${modelMetadata.hasTextures ? 'text-text-primary' : 'text-text-secondary'}`}>
                  {modelMetadata.hasTextures ? '✓ Textures loaded' : 'No textures'}
                </span>
              </div>
            )}

            {!isGenerating && !hasGallery && !genError && (
              <div className="flex items-center justify-center py-10">
                <p className="text-xs text-text-secondary opacity-40">
                  {modelFile ? "Starting generation…" : "Select a model to generate previews"}
                </p>
              </div>
            )}

            {isGenerating && previewUrls.length === 0 && (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 size={18} className="text-accent animate-spin" />
                <span className="text-sm text-text-secondary">Rendering model geometry…</span>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
