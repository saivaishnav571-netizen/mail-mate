import * as THREE from "three";

const COLORS = [0xb8401a, 0x226a62, 0x9b6a12, 0x536d3f, 0x767168];
const LABELS = ["IMPORTANT", "ACADEMIC", "INTERNSHIP", "PERSONAL", "SPAM"];

export function createDashboardScene(canvas) {
  if (!canvas) return { updateCounts() {}, destroy() {} };
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  } catch {
    canvas.dataset.sceneFallback = "true";
    return { updateCounts() {}, destroy() {} };
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  camera.position.set(0, 3.2, 10.4);
  camera.lookAt(0, 0, 0);
  renderer.setClearColor(0, 0, 0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));

  scene.add(new THREE.HemisphereLight(0xfff4df, 0x574634, 1.8));
  const key = new THREE.PointLight(0xffd7a2, 24, 20);
  key.position.set(-3, 5, 5);
  scene.add(key);
  const rim = new THREE.PointLight(0xd4531c, 10, 12);
  rim.position.set(4, 1, -2);
  scene.add(rim);

  const root = new THREE.Group();
  scene.add(root);
  const orbitGroup = new THREE.Group();
  root.add(orbitGroup);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.1, 0.012, 8, 160),
    new THREE.MeshBasicMaterial({ color: 0xc5a67b, transparent: true, opacity: 0.55 })
  );
  ring.rotation.x = Math.PI * 0.32;
  orbitGroup.add(ring);
  const innerRing = new THREE.Mesh(
    new THREE.TorusGeometry(2.05, 0.009, 8, 128),
    new THREE.MeshBasicMaterial({ color: 0xd4531c, transparent: true, opacity: 0.28 })
  );
  innerRing.rotation.x = -Math.PI * 0.28;
  orbitGroup.add(innerRing);

  const nodes = [];
  const nodeGeometry = new THREE.SphereGeometry(0.13, 16, 12);
  const haloGeometry = new THREE.TorusGeometry(0.24, 0.009, 6, 48);
  LABELS.forEach((label, i) => {
    const angle = (i / LABELS.length) * Math.PI * 2 - Math.PI / 2;
    const position = new THREE.Vector3(Math.cos(angle) * 3.1, Math.sin(angle) * 0.72, Math.sin(angle) * 1.5);
    const material = new THREE.MeshStandardMaterial({ color: COLORS[i], emissive: COLORS[i], emissiveIntensity: 0.22, roughness: 0.36 });
    const node = new THREE.Mesh(nodeGeometry, material);
    node.position.copy(position);
    node.scale.setScalar(0.75);
    orbitGroup.add(node);
    const halo = new THREE.Mesh(haloGeometry, new THREE.MeshBasicMaterial({ color: COLORS[i], transparent: true, opacity: 0.52 }));
    halo.position.copy(position);
    halo.rotation.x = Math.PI * 0.25;
    orbitGroup.add(halo);
    nodes.push({ node, halo, material, label });
  });

  const mailMaterial = new THREE.MeshStandardMaterial({ color: 0xfff4df, roughness: 0.5, metalness: 0.08 });
  const envelopeGeometry = new THREE.BoxGeometry(0.62, 0.42, 0.08);
  const flapGeometry = new THREE.BufferGeometry();
  flapGeometry.setAttribute("position", new THREE.Float32BufferAttribute([-.31,.21,.05, 0,0,.05, .31,.21,.05], 3));
  const flap = new THREE.Line(flapGeometry, new THREE.LineBasicMaterial({ color: 0xb99d75, transparent: true, opacity: 0.75 }));
  const envelopes = Array.from({ length: 9 }, (_, i) => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(envelopeGeometry, mailMaterial);
    body.castShadow = false;
    group.add(body);
    group.add(flap.clone());
    const stamp = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.018), new THREE.MeshBasicMaterial({ color: COLORS[i % COLORS.length] }));
    stamp.position.set(0.22, 0.12, 0.052);
    group.add(stamp);
    group.userData.phase = (i / envelopesSafeLength(9)) * Math.PI * 2;
    group.userData.bucket = i % COLORS.length;
    root.add(group);
    return group;
  });

  const dustGeometry = new THREE.BufferGeometry();
  const dustPositions = new Float32Array(90 * 3);
  for (let i = 0; i < 90; i++) {
    dustPositions[i * 3] = (Math.random() - 0.5) * 8;
    dustPositions[i * 3 + 1] = (Math.random() - 0.5) * 2.3;
    dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 3;
  }
  dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
  const dust = new THREE.Points(dustGeometry, new THREE.PointsMaterial({ color: 0xb98c58, size: 0.025, transparent: true, opacity: 0.48 }));
  root.add(dust);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let visible = true, paused = reducedMotion.matches, destroyed = false, frame = 0, last = 0;
  let counts = [0, 0, 0, 0, 0];
  const countScales = [0.75, 0.75, 0.75, 0.75, 0.75];
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    renderer.setSize(rect.width, rect.height, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
  visibility.observe(canvas);

  function animate(now = 0) {
    if (destroyed) return;
    frame = requestAnimationFrame(animate);
    if (!visible || paused || now - last < 32) return;
    last = now;
    const t = now * 0.00045;
    orbitGroup.rotation.y = Math.sin(t * 0.55) * 0.13;
    orbitGroup.rotation.z = Math.sin(t * 0.4) * 0.045;
    ring.rotation.z += 0.0009;
    innerRing.rotation.z -= 0.0012;
    dust.rotation.y = t * 0.06;
    envelopes.forEach((mail, i) => {
      const phase = t + mail.userData.phase;
      const angle = phase * 0.72 + i * 0.7;
      const r = 1.65 + Math.sin(phase * 1.1) * 0.36;
      mail.position.set(Math.cos(angle) * r, Math.sin(phase * 1.5) * 0.34, Math.sin(angle) * 0.6);
      mail.rotation.set(Math.sin(phase) * 0.16, angle + Math.PI / 2, Math.cos(phase * 0.7) * 0.22);
      const bucket = mail.userData.bucket;
      mail.children[0].material = mailMaterial;
      mail.children[2].material.color.setHex(COLORS[bucket]);
      mail.scale.setScalar(0.82 + Math.sin(phase * 2) * 0.05);
    });
    nodes.forEach(({ node, halo, material }, i) => {
      const pulse = 0.9 + Math.sin(t * 2.2 + i) * 0.11;
      node.scale.setScalar(pulse * countScales[i]);
      halo.rotation.z += 0.006 + i * 0.0006;
      material.emissiveIntensity = 0.14 + Math.max(0, Math.sin(t * 2 + i)) * 0.28;
    });
    renderer.render(scene, camera);
  }
  frame = requestAnimationFrame(animate);
  reducedMotion.addEventListener("change", (e) => { paused = e.matches; if (!paused) last = 0; });
  function updateCounts(next) {
    if (Array.isArray(next)) counts = next.slice(0, 5);
    nodes.forEach(({ node }, i) => {
      countScales[i] = 0.75 + Math.min(1, (counts[i] || 0) / 8) * 0.25;
      node.scale.setScalar(countScales[i]);
    });
  }
  function destroy() {
    destroyed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    visibility.disconnect();
    scene.traverse((obj) => {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
      else obj.material?.dispose();
    });
    renderer.dispose();
  }
  return { updateCounts, destroy };
}

function envelopesSafeLength(n) { return Math.max(1, n); }
