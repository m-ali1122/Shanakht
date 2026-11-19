"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { KEYFRAMES, onK, scrollState } from "./progress";

/* ------------------------------------------------------------------ *
 * One particle field that morphs through nine keyframes as you scroll:
 * 0 cloud · 1 three name streams merge · 2 four-bank graph · 3 one person
 * 4 mule ring · 5 token lattice · 6 block chain · 7 tampered block · 8 rest
 * ------------------------------------------------------------------ */

const K = KEYFRAMES;
const C = (hex: string) => new THREE.Color(hex);
const COL = {
  fg: C("#EEF0F6"),
  main: C("#3452FF"),
  mainLight: C("#7F90FF"),
  lime: C("#B8F04A"),
  red: C("#E5484D"),
  dim: C("#2B3152"),
  banks: ["#3452FF", "#8B5CF6", "#0EA5B7", "#D97706"].map(C),
};

// Node layout: 4 banks x (1 person record + 9 others) = 0..39,
// ring beneficiaries 40..44, hubs: remitter 45, phone fp 46, device fp 47.
const M = 48;
const RING = [40, 41, 42, 43, 44];
const RING_BANK = [0, 0, 1, 1, 3];
const HUB_REMITTER = 45;
const HUB_PHONE = 46;
const HUB_DEVICE = 47;
const isPerson = (m: number) => m < 40 && m % 10 === 0;
const bankOf = (m: number) => (m < 40 ? Math.floor(m / 10) : m < 45 ? RING_BANK[m - 40] : -1);

const BANK_CENTERS = [
  new THREE.Vector3(-3.8, 1.5, -0.5),
  new THREE.Vector3(3.6, 1.7, 0.3),
  new THREE.Vector3(-3.0, -2.1, 0.6),
  new THREE.Vector3(3.2, -1.9, -0.7),
];
const HUB_POS = [new THREE.Vector3(0.4, 2.3, 1.0), new THREE.Vector3(1.0, -1.0, 1.4), new THREE.Vector3(2.0, -2.2, 0.9)];
const MERGE = new THREE.Vector3(0.1, 0, 0);
const BLOCKS = Array.from({ length: 7 }, (_, j) => new THREE.Vector3((j - 3) * 1.75, (j - 3) * 0.12, 0));
const BLOCK_SIZE = 1.05;
const TAMPERED = 4;

// Edge types and how visible each is per keyframe.
const EDGE_W = [
  [0, 0, 0.5, 0.35, 0.14, 0, 0, 0, 0], // intra-bank
  [0, 0, 0.55, 0.95, 0.12, 0, 0, 0, 0], // person record links
  [0, 0, 0.0, 0.0, 1.0, 0, 0, 0, 0], // ring links
];
const BLOCK_W = [0, 0, 0, 0, 0, 0, 1, 1, 0];
const TAMPER_W = [0, 0, 0, 0, 0, 0, 0, 1, 0];
const OFFSET_W = [1, 1, 1, 1, 1, 1, 1, 1, 0.4];

