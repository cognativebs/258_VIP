import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const canvas = document.getElementById("canvas");

const DISCS = [
  { y: -2.35, radius: 2.55, height: 0.42, color: 0xc026ff, spin: 0.18 },
  { y: -1.05, radius: 2.2, height: 0.36, color: 0x22ff66, spin: -0.22 },
  { y: 0.25, radius: 1.95, height: 0.4, color: 0xff9a1f, spin: 0.14, hero: true },
  { y: 1.45, radius: 1.55, height: 0.3, color: 0xa855ff, spin: -0.28 },
  { y: 2.45, radius: 1.15, height: 0.26, color: 0x33d6ff, spin: 0.32 },
];

const NODE_COUNT = 11;
const NODE_RADIUS = 2.55;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x02040c, 0.045);
scene.background = new THREE.Color(0x02040c);

const camera = new THREE.PerspectiveCamera(
  42,
  window.innerWidth / window.innerHeight,
  0.1,
  120,
);
camera.position.set(0.8, 1.6, 9.2);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 4.5;
controls.maxDistance = 18;
controls.target.set(0, 0.2, 0);
controls.maxPolarAngle = Math.PI * 0.72;
controls.minPolarAngle = Math.PI * 0.18;

scene.add(new THREE.AmbientLight(0x1a2740, 0.55));
const key = new THREE.DirectionalLight(0x9ec8ff, 0.65);
key.position.set(4, 8, 6);
scene.add(key);

const root = new THREE.Group();
scene.add(root);

const discGroups = [];
const discLights = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(-10, -10);
let hoveredDisc = -1;

function makeMetalMaterial(tint = 0x1a2230) {
  return new THREE.MeshStandardMaterial({
    color: tint,
    metalness: 0.92,
    roughness: 0.28,
    envMapIntensity: 0.8,
  });
}

function makeGlowRing(radius, color, thickness = 0.06) {
  const geo = new THREE.TorusGeometry(radius, thickness, 16, 96);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.95,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function buildDisc(spec, index) {
  const group = new THREE.Group();
  group.position.y = spec.y;
  group.userData = { index, baseSpin: spec.spin, color: spec.color, hero: !!spec.hero };

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.radius, spec.radius * 1.04, spec.height, 64, 1, false),
    makeMetalMaterial(0x121826),
  );
  group.add(body);

  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.radius * 1.02, spec.radius * 1.06, spec.height * 0.35, 64, 1, true),
    makeMetalMaterial(0x243044),
  );
  group.add(rim);

  // Mechanical greeble rings
  for (let i = 0; i < 3; i++) {
    const r = spec.radius * (0.55 + i * 0.14);
    const groove = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.018, 8, 80),
      makeMetalMaterial(0x2a3548),
    );
    groove.rotation.x = Math.PI / 2;
    groove.position.y = (i % 2 === 0 ? 1 : -1) * spec.height * 0.18;
    group.add(groove);
  }

  // Spoke wedges for detail
  const spokeMat = makeMetalMaterial(0x1c2738);
  for (let s = 0; s < 8; s++) {
    const spoke = new THREE.Mesh(
      new THREE.BoxGeometry(spec.radius * 0.72, spec.height * 0.12, 0.05),
      spokeMat,
    );
    const a = (s / 8) * Math.PI * 2;
    spoke.position.set(Math.cos(a) * spec.radius * 0.38, 0, Math.sin(a) * spec.radius * 0.38);
    spoke.rotation.y = -a;
    group.add(spoke);
  }

  const topRing = makeGlowRing(spec.radius * 0.92, spec.color, 0.045);
  topRing.position.y = spec.height * 0.52;
  group.add(topRing);

  const bottomRing = makeGlowRing(spec.radius * 0.88, spec.color, 0.055);
  bottomRing.position.y = -spec.height * 0.52;
  group.add(bottomRing);

  const innerGlow = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.radius * 0.35, spec.radius * 0.35, spec.height * 0.2, 32),
    new THREE.MeshBasicMaterial({
      color: spec.color,
      transparent: true,
      opacity: 0.55,
    }),
  );
  group.add(innerGlow);

  const light = new THREE.PointLight(spec.color, spec.hero ? 4.2 : 2.2, 8, 2);
  light.position.set(0, 0, 0);
  group.add(light);
  discLights.push(light);

  // Hover target (invisible larger collider)
  const hit = new THREE.Mesh(
    new THREE.CylinderGeometry(spec.radius * 1.08, spec.radius * 1.08, spec.height * 1.4, 24),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hit.userData.discIndex = index;
  group.add(hit);
  group.userData.hit = hit;
  group.userData.rings = [topRing, bottomRing, innerGlow];
  group.userData.baseIntensity = light.intensity;

  root.add(group);
  discGroups.push(group);
  return group;
}

