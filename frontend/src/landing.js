// ShiftWise Landing — Aether-inspired
import * as THREE from 'three';
import gsap from 'gsap';

// ─── Renderer ─────────────────────────────────────────
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// ─── Scene ────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color('#080810');
scene.fog = new THREE.FogExp2('#080810', 0.018);

// ─── Camera ───────────────────────────────────────────
const cam = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
const ORBIT = [
  [0,  18,  20],  // 0 — high above
  [0,   6,  13],  // 1 — descend
  [-18, 5,   8],  // 2 — left orbit
  [ 16, 4, -10],  // 3 — right orbit rear
  [  0, 16,  16], // 4 — high overview
  [  0,  8,  22], // 5 — pull back
  [  0, 1.2, 2.2],// 6 — zoomed INTO centre card (CTA)
];
cam.position.set(...ORBIT[0]);
cam.lookAt(0, 0, 0);

const camDest  = new THREE.Vector3(...ORBIT[0]);
const _cp      = new THREE.Vector3(...ORBIT[0]);
const _cl      = new THREE.Vector3();

// ─── Lights ───────────────────────────────────────────
scene.add(new THREE.AmbientLight('#1a1a2e', 0.8));
const key = new THREE.DirectionalLight('#c8e8ff', 1.0);
key.position.set(8, 12, 8); scene.add(key);
const rim = new THREE.DirectionalLight('#4ea864', 0.5);
rim.position.set(-10, 4, -8); scene.add(rim);
const gridGlow = new THREE.PointLight('#4ea864', 0, 30);
gridGlow.position.set(0, 4, 0); scene.add(gridGlow);

// ─── Shared circular particle texture ─────────────────
const circleCanvas = document.createElement('canvas');
circleCanvas.width = 32; circleCanvas.height = 32;
const cctx = circleCanvas.getContext('2d');
const circleGrad = cctx.createRadialGradient(16,16,0,16,16,16);
circleGrad.addColorStop(0, 'rgba(255,255,255,1)');
circleGrad.addColorStop(1, 'rgba(255,255,255,0)');
cctx.fillStyle = circleGrad; cctx.fillRect(0,0,32,32);
const circleTex = new THREE.CanvasTexture(circleCanvas);

// ─── Stars — 3 parallax layers ───────────────────────
function makeStarLayer(count, spread, size, opacity) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < pos.length; i++) pos[i] = (Math.random() - 0.5) * spread;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: '#ffffff', size, transparent: true, opacity, alphaMap: circleTex, depthWrite: false }));
}
const starNear = makeStarLayer(1200,  80, 0.22, 0.7);
const starMid  = makeStarLayer(2000, 160, 0.14, 0.5);
const starFar  = makeStarLayer(2800, 280, 0.08, 0.3);
scene.add(starNear); scene.add(starMid); scene.add(starFar);

// ─── Nebula clouds ────────────────────────────────────
function makeNebula(color, x, y, z, scaleX, scaleY, opacity) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const ctx = c.getContext('2d');
  // Soft blob with noise-like radial gradient
  const g = ctx.createRadialGradient(128,128,0,128,128,128);
  g.addColorStop(0, color + 'ff');
  g.addColorStop(0.4, color + '66');
  g.addColorStop(1, color + '00');
  ctx.fillStyle = g; ctx.fillRect(0,0,256,256);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1,1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })
  );
  mesh.scale.set(scaleX, scaleY, 1);
  mesh.position.set(x, y, z);
  mesh.rotation.x = -0.3;
  return mesh;
}

const nebulae = [
  makeNebula('#1a0a3a', -18, 4, -25, 28, 18, 0.18),  // deep purple far left
  makeNebula('#0a2a1a',  20, 2, -30, 24, 16, 0.14),  // dark teal far right
  makeNebula('#0a0a2e', -5,  8, -40, 35, 22, 0.12),  // deep blue center far
  makeNebula('#1a0f04',  12,-4, -18, 18, 12, 0.10),  // warm ember low right
  makeNebula('#08180a', -15, 6, -15, 20, 14, 0.08),  // faint green left mid
];
nebulae.forEach(n => scene.add(n));

