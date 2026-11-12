import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Game, ENEMIES, ITEMS, enemyAppearance, CAPTURE_SECONDS } from './engine.js';
import { ArcadeMusic } from './music.js';
import { advanceSimulation, MAX_FRAME_SECONDS } from './timing.js';

const $ = id => document.getElementById(id);
const paletteKeys = ['bg', 'bg-elevated', 'surface', 'surface-soft', 'text', 'text-soft', 'text-muted', 'border', 'accent', 'success', 'danger', 'warning', 'link', 'accent-fg', 'wall', 'secondary', 'secondary-fg'];
function readPalette() {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(paletteKeys.map(k => [k, css.getPropertyValue(`--cp-${k}`).trim()]));
}
let C = readPalette();
const color = token => C[token.replace('--cp-', '')];
let dark = document.documentElement.dataset.theme === 'dark';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage = $('stage');
setHidden('arcade-link', window.self !== window.top);
let game, renderer, composer, renderPass, bloomPass, board, mona, mascot, portal, portalLight;
let ghosts = [], pelletMeshes = new Map(), itemMeshes = new Map(), rings = [], sparks = [], sparkField, ambientPixels, playerHalo, shieldHalo, boostHalo, exitRoute;
let view = 'arcade', facing = 0, cameraYaw = 0, lastStatus = '', toastTimer, audio;
let soundEnabled = true, musicEnabled = true, music, best = 0, previousTime = 0, hudTime = 0, pausedForHelp = false;
let transitionCountdown = 0, lastPower = false, lastExitReady = false;
const held = new Set();
let canvasWidth = 0, canvasHeight = 0, routeCell = '';
const cameraPosition = new THREE.Vector3();
const fxMatrix = new THREE.Matrix4(), fxPosition = new THREE.Vector3(), fxScale = new THREE.Vector3(), fxRotation = new THREE.Quaternion();
function setText(id, value) {
  const element = $(id), text = String(value);
  if (element.textContent !== text) element.textContent = text;
}
function setHidden(id, hidden) {
  const element = $(id);
  if (element.hidden !== hidden) element.hidden = hidden;
}

try {
  best = Number(localStorage.getItem('mona-merge-maze-best')) || 0;
} catch (error) {
  console.warn('Best-score storage is unavailable; the game will keep it for this session.', error);
}
$('best').textContent = String(best).padStart(5, '0');

function toast(text) {
  $('toast').textContent = text;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2300);
}
function tone(frequency, duration = .08, type = 'sine', volume = .025) {
  if (!soundEnabled || !audio) return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
  gain.gain.setValueAtTime(volume, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audio.currentTime + duration);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start();
  oscillator.stop(audio.currentTime + duration);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}
function audioButtons() {
  $('sound').setAttribute('aria-pressed', soundEnabled);
  $('sound').textContent = soundEnabled ? 'SFX on' : 'SFX off';
  $('music').setAttribute('aria-pressed', musicEnabled);
  $('music').textContent = musicEnabled ? 'Music on' : 'Music off';
}
async function activateAudio() {
  if (!musicEnabled && !soundEnabled) return;
  try {
    audio ??= new AudioContext();
    music ??= new ArcadeMusic(audio);
    await audio.resume();
    music.setEnabled(musicEnabled);
    music.setLevel(game.level - 1);
    music.setPowered(game.power > 0);
    music.setPlaying(game.status === 'playing');
  } catch (error) {
    console.error('Audio initialization failed.', error);
    music?.setPlaying(false);
    soundEnabled = musicEnabled = false;
    audioButtons();
    toast('Audio is unavailable. You can still play with sound off.');
  }
}
function event(e) {
  if (e.key) {
    const mesh = e.type === 'item' ? itemMeshes.get(e.key) : pelletMeshes.get(e.key);
    if (mesh) {
      mesh.visible = false;
      burst(mesh.position.x, mesh.position.z, e.type === 'item' ? color(ITEMS[e.kind].color) : e.type === 'power' ? C.accent : C.success, e.type === 'pellet' ? 5 : 20);
    }
  }
  if (e.type === 'pellet') tone(500 + (game.score % 5) * 100, .045);
  if (e.type === 'power') { toast('Pull request approved. SUPER MERGE!'); tone(880, .3, 'triangle'); }
  if (e.type === 'item') {
    const messages = {
      chip: `Computer chip collected. +${ITEMS.chip.points} points!`,
      overclock: `Overclock online. ${ITEMS.overclock.multiplier}x speed for ${ITEMS.overclock.seconds} seconds.`,
      firewall: `Firewall online. One bug hit blocked, up to ${ITEMS.firewall.seconds} seconds.`,
    };
    toast(messages[e.kind]);
    tone({ chip: 1568, overclock: 784, firewall: 523 }[e.kind], .22, 'triangle');
  }
  if (e.type === 'shield-hit') {
    toast('Firewall absorbed a hit. Shield spent; move clear!');
    burst(game.player.x, game.player.y, C.link, 18);
    tone(330, .25, 'sine');
  }
  if (e.type === 'enemy') {
    toast(`${ENEMIES[e.id].name} captured. Held in the bug pen for ${CAPTURE_SECONDS}s.`);
    burst(game.player.x, game.player.y, C.link, 14);
    burst(...game.map.pen.cells[e.id], C.link, 14);
    tone(1100, .15);
  }
  if (e.type === 'hit') { facing = 0; cameraYaw = 0; held.clear(); toast('A bug got you. Try a different branch.'); tone(140, .35, 'sawtooth'); }
  if (e.type === 'exit-ready') {
    toast('All commits collected! Walk through the DEPLOY portal to the north.');
    tone(1046, .4, 'triangle');
    burst(...game.map.exit, C.success, 36);
    showExitRoute();
  }
  if (e.type === 'won') {
    tone(1320, .6, 'triangle');
    transitionCountdown = 1.4;
    burst(...game.map.exit, C.success, 48);
  }
  if (e.type === 'over') tone(90, .6, 'triangle');
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(C['bg-elevated']);
const overhead = new THREE.OrthographicCamera(-15, 15, 12, -12, .1, 120);
const firstPerson = new THREE.PerspectiveCamera(76, 1, .055, 90);
let lightColor = dark ? C.text : C.surface;
const hemisphere = new THREE.HemisphereLight(lightColor, C['text-muted'], 2.2);
scene.add(hemisphere);
const keyLight = new THREE.DirectionalLight(lightColor, 3.2);
keyLight.position.set(-10, 22, 12);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
Object.assign(keyLight.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 1, far: 65 });
keyLight.shadow.bias = -.0006;
keyLight.shadow.normalBias = .03;
scene.add(keyLight);
const fillLight = new THREE.DirectionalLight(C.accent, .65);
fillLight.position.set(12, 5, -12);
scene.add(fillLight);
const rimLight = new THREE.DirectionalLight(C.success, .45);
rimLight.position.set(4, 8, -14);
scene.add(rimLight);

