import { Suspense, useRef, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Html } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";
import { X, RefreshCw, Maximize, Grid as GridIcon, HelpCircle } from "lucide-react";

function STLPreviewModel({
  url,
  onBoundsComputed,
}: {
  url: string;
  onBoundsComputed?: (size: THREE.Vector3) => void;
}) {
  const geometry = useLoader(STLLoader, url);
  const { camera } = useThree();
  const meshRef = useRef<THREE.Mesh>(null);

  const centeredGeometry = useMemo(() => {
    const geo = geometry.clone();
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    const center = new THREE.Vector3();
    box.getCenter(center);
    geo.translate(-center.x, -center.y, -center.z);
    geo.computeBoundingBox();
    const newBox = geo.boundingBox!;
    geo.translate(0, -newBox.min.y, 0);
    return geo;
  }, [geometry]);

  useEffect(() => {
    if (!meshRef.current) return;
    centeredGeometry.computeBoundingBox();
    const box = centeredGeometry.boundingBox!;
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 2.4;
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.position.set(distance * 0.7, distance * 0.5, distance * 0.7);
      camera.lookAt(0, size.y / 2, 0);
      camera.updateProjectionMatrix();
    }
    onBoundsComputed?.(size.clone());
  }, [centeredGeometry, camera, onBoundsComputed]);

  return (
    <mesh ref={meshRef} geometry={centeredGeometry} castShadow receiveShadow>
      <meshStandardMaterial color="#606068" metalness={0} roughness={0.75} />
    </mesh>
  );
}

function DynamicBed({ modelSize }: { modelSize: THREE.Vector3 | null }) {
  const footprintW = (modelSize?.x ?? 50) * 2.0;
  const footprintD = (modelSize?.z ?? 50) * 2.0;
  const size = Math.max(footprintW, footprintD, 40);
  const cellSize = Math.max(size / 24, 0.5);
  const sectionSize = cellSize * 6;

  return (
    <group>
      {/* Filled base plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[size, size]} />
        <meshBasicMaterial color="#b8e2f5" />
      </mesh>

      {/* Grid lines on top */}
      <Grid
        args={[size, size]}
        cellSize={cellSize}
        cellThickness={0.5}
        cellColor="#9dd4ec"
        sectionSize={sectionSize}
        sectionThickness={1.0}
        sectionColor="#7bbfe3"
        fadeDistance={size * 14}
        fadeStrength={0.2}
        followCamera={false}
        position={[0, 0, 0]}
      />
    </group>
  );
}

function SceneControls({ modelSize, controlsRef }: { modelSize: THREE.Vector3 | null; controlsRef?: any }) {
  const { camera } = useThree();
  const controls = useRef<any>(null);
  const initial = useRef<{pos: THREE.Vector3; target: THREE.Vector3} | null>(null);

  const maxDim = modelSize ? Math.max(modelSize.x, modelSize.y, modelSize.z) : 50;
  const maxDistance = maxDim * 10;

  // capture initial camera/target state after model is available
  useEffect(() => {
    if (!modelSize) return;
    // store after camera has been positioned by STLPreviewModel
    initial.current = {
      pos: camera.position.clone(),
      target: new THREE.Vector3(0, (modelSize?.y ?? 0) / 2, 0),
    };
  }, [modelSize, camera.position]);

  // expose helpers
  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = {
      reset: () => {
        if (!controls.current || !initial.current) return;
        camera.position.copy(initial.current.pos);
        if (controls.current.target) controls.current.target.copy(initial.current.target);
        controls.current.update();
      },
      fit: () => {
        if (!modelSize) return;
        const size = modelSize;
        const maxD = Math.max(size.x, size.y, size.z);
        const distance = maxD * 2.4;
        camera.position.set(distance * 0.7, distance * 0.5, distance * 0.7);
        if (controls.current && controls.current.target) controls.current.target.set(0, size.y / 2, 0);
        camera.updateProjectionMatrix();
        if (controls.current) controls.current.update();
      },
    };
  }, [controlsRef, modelSize, camera]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableZoom
      enableRotate
      minDistance={1}
      maxDistance={maxDistance}
    />
  );
}

function LoadingSpinner() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-400 rounded-full animate-spin" />
        <span className="text-gray-500 text-xs">Loading model...</span>
      </div>
    </Html>
  );
}

interface STLPreviewModalProps {
  fileUrl: string;
  fileName?: string;
  onClose: () => void;
}

export default function STLPreviewModal({ fileUrl, fileName, onClose }: STLPreviewModalProps) {
  const [modelSize, setModelSize] = useState<THREE.Vector3 | null>(null);
  const [showBed, setShowBed] = useState(true);
  const [showDimensions, setShowDimensions] = useState(false);
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col bg-white"
      onClick={onClose}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 h-12 border-b border-gray-200 flex-shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-sm font-medium text-gray-700 font-mono truncate">
          {fileName ?? "STL Preview"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 relative" onClick={(e) => e.stopPropagation()}>
        <Canvas
          shadows
          camera={{ fov: 45, near: 0.1, far: 10000 }}
          onCreated={({ gl }) => {
            gl.setClearColor("#ffffff");
            gl.shadowMap.enabled = true;
            gl.outputColorSpace = THREE.SRGBColorSpace;
          }}
        >
          <ambientLight intensity={0.3} />
          <hemisphereLight args={["#ffffff", "#e8eaf0", 0.7]} />
          <directionalLight position={[5, 10, 5]} intensity={2.2} castShadow />
          <directionalLight position={[-5, 3, -5]} intensity={0.3} />

          <Suspense fallback={<LoadingSpinner />}>
            <STLPreviewModel url={fileUrl} onBoundsComputed={setModelSize} />
          </Suspense>

          {showBed && <DynamicBed modelSize={modelSize} />}
          <SceneControls modelSize={modelSize} controlsRef={controlsRef} />
        </Canvas>

        {/* Dimensions overlay */}
        {showDimensions && modelSize && (
          <div className="absolute left-3 bottom-3 bg-white/90 text-xs text-gray-700 rounded-md px-2 py-1 border border-gray-200">
            <div>W: {modelSize.x.toFixed(1)} mm</div>
            <div>D: {modelSize.z.toFixed(1)} mm</div>
            <div>H: {modelSize.y.toFixed(1)} mm</div>
          </div>
        )}

      </div>

      {/* Controls beneath canvas */}
      <div onClick={(e) => e.stopPropagation()} className="flex items-center justify-center gap-2 px-4 py-3 border-t border-gray-200 flex-shrink-0">
        <button
          onClick={(e) => { e.stopPropagation(); controlsRef.current?.reset?.(); }}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          title="Reset camera"
        >
          <RefreshCw size={16} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); controlsRef.current?.fit?.(); }}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          title="Fit to view"
        >
          <Maximize size={16} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setShowBed((s) => !s); }}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          title="Toggle bed/grid"
        >
          <GridIcon size={16} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setShowDimensions((s) => !s); }}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          title="Show dimensions"
        >
          <HelpCircle size={16} />
        </button>
      </div>
    </div>,
    document.body,
  );
}
