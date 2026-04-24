import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Download,
  FileBox,
  ImageIcon,
  Files,
  Archive,
  X,
  Box,
  ArrowLeft,
  RotateCcw,
  Trash2,
} from "lucide-react";
import STLPreviewModal from "../components/STLPreviewModal";
import * as THREE from "three";
import {
  createImportSession,
  deleteImportSession,
  saveImportPackage,
  fetchImportSessionFile,
  type ImportSession,
  type ImportFile,
} from "../services/api";
import { makeRenderer, renderStlStylePass } from "../utils/generateThumbnail";
import { loadStlGeometry } from "../utils/modelLoaders";

// ─── Extension types ──────────────────────────────────────────────────────────

interface MakerWorldFile {
  filePath: string | null;
  type: string | null;
}

interface MakerWorldInstance {
  id: number | null;
  name: string | null;
  designFiles: MakerWorldFile[];
}

interface MakerWorldCategory {
  id: number;
  name: string;
  slug?: string;
}

interface MakerWorldMetadata {
  title: string | null;
  summary: string | null;
  coverUrl: string | null;
  coverLandscape: string | null;
  coverPortrait: string | null;
  designExtension: string | null;
  defaultInstanceId: number | null;
  instances: MakerWorldInstance[];
  sourceImages: string[];
  categories?: MakerWorldCategory[];
  category?: string | null;
}

interface ExtractError {
  error: string;
  detail?: string;
}

// ─── Phase state ──────────────────────────────────────────────────────────────

type ImportPhase =
  | "idle"
  | "loading"     // loading metadata from extension
  | "metadata"    // metadata loaded, awaiting user action
  | "acquiring"   // acquiring signed URL from extension
  | "importing"   // POST /api/import/session + generating previews
  | "reviewing"   // package review visible
  | "saving"
  | "done";

// ─── Package types ────────────────────────────────────────────────────────────

interface PartInfo {
  triangleCount: number;
  width: number;
  height: number;
  depth: number;
}

interface StlPart {
  file: ImportFile;
  previewBlob: Blob | null;
  previewUrl: string | null;
  stlObjectUrl: string | null;
  generating: boolean;
  info: PartInfo | null;
  fileSize?: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EXTENSION_ID = import.meta.env.VITE_EXTENSION_ID as string | undefined;
const TIMEOUT_MS = 15000;
const ACQUIRE_TIMEOUT_MS = 120000;

// ─── Text / label helpers ─────────────────────────────────────────────────────

function formatBytes(bytes: number | null | undefined) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const ROLE_LABELS: Record<string, string> = {
  archive:  "Original archive",
  model:    "3D model file",
  texture:  "Texture",
  document: "Documentation",
  mtl:      "Material file",
};
function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role;
}

function pickMwCategory(cats: MakerWorldCategory[] | null | undefined): string | null {
  if (!cats || cats.length === 0) return null;
  // Most specific = longest name
  return cats.reduce((best, c) => c.name.length > best.name.length ? c : best).name;
}

// ─── Error helpers ────────────────────────────────────────────────────────────

function describeError(err: ExtractError): string {
  switch (err.error) {
    case "NEXT_DATA_MISSING":
      return "The MakerWorld page did not contain the expected data. Make sure the page has fully loaded.";
    case "PARSE_FAILED":
      return `Page data could not be parsed. ${err.detail ?? ""}`;
    case "DESIGN_INFO_MISSING":
      return "Model info was not found. This URL may not be a model page.";
    case "INVALID_MESSAGE":
      return "Internal error: invalid message sent to extension.";
    case "BACKGROUND_ERROR":
      return `Extension background error: ${err.detail ?? "unknown"}`;
    case "CAPTCHA_REQUIRED":
      return "MakerWorld showed a CAPTCHA. Solve it in the MakerWorld tab, then try again.";
    case "REQUEST_NOT_OBSERVED":
      return "The extension triggered the download button but no API request was observed.";
    case "RESPONSE_NOT_OBSERVED":
      return "The download API request was observed but no response arrived. You may not be logged in to MakerWorld.";
    case "SIGNED_URL_TIMEOUT":
      return "The download did not complete within the timeout.";
    case "URL_NOT_FOUND_IN_RESPONSE":
      return "The extension captured the download response but could not find a signed URL inside it.";
    default:
      return `Unexpected error: ${err.error}`;
  }
}

