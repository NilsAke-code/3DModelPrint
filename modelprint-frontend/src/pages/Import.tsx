import { useNavigate } from "react-router-dom";
import { Upload, Box, Info, ArrowRight, FileBox, Layers } from "lucide-react";

const FORMATS = [
  {
    ext: "STL",
    label: "Stereolithography",
    description: "Geometry only — rendered with a clean default material.",
    color: "#6b7280",
  },
  {
    ext: "OBJ",
    label: "Wavefront OBJ",
    description: "Add an .mtl file and textures to preserve colors and materials.",
    color: "#6b7280",
  },
  {
    ext: "GLB",
    label: "GL Transmission Format",
    description: "Best quality — materials and textures fully embedded.",
    color: "#9ca3af",
  },
];

const WHAT_HAPPENS = [
  { icon: Box, label: "Geometry normalized", detail: "Centered, seated at y=0, scale preserved" },
  { icon: Layers, label: "5 previews rendered", detail: "Cover · Front · Side · Elevated · STL-style" },
  { icon: FileBox, label: "Export STL generated", detail: "Clean normalized mesh for download" },
];

export default function Import() {
  const navigate = useNavigate();

  return (
    <div className="max-w-2xl mx-auto py-10 px-4 flex flex-col gap-10">

      {/* Page heading */}
      <div>
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Import a model</h1>
        <p className="text-text-secondary text-sm mt-2 leading-relaxed">
          Upload a 3D model file and the system will process it into clean previews,
          a normalized export, and a library entry.
        </p>
      </div>

      {/* Primary CTA */}
      <button
        onClick={() => navigate("/library/upload")}
        className="group relative flex items-center justify-between w-full rounded-2xl bg-bg-card border border-border px-6 py-5 hover:border-white/15 hover:bg-bg-card-hover hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-black/50 transition-all duration-200 text-left"
      >
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 rounded-xl bg-bg-secondary border border-border flex items-center justify-center shrink-0 group-hover:border-white/15 transition-colors">
            <Upload size={20} className="text-text-secondary group-hover:text-text-primary transition-colors" />
          </div>
          <div>
            <p className="text-text-primary font-semibold text-base">Upload a file</p>
            <p className="text-text-secondary text-sm mt-0.5">STL, OBJ, or GLB — with optional companion files</p>
          </div>
        </div>
        <ArrowRight size={18} className="text-text-secondary group-hover:text-text-primary group-hover:translate-x-0.5 transition-all" />
      </button>

      {/* Supported formats */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">Supported formats</p>
        <div className="flex flex-col gap-2">
          {FORMATS.map((f) => (
            <div
              key={f.ext}
              className="flex items-start gap-4 rounded-xl bg-bg-card border border-border px-5 py-4"
            >
              <span className="text-xs font-bold font-mono text-text-secondary bg-bg-secondary border border-border px-2 py-0.5 rounded shrink-0 mt-0.5">
                .{f.ext}
              </span>
              <div>
                <p className="text-sm font-medium text-text-primary leading-tight">{f.label}</p>
                <p className="text-xs text-text-secondary mt-0.5 leading-relaxed">{f.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* What the pipeline does */}
      <div className="flex flex-col gap-3">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-widest">What happens after upload</p>
        <div className="flex flex-col gap-0 rounded-xl border border-border overflow-hidden">
          {WHAT_HAPPENS.map((step, i) => (
            <div
              key={i}
              className={`flex items-center gap-4 px-5 py-4 bg-bg-card ${
                i < WHAT_HAPPENS.length - 1 ? "border-b border-border" : ""
              }`}
            >
              <step.icon size={16} className="text-text-secondary shrink-0" />
              <div>
                <p className="text-sm font-medium text-text-primary">{step.label}</p>
                <p className="text-xs text-text-secondary mt-0.5">{step.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Note on OBJ */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-bg-card px-5 py-4">
        <Info size={14} className="text-text-secondary shrink-0 mt-0.5" />
        <p className="text-xs text-text-secondary leading-relaxed">
          For OBJ files, add a matching <span className="font-mono text-text-primary">.mtl</span> file and
          texture images as companion files to get accurate material rendering.
          Missing textures will fall back to a clean neutral material.
        </p>
      </div>

    </div>
  );
}