// ─── Schedule grid ────────────────────────────────────
const DAYS = 7, ROWS = 4, CW = 2.0, CH = 0.55, GX = 0.1, GY = 0.1;
const GW = DAYS * (CW + GX), GH = ROWS * (CH + GY);
const gridGroup = new THREE.Group();
scene.add(gridGroup);

const baseMat = new THREE.MeshStandardMaterial({ color: '#0d1525', roughness: 0.8, metalness: 0.2, transparent: true, opacity: 0 });
gridGroup.add(new THREE.Mesh(new THREE.BoxGeometry(GW + 0.5, 0.05, GH + 0.7), baseMat));

// AO shadow — soft dark halo beneath grid, makes it feel grounded in space
const aoCanvas = document.createElement('canvas');
aoCanvas.width = 256; aoCanvas.height = 256;
const aoCtx = aoCanvas.getContext('2d');
const aoGrad = aoCtx.createRadialGradient(128,128,20,128,128,128);
aoGrad.addColorStop(0, 'rgba(0,0,0,0.55)');
aoGrad.addColorStop(1, 'rgba(0,0,0,0)');
aoCtx.fillStyle = aoGrad; aoCtx.fillRect(0,0,256,256);
const aoMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(GW + 4, GH + 4),
  new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(aoCanvas), transparent: true, opacity: 0, depthWrite: false })
);
aoMesh.rotation.x = -Math.PI/2;
aoMesh.position.y = -0.3;
gridGroup.add(aoMesh);

const lv = [];
for (let i = 0; i <= DAYS; i++) { const x = -GW/2+i*(CW+GX)-GX/2; lv.push(x,0.03,-GH/2-0.08,x,0.03,GH/2+0.08); }
for (let i = 0; i <= ROWS; i++) { const z = -GH/2+i*(CH+GY)-GY/2; lv.push(-GW/2-0.08,0.03,z,GW/2+0.08,0.03,z); }
const lineMat = new THREE.LineBasicMaterial({ color: '#1e3040', transparent: true, opacity: 0 });
const lineGeo = new THREE.BufferGeometry();
lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lv), 3));
gridGroup.add(new THREE.LineSegments(lineGeo, lineMat));

const dayNames = ['MON','TUE','WED','THU','FRI','SAT','SUN'];
const headerMeshes = dayNames.map((d, i) => {
  const c = document.createElement('canvas'); c.width=256; c.height=64;
  const x = c.getContext('2d');
  x.fillStyle = i>=5 ? '#7ec8a0' : '#5a7a9a'; x.font='600 26px Inter,sans-serif'; x.textAlign='center'; x.fillText(d,128,42);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(CW-0.1,0.36), new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,opacity:0}));
  m.rotation.x=-Math.PI/2; m.position.set(-GW/2+i*(CW+GX)+CW/2,0.04,-GH/2-0.42); gridGroup.add(m); return m;
});

