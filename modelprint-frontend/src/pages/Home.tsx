import { useEffect, useState, useRef, useCallback } from 'react';
import { fetchModels } from '../services/api';
import type { Model3D } from '../types';
import ModelCard from '../components/ModelCard';
import SeedModelBuilder from '../components/SeedModelBuilder';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const CATEGORIES = [
  'For You',
  'Trending',
  'Education',
  'Gadgets',
  'Toys & Games',
  'Household',
  'Tools',
  'Art',
  'Mechanical',
  'Miniatures',
];

const HERO_SLIDES = [
  {
    title: 'Discover Amazing 3D Models',
    subtitle: 'Browse community-made designs ready to print',
    gradient: 'from-accent/20 via-bg-primary to-bg-primary',
    accent: 'text-accent',
  },
  {
    title: 'Share Your Creations',
    subtitle: 'Upload your 3D models and inspire makers worldwide',
    gradient: 'from-highlight/15 via-bg-primary to-bg-primary',
    accent: 'text-highlight',
  },
  {
    title: 'Print-Ready Downloads',
    subtitle: 'STL and 3MF files optimized for your 3D printer',
    gradient: 'from-white/6 via-bg-primary to-bg-primary',
    accent: 'text-text-secondary',
  },
  {
    title: 'Join the Community',
    subtitle: 'Connect with designers and makers around the globe',
    gradient: 'from-accent/20 via-highlight/10 to-bg-primary',
    accent: 'text-accent',
  },
];

export default function Home() {
  const [models, setModels] = useState<Model3D[]>([]);
  const [activeFilter, setActiveFilter] = useState('For You');
  const [loading, setLoading] = useState(true);
  const [currentSlide, setCurrentSlide] = useState(0);
  const categoryRef = useRef<HTMLDivElement>(null);
  const slideInterval = useRef<ReturnType<typeof setInterval>>(null);

  const startSlideTimer = useCallback(() => {
    if (slideInterval.current) clearInterval(slideInterval.current);
    slideInterval.current = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 5000);
  }, []);

  useEffect(() => {
    startSlideTimer();
    return () => { if (slideInterval.current) clearInterval(slideInterval.current); };
  }, [startSlideTimer]);

  function goToSlide(index: number) {
    setCurrentSlide(index);
    startSlideTimer();
  }

  const loadModels = useCallback(async () => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (activeFilter === 'Trending') params.sort = 'downloads';
    else if (activeFilter !== 'For You') params.category = activeFilter;
    const data = await fetchModels(params);
    setModels(data);
    setLoading(false);
  }, [activeFilter]);

  useEffect(() => { loadModels(); }, [loadModels]);

  function scrollCategories(direction: 'left' | 'right') {
    if (!categoryRef.current) return;
    categoryRef.current.scrollBy({ left: direction === 'left' ? -200 : 200, behavior: 'smooth' });
  }

  const slide = HERO_SLIDES[currentSlide];

  return (
    <div>
      {/* Hero Slideshow */}
      <div className="relative mb-8 rounded-2xl overflow-hidden bg-bg-card border border-border">
        <div className={`relative px-8 py-12 md:px-12 md:py-16 bg-gradient-to-r ${slide.gradient} transition-all duration-700`}>
          <button
            onClick={() => goToSlide((currentSlide - 1 + HERO_SLIDES.length) % HERO_SLIDES.length)}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-bg-card/60 text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors backdrop-blur-sm"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={() => goToSlide((currentSlide + 1) % HERO_SLIDES.length)}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-bg-card/60 text-text-secondary hover:text-text-primary hover:bg-bg-card transition-colors backdrop-blur-sm"
          >
            <ChevronRight size={20} />
          </button>

          <div className="max-w-2xl transition-opacity duration-500">
            <h2 className={`text-2xl md:text-3xl font-bold ${slide.accent} mb-3`}>{slide.title}</h2>
            <p className="text-text-secondary text-sm md:text-base">{slide.subtitle}</p>
          </div>

          <div className="flex gap-2 mt-8">
            {HERO_SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => goToSlide(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === currentSlide ? 'w-8 bg-accent' : 'w-4 bg-text-secondary/30 hover:bg-text-secondary/50'
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Scrollable category chips */}
      <div className="relative mb-6 group">
        <button
          onClick={() => scrollCategories('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-bg-secondary/90 border border-border text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors backdrop-blur-sm shadow-lg opacity-0 group-hover:opacity-100"
        >
          <ChevronLeft size={18} />
        </button>

        <div
          ref={categoryRef}
          className="flex gap-2 overflow-x-auto px-8 scroll-smooth"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {CATEGORIES.map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors duration-150 shrink-0 ${
                activeFilter === filter
                  ? 'bg-accent text-bg-primary'
                  : 'border border-border text-text-secondary hover:text-text-primary hover:border-accent/40'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>

        <button
          onClick={() => scrollCategories('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-1.5 rounded-full bg-bg-secondary/90 border border-border text-text-secondary hover:text-text-primary hover:border-accent/40 transition-colors backdrop-blur-sm shadow-lg opacity-0 group-hover:opacity-100"
        >
          <ChevronRight size={18} />
        </button>
      </div>

      {/* Auto-generates 3D thumbnails for seeded models in the background */}
      <SeedModelBuilder onRefresh={loadModels} />

      {/* Model grid */}
      {loading ? (
        <div className="text-text-secondary text-center py-12">Loading models...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">
          {models.map((model) => (
            <ModelCard key={model.id} model={model} />
          ))}
        </div>
      )}

      {!loading && models.length === 0 && (
        <div className="text-text-secondary text-center py-12">No models found.</div>
      )}
    </div>
  );
}