// Camera keyframes: position and look-at target.
const CAM_P = [
  [0, 0.6, 13.5],
  [0, 0.4, 10.5],
  [0, 1.0, 12.5],
  [0, 0.6, 10.5],
  [1.2, -0.2, 9.5],
  [0, 5.2, 8.2],
  [-2.2, 2.6, 9.6],
  [1.2, 1.6, 7.8],
  [0, 0, 16],
].map((v) => new THREE.Vector3(...(v as [number, number, number])));
const CAM_T = [
  [0, 0, 0],
  [-1, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
  [0.6, -0.4, 0.6],
  [0, -1.6, 0],
  [0, 0, 0],
  [BLOCKS[TAMPERED].x - 0.4, 0.1, 0],
  [0, 0, 0],
].map((v) => new THREE.Vector3(...(v as [number, number, number])));

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function build(N: number) {
  const r = rng(20261111);
  const g = () => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(2 * Math.PI * r());
  const tmp = new THREE.Color();

  const dustPos = Array.from({ length: K }, () => new Float32Array(N * 3));
  const dustCol = Array.from({ length: K }, () => new Float32Array(N * 3));
  const dustDelay = new Float32Array(N);
  const dustRand = new Float32Array(N);

  const cols = 64;
  const rows = Math.ceil(N / cols);
  const sp = 0.32;

  const setV = (arr: Float32Array, i: number, x: number, y: number, z: number) => {
    arr[i * 3] = x;
    arr[i * 3 + 1] = y;
    arr[i * 3 + 2] = z;
  };
  const setC = (arr: Float32Array, i: number, c: THREE.Color, s = 1) => {
    arr[i * 3] = c.r * s;
    arr[i * 3 + 1] = c.g * s;
    arr[i * 3 + 2] = c.b * s;
  };

  for (let i = 0; i < N; i++) {
    dustDelay[i] = r();
    dustRand[i] = r();

    // 0 · cloud
    const th = r() * Math.PI * 2;
    const ph = Math.acos(2 * r() - 1);
    const rad = 3.2 + 6.5 * Math.pow(r(), 0.7);
    const cx = rad * Math.sin(ph) * Math.cos(th);
    const cy = rad * Math.cos(ph) * 0.55;
    const cz = rad * Math.sin(ph) * Math.sin(th) * 0.8;
    setV(dustPos[0], i, cx, cy, cz);
    tmp.copy(COL.fg).lerp(COL.mainLight, r());
    setC(dustCol[0], i, tmp, 0.45 + 0.4 * r());
    setV(dustPos[8], i, cx * 1.35, cy * 1.35, cz * 1.2);
    setC(dustCol[8], i, tmp, 0.22 + 0.2 * r());

    // 1 · three spellings flowing into one
    const s = i % 3;
    const u = Math.pow(r(), 0.85);
    const x1 = -7.5 + 10.5 * u;
    const conv = clamp01(u / 0.72);
    const spread = 0.38 * (1 - conv) + 0.05;
    const y1 = (s - 1) * 2.4 * (1 - smooth(conv)) + g() * spread;
    const z1 = (s - 1) * 0.8 * (1 - smooth(conv)) + g() * spread;
    setV(dustPos[1], i, x1, y1, z1);
    if (u > 0.72) setC(dustCol[1], i, COL.lime, 0.55 + 0.35 * r());
    else setC(dustCol[1], i, s === 0 ? COL.fg : s === 1 ? COL.mainLight : COL.banks[1], 0.5 + 0.35 * r());

    // 2..4 · records around four banks
    const b = i % 4;
    const c = BANK_CENTERS[b];
    const gx = c.x + g() * 1.35;
    const gy = c.y + g() * 1.1;
    const gz = c.z + g() * 1.2;
    setV(dustPos[2], i, gx, gy, gz);
    setC(dustCol[2], i, COL.banks[b], 0.45 + 0.35 * r());
    setV(dustPos[3], i, gx * 0.86, gy * 0.86, gz * 0.86);
    setC(dustCol[3], i, COL.banks[b], 0.28 + 0.2 * r());
    setV(dustPos[4], i, gx * 0.86, gy * 0.86, gz * 0.86);
    setC(dustCol[4], i, COL.dim, 0.8 + 0.4 * r());

    // 5 · token lattice
    const lc = i % cols;
    const lr = Math.floor(i / cols);
    const lx = (lc - cols / 2) * sp;
    const lz = (lr - rows / 2) * sp;
    setV(dustPos[5], i, lx, -1.6 + 0.16 * Math.sin(lx * 0.6) * Math.cos(lz * 0.5), lz);
    if (r() < 0.04) setC(dustCol[5], i, COL.fg, 0.55);
    else setC(dustCol[5], i, COL.mainLight, 0.32 + 0.15 * r());

    // 6..7 · blocks
    const j = i % BLOCKS.length;
    const bc = BLOCKS[j];
    const h = BLOCK_SIZE / 2;
    let px: number, py: number, pz: number;
    if (r() < 0.72) {
      const face = Math.floor(r() * 6);
      const a = (r() - 0.5) * BLOCK_SIZE;
      const bb = (r() - 0.5) * BLOCK_SIZE;
      const sgn = face % 2 ? h : -h;
      if (face < 2) [px, py, pz] = [sgn, a, bb];
      else if (face < 4) [px, py, pz] = [a, sgn, bb];
      else [px, py, pz] = [a, bb, sgn];
    } else {
      px = (r() - 0.5) * BLOCK_SIZE * 0.8;
      py = (r() - 0.5) * BLOCK_SIZE * 0.8;
      pz = (r() - 0.5) * BLOCK_SIZE * 0.8;
    }
    setV(dustPos[6], i, bc.x + px, bc.y + py, bc.z + pz);
    const blockCol = j === BLOCKS.length - 1 ? COL.lime : COL.mainLight;
    setC(dustCol[6], i, blockCol, 0.5 + 0.3 * r());
    if (j === TAMPERED) {
      setV(dustPos[7], i, bc.x + px * 1.15 + g() * 0.14, bc.y + 0.25 + py * 1.15 + g() * 0.14, bc.z + pz * 1.15 + g() * 0.14);
      setC(dustCol[7], i, COL.red, 0.6 + 0.3 * r());
    } else {
      setV(dustPos[7], i, bc.x + px, bc.y + py, bc.z + pz);
      setC(dustCol[7], i, blockCol, 0.4 + 0.25 * r());
    }
  }

  // ---- nodes ----
  const nodePos = Array.from({ length: K }, () => new Float32Array(M * 3));
  const nodeCol = Array.from({ length: K }, () => new Float32Array(M * 3));
  const nodeScale = Array.from({ length: K }, () => new Float32Array(M));
  const nodeDelay = new Float32Array(M);
  const graph: THREE.Vector3[] = [];

  for (let m = 0; m < M; m++) {
    nodeDelay[m] = r();
    const bank = bankOf(m);
    const ring = m >= 40 && m < 45;
    const hub = m >= 45;
    let p: THREE.Vector3;
    if (hub) p = HUB_POS[m - 45].clone();
    else if (ring) {
      const c = BANK_CENTERS[bank];
      p = c.clone().add(HUB_POS[1].clone().sub(c).normalize().multiplyScalar(1.15)).add(new THREE.Vector3(g() * 0.3, g() * 0.3, g() * 0.3));
    } else if (isPerson(m)) p = BANK_CENTERS[bank].clone().multiplyScalar(0.72).add(new THREE.Vector3(g() * 0.2, g() * 0.2, g() * 0.2));
    else {
      const c = BANK_CENTERS[bank];
      p = new THREE.Vector3(c.x + g() * 0.95, c.y + g() * 0.75, c.z + g() * 0.9);
    }
    graph.push(p);

    const cloud = new THREE.Vector3((r() - 0.5) * 14, (r() - 0.5) * 6, (r() - 0.5) * 8);
    const set = (k: number, v: THREE.Vector3, col: THREE.Color, sc: number, cs = 1) => {
      nodePos[k].set([v.x, v.y, v.z], m * 3);
      nodeCol[k].set([col.r * cs, col.g * cs, col.b * cs], m * 3);
      nodeScale[k][m] = sc;
    };
    const bankCol = bank >= 0 ? COL.banks[bank] : COL.fg;

    set(0, cloud, COL.fg, 0);
    set(8, cloud.clone().multiplyScalar(1.3), COL.fg, 0);
    // 1 · all wait at the merge point; one lime node is the merged name
    set(1, MERGE.clone().add(new THREE.Vector3(g() * 0.05, g() * 0.05, g() * 0.05)), m === 0 ? COL.lime : COL.fg, m === 0 ? 1.7 : 0);
    // 2 · graph
    if (hub) set(2, p, COL.red, 0);
    else if (isPerson(m)) set(2, p, tmp.copy(COL.fg).lerp(bankCol, 0.35), 1.2);
    else set(2, p, bankCol, 1);
    // 3 · the four person records become one
    if (hub) set(3, p, COL.red, 0);
    else if (isPerson(m)) set(3, new THREE.Vector3(g() * 0.03, g() * 0.03, g() * 0.03), COL.lime, 2.0);
    else set(3, p.clone().multiplyScalar(0.94), bankCol, 0.9, 0.55);
    // 4 · the ring lights up
    if (hub) set(4, p, m === HUB_REMITTER ? COL.fg : COL.red, 1.7);
    else if (ring) set(4, p.clone().lerp(HUB_POS[1], 0.4), COL.red, 1.3);
    else if (isPerson(m)) set(4, new THREE.Vector3(g() * 0.03, g() * 0.03, g() * 0.03), COL.lime, 0.9, 0.45);
    else set(4, p.clone().multiplyScalar(0.94), COL.dim, 0.75, 1.6);
    // 5 · nodes settle onto the lattice as tokens
    const gc = Math.floor((r() - 0.5) * 30);
    const gr = Math.floor((r() - 0.5) * 16);
    const lx = gc * sp;
    const lz = gr * sp;
    const tokenLime = ring || hub || isPerson(m);
    set(5, new THREE.Vector3(lx, -1.6 + 0.16 * Math.sin(lx * 0.6) * Math.cos(lz * 0.5) + 0.12, lz), tokenLime ? COL.lime : COL.mainLight, 0.75);
    // 6..7 · absorbed into blocks
    const bc = BLOCKS[m % BLOCKS.length];
    set(6, bc, COL.mainLight, 0);
    set(7, bc, COL.mainLight, 0);
  }

  // ---- edges ----
  const edges: number[] = [];
  const types: number[] = [];
  const add = (a: number, b: number, t: number) => {
    edges.push(a, b);
    types.push(t);
  };
  for (let bank = 0; bank < 4; bank++) {
    const ids = Array.from({ length: 9 }, (_, i) => bank * 10 + 1 + i);
    const seen = new Set<string>();
    for (const a of ids) {
      const near = ids.filter((b) => b !== a).sort((x, y) => graph[a].distanceTo(graph[x]) - graph[a].distanceTo(graph[y]));
      for (const b of near.slice(0, 2)) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!seen.has(key)) {
          seen.add(key);
          add(a, b, 0);
        }
      }
    }
    const person = bank * 10;
    const near = ids.slice().sort((x, y) => graph[person].distanceTo(graph[x]) - graph[person].distanceTo(graph[y]));
    for (const b of near.slice(0, 3)) add(person, b, 1);
    add(person, ((bank + 1) % 4) * 10, 1);
  }
  RING.forEach((m, i) => {
    add(HUB_REMITTER, m, 2);
    add(HUB_PHONE, m, 2);
    const bank = RING_BANK[i];
    add(m, bank * 10 + 1 + (i % 9), 0);
  });
  add(HUB_DEVICE, RING[0], 2);
  add(HUB_DEVICE, RING[4], 2);

  return { N, dustPos, dustCol, dustDelay, dustRand, nodePos, nodeCol, nodeScale, nodeDelay, edges: Uint16Array.from(edges), types: Uint8Array.from(types) };
}