const STAFF = [
  {name:'Ahmed K.',time:'8am–2pm',bg:'#1a3d28',em:'#3ea860'},
  {name:'Sara M.',time:'2pm–8pm',bg:'#1a2a50',em:'#4878c0'},
  {name:'James R.',time:'9am–3pm',bg:'#3d2a10',em:'#c07830'},
  {name:'Priya S.',time:'4pm–10pm',bg:'#2a0f40',em:'#8040c0'},
];
const cardMeshes = [];
for (let row=0; row<ROWS; row++) {
  for (let col=0; col<DAYS; col++) {
    if (Math.random()<0.22) continue;
    const s=STAFF[row], x=-GW/2+col*(CW+GX)+CW/2, z=-GH/2+row*(CH+GY)+CH/2;
    const card = new THREE.Mesh(new THREE.BoxGeometry(CW-0.1,0.07,CH-0.1),
      new THREE.MeshStandardMaterial({color:s.bg,roughness:0.6,metalness:0.1,transparent:true,opacity:0,emissive:s.em,emissiveIntensity:0}));
    card.position.set(x,0.035,z);
    card.userData.row = row;
    const lc=document.createElement('canvas'); lc.width=256; lc.height=72;
    const lx=lc.getContext('2d');
    lx.fillStyle='#f0e4c8'; lx.font='500 19px Inter,sans-serif'; lx.textAlign='center'; lx.fillText(s.name,128,26);
    lx.fillStyle='rgba(240,228,200,0.5)'; lx.font='400 14px Inter,sans-serif'; lx.fillText(s.time,128,48);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(CW-0.12,CH-0.12),
      new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(lc),transparent:true,opacity:0}));
    label.rotation.x=-Math.PI/2; label.position.set(x,0.075,z);
    gridGroup.add(card); gridGroup.add(label);
    cardMeshes.push({card,label,col,row});

    // Glow ring under card
    const glowC = document.createElement('canvas'); glowC.width=128; glowC.height=128;
    const gctx = glowC.getContext('2d');
    const grad = gctx.createRadialGradient(64,64,0,64,64,64);
    grad.addColorStop(0, s.em + 'aa');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    gctx.fillStyle = grad; gctx.fillRect(0,0,128,128);
    const glowRing = new THREE.Mesh(
      new THREE.PlaneGeometry(CW+0.3, CH+0.3),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(glowC), transparent: true, opacity: 0, depthWrite: false })
    );
    glowRing.rotation.x = -Math.PI/2;
    glowRing.position.set(x, 0.001, z);
    gridGroup.add(glowRing);
    cardMeshes[cardMeshes.length-1].glowRing = glowRing;
  }
}

// ─── UI ───────────────────────────────────────────────
const ui = document.getElementById('ui');

// Intro — shown on open
const intro = document.createElement('div');
intro.id = 'intro';
intro.style.cssText = 'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;pointer-events:none;z-index:20;transition:opacity 0.6s;padding-bottom:8vh;opacity:0';
// Cinematic fade-in on load
setTimeout(() => {
  intro.style.transition = 'opacity 1.2s cubic-bezier(0.16,1,0.3,1), transform 1.2s cubic-bezier(0.16,1,0.3,1)';
  intro.style.opacity = '1';
}, 120);
intro.innerHTML = '<div style="font-family:\'Playfair Display\',serif;font-size:clamp(2.8rem,7vw,5.5rem);font-weight:600;color:#f0e4c8;letter-spacing:0.05em;line-height:1;transform:translateY(12px);transition:transform 1.4s cubic-bezier(0.16,1,0.3,1);animation:riseUp 1.4s cubic-bezier(0.16,1,0.3,1) 0.15s both">ShiftWise</div><div style="margin-top:1.2rem;font-size:clamp(0.85rem,1.4vw,1.05rem);color:rgba(240,228,200,0.5);font-weight:300;letter-spacing:0.04em;max-width:420px;text-align:center;line-height:1.6;animation:riseUp 1.4s cubic-bezier(0.16,1,0.3,1) 0.35s both">Stop building schedules by hand.<br>Let the algorithm do it right.</div><div style="margin-top:1.8rem;font-size:0.68rem;letter-spacing:0.25em;text-transform:uppercase;color:rgba(240,228,200,0.25);font-weight:300;animation:riseUp 1.4s cubic-bezier(0.16,1,0.3,1) 0.55s both">↓ Scroll to explore</div>';