const materials = new Map();
function material(value, options = {}) {
  const key = JSON.stringify([value, options]);
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color: value, roughness: .62, ...options }));
  return materials.get(key);
}
function sphere(parent, x, y, z, sx, sy, sz, mat) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
function box(parent, x, y, z, w, h, d, mat, radius = .06) {
  const mesh = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, radius), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function tube(parent, points, radius, mat) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, radius, 8, false), mat);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
function label(text, foreground, width = 2, height = .5, background = null) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (background) { context.fillStyle = background; context.fillRect(0, 0, 512, 128); }
  context.font = '700 64px "Mona Sans", sans-serif';
  const measured = context.measureText(text).width;
  if (measured > 470) context.font = `700 ${Math.floor(64 * 470 / measured)}px "Mona Sans", sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = foreground;
  context.fillText(text, 256, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
  sprite.scale.set(width, height, 1);
  return sprite;
}
function makeMona() {
  const group = new THREE.Group();
  const ink = material(dark ? C.surface : C.text);
  const face = material(dark ? C.text : C.bg);
  const rose = material(C.accent);
  sphere(group, 0, .26, 0, .22, .24, .18, ink);
  sphere(group, 0, .67, 0, .39, .32, .28, ink);
  sphere(group, 0, .59, -.225, .29, .20, .075, face);
  for (const side of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(.17, .34, 3), ink);
    ear.position.set(side * .27, .96, -.015);
    ear.rotation.z = side * -.3;
    ear.rotation.y = Math.PI;
    ear.castShadow = true;
    group.add(ear);
    const inside = new THREE.Mesh(new THREE.ConeGeometry(.085, .18, 3), rose);
    inside.position.set(side * .28, .98, -.08);
    inside.rotation.copy(ear.rotation);
    group.add(inside);
    sphere(group, side * .115, .64, -.296, .035, .061, .018, ink);
    sphere(group, side * .11, .665, -.311, .011, .014, .006, face);
    sphere(group, side * .21, .54, -.283, .04, .016, .008, rose);
    tube(group, [[side * .17, .2, .03], [side * .4, .18, .14], [side * .49, .25, .05], [side * .48, .31, -.03]], .06, ink);
    tube(group, [[side * .12, .13, -.03], [side * .2, .055, -.2], [side * .29, .07, -.29]], .065, ink);
  }
  sphere(group, 0, .56, -.31, .025, .018, .015, rose);
  tube(group, [[-.055, .512, -.294], [0, .488, -.302], [.055, .512, -.294]], .008, ink);
  tube(group, [[.15, .26, .13], [.4, .4, .37], [.46, .6, .4], [.35, .67, .37]], .045, ink);
  sphere(group, 0, .075, .21, .075, .065, .19, ink);
  return group;
}
function addContactShadow(group, radius) {
  group.traverse(object => { object.castShadow = false; });
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(radius, 24), material(C.text, {
    transparent: true, opacity: .12, depthWrite: false,
  }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = .045;
  group.add(shadow);
}
function makeGhost(index) {
  const group = new THREE.Group();
  const body = new THREE.Group();
  // Bug colors change independently; never mutate a material shared with pickups.
  const primary = new THREE.MeshStandardMaterial({ color: color(ENEMIES[index].color), metalness: .3, roughness: .3 });
  sphere(body, 0, .49, 0, .32, .34, .3, primary);
  box(body, 0, .29, 0, .61, .22, .55, primary, .08);
  for (let i = -1; i <= 1; i++) sphere(body, i * .205, .19, -.02, .103, .12, .25, primary);
  const ink = material(dark ? C.surface : C.text);
  const eye = material(dark ? C.text : C.surface);
  const brows = new THREE.Group();
  body.add(brows);
  for (const side of [-1, 1]) {
    sphere(body, side * .115, .52, -.264, .077, .095, .039, eye);
    sphere(body, side * .11, .52, -.302, .031, .048, .015, ink);
    const brow = box(brows, side * .115, .61, -.297, .15, .025, .025, ink, .008);
    brow.rotation.z = side * .3;
  }
  if (index === 0) {
    for (const side of [-1, 1]) tube(body, [[side * .25, .66, 0], [side * .39, .82, 0], [side * .33, .9, 0]], .025, primary);
  } else if (index === 1) {
    for (const side of [-1, 1]) for (let i = 0; i < 3; i++) {
      tube(body, [[side * .25, .37, (i - 1) * .16], [side * .44, .33, (i - 1) * .2], [side * .48, .18, (i - 1) * .23]], .022, primary);
    }
  } else if (index === 2) {
    box(body, 0, .79, 0, .55, .09, .55, primary, .03);
    sphere(body, 0, .79, 0, .25, .13, .24, primary);
  } else {
    const orbit = new THREE.Mesh(new THREE.TorusGeometry(.4, .018, 8, 32), primary);
    orbit.position.y = .51;
    orbit.rotation.x = Math.PI / 3;
    body.add(orbit);
  }
  const symbol = label(enemyAppearance(index, 0).label, color(ENEMIES[index].color), 1.05, .26, C.surface);
  symbol.position.set(0, 1.1, 0);
  const catchLabel = label(enemyAppearance(index, 1).label, C.link, 1.05, .26, C.surface);
  catchLabel.position.copy(symbol.position);
  catchLabel.visible = false;
  const catchRing = new THREE.Mesh(new THREE.TorusGeometry(.4, .022, 8, 32), material(C.link, { emissive: C.link, emissiveIntensity: 1.1 }));
  catchRing.rotation.x = -Math.PI / 2;
  catchRing.position.y = .075;
  catchRing.visible = false;
  const heldLabel = label('HELD', C['text-soft'], .85, .25, C.surface);
  const releaseLabel = label('RELEASING', C['text-soft'], 1.1, .25, C.surface);
  heldLabel.position.set(0, 1.23, 0);
  releaseLabel.position.copy(heldLabel.position);
  heldLabel.visible = releaseLabel.visible = false;
  const timer = box(group, 0, 1, 0, .55, .035, .04, material(C['text-soft']), .01);
  timer.visible = false;
  group.add(body, symbol, catchLabel, catchRing, heldLabel, releaseLabel);
  group.userData.body = body;
  group.userData.material = primary;
  Object.assign(group.userData, { symbol, catchLabel, catchRing, brows, heldLabel, releaseLabel, timer, appearanceKey: '' });
  return group;
}
function disposeBoard() {
  if (!board) return;
  const geometry = new Set(), textures = new Set(), boardMaterials = new Set(materials.values());
  board.traverse(object => {
    if (object.geometry) geometry.add(object.geometry);
    if (object.material) {
      for (const mat of Array.isArray(object.material) ? object.material : [object.material]) {
        boardMaterials.add(mat);
        if (mat.map) textures.add(mat.map);
      }
    }
    if (object.isInstancedMesh) object.dispose();
  });
  geometry.forEach(g => g.dispose());
  textures.forEach(t => t?.dispose());
  boardMaterials.forEach(m => m.dispose());
  materials.clear();
  scene.remove(board);
}
function makeItem(kind) {
  const group = new THREE.Group(), model = new THREE.Group();
  group.add(model);
  const tint = color(ITEMS[kind].color);
  const shell = material(tint, { emissive: tint, emissiveIntensity: .35, metalness: .55, roughness: .28 });
  const metal = material(C['text-soft'], { metalness: .7, roughness: .25 });
  if (kind === 'chip') {
    box(model, 0, .4, 0, .48, .14, .48, shell, .025);
    box(model, 0, .49, 0, .25, .05, .25, material(C.text), .015);
    for (const side of [-1, 1]) for (const offset of [-.15, 0, .15]) {
      box(model, side * .3, .4, offset, .16, .045, .045, metal, .01);
      box(model, offset, .4, side * .3, .045, .045, .16, metal, .01);
    }
  } else if (kind === 'overclock') {
    box(model, 0, .42, 0, .32, .5, .22, shell, .045);
    box(model, 0, .7, 0, .14, .07, .13, metal, .015);
    const bolt = label('+', C.surface, .24, .24);
    bolt.position.set(0, .44, -.13);
    model.add(bolt);
  } else {
    const shape = new THREE.Shape();
    shape.moveTo(-.28, .65); shape.lineTo(0, .76); shape.lineTo(.28, .65);
    shape.lineTo(.23, .32); shape.lineTo(0, .13); shape.lineTo(-.23, .32); shape.closePath();
    const shield = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: .09, bevelEnabled: false }), shell);
    shield.position.z = -.045;
    model.add(shield);
    box(model, 0, .47, -.075, .055, .27, .04, metal, .01);
    box(model, 0, .47, -.075, .24, .05, .04, metal, .01);
  }
  const caption = label(kind === 'chip' ? `CHIP +${ITEMS.chip.points}` : kind.toUpperCase(), kind === 'chip' ? C['secondary-fg'] : tint, 1.1, .23, kind === 'chip' ? C.secondary : C.surface);
  caption.position.y = 1;
  const pad = new THREE.Mesh(new THREE.RingGeometry(.31, .36, 24), material(tint, { side: THREE.DoubleSide }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.y = .055;
  group.add(caption, pad);
  group.userData.model = model;
  addContactShadow(model, .3);
  return group;
}
function buildWorldDetails() {
  const { width: w, height: h, exit, rooms } = game.map;
  const lightMat = material(C.accent, { emissive: C.accent, emissiveIntensity: 1.7, metalness: .25, roughness: .3 });
  for (const z of [-.4, h - .6]) box(board, (w - 1) / 2, -.22, z, w + .55, .04, .04, lightMat, .01);
  for (const x of [-.4, w - .6]) box(board, x, -.22, (h - 1) / 2, .04, .04, h + .55, lightMat, .01);
  rooms.forEach((room, index) => {
    const trim = material(index ? C.accent : C.success, { emissive: index ? C.accent : C.success, emissiveIntensity: .7 });
    for (const z of [room.y - .4, room.y + room.height - .6]) {
      box(board, room.x + (room.width - 1) / 2, .025, z, room.width - .2, .018, .025, trim, .005);
    }
    for (const x of [room.x - .4, room.x + room.width - .6]) {
      box(board, x, .025, room.y + (room.height - 1) / 2, .025, .018, room.height - .2, trim, .005);
    }
    const caption = label(index ? '{ code review }' : 'DEPLOYMENT PLAZA', index ? C.accent : C.success, 2.6, .4);
    const mat = new THREE.MeshBasicMaterial({ map: caption.material.map, transparent: true, depthWrite: false, toneMapped: false });
    caption.material.dispose();
    const floorSign = new THREE.Mesh(new THREE.PlaneGeometry(index ? 2.4 : 3.3, .4), mat);
    floorSign.rotation.x = -Math.PI / 2;
    floorSign.position.set(room.x + (room.width - 1) / 2, .045, room.y + room.height - .55);
    board.add(floorSign);
  });
  portal = new THREE.Group();
  portal.position.set(exit[0], 0, exit[1]);
  board.add(portal);
  const frameMat = material(dark ? C['text-muted'] : C.text, { metalness: .75, roughness: .25 });
  for (const side of [-1, 1]) {
    box(portal, side * .58, .75, 0, .18, 1.6, .34, frameMat, .05);
    box(portal, side * .585, .78, .185, .055, 1.35, .025, lightMat, .012);
  }
  box(portal, 0, 1.57, 0, 1.34, .2, .34, frameMat, .05);
  const gate = box(portal, 0, .72, 0, .94, 1.42, .065, material(C.accent, {
    transparent: true, opacity: .32, emissive: C.accent, emissiveIntensity: .6, depthWrite: false,
  }), .02);
  gate.castShadow = false;
  const vortex = new THREE.Mesh(new THREE.TorusGeometry(.48, .04, 12, 64), material(C.success, { emissive: C.success, emissiveIntensity: 2.5 }));
  vortex.position.set(0, .8, .02);
  vortex.scale.y = 1.35;
  vortex.visible = false;
  portal.add(vortex);
  const closed = label('DEPLOY / LOCKED', C.accent, 2.6, .45, C.surface);
  const opened = label('DEPLOY / NEXT LEVEL', C.success, 2.8, .45, C.surface);
  closed.position.y = opened.position.y = 2;
  opened.visible = false;
  portal.add(closed, opened);
  portal.userData = { gate, vortex, closed, opened };
  portalLight = new THREE.PointLight(C.success, 0, 5, 2);
  portalLight.position.set(exit[0], 1.2, 1.1);
  board.add(portalLight);
  const particles = new THREE.IcosahedronGeometry(.035, 0);
  const particleMaterial = new THREE.MeshBasicMaterial({ toneMapped: false });
  sparkField = new THREE.InstancedMesh(particles, particleMaterial, 128);
  sparkField.count = 0;
  sparkField.frustumCulled = false;
  sparkField.userData.disposeMaterial = true;
  board.add(sparkField);
  ambientPixels = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.022, 0), particleMaterial, 56);
  ambientPixels.frustumCulled = false;
  for (let i = 0; i < 56; i++) ambientPixels.setColorAt(i, new THREE.Color(i % 2 ? C.accent : C.success).multiplyScalar(1.4));
  board.add(ambientPixels);
  exitRoute = new THREE.InstancedMesh(new THREE.BoxGeometry(.12, .025, .12), material(C.success, { emissive: C.success, emissiveIntensity: 1.8 }), w * h);
  exitRoute.count = 0;
  exitRoute.frustumCulled = false;
  board.add(exitRoute);
}
function inPen(x, y) {
  const p = game.map.pen.bounds;
  return x >= p.x && x < p.x + p.width && y >= p.y && y < p.y + p.height;
}
function buildPen() {
  const { bounds: p, cells, release } = game.map.pen;
  const cx = p.x + (p.width - 1) / 2, cz = p.y + (p.height - 1) / 2;
  const frameMat = material(C['text-muted'], { metalness: .65, roughness: .32 });
  const barMat = material(C['text-soft'], { metalness: .4, roughness: .35 });
  box(board, cx, .02, cz, p.width - .04, .06, p.height - .04, material(C['surface-soft']), .06);
  const left = p.x - .45, right = p.x + p.width - .55;
  const back = p.y - .45, front = p.y + p.height - .55;
  for (const y of [.12, .87]) {
    for (const z of [back, front]) box(board, cx, y, z, p.width - .05, .045, .06, frameMat, .01);
    for (const x of [left, right]) box(board, x, y, cz, .06, .045, p.height - .05, frameMat, .01);
  }
  for (let i = 0; i <= 6; i++) {
    const x = left + (right - left) * i / 6;
    const z = back + (front - back) * i / 6;
    box(board, x, .48, back, .035, .8, .035, barMat, .01);
    box(board, x, .48, front, .035, .8, .035, barMat, .01);
    if (i > 0 && i < 6) {
      box(board, left, .48, z, .035, .8, .035, barMat, .01);
      box(board, right, .48, z, .035, .8, .035, barMat, .01);
    }
  }
  cells.forEach(([x, y]) => {
    const pad = new THREE.Mesh(new THREE.CircleGeometry(.4, 32), material(C.border));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(x, .058, y);
    board.add(pad);
  });
  const sign = label('BUG HOLDING PEN', C['text-soft'], 2.3, .36, C.surface);
  sign.position.set(cx, 1.65, cz);
  board.add(sign);
  const exit = label('RELEASE', C['text-muted'], .85, .22);
  exit.position.set(release[0], .25, release[1]);
  board.add(exit);
}
function burst(x, z, tint, count) {
  if (reducedMotion || !sparkField) return;
  for (let i = 0; i < count; i++) {
    if (sparks.length >= 128) sparks.shift();
    const angle = Math.random() * Math.PI * 2;
    sparks.push({ x, z, born: performance.now() / 1000, vx: Math.cos(angle) * (.35 + Math.random()), vz: Math.sin(angle) * (.35 + Math.random()), vy: 1 + Math.random(), tint: new THREE.Color(tint).multiplyScalar(1.8) });
  }
}
function showExitRoute() {
  if (!game.exitReady) return;
  const key = game.player.cell.join(',');
  if (key === routeCell) return;
  routeCell = key;
  const distances = game.distances(...game.map.exit);
  let [x, y] = game.player.cell, count = 0;
  const matrix = new THREE.Matrix4();
  while ((x !== game.map.exit[0] || y !== game.map.exit[1]) && count < game.map.width * game.map.height) {
    const next = game.neighbors(x, y).sort((a, b) => distances.get(`${a.x},${a.y}`) - distances.get(`${b.x},${b.y}`))[0];
    x = next.x; y = next.y;
    matrix.makeTranslation(x, .07, y);
    exitRoute.setMatrixAt(count++, matrix);
  }
  exitRoute.count = count;
  exitRoute.instanceMatrix.needsUpdate = true;
}
function updateWorldEffects(time) {
  const matrix = fxMatrix, scale = fxScale, position = fxPosition, rotation = fxRotation;
  for (let i = sparks.length - 1; i >= 0; i--) if (time - sparks[i].born >= .65) sparks.splice(i, 1);
  sparks.forEach((p, i) => {
    const age = Math.max(0, time - p.born);
    position.set(p.x + p.vx * age, .22 + p.vy * age - 2 * age * age, p.z + p.vz * age);
    scale.setScalar(1 - age / .65);
    matrix.compose(position, rotation, scale);
    sparkField.setMatrixAt(i, matrix);
    sparkField.setColorAt(i, p.tint);
  });
  sparkField.count = sparks.length;
  sparkField.instanceMatrix.needsUpdate = true;
  if (sparkField.instanceColor) sparkField.instanceColor.needsUpdate = true;
  for (let i = 0; i < 56; i++) {
    const x = (i * 7.23) % (game.map.width + 2) - 1;
    const z = (i * 11.13) % (game.map.height + 2) - 1;
    const y = .8 + ((i * .173 + time * .11) % 2.1);
    matrix.makeTranslation(x, y, z);
    ambientPixels.setMatrixAt(i, matrix);
  }
  ambientPixels.instanceMatrix.needsUpdate = true;
  const unlocked = game.exitReady;
  portal.userData.gate.visible = !unlocked;
  portal.userData.closed.visible = !unlocked;
  portal.userData.opened.visible = unlocked;
  portal.userData.vortex.visible = unlocked;
  portal.userData.vortex.rotation.z = time * .5;
  portalLight.intensity = unlocked ? 4 + Math.sin(time * 3) * .5 : .25;
}
function makeBoard() {
  disposeBoard();
  pelletMeshes.clear();
  itemMeshes.clear();
  rings = [];
  sparks = [];
  routeCell = '';
  lastExitReady = false;
  board = new THREE.Group();
  const { width: w, height: h, grid } = game.map;
  board.position.set(-(w - 1) / 2, 0, -(h - 1) / 2);
  scene.add(board);
  box(board, (w - 1) / 2, -.39, (h - 1) / 2, w + .65, .65, h + .65, material(C.border, { metalness: .55, roughness: .32 }), .18);
  box(board, (w - 1) / 2, -.11, (h - 1) / 2, w + .45, .15, h + .45, material(C.surface), .10);
  const matrix = new THREE.Matrix4();
  const floorGeo = new RoundedBoxGeometry(.93, .035, .93, 1, .04);
  const floors = new THREE.InstancedMesh(floorGeo, material(lightColor), w * h);
  const wallCount = grid.flat().filter(Boolean).length - game.map.pen.bounds.width * game.map.pen.bounds.height;
  // Instance colors carry the wall palette without multiplying by the UI accent.
  const wallBase = 0xffffff;
  const walls = new THREE.InstancedMesh(new RoundedBoxGeometry(.96, .86, .96, 2, .085), material(wallBase, { metalness: .24, roughness: .38 }), wallCount);
  const caps = new THREE.InstancedMesh(new RoundedBoxGeometry(.83, .04, .83, 1, .035), material(wallBase, { metalness: .4, roughness: .25 }), wallCount);
  const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(.69, .018, .035), material(C.accent, { emissive: C.accent, emissiveIntensity: 1.9 }), wallCount);
  walls.castShadow = walls.receiveShadow = floors.receiveShadow = caps.receiveShadow = true;
  let fi = 0, wi = 0;
  const baseColor = new THREE.Color(C.surface);
  const green = new THREE.Color(C.success);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    matrix.makeTranslation(x, -.015, y);
    floors.setMatrixAt(fi, matrix);
    const shade = ((x * 7 + y * 13) % 11) / 11;
    floors.setColorAt(fi++, baseColor.clone().lerp(green, grid[y][x] ? .02 : .025 + shade * .1));
    if (grid[y][x] && !inPen(x, y)) {
      matrix.makeTranslation(x, .42, y);
      walls.setMatrixAt(wi, matrix);
      const wallColor = new THREE.Color(C.wall).lerp(new THREE.Color(C['bg-elevated']), ((x + y) % 3) * .04);
      walls.setColorAt(wi, wallColor);
      matrix.makeTranslation(x, .87, y);
      caps.setMatrixAt(wi, matrix);
      caps.setColorAt(wi, wallColor.clone().lerp(new THREE.Color(C.surface), .28));
      matrix.makeTranslation(x, .9, y + .27);
      leds.setMatrixAt(wi, matrix);
      wi++;
    }
  }
  board.add(floors, walls, caps, leds);
  buildWorldDetails();
  buildPen();
  const pelletGeo = new THREE.IcosahedronGeometry(.092, 0);
  const powerGeo = new THREE.OctahedronGeometry(.22, 0);
  for (const [key, p] of game.pellets) {
    const mesh = new THREE.Mesh(p.power ? powerGeo : pelletGeo, material(p.power ? C.accent : C.success, {
      emissive: p.power ? C.accent : C.success, emissiveIntensity: p.power ? 2 : .5, metalness: .4, roughness: .25,
    }));
    mesh.position.set(p.x, p.power ? .38 : .19, p.y);
    mesh.castShadow = p.power;
    board.add(mesh);
    pelletMeshes.set(key, mesh);
    if (p.power) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.29, .022, 8, 32), material(C.accent, { emissive: C.accent, emissiveIntensity: .2 }));
      ring.position.set(p.x, .09, p.y);
      ring.rotation.x = -Math.PI / 2;
      board.add(ring);
      rings.push({ ring, mesh });
    }
  }
  for (const [key, item] of game.items) {
    const mesh = makeItem(item.kind);
    mesh.position.set(item.x, 0, item.y);
    board.add(mesh);
    itemMeshes.set(key, mesh);
  }
  const codeWords = game.index === 0 ? ['git push', '< / >', 'main', 'pull request', '{ }', 'git merge'] : ['fn()', 'return 0;', '{ }', 'await', '0110', 'try / catch'];
  const signMaterials = codeWords.map(word => {
    const sign = label(word, C.accent, 1, .25, C.surface);
    const mat = new THREE.MeshBasicMaterial({ map: sign.material.map, toneMapped: false });
    sign.material.dispose();
    return mat;
  });
  const signGeometry = new THREE.PlaneGeometry(.77, .22);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!grid[y][x] || inPen(x, y) || (x + y * 2) % 4 !== 0) continue;
    const mat = signMaterials[(x + y) % codeWords.length];
    const sides = [[0, -1, Math.PI], [1, 0, Math.PI / 2], [0, 1, 0], [-1, 0, -Math.PI / 2]];
    sides.forEach(([dx, dz, rotation]) => {
      if (!game.open(x + dx, y + dz)) return;
      const sign = new THREE.Mesh(signGeometry, mat);
      sign.position.set(x + dx * .485, .57, y + dz * .485);
      sign.rotation.y = rotation;
      board.add(sign);
    });
    if (x > 1 && x < w - 2 && y > 1 && y < h - 2 && x % 3 === 0) {
      const top = new THREE.Mesh(signGeometry, mat);
      top.position.set(x, .9, y);
      top.rotation.x = -Math.PI / 2;
      board.add(top);
    }
  }
  mona = makeMona();
  addContactShadow(mona, .36);
  board.add(mona);
  playerHalo = new THREE.Mesh(new THREE.TorusGeometry(.45, .028, 8, 48), material(C.success, { emissive: C.success, emissiveIntensity: 2 }));
  playerHalo.rotation.x = -Math.PI / 2;
  board.add(playerHalo);
  shieldHalo = new THREE.Mesh(new THREE.SphereGeometry(.55, 20, 12), material(C.link, {
    wireframe: true, transparent: true, opacity: .23, depthWrite: false,
  }));
  board.add(shieldHalo);
  boostHalo = new THREE.Mesh(new THREE.TorusGeometry(.54, .035, 6, 32), material(color(ITEMS.overclock.color), {
    emissive: color(ITEMS.overclock.color), emissiveIntensity: 1.2,
  }));
  boostHalo.rotation.x = -Math.PI / 2;
  board.add(boostHalo);
  ghosts = ENEMIES.map((_, i) => {
    const ghost = makeGhost(i);
    addContactShadow(ghost, .32);
    board.add(ghost);
    return ghost;
  });
  mascot = makeMona();
  addContactShadow(mascot, .36);
  mascot.scale.setScalar(1.75);
  mascot.position.set(w * .55, 0, h + .7);
  mascot.rotation.y = Math.PI - .25;
  board.add(mascot);
  const marker = label('MONA / player one', C['text-muted'], 2.6, .35);
  marker.position.set(w * .55 + 2.7, .25, h + .7);
  mascot.userData.marker = marker;
  board.add(marker);
  $('total').textContent = game.total;
  $('branch').textContent = game.map.branch;
  setText('repository-name', game.map.name);
  setText('level', String(game.level).padStart(2, '0'));
  music?.setLevel(game.level - 1);
  renderer.shadowMap.needsUpdate = true;
  fitCamera();
}
function fitCamera() {
  if (!renderer || !game) return;
  const { width, height } = stage.getBoundingClientRect();
  if (width <= 0 || height <= 0) return;
  if (canvasWidth !== width || canvasHeight !== height) {
    canvasWidth = width; canvasHeight = height;
    renderer.setSize(width, height, false);
    composer?.setSize(width, height);
  }
  const aspect = width / height;
  const w = game.map.width, h = game.map.height;
  const visibleWidth = Math.max(w + 4, (h * .77 + 6) * aspect);
  overhead.left = -visibleWidth / 2;
  overhead.right = visibleWidth / 2;
  overhead.top = visibleWidth / aspect / 2;
  overhead.bottom = -visibleWidth / aspect / 2;
  overhead.position.set(0, 25, 20);
  overhead.lookAt(0, 0, 1);
  overhead.updateProjectionMatrix();
  firstPerson.aspect = aspect;
  firstPerson.updateProjectionMatrix();
}
function updateCamera(dt) {
  if (view === 'first') {
    const targetYaw = facing * Math.PI / 2;
    const delta = Math.atan2(Math.sin(targetYaw - cameraYaw), Math.cos(targetYaw - cameraYaw));
    cameraYaw += reducedMotion ? delta : delta * (1 - Math.exp(-dt * 18));
    const position = cameraPosition.set(game.player.x, .61, game.player.y).add(board.position);
    firstPerson.position.copy(position);
    firstPerson.lookAt(position.x + Math.sin(cameraYaw), position.y, position.z - Math.cos(cameraYaw));
  }
  mona.visible = view !== 'first';
  mascot.visible = game.status === 'ready' && view === 'arcade';
  mascot.userData.marker.visible = mascot.visible;
}
function syncModels(time, dt = 1 / 60) {
  mona.position.set(game.player.x, game.player.to && !reducedMotion ? Math.sin(time * 22) * .026 : 0, game.player.y);
  const turn = -game.player.direction * Math.PI / 2 - mona.rotation.y;
  mona.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 22));
  ghosts.forEach((ghost, i) => {
    const enemy = game.enemies[i];
    ghost.visible = enemy.captured || (enemy.cooldown <= 0 && !game.exitReady);
    ghost.position.set(enemy.x, reducedMotion || enemy.captured ? 0 : Math.sin(time * 3 + i) * .045, enemy.y);
    ghost.userData.body.rotation.y = -enemy.direction * Math.PI / 2;
    const key = `${game.power > 0}/${enemy.captured}/${enemy.releaseGrace > 0}`;
    if (key !== ghost.userData.appearanceKey) {
      ghost.userData.appearanceKey = key;
      const appearance = enemyAppearance(i, game.power, enemy);
      ghost.userData.material.color.set(color(appearance.color));
      ghost.userData.material.emissive.set(appearance.catchable ? C.link : C.surface);
      ghost.userData.material.emissiveIntensity = appearance.catchable ? .45 : .05;
      ghost.userData.symbol.visible = !appearance.catchable && !enemy.captured && !enemy.releaseGrace;
      ghost.userData.brows.visible = !appearance.catchable && !enemy.captured;
      ghost.userData.catchLabel.visible = appearance.catchable;
      ghost.userData.catchRing.visible = appearance.catchable;
      ghost.userData.heldLabel.visible = enemy.captured;
      ghost.userData.releaseLabel.visible = enemy.releaseGrace > 0;
      ghost.userData.timer.visible = enemy.captured;
    }
    if (enemy.captured) ghost.userData.timer.scale.x = Math.max(.01, enemy.cooldown / CAPTURE_SECONDS);
  });
  rings.forEach(({ ring, mesh }) => {
    ring.visible = mesh.visible;
    if (!reducedMotion) {
      mesh.rotation.y = time;
      mesh.position.y = .38 + Math.sin(time * 3) * .06;
      ring.scale.setScalar(1 + Math.sin(time * 3) * .12);
    }
  });
  if (!reducedMotion) for (const mesh of itemMeshes.values()) {
    if (!mesh.visible) continue;
    mesh.userData.model.rotation.y = time * .6;
    mesh.userData.model.position.y = Math.sin(time * 2) * .04;
  }
  playerHalo.position.set(game.player.x, .08, game.player.y);
  playerHalo.visible = game.power > 0 || game.invulnerable > 0;
  if (!reducedMotion) playerHalo.scale.setScalar(1 + Math.sin(time * 5) * .08);
  shieldHalo.position.set(game.player.x, .5, game.player.y);
  shieldHalo.visible = game.firewall > 0 && view !== 'first';
  boostHalo.position.set(game.player.x, .065, game.player.y);
  boostHalo.visible = game.overclock > 0 && view !== 'first';
  updateWorldEffects(time);
}
function updateMinimap() {
  const canvas = $('minimap'), ctx = canvas.getContext('2d');
  const { width: w, height: h, grid } = game.map;
  const size = Math.min(canvas.width / w, canvas.height / h);
  const ox = (canvas.width - w * size) / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (grid[y][x]) { ctx.fillStyle = C.wall; ctx.fillRect(ox + x * size, y * size, size - 1, size - 1); }
  }
  for (const p of game.pellets.values()) {
    ctx.fillStyle = p.power ? C.accent : C.success;
    const radius = p.power ? 2.5 : 1;
    ctx.beginPath(); ctx.arc(ox + (p.x + .5) * size, (p.y + .5) * size, radius, 0, Math.PI * 2); ctx.fill();
  }
  ctx.font = '800 10px "Mona Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const item of game.items.values()) {
    const x = ox + (item.x + .5) * size, y = (item.y + .5) * size;
    ctx.fillStyle = item.kind === 'chip' ? C.secondary : C.surface;
    ctx.fillRect(x - 4.5, y - 5, 9, 10);
    ctx.fillStyle = item.kind === 'chip' ? C['secondary-fg'] : color(ITEMS[item.kind].color);
    ctx.fillText(ITEMS[item.kind].symbol, x, y);
  }
  ctx.textBaseline = 'alphabetic';
  for (const e of game.enemies) {
    if (!e.captured && (e.cooldown > 0 || game.exitReady)) continue;
    const appearance = enemyAppearance(e.id, game.power, e);
    ctx.fillStyle = color(appearance.color);
    const x = ox + (e.x + .5) * size, y = (e.y + .5) * size;
    ctx.beginPath();
    if (e.captured) ctx.rect(x - 2.5, y - 2.5, 5, 5);
    else if (appearance.catchable) ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    else { ctx.moveTo(x, y - 4); ctx.lineTo(x + 4, y + 3); ctx.lineTo(x - 4, y + 3); ctx.closePath(); }
    ctx.fill();
  }
  ctx.fillStyle = game.exitReady ? C.success : C.accent;
  ctx.fillRect(ox + game.map.exit[0] * size - 1, 0, size + 2, size);
  ctx.fillStyle = C.surface;
  ctx.font = '700 9px "Mona Sans", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(game.exitReady ? '↑' : '×', ox + (game.map.exit[0] + .5) * size, size - 1);
  ctx.save();
  ctx.translate(ox + (game.player.x + .5) * size, (game.player.y + .5) * size);
  ctx.rotate(facing * Math.PI / 2);
  ctx.fillStyle = C.text;
  ctx.strokeStyle = C.surface;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 4); ctx.lineTo(0, 2); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  setText('direction-label', ['N', 'E', 'S', 'W'][facing]);
}
function saveBest() {
  if (game.score <= best) return;
  best = game.score;
  $('best').textContent = String(best).padStart(5, '0');
  try { localStorage.setItem('mona-merge-maze-best', String(best)); }
  catch (error) { console.warn('Could not persist the best score.', error); }
}
function updateUI() {
  setText('score', String(game.score).padStart(5, '0'));
  setText('lives', Array.from({ length: 3 }, (_, i) => i < game.lives ? '♥' : '♡').join(' '));
  const livesLabel = `${game.lives} lives`;
  if ($('lives').getAttribute('aria-label') !== livesLabel) $('lives').setAttribute('aria-label', livesLabel);
  const collected = game.total - game.pellets.size;
  setText('collected', collected);
  const pct = Math.round(collected / game.total * 100);
  setText('percentage', `${pct}%`);
  $('progress-fill').style.width = `${pct}%`;
  const activePower = String(game.power > 0 && !game.exitReady);
  if ($('power').dataset.active !== activePower) {
    $('power').dataset.active = activePower;
    $('power').setAttribute('aria-hidden', String(activePower === 'false'));
  }
  $('power-fill').style.width = `${game.power / 8 * 100}%`;
  setText('power-time', `${game.power.toFixed(1)}s`);
  for (const kind of ['overclock', 'firewall']) {
    const active = game[kind] > 0;
    const element = $(`${kind}-status`);
    if (element.dataset.active !== String(active)) element.dataset.active = String(active);
    setText(`${kind}-time`, active ? `${game[kind].toFixed(1)}s` : '--');
  }
  const catchable = game.power > 0 && !game.exitReady;
  setText('threat-label', game.exitReady ? 'Bugs cleared' : catchable ? '+ Blue bugs: CATCH' : '! Bugs: AVOID');
  $('threat-label').classList.toggle('catchable', catchable);
  setText('bug-legend', catchable ? 'Blue bugs: catch' : 'Bugs: avoid');
  $('bug-legend').classList.toggle('catchable', catchable);
  const captured = game.enemies.filter(e => e.captured);
  const remaining = captured.length ? Math.ceil(Math.min(...captured.map(e => e.cooldown))) : 0;
  setText('pen-status', captured.length ? `Pen ${captured.length}/4 · release in ${remaining}s` : 'Pen 0/4');
  if (lastPower !== (game.power > 0)) {
    lastPower = game.power > 0;
    music?.setPowered(lastPower);
  }
  setText('objective-title', game.exitReady ? `EXIT OPEN / LEVEL ${game.level + 1}` : 'DEPLOY PORTAL / LOCKED');
  setText('objective-detail', game.exitReady ? 'Follow the green trail. Walk through the north portal.' : 'Collect every commit to open the north exit.');
  $('objective').classList.toggle('unlocked', game.exitReady);
  setHidden('minimap-box', view !== 'first' && !game.exitReady);
  setHidden('compass', view === 'first' || game.exitReady);
  if (game.exitReady) showExitRoute();
  if (view === 'first' || game.exitReady) updateMinimap();
  if (lastExitReady !== game.exitReady) {
    lastExitReady = game.exitReady;
    saveBest();
  }
  if (lastStatus === game.status) return;
  const previousStatus = lastStatus;
  lastStatus = game.status;
  saveBest();
  const status = game.status;
  music?.setPlaying(status === 'playing');
  stage.classList.toggle('playing', status === 'playing');
  document.querySelector('.game-shell').classList.toggle('playing', status === 'playing');
  $('intro').hidden = status !== 'ready';
  $('pause').disabled = !['playing', 'paused'].includes(status);
  $('pause').textContent = status === 'paused' ? '▷' : 'Ⅱ';
  $('pause').setAttribute('aria-label', status === 'paused' ? 'Resume game' : 'Pause game');
  $('message').hidden = !['paused', 'won', 'over'].includes(status);
  const copy = {
    paused: ['WORK IN PROGRESS', 'Paused.', "Your commits aren't going anywhere.", 'Keep going →'],
    won: ['DEPLOYMENT COMPLETE', `Level ${game.level} shipped!`, `${game.score.toLocaleString()} points. Heading to level ${game.level + 1} with your score and lives intact.`, 'Next level now →'],
    over: ['BUILD FAILED. TRY AGAIN.', 'One more branch?', `${game.score.toLocaleString()} points. Start a fresh board at level 1.`, 'New run →'],
  }[status];
  if (copy) {
    $('message-kicker').textContent = copy[0]; $('message-title').textContent = copy[1];
    $('message-detail').textContent = copy[2]; $('resume').textContent = copy[3];
    setText('announcer', `${copy[0].replace(/\.$/, '')}. ${copy[1]} ${copy[2]}`);
  } else if (status === 'playing' && previousStatus === 'paused') setText('announcer', 'Resumed.');
}
function switchView(next) {
  if (view === next) return;
  view = next;
  scene.fog = view === 'first' ? new THREE.Fog(C['bg-elevated'], 8, 26) : null;
  game.movementMode = view;
  facing = game.player.direction;
  cameraYaw = facing * Math.PI / 2;
  held.clear();
  game.desired = null;
  $('orbit').setAttribute('aria-pressed', view === 'arcade');
  $('first').setAttribute('aria-pressed', view === 'first');
  $('crosshair').hidden = view !== 'first';
  $('minimap-box').hidden = view !== 'first';
  $('compass').hidden = view === 'first';
  $('view-label').textContent = view === 'first' ? 'MONA CAM / FIRST PERSON' : 'ORTHOGRAPHIC / 3D';
  $('controls-hint').innerHTML = view === 'first'
    ? '<kbd>W</kbd><kbd>S</kbd><span>move</span><kbd>A</kbd><kbd>D</kbd><span>turn</span><kbd>P</kbd><span>pause</span>'
    : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>or arrows to move</span><kbd>P</kbd><span>pause</span>';
  updateUI();
  stage.focus({ preventScroll: true });
}
function start() {
  game.start();
  previousTime = performance.now();
  void activateAudio();
  updateUI();
  stage.focus({ preventScroll: true });
}
function reset(fresh = false) {
  saveBest();
  held.clear(); facing = 0; cameraYaw = 0; transitionCountdown = 0;
  if (fresh) {
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    game.newRun(seed === game.runSeed ? (seed + 1) >>> 0 : seed);
  } else game.reset(game.index, game.level);
  makeBoard();
  previousTime = performance.now();
  lastStatus = '';
  if (fresh) game.start();
  music?.setPowered(false);
  if (fresh) void activateAudio();
  updateUI();
  if (fresh) toast("New run. Fresh board, level 1, three lives. Let's ship!");
  stage.focus({ preventScroll: true });
}
function advanceLevel() {
  saveBest();
  held.clear(); facing = 0; cameraYaw = 0; transitionCountdown = 0;
  game.nextLevel();
  makeBoard();
  previousTime = performance.now();
  music?.setPowered(false);
  lastStatus = '';
  updateUI();
  toast(`Welcome to level ${game.level}. Let's ship another one.`);
  stage.focus({ preventScroll: true });
}
function pause() {
  held.clear();
  if (view === 'first') game.desired = null;
  game.pause();
  previousTime = performance.now();
  updateUI();
}
function control(direction, repeat = false) {
  if (game.status !== 'playing') return;
  if (view === 'arcade') game.desired = direction;
  else if (direction === 1 || direction === 3) {
    if (!repeat) {
      facing = (facing + (direction === 1 ? 1 : 3)) % 4;
      updateFirstMovement();
    }
  } else game.desired = (facing + (direction === 2 ? 2 : 0)) % 4;
}
function updateFirstMovement() {
  if (view !== 'first') return;
  game.desired = null;
  for (const input of held) {
    const direction = typeof input === 'number' ? input : keyDirections[input];
    if (direction === 0) game.desired = facing;
    if (direction === 2) game.desired = (facing + 2) % 4;
  }
}
const keyDirections = { ArrowUp: 0, KeyW: 0, w: 0, W: 0, ArrowRight: 1, KeyD: 1, d: 1, D: 1, ArrowDown: 2, KeyS: 2, s: 2, S: 2, ArrowLeft: 3, KeyA: 3, a: 3, A: 3 };
document.addEventListener('keydown', e => {
  if ($('help-dialog').open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest('a')) return;
  // Single-character shortcuts (WASD, V, P) only act while the stage or the page itself has focus,
  // so they cannot fire while a control elsewhere on the page is focused (WCAG 2.1.4).
  const stageHasFocus = !(e.target instanceof Element) || e.target === document.body
    || e.target === document.documentElement || stage.contains(e.target);
  if (!stageHasFocus && /^[a-z]$/i.test(e.key)) return;
  if (keyDirections[e.key] !== undefined) {
    e.preventDefault();
    const direction = keyDirections[e.key];
    held.add(e.code || e.key);
    control(direction, e.repeat);
  } else if ((e.key === 'v' || e.key === 'V') && !e.repeat) {
    e.preventDefault(); switchView(view === 'arcade' ? 'first' : 'arcade');
  } else if (['p', 'P', 'Escape'].includes(e.key) && !e.repeat) {
    e.preventDefault(); pause();
  } else if (e.key === 'Enter' && !e.repeat && e.target.tagName !== 'BUTTON') {
    e.preventDefault();
    if (game.status === 'ready') start();
    else if (game.status === 'paused') pause();
    else if (['won', 'over'].includes(game.status)) $('resume').click();
  }
});
document.addEventListener('keyup', e => {
  const direction = keyDirections[e.key];
  if (direction === undefined) return;
  held.delete(e.code || e.key);
  updateFirstMovement();
});
window.addEventListener('blur', () => { if (game?.status === 'playing') pause(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game?.status === 'playing') pause();
});
window.addEventListener('pagehide', () => { if (game) saveBest(); music?.setPlaying(false); });
$('orbit').onclick = () => switchView('arcade');
$('first').onclick = () => switchView('first');
$('play').onclick = start;
$('pause').onclick = () => { pause(); stage.focus({ preventScroll: true }); };
$('restart').onclick = () => reset();
$('new-run').onclick = () => reset(true);
$('resume').onclick = () => {
  if (game.status === 'paused') pause();
  else if (game.status === 'won') advanceLevel();
  else reset(true);
  stage.focus({ preventScroll: true });
};
// A pointer click on a settings toggle hands keyboard control back to the stage; keyboard
// activation (detail 0) keeps focus on the toggle.
const refocusStage = event => { if (event?.detail && game) stage.focus({ preventScroll: true }); };
$('sound').onclick = async e => {
  soundEnabled = !soundEnabled;
  if (soundEnabled) await activateAudio();
  audioButtons();
  refocusStage(e);
};
$('music').onclick = async e => {
  musicEnabled = !musicEnabled;
  music?.setEnabled(musicEnabled);
  if (musicEnabled) await activateAudio();
  audioButtons();
  refocusStage(e);
};
function applyTheme(next) {
  document.documentElement.dataset.theme = next;
  dark = next === 'dark';
  C = readPalette();
  lightColor = dark ? C.text : C.surface;
  hemisphere.color.set(lightColor);
  hemisphere.groundColor.set(C['text-muted']);
  keyLight.color.set(lightColor);
  fillLight.color.set(C.accent);
  rimLight.color.set(C.success);
  scene.background.set(C['bg-elevated']);
  if (scene.fog) scene.fog.color.set(C['bg-elevated']);
  $('theme').setAttribute('aria-pressed', String(dark));
  if (game) {
    bloomPass.strength = dark ? .32 : .14;
    bloomPass.threshold = dark ? 1.2 : 2.5;
    makeBoard();
    syncModels(reducedMotion ? 0 : performance.now() / 1000, 1);
    updateUI();
    previousTime = performance.now();
  }
  try { localStorage.setItem('mona-merge-maze-theme', next); }
  catch (error) { console.warn('Could not save theme preference.', error); toast('Theme changed for this session; browser storage is unavailable.'); }
}
$('theme').setAttribute('aria-pressed', String(dark));
$('theme').onclick = e => { applyTheme(dark ? 'light' : 'dark'); refocusStage(e); };
$('enemy-legend').replaceChildren(...ENEMIES.map(enemy => {
  const div = document.createElement('div'), symbol = document.createElement('b');
  // Prefer the text-grade "-ink" variant of the enemy colour where one exists (see style.css).
  symbol.style.color = `var(${enemy.color}-ink, var(${enemy.color}))`;
  symbol.textContent = enemy.symbol;
  div.append(symbol, document.createTextNode(enemy.name));
  return div;
}));
$('help').onclick = () => {
  pausedForHelp = game.status === 'playing';
  if (pausedForHelp) pause();
  $('help-dialog').showModal();
};
$('close-help').onclick = $('got-it').onclick = () => $('help-dialog').close();
$('help-dialog').addEventListener('close', () => {
  if (pausedForHelp && game.status === 'paused') pause();
  pausedForHelp = false;
  stage.focus({ preventScroll: true });
});
document.querySelectorAll('[data-dir]').forEach(button => {
  const direction = Number(button.dataset.dir);
  button.addEventListener('pointerdown', e => {
    e.preventDefault();
    button.setPointerCapture(e.pointerId);
    held.add(direction);
    control(direction);
  });
  const release = () => { held.delete(direction); updateFirstMovement(); };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
});

