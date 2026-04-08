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
const NC = 24, NS = 12, R = 7;

/* ═══════════════════════════════════════════
   AMBIENT MUSIC BOX SOUND
   ═══════════════════════════════════════════ */
function mkSound(ref) {
  if (ref.current) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain(); master.gain.value = 0.1; master.connect(ctx.destination);
    const delay = ctx.createDelay(); delay.delayTime.value = 0.3;
    const fb = ctx.createGain(); fb.gain.value = 0.25;
    delay.connect(fb); fb.connect(delay); delay.connect(master);
    const chords = [[523.25,659.25,783.99],[587.33,739.99,880],[493.88,622.25,739.99],[523.25,659.25,783.99]];
    let ci = 0;
    function play() {
      if (ctx.state === "closed") return;
      const notes = chords[ci % chords.length];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = i === 0 ? "sine" : "triangle"; o.frequency.value = f * 0.25;
        g.gain.setValueAtTime(0, ctx.currentTime);
        g.gain.linearRampToValueAtTime(0.04, ctx.currentTime + 2);
        g.gain.linearRampToValueAtTime(0, ctx.currentTime + 7);
        o.connect(g); g.connect(master); g.connect(delay); o.start(); o.stop(ctx.currentTime + 7);
      });
      [0.6,1.4,2.5,3.3,4.2].forEach(t => {
        setTimeout(() => {
          if (ctx.state === "closed") return;
          const freq = notes[Math.floor(Math.random()*notes.length)] * (Math.random()>0.5?2:4);
          const o = ctx.createOscillator(), g = ctx.createGain();
          o.type = "sine"; o.frequency.value = freq;
          g.gain.setValueAtTime(0.08, ctx.currentTime);
          g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2);
          o.connect(g); g.connect(master); g.connect(delay); o.start(); o.stop(ctx.currentTime + 2);
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
   PROCEDURAL ENV MAP (for realistic reflections)
   ═══════════════════════════════════════════ */
function makeEnvMap(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  // Gradient sky dome
  const skyGeo = new THREE.SphereGeometry(50, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      varying vec3 vPos;
      void main(){
        float h = normalize(vPos).y;
        vec3 top = vec3(0.05, 0.1, 0.3);
        vec3 mid = vec3(0.15, 0.2, 0.4);
        vec3 bot = vec3(0.02, 0.03, 0.08);
        vec3 c = h > 0.0 ? mix(mid, top, h) : mix(mid, bot, -h);
        // Warm glow from below (ground bounce)
        c += vec3(0.08, 0.04, 0.02) * max(0.0, -h + 0.3);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  envScene.add(new THREE.Mesh(skyGeo, skyMat));
  // Add some bright spots for specular highlights
  const bulbGeo = new THREE.SphereGeometry(2, 8, 8);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffcc });
  const b1 = new THREE.Mesh(bulbGeo, bulbMat); b1.position.set(20, 15, 10); envScene.add(b1);
  const b2 = new THREE.Mesh(bulbGeo, bulbMat.clone()); b2.material.color.set(0xaaccff);
  b2.position.set(-15, 20, -10); envScene.add(b2);

  const rt = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  return rt.texture;
}

/* ═══════════════════════════════════════════
   GONDOLA BUILDER — realistic enclosed capsule
   ═══════════════════════════════════════════ */
function buildGondola(color, envMap) {
  const group = new THREE.Group();

  // Main capsule body — rounded
  const bodyShape = new THREE.Shape();
  const w = 0.32, h = 0.5, r2 = 0.08;
  bodyShape.moveTo(-w + r2, -h);
  bodyShape.lineTo(w - r2, -h);
  bodyShape.quadraticCurveTo(w, -h, w, -h + r2);
  bodyShape.lineTo(w, h * 0.3);
  bodyShape.quadraticCurveTo(w, h * 0.5, w * 0.7, h * 0.55);
  bodyShape.lineTo(-w * 0.7, h * 0.55);
  bodyShape.quadraticCurveTo(-w, h * 0.5, -w, h * 0.3);
  bodyShape.lineTo(-w, -h + r2);
  bodyShape.quadraticCurveTo(-w, -h, -w + r2, -h);

  const extrudeSettings = { depth: 0.35, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3 };
  const bodyGeo = new THREE.ExtrudeGeometry(bodyShape, extrudeSettings);
  bodyGeo.center();

  const bodyCol = new THREE.Color(color);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyCol,
    roughness: 0.35,
    metalness: 0.15,
    envMap,
    envMapIntensity: 0.8,
  });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  group.add(body);

  // Window band — glass strip
  const windowGeo = new THREE.BoxGeometry(0.58, 0.18, 0.38);
  const windowMat = new THREE.MeshStandardMaterial({
    color: 0x88ccff,
    roughness: 0.05,
    metalness: 0.3,
    transparent: true,
    opacity: 0.5,
    envMap,
    envMapIntensity: 1.5,
  });
  const win = new THREE.Mesh(windowGeo, windowMat);
  win.position.y = 0.08;
  group.add(win);

  // Roof cap
  const roofGeo = new THREE.CylinderGeometry(0.22, 0.32, 0.06, 12);
  const roofMat = new THREE.MeshStandardMaterial({ color: bodyCol.clone().multiplyScalar(0.6), roughness: 0.4, metalness: 0.5, envMap });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.y = 0.32;
  group.add(roof);

  // Floor
  const floorGeo = new THREE.CylinderGeometry(0.3, 0.28, 0.04, 12);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 0.7, metalness: 0.3, envMap });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.3;
  group.add(floor);

  // Interior warm light
  const intLight = new THREE.PointLight(new THREE.Color(color).lerp(new THREE.Color(0xffeedd), 0.5).getHex(), 0.4, 2.5);
  intLight.position.y = 0;
  group.add(intLight);

  return { group, bodyMat, windowMat, intLight };
}

