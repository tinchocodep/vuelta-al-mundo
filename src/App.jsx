import { useState, useEffect, useRef } from "react";
import * as THREE from "three";

/* ═══════════════════════════════════════════
   COLOR PALETTES
   ═══════════════════════════════════════════ */
const PAL = {
  carnival: ["#ff2d55","#ff6b35","#ffd23f","#06d6a0","#118ab2","#8338ec","#ff006e","#3a86ff","#fb5607","#80ed99","#c77dff","#fca311","#00f5d4","#e63946","#457b9d","#2ec4b6"],
  neon:     ["#ff00ff","#00ffff","#ff0088","#00ff88","#8800ff","#ffff00","#ff3399","#33ff99","#9933ff","#ff9933","#33ffff","#ff33ff","#00ff44","#ff0066","#6600ff","#00ffcc"],
  warm:     ["#ff595e","#ff924c","#ffca3a","#f4845f","#ff6b6b","#ee6c4d","#f7b267","#f25c54","#f27059","#f9c74f","#f8961e","#f3722c","#f94144","#e76f51","#e9c46a","#f4a261"],
  ocean:    ["#0077b6","#00b4d8","#90e0ef","#48cae4","#023e8a","#0096c7","#ade8f4","#caf0f8","#00b4d8","#48cae4","#0077b6","#90e0ef","#023e8a","#0096c7","#ade8f4","#caf0f8"],
  aurora:   ["#6a0572","#ab83a1","#e6ccbe","#5c2d91","#b721ff","#21d4fd","#3a1c71","#d76d77","#ffaf7b","#642b73","#c6426e","#00c9ff","#92fe9d","#7f00ff","#e100ff","#7c4dff"],
};
const NC = 16, NS = 8, R = 7;

/* ═══════════════════════════════════════════
   AMBIENT MUSIC BOX SOUND
   ═══════════════════════════════════════════ */
function mkSound(ref) {
  if (ref.current) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = 0.1; master.connect(ctx.destination);
    // reverb via delay
    const delay = ctx.createDelay(); delay.delayTime.value = 0.3;
    const fb = ctx.createGain(); fb.gain.value = 0.25;
    delay.connect(fb); fb.connect(delay); delay.connect(master);

    const chords = [
      [523.25, 659.25, 783.99],
      [587.33, 739.99, 880],
      [493.88, 622.25, 739.99],
      [523.25, 659.25, 783.99],
    ];
    let ci = 0;
    function play() {
      if (ctx.state === "closed") return;
      const notes = chords[ci % chords.length];
      // Pad
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = i === 0 ? "sine" : "triangle";
        o.frequency.value = f * 0.25;
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 2);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + 7);
        o.connect(g); g.connect(master); g.connect(delay);
        o.start(); o.stop(ctx.currentTime + 7);
      });
      // Music box plinks
      const plinks = [0.6, 1.4, 2.5, 3.3, 4.2];
      plinks.forEach(t => {
        setTimeout(() => {
          if (ctx.state === "closed") return;
          const freq = notes[Math.floor(Math.random() * notes.length)] * (Math.random() > 0.5 ? 2 : 4);
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = "sine"; o.frequency.value = freq;
          g.gain.setValueAtTime(0.08, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2);
          o.connect(g); g.connect(master); g.connect(delay);
          o.start(); o.stop(ctx.currentTime + 2);
        }, t * 1000);
      });
      ci++;
    }
    const iv = setInterval(play, 6000); play();
    ref.current = { ctx, iv };
  } catch (e) {}
}
function stopSound(ref) {
  if (!ref.current) return;
  clearInterval(ref.current.iv);
  try { ref.current.ctx.close(); } catch (e) {}
  ref.current = null;
}

/* ═══════════════════════════════════════════
   THREE.JS SCENE BUILDER
   ═══════════════════════════════════════════ */
