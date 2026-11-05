// 3D floor plan of the Startup Nights 2026 hall, built from venue.json (PDF point units).
import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';

export const BOOTH_COLORS = {
  base: '#ffd66b',
  interested: '#4c8dff',
  visited: '#2ebd6b',
  selected: '#ff6b35',
  dim: '#a9a6a0',
};

const BOOTH_H = 5;
const VISITED_H = 2.6;
const SELECTED_H = 8;
const ROOM_H = { stage: 3, bar: 6, lounge: 7, food: 5, service: 7, area: 2, workshop: 8 };
const WALL_H = 10;
const FONT = '"Inter", "Segoe UI", system-ui, -apple-system, sans-serif';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function polyBBox(poly) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of poly) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

export class FloorScene extends EventTarget {
  constructor(container, venue) {
    super();
    this.container = container;
    this.venue = venue;
    const [fx0, fy0, fx1, fy1] = venue.floor;
    this.cx = (fx0 + fx1) / 2;
    this.cy = (fy0 + fy1) / 2;
    this.hallW = fx1 - fx0;
    this.hallD = fy1 - fy0;
    // Everything drawn, including the entrance arrow, exits and the rooms outside the hall.
    const pts = [[fx0, fy0], [fx1, fy1], ...venue.exits, ...venue.labels.map((l) => [l.x, l.y])];
    venue.rooms.forEach((r) => pts.push(...r.poly));
    venue.entranceArrow.forEach((a) => pts.push(...a));
    const [sx0, sy0, sx1, sy1] = polyBBox(pts);
    this.site = { x0: sx0 - this.cx, x1: sx1 - this.cx, z0: sy0 - this.cy - 6, z1: sy1 - this.cy + 6 };

    this.booths = new Map();   // id -> { mesh, label, cell, rect, center, state, star }
    this.pickables = [];
    this.selected = [];
    this.hoverId = null;
    this.topView = false;
    this.tween = null;
    this.clock = new THREE.Clock();
    this.onFrame = null;
    this.inset = 0;        // px of the canvas covered on the left (detail card); the view centres on the rest
    this.insetTarget = 0;

    this.initRenderer();
    this.buildGround();
    this.buildWalls();
    this.buildRooms();
    this.buildSeats();
    this.buildExits();
    this.buildEntrance();
    this.buildBooths();
    this.buildMarkers();
    this.initInput();
    this.resetView(false);
    this.loop();
  }

  // ---------- setup ----------

  initRenderer() {
    const small = Math.min(window.innerWidth, window.innerHeight) < 700;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '3D floor plan. Drag to rotate, scroll or pinch to zoom, right-drag or two fingers to pan.');
    this.renderer.domElement.setAttribute('role', 'img');

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2e2e2e');