// Inject keyframe
const style = document.createElement('style');
style.textContent = '@keyframes riseUp { from { opacity:0; transform:translateY(18px); } to { opacity:1; transform:translateY(0); } } @keyframes ctaPulse { 0%,100% { transform:scale(1); opacity:0.3; } 50% { transform:scale(1.18); opacity:0.08; } }';
document.head.appendChild(style);
ui.appendChild(intro);

// Section texts
const sections = [
  {id:'s1', css:'top:50%;right:6vw;transform:translateY(-50%)', html:'<div style="max-width:360px;text-align:right"><div style="font-size:clamp(1.4rem,2.8vw,2.4rem);font-weight:600;color:#f0e4c8;line-height:1.2">Build the perfect schedule.</div><div style="margin-top:0.7rem;font-size:0.88rem;color:rgba(240,228,200,0.45);line-height:1.7;font-weight:300">Set your rules, coverage, constraints. The algorithm handles the rest — every time.</div></div>'},
  {id:'s2', css:'top:50%;left:6vw;transform:translateY(-50%)', html:'<div style="max-width:360px"><div style="font-size:clamp(1.4rem,2.8vw,2.4rem);font-weight:600;color:#f0e4c8;line-height:1.2">Every shift, perfectly placed.</div><div style="margin-top:0.7rem;font-size:0.88rem;color:rgba(240,228,200,0.45);line-height:1.7;font-weight:300">Staff availability respected. Coverage guaranteed. Zero conflicts, every week.</div></div>'},
  {id:'s3', css:'bottom:8vh;left:50%;transform:translateX(-50%)', html:'<div style="text-align:center"><div style="font-size:clamp(1.4rem,2.8vw,2.4rem);font-weight:600;color:#f0e4c8">Fair for everyone.</div><div style="margin-top:0.6rem;font-size:0.88rem;color:rgba(240,228,200,0.4);font-weight:300">Weekend shifts and late nights — balanced automatically so no one always gets the worst slots.</div></div>'},
  {id:'s4a', css:'top:50%;right:6vw;transform:translateY(-50%)', html:'<div style="max-width:360px;text-align:right"><div style="font-size:clamp(1.4rem,2.8vw,2.4rem);font-weight:600;color:#f0e4c8;line-height:1.2">Staff submit availability.</div><div style="margin-top:0.7rem;font-size:0.88rem;color:rgba(240,228,200,0.45);line-height:1.7;font-weight:300">Team members set when they can work. The scheduler respects it — or managers override when needed.</div></div>'},
  {id:'s4b', css:'top:50%;left:6vw;transform:translateY(-50%)', html:'<div style="max-width:360px"><div style="font-size:clamp(1.4rem,2.8vw,2.4rem);font-weight:600;color:#f0e4c8;line-height:1.2">Swap shifts with a click.</div><div style="margin-top:0.7rem;font-size:0.88rem;color:rgba(240,228,200,0.45);line-height:1.7;font-weight:300">Staff request swaps. Manager approves. Schedule updates instantly — no back-and-forth messages.</div></div>'},
  {id:'s5', css:'top:8vh;left:50%;transform:translateX(-50%)', html:'<div style="text-align:center"><div style="font-size:clamp(1.4rem,2.8vw,2.4rem);font-weight:600;color:#f0e4c8">Done in seconds.</div><div style="margin-top:0.6rem;font-size:0.88rem;color:rgba(240,228,200,0.4);font-weight:300">What used to take hours now takes one click. Publish — everyone is notified instantly.</div></div>'},
  {id:'cta', css:'top:50%;left:50%;transform:translate(-50%,-50%)', html:`<div style="text-align:center">
    <div style="font-family:'Playfair Display',serif;font-size:clamp(1.1rem,2.2vw,1.9rem);color:#f0e4c8;margin-bottom:0.4rem">Ready to run a smarter team?</div>
    <div style="font-size:0.75rem;color:rgba(240,228,200,0.3);letter-spacing:0.15em;margin-bottom:2.5rem;text-transform:uppercase">Free 14 days · No credit card</div>
    <div style="display:flex;gap:2.5rem;justify-content:center;align-items:center">
      <div style="position:relative;display:inline-block">
        <div id="cta-halo" style="position:absolute;inset:-16px;border-radius:50%;border:1px solid rgba(78,168,100,0.3);animation:ctaPulse 2s ease-in-out infinite;pointer-events:none"></div>
        <div style="position:absolute;inset:-30px;border-radius:50%;border:1px solid rgba(78,168,100,0.12);animation:ctaPulse 2s ease-in-out infinite 0.5s;pointer-events:none"></div>
        <a href="/#signup" style="pointer-events:all;width:160px;height:160px;border-radius:50%;background:rgba(45,110,31,0.25);border:2px solid rgba(78,168,100,0.7);color:#f0e4c8;font-size:0.88rem;font-weight:600;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.5;transition:all 0.3s cubic-bezier(0.16,1,0.3,1);box-sizing:border-box;padding:1rem;letter-spacing:0.04em;box-shadow:0 0 32px rgba(78,168,100,0.2),inset 0 0 20px rgba(78,168,100,0.08)" onmouseover="this.style.background='linear-gradient(135deg,rgba(45,110,31,0.8),rgba(78,168,100,0.6))';this.style.borderColor='rgba(78,168,100,1)';this.style.boxShadow='0 0 60px rgba(78,168,100,0.55),inset 0 0 30px rgba(78,168,100,0.15)';this.style.transform='scale(1.06)'" onmouseout="this.style.background='rgba(45,110,31,0.25)';this.style.borderColor='rgba(78,168,100,0.7)';this.style.boxShadow='0 0 32px rgba(78,168,100,0.2),inset 0 0 20px rgba(78,168,100,0.08)';this.style.transform='scale(1)'">Start Free<br>Trial</a>
      </div>
      <a href="/#login" style="pointer-events:all;width:160px;height:160px;border-radius:50%;background:rgba(240,228,200,0.06);border:2px solid rgba(240,228,200,0.3);color:rgba(240,228,200,0.75);font-size:0.88rem;font-weight:500;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;letter-spacing:0.04em;transition:all 0.3s cubic-bezier(0.16,1,0.3,1);box-shadow:0 0 32px rgba(200,200,200,0.08),inset 0 0 20px rgba(200,200,200,0.04)" onmouseover="this.style.background='rgba(200,200,200,0.14)';this.style.color='#f0e4c8';this.style.borderColor='rgba(240,228,200,0.7)';this.style.boxShadow='0 0 60px rgba(200,200,200,0.3),inset 0 0 30px rgba(200,200,200,0.08)';this.style.transform='scale(1.06)'" onmouseout="this.style.background='rgba(240,228,200,0.06)';this.style.color='rgba(240,228,200,0.75)';this.style.borderColor='rgba(240,228,200,0.3)';this.style.boxShadow='0 0 32px rgba(200,200,200,0.08),inset 0 0 20px rgba(200,200,200,0.04)';this.style.transform='scale(1)'">Log In</a>
    </div>
  </div>`},
];
sections.forEach(({id,css,html}) => {
  const el = document.createElement('div');
  el.id = id;
  el.style.cssText = 'position:fixed;pointer-events:none;z-index:15;opacity:0;' + css;
  el.innerHTML = html;
  ui.appendChild(el);
});