const DUST_VS = /* glsl */ `
  attribute float aRand;
  uniform float uTime;
  uniform float uSize;
  uniform float uMotion;
  varying vec3 vColor;
  void main() {
    vec3 p = position;
    float t = uTime * 0.35 + aRand * 6.2831;
    p += uMotion * 0.07 * vec3(sin(t), cos(t * 1.3), sin(t * 0.7));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.55 + aRand * 0.9) / -mv.z;
    vColor = color;
  }
`;
const DUST_FS = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor, a * a);
    #include <colorspace_fragment>
  }
`;
const HALO_VS = /* glsl */ `
  attribute float aScale;
  uniform float uSize;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * aScale / -mv.z;
    vColor = color;
  }
`;
const HALO_FS = /* glsl */ `
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = exp(-d * d * 5.0) * (1.0 - smoothstep(0.85, 1.0, d));
    gl_FragColor = vec4(vColor, a * 0.55);
    #include <colorspace_fragment>
  }
`;

function World({ reduced, count }: { reduced: boolean; count: number }) {
  const data = useMemo(() => build(count), [count]);
  const { size, camera, invalidate } = useThree();

  const objs = useMemo(() => {
    const N = data.N;
    // dust
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute("position", new THREE.BufferAttribute(data.dustPos[0].slice(), 3).setUsage(THREE.DynamicDrawUsage));
    dGeo.setAttribute("color", new THREE.BufferAttribute(data.dustCol[0].slice(), 3).setUsage(THREE.DynamicDrawUsage));
    dGeo.setAttribute("aRand", new THREE.BufferAttribute(data.dustRand, 1));
    const dMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VS,
      fragmentShader: DUST_FS,
      uniforms: { uTime: { value: 0 }, uSize: { value: 40 }, uMotion: { value: reduced ? 0 : 1 } },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const dust = new THREE.Points(dGeo, dMat);
    dust.frustumCulled = false;

    // node spheres
    const sGeo = new THREE.SphereGeometry(1, 24, 16);
    const sMat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.15 });
    const spheres = new THREE.InstancedMesh(sGeo, sMat, M);
    spheres.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let m = 0; m < M; m++) spheres.setColorAt(m, COL.fg);
    spheres.frustumCulled = false;

    // node halos
    const hGeo = new THREE.BufferGeometry();
    hGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(M * 3), 3).setUsage(THREE.DynamicDrawUsage));
    hGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(M * 3), 3).setUsage(THREE.DynamicDrawUsage));
    hGeo.setAttribute("aScale", new THREE.BufferAttribute(new Float32Array(M), 1).setUsage(THREE.DynamicDrawUsage));
    const hMat = new THREE.ShaderMaterial({
      vertexShader: HALO_VS,
      fragmentShader: HALO_FS,
      uniforms: { uSize: { value: 300 } },
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const halos = new THREE.Points(hGeo, hMat);
    halos.frustumCulled = false;

    // edges
    const E = data.types.length;
    const eGeo = new THREE.BufferGeometry();
    eGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(E * 6), 3).setUsage(THREE.DynamicDrawUsage));
    eGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(E * 6), 3).setUsage(THREE.DynamicDrawUsage));
    const eMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const lines = new THREE.LineSegments(eGeo, eMat);
    lines.frustumCulled = false;

    // blocks
    const blockGroup = new THREE.Group();
    const boxGeo = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
    const edgeGeo = new THREE.EdgesGeometry(boxGeo);
    const blocks = BLOCKS.map((p, j) => {
      const g = new THREE.Group();
      g.position.copy(p);
      const face = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: j === BLOCKS.length - 1 ? COL.lime : COL.main, transparent: true, opacity: 0, depthWrite: false }));
      const edge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: j === BLOCKS.length - 1 ? COL.lime : COL.mainLight, transparent: true, opacity: 0 }));
      g.add(face, edge);
      blockGroup.add(g);
      return { g, face, edge };
    });
    const linkGeo = new THREE.BufferGeometry();
    const linkPts: number[] = [];
    for (let j = 0; j < BLOCKS.length - 1; j++) {
      const a = BLOCKS[j], b = BLOCKS[j + 1];
      linkPts.push(a.x + BLOCK_SIZE / 2, a.y, a.z, b.x - BLOCK_SIZE / 2, b.y, b.z);
    }
    linkGeo.setAttribute("position", new THREE.Float32BufferAttribute(linkPts, 3));
    const linkMat = new THREE.LineBasicMaterial({ color: COL.mainLight, transparent: true, opacity: 0 });
    blockGroup.add(new THREE.LineSegments(linkGeo, linkMat));

    return { dust, dMat, spheres, halos, hMat, lines, blockGroup, blocks, linkMat };
  }, [data, reduced]);

  useEffect(() => {
    if (!reduced) return;
    return onK(() => invalidate());
  }, [reduced, invalidate]);

  const group = useRef<THREE.Group>(null);
  const st = useRef({ cur: scrollState.k, last: -1, camP: CAM_P[0].clone(), camT: CAM_T[0].clone(), first: true, rx: 0, ry: 0 });
  const nodeNow = useMemo(() => ({ pos: new Float32Array(M * 3), col: new Float32Array(M * 3), sc: new Float32Array(M) }), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmpC = useMemo(() => new THREE.Color(), []);
  const goalP = useMemo(() => new THREE.Vector3(), []);
  const goalT = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = st.current;
    const target = scrollState.k;
    s.cur = reduced || s.first ? target : s.cur + (target - s.cur) * (1 - Math.exp(-dt * 3.4));
    if (Math.abs(target - s.cur) < 1e-4) s.cur = target;

    const a = Math.floor(Math.min(s.cur, K - 1.0001));
    const b = Math.min(a + 1, K - 1);
    const f = s.cur - a;
    const ef = smooth(f);
    const kf = (arr: number[]) => arr[a] + (arr[b] - arr[a]) * ef;

    const aspect = size.width / Math.max(1, size.height);
    const dpr = state.gl.getPixelRatio();
    objs.dMat.uniforms.uSize.value = 0.05 * size.height * dpr * (aspect < 0.8 ? 1.25 : 1);
    objs.hMat.uniforms.uSize.value = 0.32 * size.height * dpr;
    objs.dMat.uniforms.uTime.value = state.clock.elapsedTime;

    if (s.first || Math.abs(s.cur - s.last) > 1e-5) {
      s.last = s.cur;
      // dust
      const N = data.N;
      const pA = data.dustPos[a], pB = data.dustPos[b], cA = data.dustCol[a], cB = data.dustCol[b];
      const pos = objs.dust.geometry.attributes.position as THREE.BufferAttribute;
      const col = objs.dust.geometry.attributes.color as THREE.BufferAttribute;
      const P = pos.array as Float32Array, Cc = col.array as Float32Array;
      for (let i = 0; i < N; i++) {
        const l = smooth(clamp01((f - data.dustDelay[i] * 0.35) / 0.65));
        const o = i * 3;
        P[o] = pA[o] + (pB[o] - pA[o]) * l;
        P[o + 1] = pA[o + 1] + (pB[o + 1] - pA[o + 1]) * l;
        P[o + 2] = pA[o + 2] + (pB[o + 2] - pA[o + 2]) * l;
        Cc[o] = cA[o] + (cB[o] - cA[o]) * l;
        Cc[o + 1] = cA[o + 1] + (cB[o + 1] - cA[o + 1]) * l;
        Cc[o + 2] = cA[o + 2] + (cB[o + 2] - cA[o + 2]) * l;
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;

      // nodes
      const hp = objs.halos.geometry.attributes.position as THREE.BufferAttribute;
      const hc = objs.halos.geometry.attributes.color as THREE.BufferAttribute;
      const hs = objs.halos.geometry.attributes.aScale as THREE.BufferAttribute;
      for (let m = 0; m < M; m++) {
        const l = smooth(clamp01((f - data.nodeDelay[m] * 0.25) / 0.75));
        const o = m * 3;
        for (let q = 0; q < 3; q++) {
          nodeNow.pos[o + q] = data.nodePos[a][o + q] + (data.nodePos[b][o + q] - data.nodePos[a][o + q]) * l;
          nodeNow.col[o + q] = data.nodeCol[a][o + q] + (data.nodeCol[b][o + q] - data.nodeCol[a][o + q]) * l;
        }
        const sc = data.nodeScale[a][m] + (data.nodeScale[b][m] - data.nodeScale[a][m]) * l;
        nodeNow.sc[m] = sc;
        dummy.position.set(nodeNow.pos[o], nodeNow.pos[o + 1], nodeNow.pos[o + 2]);
        dummy.scale.setScalar(Math.max(0.0001, sc * 0.11));
        dummy.updateMatrix();
        objs.spheres.setMatrixAt(m, dummy.matrix);
        tmpC.setRGB(nodeNow.col[o], nodeNow.col[o + 1], nodeNow.col[o + 2]);
        objs.spheres.setColorAt(m, tmpC);
        (hp.array as Float32Array).set([nodeNow.pos[o], nodeNow.pos[o + 1], nodeNow.pos[o + 2]], o);
        (hc.array as Float32Array).set([nodeNow.col[o], nodeNow.col[o + 1], nodeNow.col[o + 2]], o);
        (hs.array as Float32Array)[m] = sc;
      }
      objs.spheres.instanceMatrix.needsUpdate = true;
      if (objs.spheres.instanceColor) objs.spheres.instanceColor.needsUpdate = true;
      hp.needsUpdate = hc.needsUpdate = hs.needsUpdate = true;

      // edges
      const w = EDGE_W.map(kf);
      const ep = objs.lines.geometry.attributes.position as THREE.BufferAttribute;
      const ec = objs.lines.geometry.attributes.color as THREE.BufferAttribute;
      const EP = ep.array as Float32Array, EC = ec.array as Float32Array;
      for (let e = 0; e < data.types.length; e++) {
        const i = data.edges[e * 2], j = data.edges[e * 2 + 1];
        const vis = w[data.types[e]] * Math.min(1, nodeNow.sc[i] * 2) * Math.min(1, nodeNow.sc[j] * 2);
        for (let q = 0; q < 3; q++) {
          EP[e * 6 + q] = nodeNow.pos[i * 3 + q];
          EP[e * 6 + 3 + q] = nodeNow.pos[j * 3 + q];
          EC[e * 6 + q] = nodeNow.col[i * 3 + q] * vis;
          EC[e * 6 + 3 + q] = nodeNow.col[j * 3 + q] * vis;
        }
      }
      ep.needsUpdate = ec.needsUpdate = true;

      // blocks
      const wb = kf(BLOCK_W);
      const wt = kf(TAMPER_W);
      objs.blockGroup.visible = wb > 0.01;
      objs.blocks.forEach(({ g, face, edge }, j) => {
        (face.material as THREE.MeshBasicMaterial).opacity = 0.07 * wb;
        const em = edge.material as THREE.LineBasicMaterial;
        em.opacity = 0.85 * wb;
        g.scale.setScalar(0.85 + 0.15 * wb);
        if (j === TAMPERED) {
          em.color.copy(COL.mainLight).lerp(COL.red, wt);
          (face.material as THREE.MeshBasicMaterial).color.copy(COL.main).lerp(COL.red, wt);
          g.position.y = BLOCKS[j].y + 0.25 * wt;
          g.rotation.z = 0.12 * wt;
        }
      });
      objs.linkMat.opacity = 0.5 * wb;
    }

    // camera, shifted so the focus sits beside the text column on wide screens
    goalP.copy(CAM_P[a]).lerp(CAM_P[b], ef);
    goalT.copy(CAM_T[a]).lerp(CAM_T[b], ef);
    if (aspect < 1) {
      const mul = 1.15 + (1 - aspect) * 0.9;
      goalP.sub(goalT).multiplyScalar(mul).add(goalT);
    }
    const k = reduced || s.first ? 1 : 1 - Math.exp(-dt * 5);
    s.camP.lerp(goalP, k);
    s.camT.lerp(goalT, k);
    camera.position.copy(s.camP);
    camera.lookAt(s.camT);

    if (group.current) {
      const wide = aspect > 1.1 ? Math.min(1, (aspect - 1.1) / 0.5) : 0;
      group.current.position.x = 2.6 * wide * kf(OFFSET_W);
      if (!reduced) {
        const t = state.clock.elapsedTime;
        s.ry += (state.pointer.x * 0.12 + Math.sin(t * 0.12) * 0.12 - s.ry) * (1 - Math.exp(-dt * 2));
        s.rx += (-state.pointer.y * 0.05 - s.rx) * (1 - Math.exp(-dt * 2));
        group.current.rotation.set(s.rx, s.ry, 0);
      }
    }
    s.first = false;
  });

  return (
    <>
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 6, 8]} intensity={2.2} />
      <pointLight position={[-6, -3, 4]} intensity={18} color="#3452FF" />
      <group ref={group}>
        <primitive object={objs.dust} />
        <primitive object={objs.lines} />
        <primitive object={objs.halos} />
        <primitive object={objs.spheres} />
        <primitive object={objs.blockGroup} />
      </group>
    </>
  );
}

export default function Scene() {
  const [visible, setVisible] = useState(true);
  const [{ reduced, count }] = useState(() => ({
    reduced: typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    count: typeof window !== "undefined" && window.innerWidth < 720 ? 1400 : 2600,
  }));

  useEffect(() => {
    const f = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);

  return (
    <Canvas
      flat
      dpr={[1, 1.5]}
      frameloop={!visible ? "never" : reduced ? "demand" : "always"}
      camera={{ fov: 40, position: [0, 0.6, 13.5], near: 0.1, far: 100 }}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => gl.setClearColor("#0A0C14", 1)}
      eventSource={typeof document !== "undefined" ? document.body : undefined}
      eventPrefix="client"
    >
      <World reduced={reduced} count={count} />
    </Canvas>
  );
}
