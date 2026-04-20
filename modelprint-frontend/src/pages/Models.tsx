import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { fetchModels, fetchTags } from "../services/api";
import ModelCardPreview from "../components/ModelCardPreview";
import type { Model3D, Tag } from "../types";
import { SlidersHorizontal, ChevronRight, Download, Heart } from "lucide-react";

const ALL_CATEGORIES = [
  "All",
  "Education",
  "Art",
  "Gadgets",
  "Household",
  "Tools",
  "Toys & Games",
  "Mechanical",
  "Miniatures",
];

export default function Models() {
  const [searchParams] = useSearchParams();
  const [models, setModels] = useState<Model3D[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [showFilters, setShowFilters] = useState(true);
  const [activeCategory, setActiveCategory] = useState("All");
  const [activeTag, setActiveTag] = useState("");
  const [sort, setSort] = useState("newest");
  const [loading, setLoading] = useState(true);

  const search = searchParams.get("search") || "";

  useEffect(() => { fetchTags().then(setTags); }, []);
  useEffect(() => { loadModels(); }, [activeCategory, activeTag, sort, search]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadModels() {
    setLoading(true);
    const data = await fetchModels({
      search: search || undefined,
      category: activeCategory === "All" ? undefined : activeCategory,
      tag: activeTag || undefined,
      sort,
    });
    setModels(data);
    setLoading(false);
  }

  function resetFilters() {
    setActiveCategory("All");
    setActiveTag("");
  }

  return (
    <div>
      {/* Top control bar */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium text-text-secondary hover:text-text-primary border border-border hover:border-accent/40 transition-colors"
        >
          <SlidersHorizontal size={16} />
          {showFilters ? "Hide Filters" : "Filters"}
        </button>
        <div className="flex items-center gap-4 text-sm">
          {(["newest", "downloads", "likes"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`capitalize transition-colors ${
                sort === s ? "text-accent font-semibold" : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-6">
        {/* Filter sidebar */}
        {showFilters && (
          <div className="w-[250px] shrink-0 hidden md:block">
            <div className="bg-bg-secondary rounded-xl border border-border p-4">
              <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-3">
                Categories
              </h3>
              <div className="flex flex-col gap-0.5">
                {ALL_CATEGORIES.map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(cat)}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      activeCategory === cat
                        ? "text-accent bg-accent/10"
                        : "text-text-secondary hover:text-text-primary"
                    }`}
                  >
                    {cat}
                    <ChevronRight size={14} className="opacity-40" />
                  </button>
                ))}
              </div>

              {tags.length > 0 && (
                <>
                  <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mt-5 mb-3">
                    Tags
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {tags.map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => setActiveTag(activeTag === tag.name ? "" : tag.name)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                          activeTag === tag.name
                            ? "bg-accent text-bg-primary"
                            : "border border-border text-text-secondary hover:text-text-primary"
                        }`}
                      >
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </>
              )}

              <button
                onClick={resetFilters}
                className="w-full mt-5 px-3 py-2 text-xs text-text-secondary hover:text-accent border border-border rounded-lg transition-colors"
              >
                Reset All Filters
              </button>
            </div>
          </div>
        )}

        {/* Content — compact horizontal list */}
        <div className="flex-1 min-w-0">
          {search && (
            <p className="text-text-secondary text-sm mb-4">
              Results for "<span className="text-accent">{search}</span>"
            </p>
          )}

          {loading ? (
            <div className="text-text-secondary text-center py-12">Loading...</div>
          ) : models.length === 0 ? (
            <div className="text-text-secondary text-center py-12">No models found.</div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {models.map((model) => (
                <Link
                  key={model.id}
                  to={`/model/${model.id}`}
                  className="group flex items-center gap-4 rounded-xl bg-bg-card border border-border overflow-hidden transition-all duration-150 hover:border-accent/20 hover:shadow-lg hover:shadow-accent/5 h-[100px]"
                >
                  <div className="w-[140px] h-full shrink-0 overflow-hidden">
                    <ModelCardPreview model={model} />
                  </div>
                  <div className="flex-1 min-w-0 py-2.5 pr-4">
                    <h3 className="text-sm font-semibold text-text-primary truncate group-hover:text-accent transition-colors">
                      {model.title}
                    </h3>
                    <p className="text-xs text-text-secondary mt-0.5">{model.authorName}</p>
                    {model.description && (
                      <p className="text-xs text-text-secondary mt-1 line-clamp-1 leading-relaxed">
                        {model.description}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-text-secondary">
                      <span className="flex items-center gap-1">
                        <Download size={11} /> {model.downloads.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Heart size={11} /> {model.likes.toLocaleString()}
                      </span>
                      {model.category && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-accent/10 text-accent border border-accent/20">
                          {model.category}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