DISCS.forEach(buildDisc);

// Central energy beam
const beamColors = [0x22ff66, 0x22ff66, 0xff9a1f, 0xa855ff, 0x33d6ff];
const beamGroup = new THREE.Group();
root.add(beamGroup);

for (let i = 0; i < beamColors.length; i++) {
  const h = 1.15;
  const y = -2.9 + i * h + h * 0.5;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, h, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color: beamColors[i],
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  beam.position.y = y;
  beamGroup.add(beam);

  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.035, 0.035, h, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  core.position.y = y;
  beamGroup.add(core);
}

// Floor platform
const floor = new THREE.Group();
floor.position.y = -3.35;
root.add(floor);

const pad = new THREE.Mesh(
  new THREE.CylinderGeometry(3.6, 3.8, 0.08, 64),
  new THREE.MeshStandardMaterial({
    color: 0x0a1220,
    metalness: 0.85,
    roughness: 0.4,
  }),
);
floor.add(pad);

for (let i = 1; i <= 5; i++) {
  const ring = makeGlowRing(0.55 * i, 0x3a7cff, 0.012);
  ring.material.opacity = 0.35 - i * 0.04;
  ring.position.y = 0.05;
  floor.add(ring);
}

const floorGlow = new THREE.Mesh(
  new THREE.CircleGeometry(0.55, 48),
  new THREE.MeshBasicMaterial({
    color: 0x66d0ff,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }),
);
floorGlow.rotation.x = -Math.PI / 2;
floorGlow.position.y = 0.06;
floor.add(floorGlow);

// Soft fog disc at base
const mist = new THREE.Mesh(
  new THREE.CircleGeometry(5.5, 48),
  new THREE.MeshBasicMaterial({
    color: 0x1a3a70,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  }),
);
mist.rotation.x = -Math.PI / 2;
mist.position.y = -3.28;
root.add(mist);

// Starfield
{
  const count = 900;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 18 + Math.random() * 40;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) * 0.55;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const stars = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xa8c8ff,
      size: 0.04,
      transparent: true,
      opacity: 0.75,
      sizeAttenuation: true,
      depthWrite: false,
    }),
  );
  scene.add(stars);
}

function createParticleSystem({ count, yMin, yMax, radius, colors }) {
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count);
  const colorAttr = new Float32Array(count * 3);
  const c = colors.map((hex) => new THREE.Color(hex));

  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * radius;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = yMin + Math.random() * (yMax - yMin);
    positions[i * 3 + 2] = Math.sin(a) * r;
    velocities[i] = 0.4 + Math.random() * 1.2;
    const col = c[Math.floor(Math.random() * c.length)];
    colorAttr[i * 3] = col.r;
    colorAttr[i * 3 + 1] = col.g;
    colorAttr[i * 3 + 2] = col.b;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colorAttr, 3));

  const points = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.055,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    }),
  );
  points.userData = { velocities, yMin, yMax, radius };
  root.add(points);
  return points;
}

