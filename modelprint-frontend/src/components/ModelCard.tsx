import { Link } from 'react-router-dom';
import { useRef } from 'react';
import { Download, Heart } from 'lucide-react';
import type { Model3D } from '../types';
import { getModelFileUrl, getThumbnailUrl } from '../services/api';
import { useSharedRenderer } from '../contexts/SharedModelRenderer';

export default function ModelCard({ model }: { model: Model3D }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { mountTo, unmount, rotateModel } = useSharedRenderer();
  const stlUrl = getModelFileUrl(model);
  const thumbnailUrl = getThumbnailUrl(model);

  function handleMouseEnter() {
    if (containerRef.current && stlUrl) {
      mountTo(containerRef.current, stlUrl, null, 0);
    }
  }

  function handleMouseLeave() {
    unmount();
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(-0.5, Math.min(0.5, (e.clientX - rect.left) / rect.width - 0.5));
    rotateModel(x * (Math.PI / 6)); // ±15° — symmetric around the initial pose
  }

  return (
    <Link
      to={`/model/${model.id}`}
      className="group block rounded-xl bg-bg-card border border-border overflow-hidden hover:shadow-xl hover:shadow-black/40 hover:border-accent/30 hover:-translate-y-0.5 transition-all duration-200"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div ref={containerRef} className="aspect-[4/3] overflow-hidden relative bg-bg-secondary"
        onMouseMove={handleMouseMove}
      >
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={model.title}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-text-secondary text-xs">
            No preview
          </div>
        )}
      </div>
      <div className="p-3.5">
        <h3 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent transition-colors">
          {model.title}
        </h3>
        <p className="text-xs text-text-secondary mt-1">{model.authorName}</p>
        <div className="flex items-center gap-4 mt-2 text-xs text-text-secondary">
          <span className="flex items-center gap-1">
            <Download size={13} /> {model.downloads.toLocaleString()}
          </span>
          <span className="flex items-center gap-1">
            <Heart size={13} /> {model.likes.toLocaleString()}
          </span>
        </div>
      </div>
    </Link>
  );
}
