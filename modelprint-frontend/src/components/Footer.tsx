export default function Footer() {
  return (
    <footer className="border-t border-border mt-auto bg-bg-secondary">
      <div className="max-w-5xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-text-primary">3DModelPrint</span>
          <span className="text-border">·</span>
          <span className="text-xs text-text-secondary">Private library for 3D printing models</span>
        </div>
        <p className="text-xs text-text-secondary">
          Built for personal use — not affiliated with MakerWorld or Bambu Lab
        </p>
      </div>
    </footer>
  );
}