// ─── Glowing grid edge frame ──────────────────────────
const edgeMat0 = new THREE.MeshBasicMaterial({ color: '#4ea864', transparent: true, opacity: 0 });
const edgeMat1 = edgeMat0.clone(), edgeMat2 = edgeMat0.clone(), edgeMat3 = edgeMat0.clone();
const edgeTop    = new THREE.Mesh(new THREE.BoxGeometry(GW+0.5,0.03,0.03), edgeMat0);
const edgeBottom = new THREE.Mesh(new THREE.BoxGeometry(GW+0.5,0.03,0.03), edgeMat1);
const edgeLeft   = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.03,GH+0.7), edgeMat2);
const edgeRight  = new THREE.Mesh(new THREE.BoxGeometry(0.03,0.03,GH+0.7), edgeMat3);
edgeTop.position.set(0,0.04,-GH/2-0.35);
edgeBottom.position.set(0,0.04,GH/2+0.35);
edgeLeft.position.set(-GW/2-0.25,0.04,0);
edgeRight.position.set(GW/2+0.25,0.04,0);
[edgeTop,edgeBottom,edgeLeft,edgeRight].forEach(e=>gridGroup.add(e));
const edgeMats = [edgeMat0,edgeMat1,edgeMat2,edgeMat3];

// ─── Camera shake ─────────────────────────────────────
let shakeAmt = 0;
function triggerShake(s) { shakeAmt = s; }