const coreParticles = createParticleSystem({
  count: 1400,
  yMin: -3.2,
  yMax: 3.6,
  radius: 0.28,
  colors: [0x22ff66, 0xff9a1f, 0x33d6ff, 0xffffff, 0xa855ff],
});

const topSpray = createParticleSystem({
  count: 500,
  yMin: 2.5,
  yMax: 5.2,
  radius: 0.55,
  colors: [0x33d6ff, 0xffe066, 0xa855ff, 0xffffff],
});

const baseSparks = createParticleSystem({
  count: 350,
  yMin: -3.2,
  yMax: -0.6,
  radius: 0.9,
  colors: [0x22ff66, 0xa8ffcc, 0xffffff],
});

// Orbiting AI nodes
function makeAITexture() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");

  ctx.clearRect(0, 0, size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 20, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,180,60,0.55)");
  g.addColorStop(0.45, "rgba(255,140,40,0.22)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "rgba(255,180,80,0.85)";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 78, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(255,220,150,0.95)";
  ctx.font = "bold 72px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = "rgba(255,160,40,0.9)";
  ctx.shadowBlur = 18;
  ctx.fillText("AI", size / 2, size / 2 + 4);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const aiTexture = makeAITexture();
const orbitGroup = new THREE.Group();
orbitGroup.position.y = 0.25;
root.add(orbitGroup);

const nodeMeshes = [];
const orbitLinePositions = [];

for (let i = 0; i < NODE_COUNT; i++) {
  const angle = (i / NODE_COUNT) * Math.PI * 2;
  const node = new THREE.Group();

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 24, 24),
    new THREE.MeshPhysicalMaterial({
      color: 0xffb04a,
      metalness: 0.1,
      roughness: 0.15,
      transmission: 0.55,
      thickness: 0.4,
      transparent: true,
      opacity: 0.85,
      emissive: 0xff8a20,
      emissiveIntensity: 0.35,
    }),
  );
  node.add(sphere);

  const label = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: aiTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  label.scale.set(0.55, 0.55, 1);
  node.add(label);

  node.position.set(Math.cos(angle) * NODE_RADIUS, 0, Math.sin(angle) * NODE_RADIUS);
  orbitGroup.add(node);
  nodeMeshes.push(node);
  orbitLinePositions.push(node.position.x, node.position.y, node.position.z);
}

// Close the ring
orbitLinePositions.push(orbitLinePositions[0], orbitLinePositions[1], orbitLinePositions[2]);

const orbitGeo = new THREE.BufferGeometry();
orbitGeo.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(orbitLinePositions, 3),
);
const orbitLine = new THREE.Line(
  orbitGeo,
  new THREE.LineBasicMaterial({
    color: 0xff9a1f,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
  }),
);
orbitGroup.add(orbitLine);

// Filaments from center to each node
const filamentPositions = [];
for (let i = 0; i < NODE_COUNT; i++) {
  const angle = (i / NODE_COUNT) * Math.PI * 2;
  filamentPositions.push(0, 0, 0);
  filamentPositions.push(Math.cos(angle) * NODE_RADIUS, 0, Math.sin(angle) * NODE_RADIUS);
}
const filamentGeo = new THREE.BufferGeometry();
filamentGeo.setAttribute("position", new THREE.Float32BufferAttribute(filamentPositions, 3));
const filaments = new THREE.LineSegments(
  filamentGeo,
  new THREE.LineBasicMaterial({
    color: 0xffb040,
    transparent: true,
    opacity: 0.28,
    blending: THREE.AdditiveBlending,
  }),
);
orbitGroup.add(filaments);

// Central hero flare (billboard)
const flareTex = (() => {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,240,1)");
  g.addColorStop(0.15, "rgba(255,180,60,0.85)");
  g.addColorStop(0.45, "rgba(255,120,20,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();

const flare = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: flareTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0.85,
  }),
);
flare.position.set(0, 0.25, 0);
flare.scale.set(3.8, 1.4, 1);
root.add(flare);