/* ═══════════════════════════════════════════
   THREE.JS SCENE BUILDER
   ═══════════════════════════════════════════ */
function buildScene(el, stRef, camRef) {
  let W = el.clientWidth, H = el.clientHeight;
  const mob = W < 600;
  const dpr = Math.min(window.devicePixelRatio, mob ? 1.5 : 2);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x060a18, 0.012);

  const cam = new THREE.PerspectiveCamera(mob ? 55 : 42, W / H, 0.1, 300);
  const camDist = mob ? 22 : 28;
  cam.position.set(0, 5, camDist);

  const ren = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  ren.setSize(W, H); ren.setPixelRatio(dpr);
  ren.toneMapping = THREE.ACESFilmicToneMapping;
  ren.toneMappingExposure = 1.2;
  ren.shadowMap.enabled = true;
  ren.shadowMap.type = THREE.PCFSoftShadowMap;
  ren.outputColorSpace = THREE.SRGBColorSpace;
  el.appendChild(ren.domElement);
  const cv = ren.domElement;
  cv.style.touchAction = "none";

  // Environment map for reflections
  const envMap = makeEnvMap(ren);
  scene.environment = envMap;

  /* ─── SKY GRADIENT ─── */
  const skyGeo = new THREE.SphereGeometry(150, 64, 32);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      topColor: { value: new THREE.Color(0x000818) },
      midColor: { value: new THREE.Color(0x0c1a35) },
      botColor: { value: new THREE.Color(0x1a2850) },
      horizonGlow: { value: new THREE.Color(0x2a1520) },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `
      uniform vec3 topColor, midColor, botColor, horizonGlow;
      varying vec3 vPos;
      void main(){
        float h = normalize(vPos).y;
        vec3 c;
        if (h > 0.0) {
          c = mix(midColor, topColor, smoothstep(0.0, 0.8, h));
        } else {
          c = mix(midColor, botColor, smoothstep(0.0, -0.5, h));
        }
        // Warm horizon glow
        float horizonFactor = exp(-abs(h) * 8.0);
        c += horizonGlow * horizonFactor * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  /* ─── STARS ─── */
  const nStar = mob ? 400 : 1200;
  const stGeo = new THREE.BufferGeometry();
  const stPos = new Float32Array(nStar * 3);
  const stSizes = new Float32Array(nStar);
  const stBright = new Float32Array(nStar);
  for (let i = 0; i < nStar; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.5;
    const r3 = 90 + Math.random() * 40;
    stPos[i*3] = r3 * Math.sin(phi) * Math.cos(theta);
    stPos[i*3+1] = r3 * Math.cos(phi) + 10;
    stPos[i*3+2] = r3 * Math.sin(phi) * Math.sin(theta);
    stSizes[i] = Math.random() * 2.5 + 0.3;
    stBright[i] = Math.random();
  }
  stGeo.setAttribute("position", new THREE.BufferAttribute(stPos, 3));
  stGeo.setAttribute("size", new THREE.BufferAttribute(stSizes, 1));
  stGeo.setAttribute("brightness", new THREE.BufferAttribute(stBright, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute float size; attribute float brightness;
      varying float vSize; varying float vBright;
      void main(){
        vSize = size; vBright = brightness;
        vec4 mv = modelViewMatrix * vec4(position,1.0);
        gl_PointSize = size * (250.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vSize; varying float vBright;
      uniform float time;
      void main(){
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float core = exp(-d * d * 8.0);
        float halo = exp(-d * d * 2.0) * 0.3;
        float twinkle = 0.6 + 0.4 * sin(time * (1.0 + vBright * 3.0) + vBright * 50.0);
        float a = (core + halo) * twinkle;
        vec3 c = mix(vec3(0.8, 0.85, 1.0), vec3(1.0, 0.95, 0.8), vBright);
        gl_FragColor = vec4(c, a * 0.85);
      }`,
  });
  const starPts = new THREE.Points(stGeo, starMat); scene.add(starPts);

  /* ─── LIGHTS — cinematic 3-point + practicals ─── */
  // Ambient fill
  const ambLight = new THREE.AmbientLight(0x1a2040, 0.4);
  scene.add(ambLight);

  // Key light — moonlight from above-right
  const keyLight = new THREE.DirectionalLight(0x6688cc, 0.6);
  keyLight.position.set(-10, 30, 15);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 1; keyLight.shadow.camera.far = 60;
  keyLight.shadow.camera.left = -15; keyLight.shadow.camera.right = 15;
  keyLight.shadow.camera.top = 20; keyLight.shadow.camera.bottom = -10;
  keyLight.shadow.bias = -0.001;
  keyLight.shadow.radius = 4;
  scene.add(keyLight);

  // Fill light — warm from below-front
  const fillLight = new THREE.PointLight(0xffaa55, 0.6, 40);
  fillLight.position.set(0, -3, 12);
  scene.add(fillLight);

  // Rim light — cool from behind
  const rimLight = new THREE.PointLight(0x4466cc, 0.4, 35);
  rimLight.position.set(-12, 8, -10);
  scene.add(rimLight);

  // Practical warm lights at base
  const baseWarm1 = new THREE.PointLight(0xff8844, 0.5, 12);
  baseWarm1.position.set(-3, -3.5, 3);
  scene.add(baseWarm1);
  const baseWarm2 = new THREE.PointLight(0xff8844, 0.5, 12);
  baseWarm2.position.set(3, -3.5, 3);
  scene.add(baseWarm2);

  /* ─── GROUND ─── */
  // Main ground plane with subtle texture
  const gndGeo = new THREE.PlaneGeometry(120, 120, 64, 64);
  // Displace slightly for terrain feel
  const gndPos = gndGeo.attributes.position;
  for (let i = 0; i < gndPos.count; i++) {
    const x = gndPos.getX(i), z = gndPos.getY(i);
    const dist = Math.sqrt(x*x + z*z);
    if (dist > 8) {
      gndPos.setZ(i, (Math.sin(x*0.3)*Math.cos(z*0.4)*0.15 + Math.random()*0.02));
    }
  }
  gndGeo.computeVertexNormals();
  const gndMat = new THREE.MeshStandardMaterial({
    color: 0x0e1822,
    roughness: 0.85,
    metalness: 0.05,
    envMap,
    envMapIntensity: 0.3,
  });
  const gnd = new THREE.Mesh(gndGeo, gndMat);
  gnd.rotation.x = -Math.PI / 2; gnd.position.y = -4.5;
  gnd.receiveShadow = true; scene.add(gnd);

  // Paved area under the wheel
  const pavedGeo = new THREE.CircleGeometry(11, 48);
  const pavedMat = new THREE.MeshStandardMaterial({
    color: 0x1a1e28,
    roughness: 0.6,
    metalness: 0.1,
    envMap,
    envMapIntensity: 0.5,
  });
  const paved = new THREE.Mesh(pavedGeo, pavedMat);
  paved.rotation.x = -Math.PI / 2; paved.position.y = -4.48;
  paved.receiveShadow = true; scene.add(paved);

  // Reflective wet puddle
  const puddleGeo = new THREE.CircleGeometry(4.5, 48);
  const puddleMat = new THREE.MeshStandardMaterial({
    color: 0x0a1520,
    roughness: 0.02,
    metalness: 0.95,
    envMap,
    envMapIntensity: 2.0,
  });
  const puddle = new THREE.Mesh(puddleGeo, puddleMat);
  puddle.rotation.x = -Math.PI / 2; puddle.position.set(2, -4.47, 9);
  scene.add(puddle);

  /* ─── FLOATING PARTICLES ─── */
  const nPart = mob ? 50 : 100;
  const partGeo = new THREE.BufferGeometry();
  const partPos = new Float32Array(nPart * 3);
  const partVel = [];
  for (let i = 0; i < nPart; i++) {
    partPos[i*3] = (Math.random()-0.5)*24;
    partPos[i*3+1] = Math.random()*18 - 4;
    partPos[i*3+2] = (Math.random()-0.5)*24;
    partVel.push({ x:(Math.random()-0.5)*0.004, y:Math.random()*0.006+0.001, z:(Math.random()-0.5)*0.004 });
  }
  partGeo.setAttribute("position", new THREE.BufferAttribute(partPos, 3));
  const partMat = new THREE.PointsMaterial({ color: 0xffeebb, size: 0.05, transparent: true, opacity: 0.5, depthWrite: false });
  const particles = new THREE.Points(partGeo, partMat); scene.add(particles);

  /* ═══════════════════════════════════════════
     FERRIS WHEEL — realistic steel structure
     ═══════════════════════════════════════════ */
  const wheel = new THREE.Group(); wheel.position.y = 3.5; scene.add(wheel);

  // Steel materials
  const steelLight = new THREE.MeshStandardMaterial({
    color: 0xc8c8d0, roughness: 0.25, metalness: 0.9, envMap, envMapIntensity: 1.2,
  });
  const steelDark = new THREE.MeshStandardMaterial({
    color: 0x888890, roughness: 0.35, metalness: 0.85, envMap, envMapIntensity: 1.0,
  });
  const steelWarm = new THREE.MeshStandardMaterial({
    color: 0xb0a090, roughness: 0.3, metalness: 0.8, envMap, envMapIntensity: 1.0,
  });

  // Outer rim — thick structural ring
  const rimSegs = mob ? 64 : 96;
  const outerRim = new THREE.Mesh(new THREE.TorusGeometry(R, 0.14, 16, rimSegs), steelLight);
  outerRim.castShadow = true;
  wheel.add(outerRim);
  // Inner decorative rim
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R - 0.22, 0.06, 10, rimSegs), steelDark));
  // Outer rail
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.18, 0.04, 8, rimSegs), steelDark));

  // Hub — detailed multi-part center
  const hubGroup = new THREE.Group();
  // Main hub cylinder
  const hubBody = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.7, 24), steelLight);
  hubBody.rotation.x = Math.PI / 2;
  hubBody.castShadow = true;
  hubGroup.add(hubBody);
  // Hub flanges
  [-0.38, 0.38].forEach(z => {
    const flange = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.06, 24), steelDark);
    flange.rotation.x = Math.PI / 2; flange.position.z = z;
    hubGroup.add(flange);
  });
  // Hub bolts
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 8), steelWarm);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(Math.cos(a) * 0.65, Math.sin(a) * 0.65, 0.4);
    hubGroup.add(bolt);
  }
  // Center axle cap
  const axleCap = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 12),
    new THREE.MeshStandardMaterial({ color: 0xddddee, roughness: 0.1, metalness: 0.95, envMap, envMapIntensity: 2.0 })
  );
  axleCap.position.z = 0.42;
  hubGroup.add(axleCap);
  wheel.add(hubGroup);

  // Spokes — double parallel with cross-bracing for realism
  for (let i = 0; i < NS; i++) {
    const a = (i / NS) * Math.PI * 2;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const spokeLen = R - 0.5;

    // Main parallel spokes
    [-0.12, 0.12].forEach(offset => {
      const spoke = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, spokeLen, 8),
        steelLight
      );
      spoke.position.set(cosA * (spokeLen / 2 + 0.25), sinA * (spokeLen / 2 + 0.25), offset);
      spoke.rotation.z = a - Math.PI / 2;
      spoke.castShadow = true;
      wheel.add(spoke);
    });

    // Cross braces between parallel spokes (3 per spoke pair)
    for (let j = 1; j <= 3; j++) {
      const frac = j / 4;
      const brace = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.24, 6),
        steelDark
      );
      brace.position.set(cosA * (frac * spokeLen + 0.25), sinA * (frac * spokeLen + 0.25), 0);
      brace.rotation.x = Math.PI / 2;
      wheel.add(brace);
    }
  }

  // LED accent strips on alternate spokes
  const bars = [];
  const initCols = PAL.carnival;
  for (let i = 0; i < NS; i++) {
    const a = (i / NS) * Math.PI * 2;
    const c = new THREE.Color(initCols[i % 16]);
    const tubeMat = new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 0.6,
      transparent: true, opacity: 0.8, roughness: 0.15,
    });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.5, 8), tubeMat);
    tube.position.set(Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45, 0.18);
    tube.rotation.z = a - Math.PI / 2;
    wheel.add(tube); bars.push(tube);
  }

  // Rim LED lights — small bulbs around the outer rim
  const rimLEDs = [];
  const numRimLEDs = mob ? 48 : 72;
  for (let i = 0; i < numRimLEDs; i++) {
    const a = (i / numRimLEDs) * Math.PI * 2;
    const c = new THREE.Color(initCols[i % 16]);
    const ledMat = new THREE.MeshStandardMaterial({
      color: c, emissive: c, emissiveIntensity: 1.2, roughness: 0.1,
    });
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), ledMat);
    led.position.set(Math.cos(a) * (R + 0.22), Math.sin(a) * (R + 0.22), 0);
    wheel.add(led);
    rimLEDs.push(led);
  }

  // Gondolas — realistic enclosed capsules
  const cabinData = [];
  for (let i = 0; i < NC; i++) {
    const a = (i / NC) * Math.PI * 2;
    const c = initCols[i % 16];
    const gondola = buildGondola(c, envMap);

    // Hanger arm — the bracket connecting gondola to rim
    const hangerGroup = new THREE.Group();

    // Y-shaped hanger
    const armMain = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8), steelLight);
    armMain.position.y = 0.4;
    hangerGroup.add(armMain);

    // Fork arms
    [-0.12, 0.12].forEach(xOff => {
      const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 6), steelDark);
      fork.position.set(xOff, 0.88, 0);
      fork.rotation.z = xOff > 0 ? -0.25 : 0.25;
      hangerGroup.add(fork);
    });

    // Pivot bolt at top
    const pivot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), steelWarm);
    pivot.position.y = 1.05;
    hangerGroup.add(pivot);

    gondola.group.position.y = -0.1;
    hangerGroup.add(gondola.group);

    // Position on rim
    hangerGroup.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    wheel.add(hangerGroup);

    cabinData.push({
      hanger: hangerGroup,
      gondola,
      angle: a,
    });
  }

  /* ─── SUPPORT STRUCTURE — A-frame with cross bracing ─── */
  const legMat = new THREE.MeshStandardMaterial({
    color: 0xaaaabc, roughness: 0.3, metalness: 0.85, envMap, envMapIntensity: 1.0,
  });

  // Main A-frame legs (4 legs, front and back pairs)
  const legGeo = new THREE.CylinderGeometry(0.12, 0.18, 14, 12);
  const legConfigs = [
    { x: -3.2, z: 2.2, rz: 0.18, rx: -0.09 },
    { x: 3.2, z: 2.2, rz: -0.18, rx: -0.09 },
    { x: -3.2, z: -2.2, rz: 0.18, rx: 0.09 },
    { x: 3.2, z: -2.2, rz: -0.18, rx: 0.09 },
  ];
  legConfigs.forEach(({ x, z, rz, rx }) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, -0.5, z); leg.rotation.z = rz; leg.rotation.x = rx;
    leg.castShadow = true; scene.add(leg);
  });

  // Horizontal cross beams
  const beamGeo = new THREE.CylinderGeometry(0.06, 0.06, 6.4, 10);
  [2.2, -2.2].forEach(z => {
    // Upper beam
    const upper = new THREE.Mesh(beamGeo, legMat);
    upper.position.set(0, 2, z); upper.rotation.z = Math.PI / 2;
    upper.castShadow = true; scene.add(upper);
    // Lower beam
    const lower = new THREE.Mesh(beamGeo, legMat);
    lower.position.set(0, -2, z); lower.rotation.z = Math.PI / 2;
    lower.castShadow = true; scene.add(lower);
  });

  // Diagonal X-braces on each side
  const diagGeo = new THREE.CylinderGeometry(0.025, 0.025, 7.5, 6);
  [2.2, -2.2].forEach(z => {
    const d1 = new THREE.Mesh(diagGeo, steelDark);
    d1.position.set(0, 0, z); d1.rotation.z = 0.55;
    scene.add(d1);
    const d2 = new THREE.Mesh(diagGeo, steelDark);
    d2.position.set(0, 0, z); d2.rotation.z = -0.55;
    scene.add(d2);
  });

  // Front-to-back braces
  const fbGeo = new THREE.CylinderGeometry(0.04, 0.04, 4.4, 8);
  [[-2.5, 2], [2.5, 2], [-2.5, -2], [2.5, -2], [0, 3.5]].forEach(([x, y]) => {
    const fb = new THREE.Mesh(fbGeo, steelDark);
    fb.position.set(x, y, 0); fb.rotation.x = Math.PI / 2;
    scene.add(fb);
  });

  // Axle through the hub
  const axle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 5.5, 16), steelLight);
  axle.rotation.x = Math.PI / 2; axle.position.y = 3.5;
  axle.castShadow = true; scene.add(axle);

  // Base platform — concrete look
  const baseMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a35, roughness: 0.75, metalness: 0.1, envMap, envMapIntensity: 0.3,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(10, 0.5, 6), baseMat);
  base.position.y = -4.35; base.receiveShadow = true; base.castShadow = true; scene.add(base);

  // Base edge — metal trim
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.25, metalness: 0.9, envMap });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(10.1, 0.08, 6.1), trimMat);
  trim.position.y = -4.08; scene.add(trim);

  // Foot plates at leg bases
  legConfigs.forEach(({ x, z }) => {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.1, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.8, envMap })
    );
    plate.position.set(x, -4.05, z); scene.add(plate);
    // Bolts on plate
    for (let bx = -0.25; bx <= 0.25; bx += 0.5) {
      for (let bz = -0.25; bz <= 0.25; bz += 0.5) {
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.06, 6), steelWarm);
        bolt.position.set(x + bx, -3.97, z + bz); scene.add(bolt);
      }
    }
  });

  // Ground ring of fairy lights
  const numBulbs = mob ? 28 : 48;
  const gBulbs = [];
  for (let i = 0; i < numBulbs; i++) {
    const a = (i / numBulbs) * Math.PI * 2;
    const col = new THREE.Color(initCols[i % 16]);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: col, emissive: col, emissiveIntensity: 0.5, roughness: 0.2,
    });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), bulbMat);
    bulb.position.set(Math.cos(a) * 10.5, -4.3, Math.sin(a) * 10.5);
    scene.add(bulb); gBulbs.push(bulb);
    // Wire posts
    if (i % 2 === 0) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 4), steelDark);
      post.position.set(Math.cos(a) * 10.5, -4.6, Math.sin(a) * 10.5);
      scene.add(post);
    }
  }

  // Wire catenary between bulbs
  for (let i = 0; i < numBulbs; i++) {
    const a1 = (i / numBulbs) * Math.PI * 2;
    const a2 = ((i + 1) / numBulbs) * Math.PI * 2;
    const wirePts = [];
    for (let t = 0; t <= 1; t += 0.2) {
      const a = a1 + (a2 - a1) * t;
      const sag = Math.sin(t * Math.PI) * 0.08;
      wirePts.push(new THREE.Vector3(Math.cos(a) * 10.5, -4.25 + sag, Math.sin(a) * 10.5));
    }
    const wireCurve = new THREE.CatmullRomCurve3(wirePts);
    const wireGeo = new THREE.TubeGeometry(wireCurve, 4, 0.008, 4, false);
    const wire = new THREE.Mesh(wireGeo, new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 }));
    scene.add(wire);
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
    if (!drag && Math.abs(vx) < 0.00005) camRef.current += 0.0004;

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
      if (pp[i*3+1] > 16) { pp[i*3+1] = -4; pp[i*3] = (Math.random()-0.5)*24; pp[i*3+2] = (Math.random()-0.5)*24; }
    }
    particles.geometry.attributes.position.needsUpdate = true;
    partMat.opacity = 0.25 + Math.sin(t * 0.5) * 0.15;

    // Update colors
    const cols = PAL[st.theme] || PAL.carnival;

    // Gondolas — keep upright & update colors
    cabinData.forEach((cd, i) => {
      const c = new THREE.Color(cols[i % cols.length]);
      // Keep gondola hanging vertically (counter-rotate wheel rotation)
      cd.hanger.rotation.z = -wheel.rotation.z - cd.angle;

      // Subtle swing
      const swing = Math.sin(t * 0.8 + i * 0.5) * 0.03;
      cd.hanger.rotation.z += swing;

      // Update gondola colors
      const gd = cd.gondola;
      gd.bodyMat.color.copy(c);
      const sparkleVal = st.sparkle ? (0.8 + Math.sin(t * 2 + i * 1.3) * 0.2) : 1.0;
      gd.intLight.color.copy(c.clone().lerp(new THREE.Color(0xffeedd), 0.5));
      gd.intLight.intensity = st.brightness * sparkleVal * 0.5;
    });

    // LED bars
    bars.forEach((b, i) => {
      const c = new THREE.Color(cols[(i * 2) % cols.length]);
      b.material.color.copy(c); b.material.emissive.copy(c);
      b.material.emissiveIntensity = st.brightness * (st.sparkle ? (0.3 + Math.sin(t * 3 + i * 2.5) * 0.3) : 0.5);
    });

    // Rim LEDs
    rimLEDs.forEach((led, i) => {
      const c = new THREE.Color(cols[i % cols.length]);
      led.material.color.copy(c); led.material.emissive.copy(c);
      led.material.emissiveIntensity = st.brightness * (st.sparkle ? (0.5 + Math.sin(t * 4 + i * 0.6) * 0.7) : 0.8);
    });

    // Ground fairy lights
    gBulbs.forEach((b, i) => {
      const c = new THREE.Color(cols[i % cols.length]);
      b.material.color.copy(c); b.material.emissive.copy(c);
      b.material.emissiveIntensity = st.brightness * (st.sparkle ? (0.2 + Math.sin(t * 1.8 + i * 0.7) * 0.5) : 0.4);
    });

    // Hub cap spin
    axleCap.rotation.y = t * 0.5;

    // Night / day mode
    if (st.nightMode) {
      skyMat.uniforms.topColor.value.set(0x000818);
      skyMat.uniforms.midColor.value.set(0x0c1a35);
      skyMat.uniforms.botColor.value.set(0x1a2850);
      skyMat.uniforms.horizonGlow.value.set(0x2a1520);
      gndMat.color.set(0x0e1822);
      pavedMat.color.set(0x1a1e28);
      starPts.visible = true; particles.visible = true;
      ambLight.intensity = 0.4;
      keyLight.intensity = 0.6;
      fillLight.intensity = 0.6;
      scene.fog.color.set(0x060a18);
      scene.fog.density = 0.012;
    } else {
      skyMat.uniforms.topColor.value.set(0x4a90d9);
      skyMat.uniforms.midColor.value.set(0x87ceeb);
      skyMat.uniforms.botColor.value.set(0xc8e6f0);
      skyMat.uniforms.horizonGlow.value.set(0xfff0d0);
      gndMat.color.set(0x3a6a3a);
      pavedMat.color.set(0x555560);
      starPts.visible = false; particles.visible = false;
      ambLight.intensity = 0.8;
      keyLight.intensity = 1.0; keyLight.color.set(0xfff5e0);
      fillLight.intensity = 0.3;
      scene.fog.color.set(0x87ceeb);
      scene.fog.density = 0.008;
    }

    // Camera orbit
    const cy = 4.5 + Math.sin(t * 0.1) * 1.0;
    cam.position.x = Math.sin(camRef.current) * camDist;
    cam.position.z = Math.cos(camRef.current) * camDist;
    cam.position.y = cy;
    cam.lookAt(0, 2.5, 0);

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
  const [showHints, setShowHints] = useState(true);

  useEffect(() => {
    if (!showHints) return;
    const timer = setTimeout(() => setShowHints(false), 6000);
    return () => clearTimeout(timer);
  }, [showHints]);

  const dismissHints = () => setShowHints(false);

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
          La Vuelta al Mundo
        </h1>
        <p style={{ fontFamily: "'Palatino Linotype',serif", fontSize: 9, color: txt, opacity: 0.35, margin: "4px 0 0", letterSpacing: 3 }}>
          ARRASTRA PARA ORBITAR
        </p>
      </div>

      {/* FABs */}
      <div style={{ position: "absolute", top: "max(14px, env(safe-area-inset-top, 14px))", right: 10, zIndex: 10, display: "flex", flexDirection: "column", gap: 10 }}>
        <button style={fab(running)} onClick={() => setRunning(!running)}>{running ? "\u23f8" : "\u25b6"}</button>
        <button style={fab(soundOn)} onClick={() => setSoundOn(!soundOn)}>{soundOn ? "\ud83d\udd0a" : "\ud83d\udd07"}</button>
        <button style={fab(false)} onClick={() => setNightMode(!nm)}>{nm ? "\ud83c\udf19" : "\u2600\ufe0f"}</button>
        <button style={fab(sparkle)} onClick={() => setSparkle(!sparkle)}>{sparkle ? "\u2728" : "\ud83d\udca1"}</button>
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
              <span>VELOCIDAD</span><span>{speed.toFixed(1)}x</span>
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
            {Object.entries(PAL).map(([k, clrs]) => (
              <button key={k} style={{ ...btn(theme === k), width: "100%", gap: 8, padding: "10px 8px" }} onClick={() => setTheme(k)}>
                <span style={{ display: "flex", gap: 3 }}>
                  {clrs.slice(0, 4).map((c, j) => (
                    <span key={j} style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: c, boxShadow: theme === k ? `0 0 8px ${c}` : `0 0 3px ${c}` }} />
                  ))}
                </span>
                <span style={{ fontSize: 11, textTransform: "capitalize", opacity: 0.7 }}>{k}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Onboarding hints */}
      {showHints && (
        <div onClick={dismissHints} style={{ position: "absolute", inset: 0, zIndex: 30, pointerEvents: "auto", animation: "hintFadeIn 0.8s ease" }}>
          {/* FABs hint */}
          <div style={{
            position: "absolute", top: 90, right: 70,
            background: nm ? "rgba(212,165,116,0.15)" : "rgba(0,0,0,0.08)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            border: `1px solid ${acc}`, borderRadius: 16, padding: "10px 16px",
            color: txt, fontFamily: "'Palatino Linotype',serif", fontSize: 13,
            maxWidth: 180, textAlign: "center",
            boxShadow: nm ? "0 4px 24px rgba(0,0,0,0.5)" : "0 2px 12px rgba(0,0,0,0.15)",
            animation: "hintPulse 2s ease-in-out infinite",
          }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>&#8592;</div>
            Controles: pausa, sonido, modo y efectos
          </div>

          {/* Drawer hint */}
          <div style={{
            position: "absolute", bottom: 60, left: "50%", transform: "translateX(-50%)",
            background: nm ? "rgba(212,165,116,0.15)" : "rgba(0,0,0,0.08)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            border: `1px solid ${acc}`, borderRadius: 16, padding: "10px 20px",
            color: txt, fontFamily: "'Palatino Linotype',serif", fontSize: 13,
            textAlign: "center", whiteSpace: "nowrap",
            boxShadow: nm ? "0 4px 24px rgba(0,0,0,0.5)" : "0 2px 12px rgba(0,0,0,0.15)",
            animation: "hintPulse 2s ease-in-out infinite 0.3s",
          }}>
            <div style={{ fontSize: 14, marginBottom: 4, animation: "hintBounce 1.5s ease-in-out infinite" }}>&#8593;</div>
            Desliza hacia arriba para velocidad, brillo y temas
          </div>

          {/* Tap to dismiss */}
          <div style={{
            position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)",
            color: txt, opacity: 0.3, fontFamily: "'Palatino Linotype',serif", fontSize: 10, letterSpacing: 2,
          }}>
            TOCA PARA CERRAR
          </div>
        </div>
      )}

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
        @keyframes hintFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes hintPulse { 0%,100% { opacity: 1; } 50% { opacity: 0.7; } }
        @keyframes hintBounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }
        *{box-sizing:border-box; -webkit-tap-highlight-color:transparent;}
        body{margin:0; overflow:hidden; overscroll-behavior:none;}
        html{overflow:hidden; overscroll-behavior:none;}
      `}</style>
    </div>
  );
}