function buildScene(el, stRef, camRef) {
  let W = el.clientWidth, H = el.clientHeight;
  const mob = W < 600;
  const dpr = Math.min(window.devicePixelRatio, mob ? 1.5 : 2);

  const scene = new THREE.Scene();

  const cam = new THREE.PerspectiveCamera(mob ? 58 : 45, W / H, 0.1, 300);
  const camDist = mob ? 19 : 24;
  cam.position.set(0, 4, camDist);

  const ren = new THREE.WebGLRenderer({ antialias: !mob, powerPreference: "high-performance" });
  ren.setSize(W, H); ren.setPixelRatio(dpr);
  ren.toneMapping = THREE.ACESFilmicToneMapping;
  ren.toneMappingExposure = 1.4;
  if (!mob) { ren.shadowMap.enabled = true; ren.shadowMap.type = THREE.PCFSoftShadowMap; }
  el.appendChild(ren.domElement);
  const cv = ren.domElement;
  cv.style.touchAction = "none";

  /* ─── SKY GRADIENT ─── */
  const skyGeo = new THREE.SphereGeometry(120, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x000510) },
      midColor: { value: new THREE.Color(0x0a1628) },
      botColor: { value: new THREE.Color(0x1a2840) },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor;
      varying vec3 vPos;
      void main(){
        float h = normalize(vPos).y;
        vec3 c = h > 0.0 ? mix(midColor, topColor, h) : mix(midColor, botColor, -h*0.5);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  /* ─── STARS ─── */
  const nStar = mob ? 300 : 800;
  const stGeo = new THREE.BufferGeometry();
  const stPos = new Float32Array(nStar * 3);
  const stSizes = new Float32Array(nStar);
  for (let i = 0; i < nStar; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.45;
    const r2 = 80 + Math.random() * 30;
    stPos[i*3] = r2 * Math.sin(phi) * Math.cos(theta);
    stPos[i*3+1] = r2 * Math.cos(phi) + 10;
    stPos[i*3+2] = r2 * Math.sin(phi) * Math.sin(theta);
    stSizes[i] = Math.random() * 2 + 0.5;
  }
  stGeo.setAttribute("position", new THREE.BufferAttribute(stPos, 3));
  stGeo.setAttribute("size", new THREE.BufferAttribute(stSizes, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute float size; varying float vSize; uniform float time;
      void main(){
        vSize = size;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * (200.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vSize; uniform float time;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.0, d) * (0.5 + 0.5 * sin(time * 1.5 + vSize * 10.0));
        gl_FragColor = vec4(0.9, 0.92, 1.0, a * 0.9);
      }`,
  });
  const starPts = new THREE.Points(stGeo, starMat); scene.add(starPts);

  /* ─── LIGHTS ─── */
  scene.add(new THREE.AmbientLight(0x1a2040, 0.6));
  const moon = new THREE.DirectionalLight(0x6688bb, 0.4);
  moon.position.set(-15, 25, 10); if (!mob) moon.castShadow = true; scene.add(moon);
  const warmL = new THREE.PointLight(0xffaa44, 0.8, 35); warmL.position.set(0, -2, 10); scene.add(warmL);
  const fillL = new THREE.PointLight(0x4466aa, 0.3, 30); fillL.position.set(-10, 5, -5); scene.add(fillL);

  /* ─── GROUND ─── */
  const gndMat = new THREE.MeshStandardMaterial({ color: 0x0d1520, roughness: 0.95, metalness: 0.05 });
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), gndMat);
  gnd.rotation.x = -Math.PI / 2; gnd.position.y = -4.5;
  if (!mob) gnd.receiveShadow = true; scene.add(gnd);

  // Reflective puddle
  const puddle = new THREE.Mesh(
    new THREE.CircleGeometry(6, 32),
    new THREE.MeshStandardMaterial({ color: 0x0a1525, roughness: 0.05, metalness: 0.95 })
  );
  puddle.rotation.x = -Math.PI / 2; puddle.position.set(0, -4.48, 8); scene.add(puddle);

  /* ─── FLOATING PARTICLES (dust/fireflies) ─── */
  const nPart = mob ? 40 : 80;
  const partGeo = new THREE.BufferGeometry();
  const partPos = new Float32Array(nPart * 3);
  const partVel = [];
  for (let i = 0; i < nPart; i++) {
    partPos[i*3] = (Math.random() - 0.5) * 20;
    partPos[i*3+1] = Math.random() * 15 - 3;
    partPos[i*3+2] = (Math.random() - 0.5) * 20;
    partVel.push({ x: (Math.random()-0.5)*0.005, y: Math.random()*0.008+0.002, z: (Math.random()-0.5)*0.005 });
  }
  partGeo.setAttribute("position", new THREE.BufferAttribute(partPos, 3));
  const partMat = new THREE.PointsMaterial({ color: 0xffeebb, size: mob ? 0.08 : 0.06, transparent: true, opacity: 0.6 });
  const particles = new THREE.Points(partGeo, partMat); scene.add(particles);

  /* ═══════════════════════════════════════════
     FERRIS WHEEL
     ═══════════════════════════════════════════ */
  const wheel = new THREE.Group(); wheel.position.y = 3.5; scene.add(wheel);

  // Metal material with warm copper tone
  const copper = new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.25, metalness: 0.85 });
  const copperDark = new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.35, metalness: 0.7 });

  // Outer rim
  const rimSegs = mob ? 48 : 80;
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.1, 12, rimSegs), copper));
  // Decorative inner rim
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R - 0.25, 0.035, 8, rimSegs), copperDark));
  // Tiny outer decorative ring
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.02, 6, rimSegs), copperDark));

  // Hub - more detailed
  const hubG = new THREE.Group();
  hubG.add(new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.5, 20), copper));
  hubG.add(new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 8, 20), copper));
  hubG.children[0].rotation.x = Math.PI / 2;
  // Center gem
  const centerGem = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.2, 1),
    new THREE.MeshStandardMaterial({ color: 0xc77dff, emissive: 0xc77dff, emissiveIntensity: 0.8, roughness: 0.1, metalness: 0.6 })
  );
  hubG.add(centerGem);
  wheel.add(hubG);

  // Spokes - double for realism
  for (let i = 0; i < NS; i++) {
    const a = (i / NS) * Math.PI * 2;
    [-0.08, 0.08].forEach(offset => {
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, R - 0.3, 6), copper);
      s.position.set(Math.cos(a) * (R/2), Math.sin(a) * (R/2), offset);
      s.rotation.z = a - Math.PI / 2;
      wheel.add(s);
    });
  }

  // LED bars on spokes — glowing tubes
  const bars = [];
  const initCols = PAL.carnival;
  for (let i = 0; i < NS; i++) {
    const a = (i / NS) * Math.PI * 2;
    const c = new THREE.Color(initCols[i * 2 % 16]);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 1.0,
      transparent: true, opacity: 0.85, roughness: 0.1,
    });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.8, 8), tubeMat);
    tube.position.set(Math.cos(a) * R * 0.5, Math.sin(a) * R * 0.5, 0);
    tube.rotation.z = a - Math.PI / 2;
    wheel.add(tube); bars.push(tube);
  }

  // Cabin gems — crystal-like with glow spheres
  const cabins = [], gondolas = [], cabinLights = [];
  for (let i = 0; i < NC; i++) {
    const a = (i / NC) * Math.PI * 2;
    const c = new THREE.Color(initCols[i % 16]);

    // Gem
    const gemMat = new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 1.5,
      roughness: 0.05, metalness: 0.7, transparent: true, opacity: 0.95,
    });
    const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 1), gemMat);
    gem.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    wheel.add(gem); cabins.push(gem);

    // Glow sphere around gem
    const glowMat = new THREE.MeshBasicMaterial({
      color: c, transparent: true, opacity: 0.12,
    });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.6, 12, 12), glowMat);
    glow.position.copy(gem.position);
    wheel.add(glow);

    // Point light per cabin
    const pl = new THREE.PointLight(c.getHex(), mob ? 0.3 : 0.5, mob ? 3 : 4.5);
    pl.position.copy(gem.position);
    wheel.add(pl); cabinLights.push({ light: pl, glow });

    // Wire
    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 4), copperDark);
    wire.position.set(Math.cos(a) * R, Math.sin(a) * R - 0.4, 0);
    wheel.add(wire);

    // Gondola — rounded box-like
    const gonMat = new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.5), roughness: 0.5, metalness: 0.4 });
    const gon = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), gonMat);
    gon.scale.set(1.8, 0.8, 1.2);
    gon.position.set(Math.cos(a) * R, Math.sin(a) * R - 0.7, 0);
    wheel.add(gon); gondolas.push(gon);
  }

  /* ─── SUPPORT STRUCTURE ─── */
  const legMat = new THREE.MeshStandardMaterial({ color: 0xd4a574, roughness: 0.3, metalness: 0.75 });
  const legGeo = new THREE.CylinderGeometry(0.1, 0.14, 13, 8);
  [[-2.8, 1.8, 0.2, -0.11], [2.8, 1.8, -0.2, -0.11], [-2.8, -1.8, 0.2, 0.11], [2.8, -1.8, -0.2, 0.11]]
    .forEach(([x, z, rz, rx]) => {
      const l = new THREE.Mesh(legGeo, legMat);
      l.position.set(x, -1, z); l.rotation.z = rz; l.rotation.x = rx;
      if (!mob) l.castShadow = true; scene.add(l);
    });

  // X-braces
  const brGeo = new THREE.CylinderGeometry(0.035, 0.035, 6, 6);
  [1.8, -1.8].forEach(z => {
    const b = new THREE.Mesh(brGeo, legMat);
    b.position.set(0, 0.5, z); b.rotation.z = Math.PI / 2; scene.add(b);
  });
  // Diagonal braces
  [1.8, -1.8].forEach(z => {
    const d = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 7, 4), copperDark);
    d.position.set(0, -1.5, z); d.rotation.z = 0.6; scene.add(d);
    const d2 = d.clone(); d2.rotation.z = -0.6; scene.add(d2);
  });

  // Base
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e1e30, roughness: 0.7, metalness: 0.2 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(9, 0.35, 5), baseMat);
  base.position.y = -4.35; if (!mob) base.receiveShadow = true; scene.add(base);

  // Base edge trim — golden
  const trim = new THREE.Mesh(new THREE.BoxGeometry(9.1, 0.06, 5.1), copper);
  trim.position.y = -4.15; scene.add(trim);

  // PCB boards
  for (let i = 0; i < 4; i++) {
    const pcb = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.1, 0.6),
      new THREE.MeshStandardMaterial({ color: 0x0a5a0a, roughness: 0.6 })
    );
    pcb.position.set(-2.7 + i * 1.8, -4.07, 1.5); scene.add(pcb);
    // LED on PCB
    const ledC = [0xff0000, 0x00ff00, 0x00ff00, 0xffaa00][i];
    const ledB = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 6, 6),
      new THREE.MeshStandardMaterial({ color: ledC, emissive: ledC, emissiveIntensity: 3 })
    );
    ledB.position.set(-2.5 + i * 1.8, -4.0, 1.6); scene.add(ledB);
  }

  // Ground ring of fairy lights
  const numBulbs = mob ? 20 : 32;
  const gBulbs = [];
  for (let i = 0; i < numBulbs; i++) {
    const a = (i / numBulbs) * Math.PI * 2;
    const col = new THREE.Color(initCols[i % 16]);
    const bm = new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.6, roughness: 0.2 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), bm);
    bulb.position.set(Math.cos(a) * 10, -4.3, Math.sin(a) * 10);
    scene.add(bulb); gBulbs.push(bulb);
    // Wire to ground
    if (i % 2 === 0) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 3),
        new THREE.MeshStandardMaterial({ color: 0x333333 }));
      w.position.set(Math.cos(a) * 10, -4.55, Math.sin(a) * 10);
      scene.add(w);
    }
  }

  /* ─── TOUCH / MOUSE ORBIT ─── */
  let drag = false, lx = 0, vx = 0;
  const gx = e => e.touches?.[0]?.clientX ?? e.clientX ?? 0;
  const onD = e => { drag = true; lx = gx(e); vx = 0; };
  const onM = e => { if (!drag) return; e.preventDefault(); const x = gx(e); const dx = x - lx; camRef.current += dx * 0.005; vx = dx * 0.005; lx = x; };
  const onU = () => { drag = false; };
  cv.addEventListener("mousedown", onD, { passive: true });
  cv.addEventListener("mousemove", onM, { passive: false });
  cv.addEventListener("mouseup", onU); cv.addEventListener("mouseleave", onU);
  cv.addEventListener("touchstart", onD, { passive: true });
  cv.addEventListener("touchmove", onM, { passive: false });
  cv.addEventListener("touchend", onU); cv.addEventListener("touchcancel", onU);

  /* ─── ANIMATION ─── */
  const clock = new THREE.Clock();
  let aid;

  function animate() {
    aid = requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const t = clock.getElapsedTime();
    const st = stRef.current;

    // Inertia + auto orbit
    if (!drag && Math.abs(vx) > 0.00005) { camRef.current += vx; vx *= 0.96; }
    if (!drag && Math.abs(vx) < 0.00005) camRef.current += 0.0006;

    // Wheel rotation
    if (st.running) wheel.rotation.z -= st.speed * dt * 0.5;

    // Star twinkle
    starMat.uniforms.time.value = t;

    // Particles drift
    const pp = particles.geometry.attributes.position.array;
    for (let i = 0; i < nPart; i++) {
      pp[i*3] += partVel[i].x;
      pp[i*3+1] += partVel[i].y * (0.5 + Math.sin(t + i) * 0.5);
      pp[i*3+2] += partVel[i].z;
      if (pp[i*3+1] > 14) { pp[i*3+1] = -3; pp[i*3] = (Math.random()-0.5)*20; pp[i*3+2] = (Math.random()-0.5)*20; }
    }
    particles.geometry.attributes.position.needsUpdate = true;
    partMat.opacity = 0.3 + Math.sin(t * 0.7) * 0.2;

    // Update colors
    const cols = PAL[st.theme] || PAL.carnival;
    cabins.forEach((gem, i) => {
      const c = new THREE.Color(cols[i % cols.length]);
      gem.material.color.copy(c); gem.material.emissive.copy(c);
      const sv = st.sparkle ? (0.7 + Math.sin(t * 3.5 + i * 1.3) * 0.3 + Math.random() * 0.1) : 1.0;
      gem.material.emissiveIntensity = st.brightness * sv * 1.5;
      gem.rotation.y = t * 0.6; gem.rotation.x = t * 0.4;
      if (gondolas[i]) gondolas[i].material.color.copy(c.clone().multiplyScalar(0.4));
      const cl = cabinLights[i];
      cl.light.color.copy(c); cl.light.intensity = st.brightness * sv * (mob ? 0.35 : 0.55);
      cl.glow.material.color.copy(c); cl.glow.material.opacity = st.brightness * sv * 0.1;
    });

    bars.forEach((b, i) => {
      const c = new THREE.Color(cols[(i * 2) % cols.length]);
      b.material.color.copy(c); b.material.emissive.copy(c);
      b.material.emissiveIntensity = st.brightness * (st.sparkle ? (0.5 + Math.sin(t * 4 + i * 2.5) * 0.5) : 0.8) * 1.0;
    });

    gBulbs.forEach((b, i) => {
      const c = new THREE.Color(cols[i % cols.length]);
      b.material.color.copy(c); b.material.emissive.copy(c);
      b.material.emissiveIntensity = st.brightness * (st.sparkle ? (0.3 + Math.sin(t * 2.2 + i * 0.8) * 0.7) : 0.6) * 0.7;
    });

    centerGem.rotation.y = t; centerGem.rotation.x = t * 0.7;
    centerGem.material.emissiveIntensity = 0.5 + Math.sin(t * 2) * 0.3;

    // Night / day
    if (st.nightMode) {
      skyMat.uniforms.topColor.value.set(0x000510);
      skyMat.uniforms.midColor.value.set(0x0a1628);
      skyMat.uniforms.botColor.value.set(0x1a2840);
      gndMat.color.set(0x0d1520);
      starPts.visible = true; particles.visible = true;
      warmL.intensity = 0.8;
    } else {
      skyMat.uniforms.topColor.value.set(0x4a90d9);
      skyMat.uniforms.midColor.value.set(0x87ceeb);
      skyMat.uniforms.botColor.value.set(0xc8e6f0);
      gndMat.color.set(0x4a7a4a);
      starPts.visible = false; particles.visible = false;
      warmL.intensity = 0.3;
    }

    // Camera
    const cy = 4 + Math.sin(t * 0.12) * 0.8;
    cam.position.x = Math.sin(camRef.current) * camDist;
    cam.position.z = Math.cos(camRef.current) * camDist;
    cam.position.y = cy;
    cam.lookAt(0, 2.2, 0);

    ren.render(scene, cam);
  }
  animate();

  const onR = () => { W = el.clientWidth; H = el.clientHeight; cam.aspect = W / H; cam.updateProjectionMatrix(); ren.setSize(W, H); };
  window.addEventListener("resize", onR);

  return () => {
    cancelAnimationFrame(aid); window.removeEventListener("resize", onR);
    cv.removeEventListener("mousedown",onD); cv.removeEventListener("mousemove",onM);
    cv.removeEventListener("mouseup",onU); cv.removeEventListener("mouseleave",onU);
    cv.removeEventListener("touchstart",onD); cv.removeEventListener("touchmove",onM);
    cv.removeEventListener("touchend",onU); cv.removeEventListener("touchcancel",onU);
    ren.dispose(); if (el.contains(cv)) el.removeChild(cv);
  };
}

/* ═══════════════════════════════════════════
   REACT UI
   ═══════════════════════════════════════════ */
export default function App() {
  const mountRef = useRef(null), audioRef = useRef(null), camRef = useRef(0);
  const stRef = useRef({ speed: 0.3, running: true, brightness: 1, theme: "carnival", sparkle: true, nightMode: true });

  const [speed, setSpeed] = useState(0.3);
  const [running, setRunning] = useState(true);
  const [brightness, setBrightness] = useState(100);
  const [theme, setTheme] = useState("carnival");
  const [sparkle, setSparkle] = useState(true);
  const [nightMode, setNightMode] = useState(true);
  const [soundOn, setSoundOn] = useState(false);
  const [panel, setPanel] = useState(false);

  useEffect(() => { stRef.current = { speed, running, brightness: brightness / 100, theme, sparkle, nightMode }; }, [speed, running, brightness, theme, sparkle, nightMode]);
  useEffect(() => { if (soundOn) mkSound(audioRef); else stopSound(audioRef); return () => stopSound(audioRef); }, [soundOn]);
  useEffect(() => { const c = mountRef.current; if (!c) return; return buildScene(c, stRef, camRef); }, []);

  const nm = nightMode;
  const txt = nm ? "#d8cdb8" : "#2a2a2a";
  const acc = nm ? "#d4a574" : "#b87333";
  const bg2 = nm ? "rgba(8,12,24,0.95)" : "rgba(255,255,255,0.95)";
  const bd = nm ? "rgba(212,165,116,0.15)" : "rgba(0,0,0,0.08)";

  const fab = (on) => ({
    width: 50, height: 50, borderRadius: "50%",
    border: `1.5px solid ${on ? acc : bd}`,
    background: on ? (nm ? "rgba(212,165,116,0.2)" : "rgba(184,115,51,0.15)") : (nm ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"),
    color: txt, fontSize: 22, cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
    boxShadow: nm ? "0 4px 20px rgba(0,0,0,0.5)" : "0 2px 12px rgba(0,0,0,0.1)",
    transition: "all 0.25s", userSelect: "none", WebkitTapHighlightColor: "transparent",
  });

  const btn = (on) => ({
    border: `1px solid ${on ? acc : bd}`,
    background: on ? (nm ? "rgba(212,165,116,0.18)" : "rgba(184,115,51,0.12)") : "transparent",
    color: txt, padding: "10px 16px", borderRadius: 24, cursor: "pointer",
    fontSize: 13, fontFamily: "'Palatino Linotype','Book Antiqua',serif",
    transition: "all 0.2s", userSelect: "none", WebkitTapHighlightColor: "transparent",
    minHeight: 44, display: "inline-flex", alignItems: "center", justifyContent: "center",
  });

  return (
    <div style={{ width: "100%", height: "100dvh", position: "relative", overflow: "hidden" }}>
      <div ref={mountRef} style={{ width: "100%", height: "100%", touchAction: "none" }} />

      {/* Title */}
      <div style={{ position: "absolute", top: "max(14px, env(safe-area-inset-top, 14px))", left: 0, right: 60, textAlign: "center", pointerEvents: "none", zIndex: 10 }}>
        <h1 style={{
          fontFamily: "'Palatino Linotype','Book Antiqua',Palatino,serif",
          fontSize: "clamp(14px, 3.5vw, 20px)", fontWeight: 400, letterSpacing: 5,
          color: txt, textTransform: "uppercase", margin: 0,
          textShadow: nm ? "0 0 30px rgba(212,165,116,0.2), 0 2px 4px rgba(0,0,0,0.5)" : "none",
        }}>
          ✦ La Vuelta al Mundo ✦
        </h1>
        <p style={{ fontFamily: "'Palatino Linotype',serif", fontSize: 9, color: txt, opacity: 0.35, margin: "4px 0 0", letterSpacing: 3 }}>
          DESLIZÁ PARA ORBITAR
        </p>
      </div>

      {/* FABs */}
      <div style={{ position: "absolute", top: "max(14px, env(safe-area-inset-top, 14px))", right: 10, zIndex: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        <button style={fab(running)} onClick={() => setRunning(!running)}>{running ? "⏸" : "▶"}</button>
        <button style={fab(soundOn)} onClick={() => setSoundOn(!soundOn)}>{soundOn ? "🔊" : "🔇"}</button>
        <button style={fab(false)} onClick={() => setNightMode(!nm)}>{nm ? "🌙" : "☀️"}</button>
        <button style={fab(sparkle)} onClick={() => setSparkle(!sparkle)}>{sparkle ? "✨" : "💡"}</button>
      </div>

      {/* Drawer */}
      <div style={{
        position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 20,
        transition: "transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)",
        transform: panel ? "translateY(0)" : "translateY(calc(100% - 48px))",
      }}>
        <div onClick={() => setPanel(!panel)} style={{
          height: 48, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          background: nm ? "linear-gradient(transparent, rgba(8,12,24,0.9))" : "linear-gradient(transparent, rgba(255,255,255,0.9))",
          userSelect: "none", WebkitTapHighlightColor: "transparent",
        }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: nm ? "rgba(212,165,116,0.3)" : "rgba(0,0,0,0.15)" }} />
        </div>

        <div style={{
          background: bg2, backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
          borderTop: `1px solid ${bd}`, padding: "16px 18px max(24px, env(safe-area-inset-bottom, 24px))",
          fontFamily: "'Palatino Linotype','Book Antiqua',serif", color: txt,
          maxHeight: "52dvh", overflowY: "auto", WebkitOverflowScrolling: "touch",
        }} onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>

          <div style={{ marginBottom: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.4, marginBottom: 10, letterSpacing: 1 }}>
              <span>VELOCIDAD</span><span>{speed.toFixed(1)}×</span>
            </div>
            <input type="range" min="0.05" max="3" step="0.05" value={speed}
              onChange={e => setSpeed(parseFloat(e.target.value))}
              style={{ width: "100%", height: 6, WebkitAppearance: "none", appearance: "none", background: nm ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", borderRadius: 3, outline: "none" }} />
          </div>

          <div style={{ marginBottom: 22 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.4, marginBottom: 10, letterSpacing: 1 }}>
              <span>BRILLO</span><span>{brightness}%</span>
            </div>
            <input type="range" min="10" max="200" step="5" value={brightness}
              onChange={e => setBrightness(parseInt(e.target.value))}
              style={{ width: "100%", height: 6, WebkitAppearance: "none", appearance: "none", background: nm ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)", borderRadius: 3, outline: "none" }} />
          </div>

          <div style={{ fontSize: 12, opacity: 0.4, marginBottom: 10, letterSpacing: 1 }}>TEMA</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(105px, 1fr))", gap: 8 }}>
            {Object.entries(PAL).map(([k, cols]) => (
              <button key={k} style={{ ...btn(theme === k), width: "100%", gap: 8, padding: "10px 8px" }} onClick={() => setTheme(k)}>
                <span style={{ display: "flex", gap: 3 }}>
                  {cols.slice(0, 4).map((c, j) => (
                    <span key={j} style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: c, boxShadow: theme === k ? `0 0 8px ${c}` : `0 0 3px ${c}` }} />
                  ))}
                </span>
                <span style={{ fontSize: 11, textTransform: "capitalize", opacity: 0.7 }}>{k}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance:none; appearance:none;
          width:30px; height:30px; border-radius:50%;
          background:${acc};
          box-shadow: 0 0 12px ${nm ? "rgba(212,165,116,0.4)" : "rgba(184,115,51,0.3)"}, 0 2px 6px rgba(0,0,0,0.3);
          border: 2px solid ${nm ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"};
          cursor:pointer;
        }
        input[type="range"]::-moz-range-thumb {
          width:30px; height:30px; border-radius:50%;
          background:${acc}; border: 2px solid ${nm ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.08)"};
          cursor:pointer;
        }
        *{box-sizing:border-box; -webkit-tap-highlight-color:transparent;}
        body{margin:0; overflow:hidden; overscroll-behavior:none;}
        html{overflow:hidden; overscroll-behavior:none;}
      `}</style>
    </div>
  );
}