// Horizontal god-ray spokes from hero disc
const rayGroup = new THREE.Group();
rayGroup.position.y = 0.25;
root.add(rayGroup);
for (let i = 0; i < 12; i++) {
  const ray = new THREE.Mesh(
    new THREE.PlaneGeometry(6.5, 0.05),
    new THREE.MeshBasicMaterial({
      color: 0xffc060,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ray.rotation.y = (i / 12) * Math.PI;
  ray.rotation.z = (Math.random() - 0.5) * 0.08;
  rayGroup.add(ray);
}

// Post-processing bloom
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.15,
  0.55,
  0.2,
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function updateParticles(system, dt, outward = false) {
  const pos = system.geometry.attributes.position.array;
  const { velocities, yMin, yMax, radius } = system.userData;
  const count = velocities.length;

  for (let i = 0; i < count; i++) {
    pos[i * 3 + 1] += velocities[i] * dt * (outward ? 0.9 : 1.15);

    if (outward) {
      pos[i * 3] *= 1 + dt * 0.35;
      pos[i * 3 + 2] *= 1 + dt * 0.35;
    }

    if (pos[i * 3 + 1] > yMax || Math.hypot(pos[i * 3], pos[i * 3 + 2]) > radius * (outward ? 3 : 1.4)) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * (outward ? 0.35 : 1);
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = yMin + Math.random() * 0.2;
      pos[i * 3 + 2] = Math.sin(a) * r;
    }
  }
  system.geometry.attributes.position.needsUpdate = true;
}

function onPointerMove(event) {
  pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  bloom.setSize(w, h);
}

window.addEventListener("pointermove", onPointerMove);
window.addEventListener("resize", onResize);

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  const dt = Math.min(clock.getDelta(), 0.05);

  // Idle camera drift
  controls.target.x = Math.sin(t * 0.12) * 0.08;
  controls.target.y = 0.2 + Math.sin(t * 0.18) * 0.05;
  controls.update();

  // Disc spins + hover pulse
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(
    discGroups.map((g) => g.userData.hit),
    false,
  );
  hoveredDisc = hits.length ? hits[0].object.userData.discIndex : -1;

  discGroups.forEach((g, i) => {
    const boost = hoveredDisc === i ? 2.2 : 1;
    g.rotation.y += g.userData.baseSpin * dt * boost;
    const pulse = 1 + Math.sin(t * 2.4 + i) * 0.08;
    const intensity = g.userData.baseIntensity * pulse * (hoveredDisc === i ? 1.8 : 1);
    discLights[i].intensity = intensity;
    g.userData.rings.forEach((ring, ri) => {
      if (ring.material.opacity !== undefined) {
        const base = ri === 2 ? 0.55 : 0.95;
        ring.material.opacity = base * (hoveredDisc === i ? 1 : 0.85 + Math.sin(t * 3 + i) * 0.08);
      }
    });
    g.scale.setScalar(hoveredDisc === i ? 1.03 : 1);
  });

  orbitGroup.rotation.y = t * 0.35;
  rayGroup.rotation.y = -t * 0.12;
  flare.material.opacity = 0.7 + Math.sin(t * 2.2) * 0.15;
  flare.scale.set(3.6 + Math.sin(t * 1.8) * 0.25, 1.25 + Math.sin(t * 2.1) * 0.12, 1);

  nodeMeshes.forEach((n, i) => {
    n.position.y = Math.sin(t * 2 + i * 0.7) * 0.08;
  });

  updateParticles(coreParticles, dt);
  updateParticles(topSpray, dt, true);
  updateParticles(baseSparks, dt);

  beamGroup.children.forEach((child, i) => {
    if (child.material?.opacity !== undefined) {
      child.material.opacity = (i % 2 === 0 ? 0.5 : 0.3) + Math.sin(t * 3 + i) * 0.08;
    }
  });

  composer.render();
}

animate();
