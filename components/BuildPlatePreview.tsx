"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { strFromU8, unzipSync } from "three/examples/jsm/libs/fflate.module.js";

const BED_MM = 256;

type ThreeMfModel = {
  path: string;
  unit: number;
  objects: Map<string, ThreeMfObject>;
};

type ThreeMfObject = {
  model: ThreeMfModel;
  id: string;
  mesh?: THREE.BufferGeometry;
  components: Array<{ modelPath: string; objectId: string; transform: THREE.Matrix4 }>;
};

function normalizedArchivePath(path: string, base = "") {
  const parts = (path.startsWith("/") ? path.slice(1) : `${base}/${path}`)
    .split("/")
    .filter(Boolean);
  const result: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") result.pop();
    else result.push(part);
  }
  return result.join("/");
}

function xmlAttribute(element: Element, name: string) {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes[index];
    if (attribute.localName === name || attribute.name === name) return attribute.value;
  }
  return null;
}

function childElements(element: Element, localName: string) {
  return Array.from(element.children).filter((child) => child.localName === localName);
}

function firstChild(element: Element, localName: string) {
  return childElements(element, localName)[0] ?? null;
}

function unitToMillimeters(unit: string | null) {
  switch ((unit ?? "micron").toLowerCase()) {
    case "micron":
    case "micrometer":
    case "micrometers": return 0.001;
    case "centimeter":
    case "centimeters": return 10;
    case "meter":
    case "meters": return 1000;
    case "inch":
    case "inches": return 25.4;
    case "foot":
    case "feet": return 304.8;
    case "millimeter":
    case "millimeters":
    default: return 1;
  }
}

function threeMfTransform(value: string | null, unit: number) {
  if (!value) return new THREE.Matrix4();
  const numbers = value.trim().split(/\s+/).map(Number);
  if (numbers.length !== 12 || numbers.some((number) => !Number.isFinite(number))) {
    throw new Error("3MF dosyasındaki dönüşüm geçersiz.");
  }
  return new THREE.Matrix4().set(
    numbers[0], numbers[1], numbers[2], numbers[3] * unit,
    numbers[4], numbers[5], numbers[6], numbers[7] * unit,
    numbers[8], numbers[9], numbers[10], numbers[11] * unit,
    0, 0, 0, 1
  );
}