    this.camera = new THREE.PerspectiveCamera(42, 1, 1, 6000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 35;
    this.controls.maxDistance = 1500;
    this.controls.maxPolarAngle = 1.3;
    this.controls.zoomToCursor = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6d6d6d, 1.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.7);
    sun.position.set(-260, 520, 340);
    sun.castShadow = true;
    const s = sun.shadow;
    s.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    s.camera.left = -460; s.camera.right = 460; s.camera.top = 300; s.camera.bottom = -300;
    s.camera.near = 50; s.camera.far = 1400;
    s.bias = -0.0008;
    s.normalBias = 0.6;
    this.scene.add(sun);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
  }

  resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyInset();
  }

  // Keep the camera target centred in the part of the canvas not covered by the detail card.
  setInsetLeft(px) {
    this.insetTarget = Math.max(0, Math.min(px, this.container.clientWidth * 0.6));
  }

  applyInset() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    if (this.inset > 0.5) this.camera.setViewOffset(w, h, -this.inset / 2, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // plan (x, y) -> world (X, Z)
  wx(x) { return x - this.cx; }
  wz(y) { return y - this.cy; }

  extrude(poly, height, material, y0 = 0) {
    const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(this.wx(x), -this.wz(y))));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.y = y0;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  textTexture(text, { w, h, color = '#2a2a2a', vertical = false, weight = 700, maxFont = 64, bg = null }) {
    const scale = 10;
    const cw = Math.max(16, Math.min(1024, Math.round(w * scale)));
    const ch = Math.max(16, Math.min(1024, Math.round(h * scale)));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch); }
    const along = vertical ? ch : cw;
    const across = vertical ? cw : ch;
    const lines = text.split('\n');
    let size = Math.min(maxFont, across * 0.42 / lines.length);
    ctx.font = `${weight} ${size}px ${FONT}`;
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest > along * 0.86) size *= (along * 0.86) / widest;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.translate(cw / 2, ch / 2);
    if (vertical) ctx.rotate(-Math.PI / 2);
    lines.forEach((l, i) => ctx.fillText(l, 0, (i - (lines.length - 1) / 2) * size * 1.15));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    return tex;
  }

  flatLabel(texture, w, h, x, z, y) {
    const geo = new THREE.PlaneGeometry(w, h);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    return mesh;
  }

  buildGround() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: '#3a3a3a', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(this.hallW, this.hallD),
      new THREE.MeshStandardMaterial({ color: '#f3f2ee', roughness: 0.95 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    floor.receiveShadow = true;
    this.scene.add(floor);

    for (const l of this.venue.labels) {
      const vertical = l.rot === -90;
      const len = l.text.length * l.size * 0.78;
      const w = vertical ? l.size * 1.7 : len;
      const h = vertical ? len : l.size * 1.7;
      const tex = this.textTexture(l.text, { w, h, color: l.color, vertical, weight: 800, maxFont: 200 });
      this.flatLabel(tex, w, h, this.wx(l.x), this.wz(l.y), 0.15);
    }
  }

  buildWalls() {
    const mat = new THREE.MeshStandardMaterial({ color: '#232323', roughness: 0.9 });
    for (const poly of this.venue.walls) this.extrude(poly, WALL_H, mat);
  }

  buildRooms() {
    this.rooms = [];
    const greyMat = new THREE.MeshStandardMaterial({ color: '#d8d8d6', roughness: 0.85 });
    const goldMat = new THREE.MeshStandardMaterial({ color: '#ffc800', roughness: 0.6 });
    const areaMat = new THREE.MeshStandardMaterial({ color: '#cfcfcc', roughness: 0.9 });
    const dartMat = new THREE.MeshStandardMaterial({ color: '#bdbdba', roughness: 0.9 });
    for (const room of this.venue.rooms) {
      const h = room.inset ? ROOM_H.area + 0.8 : ROOM_H[room.kind] || 4;
      const mat = room.kind === 'workshop' ? goldMat : room.inset ? dartMat : room.kind === 'area' ? areaMat : greyMat;
      const mesh = this.extrude(room.poly, h, mat);
      if (room.name) {
        mesh.userData.room = room.name;
        this.rooms.push(mesh);
        const [x0, y0, x1, y1] = polyBBox(room.poly);
        const w = x1 - x0, d = y1 - y0;
        const vertical = d > w * 1.5;
        const label = room.name.replace(' / ', ' /\n').replace('Workshop', '\nWorkshop').replace(/\n\n/g, '\n').replace(/^\n|\n$/g, '');
        const tex = this.textTexture(vertical ? room.name : label, {
          w, h: d, vertical, color: room.kind === 'workshop' ? '#1d1d1d' : '#3b3b3b', maxFont: 70,
        });
        this.flatLabel(tex, w, d, this.wx((x0 + x1) / 2), this.wz((y0 + y1) / 2), h + 0.06);
      }
    }
  }

  buildSeats() {
    const seats = this.venue.seats;
    const geo = new THREE.CylinderGeometry(1.25, 1.25, 1.8, 8);
    geo.translate(0, 0.9, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#2b2b2b', roughness: 0.7 }), seats.length);
    const m = new THREE.Matrix4();
    seats.forEach(([x, y], i) => {
      m.makeTranslation(this.wx(x), 0, this.wz(y));
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = true;
    this.scene.add(mesh);
  }

  buildExits() {
    const tex = this.textTexture('EXIT', { w: 14, h: 8, color: '#ffffff', weight: 800, bg: '#0f8a4b', maxFont: 60 });
    const signMat = new THREE.MeshBasicMaterial({ map: tex });
    const postMat = new THREE.MeshStandardMaterial({ color: '#0f8a4b', roughness: 0.6 });
    for (const [x, y] of this.venue.exits) {
      const g = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(14, 2, 8), postMat);
      post.position.y = 1;
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(14, 8), signMat);
      sign.rotation.x = -Math.PI / 2;
      sign.position.y = 2.05;
      g.add(post, sign);
      g.position.set(this.wx(x), 0, this.wz(y));
      this.scene.add(g);
    }
  }

  buildEntrance() {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffc800', roughness: 0.5, emissive: '#3a2c00' });
    for (const poly of this.venue.entranceArrow) {
      const mesh = this.extrude(poly, 0.7, mat, 0.05);
      mesh.castShadow = false;
    }
  }

  // Booth number labels share one canvas atlas: 16 x 16 cells of 128 x 64 px.
  buildBooths() {
    const cols = 16, cw = 128, ch = 64;
    this.atlas = document.createElement('canvas');
    this.atlas.width = cols * cw;
    this.atlas.height = 16 * ch;
    this.atlasCtx = this.atlas.getContext('2d');
    this.atlasTex = new THREE.CanvasTexture(this.atlas);
    this.atlasTex.colorSpace = THREE.SRGBColorSpace;
    this.atlasTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const labelMat = new THREE.MeshBasicMaterial({ map: this.atlasTex, transparent: true, depthWrite: false });
    this.cell = { cols, cw, ch };

    this.venue.booths.forEach((b, i) => {
      const [x0, y0, x1, y1] = b.rect;
      const w = x1 - x0 - 0.5, d = y1 - y0 - 0.5;
      const center = new THREE.Vector3(this.wx((x0 + x1) / 2), 0, this.wz((y0 + y1) / 2));
      const mat = new THREE.MeshStandardMaterial({ color: BOOTH_COLORS.base, roughness: 0.55, metalness: 0.02 });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), mat);
      mesh.geometry.translate(0, 0.5, 0);
      mesh.scale.y = BOOTH_H;
      mesh.position.copy(center);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.boothId = b.id;

      const lw = w * 0.92, lh = lw / 2;
      const geo = new THREE.PlaneGeometry(lw, lh);
      geo.rotateX(-Math.PI / 2);
      const col = i % cols, row = Math.floor(i / cols);
      const u0 = (col * cw) / this.atlas.width, u1 = ((col + 1) * cw) / this.atlas.width;
      const v1 = 1 - (row * ch) / this.atlas.height, v0 = 1 - ((row + 1) * ch) / this.atlas.height;
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) {
        uv.setXY(k, uv.getX(k) === 0 ? u0 : u1, uv.getY(k) === 0 ? v0 : v1);
      }
      const label = new THREE.Mesh(geo, labelMat);
      label.position.set(center.x, BOOTH_H + 0.06, center.z);
      label.renderOrder = 3;
      label.userData.boothId = b.id;

      this.scene.add(mesh, label);
      this.pickables.push(mesh, label);
      const booth = { id: b.id, mesh, label, cellIndex: i, rect: b.rect, center, size: Math.max(w, d), height: BOOTH_H, targetH: BOOTH_H, state: {} };
      this.booths.set(b.id, booth);
      this.drawCell(booth, false, '#262626');
    });
    this.atlasTex.needsUpdate = true;
  }

  drawCell(booth, check, color) {
    const { cols, cw, ch } = this.cell;
    const col = booth.cellIndex % cols, row = Math.floor(booth.cellIndex / cols);
    const ctx = this.atlasCtx;
    ctx.clearRect(col * cw, row * ch, cw, ch);
    ctx.save();
    ctx.translate(col * cw + cw / 2, row * ch + ch / 2);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${check ? 34 : 44}px ${FONT}`;
    ctx.fillText(check ? `✓${booth.id}` : booth.id, 0, 3);
    ctx.restore();
  }

  buildMarkers() {
    // Selection pin: a cone with a ball, bobbing above the booth.
    const pinMat = new THREE.MeshStandardMaterial({ color: BOOTH_COLORS.selected, emissive: '#5a1d00', roughness: 0.35 });
    this.pin = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 10, 20), pinMat);
    cone.rotation.x = Math.PI;
    cone.position.y = 5;
    const ball = new THREE.Mesh(new THREE.SphereGeometry(4.6, 24, 16), pinMat);
    ball.position.y = 12;
    const dot = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
    dot.position.set(0, 12, 0);
    dot.scale.set(1, 1, 1);
    this.pin.add(cone, ball, dot);
    cone.castShadow = ball.castShadow = true;
    this.pin.visible = false;
    this.scene.add(this.pin);

    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.82, 1, 48),
      new THREE.MeshBasicMaterial({ color: BOOTH_COLORS.selected, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.2;
    this.ring.visible = false;
    this.scene.add(this.ring);

    // Star sprite for booths the visitor is interested in.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.translate(64, 64);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 56 : 24;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fillStyle = BOOTH_COLORS.interested;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fill();
    this.starTex = new THREE.CanvasTexture(c);
    this.starTex.colorSpace = THREE.SRGBColorSpace;
    this.starMat = new THREE.SpriteMaterial({ map: this.starTex, depthTest: true, transparent: true });
  }

  // ---------- state ----------

  // state: { visited, interested, dim, assigned }
  setBoothState(id, state) {
    const b = this.booths.get(id);
    if (!b) return;
    b.state = state;
    this.applyBooth(b);
  }

  applyBooth(b) {
    const sel = this.selected.includes(b.id);
    const { visited, interested, dim } = b.state;
    let color = BOOTH_COLORS.base;
    if (visited) color = BOOTH_COLORS.visited;
    else if (interested) color = BOOTH_COLORS.interested;
    if (dim && !sel) color = BOOTH_COLORS.dim;
    if (sel) color = BOOTH_COLORS.selected;
    b.mesh.material.color.set(color);
    b.mesh.material.emissive.set(b.id === this.hoverId ? '#2a2a2a' : '#000000');
    b.targetH = sel ? SELECTED_H : visited ? VISITED_H : BOOTH_H;
    const textColor = color === BOOTH_COLORS.base ? '#262626' : dim && !sel ? '#5c5a56' : '#ffffff';
    const cellKey = `${!!visited}|${textColor}`;
    if (b.cellKey !== cellKey) {
      b.cellKey = cellKey;
      this.drawCell(b, !!visited, textColor);
      this.atlasTex.needsUpdate = true;
    }

    const wantStar = !!interested && !(dim && !sel);
    if (wantStar && !b.star) {
      b.star = new THREE.Sprite(this.starMat);
      b.star.scale.set(5.5, 5.5, 1);
      this.scene.add(b.star);
    } else if (!wantStar && b.star) {
      this.scene.remove(b.star);
      b.star = null;
    }
  }

  select(ids) {
    const prev = this.selected;
    this.selected = ids ? [...ids].filter((id) => this.booths.has(id)) : [];
    for (const id of new Set([...prev, ...this.selected])) {
      const b = this.booths.get(id);
      if (b) this.applyBooth(b);
    }
    if (this.selected.length) {
      const c = this.centerOf(this.selected);
      this.pin.position.set(c.x, SELECTED_H, c.z);
      this.pin.visible = true;
      const radius = this.selected.length > 1 ? this.spanOf(this.selected) / 2 + 8 : this.booths.get(this.selected[0]).size * 0.9 + 4;
      this.ring.position.set(c.x, 0.2, c.z);
      this.ring.userData.radius = radius;
      this.ring.visible = true;
    } else {
      this.pin.visible = false;
      this.ring.visible = false;
    }
  }

  centerOf(ids) {
    const c = new THREE.Vector3();
    ids.forEach((id) => c.add(this.booths.get(id).center));
    return c.divideScalar(ids.length);
  }

  spanOf(ids) {
    const c = this.centerOf(ids);
    let r = 0;
    ids.forEach((id) => { r = Math.max(r, this.booths.get(id).center.distanceTo(c) + this.booths.get(id).size / 2); });
    return r * 2;
  }

  // ---------- camera ----------

  // Smallest camera distance (at this tilt) that keeps the whole site on screen.
  fitSite(target, polar) {
    const { x0, x1, z0, z1 } = this.site;
    const corners = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(([x, z]) => new THREE.Vector3(x, 0, z));
    const cam = this.camera.clone();
    let dist = 200;
    for (let i = 0; i < 80; i++) {
      cam.position.set(target.x, target.y + Math.cos(polar) * dist, target.z + Math.sin(polar) * dist);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      const inside = corners.every((c) => {
        const p = c.clone().project(cam);
        return Math.abs(p.x) < 0.96 && Math.abs(p.y) < 0.94 && p.z < 1;
      });
      if (inside) break;
      dist *= 1.04;
    }
    return new THREE.Vector3(target.x, target.y + Math.cos(polar) * dist, target.z + Math.sin(polar) * dist);
  }

  resetView(animate = true) {
    const { x0, x1, z0, z1 } = this.site;
    const target = new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const pos = this.topView ? this.fitSite(target, 0.0001) : this.fitSite(target, 0.74);
    this.flyTo(pos, target, animate ? 750 : 0);
  }

  setTopView(on) {
    this.topView = on;
    const c = this.controls;
    c.enableRotate = !on;
    c.mouseButtons = on
      ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    c.touches = on
      ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }
      : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    if (this.selected.length) this.focus(this.selected);
    else this.resetView(true);
  }

  focus(ids, animate = true) {
    const list = ids.filter((id) => this.booths.has(id));
    if (!list.length) return;
    const target = this.centerOf(list);
    const span = Math.max(this.spanOf(list), 30);
    // Small map panes (phones) get a closer view so the booth isn't tiny.
    const near = Math.min(this.container.clientWidth, this.container.clientHeight) < 500 ? 0.72 : 1;
    if (this.topView) {
      const h = Math.max(330, span * 5) * near;
      this.flyTo(new THREE.Vector3(target.x, h, target.z + 0.01), target, animate ? 750 : 0);
      return;
    }
    const dist = Math.max(300, span * 4) * near;
    // Keep the current compass direction, but use a comfortable tilt.
    const off = this.camera.position.clone().sub(this.controls.target);
    const azimuth = Math.atan2(off.x, off.z);
    const polar = 0.82;
    const pos = new THREE.Vector3(
      target.x + Math.sin(polar) * Math.sin(azimuth) * dist,
      Math.cos(polar) * dist,
      target.z + Math.sin(polar) * Math.cos(azimuth) * dist,
    );
    this.flyTo(pos, target, animate ? 750 : 0);
  }

  zoomBy(factor) {
    const off = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(off.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    off.setLength(len);
    this.flyTo(this.controls.target.clone().add(off), this.controls.target.clone(), 300);
  }

  flyTo(pos, target, ms) {
    if (!ms) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.tween = null;
      return;
    }
    this.tween = {
      t0: performance.now(), ms,
      p0: this.camera.position.clone(), p1: pos,
      q0: this.controls.target.clone(), q1: target,
    };
  }

  // Screen position (CSS px within the container) of a point above the given booths.
  screenPoint(ids, lift = 20) {
    const list = ids.filter((id) => this.booths.has(id));
    if (!list.length) return null;
    const p = this.centerOf(list);
    p.y = SELECTED_H + lift;
    p.project(this.camera);
    if (p.z > 1) return null;
    return {
      x: (p.x * 0.5 + 0.5) * this.container.clientWidth,
      y: (-p.y * 0.5 + 0.5) * this.container.clientHeight - (this.topView ? 30 : 6),
    };
  }

  // ---------- input ----------

  initInput() {
    const el = this.renderer.domElement;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    let down = null;

    const hit = (e) => {
      const r = el.getBoundingClientRect();
      this.pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects([...this.pickables, ...this.rooms], false);
      if (!hits.length) return null;
      const o = hits[0].object;
      return o.userData.boothId ? { boothId: o.userData.boothId } : o.userData.room ? { room: o.userData.room } : null;
    };

    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.tween = null;
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      const quick = performance.now() - down.t < 600;
      down = null;
      if (moved > 7 || !quick || e.button > 0) return;
      const h = hit(e);
      this.dispatchEvent(new CustomEvent('pick', { detail: { boothId: h?.boothId || null } }));
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const h = hit(e);
      const id = h?.boothId || null;
      if (id !== this.hoverId) {
        const prev = this.hoverId;
        this.hoverId = id;
        if (prev && this.booths.has(prev)) this.applyBooth(this.booths.get(prev));
        if (id) this.applyBooth(this.booths.get(id));
      }
      el.style.cursor = id ? 'pointer' : '';
      const r = el.getBoundingClientRect();
      this.dispatchEvent(new CustomEvent('hover', {
        detail: { boothId: id, room: h?.room || null, x: e.clientX - r.left, y: e.clientY - r.top },
      }));
    });
    el.addEventListener('pointerleave', () => {
      const prev = this.hoverId;
      this.hoverId = null;
      if (prev && this.booths.has(prev)) this.applyBooth(this.booths.get(prev));
      this.dispatchEvent(new CustomEvent('hover', { detail: { boothId: null, room: null } }));
    });
  }

  // ---------- frame loop ----------

  loop() {
    const tick = () => {
      requestAnimationFrame(tick);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      const t = this.clock.elapsedTime;

      if (this.tween) {
        const k = Math.min(1, (performance.now() - this.tween.t0) / this.tween.ms);
        const e = ease(k);
        this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, e);
        this.controls.target.lerpVectors(this.tween.q0, this.tween.q1, e);
        if (k >= 1) this.tween = null;
      }
      this.controls.update();
      if (Math.abs(this.inset - this.insetTarget) > 0.5) {
        this.inset += (this.insetTarget - this.inset) * Math.min(1, dt * 8 + 0.05);
        if (Math.abs(this.inset - this.insetTarget) <= 0.5) this.inset = this.insetTarget;
        this.applyInset();
      }

      for (const b of this.booths.values()) {
        if (Math.abs(b.height - b.targetH) > 0.01) {
          b.height += (b.targetH - b.height) * Math.min(1, dt * 10 + 0.08);
          b.mesh.scale.y = b.height;
          b.label.position.y = b.height + 0.06;
        }
        if (b.star) b.star.position.set(b.center.x + b.size * 0.32, b.height + 3.2, b.center.z - b.size * 0.32);
      }
      this.pin.visible = this.selected.length > 0 && !this.topView;
      if (this.ring.visible) {
        const top = Math.max(...this.selected.map((id) => this.booths.get(id).height));
        this.pin.position.y = top + 2 + Math.sin(t * 3.2) * 1.6;
        this.pin.rotation.y = t * 1.2;
        const r = this.ring.userData.radius || 12;
        const pulse = (t * 0.9) % 1;
        this.ring.scale.setScalar(r * (0.8 + pulse * 0.6));
        this.ring.material.opacity = 0.75 * (1 - pulse);
      }
      this.renderer.render(this.scene, this.camera);
      if (this.onFrame) this.onFrame();
    };
    tick();
  }
}