// ─── STL preview generation ───────────────────────────────────────────────────

async function generateStlPreview(file: File): Promise<{
  previewBlob: Blob;
  info: PartInfo;
}> {
  const objectUrl = URL.createObjectURL(file);
  let geo: THREE.BufferGeometry;
  try {
    geo = await loadStlGeometry(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  // Compute info from raw geometry — no geometry mutation
  geo.computeBoundingBox();
  const size = geo.boundingBox!.getSize(new THREE.Vector3());
  const triCount = Math.round((geo.attributes.position?.count ?? 0) / 3);

  const renderer = makeRenderer();
  let previewBlob: Blob;
  try {
    previewBlob = await renderStlStylePass(geo, renderer);
  } finally {
    renderer.dispose();
    geo.dispose();
  }

  return {
    previewBlob,
    info: {
      triangleCount: triCount,
      width: +size.x.toFixed(2),
      height: +size.y.toFixed(2),
      depth: +size.z.toFixed(2),
    },
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function MakerWorldImport() {
  const navigate = useNavigate();

  // ── Phase / error ──────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<ImportPhase>("idle");
  const [error, setError] = useState<string | null>(null);

  // ── Input & metadata ───────────────────────────────────────────────────────
  const [url, setUrl] = useState("");
  const [metadata, setMetadata] = useState<MakerWorldMetadata | null>(null);
  const [session, setSession] = useState<ImportSession | null>(null);

  // ── Version selection ──────────────────────────────────────────────────────
  const [selectedInstanceId, setSelectedInstanceId] = useState<number | null>(null);

  // ── Package state ──────────────────────────────────────────────────────────
  const [stlParts, setStlParts] = useState<StlPart[]>([]);
  const [sourceImageUrls, setSourceImageUrls] = useState<string[]>([]);
  const [otherFiles, setOtherFiles] = useState<ImportFile[]>([]);

  // ── Form ───────────────────────────────────────────────────────────────────
  const [form, setForm] = useState({ title: "", description: "", category: "Art", categoryMapped: false, sourceCategories: [] as string[] });

  // ── STL preview lightbox ───────────────────────────────────────────────────
  const [stlLightbox, setStlLightbox] = useState<{ url: string; name: string } | null>(null);
  const [stl3dPreview, setStl3dPreview] = useState<{ url: string; name: string } | null>(null);

  // ── File download ──────────────────────────────────────────────────────────
  async function handleDownload(file: ImportFile) {
    if (!session) return;
    const blob = await fetchImportSessionFile(session.sessionId, file.relativePath);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Scroll target ──────────────────────────────────────────────────────────
  const reviewSectionRef = useRef<HTMLDivElement>(null);

  // ── Extension availability ─────────────────────────────────────────────────
  const extensionAvailable =
    typeof (window as unknown as { chrome?: { runtime?: unknown } }).chrome?.runtime !== "undefined" &&
    !!EXTENSION_ID;


  // ── Auto-scroll when entering reviewing phase ──────────────────────────────
  useEffect(() => {
    if (phase === "reviewing") {
      setTimeout(() => {
        reviewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    }
  }, [phase]);

  useEffect(() => {
    if (!stlLightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setStlLightbox(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stlLightbox]);

  // ── Cleanup preview object URLs on unmount ─────────────────────────────────
  useEffect(() => {
    return () => {
      stlParts.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
        if (p.stlObjectUrl) URL.revokeObjectURL(p.stlObjectUrl);
      });
      sourceImageUrls.forEach(URL.revokeObjectURL);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Preview generation ────────────────────────────────────────────────────

  const generateAllPreviews = useCallback(async (
    importedSession: ImportSession,
    parts: StlPart[],
  ) => {
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];

      // Mark this part as generating
      setStlParts((prev) =>
        prev.map((p, idx) => idx === i ? { ...p, generating: true } : p)
      );

      try {
        const blob = await fetchImportSessionFile(
          importedSession.sessionId, part.file.relativePath
        );
        const stlObjectUrl = URL.createObjectURL(blob);
        const file = new File([blob], part.file.name);
        const { previewBlob, info } = await generateStlPreview(file);
        const previewUrl = URL.createObjectURL(previewBlob);
        const fileSize = blob.size;

        setStlParts((prev) =>
          prev.map((p, idx) =>
            idx === i
              ? { ...p, generating: false, previewBlob, previewUrl, stlObjectUrl, info, fileSize }
              : p
          )
        );
      } catch (e) {
        // Part preview failed — continue with next
        console.warn(`[import] preview failed for ${part.file.name}:`, e);
        setStlParts((prev) =>
          prev.map((p, idx) => idx === i ? { ...p, generating: false } : p)
        );
      }
    }
  }, []);

  // ─── Extension messaging ───────────────────────────────────────────────────

  const chrome = (window as unknown as {
    chrome: { runtime: { sendMessage: (id: string, msg: unknown, cb: (res: unknown) => void) => void } };
  }).chrome;

  async function handleExtract() {
    if (!url.trim()) return;
    setPhase("loading");
    setError(null);

    if (!extensionAvailable) {
      setError("Extension not detected. Load the extension in Chrome and set VITE_EXTENSION_ID.");
      setPhase("idle");
      return;
    }

    try {
      const result = await Promise.race<unknown>([
        new Promise((resolve) =>
          chrome.runtime.sendMessage(EXTENSION_ID!, { type: "EXTRACT_MAKERWORLD_METADATA", url: url.trim() }, resolve)
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS)),
      ]);

      if (!result) {
        setError("No response from extension. Is it loaded and enabled?");
        setPhase("idle");
        return;
      }

      const res = result as MakerWorldMetadata | ExtractError;
      if ("error" in res) {
        setError(describeError(res));
        setPhase("idle");
      } else {
        setMetadata(res);
        setSelectedInstanceId(res.defaultInstanceId ?? (res.instances[0]?.id ?? null));
        const rawCats = (res.categories ?? []).map((c) => c.name);
        const pickedCat = pickMwCategory(res.categories);
        setForm((f) => ({
          ...f,
          sourceCategories: rawCats,
          category: pickedCat ?? "Other",
          categoryMapped: pickedCat !== null,
        }));
        setPhase("metadata");
      }
    } catch (e: unknown) {
      const msg =
        e instanceof Error && e.message === "timeout"
          ? "Extension did not respond within 15 seconds."
          : `Unexpected error: ${String(e)}`;
      setError(msg);
      setPhase("idle");
    }
  }

  async function handleAcquire() {
    if (!extensionAvailable) return;
    setPhase("acquiring");
    setError(null);

    let result: unknown;
    try {
      result = await Promise.race<unknown>([
        new Promise((resolve) =>
          chrome.runtime.sendMessage(EXTENSION_ID!, { type: "ACQUIRE_MAKERWORLD_FILE", url: url.trim() }, resolve)
        ),
        new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ACQUIRE_TIMEOUT_MS)),
      ]);
    } catch (e: unknown) {
      const msg =
        e instanceof Error && e.message === "timeout"
          ? "File acquisition timed out. Make sure you are logged in to MakerWorld and the extension is active."
          : `Unexpected error: ${String(e)}`;
      setError(msg);
      setPhase("metadata");
      return;
    }

    if (!result) {
      setError("No response from extension during file acquisition.");
      setPhase("metadata");
      return;
    }

    const res = result as { signedUrl?: string; error?: string; detail?: string };
    if (res.error) {
      setError(describeError({ error: res.error, detail: res.detail }));
      setPhase("metadata");
      return;
    }
    if (!res.signedUrl) {
      setError("Extension returned no signed URL.");
      setPhase("metadata");
      return;
    }

    // Create the import session — pass source images from metadata for download
    let importedSession: ImportSession;
    try {
      importedSession = await createImportSession(
        res.signedUrl,
        metadata?.sourceImages ?? []
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create import session.");
      setPhase("metadata");
      return;
    }

    setPhase("importing");
    setSession(importedSession);

    // Classify files
    const allStlFiles = importedSession.files.filter((f) => f.role === "stl");
    const srcImgFiles = importedSession.files.filter((f) => f.role === "source-image");
    const other = importedSession.files.filter(
      (f) => f.role !== "stl" && f.role !== "source-image"
    );

    // Filter STLs to the selected version's design files when possible
    const selectedInstance = metadata?.instances.find((inst) => inst.id === selectedInstanceId);
    const instanceFilePaths = selectedInstance?.designFiles
      .map((f) => f.filePath?.toLowerCase())
      .filter(Boolean) ?? [];
    const filteredStlFiles = instanceFilePaths.length > 0
      ? allStlFiles.filter((f) => instanceFilePaths.some((p) => f.relativePath.toLowerCase().includes(p!)))
      : allStlFiles;
    const stlFiles = filteredStlFiles.length > 0 ? filteredStlFiles : allStlFiles;

    if (stlFiles.length === 0) {
      setError("No STL files found in package.");
      setPhase("metadata");
      return;
    }

    // Initialise stlParts state (no preview yet)
    const initialParts: StlPart[] = stlFiles.map((f) => ({
      file: f,
      previewBlob: null,
      previewUrl: null,
      stlObjectUrl: null,
      generating: false,
      info: null,
    }));
    setStlParts(initialParts);
    setOtherFiles(other);

    // Pre-fill title from metadata
    setForm((f) => ({
      ...f,
      title: f.title || (metadata?.title ?? stlFiles[0].name.replace(/\.[^.]+$/, "")),
    }));

    // Fetch source image object URLs for display
    const srcUrls: string[] = [];
    for (const imgFile of srcImgFiles) {
      try {
        const blob = await fetchImportSessionFile(importedSession.sessionId, imgFile.relativePath);
        srcUrls.push(URL.createObjectURL(blob));
      } catch {
        // best-effort
      }
    }
    setSourceImageUrls(srcUrls);

    // Generate one preview per STL sequentially
    await generateAllPreviews(importedSession, initialParts);

    setPhase("reviewing");
  }

  // ─── Save ──────────────────────────────────────────────────────────────────

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setPhase("saving");

    try {
      const formData = new FormData();
      formData.append("sessionId", session.sessionId);
      formData.append("title", form.title);
      formData.append("description", form.description);
      formData.append("category", form.category);
      formData.append("sourceUrl", url.trim());

      stlParts.forEach((part, i) => {
        formData.append(`Part_${i}_RelativePath`, part.file.relativePath);
        formData.append(`Part_${i}_TriangleCount`, String(part.info?.triangleCount ?? 0));
        formData.append(`Part_${i}_Width`,  String(part.info?.width  ?? 0));
        formData.append(`Part_${i}_Height`, String(part.info?.height ?? 0));
        formData.append(`Part_${i}_Depth`,  String(part.info?.depth  ?? 0));
        if (part.previewBlob) {
          formData.append(`Part_${i}_Preview`, part.previewBlob, `${part.file.name}.webp`);
        }
      });

      await saveImportPackage(formData);
      // Cleanup session on success (best-effort)
      await deleteImportSession(session.sessionId).catch(() => {});
      setPhase("done");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed.");
      setPhase("reviewing");
    }
  }

  function handleResetReview() {
    stlParts.forEach((p) => {
      if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      if (p.stlObjectUrl) URL.revokeObjectURL(p.stlObjectUrl);
    });
    sourceImageUrls.forEach(URL.revokeObjectURL);
    setStlParts([]);
    setSourceImageUrls([]);
    setOtherFiles([]);
    setSession(null);
    setPhase("metadata");
    setError(null);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (phase === "done") {
    return (
      <div className="max-w-xl mx-auto py-16 px-4 flex flex-col items-center gap-5 text-center">
        <CheckCircle2 size={40} className="text-green-400" />
        <h1 className="text-xl font-semibold text-text-primary">Package imported</h1>
        <p className="text-text-secondary text-sm">
          {stlParts.length} printable {stlParts.length === 1 ? "file" : "files"} saved to your library.
        </p>
        <button
          onClick={() => navigate("/library")}
          className="rounded-xl bg-bg-card border border-border px-6 py-3 text-sm font-semibold text-text-primary hover:border-white/15 transition-all"
        >
          Go to Library
        </button>
      </div>
    );
  }

  const anyGenerating = stlParts.some((p) => p.generating);
  const allPreviewsDone = stlParts.length > 0 && stlParts.every((p) => !p.generating);

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 flex flex-col gap-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors self-start"
        >
          <ArrowLeft size={13} /> Back
        </button>
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Import from MakerWorld</h1>
          <p className="text-text-secondary text-sm mt-2 leading-relaxed">
            Paste a MakerWorld model page URL. The browser extension will extract metadata and acquire the package files.
          </p>
        </div>
      </div>

      {/* ── Extension warning ───────────────────────────────────────────────── */}
      {!extensionAvailable && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-5 py-4">
          <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-300">Extension not detected</p>
            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
              Load the <span className="font-mono text-text-primary">extension/</span> folder as an unpacked Chrome extension,
              then set <span className="font-mono text-text-primary">VITE_EXTENSION_ID</span> in{" "}
              <span className="font-mono text-text-primary">.env.local</span> and restart the dev server.
            </p>
          </div>
        </div>
      )}

      {/* ── URL input ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3">
        <label className="text-xs font-semibold text-text-secondary uppercase tracking-widest">
          MakerWorld model URL
        </label>
        <div className="flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && phase === "idle" && handleExtract()}
            placeholder="https://makerworld.com/en/models/..."
            disabled={phase !== "idle" && phase !== "metadata"}
            className="flex-1 rounded-xl bg-bg-card border border-border px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-white/20 disabled:opacity-50"
          />
          <button
            onClick={handleExtract}
            disabled={!url.trim() || (phase !== "idle" && phase !== "metadata")}
            className="rounded-xl bg-bg-card border border-border px-5 py-3 text-sm font-semibold text-text-primary hover:border-white/15 hover:bg-bg-card-hover transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {phase === "loading" ? (
              <><Loader2 size={15} className="animate-spin" /> Loading…</>
            ) : (
              "Load Details"
            )}
          </button>
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 px-5 py-4">
          <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-red-300 leading-relaxed">{error}</p>
        </div>
      )}

      {/* ── Metadata card ──────────────────────────────────────────────────── */}
      {metadata && (phase === "metadata" || phase === "acquiring" || phase === "importing" || phase === "reviewing" || phase === "saving") && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="text-green-400" />
            <span className="text-sm font-medium text-green-300">Metadata extracted</span>
          </div>

          <div className="rounded-2xl bg-bg-card border border-border overflow-hidden">
            {(metadata.coverLandscape ?? metadata.coverUrl) && (
              <img
                src={(metadata.coverLandscape ?? metadata.coverUrl)!}
                alt="Model cover"
                className="w-full h-52 object-cover"
              />
            )}
            <div className="px-6 py-5 flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-semibold text-text-primary leading-tight">
                  {metadata.title ?? "Untitled"}
                </h2>
                {typeof metadata.designExtension === "string" && metadata.designExtension && (
                  <span className="text-xs font-mono font-bold text-text-secondary bg-bg-secondary border border-border px-2 py-0.5 rounded self-start">
                    .{metadata.designExtension.toUpperCase()}
                  </span>
                )}
              </div>

              {metadata.summary && (
                <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
                  {stripHtml(metadata.summary)}
                </p>
              )}

              {metadata.instances.length > 1 && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Versions</p>
                  <p className="text-xs text-text-secondary">
                    This model has {metadata.instances.length} versions. Select one to import.
                  </p>
                  <div className="flex flex-col gap-1">
                    {metadata.instances.map((inst, i) => {
                      const isDefault = inst.id === metadata.defaultInstanceId;
                      const isSelected = inst.id === selectedInstanceId;
                      return (
                        <div
                          key={i}
                          onClick={() => setSelectedInstanceId(inst.id)}
                          className={`cursor-pointer rounded-lg border px-4 py-3 flex flex-col gap-1.5 transition-all ${
                            isSelected
                              ? "bg-accent/5 border-accent/40 ring-1 ring-accent/20"
                              : "bg-bg-secondary border-border hover:border-accent/20"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`shrink-0 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${isSelected ? "border-accent" : "border-border"}`}>
                              {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-accent" />}
                            </div>
                            <span className="text-sm font-medium text-text-primary">{inst.name ?? `Version ${i + 1}`}</span>
                            {isDefault && (
                              <span className="text-xs text-accent border border-accent/40 rounded px-1.5 py-0.5">
                                Recommended
                              </span>
                            )}
                          </div>
                          {inst.designFiles.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 pl-5">
                              {inst.designFiles.map((f, fi) => (
                                <span key={fi} className="text-xs font-mono text-text-secondary bg-bg-card border border-border px-1.5 py-0.5 rounded uppercase">
                                  {f.type ?? "file"}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Import button */}
              {(phase === "metadata" || phase === "acquiring") && (
                <button
                  onClick={handleAcquire}
                  disabled={phase === "acquiring" || !extensionAvailable}
                  className="mt-1 flex items-center gap-2 self-start rounded-xl bg-bg-secondary border border-border px-5 py-3 text-sm font-semibold text-text-primary hover:border-white/15 hover:bg-bg-card-hover transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {phase === "acquiring" ? (
                    <><Loader2 size={15} className="animate-spin" /> Acquiring files…</>
                  ) : (
                    <><Download size={15} /> Import package</>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Importing progress ─────────────────────────────────────────────── */}
      {phase === "importing" && (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 size={24} className="animate-spin text-text-secondary" />
          <p className="text-text-secondary text-sm">
            Downloading package and generating previews…
          </p>
          {stlParts.length > 0 && (
            <p className="text-text-secondary text-xs">
              {stlParts.filter((p) => p.previewBlob !== null).length} / {stlParts.length} previews ready
            </p>
          )}
        </div>
      )}

      {/* ── Review section ─────────────────────────────────────────────────── */}
      {(phase === "reviewing" || phase === "saving") && session && (
        <div ref={reviewSectionRef} className="flex flex-col gap-10 pt-2">
          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={handleResetReview}
                className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
              >
                <ArrowLeft size={13} /> Back
              </button>
              <button
                onClick={handleResetReview}
                className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 px-3 py-1.5 rounded-lg transition-colors"
              >
                <RotateCcw size={12} /> Redo extraction
              </button>
            </div>
            <h2 className="text-xl font-semibold text-text-primary tracking-tight">Review Package</h2>
            <p className="text-text-secondary text-sm mt-1">
              All original files have been preserved. Review before saving to your library.
            </p>
          </div>

          {/* ── A. Printable STL files ─────────────────────────────────────── */}
          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <FileBox size={15} className="text-text-secondary" />
              <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">
                Printable files — {stlParts.length} STL{stlParts.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {stlParts.map((part, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-bg-card border border-border overflow-hidden flex flex-col"
                >
                  {/* Preview image */}
                  <div className="aspect-square bg-bg-secondary flex items-center justify-center relative">
                    {part.generating ? (
                      <Loader2 size={20} className="animate-spin text-text-secondary opacity-50" />
                    ) : part.previewUrl ? (
                      <>
                        <img
                          src={part.previewUrl}
                          alt={part.file.name}
                          className="w-full h-full object-cover cursor-zoom-in"
                          onClick={() => setStlLightbox({ url: part.previewUrl!, name: part.file.name })}
                        />
                        {part.stlObjectUrl && (
                          <button
                            className="absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/65 text-white text-xs font-semibold backdrop-blur-sm hover:bg-black/80 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setStl3dPreview({ url: part.stlObjectUrl!, name: part.file.name });
                            }}
                          >
                            <Box size={12} /> 3D
                          </button>
                        )}
                      </>
                    ) : (
                      <FileBox size={28} className="text-text-secondary opacity-30" />
                    )}
                    <button
                      className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/65 text-white backdrop-blur-sm hover:bg-red-600/80 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (part.previewUrl) URL.revokeObjectURL(part.previewUrl);
                        if (part.stlObjectUrl) URL.revokeObjectURL(part.stlObjectUrl);
                        setStlParts((prev) => prev.filter((_, idx) => idx !== i));
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {/* Info */}
                  <div className="px-4 py-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary font-mono truncate flex-1" title={part.file.name}>
                        {part.file.name}
                      </p>
                      {session && (
                        <button onClick={() => handleDownload(part.file)} className="text-text-secondary hover:text-text-primary transition-colors shrink-0">
                          <Download size={14} />
                        </button>
                      )}
                    </div>
                    {part.info ? (
                      <div className="flex flex-wrap gap-x-3 gap-y-1 items-center">
                        <span className="text-xs text-text-secondary">
                          {part.info.width.toFixed(1)} × {part.info.height.toFixed(1)} × {part.info.depth.toFixed(1)} mm
                        </span>
                        <span className="text-xs text-text-secondary">
                          {part.info.triangleCount.toLocaleString()} △
                        </span>
                        {part.fileSize != null && (
                          <span className="text-xs text-text-secondary">{formatBytes(part.fileSize)}</span>
                        )}
                        <span className="text-xs text-text-secondary">Original (imported STL)</span>
                      </div>
                    ) : part.generating ? (
                      <span className="text-xs text-text-secondary">Generating preview…</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <span className="text-xs text-text-secondary opacity-50">Preview unavailable</span>
                        {part.fileSize != null && <span className="text-xs text-text-secondary">{formatBytes(part.fileSize)}</span>}
                        <span className="text-xs text-text-secondary">Original (imported STL)</span>
                      </div>
                    )}
                    <div className="text-xs text-text-secondary/70 mt-1">Generated preview is visual only; the original STL file is preserved.</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── B. Source images ───────────────────────────────────────────── */}
          {sourceImageUrls.length > 0 && (
            <section className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <ImageIcon size={15} className="text-text-secondary" />
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">
                  Source images — {sourceImageUrls.length}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {sourceImageUrls.map((src, i) => (
                  <div
                    key={i}
                    className="relative rounded-xl overflow-hidden bg-bg-secondary border border-border group"
                  >
                    <img
                      src={src}
                      alt={`Source image ${i + 1}`}
                      className="w-full h-auto block"
                    />
                    <button
                      className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-black/65 text-white backdrop-blur-sm hover:bg-red-600/80 transition-colors opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        URL.revokeObjectURL(src);
                        setSourceImageUrls((prev) => prev.filter((_, idx) => idx !== i));
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── C. Additional files ────────────────────────────────────────── */}
          {(() => {
            const additionalFiles = otherFiles.filter(f => f.role !== "archive");
            const zipFile = otherFiles.find(f => f.role === "archive") ?? null;
            return (
              <>
                {additionalFiles.length > 0 && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Files size={15} className="text-text-secondary" />
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">
                        Additional files — {additionalFiles.length}
                      </p>
                    </div>
                    <div className="rounded-xl bg-bg-card border border-border divide-y divide-border">
                      {additionalFiles.map((f, i) => (
                        <div key={i} className="flex items-center gap-3 px-4 py-3">
                          <span className="text-xs font-semibold text-text-secondary bg-bg-secondary border border-border px-1.5 py-0.5 rounded shrink-0">
                            {roleLabel(f.role)}
                          </span>
                          <span className="text-sm text-text-primary font-mono truncate flex-1">{f.name}</span>
                          {session && (
                            <button onClick={() => handleDownload(f)} className="text-text-secondary hover:text-text-primary transition-colors shrink-0">
                              <Download size={14} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* ── D. Original package (ZIP) ───────────────────────────────── */}
                {zipFile && (
                  <section className="flex flex-col gap-3">
                    <div className="flex items-center gap-2">
                      <Archive size={15} className="text-text-secondary" />
                      <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">
                        Original package — ZIP
                      </p>
                    </div>
                    <div className="rounded-xl bg-bg-card border border-border">
                      <div className="flex items-center gap-3 px-4 py-3">
                        <span className="text-xs font-semibold text-text-secondary bg-bg-secondary border border-border px-1.5 py-0.5 rounded shrink-0">
                          Source archive
                        </span>
                        <span className="text-sm text-text-primary font-mono truncate flex-1">{zipFile.name}</span>
                        {session && (
                          <button onClick={() => handleDownload(zipFile)} className="text-text-secondary hover:text-text-primary transition-colors shrink-0">
                            <Download size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </>
            );
          })()}

          {/* ── Save form ─────────────────────────────────────────────────── */}
          <form onSubmit={handleSave} className="flex flex-col gap-5 border-t border-border pt-6">
            <h3 className="text-base font-semibold text-text-primary">Save to Library</h3>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                required
                className="rounded-xl bg-bg-card border border-border px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-white/20"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Description</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="rounded-xl bg-bg-card border border-border px-4 py-3 text-sm text-text-primary placeholder:text-text-secondary focus:outline-none focus:border-white/20 resize-none"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Category</label>
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-bg-card border border-border">
                <span className="text-sm text-text-primary">{form.category}</span>
                {!form.categoryMapped && (
                  <span className="text-xs text-text-secondary">(no category from MakerWorld)</span>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={phase === "saving" || anyGenerating || stlParts.length === 0}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent text-white font-semibold px-6 py-3 text-sm hover:bg-accent-hover transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {phase === "saving" ? (
                <><Loader2 size={15} className="animate-spin" /> Saving…</>
              ) : anyGenerating ? (
                <><Loader2 size={15} className="animate-spin" /> Generating previews…</>
              ) : !allPreviewsDone ? (
                "Save to Library"
              ) : (
                "Save to Library"
              )}
            </button>
          </form>
        </div>
      )}

      {stl3dPreview && (
        <STLPreviewModal
          fileUrl={stl3dPreview.url}
          fileName={stl3dPreview.name}
          onClose={() => setStl3dPreview(null)}
        />
      )}

      {stlLightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
          onClick={() => setStlLightbox(null)}
        >
          <button
            className="absolute top-4 right-4 p-2 rounded-lg bg-bg-secondary/80 text-text-secondary hover:text-text-primary transition-colors"
            onClick={() => setStlLightbox(null)}
          >
            <X size={20} />
          </button>
          <div
            className="relative max-w-2xl w-full mx-4 flex flex-col items-center gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={stlLightbox.url}
              alt={stlLightbox.name}
              className="w-full rounded-xl object-contain bg-bg-secondary"
            />
            <p className="text-xs text-text-secondary font-mono">{stlLightbox.name}</p>
          </div>
        </div>
      )}
    </div>
  );
}
