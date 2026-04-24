import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { fetchModel, toggleFavorite, fetchModelFiles, downloadModelFile, deleteModel, getImageUrl, getThumbnailUrl } from "../services/api";
import { loginRequest } from "../auth/authConfig";
import type { Model3D, ModelFileEntry, ModelPart } from "../types";
import { Download, FileType, Calendar, LogIn, Box, ChevronLeft, ChevronRight, ArrowLeft, X, ZoomIn, File, Trash2, Loader2, Star } from "lucide-react";
import STLPreviewModal from "../components/STLPreviewModal";

export default function ModelDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [model, setModel] = useState<Model3D | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelFiles, setModelFiles] = useState<ModelFileEntry[]>([]);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [stl3dPreview, setStl3dPreview] = useState<{ url: string; name: string } | null>(null);
  const [loadingPartUrl, setLoadingPartUrl] = useState<number | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);
  const isAuthenticated = useIsAuthenticated();
  const { instance } = useMsal();

  useEffect(() => {
    if (id) {
      fetchModel(Number(id))
        .then((m) => {
          setModel(m);
          if (isAuthenticated) {
            fetchModelFiles(Number(id)).then(setModelFiles).catch(() => {});
          }
        })
        .catch(() => setModel(null))
        .finally(() => setLoading(false));
    }
  }, [id, isAuthenticated]);

  const galleryImageCount = (model?.images ?? []).filter(img => img.imageType === "source" || img.imageType === "stl-preview").length;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (deleteConfirm) {
      if (e.key === "Escape") setDeleteConfirm(false);
      return;
    }
    if (!lightboxOpen) return;
    if (e.key === "Escape") {
      setLightboxOpen(false);
      document.body.style.overflow = "";
    }
    if (e.key === "ArrowLeft") setSelectedImageIndex((i) => (i > 0 ? i - 1 : galleryImageCount - 1));
    if (e.key === "ArrowRight") setSelectedImageIndex((i) => (i < galleryImageCount - 1 ? i + 1 : 0));
  }, [lightboxOpen, galleryImageCount, deleteConfirm]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  async function openPartPreview(part: ModelPart) {
    if (!model) return;
    setLoadingPartUrl(part.id);
    try {
      const blob = await downloadModelFile(model.id, part.filePath);
      const objectUrl = URL.createObjectURL(blob);
      setStl3dPreview({ url: objectUrl, name: part.fileName });
    } catch {
      // silently ignore
    } finally {
      setLoadingPartUrl(null);
    }
  }

  function closePartPreview() {
    if (stl3dPreview) URL.revokeObjectURL(stl3dPreview.url);
    setStl3dPreview(null);
  }

  async function handleFavorite() {
    if (!model || favoriteLoading) return;
    setFavoriteLoading(true);
    try {
      const isFavorite = await toggleFavorite(model.id);
      setModel({ ...model, isFavorite });
    } catch (err) {
      console.error("Failed to toggle favorite:", err);
    } finally {
      setFavoriteLoading(false);
    }
  }

  async function handleLogin() {
    try { await instance.loginRedirect(loginRequest); }
    catch (err) { console.error("Login failed:", err); }
  }

  async function handleFileDownload(file: ModelFileEntry) {
    if (!model || downloadingPath) return;
    setDownloadingPath(file.path);
    try {
      const blob = await downloadModelFile(model.id, file.path);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloadingPath(null);
    }
  }

  async function handleDelete() {
    if (!model) return;
    setDeleting(true);
    try {
      await deleteModel(model.id);
      navigate("/library");
    } catch (err) {
      console.error("Delete failed:", err);
      setDeleting(false);
      setDeleteConfirm(false);
    }
  }

  if (loading) return <div className="text-text-secondary text-center py-12">Loading...</div>;
  if (!model) return <div className="text-text-secondary text-center py-12">Model not found.</div>;

  const sourceImages = (model.images ?? []).filter(img => img.imageType === "source");
  const stlPreviews  = (model.images ?? []).filter(img => img.imageType === "stl-preview").sort((a, b) => a.sortOrder - b.sortOrder);
  const images = [...sourceImages, ...stlPreviews];
  const sortedParts = [...(model.parts ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const hasImages = images.length > 0;
  const fallbackThumbnail = getThumbnailUrl(model);

  const currentImage = hasImages ? images[selectedImageIndex] : null;
  const currentIsStl = currentImage?.imageType === "stl-preview";
  const currentStlIdx = currentImage ? stlPreviews.indexOf(currentImage) : -1;
  const currentPart = currentStlIdx >= 0 ? sortedParts[currentStlIdx] : undefined;

  function prevImage() { setSelectedImageIndex((i) => (i > 0 ? i - 1 : images.length - 1)); }
  function nextImage() { setSelectedImageIndex((i) => (i < images.length - 1 ? i + 1 : 0)); }

  function openLightbox(index: number) {
    setSelectedImageIndex(index);
    setLightboxOpen(true);
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    setLightboxOpen(false);
    document.body.style.overflow = "";
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Top nav row */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => { try { navigate(-1); } catch { navigate("/"); } }}
          className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
        >
          <ArrowLeft size={14} /> Back
        </button>
        {isAuthenticated && (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 border border-red-500/30 hover:border-red-400/50 px-3 py-1.5 rounded-lg transition-colors"
          >
            <Trash2 size={13} /> Delete model
          </button>
        )}
      </div>

      {/* Gallery */}
      <div className="mb-4">
        <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden border border-border bg-black">
          {hasImages ? (
            <>
              {/* 3D preview button — only when current image is an STL preview */}
              {currentIsStl && currentPart && (
                <button
                  className="absolute top-3 left-3 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/65 text-white text-xs font-semibold backdrop-blur-sm hover:bg-black/80 transition-colors"
                  onClick={() => openPartPreview(currentPart)}
                >
                  {loadingPartUrl === currentPart.id
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Box size={13} />
                  }
                  {loadingPartUrl !== currentPart.id && "3D Preview"}
                </button>
              )}

              <button
                onClick={() => openLightbox(selectedImageIndex)}
                className="w-full h-full cursor-zoom-in group/zoom"
              >
                <img
                  src={getImageUrl(images[selectedImageIndex].imagePath)}
                  alt={`${model.title} - image ${selectedImageIndex + 1}`}
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/40 backdrop-blur-sm text-white/70 opacity-0 group-hover/zoom:opacity-100 transition-opacity">
                  <ZoomIn size={16} />
                </div>
              </button>

              {images.length > 1 && (
                <>
                  <button
                    onClick={(e) => { e.stopPropagation(); prevImage(); }}
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/60 transition-colors"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); nextImage(); }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/60 transition-colors"
                  >
                    <ChevronRight size={20} />
                  </button>
                  <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-lg bg-black/40 backdrop-blur-sm text-white text-xs font-medium">
                    {selectedImageIndex + 1} / {images.length}
                  </div>
                </>
              )}
            </>
          ) : fallbackThumbnail ? (
            <img src={fallbackThumbnail} alt={model.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-text-secondary">
              No images available
            </div>
          )}
        </div>

        {/* Thumbnail strip — no 3D badges */}
        {images.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1 mt-3">
            {images.map((img, i) => (
              <button
                key={img.id}
                onClick={() => setSelectedImageIndex(i)}
                className={`flex-shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-all ${
                  i === selectedImageIndex
                    ? "border-accent ring-1 ring-accent/30"
                    : "border-border hover:border-accent/40"
                }`}
              >
                <img src={getImageUrl(img.imagePath)} alt={`Thumbnail ${i + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{model.title}</h1>
          <p className="text-text-secondary text-sm mt-1">by {model.authorName}</p>
        </div>
        <div className="flex gap-3">
          {isAuthenticated && (
            <button
              onClick={handleFavorite}
              disabled={favoriteLoading}
              title={model.isFavorite ? "Remove from favorites" : "Add to favorites"}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-colors disabled:opacity-50 ${
                model.isFavorite
                  ? "border-yellow-500/50 text-yellow-400 hover:border-yellow-500/30 hover:text-yellow-300"
                  : "border-border text-text-secondary hover:text-yellow-400 hover:border-yellow-500/40"
              }`}
            >
              {favoriteLoading
                ? <Loader2 size={16} className="animate-spin" />
                : <Star size={16} fill={model.isFavorite ? "currentColor" : "none"} />
              }
            </button>
          )}
          {!isAuthenticated && (
            <button
              onClick={handleLogin}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-accent text-bg-primary font-semibold text-sm hover:bg-accent-hover transition-colors"
            >
              <LogIn size={16} /> Sign in to download
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-text-secondary mb-6">
        {model.category && <span className="flex items-center gap-1.5"><FileType size={14} /> {model.category}</span>}
        <span className="flex items-center gap-1.5"><Calendar size={14} /> {new Date(model.createdAt).toLocaleDateString()}</span>
      </div>

      {model.tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {model.tags.map((tag) => (
            <span key={tag} className="px-3 py-1 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/20">
              {tag}
            </span>
          ))}
        </div>
      )}

      {model.description && (
        <div className="bg-bg-card rounded-xl border border-border p-6 mb-6">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Description</h2>
          <p className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">{model.description}</p>
        </div>
      )}

      {isAuthenticated && modelFiles.length > 0 && (
        <div className="bg-bg-card rounded-xl border border-border p-6 mb-6">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">Files</h2>
          <div className="flex flex-col gap-2">
            {[
              ...modelFiles.filter(f => f.role === "stl" || f.role === "obj" || f.role === "glb" || f.role === "gltf"),
              ...modelFiles.filter(f => f.role === "mtl" || f.role === "other"),
              ...modelFiles.filter(f => f.role === "archive"),
            ].map((file) => (
              <div
                key={file.path}
                className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-bg-elevated border border-border hover:border-accent/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <File size={16} className="flex-shrink-0 text-text-secondary" />
                  <span className="text-text-primary text-sm font-mono truncate">
                    {file.role === "archive" ? `Original package (${file.fileName})` : file.fileName}
                  </span>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-xs font-medium uppercase tracking-wider px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                    {file.role === "archive" ? "ZIP" : file.role.toUpperCase()}
                  </span>
                  {file.sizeBytes != null && (
                    <span className="text-xs text-text-secondary">
                      {file.sizeBytes < 1024 * 1024
                        ? `${(file.sizeBytes / 1024).toFixed(0)} KB`
                        : `${(file.sizeBytes / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                  )}
                  <button
                    onClick={() => handleFileDownload(file)}
                    disabled={downloadingPath === file.path}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-bg-primary text-xs font-semibold hover:bg-accent-hover transition-colors disabled:opacity-50"
                  >
                    <Download size={13} />
                    {downloadingPath === file.path ? "…" : "Download"}
                  </button>
                </div>
                {/* STL inspection info (if available) */}
                {(() => {
                  if (file.role !== 'stl') return null;
                  const mp = sortedParts.find(p => p.fileName === file.fileName || file.path.includes(p.fileName));
                  if (!mp) return null;
                  return (
                    <div className="mt-2 text-xs text-text-secondary">
                      <div>Dimensions: {mp.width.toFixed(1)} × {mp.height.toFixed(1)} × {mp.depth.toFixed(1)} mm</div>
                      <div>Triangles: {mp.triangleCount.toLocaleString()}</div>
                      <div className="mt-1 text-xs text-text-secondary/80">Original imported STL — preview images are visual renders only.</div>
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      {stl3dPreview && (
        <STLPreviewModal
          fileUrl={stl3dPreview.url}
          fileName={stl3dPreview.name}
          onClose={closePartPreview}
        />
      )}

      {/* Lightbox */}
      {lightboxOpen && hasImages && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={closeLightbox}
        >
          <button
            onClick={closeLightbox}
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
          >
            <X size={20} />
          </button>
          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); prevImage(); }}
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
              >
                <ChevronLeft size={22} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); nextImage(); }}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
              >
                <ChevronRight size={22} />
              </button>
              <div className="absolute bottom-4 right-4 px-3 py-1.5 rounded-lg bg-white/10 text-white text-xs font-medium">
                {selectedImageIndex + 1} / {images.length}
              </div>
            </>
          )}
          <img
            src={getImageUrl(images[selectedImageIndex].imagePath)}
            alt={`${model.title} - image ${selectedImageIndex + 1}`}
            className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !deleting && setDeleteConfirm(false)}
        >
          <div
            className="bg-bg-card border border-border rounded-2xl p-8 max-w-sm w-full mx-4 flex flex-col gap-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-red-400">
                <Trash2 size={18} />
                <h2 className="text-base font-semibold">Delete this model?</h2>
              </div>
              <p className="text-text-secondary text-sm leading-relaxed">
                This action cannot be undone. The model and all its files will be permanently deleted.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(false)}
                disabled={deleting}
                className="flex-1 px-4 py-2.5 rounded-xl border border-border text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors text-sm font-medium disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 transition-colors disabled:opacity-50"
              >
                {deleting ? <><Loader2 size={14} className="animate-spin" /> Deleting…</> : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
