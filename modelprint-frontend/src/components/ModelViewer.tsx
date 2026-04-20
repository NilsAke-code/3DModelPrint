import { Suspense, useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { OrbitControls, Grid, Center, Html } from "@react-three/drei";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import * as THREE from "three";
import { RotateCcw, Eye, EyeOff, Palette } from "lucide-react";

const MODEL_COLORS = [
  { name: "Warm Grey",  hex: "#a8a49e" },
  { name: "Cold Grey",  hex: "#9aa0a8" },
  { name: "Silver",     hex: "#c0c0c0" },
  { name: "Bone",       hex: "#e8e4dc" },
  { name: "Slate",      hex: "#707880" },
  { name: "Charcoal",   hex: "#484848" },
  { name: "Gold",       hex: "#c8a84e" },
  { name: "White",      hex: "#f0f0f0" },
];

function STLModel({ url, color }: { url: string; color: string }) {
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
  }, [centeredGeometry, camera]);

  return (
    <mesh ref={meshRef} geometry={centeredGeometry} castShadow receiveShadow>
      <meshStandardMaterial color={color} metalness={0.15} roughness={0.6} />
    </mesh>
  );
}

function BuildPlate({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <Grid
      args={[200, 200]}
      cellSize={5}
      cellThickness={0.5}
      cellColor="#c8c8c8"
      sectionSize={25}
      sectionThickness={1}
      sectionColor="#a0a0a0"
      fadeDistance={150}
      fadeStrength={1}
      followCamera={false}
      position={[0, 0, 0]}
    />
  );
}

function LoadingSpinner() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-2">
        <div className="w-8 h-8 border-2 border-border border-t-accent rounded-full animate-spin" />
        <span className="text-text-secondary text-xs">Loading model...</span>
      </div>
    </Html>
  );
}

function ErrorFallback({ message }: { message: string }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="text-text-secondary text-sm text-center px-4">
        <p>{message}</p>
      </div>
    </div>
  );
}

interface ModelViewerProps {
  fileUrl: string | null;
  thumbnailUrl?: string;
}

export default function ModelViewer({ fileUrl, thumbnailUrl }: ModelViewerProps) {
  const [showBed, setShowBed] = useState(true);
  const [color, setColor] = useState(MODEL_COLORS[0].hex);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [error, setError] = useState(false);
  const controlsRef = useRef<any>(null);

  function handleReset() {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
  }

  if (!fileUrl) {
    return (
      <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden border border-border bg-bg-card">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="Model preview" className="w-full h-full object-cover" />
        ) : (
          <ErrorFallback message="No 3D preview available" />
        )}
      </div>
    );
  }

  if (error) {
    return (
      <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden border border-border bg-bg-card">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="Model preview" className="w-full h-full object-cover" />
        ) : (
          <ErrorFallback message="Failed to load 3D model" />
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-[16/10] rounded-xl overflow-hidden border border-border bg-bg-card">
      <Canvas
        shadows
        camera={{ fov: 45, near: 0.1, far: 10000 }}
        onCreated={({ gl }) => {
          gl.setClearColor("#1a1a1a");
          gl.shadowMap.enabled = true;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.2;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
        onError={() => setError(true)}
      >
        <hemisphereLight args={['#ffffff', '#e0ddd8', 0.8]} />
        <directionalLight position={[5, 8, 5]} intensity={2.2} castShadow />
        <directionalLight position={[-4, 2, -4]} intensity={0.3} color="#fff8f0" />
        <ambientLight intensity={0.3} />

        <Suspense fallback={<LoadingSpinner />}>
          <Center disableY>
            <STLModel url={fileUrl} color={color} />
          </Center>
        </Suspense>

        <BuildPlate visible={showBed} />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enablePan
          enableZoom
          enableRotate
          minDistance={1}
          maxDistance={500}
          target={[0, 0, 0]}
        />
      </Canvas>

      <div className="absolute bottom-4 left-4 flex items-center gap-2">
        <button
          onClick={() => setShowBed(!showBed)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            showBed
              ? "bg-bg-secondary text-text-primary hover:bg-bg-card"
              : "bg-bg-card text-text-secondary hover:bg-bg-secondary"
          }`}
        >
          {showBed ? <Eye size={14} /> : <EyeOff size={14} />}
          <span>Bed</span>
        </button>

        <button
          onClick={handleReset}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-card text-text-secondary text-xs font-medium hover:bg-bg-secondary transition-colors"
        >
          <RotateCcw size={14} />
        </button>
      </div>

      <div className="absolute top-4 right-4">
        <button
          onClick={() => setShowColorPicker(!showColorPicker)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-bg-secondary/90 backdrop-blur-sm text-text-primary text-xs font-medium hover:bg-bg-card transition-colors"
        >
          <Palette size={14} />
          <span>Color</span>
          <span className="w-3.5 h-3.5 rounded-full border border-border" style={{ backgroundColor: color }} />
        </button>

        {showColorPicker && (
          <div className="absolute top-full right-0 mt-2 p-2 rounded-lg bg-bg-secondary/95 backdrop-blur-sm border border-border shadow-lg grid grid-cols-4 gap-1.5">
            {MODEL_COLORS.map((c) => (
              <button
                key={c.hex}
                onClick={() => { setColor(c.hex); setShowColorPicker(false); }}
                className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${
                  color === c.hex ? "border-accent scale-110" : "border-border"
                }`}
                style={{ backgroundColor: c.hex }}
                title={c.name}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