// ─── Particle burst system ────────────────────────────
const particlePool = [];

function createBurst(x, z, color) {
  const count = 16;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i*3] = x; pos[i*3+1] = 0.05; pos[i*3+2] = z;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false, alphaMap: circleTex, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  // velocity per particle
  const vels = Array.from({length: count}, () => ({
    x: (Math.random()-0.5)*0.06, y: Math.random()*0.22+0.08, z: (Math.random()-0.5)*0.06
  }));
  particlePool.push({ pts, mat, vels, life: 1.0 });
}

function updateParticles(dt) {
  for (let i = particlePool.length-1; i >= 0; i--) {
    const p = particlePool[i];
    p.life -= dt * 2;
    if (p.life <= 0) { scene.remove(p.pts); particlePool.splice(i,1); continue; }
    p.mat.opacity = p.life * 0.9;
    const pos = p.pts.geometry.attributes.position.array;
    for (let j = 0; j < p.vels.length; j++) {
      pos[j*3]   += p.vels[j].x;
      pos[j*3+1] += p.vels[j].y;
      pos[j*3+2] += p.vels[j].z;
      p.vels[j].y -= dt * 0.08; // gravity
    }
    p.pts.geometry.attributes.position.needsUpdate = true;
  }
}
const tl = gsap.timeline({ paused: true });
const byCol = [...cardMeshes].sort((a,b) => a.col - b.col);

// Set initial offscreen positions BEFORE timeline runs

tl.to(baseMat, {opacity:1,duration:0.12}, 0.12)
  .to(aoMesh.material, {opacity:0.8,duration:0.15}, 0.12)
  .to(edgeMats, {opacity:0.5,duration:0.2,stagger:0.04}, 0.14)
  .to(lineMat, {opacity:1,duration:0.1}, 0.15)
  .to(headerMeshes.map(h=>h.material), {opacity:1,stagger:0.01,duration:0.08}, 0.2)
  .to(gridGlow, {intensity:2,duration:0.14}, 0.18)
  .to('#s1', {opacity:1,duration:0.04}, 0.25);

byCol.forEach(({card,label,glowRing},i) => {
  const t = 0.35 + i*0.01;
  const s = STAFF[card.userData?.row ?? i % ROWS];
  tl.fromTo(card.position, {y:4}, {y:0.035,duration:0.12,ease:'back.out(1.5)',
    onComplete: () => {
      createBurst(card.position.x, card.position.z, s?.em ?? '#4ea864');
      if (i === 0) triggerShake(0.12); // shake on first card landing
    }
  }, t)
    .to(card.material, {opacity:1,emissiveIntensity:0.28,duration:0.1}, t)
    .to(label.material, {opacity:1,duration:0.08}, t+0.04)
    .to(glowRing.material, {opacity:0.6,duration:0.15}, t+0.05);
});

