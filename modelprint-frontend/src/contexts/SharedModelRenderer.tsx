import {
  createContext,
  useContext,
  useRef,
  useEffect,
  type ReactNode,
} from 'react';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

interface SharedRendererContextType {
  mountTo: (
    container: HTMLElement,
    stlUrl: string,
    glbUrl?: string | null,
    initialRotY?: number,
  ) => void;
  unmount: () => void;
  rotateModel: (yRad: number) => void;
}

const SharedRendererContext = createContext<SharedRendererContextType>({
  mountTo: () => {},
  unmount: () => {},
  rotateModel: () => {},
});

export function useSharedRenderer() {
  return useContext(SharedRendererContext);
}

export function SharedRendererProvider({ children }: { children: ReactNode }) {
  const rendererRef         = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef           = useRef<THREE.PerspectiveCamera | null>(null);
  const sceneRef            = useRef<THREE.Scene | null>(null);
  // meshRef is kept only for BufferGeometry disposal (STL path)
  const meshRef             = useRef<THREE.Mesh | null>(null);
  // activeObjectRef is the Object3D whose rotation.y the animation loop drives
  const activeObjectRef     = useRef<THREE.Object3D | null>(null);
  const animationIdRef      = useRef<number | null>(null);
  const currentContainerRef = useRef<HTMLElement | null>(null);
  const isMountedRef        = useRef<boolean>(false);   // guard against duplicate mounts
  const geometryCache       = useRef<Map<string, THREE.BufferGeometry>>(new Map());
  const glbGroupCache       = useRef<Map<string, THREE.Group>>(new Map());
  const materialRef         = useRef<THREE.MeshStandardMaterial | null>(null);
  const targetRotationRef   = useRef<number>(0);
  const initialRotYRef      = useRef<number>(0);

  useEffect(() => {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setClearColor('#1a1a1a', 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const canvas = renderer.domElement;
    canvas.style.position = 'fixed';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '50';
    canvas.style.display = 'none';
    canvas.style.borderRadius = '0';
    canvas.style.transition = 'opacity 0.15s ease-out';
    document.body.appendChild(canvas);

    rendererRef.current = renderer;
    cameraRef.current = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);

    // Warm off-white PLA fallback — used only for STL path
    materialRef.current = new THREE.MeshStandardMaterial({
      color: '#e8e4dc',
      metalness: 0.1,
      roughness: 0.65,
    });

    // Dismiss on scroll so the overlay doesn't drift from the card
    const onScroll = () => { if (currentContainerRef.current) unmount(); };
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      window.removeEventListener('scroll', onScroll);
      stopAnimation();
      renderer.dispose();
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function buildScene(): THREE.Scene {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#1a1a1a');

    // Match the lighting rig from generateThumbnail.ts buildOutputScene()
    const hemi = new THREE.HemisphereLight('#ffffff', '#e8e4e0', 0.7);
    const dir  = new THREE.DirectionalLight('#ffffff', 2.2);
    dir.position.set(5, 8, 5);
    dir.castShadow = true;
    dir.shadow.mapSize.set(2048, 2048);
    dir.shadow.bias   = -0.001;
    dir.shadow.radius = 3;
    const fill = new THREE.DirectionalLight('#fff8f0', 0.3);
    fill.position.set(-4, 2, -4);
    const rim  = new THREE.DirectionalLight('#e8f0ff', 0.8);
    rim.position.set(-3, 6, -6);
    const amb  = new THREE.AmbientLight('#ffffff', 0.3);

    // Shadow-receiving ground plane (transparent — only shows shadow)
    const shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400),
      new THREE.ShadowMaterial({ opacity: 0.35 }),
    );
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.receiveShadow = true;
    scene.add(hemi, dir, fill, rim, amb, shadowPlane);
    return scene;
  }

  // ── STL path ──────────────────────────────────────────────────────────────────

  function showGeometry(geo: THREE.BufferGeometry) {
    if (!rendererRef.current || !cameraRef.current) return;

    // Clone so the cached original is never mutated
    const cloned = geo.clone();
    cloned.computeBoundingBox();
    const box    = cloned.boundingBox!;
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Center XZ and seat bottom at y=0 — matches the thumbnail's floor-seated pose
    cloned.translate(-center.x, -box.min.y, -center.z);

    const scene = buildScene();
    const mesh  = new THREE.Mesh(cloned, materialRef.current!);
    mesh.castShadow = true;
    mesh.rotation.y = initialRotYRef.current;
    scene.add(mesh);

    // Camera matches the Cover angle from generateThumbnail.ts.
    // Multiply by 0.75 to compensate for the object-cover crop used when displaying
    // 1:1 thumbnails in a 4:3 card (top/bottom 12.5% cropped → model appears 4/3× larger).
    const d = maxDim * 2.4 * 0.75;
    const cam = cameraRef.current;
    cam.position.set(d * 0.7, d * 0.5, d * 0.7);
    cam.lookAt(0, size.y * 0.45, 0);
    cam.updateProjectionMatrix();

    if (meshRef.current) meshRef.current.geometry.dispose();
    meshRef.current    = mesh;
    activeObjectRef.current = mesh;
    sceneRef.current   = scene;
    startAnimation();
    // Fade in once the scene is ready — avoids flash of wrong/blank content
    if (rendererRef.current) rendererRef.current.domElement.style.opacity = '1';
  }

  // ── GLB path ──────────────────────────────────────────────────────────────────

  function showGlbGroup(group: THREE.Group, initialRotY: number) {
    if (!rendererRef.current || !cameraRef.current) return;

    // Deep-clone so the cached scene is never mutated between hovers
    const cloned = group.clone(true);
    cloned.updateMatrixWorld(true);

    // Seat bottom at y=0, center XZ — mirrors PATH B normalization
    const bounds = new THREE.Box3().setFromObject(cloned);
    const size   = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    cloned.position.set(-center.x, -bounds.min.y, -center.z);
    cloned.updateMatrixWorld(true);

    // Enable shadows on all child meshes; do NOT override materials
    cloned.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).castShadow = true;
    });

    // Start at the same Y-angle used for the thumbnail cover render
    cloned.rotation.y = initialRotY;

    const scene = buildScene();
    scene.add(cloned);

    const maxDim = Math.max(size.x, size.y, size.z);
    // ×0.75: compensates for the object-cover crop that makes the 1:1 thumbnail appear 4/3× larger
    const d = maxDim * 2.4 * 0.75;
    const cam = cameraRef.current;
    cam.position.set(d * 0.7, d * 0.5, d * 0.7);
    cam.lookAt(0, size.y * 0.45, 0);
    cam.updateProjectionMatrix();

    // Dispose any previous STL mesh geometry
    if (meshRef.current) { meshRef.current.geometry.dispose(); meshRef.current = null; }
    activeObjectRef.current = cloned;
    sceneRef.current = scene;
    startAnimation();
    // Fade in once the scene is ready — avoids flash of wrong/blank content
    if (rendererRef.current) rendererRef.current.domElement.style.opacity = '1';
  }

  // ── Animation ─────────────────────────────────────────────────────────────────

  function stopAnimation() {
    if (animationIdRef.current !== null) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
  }

  function startAnimation() {
    stopAnimation();
    function loop() {
      animationIdRef.current = requestAnimationFrame(loop);
      const obj = activeObjectRef.current;
      if (obj) {
        obj.rotation.y = THREE.MathUtils.lerp(
          obj.rotation.y,
          targetRotationRef.current,
          0.1,
        );
      }
      if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
      }
    }
    loop();
  }

  function rotateModel(yRad: number) {
    // Offset from the initial pose so mouse-center = thumbnail angle
    targetRotationRef.current = initialRotYRef.current + yRad;
  }

  // ── Mount / unmount ───────────────────────────────────────────────────────────

  /** Render a single blank frame so no stale content is visible while loading. */
  function clearCanvas() {
    const renderer = rendererRef.current;
    const camera   = cameraRef.current;
    if (!renderer || !camera) return;
    // Build a minimal empty scene and render one frame to clear the canvas buffer.
    const empty = new THREE.Scene();
    empty.background = new THREE.Color('#1a1a1a');
    renderer.render(empty, camera);
  }

  function mountTo(
    container: HTMLElement,
    stlUrl: string,
    glbUrl?: string | null,
    initialRotY?: number,
  ) {
    if (!rendererRef.current || !cameraRef.current) return;

    // Guard: if already mounted to the same container, do nothing
    if (isMountedRef.current && currentContainerRef.current === container) return;

    // If mounting to a different container, fully unmount first
    if (isMountedRef.current) unmount();

    isMountedRef.current = true;
    currentContainerRef.current = container;

    initialRotYRef.current  = initialRotY ?? 0;
    targetRotationRef.current = initialRotYRef.current;  // start at thumbnail pose

    const rect   = container.getBoundingClientRect();
    const canvas = rendererRef.current.domElement;
    canvas.style.left    = `${rect.left}px`;
    canvas.style.top     = `${rect.top}px`;
    canvas.style.width   = `${rect.width}px`;
    canvas.style.height  = `${rect.height}px`;
    canvas.style.display = 'block';
    // Clip to the card's rounded-xl top corners (0.75rem) — the canvas is positioned over
    // the thumbnail area which has its top corners clipped by the parent card.
    // Bottom corners are straight (flush with the text area).
    canvas.style.clipPath = 'inset(0 0 0 0 round 0.75rem 0.75rem 0 0)';
    rendererRef.current.setSize(rect.width, rect.height, false);
    cameraRef.current.aspect = rect.width / rect.height;
    cameraRef.current.updateProjectionMatrix();

    // Hide canvas immediately so the previous model's frame doesn't show at the
    // new card's position while the next asset loads. Opacity returns to 1 in
    // showGeometry / showGlbGroup once the scene is ready — creating a clean fade-in.
    rendererRef.current.domElement.style.opacity = '0';

    if (glbUrl) {
      // ── GLB path — materials preserved ────────────────────────────────────────
      if (glbGroupCache.current.has(glbUrl)) {
        showGlbGroup(glbGroupCache.current.get(glbUrl)!, initialRotYRef.current);
        return;
      }
      new GLTFLoader().load(
        glbUrl,
        (gltf) => {
          glbGroupCache.current.set(glbUrl, gltf.scene);
          // Only display if the user is still hovering this same container
          if (currentContainerRef.current === container) {
            showGlbGroup(gltf.scene, initialRotYRef.current);
          }
        },
        undefined,
        (err) => console.warn('SharedModelRenderer: GLB load failed', err),
      );
      return;
    }

    // ── STL fallback ──────────────────────────────────────────────────────────
    if (geometryCache.current.has(stlUrl)) {
      showGeometry(geometryCache.current.get(stlUrl)!);
      return;
    }
    new STLLoader().load(
      stlUrl,
      (geo) => {
        geo.computeVertexNormals();
        geometryCache.current.set(stlUrl, geo);
        if (currentContainerRef.current === container) {
          showGeometry(geo);
        }
      },
      undefined,
      (err) => console.warn('SharedModelRenderer: STL load failed', err),
    );
  }

  function unmount() {
    isMountedRef.current      = false;
    currentContainerRef.current = null;
    targetRotationRef.current = 0;
    initialRotYRef.current    = 0;

    stopAnimation();

    if (meshRef.current) {
      meshRef.current.geometry.dispose();
      meshRef.current = null;
    }
    activeObjectRef.current = null;
    sceneRef.current = null;

    if (rendererRef.current) {
      const canvas = rendererRef.current.domElement;
      canvas.style.display   = 'none';
      canvas.style.clipPath  = '';
      canvas.style.opacity   = '';
    }
  }

  return (
    <SharedRendererContext.Provider value={{ mountTo, unmount, rotateModel }}>
      {children}
    </SharedRendererContext.Provider>
  );
}
