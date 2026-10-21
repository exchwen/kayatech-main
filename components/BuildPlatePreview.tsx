"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";

const BED_MM = 256;

type BuildPlatePreviewProps = {
  file: File | null;
  printer?: "A1" | "P1S";
};

function addBuildPlate(scene: THREE.Scene) {
  const bed = new THREE.Mesh(
    new THREE.BoxGeometry(BED_MM, 4, BED_MM),
    new THREE.MeshStandardMaterial({
      color: 0x1b3341,
      roughness: 0.9,
      metalness: 0.08
    })
  );
  bed.position.set(BED_MM / 2, -2, -BED_MM / 2);
  bed.receiveShadow = true;
  scene.add(bed);

  const surface = new THREE.Mesh(
    new THREE.PlaneGeometry(BED_MM, BED_MM),
    new THREE.MeshStandardMaterial({
      color: 0x172b38,
      roughness: 0.92,
      metalness: 0.04,
      side: THREE.DoubleSide
    })
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(BED_MM / 2, 0.02, -BED_MM / 2);
  surface.receiveShadow = true;
  scene.add(surface);

  // 10 mm minor grid and 50 mm major grid, matching a 256 x 256 mm bed.
  const minor: number[] = [];
  const major: number[] = [];
  for (let p = 0; p <= BED_MM; p += 10) {
    const target = p % 50 === 0 ? major : minor;
    target.push(p, 0.08, 0, p, 0.08, -BED_MM);
    target.push(0, 0.08, -p, BED_MM, 0.08, -p);
  }

  for (const set of [
    { points: minor, color: 0x456170, opacity: 0.45 },
    { points: major, color: 0x7894a3, opacity: 0.72 }
  ]) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(set.points, 3)
    );
    scene.add(
      new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          color: set.color,
          transparent: true,
          opacity: set.opacity,
          depthWrite: false
        })
      )
    );
  }

  const border = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.1, 0),
      new THREE.Vector3(BED_MM, 0.1, 0),
      new THREE.Vector3(BED_MM, 0.1, -BED_MM),
      new THREE.Vector3(0, 0.1, -BED_MM)
    ]),
    new THREE.LineBasicMaterial({ color: 0x9bb5c2 })
  );
  scene.add(border);
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    renderable.geometry?.dispose();
    if (renderable.material) {
      const materials = Array.isArray(renderable.material)
        ? renderable.material
        : [renderable.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

export default function BuildPlatePreview({
  file,
  printer = "A1"
}: BuildPlatePreviewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [outsideBed, setOutsideBed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let stopped = false;
    let animationFrame = 0;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#102532");

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 1800);
    camera.up.set(0, 1, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    host.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xe8f5fa, 0x607482, 2.0));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.1);
    keyLight.position.set(320, 450, 300);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x8ed7ef, 0.6);
    fillLight.position.set(-200, 180, -180);
    scene.add(fillLight);
    addBuildPlate(scene);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.screenSpacePanning = false;
    controls.minDistance = 95;
    controls.maxDistance = 900;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.target.set(BED_MM / 2, 0, -BED_MM / 2);

    const resize = () => {
      if (stopped) return;
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    camera.position.set(BED_MM / 2 + 235, 260, -BED_MM / 2 + 270);
    camera.lookAt(BED_MM / 2, 0, -BED_MM / 2);
    controls.update();

    const render = () => {
      if (stopped) return;
      animationFrame = window.requestAnimationFrame(render);
      controls.update();
      renderer.render(scene, camera);
    };
    render();

    setError("");
    setOutsideBed(false);

    async function loadSelectedFile() {
      if (!file) return;
      try {
        const buffer = await file.arrayBuffer();
        if (stopped) return;

        const is3mf = file.name.toLowerCase().endsWith(".3mf");
        let model: THREE.Object3D;
        if (is3mf) {
          model = new ThreeMFLoader().parse(buffer);
        } else {
          const geometry = new STLLoader().parse(buffer);
          geometry.computeVertexNormals();
          model = new THREE.Mesh(
            geometry,
            new THREE.MeshStandardMaterial({
              color: 0xa8c9d8,
              roughness: 0.68,
              metalness: 0.04
            })
          );
        }

        // 3MF/STL coordinates are Z-up. Convert them to the Y-up Three.js scene.
        const modelRoot = new THREE.Group();
        modelRoot.add(model);
        modelRoot.rotation.x = -Math.PI / 2;
        modelRoot.updateMatrixWorld(true);

        let bounds = new THREE.Box3().setFromObject(modelRoot);
        if (bounds.isEmpty()) {
          throw new Error("Dosyada gösterilebilir 3D geometri bulunamadı.");
        }

        if (!is3mf) {
          // An STL has no build-plate placement. Centre it on the plate and put its
          // lowest point on Z=0, preserving its original dimensions and orientation.
          const centre = bounds.getCenter(new THREE.Vector3());
          modelRoot.position.x += BED_MM / 2 - centre.x;
          modelRoot.position.z += -BED_MM / 2 - centre.z;
          modelRoot.updateMatrixWorld(true);
          bounds = new THREE.Box3().setFromObject(modelRoot);
          modelRoot.position.y += -bounds.min.y + 0.15;
          modelRoot.updateMatrixWorld(true);
          bounds = new THREE.Box3().setFromObject(modelRoot);
        }
        // A 3MF can contain build-item transforms and the saved plate position.
        // Keep those transforms as authored; do not scale or re-centre the project.
        const size = bounds.getSize(new THREE.Vector3());
        const doesNotFit =
          bounds.min.x < -0.1 ||
          bounds.max.x > BED_MM + 0.1 ||
          bounds.min.z < -BED_MM - 0.1 ||
          bounds.max.z > 0.1 ||
          bounds.min.y < -0.1 ||
          size.y > BED_MM + 0.1;
        setOutsideBed(doesNotFit);

        scene.add(modelRoot);
        controls.target.set(BED_MM / 2, Math.min(Math.max(size.y / 2, 0), BED_MM), -BED_MM / 2);
        controls.update();
      } catch (cause) {
        if (!stopped) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Modelin önizlemesi oluşturulamadı."
          );
        }
      }
    }

    void loadSelectedFile();

    return () => {
      stopped = true;
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      disposeScene(scene);
      renderer.dispose();
      host.replaceChildren();
    };
  }, [file, printer]);

  return (
    <div
      className="reliablePreview"
      ref={hostRef}
      style={{ position: "relative", overflow: "hidden" }}
    >
      <div
        style={{
          position: "absolute",
          zIndex: 4,
          top: 12,
          left: 12,
          right: 12,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
          pointerEvents: "none",
          color: "#e7f4fa",
          fontFamily: "monospace",
          fontSize: 10,
          letterSpacing: ".04em",
          textShadow: "0 1px 5px #07131acc"
        }}
      >
        <span>Bambu Lab {printer}</span>
        <span>256 × 256 mm · Ölçek korunur</span>
      </div>
      {outsideBed && (
        <div
          role="status"
          style={{
            position: "absolute",
            zIndex: 4,
            bottom: 12,
            left: 12,
            right: 12,
            padding: "9px 11px",
            borderRadius: 8,
            background: "#5a351ce8",
            border: "1px solid #e5a45a",
            color: "#ffe3c2",
            fontSize: 11
          }}
        >
          Modelin bir kısmı yazdırma alanı dışında. Ölçek otomatik küçültülmedi.
        </div>
      )}
      {error && (
        <div className="previewError" role="alert">
          {error}
        </div>
      )}
      {!file && (
        <div className="previewEmpty">
          <span>◇</span>
          <p>STL veya 3MF modelini seç</p>
        </div>
      )}
    </div>
  );
}