// Text windows — zero overlap. Each fades fully out before next starts.
// s1: 0.25 → visible → out by 0.35. Gap. s2: 0.38 → out by 0.48. Gap. etc.
tl.to('#s1', {opacity:0,duration:0.04}, 0.35)                                          // s1 out
  .to('#s2', {opacity:1,duration:0.04}, 0.38).to('#s2', {opacity:0,duration:0.04}, 0.48) // s2: 0.38–0.48
  .to(cardMeshes.map(c=>c.card.material), {emissiveIntensity:0.5,duration:0.08}, 0.50)
  .to('#s3', {opacity:1,duration:0.04}, 0.52).to('#s3', {opacity:0,duration:0.04}, 0.61) // s3: 0.52–0.61
  .to('#s4a',{opacity:1,duration:0.04}, 0.64).to('#s4a',{opacity:0,duration:0.04}, 0.72) // s4a: 0.64–0.72
  .to(cardMeshes.map(c=>c.card.material), {emissiveIntensity:0.85,duration:0.08}, 0.74)
  .to(gridGlow, {intensity:4,duration:0.08}, 0.74)
  .to('#s4b',{opacity:1,duration:0.04}, 0.75).to('#s4b',{opacity:0,duration:0.04}, 0.83) // s4b: 0.75–0.83
  .to(cardMeshes.map(c=>c.card.material), {emissiveIntensity:1.1,duration:0.06}, 0.85)
  .to('#s5', {opacity:1,duration:0.04}, 0.86).to('#s5', {opacity:0,duration:0.04}, 0.92) // s5: 0.86–0.92
  .to(baseMat, {opacity:0.12,duration:0.1}, 0.93)
  .to(aoMesh.material, {opacity:0.3,duration:0.1}, 0.93)
  .to(lineMat, {opacity:0.06,duration:0.08}, 0.93)
  .to(cardMeshes.map(c=>c.card.material), {opacity:0.1,emissiveIntensity:0.08,duration:0.1}, 0.93)
  .to(cardMeshes.map(c=>c.label.material), {opacity:0,duration:0.06}, 0.93)
  .to(cardMeshes.map(c=>c.glowRing.material), {opacity:0,duration:0.06}, 0.93)
  .to(headerMeshes.map(h=>h.material), {opacity:0.05,duration:0.06}, 0.93)
  .to(gridGlow, {intensity:0.4,duration:0.1}, 0.93)
  .to('#cta', {opacity:1,duration:0.12, onStart:()=>{document.getElementById('cta').style.pointerEvents='auto';}}, 0.97);

// ─── Scroll ───────────────────────────────────────────
let prog = 0, vel = 0;
window.addEventListener('wheel', e => {
  e.preventDefault();
  vel += e.deltaY * 0.000022;
  vel = Math.max(-0.01, Math.min(0.01, vel));
}, { passive: false });

function updateScroll() {
  vel *= 0.80;
  prog += vel;
  prog = Math.max(0, Math.min(1, prog));
  tl.progress(prog);
  document.getElementById('pr').style.width = (prog*100) + '%';
  if (prog > 0.02) {
    document.getElementById('sh').style.display = 'none';
    intro.style.opacity = '0';
  } else {
    intro.style.opacity = '1';
  }
  // Camera position from scroll progress
  const total = ORBIT.length - 1;
  const idx = prog * total;
  const from = Math.floor(idx), to = Math.min(from+1, total);
  const t = idx - from;
  const a = ORBIT[from], b = ORBIT[to];
  camDest.set(a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t);
}

// ─── Mouse / cursor tilt ──────────────────────────────
const mouse = {x:0,y:0}, tilt = {x:0,y:0};
const cur={x:innerWidth/2,y:innerHeight/2}, blob={x:cur.x,y:cur.y}, glow={x:cur.x,y:cur.y};
window.addEventListener('mousemove', e => {
  cur.x=e.clientX; cur.y=e.clientY;
  mouse.x=(e.clientX/innerWidth-0.5)*2; mouse.y=(e.clientY/innerHeight-0.5)*2;
});

