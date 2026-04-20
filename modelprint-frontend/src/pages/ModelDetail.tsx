import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { fetchModel, likeModel, downloadModel, getModelFileUrl, getImageUrl, getThumbnailUrl } from "../services/api";
import { loginRequest } from "../auth/authConfig";
import type { Model3D } from "../types";
import { Download, Heart, FileType, Calendar, LogIn, Box, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import ModelViewer from "../components/ModelViewer";

export default function ModelDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [model, setModel] = useState<Model3D | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"gallery" | "3d">("gallery");
  const isAuthenticated = useIsAuthenticated();
  const { instance } = useMsal();

  useEffect(() => {
    if (id) {
      fetchModel(Number(id))
        .then((m) => {
          setModel(m);
        })
        .catch(() => setModel(null))
        .finally(() => setLoading(false));
    }
  }, [id]);

  async function handleLike() {
    if (!model) return;
    await likeModel(model.id);
    setModel({ ...model, likes: model.likes + 1 });
  }

  async function handleLogin() {
    try { await instance.loginRedirect(loginRequest); }
    catch (err) { console.error("Login failed:", err); }
  }

  async function handleDownload() {
    if (!model) return;
    setDownloading(true);
    try {
      const blob = await downloadModel(model.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = model.filePath ? model.filePath.split("/").pop() ?? "model" : "model";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setModel({ ...model, downloads: model.downloads + 1 });
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(false);
    }
  }

  if (loading) return <div className="text-text-secondary text-center py-12">Loading...</div>;
  if (!model) return <div className="text-text-secondary text-center py-12">Model not found.</div>;

  const images = model.images ?? [];
  const hasImages = images.length > 0;
  const hasStlFile = !!getModelFileUrl(model);
  const fallbackThumbnail = getThumbnailUrl(model);

  function prevImage() { setSelectedImageIndex((i) => (i > 0 ? i - 1 : images.length - 1)); }
  function nextImage() { setSelectedImageIndex((i) => (i < images.length - 1 ? i + 1 : 0)); }

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
            <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden border border-border bg-bg-card">
              {hasImages ? (
                <>
                  <img
                    src={getImageUrl(images[selectedImageIndex].imagePath)}
                    alt={`${model.title} - image ${selectedImageIndex + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {images.length > 1 && (
                    <>
                      <button
                        onClick={prevImage}
                        className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-bg-secondary/60 backdrop-blur-sm text-text-primary flex items-center justify-center hover:bg-bg-secondary/80 transition-colors"
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <button
                        onClick={nextImage}
                        className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-bg-secondary/60 backdrop-blur-sm text-text-primary flex items-center justify-center hover:bg-bg-secondary/80 transition-colors"
                      >
                        <ChevronRight size={20} />
                      </button>
                      <div className="absolute bottom-3 right-3 px-2.5 py-1 rounded-lg bg-bg-secondary/60 backdrop-blur-sm text-text-primary text-xs font-medium">
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
          {isAuthenticated ? (
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-accent text-bg-primary font-semibold text-sm hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              <Download size={16} /> {downloading ? "Downloading..." : "Download"}
            </button>
          ) : (
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
        <div className="bg-bg-card rounded-xl border border-border p-6">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">Description</h2>
          <p className="text-text-primary text-sm leading-relaxed whitespace-pre-wrap">{model.description}</p>
        </div>
      )}
    </div>
  );
}
