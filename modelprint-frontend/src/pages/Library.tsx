import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useIsAuthenticated, useMsal } from "@azure/msal-react";
import { fetchModels, deleteModel, getThumbnailUrl } from "../services/api";
import { loginRequest } from "../auth/authConfig";
import type { Model3D } from "../types";
import { Trash2, LogIn, FolderOpen, Upload, Box, Star } from "lucide-react";

export default function Library() {
  const [models, setModels] = useState<Model3D[]>([]);
  const [loading, setLoading] = useState(true);
  const isAuthenticated = useIsAuthenticated();
  const { instance, accounts } = useMsal();

  useEffect(() => {
    if (isAuthenticated) {
      loadModels();
    } else {
      setLoading(false);
    }
  }, [isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadModels() {
    setLoading(true);
    const all = await fetchModels();
    const userId = accounts[0]?.localAccountId ?? accounts[0]?.homeAccountId ?? "";
    setModels(all.filter((m) => m.authorId === userId || !m.isExploreModel));
    setLoading(false);
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this model? This cannot be undone.")) return;
    await deleteModel(id);
    setModels(models.filter((m) => m.id !== id));
  }

  async function handleLogin() {
    try { await instance.loginRedirect(loginRequest); }
    catch (err) { console.error("Login failed:", err); }
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-5">
        <div className="w-14 h-14 rounded-2xl bg-bg-card border border-border flex items-center justify-center">
          <FolderOpen size={24} className="text-text-secondary" />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold text-text-primary">My Library</h1>
          <p className="text-text-secondary text-sm mt-1.5">
            Sign in to access your uploaded models.
          </p>
        </div>
        <button
          onClick={handleLogin}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-bg-primary font-semibold text-sm hover:bg-accent-hover transition-colors"
        >
          <LogIn size={16} /> Sign in with Microsoft
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">My Library</h1>
          {!loading && (
            <p className="text-xs text-text-secondary mt-1">
              {models.length === 0 ? "No models yet" : `${models.length} model${models.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </div>
        <Link
          to="/import"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-bg-primary font-semibold text-sm hover:bg-accent-hover transition-colors"
        >
          <Upload size={15} /> Import Model
        </Link>
      </div>

      {/* Loading skeleton */}
      {loading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-xl bg-bg-card border border-border animate-pulse">
              <div className="aspect-[4/3] bg-bg-secondary rounded-t-xl" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-bg-secondary rounded w-3/4" />
                <div className="h-2.5 bg-bg-secondary rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : models.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center py-28 gap-5 border border-dashed border-border rounded-2xl">
          <div className="w-16 h-16 rounded-2xl bg-bg-card border border-border flex items-center justify-center">
            <Box size={28} className="text-text-secondary opacity-50" />
          </div>
          <div className="text-center">
            <p className="text-text-primary font-medium">No models yet</p>
            <p className="text-text-secondary text-sm mt-1">Import your first 3D model to get started.</p>
          </div>
          <Link
            to="/import"
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-bg-primary font-semibold text-sm hover:bg-accent-hover transition-colors"
          >
            <Upload size={15} /> Import a model
          </Link>
        </div>
      ) : (
        /* Model grid */
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {models.map((model) => (
            <LibraryCard key={model.id} model={model} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function LibraryCard({ model, onDelete }: { model: Model3D; onDelete: (id: number) => void }) {
  const thumbnailUrl = getThumbnailUrl(model);
  const [showDelete, setShowDelete] = useState(false);

  return (
    <div
      className="group relative rounded-xl bg-bg-card border border-border overflow-hidden hover:border-white/10 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/40 transition-all duration-200"
      onMouseEnter={() => setShowDelete(true)}
      onMouseLeave={() => setShowDelete(false)}
    >
      <Link to={`/model/${model.id}`} className="block">
        {/* Thumbnail */}
        <div className="aspect-[4/3] overflow-hidden bg-bg-secondary">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt={model.title}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Box size={24} className="text-text-secondary opacity-20" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-3">
          <h3 className="text-sm font-semibold text-text-primary truncate leading-tight">
            {model.title}
          </h3>
          {model.isFavorite && (
            <div className="mt-1.5">
              <Star size={11} className="text-yellow-400" fill="currentColor" />
            </div>
          )}
        </div>
      </Link>

      {/* Delete button — appears on hover */}
      <button
        onClick={() => onDelete(model.id)}
        className={`absolute top-2 right-2 p-1.5 rounded-lg bg-bg-secondary/80 backdrop-blur-sm text-text-secondary hover:text-red-400 hover:bg-bg-secondary/80 transition-all duration-150 ${
          showDelete ? "opacity-100" : "opacity-0"
        }`}
        title="Delete model"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