function createThreeMfGeometry(mesh: Element, unit: number) {
  const vertices = Array.from(mesh.getElementsByTagNameNS("*", "vertex"));
  const triangles = Array.from(mesh.getElementsByTagNameNS("*", "triangle"));
  if (!vertices.length || !triangles.length) return undefined;

  const positions: number[] = [];
  for (const vertex of vertices) {
    positions.push(
      Number(xmlAttribute(vertex, "x")) * unit,
      Number(xmlAttribute(vertex, "y")) * unit,
      Number(xmlAttribute(vertex, "z")) * unit
    );
  }
  const indices: number[] = [];
  for (const triangle of triangles) {
    const values = ["v1", "v2", "v3"].map((name) => Number(xmlAttribute(triangle, name)));
    if (values.every((value) => Number.isInteger(value) && value >= 0 && value < vertices.length)) {
      indices.push(...values);
    }
  }
  if (!indices.length || positions.some((value) => !Number.isFinite(value))) return undefined;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function parseThreeMf(buffer: ArrayBuffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  const xmlFiles = new Map<string, XMLDocument>();
  const parser = new DOMParser();
  for (const [path, bytes] of Object.entries(archive)) {
    if (!path.toLowerCase().endsWith(".model") && !path.toLowerCase().endsWith(".rels")) continue;
    const document = parser.parseFromString(strFromU8(bytes), "application/xml");
    if (document.getElementsByTagName("parsererror").length) continue;
    xmlFiles.set(normalizedArchivePath(path), document);
  }

  const relationships = xmlFiles.get("_rels/.rels");
  if (!relationships) throw new Error("3MF kök ilişkileri bulunamadı.");
  const rootRelationship = Array.from(relationships.getElementsByTagNameNS("*", "Relationship"))
    .find((relationship) => (xmlAttribute(relationship, "Type") ?? "").toLowerCase().endsWith("/3dmodel"));
  const rootPath = rootRelationship
    ? normalizedArchivePath(xmlAttribute(rootRelationship, "Target") ?? "")
    : "3D/3dmodel.model";
  if (!xmlFiles.has(rootPath)) throw new Error("3MF kök model dosyası bulunamadı.");

  const models = new Map<string, ThreeMfModel>();
  for (const [path, document] of xmlFiles) {
    if (!path.toLowerCase().endsWith(".model")) continue;
    const modelElement = document.documentElement;
    const model: ThreeMfModel = {
      path,
      unit: unitToMillimeters(xmlAttribute(modelElement, "unit")),
      objects: new Map()
    };
    const resources = firstChild(modelElement, "resources");
    for (const objectElement of resources ? childElements(resources, "object") : []) {
      const id = xmlAttribute(objectElement, "id");
      if (!id) continue;
      const meshElement = firstChild(objectElement, "mesh");
      const components = firstChild(objectElement, "components");
      const object: ThreeMfObject = {
        model,
        id,
        mesh: meshElement ? createThreeMfGeometry(meshElement, model.unit) : undefined,
        components: []
      };
      for (const component of components ? childElements(components, "component") : []) {
        const componentPath = xmlAttribute(component, "path");
        const objectId = xmlAttribute(component, "objectid");
        if (!objectId) continue;
        object.components.push({
          modelPath: componentPath ? normalizedArchivePath(componentPath, path.split("/").slice(0, -1).join("/")) : path,
          objectId,
          transform: threeMfTransform(xmlAttribute(component, "transform"), model.unit)
        });
      }
      model.objects.set(id, object);
    }
    models.set(path, model);
  }

  const rootModel = models.get(rootPath);
  if (!rootModel) throw new Error("3MF kök modeli kullanılamıyor.");
  const build = firstChild(xmlFiles.get(rootPath)!.documentElement, "build");
  const result = new THREE.Group();
  const addObject = (parent: THREE.Group, object: ThreeMfObject, stack: Set<string>) => {
    const key = `${object.model.path}#${object.id}`;
    if (stack.has(key)) return;
    const nextStack = new Set(stack).add(key);
    if (object.mesh) {
      const mesh = new THREE.Mesh(object.mesh, new THREE.MeshStandardMaterial({ color: 0xa8c9d8, roughness: 0.68, metalness: 0.04 }));
      parent.add(mesh);
    }
    for (const component of object.components) {
      const childObject = models.get(component.modelPath)?.objects.get(component.objectId);
      if (!childObject) continue;
      const group = new THREE.Group();
      group.applyMatrix4(component.transform);
      parent.add(group);
      addObject(group, childObject, nextStack);
    }
  };
  for (const item of build ? childElements(build, "item") : []) {
    const objectId = xmlAttribute(item, "objectid");
    if (!objectId) continue;
    const itemPath = xmlAttribute(item, "path");
    const model = itemPath ? models.get(normalizedArchivePath(itemPath, rootPath.split("/").slice(0, -1).join("/"))) : rootModel;
    const object = model?.objects.get(objectId);
    if (!object) continue;
    const group = new THREE.Group();
    group.applyMatrix4(threeMfTransform(xmlAttribute(item, "transform"), rootModel.unit));
    result.add(group);
    addObject(group, object, new Set());
  }
  if (!result.children.length) throw new Error("Dosyada gösterilebilir 3D geometri bulunamadı.");
  return result;
}

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
    // Keep React-owned status and overlay children intact; Three.js owns only this canvas.
    host.appendChild(renderer.domElement);

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
          model = parseThreeMf(buffer);
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
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
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