const cd=document.getElementById('cd'), cb=document.getElementById('cb'), cg=document.getElementById('cg');
(function ac() {
  requestAnimationFrame(ac);
  cd.style.left=cur.x+'px'; cd.style.top=cur.y+'px';
  blob.x+=(cur.x-blob.x)*0.1; blob.y+=(cur.y-blob.y)*0.1;
  const dx=cur.x-blob.x, dy=cur.y-blob.y, spd=Math.sqrt(dx*dx+dy*dy);
  const sx=1+spd*0.035, sy=1/sx, ang=Math.atan2(dy,dx)*180/Math.PI;
  cb.style.left=blob.x+'px'; cb.style.top=blob.y+'px';
  cb.style.transform=`translate(-50%,-50%) rotate(${ang}deg) scaleX(${sx}) scaleY(${sy})`;
  glow.x+=(cur.x-glow.x)*0.04; glow.y+=(cur.y-glow.y)*0.04;
  cg.style.left=glow.x+'px'; cg.style.top=glow.y+'px';
})();

// ─── Resize ───────────────────────────────────────────
window.addEventListener('resize', () => {
  cam.aspect=innerWidth/innerHeight; cam.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});

// ─── Render loop ──────────────────────────────────────
const clock = new THREE.Clock();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  updateScroll();
  updateParticles(dt);

  // Glowing edge pulse — synced to scroll progress
  const edgePulse = 0.4 + Math.sin(t * 2.5) * 0.15;
  edgeMats.forEach(m => { if (m.opacity > 0) m.opacity = edgePulse * (prog > 0.12 && prog < 0.93 ? 1 : 0); });

  // Camera shake decay
  if (shakeAmt > 0.001) {
    cam.position.x += (Math.random()-0.5) * shakeAmt;
    cam.position.y += (Math.random()-0.5) * shakeAmt;
    shakeAmt *= 0.82;
  }

  // Background color shifts with scroll progress
  const bgColors = [
    new THREE.Color('#080810'), // 0   — deep dark blue
    new THREE.Color('#08100e'), // 0.3 — dark teal hint
    new THREE.Color('#0d0a08'), // 0.6 — warm dark brown
    new THREE.Color('#080810'), // 1.0 — back to deep dark
  ];
  const bgIdx = prog * (bgColors.length - 1);
  const bgFrom = Math.floor(bgIdx), bgTo = Math.min(bgFrom+1, bgColors.length-1);
  scene.background.lerpColors(bgColors[bgFrom], bgColors[bgTo], bgIdx - bgFrom);
  _cp.lerp(camDest, Math.min(1, 2.5*dt)); // slower = grid stays visible longer
  cam.position.copy(_cp);
  cam.lookAt(_cl);
  tilt.x+=(-mouse.y*0.18-tilt.x)*0.05;
  tilt.y+=(mouse.x*0.18-tilt.y)*0.05;
  // Only tilt when close to start (prog < 0.2), fade out during orbit
  const tiltWeight = Math.max(0, 1 - prog * 5);
  gridGroup.rotation.x = tilt.x * tiltWeight;
  gridGroup.rotation.z = -tilt.y * tiltWeight;
  gridGroup.rotation.y = 0; // no Y rotation — camera orbits, grid stays flat
  gridGroup.position.y = Math.sin(t * 0.6) * 0.08; // gentle bob only
  starNear.rotation.y=t*0.018; starNear.rotation.x=t*0.006; starMid.rotation.y=t*0.010; starMid.rotation.x=t*0.003; starFar.rotation.y=t*0.005; nebulae.forEach((n,i)=>{n.position.x+=Math.sin(t*0.08+i)*0.002; n.position.y+=Math.cos(t*0.06+i)*0.001; n.material.opacity=(0.08+i*0.02)*(0.85+Math.sin(t*0.15+i)*0.15);});
  renderer.render(scene,cam);
}
tick();