function frame(timestamp) {
  const dt = Math.min((timestamp - previousTime) / 1000 || 0, MAX_FRAME_SECONDS);
  previousTime = timestamp;
  if (document.hidden) { requestAnimationFrame(frame); return; }
  advanceSimulation(game, dt);
  if (game.status === 'won' && document.hasFocus() && !document.hidden) {
    transitionCountdown -= dt;
    if (transitionCountdown <= 0) advanceLevel();
  }
  const time = reducedMotion ? 0 : timestamp / 1000;
  syncModels(time, dt);
  updateCamera(dt);
  if (timestamp - hudTime > 75 || game.status !== lastStatus) { updateUI(); hudTime = timestamp; }
  renderPass.camera = view === 'arcade' ? overhead : firstPerson;
  composer.render();
  requestAnimationFrame(frame);
}
async function initialize() {
try {
  await document.fonts.load('700 16px "Mona Sans"');
  // Conference booths and phones run this on battery: prefer the integrated GPU and cap the backing store.
  renderer = new THREE.WebGLRenderer({ canvas: $('scene'), antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  composer = new EffectComposer(renderer);
  renderPass = new RenderPass(scene, overhead);
  bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), dark ? .32 : .14, .45, dark ? 1.2 : 2.5);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  game = new Game(0, event, { seed: crypto.getRandomValues(new Uint32Array(1))[0] });
  makeBoard();
  updateUI();
  $('play').disabled = false;
  $('new-run').disabled = false;
  previousTime = performance.now();
  new ResizeObserver(fitCamera).observe(stage);
  $('scene').addEventListener('webglcontextlost', e => {
    e.preventDefault();
    if (game.status === 'playing') pause();
    toast('The 3D context was interrupted. Reload to restore the game.');
  });
  requestAnimationFrame(frame);
} catch (error) {
  console.error('Unable to initialize the 3D game.', error);
  const notice = document.createElement('div');
  notice.className = 'error-notice';
  notice.textContent = 'The 3D game could not start. Enable hardware acceleration and WebGL in your browser, then reload this page.';
  stage.append(notice);
  $('play').disabled = true;
  document.querySelectorAll('#orbit,#first,#new-run,#pause,#restart,#help').forEach(element => { element.disabled = true; });
}
}
void initialize();
