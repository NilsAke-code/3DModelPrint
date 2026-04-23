import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { fetchModel, likeModel, fetchModelFiles, downloadModelFile, getModelFileUrl, getImageUrl, getThumbnailUrl } from "../services/api";
import { loginRequest } from "../auth/authConfig";
import type { Model3D, ModelFileEntry } from "../types";
import { Download, Heart, FileType, Calendar, LogIn, Box, ChevronLeft, ChevronRight, ArrowLeft, X, ZoomIn, File } from "lucide-react";
import ModelViewer from "../components/ModelViewer";

export default function ModelDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [model, setModel] = useState<Model3D | null>(null);
  const [loading, setLoading] = useState(true);
  const [modelFiles, setModelFiles] = useState<ModelFileEntry[]>([]);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"gallery" | "3d">("gallery");
  const [lightboxOpen, setLightboxOpen] = useState(false);
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
    if (!lightboxOpen) return;
    if (e.key === "Escape") {
      setLightboxOpen(false);
      document.body.style.overflow = "";
    }
    if (e.key === "ArrowLeft") setSelectedImageIndex((i) => (i > 0 ? i - 1 : galleryImageCount - 1));
    if (e.key === "ArrowRight") setSelectedImageIndex((i) => (i < galleryImageCount - 1 ? i + 1 : 0));
  }, [lightboxOpen, galleryImageCount]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  async function handleLike() {
    if (!model) return;
    await likeModel(model.id);
    setModel({ ...model, likes: model.likes + 1 });
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

  if (loading) return <div className="text-text-secondary text-center py-12">Loading...</div>;
  if (!model) return <div className="text-text-secondary text-center py-12">Model not found.</div>;

  const sourceImages = (model.images ?? []).filter(img => img.imageType === "source");
  const stlPreviews  = (model.images ?? []).filter(img => img.imageType === "stl-preview");
  const images = [...sourceImages, ...stlPreviews];
  const hasImages = images.length > 0;
  const hasStlFile = !!getModelFileUrl(model);
  const fallbackThumbnail = getThumbnailUrl(model);

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
      <button
        onClick={() => { try { navigate(-1); } catch { navigate("/"); } }}
        className="flex items-center gap-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors mb-4"
      >
        <ArrowLeft size={14} /> Back
      </button>
      <div className="mb-4">
        {viewMode === "gallery" ? (
          <div>
            <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden border border-border bg-bg-secondary">
              {hasImages ? (
                <>
                  <button
                    onClick={() => openLightbox(selectedImageIndex)}
                    className="w-full h-full cursor-zoom-in group/zoom"
                  >
                    <img
                      src={getImageUrl(images[selectedImageIndex].imagePath)}
                      alt={`${model.title} - image ${selectedImageIndex + 1}`}
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute top-3 right-3 p-1.5 rounded-lg bg-bg-secondary/60 backdrop-blur-sm text-text-secondary opacity-0 group-hover/zoom:opacity-100 transition-opacity">
                      <ZoomIn size={16} />
                    </div>
                  </button>
                  {images.length > 1 && (
                    <>
                      <button
                        onClick={(e) => { e.stopPropagation(); prevImage(); }}
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-bg-secondary/60 backdrop-blur-sm text-text-primary flex items-center justify-center hover:bg-bg-secondary/80 transition-colors"
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); nextImage(); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-bg-secondary/60 backdrop-blur-sm text-text-primary flex items-center justify-center hover:bg-bg-secondary/80 transition-colors"
                      >
                        <ChevronRight size={20} />
                      </button>
                      <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-lg bg-bg-secondary/60 backdrop-blur-sm text-text-primary text-xs font-medium">
                        {selectedImageIndex + 1} / {images.length}
                      </div>
                    </>
                  )}
                </>
              ) : fallbackThumbnail ? (
                <img src={fallbackThumbnail} alt={model.title} className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-text-secondary">
                  No images available
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-3">
              {images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
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
              {hasStlFile && (
                <button
                  onClick={() => setViewMode("3d")}
                  className="flex-shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-lg bg-accent text-bg-primary font-semibold text-sm hover:bg-accent-hover transition-colors ml-auto"
                >
                  <Box size={16} /> 3D Preview
                </button>
              )}
            </div>
          </div>
        ) : (
          <div>
            <ModelViewer fileUrl={getModelFileUrl(model)} thumbnailUrl={fallbackThumbnail} />
            <div className="mt-3">
              <button
                onClick={() => setViewMode("gallery")}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors text-sm"
              >
                <ChevronLeft size={16} /> Back to Gallery
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{model.title}</h1>
          <p className="text-text-secondary text-sm mt-1">by {model.authorName}</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={handleLike}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-text-secondary hover:text-accent hover:border-accent/40 transition-colors"
          >
            <Heart size={16} /> {model.likes.toLocaleString()}
          </button>
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
        <span className="flex items-center gap-1.5"><Download size={14} /> {model.downloads.toLocaleString()} downloads</span>
        <span className="flex items-center gap-1.5"><Heart size={14} /> {model.likes.toLocaleString()} likes</span>
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
              </div>
            ))}
          </div>
        </div>
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
    </div>
  );
}
