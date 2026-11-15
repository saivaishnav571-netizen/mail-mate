import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const CYCLE_MS = 16000;
const HALF_PI = Math.PI / 2;

const TRAYS = [
  { label: "IMPORTANT", count: "07", color: 0xb8401a, x: -2.78, z: 0.98, yaw: 0.16 },
  { label: "ACADEMIC", count: "04", color: 0x226a62, x: -1.39, z: 0.3, yaw: 0.08 },
  { label: "INTERNSHIP", count: "04", color: 0x9b6a12, x: 0, z: 0.02, yaw: 0 },
  { label: "PERSONAL", count: "04", color: 0x536d3f, x: 1.39, z: 0.3, yaw: -0.08 },
  { label: "SPAM", count: "05", color: 0x767168, x: 2.78, z: 0.98, yaw: -0.16 }
];

export function createHeroScene(canvas, { onUnavailable } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance"
    });
  } catch {
    onUnavailable?.("webgl");
    return { setPaused() {}, isPaused: () => true, destroy() {} };
  }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = reduceMotion.matches;
  let paused = false;
  let visible = true;
  let destroyed = false;

  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 60);
  camera.position.set(0, 6.75, 13.1);
  camera.lookAt(0, 0.3, -0.05);

  const world = new THREE.Group();
  world.position.y = 0.08;
  scene.add(world);

  /* ---------- light ---------- */

  const hemi = new THREE.HemisphereLight(0xfff4de, 0x5e4d35, 1.05);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffe9c8, 3);
  key.position.set(-5.5, 9.5, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -7;
  key.shadow.camera.right = 7;
  key.shadow.camera.top = 7;
  key.shadow.camera.bottom = -7;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 28;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0xe9f0e8, 0.65);
  fill.position.set(6, 4, -2);
  scene.add(fill);

  const rim = new THREE.PointLight(0xd4531c, 12, 12, 2);
  rim.position.set(4.2, 2.6, 3.2);
  scene.add(rim);

  /* ---------- desk ---------- */

  const deskMat = new THREE.MeshStandardMaterial({
    color: 0xd3bd9e,
    roughness: 0.94,
    metalness: 0
  });
  const desk = new THREE.Mesh(new THREE.CylinderGeometry(5.05, 5.15, 0.34, 72), deskMat);
  desk.position.y = -0.19;
  desk.receiveShadow = true;
  world.add(desk);

  const grid = new THREE.GridHelper(9.4, 20, 0x9f8a68, 0xb3a080);
  grid.position.y = -0.012;
  grid.material.transparent = true;
  grid.material.opacity = 0.18;
  grid.material.depthWrite = false;
  world.add(grid);

  const arc = new THREE.Mesh(
    new THREE.RingGeometry(4.08, 4.11, 96),
    new THREE.MeshBasicMaterial({
      color: 0xb9a17c,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide
    })
  );
  arc.rotation.x = -HALF_PI;
  arc.position.y = 0.004;
  world.add(arc);

  /* ---------- trays ---------- */

  const paperMat = new THREE.MeshStandardMaterial({
    color: 0xf1e6d3,
    roughness: 0.88,
    metalness: 0
  });
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xe9dcc6,
    roughness: 0.9,
    metalness: 0
  });
  const accentMats = TRAYS.map(
    (tray) => new THREE.MeshBasicMaterial({ color: tray.color, transparent: true, opacity: 0.82 })
  );
  const labelTextures = [];
  const trayGroups = [];

  TRAYS.forEach((tray, trayIndex) => {
    const group = new THREE.Group();
    group.position.set(tray.x, 0.02, tray.z);
    group.rotation.y = tray.yaw;

    const base = new THREE.Mesh(new RoundedBoxGeometry(1.58, 0.12, 1.32, 2, 0.035), paperMat);
    base.position.y = 0.02;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const innerMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xfdf7ea).lerp(new THREE.Color(tray.color), 0.11),
      roughness: 0.92,
      metalness: 0
    });
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.1), innerMat);
    inner.rotation.x = -HALF_PI;
    inner.position.set(0, 0.083, 0.02);
    inner.receiveShadow = true;
    group.add(inner);

    const back = new THREE.Mesh(new RoundedBoxGeometry(1.58, 0.64, 0.07, 2, 0.025), wallMat);
    back.position.set(0, 0.36, -0.63);
    back.castShadow = true;
    back.receiveShadow = true;
    group.add(back);

    [-0.755, 0.755].forEach((side) => {
      const wall = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.34, 1.28, 2, 0.025), wallMat);
      wall.position.set(side, 0.21, 0.01);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    });

    const lip = new THREE.Mesh(new RoundedBoxGeometry(1.58, 0.15, 0.06, 2, 0.022), wallMat);
    lip.position.set(0, 0.15, 0.64);
    lip.castShadow = true;
    lip.receiveShadow = true;
    group.add(lip);

    const accent = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.055), accentMats[trayIndex]);
    accent.position.set(0, 0.155, 0.672);
    accent.rotation.x = 0;
    group.add(accent);

    const label = makeTrayLabel(tray);
    label.position.set(0, 0.4, -0.592);
    group.add(label);

    world.add(group);
    trayGroups.push(group);
  });

  function makeTrayLabel(tray) {
    const textureCanvas = document.createElement("canvas");
    textureCanvas.width = 512;
    textureCanvas.height = 128;
    const context = textureCanvas.getContext("2d");
    const cssColor = `#${tray.color.toString(16).padStart(6, "0")}`;

    roundedRect(context, 3, 3, 506, 122, 18);
    context.fillStyle = "#faf5e9";
    context.fill();
    context.lineWidth = 6;
    context.strokeStyle = cssColor;
    context.stroke();

    context.fillStyle = "#332b22";
    context.font = '600 42px "Arial", sans-serif';
    context.textBaseline = "middle";
    context.fillText(tray.label, 26, 65);

    context.fillStyle = cssColor;
    context.font = '600 30px "Consolas", monospace';
    context.textAlign = "right";
    context.fillText(tray.count, 484, 65);

    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    labelTextures.push(texture);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.42, 0.4),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false
      })
    );
    mesh.renderOrder = 6;
    return mesh;
  }

  /* ---------- the sorting hoop ---------- */

  const hoop = new THREE.Group();
  hoop.position.set(0, 1.98, -1.02);
  const hoopMain = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.018, 14, 80),
    new THREE.MeshBasicMaterial({ color: 0xd4531c, transparent: true, opacity: 0.88 })
  );
  const hoopHalo = new THREE.Mesh(
    new THREE.TorusGeometry(0.79, 0.007, 10, 80),
    new THREE.MeshBasicMaterial({ color: 0xd4531c, transparent: true, opacity: 0.26 })
  );
  hoop.add(hoopMain, hoopHalo);
  world.add(hoop);

  /* ---------- envelopes ---------- */

  const envelopeMat = new THREE.MeshStandardMaterial({
    color: 0xfff9ec,
    roughness: 0.84,
    metalness: 0
  });
  const flapMat = new THREE.LineBasicMaterial({
    color: 0xc1a986,
    transparent: true,
    opacity: 0.9
  });
  const addressMat = new THREE.LineBasicMaterial({
    color: 0xb7a180,
    transparent: true,
    opacity: 0.7
  });
  const stampMat = new THREE.MeshBasicMaterial({ color: 0xd4531c, transparent: true, opacity: 0.88 });
  const sealMat = new THREE.MeshBasicMaterial({ color: 0xb8401a });

  const envelopeGeometry = new RoundedBoxGeometry(1.16, 0.72, 0.042, 2, 0.018);
  const envelopes = [];
  const ENVELOPE_COUNT = 15;

  for (let index = 0; index < ENVELOPE_COUNT; index += 1) {
    const trayIndex = index % TRAYS.length;
    const slot = Math.floor(index / TRAYS.length);
    const tray = TRAYS[trayIndex];
    const group = new THREE.Group();

    const body = new THREE.Mesh(envelopeGeometry, envelopeMat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const flap = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.545, 0.325, 0.026),
        new THREE.Vector3(0, -0.02, 0.026),
        new THREE.Vector3(0.545, 0.325, 0.026)
      ]),
      flapMat
    );
    group.add(flap);

    const addressPositions = [];
    [
      [-0.46, -0.12, 0.46],
      [-0.46, -0.21, 0.34],
      [-0.46, -0.3, 0.25]
    ].forEach(([x, y, width]) => {
      addressPositions.push(x, y, 0.026, x + width, y, 0.026);
    });
    const address = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(addressPositions, 3)
      ),
      addressMat
    );
    group.add(address);

    const stamp = new THREE.Mesh(new THREE.PlaneGeometry(0.155, 0.19), stampMat);
    stamp.position.set(0.42, 0.19, 0.026);
    group.add(stamp);

    const seal = new THREE.Mesh(new THREE.CircleGeometry(0.062, 20), sealMat);
    seal.position.set(0, -0.005, 0.03);
    group.add(seal);

    const tint = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.025), accentMats[trayIndex]);
    tint.position.set(-0.48, 0.29, 0.027);
    group.add(tint);

    const seed = index * 12.9898;
    const pileX = -2.32 + Math.sin(seed) * 0.22;
    const pileZ = -2.02 + Math.cos(seed * 0.7) * 0.17;
    const pileY = 0.055 + (index % 5) * 0.048;
    const slotX = slot === 0 ? -0.26 : slot === 1 ? 0.24 : 0.02;
    const slotZ = slot === 0 ? 0.13 : slot === 1 ? -0.06 : 0.25;
    const target = new THREE.Vector3(
      tray.x + slotX + Math.sin(seed * 2.1) * 0.045,
      0.125 + slot * 0.02,
      tray.z + slotZ + Math.cos(seed * 1.7) * 0.04
    );

    envelopes.push({
      group,
      tray,
      trayIndex,
      target,
      pile: new THREE.Vector3(pileX, pileY, pileZ),
      pileYaw: Math.sin(seed * 1.3) * 0.35,
      pileRoll: Math.cos(seed) * 0.18,
      slotRoll: (index % 3 - 1) * 0.09,
      offset: (index * 0.61803398875) % 1,
      hover: 0.9 + (index % 4) * 0.1
    });
    world.add(group);
  }

  /* ---------- dust ---------- */

  const dustCount = 64;
  const dustPositions = new Float32Array(dustCount * 3);
  const dustSeeds = [];
  for (let i = 0; i < dustCount; i += 1) {
    const x = (Math.random() - 0.5) * 9;
    const y = Math.random() * 3.8 + 0.15;
    const z = (Math.random() - 0.5) * 5.5;
    dustPositions.set([x, y, z], i * 3);
    dustSeeds.push({ x, y, z, phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random() });
  }
  const dustGeometry = new THREE.BufferGeometry();
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(
    dustGeometry,
    new THREE.PointsMaterial({
      color: 0xfff0d8,
      size: 0.028,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true
    })
  );
  world.add(dust);

  /* ---------- layout ---------- */

  const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };

  function resize() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (reduced || paused) renderFrame();
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  function onPointerMove(event) {
    if (reduced) return;
    pointer.targetX = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.targetY = (event.clientY / window.innerHeight) * 2 - 1;
  }

  window.addEventListener("pointermove", onPointerMove, { passive: true });

  function onVisibilityChange() {
    visible = !document.hidden;
  }

  document.addEventListener("visibilitychange", onVisibilityChange);

  const intersectionObserver = new IntersectionObserver(
    (entries) => {
      visible = entries[0]?.isIntersecting ?? true;
    },
    { rootMargin: "120px", threshold: 0.01 }
  );
  intersectionObserver.observe(canvas);

  function onContextLost(event) {
    event.preventDefault();
    paused = true;
    onUnavailable?.("context-lost");
  }

  canvas.addEventListener("webglcontextlost", onContextLost);

  function onMotionChange(event) {
    reduced = event.matches;
    if (reduced) {
      update(8600);
      renderFrame();
    }
  }

  reduceMotion.addEventListener("change", onMotionChange);

  /* ---------- animation ---------- */

  let elapsed = 4600;
  let last = performance.now();
  let frame = 0;

  function ease(value) {
    return value * value * (3 - 2 * value);
  }

  function update(time) {
    const seconds = time * 0.001;

    envelopes.forEach((item, index) => {
      const { group, pile, target, tray } = item;
      const phase = (time / CYCLE_MS + item.offset) % 1;

      if (phase >= 0.05 && phase < 0.34) {
        const progress = (phase - 0.05) / 0.29;
        const smooth = ease(progress);
        cubicBezier(group.position, pile, new THREE.Vector3(0, 2.3, -1.02), new THREE.Vector3(
          tray.x * 0.58,
          2.55,
          tray.z * 0.55
        ), target, smooth);

        if (progress < 0.18) {
          group.rotation.x = -HALF_PI + HALF_PI * ease(progress / 0.18);
        } else if (progress > 0.74) {
          group.rotation.x = -HALF_PI * ease((progress - 0.74) / 0.26);
        } else {
          group.rotation.x = 0;
        }

        group.rotation.y =
          item.pileYaw + (tray.yaw + item.slotRoll * 0.6 - item.pileYaw) * smooth;
        group.rotation.z =
          item.pileRoll +
          (item.slotRoll - item.pileRoll) * smooth +
          Math.sin(progress * Math.PI * 2) * 0.06 * (1 - progress);
        group.scale.setScalar(1);
      } else if (phase >= 0.34 && phase < 0.93) {
        group.position.copy(target);
        group.rotation.set(-HALF_PI, tray.yaw + item.slotRoll * 0.6, item.slotRoll);
        group.scale.setScalar(1);
      } else if (phase >= 0.93) {
        group.position.copy(target);
        group.rotation.set(-HALF_PI, tray.yaw + item.slotRoll * 0.6, item.slotRoll);
        group.scale.setScalar(Math.max(0.001, 1 - ease((phase - 0.93) / 0.065)));
      } else {
        group.position.copy(pile);
        group.rotation.set(-HALF_PI, item.pileYaw, item.pileRoll);
        group.scale.setScalar(Math.max(0.001, Math.min(1, phase / 0.012)));
      }
    });

    hoop.rotation.z = Math.sin(seconds * 0.22) * 0.06;
    hoop.position.y = 1.98 + Math.sin(seconds * 0.7) * 0.03;

    pointer.x += (pointer.targetX - pointer.x) * 0.045;
    pointer.y += (pointer.targetY - pointer.y) * 0.045;
    world.rotation.y = pointer.x * 0.06 + Math.sin(seconds * 0.16) * 0.012;
    world.rotation.x = pointer.y * 0.018;

    dustSeeds.forEach((seed, index) => {
      const offset = index * 3;
      const drift = ((seconds * 0.028 * seed.speed + index * 0.037) % 1) * 3.6;
      dustPositions[offset] = seed.x + Math.sin(seconds * 0.17 + seed.phase) * 0.18;
      dustPositions[offset + 1] = 0.2 + drift;
      dustPositions[offset + 2] = seed.z + Math.cos(seconds * 0.13 + seed.phase) * 0.14;
    });
    dustGeometry.attributes.position.needsUpdate = true;
  }

  function renderFrame() {
    update(elapsed);
    renderer.render(scene, camera);
  }

  function loop(now) {
    if (destroyed) return;
    frame = requestAnimationFrame(loop);
    const dt = Math.min(now - last, 64);
    last = now;

    if (reduced) return;
    if (!paused && visible) {
      elapsed += dt;
      update(elapsed);
      renderer.render(scene, camera);
    }
  }

  resize();
  update(elapsed);
  renderer.render(scene, camera);
  frame = requestAnimationFrame(loop);

  return {
    setPaused(next) {
      paused = Boolean(next);
      last = performance.now();
      if (!paused) renderFrame();
    },
    isPaused() {
      return paused;
    },
    getReducedMotion() {
      return reduced;
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pointermove", onPointerMove);
      reduceMotion.removeEventListener("change", onMotionChange);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      labelTextures.forEach((texture) => texture.dispose());
      envelopeGeometry.dispose();
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose();
        if (object.material) {
          if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
          else object.material.dispose();
        }
      });
      renderer.dispose();
    }
  };
}

function cubicBezier(out, p0, p1, p2, p3, t) {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  out.x = uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x;
  out.y = uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y;
  out.z = uu * u * p0.z + 3 * uu * t * p1.z + 3 * u * tt * p2.z + tt * t * p3.z;
  return out;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.closePath();
}
