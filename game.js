// The in-game client: rendering, local player, remote players, effects, HUD.
import * as THREE from 'three';
import {
  World, EYE, PLAYER_RADIUS, PLAYER_HEIGHT, GRAVITY, CELL,
  rayVsPlayer, penFactor, blastField, blastDamage, blastDistance,
} from './world.js';
import { resolveMap } from './maps.js';
import { buildMapScene, THEMES } from './mapview.js';
import { WEAPONS, SPOON, U, TOP_SPEED, ACCURATE_SPEED, STARTER_PISTOL, runSpeed, penMetres, patternAt, itemDef, itemName } from './weapons.js';
import { DEFAULT_CROSSHAIR, crosshairCode, parseCrosshairCode } from './crosshair.js';
import { RULES } from './config.js';
import { makePlayerModel, setModelWeapon, animateModel, modelRecoil, modelSwing, makeViewModel, makeBombModel, makeDropModel, setModelDetail, TEAM_COLORS, makeMonsterModel, animateMonster } from './models.js';
import { Ragdolls } from './ragdoll.js';
import { keyMap, keyLabel, reverseMap } from './keys.js';
import { radialTexture } from './textures.js';
import { resolveGraphics } from './graphics.js';
import { PostFX } from './post.js';
import { inspectPose, inspectTrick, drawPose, swingPose, poseViewModel } from './anim.js';
import * as sfx from './audio.js';
import { Input } from './input.js';
import { Hud, TEAM_NAMES } from './hud.js';
import { BuyMenu } from './buy.js';
import { icon } from './icons.js';
import { BackroomsFX } from './brfx.js';
import { BR, wallFace } from './brmap.js';

const BOMB_STATES = ['none', 'carried', 'dropped', 'planted', 'defused', 'exploded'];
const INTERP_DELAY = 110; // ms
const TMP = new THREE.Vector3();

// ---- movement tuning (CS-style; 1 game unit = 0.0254 m) ----
const JUMP_V = Math.sqrt(2 * GRAVITY * 54 * U);   // a normal jump reaches ~54 units
const FRICTION = 5.2;
const STOP_SPEED = 80 * U;
const ACCEL = 5.5;
const COUNTER_STRAFE = 2.5;     // extra braking when you press the opposite key
const AIR_ACCEL = 12;
const AIR_CAP = 30 * U;         // air-strafing can only add a little speed per tick
const MAX_SPEED = 1.3 * TOP_SPEED * U;   // hard cap so bunny-hop chains stay short
const WALK = 0.52;
const WADE = 0.72;              // knee-deep canal water (canal map)
const BOOST_R = 0.5;            // stand on a teammate whose head is this close (horizontally)
const STEP_SPEED = 140 * U;     // faster than this on the ground = audible footsteps
const BLAST_SPEED = 45;         // m/s the shockwave travels (matches the server's delay)

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// 83 → "1:23"
const fmtClock = s => `${Math.floor((s || 0) / 60)}:${String(Math.floor((s || 0) % 60)).padStart(2, '0')}`;

// footsteps (and landings) quieter on these maps: 0.6 = 40 % quieter (owner's request)
const STEP_VOLUME = { outpost: 0.6, flame: 0.6 };

// the ending scene's spot: in the exit doorway
const d0 = (esc) => ({ x: esc.door.x + esc.door.nx * 0.15, z: esc.door.z + esc.door.nz * 0.15 });
const smoothstep = t => t * t * (3 - 2 * t);

export class Game {
  constructor({ transport, myId, roster, map, practice, settings, quality, isHost, onPause, mode, variant, night, doors, notes, key }) {
    this.transport = transport;
    this.myId = myId;
    this.practice = practice;
    this.settings = settings;
    this.isHost = isHost;
    this.onPause = onPause;
    this.mapId = map;
    this.dm = mode === 'dm';   // deathmatch: free-for-all, guns free, quick respawns
    this.br = mode === 'br';   // the Backrooms: co-op escape from a random maze, no guns, a monster
    this.world = new World(resolveMap(map, variant));
    this.hud = new Hud();
    this.running = true;
    this.paused = false;
    this.clock = 0;

    // ---- renderer (graphics settings: graphics.js) ----
    const G = this.gfx = quality && typeof quality === 'object' ? quality : resolveGraphics(null, !!settings.touch);
    this.night = !!night;
    const usePost = G.ao || G.bloom || G.look || G.aa === 'fxaa';
    this.renderer = new THREE.WebGLRenderer({ antialias: G.aa === 'msaa' && !usePost, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.max(0.5, Math.min(3, Math.min(window.devicePixelRatio || 1, 2) * (G.renderScale || 1))));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);   // false: the canvas keeps filling the page (style.css)
    this.renderer.shadowMap.enabled = G.shadows !== 'off';
    this.renderer.shadowMap.type = G.shadows === 'high' || G.shadows === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    setModelDetail(G.modelDetail);
    // soft reflections for metal and plastic (guns, gear): a tiny sky-and-sun scene baked once
    if (G.modelDetail !== 'low') {
      const pm = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      const geo = new THREE.SphereGeometry(10, 24, 12);
      const top = new THREE.Color(this.night ? '#1a2238' : '#d6e6ff'), mid = new THREE.Color(this.night ? '#2a2a30' : '#b8a888'), low = new THREE.Color(this.night ? '#0c0c10' : '#4a3e30');
      const cols = [];
      for (let i = 0; i < geo.attributes.position.count; i++) {
        const y = geo.attributes.position.getY(i) / 10;
        const c = y > 0 ? mid.clone().lerp(top, y) : mid.clone().lerp(low, -y);
        cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      const sunPanel = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ color: this.night ? '#6a7fb0' : '#fff6e0', side: THREE.DoubleSide }));
      sunPanel.position.set(4, 7, 3); sunPanel.lookAt(0, 0, 0);
      envScene.add(sunPanel);
      this.envMap = pm.fromScene(envScene, 0.04).texture;
      pm.dispose();
    }
    this.post = usePost ? new PostFX(this.renderer, { ao: !!G.ao, bloom: !!G.bloom, fxaa: G.aa === 'fxaa', msaa: G.aa === 'msaa', look: !!G.look }) : null;
    this.canvas = this.renderer.domElement;
    this.canvas.id = 'game-canvas';
    document.getElementById('stage').appendChild(this.canvas);

    this.scene = new THREE.Scene();
    const built = buildMapScene(this.world, this.renderer, G, this.night);
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, Math.max(120, built.far + 40));
    this.camera.rotation.order = 'YXZ';
    this.sky = [];
    built.group.traverse(o => { if (o.userData.sky) this.sky.push(o); });
    this.mapGroup = built.group;
    this.mapUpdate = built.group.userData.update || null;     // flickering lights (Backrooms)
    // doors that open and shut (Backrooms): the host says which are shut
    this.setDoorView = built.group.userData.setDoor || null;
    // (2 = kicked in by the monster: open for good, lying on the floor)
    if (doors) doors.forEach((o, i) => { this.world.setDoor(i, !!o); if (o === 2 && this.world.doors[i]) this.world.doors[i].broken = true; if (this.setDoorView) this.setDoorView(i, !!o, 1, true, o === 2); });
    this.builtMap = built;
    this.pendingNotes = notes;
    // the team shortcuts: where you stand for the red key and for the two switches (the same sums as the host)
    const plan = this.br && this.world.def.br;
    const spot = (r, out) => { const f = wallFace(r.x, r.z, r.wx, r.wz); return { x: f.x + f.nx * out, z: f.z + f.nz * out, fx: f.x, fz: f.z }; };
    this.keySpot = plan && plan.key ? spot(plan.key, 0.55) : null;
    this.switchSpots = plan ? (plan.switches || []).map(s => spot(s, 0.5)) : [];
    this.keyTaken = !!key;
    if (built.group.userData.setKey) built.group.userData.setKey(!this.keyTaken);
    // this map's acoustics and background sound
    sfx.setRoom(this.world.def.theme);
    sfx.setStepVolume(STEP_VOLUME[this.mapId] ?? 1);
    sfx.startAmbience(this.world.def.theme, this.night, { x: this.world.width / 2, z: this.world.depth / 2 }, Math.max(this.world.width, this.world.depth) * 0.6);
    this.scene.add(built.group);
    this.scene.fog = built.fog;
    this.billboards = [];
    built.group.traverse(o => { if (o.userData.billboard) this.billboards.push(o); });

    // first-person weapon is drawn in its own pass so it never clips walls
    this.vmScene = new THREE.Scene();
    if (this.envMap) { this.vmScene.environment = this.envMap; this.scene.environment = this.envMap; this.scene.environmentIntensity = 0.6; }
    this.vmCamera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.01, 10);
    this.vmScene.add(new THREE.HemisphereLight('#ffffff', '#776655', this.night ? 0.9 : 1.9));
    const vmSun = new THREE.DirectionalLight(this.night ? '#c8d4f0' : '#fff6e8', this.night ? 0.9 : 2.4);
    vmSun.position.set(1, 2, 1.5);
    const vmFill = new THREE.DirectionalLight('#cfe0ff', this.night ? 0.4 : 0.9);
    vmFill.position.set(-2, 0.5, 0.5);
    this.vmScene.add(vmSun, vmFill);
    this.viewModel = null;
    this.vmKick = 0; this.vmBob = 0; this.vmLand = 0;
    this.flashTex = radialTexture('rgba(255,240,200,1)', 'rgba(255,160,40,0)');
    this.vmFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.vmFlash.visible = false;
    this.muzzleLight = new THREE.PointLight('#ffcc88', 0, 12, 2);
    this.scene.add(this.muzzleLight);

    this.setupEffects();
    this.setupFlashlights();
    // the Backrooms on this screen: snatches, notes, hallucinations, flashlights on the baked walls
    this.fx = this.br ? new BackroomsFX(this, this.builtMap) : null;
    if (this.fx) this.fx.startNotes(this.pendingNotes);

    // ---- state ----
    this.me = {
      pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, onGround: true,
      alive: false, hp: 100, armor: 0, helmet: false, kit: false, money: 800, team: 'atk',
      inv: { primary: null, secondary: STARTER_PISTOL.atk }, weapon: STARTER_PISTOL.atk,
      melee: null, swingAt: -10, swingStab: false, swingDir: 1,     // the secret spoon (only if the host gives you one)
      ammo: {}, reloading: 0, nextShot: 0, deployUntil: 0, autoReloadAt: 0,
      zoom: 0, rezoom: 0, rezoomAt: 0,
      recoilIdx: 0, recP: 0, recY: 0, fireInacc: 0, lastFire: -10,
      hurtP: 0, hurtY: 0, tag: 0, landPen: 0, landSlow: 0,
      burst: false, burstLeft: 0, burstNext: 0,
      peakY: 0, airTime: 0, jumpAt: -1, landedAt: -1,
      using: false, useCooldown: 0,
      eyeOff: EYE, standingOn: null, mateLast: null,
      deathTime: 0, spectate: null, killedBy: '', stepTimer: 0, clickedEmpty: false, kills: 0, deaths: 0,
    };
    this.round = 0;
    this.phase = 'freeze';
    this.timeLeft = 0;
    this.roundElapsed = 0;
    this.score = [0, 0];
    this.bomb = { state: 'none', carrier: null, x: 0, y: 0, z: 0, prog: 0, user: null, site: null, need: RULES.defuseTime };
    this.bombModel = makeBombModel();
    this.bombModel.visible = false;
    this.scene.add(this.bombModel);
    this.beepTimer = 0;
    this.blast = null;
    this.remotes = new Map();
    this.ragdolls = new Ragdolls(this.scene, this.world);
    if (this.br) this.ragdolls.setCeiling(BR.ceiling);       // (bodies swung about by the tall one stay under it)
    this.drops = new Map();     // id → { kind, w, model, ... }
    this.buyOpen = false;
    this.weaponKills = {};      // kills per gun this match (for account stats)
    this.chatOpen = false;
    this.chatTeam = false;
    this.bindChat();
    this.sendTimer = 0;
    this.shake = 0;
    this.setRoster(roster);

    this.input = new Input(this.canvas, document.getElementById('touch'), settings);
    this.input.onPauseRequest = () => { if (this.running && !this.settings.touch) this.onPause(); };
    document.body.classList.toggle('touch', !!settings.touch);
    this.hud.prepareRadar(this.world);
    this.hud.show(true);
    this.buyMenu = new BuyMenu(item => this.transport.send({ t: 'buy', item }), item => this.transport.send({ t: 'refund', item }));
    this.closeHandler = () => this.toggleBuy(false);
    document.getElementById('buy-close').addEventListener('click', this.closeHandler);
    this.setViewModel();

    // Keep the picture the size of the screen. Phones don't always say when the screen changed
    // (turning the phone, the address bar sliding away, going full screen), so besides listening
    // for it the game also looks a few times a second (see loop). The canvas itself always fills
    // the page (style.css); only the drawing size is changed here.
    this.onResize = () => {
      const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
      this.viewW = w; this.viewH = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = this.vmCamera.aspect = w / h;
      this.camera.updateProjectionMatrix(); this.vmCamera.updateProjectionMatrix();
    };
    this.onResize();
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', this.onResize);
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    // spawn somewhere sensible until the host places us
    const s = this.world.spawns.atk[0] || this.world.spawns.dm[0];
    this.me.pos.x = s.x; this.me.pos.z = s.z;
    this.me.yaw = s && Number.isFinite(s.yaw) ? s.yaw : 0;
    if (this.dm) this.hud.center('Deathmatch', `Everyone for themselves — first to ${RULES.dm.killLimit} kills`, TEAM_COLORS.ffa.css, 4);
    document.body.classList.toggle('br-mode', this.br);
    if (this.br) {
      this.hud.center('The Backrooms', 'Heavy door, key, locked door, pits, levers, exit. Walking is quiet: it hears you sprint.', '#e8dc8a', 7);
      // the jump button becomes a hold-to-sprint button (no jumping in here)
      const jb = document.getElementById('btn-jump');
      jb.innerHTML = icon('run'); jb.setAttribute('aria-label', 'Sprint');
      this.brHintUntil = 14;
    }
  }

  destroy() {
    this.running = false;
    document.body.classList.remove('br-mode');
    if (this.br) { const jb = document.getElementById('btn-jump'); jb.innerHTML = icon('jump'); jb.setAttribute('aria-label', 'Jump'); }
    if (this.fx) this.fx.destroy();
    sfx.stopAmbience();
    this.cancelReloadSfx();
    this.closeChat();
    document.getElementById('chat-box').removeEventListener('submit', this.chatHandlers.submit);
    document.getElementById('chat-input').removeEventListener('keydown', this.chatHandlers.key);
    document.getElementById('chat-mode').removeEventListener('click', this.chatHandlers.mode);
    document.getElementById('chat-close').removeEventListener('click', this.chatHandlers.close);
    document.getElementById('btn-chat').removeEventListener('touchend', this.chatHandlers.tap);
    document.getElementById('chat-feed').replaceChildren();
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('orientationchange', this.onResize);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', this.onResize);
    this.input.destroy();
    document.getElementById('buy-close').removeEventListener('click', this.closeHandler);
    this.buyMenu.update({ open: false });
    this.buyMenu.destroy();
    this.hud.blastPreview(null);
    this.ragdolls.clear();
    if (this.post) this.post.dispose();
    if (this.envMap) this.envMap.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.hud.show(false);
    this.hud.scope(false);
    document.body.classList.remove('touch');
  }

  ammoOf(id) {
    if (!WEAPONS[id]) return { mag: 0, res: 0 };   // bomb
    if (!this.me.ammo[id]) this.me.ammo[id] = { mag: WEAPONS[id].mag, res: WEAPONS[id].reserve };
    return this.me.ammo[id];
  }

  // can I hold this item right now?
  owns(id) {
    const me = this.me;
    if (id === 'c4') return this.bomb.state === 'carried' && this.bomb.carrier === this.myId;
    return !!id && (id === me.inv.primary || id === me.inv.secondary || id === me.melee);
  }

  setViewModel(weapon = this.me.weapon, team = this.me.team) {
    if (this.viewModel) this.vmScene.remove(this.viewModel);
    this.vmKey = weapon + '|' + team;
    this.viewModel = makeViewModel(weapon, team);
    this.viewModel.scale.setScalar(0.85);
    // the muzzle flash rides on the gun's muzzle point (so it follows reload / recoil motion)
    this.viewModel.userData.muzzle.add(this.vmFlash);
    this.vmFlash.position.set(0, 0, -0.02);
    this.vmFlash.scale.setScalar(0.42);
    this.vmScene.add(this.viewModel);
  }

  // ---------- roster / remotes ----------
  setRoster(roster) {
    this.roster = roster;
    const ids = new Set();
    for (const r of roster) {
      ids.add(r.id);
      if (r.id === this.myId) {
        if (this.me.team !== r.team) { this.me.team = r.team; this.setViewModel(); }
        continue;
      }
      let rem = this.remotes.get(r.id);
      if (rem && rem.team !== r.team) { this.scene.remove(rem.model.root); rem = null; this.remotes.delete(r.id); }
      if (!rem) {
        rem = {
          id: r.id, name: r.name, team: r.team, dummy: r.dummy, buf: [], alive: false, hp: 100, w: STARTER_PISTOL[r.team] || 'glock',
          kills: 0, deaths: 0, rp: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 }, model: null, stepTimer: 0, deadT: 0, use: 0,
          armor: 0, money: 0, vy: 0, fallFrom: null, speed: 0, vel: { x: 0, y: 0, z: 0 },
        };
        this.remotes.set(r.id, rem);
      }
      rem.name = r.name;
      rem.bot = !!r.bot;
      if (rem.xhCode !== r.xh) { rem.xhCode = r.xh; rem.xh = r.xh ? parseCrosshairCode(r.xh) : null; }
      if (!rem.model && r.team === 'monster') {
        rem.model = makeMonsterModel();
        rem.model.root.visible = false;
        this.scene.add(rem.model.root);
      }
      if (!rem.model) {
        // the Backrooms: hazmat suits, with the name on the back instead of a tag over the head
        rem.model = this.br ? makePlayerModel(r.team, r.name, false, 'hazmat') : makePlayerModel(r.team, r.name, this.isMate(r));
        rem.model.root.visible = false;
        this.scene.add(rem.model.root);
      }
    }
    for (const [id, rem] of this.remotes) {
      if (!ids.has(id)) { this.scene.remove(rem.model.root); this.remotes.delete(id); }
    }
    // teammates' name tags depend on our team
    for (const rem of this.remotes.values()) {
      if (rem.model.monster || this.br) continue;
      const shouldLabel = this.isMate(rem);
      if (!!rem.model.label !== shouldLabel) {
        this.scene.remove(rem.model.root);
        rem.model = makePlayerModel(rem.team, rem.name, shouldLabel);
        this.scene.add(rem.model.root);
      }
    }
  }

  // name of the key bound to an action, for on-screen hints
  key(action) { return keyLabel(keyMap(this.settings.keys)[action]); }

  // ---------- chat ----------
  bindChat() {
    const box = document.getElementById('chat-box'), input = document.getElementById('chat-input'), mode = document.getElementById('chat-mode');
    this.chatHandlers = {
      submit: (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (text) this.transport.send({ t: 'chat', text: text.slice(0, 100), team: this.chatTeam });
        this.closeChat();
      },
      key: (e) => { if (e.key === 'Escape') { e.preventDefault(); this.closeChat(); } e.stopPropagation(); },
      mode: () => { this.chatTeam = !this.chatTeam; this.syncChatMode(); input.focus(); },
      close: () => this.closeChat(),
      // phones only open the keyboard when focus happens during the tap itself, so the 💬 button
      // focuses the box on touchend (the game loop opening it a frame later is too late)
      tap: () => { if (!this.chatOpen) this.openChat(false); input.focus(); },
    };
    box.addEventListener('submit', this.chatHandlers.submit);
    input.addEventListener('keydown', this.chatHandlers.key);
    mode.addEventListener('click', this.chatHandlers.mode);
    document.getElementById('chat-close').addEventListener('click', this.chatHandlers.close);
    document.getElementById('btn-chat').addEventListener('touchend', this.chatHandlers.tap);
  }

  syncChatMode() {
    const mode = document.getElementById('chat-mode');
    const team = this.chatTeam && !this.dm;
    mode.textContent = team ? 'TEAM' : 'ALL';
    mode.classList.toggle('team', team);
  }

  openChat(team) {
    if (this.chatOpen) return;
    this.chatOpen = true;
    this.chatTeam = !!team;
    this.syncChatMode();
    this.input.held.clear(); this.input.updateMove(); this.input.fire = false;
    if (!this.settings.touch) this.input.releaseForMenu();
    const box = document.getElementById('chat-box'), input = document.getElementById('chat-input');
    box.classList.remove('hidden');
    input.value = '';
    input.placeholder = this.settings.touch ? 'Say something…' : 'Say something… (Enter to send, Esc to cancel)';
    input.focus();
    setTimeout(() => input.focus(), 0);
  }

  closeChat() {
    if (!this.chatOpen) return;
    this.chatOpen = false;
    const input = document.getElementById('chat-input');
    input.blur();
    document.getElementById('chat-box').classList.add('hidden');
    if (!this.settings.touch && !this.paused && !this.buyOpen) this.input.requestLock();
  }

  // is this remote player on my team? (nobody is in deathmatch)
  isMate(r) { return !this.dm && r.team === this.me.team && !r.dummy; }

  playerById(id) {
    if (id === this.myId) return { id, name: this.settings.name, team: this.me.team };
    const r = this.remotes.get(id);
    return r ? { id, name: r.name, team: r.team } : { id, name: '?', team: 'atk' };
  }

  // ---------- network messages ----------
  onMessage(m) {
    switch (m.t) {
      case 'snap': return this.onSnap(m);
      case 'roster': return this.setRoster(m.roster);
      case 'round': return this.onRound(m);
      case 'spawn': return this.onSpawn(m);
      case 'inv': return this.onInv(m);
      case 'income':
        this.hud.income(m.items);
        if (Number.isFinite(m.money)) this.me.money = m.money;
        return;
      case 'phase':
        if (m.phase === 'live') {
          this.hud.center('GO!', this.me.team === 'atk' ? 'Plant the bomb at the site' : 'Defend the site', '#fff', 1.6);
          sfx.playChime(true);
        }
        return;
      case 'spotted':
        // the monster has seen you
        this.shake = Math.min(1.2, this.shake + 0.8);
        for (const r of this.remotes.values()) if (r.id === 'monster') sfx.playScreech({ x: r.rp.x, y: r.rp.y + 2.4, z: r.rp.z }, this.occlusion(r.rp.x, r.rp.y + 2, r.rp.z));
        this.hud.center('', 'It has seen you — RUN', '#ff6b4a', 2);
        return;
      case 'snatch': case 'note': case 'lure': case 'dropBody': case 'hangBody':
        if (this.fx) this.fx.onMessage(m);
        return;
      case 'door': {
        const d = this.world.doors[m.i];
        if (!d) return;
        this.world.setDoor(m.i, m.open);
        if (m.broken) d.broken = true;
        // shut on me while I stood in the doorway: I'm pushed out to the side I was more on
        if (!m.open && this.me.alive && this.world.pushOutOfDoor(m.i, this.me.pos)) { this.me.vel.x = this.me.vel.z = 0; }
        if (this.setDoorView) this.setDoorView(m.i, m.open, m.swing, false, !!m.broken);
        sfx.playDoor({ x: d.cx, y: 1.2, z: d.cz }, m.broken ? 'break' : m.open ? 'open' : 'shut', this.occlusion(d.cx, 1.2, d.cz));
        if (m.broken && Math.hypot(d.cx - this.me.pos.x, d.cz - this.me.pos.z) < 8) this.shake = Math.min(1.5, this.shake + 0.9);
        return;
      }
      case 'switch': {
        // someone pulled one of the two switches: its lamp goes green for 2 s
        if (this.builtMap && this.builtMap.group.userData.setSwitch) this.builtMap.group.userData.setSwitch(m.i, this.clock);
        const s = this.switchSpots[m.i];
        if (s && Math.hypot(s.fx - this.me.pos.x, s.fz - this.me.pos.z) < 12) sfx.playClick();
        return;
      }
      case 'boost': {
        if (m.end) { this.boostMe = null; return; }
        if (m.climber === this.myId || m.lifter === this.myId) this.boostMe = { t0: this.clock, dur: m.dur || 2.6, x: m.x, z: m.z, climber: m.climber === this.myId };
        return;
      }
      case 'key': {
        this.keyTaken = true;
        if (this.builtMap && this.builtMap.group.userData.setKey) this.builtMap.group.userData.setKey(false);
        if (m.id === this.myId) this.me.key = true;
        this.hud.center('', m.id === this.myId ? 'You have the key: find the locked door' : `${m.name} got the key`, '#e8c873', 3);
        sfx.playClick();
        return;
      }
      case 'keyBack': {
        this.keyTaken = false; this.me.key = false;
        if (this.builtMap && this.builtMap.group.userData.setKey) this.builtMap.group.userData.setKey(true);
        this.hud.center('', 'The key is back up on its shelf', '#e8c873', 3);
        return;
      }
      case 'doorRattle': {
        const d = this.world.doors[m.i];
        if (d) sfx.playDoor({ x: d.cx, y: 1.2, z: d.cz }, 'rattle', this.occlusion(d.cx, 1.2, d.cz));
        return;
      }
      case 'doorKick': {
        // it is kicking a shut door in: a boom, the door jumping in its frame
        const d = this.world.doors[m.i];
        if (!d) return;
        sfx.playDoor({ x: d.cx, y: 1.2, z: d.cz }, 'kick', this.occlusion(d.cx, 1.2, d.cz));
        if (this.builtMap && this.builtMap.group.userData.kickDoor) this.builtMap.group.userData.kickDoor(m.i, m.swing || 1);
        if (Math.hypot(d.cx - this.me.pos.x, d.cz - this.me.pos.z) < 7) this.shake = Math.min(1.2, this.shake + 0.5);
        return;
      }
      case 'escaped':
        if (m.id === this.myId) {
          this.me.alive = false; this.me.escaped = true; this.me.deathTime = performance.now();
          sfx.playEscape();
          // the ending: you walk up to the door and into the white, then your time (updateCamera plays it)
          const ex = this.world.exit;
          if (ex) {
            this.escapeScene = { t0: this.clock, x: this.me.pos.x, z: this.me.pos.z, yaw: this.me.yaw, pitch: this.me.pitch, door: ex };
            document.getElementById('br-escape-time').textContent = `${fmtClock(m.time)} in the Backrooms`;
          } else this.hud.center('You escaped!', `${fmtClock(m.time)} in the Backrooms`, '#9dffb5', 5);
        } else this.hud.center('', `${m.name} found the exit and escaped!`, '#9dffb5', 3);
        return;
      case 'shot': return this.onRemoteShot(m);
      case 'swing': return this.onRemoteSwing(m);
      case 'drops': return this.onDrops(m);
      case 'hit':
        this.hud.hitmarker(m.head, m.kill);
        if (m.kill && !m.mate) sfx.playKill(m.head); else sfx.playHit(m.head || m.kill);
        if (this.practice) this.hud.damagePop(m.dmg, m.head);
        if (m.mate) this.hud.center('', 'Careful — that\'s your teammate!', '#ff6b4a', 1.2);
        return;
      case 'hurt': return this.onHurt(m);
      case 'kill': return this.onKill(m);
      case 'chat':
        if (this.settings.showChat !== false) this.hud.chatLine(m, this.me.team);
        sfx.playClick();
        return;
      case 'bombDrop':
        if (this.me.team === 'atk' && m.by !== this.myId) this.hud.center('', 'The bomb was dropped', '#ffb347', 2);
        if (m.from) this.bombThrow = { from: m.from, to: [m.x, m.y, m.z], t: 0 };
        sfx.playDrop(m.from ? { x: m.x, y: m.y, z: m.z } : null);
        return;
      case 'planted': {
        this.hud.center('Bomb planted', `Site ${m.site} — ${this.me.team === 'def' ? 'defuse it!' : 'defend it!'}`, '#ff6b4a', 3);
        sfx.playChime(false);
        this.bomb.state = 'planted'; this.bomb.x = m.x; this.bomb.y = m.y; this.bomb.z = m.z;
        this.prepareBlast();
        return;
      }
      case 'defused':
        this.hud.center('Bomb defused', '', TEAM_COLORS.def.css, 3);
        this.clearBlast();
        return;
      case 'explode': return this.onExplode(m);
      case 'roundEnd': {
        const mine = m.winner === this.me.team;
        const reasons = { elim: 'Enemy team eliminated', time: 'Time ran out', bomb: 'The bomb exploded', defuse: 'The bomb was defused' };
        this.hud.center(`${TEAM_NAMES[m.winner]} win the round`, reasons[m.reason] || '', TEAM_COLORS[m.winner].css, 5);
        this.score = [m.score.atk, m.score.def];
        sfx.playChime(mine);
        return;
      }
      case 'halftime':
        this.score = [m.score.atk, m.score.def];
        this.hud.center('Switching sides', `You are now ${TEAM_NAMES[this.me.team] || ''} — money reset to $800`.trim(), '#fff', 5);
        this.me.ammo = {};
        sfx.playChime(true);
        return;
      case 'snapScore':
        this.score = [m.score.atk, m.score.def];
        this.round = m.round;
        this.me.alive = false;
        this.me.deathTime = performance.now() - 5000;
        if (m.now) this.hud.center('Joined the match', 'Buy time: get ready', '#fff', 3);
        else this.hud.center('Joined mid-round', 'You will spawn next round', '#fff', 4);
        return;
    }
  }

  onSnap(m) {
    this.phase = m.ph;
    this.timeLeft = m.tl;
    this.timeLeftAt = performance.now();
    this.score = m.sc;
    this.roundElapsed = m.bs;
    const now = performance.now();
    for (const p of m.p) {
      const [id, x, y, z, yaw, pitch, alive, hp, w, kills, deaths, teamIdx, use, ping, armor, flags, money] = p;
      if (id === this.myId) {
        this.me.hp = hp;
        this.me.kills = kills; this.me.deaths = deaths; this.me.ping = ping;
        this.me.armor = armor || 0; this.me.helmet = !!(flags & 1); this.me.kit = !!(flags & 2);
        if (Number.isFinite(money)) this.me.money = money;
        if (!alive && this.me.alive) { this.me.alive = false; this.me.deathTime = now; }
        this.me.escaped = !!(flags & 8);
        continue;
      }
      const r = this.remotes.get(id);
      if (!r) continue;
      const last = r.buf[r.buf.length - 1];
      if (last && Math.hypot(last.x - x, last.z - z) > 6) r.buf.length = 0;
      r.buf.push({ t: now, x, y, z, yaw, pitch });
      if (r.buf.length > 30) r.buf.shift();
      if (r.alive && !alive) r.deadT = now;
      if (!r.alive && alive) this.ragdolls.remove(id);   // respawned (practice)
      r.alive = !!alive; r.hp = hp; r.w = w; r.kills = kills; r.deaths = deaths; r.use = use; r.ping = ping;
      r.armor = armor || 0; r.money = money;
      r.light = !!(flags & 4);
      r.zm = (flags >> 4) & 3; r.rl = !!(flags & 64);     // zoomed in (scope level) / reloading, for spectators
      r.team = teamIdx === 0 ? 'atk' : teamIdx === 1 ? 'def' : teamIdx === 3 ? 'monster' : 'ffa';
      r.escaped = !!(flags & 8);
    }
    const [bs, carrier, bx, by, bz, prog, user, site, need] = m.b;
    Object.assign(this.bomb, { state: BOMB_STATES[bs], carrier, x: bx, y: by, z: bz, prog, user, site, need: need || RULES.defuseTime });
    // lost the bomb (dropped or planted) while holding it
    if (this.me.weapon === 'c4' && !this.owns('c4')) this.equip(this.bestWeapon(), true);
  }

  bestWeapon() { return this.me.inv.primary || this.me.inv.secondary || STARTER_PISTOL[this.me.team]; }

  onRound(m) {
    this.round = m.round;
    this.phase = 'freeze';
    this.roundElapsed = 0;
    this.score = [m.score.atk, m.score.def];
    const sp = m.spawns[this.myId];
    for (const r of this.remotes.values()) { r.buf.length = 0; r.alive = !!m.spawns[r.id]; if (r.model) r.model.root.visible = false; }
    this.ragdolls.clear();
    this.bombThrow = null;
    if (sp) {
      this.placeMe(sp[0], sp[1], sp[2], sp[3]);
    } else {
      this.me.alive = false;
      this.me.deathTime = performance.now() - 5000;
    }
    this.bomb.state = 'none';
    this.clearBlast();
    const buyKey = this.settings.touch ? 'Tap [[cart]] to buy' : `Press ${this.key('buy')} to buy`;
    this.hud.center(`Round ${m.round}`, m.carrier === this.myId ? `You have the bomb [[bomb]] · ${buyKey}` : buyKey, '#fff', 3);
    this.toggleBuy(false);
  }

  onSpawn(m) {
    this.round = m.rd;
    this.placeMe(m.x, m.y, m.z, m.yaw);
  }

  onInv(m) {
    const me = this.me;
    const bought = this.buyOpen && m.fresh && m.fresh.length;
    me.inv = m.inv; me.money = m.money; me.armor = m.armor; me.helmet = m.helmet; me.kit = m.kit;
    // the first time the spoon turns up in a game, remind its owner how to pull it out
    if (m.melee && !me.melee && !this.spoonHinted) { this.spoonHinted = true; this.spoonHintUntil = this.clock + 10; }
    me.melee = m.melee || null;
    me.refunds = m.refunds || {};
    for (const id of m.fresh || []) if (WEAPONS[id]) me.ammo[id] = { mag: WEAPONS[id].mag, res: WEAPONS[id].reserve };
    // a picked-up gun keeps the ammo that was left in it
    if (m.ammo) for (const [id, [mag, res]] of Object.entries(m.ammo)) if (WEAPONS[id]) me.ammo[id] = { mag, res };
    if (m.eq && this.owns(m.eq)) this.equip(m.eq, true);
    else if ((m.fresh && m.fresh.length) || !this.owns(me.weapon)) this.equip(this.owns(m.w) ? m.w : this.bestWeapon(), true);
    if (bought) sfx.playBuy();
    else if (m.ammo || m.eq) sfx.playEquip();
  }

  placeMe(x, y, z, yaw) {
    this.spawnedAt = this.clock;
    Object.assign(this.me, {
      alive: true, hp: 100, yaw, pitch: 0, spectate: null, zoom: 0, rezoom: 0, recoilIdx: 0, recP: 0, recY: 0,
      fireInacc: 0, hurtP: 0, hurtY: 0, tag: 0, landPen: 0, landSlow: 0, using: false, burstLeft: 0, reloading: 0,
      onGround: true, jumpAt: -1, eyeOff: EYE, standingOn: null, mateLast: null, swingAt: -10,
    });
    this.ragdolls.remove(this.myId);
    Object.assign(this.me.pos, { x, y, z });
    Object.assign(this.me.vel, { x: 0, y: 0, z: 0 });
    this.me.peakY = y;
    this.hud.death(null);
  }

  onHurt(m) {
    const me = this.me;
    me.hp = m.hp;
    if (Number.isFinite(m.armor)) me.armor = m.armor;
    sfx.playHurt();
    if (m.blast) {
      this.shake = Math.min(2.5, this.shake + 2);
    } else {
      // getting shot slows you down ("tagging") and, without armour, knocks your aim
      me.tag = 1;
      const strong = !m.armored;
      const amt = strong ? 0.07 : 0.01;
      me.hurtP += amt * (0.7 + Math.random() * 0.6);
      me.hurtY += (Math.random() - 0.5) * amt * 0.8;
      this.shake = Math.min(1, this.shake + (strong ? 0.5 : 0.15));
    }
    if (m.from) {
      const dx = m.from[0] - me.pos.x, dz = m.from[1] - me.pos.z;
      const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
      const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
      const ang = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      this.hud.hurt(ang * 180 / Math.PI);
    }
  }

  onKill(m) {
    if (m.killer === this.myId && m.victim !== this.myId && WEAPONS[m.w]) this.weaponKills[m.w] = (this.weaponKills[m.w] || 0) + 1;
    const killer = m.killer ? this.playerById(m.killer) : null;
    const victim = this.playerById(m.victim);
    this.hud.killfeed(killer, victim, m.w, m.head);
    if (m.victim === this.myId) {
      this.me.alive = false;
      this.cancelReloadSfx();
      this.me.deathTime = performance.now();
      this.me.zoom = 0;
      this.me.using = false;
      this.toggleBuy(false);
      this.me.killedBy = m.w === 'monster' ? 'It' : m.w === 'fall' ? 'the fall' : m.w === 'ceiling' ? 'the ceiling' : m.w === 'corner' ? 'something' : killer && m.killer !== this.myId ? `${killer.name} (${itemName(m.w)}${m.head ? ', headshot' : ''})` : (m.w === 'bomb' ? 'the bomb' : '');
      if (m.w === 'monster') { sfx.playGrab(); this.shake = 2.5; this.hud.center('', 'It got you', '#ff4a3a', 3); }
      if (m.w === 'fall') this.hud.center('', 'You fell into the dark', '#cfc28a', 3);
      if (m.w === 'ceiling' || m.w === 'corner') this.hud.center('', m.w === 'ceiling' ? 'Something in the ceiling took you' : 'Something took you', '#ff4a3a', 3);
      if (m.w !== 'fall' && m.w !== 'ceiling' && m.w !== 'corner' && !m.fate) this.spawnRagdoll(this.myId, m);
    } else {
      const r = this.remotes.get(m.victim);
      if (r) {
        r.alive = false; r.deadT = performance.now();
        if (r.model && r.buf.length && m.w !== 'fall' && m.w !== 'ceiling' && m.w !== 'corner' && !m.fate && !r.model.monster) this.spawnRagdoll(r.id, m);
      }
    }
    // caught by the tall one: the body is a ragdoll in its hand (slammed, then dragged off, hung up or dropped)
    if (m.fate && this.fx) { this.fx.takeBody(m); if (m.victim === this.myId) this.fx.caughtMe(m); }
    else if (m.fate) this.spawnRagdoll(m.victim, m);
  }

  // ---------- ragdolls ----------
  // Pose a model exactly as the player was when they died, then let physics take over.
  spawnRagdoll(id, m) {
    let model, pos, vel, yaw, pitch;
    if (id === this.myId) {
      const me = this.me;
      if (!this.myModel || this.myModel.team !== me.team) this.myModel = this.br ? makePlayerModel(me.team, this.settings.name, false, 'hazmat') : makePlayerModel(me.team, '', false);
      model = this.myModel;
      pos = me.pos; vel = me.vel; yaw = me.yaw; pitch = me.pitch;
      setModelWeapon(model, me.weapon);
      animateModel(model, 0.016, { speed: Math.hypot(me.vel.x, me.vel.z), pitch });
    } else {
      const r = this.remotes.get(id);
      model = r.model; pos = r.rp; vel = r.vel; yaw = r.rp.yaw;
      animateModel(model, 0.016, { speed: r.speed, pitch: r.rp.pitch });
    }
    model.gunHolder.visible = false;      // the gun drops separately
    model.root.position.set(pos.x, pos.y, pos.z);
    model.root.rotation.set(0, yaw, 0);
    let push = null;
    const def = itemDef(m.w);
    const force = m.w === 'bomb' ? 150 : !def ? 40
      : def.type === 'sniper' ? 120 : def.type === 'shotgun' ? 95 : def.type === 'rifle' ? 60 : def.type === 'smg' ? 45 : 40;
    if (m.from) {
      const cy = pos.y + 1.1;
      let dx = pos.x - m.from[0], dy = cy - m.from[1], dz = pos.z - m.from[2];
      if (m.w === 'bomb') dy = Math.max(dy, 0) + 2.5;
      const len = Math.hypot(dx, dy, dz) || 1;
      push = { dir: [dx / len, dy / len, dz / len], force, part: m.head ? 'head' : m.part };
    }
    this.ragdolls.spawn(id, model, vel || { x: 0, y: 0, z: 0 }, push);
    model.gunHolder.visible = true;
    if (id !== this.myId) model.root.visible = false;
  }

  onRemoteShot(m) {
    const r = this.remotes.get(m.id);
    if (r && r.model && WEAPONS[m.w]) modelRecoil(r.model, Math.min(1.2, 0.35 + WEAPONS[m.w].damage / 90));
    if (r && WEAPONS[m.w]) {
      r.lastShotAt = this.clock;
      if (r === this.specTarget) {
        const w = WEAPONS[m.w], R = this.vmRec || (this.vmRec = { z: 0, zv: 0, p: 0, pv: 0, r: 0, rv: 0 });
        const k = Math.min(1.7, 0.45 + (w.damage * w.pellets) / 70);
        R.zv += 0.65 * k; R.pv += 0.3 * k; R.rv += (Math.random() - 0.5) * 1.6 * k;
        this.vmKick = 1;
        this.vmFlash.visible = !r.zm && !m.s;
        this.vmFlash.material.rotation = Math.random() * Math.PI;
        this.muzzleTimer = Math.max(this.muzzleTimer || 0, 0.05);
      }
    }
    const [ox, oy, oz] = m.o;
    const d = Math.hypot(ox - this.me.pos.x, oz - this.me.pos.z);
    const silenced = !!m.s;
    sfx.playShot(m.w, { pos: { x: ox, y: oy - 0.2, z: oz }, silenced, occ: this.occlusion(ox, oy, oz) });
    // tracers and the flash start at the end of their gun's barrel (if we can see their model)
    const mz = r && r.model && r.model.root.visible ? this.remoteMuzzle(r) : null;
    // silencers hide tracers and the muzzle flash
    for (const e of m.e || []) {
      if (!Array.isArray(e)) continue;
      if (!silenced) {
        if (mz) this.addTracer(mz.x, mz.y, mz.z, e[0], e[1], e[2]);
        else {
          const dx = e[0] - ox, dy = e[1] - oy, dz = e[2] - oz;
          const len = Math.hypot(dx, dy, dz) || 1;
          this.addTracer(ox + dx / len * 0.8, oy - 0.15 + dy / len * 0.8, oz + dz / len * 0.8, e[0], e[1], e[2]);
        }
      }
      this.impactFx(e[0], e[1], e[2]);
    }
    if (r && !silenced) {
      if (mz) this.muzzleLight.position.copy(mz); else this.muzzleLight.position.set(ox, oy, oz);
      this.muzzleLight.intensity = 6;
      this.muzzleTimer = 0.05;
      if (mz) this.remoteFlash(r);
    }
  }

  // another player swung the spoon. m: { id, stab, hit: 0 air / 1 wall / 2 somebody }
  onRemoteSwing(m) {
    const r = this.remotes.get(m.id);
    if (!r || !r.buf.length) return;
    if (r.model) modelSwing(r.model, !!m.stab);
    r.swingAt = this.clock; r.swingStab = !!m.stab; r.swingDir = -(r.swingDir || -1);
    const eye = r.rp.y + EYE - 0.2;
    const pos = { x: r.rp.x - Math.sin(r.rp.yaw) * 0.6, y: eye, z: r.rp.z - Math.cos(r.rp.yaw) * 0.6 };
    const o = { pos, occ: this.occlusion(pos.x, pos.y, pos.z) };
    sfx.playSwing(o);
    if (m.hit === 2) sfx.playSpoonHit(o);
    else if (m.hit === 1) sfx.playSpoonWall(o);
  }

  // where another player's gun barrel ends, in the world
  remoteMuzzle(r) {
    const gun = r.model.gunHolder.children[0];
    const mz = gun && gun.userData && gun.userData.muzzle;
    if (!mz || !r.model.gunHolder.visible) return null;
    r.model.root.updateMatrixWorld(true);
    return mz.getWorldPosition(new THREE.Vector3());
  }

  // a quick flash at the end of another player's gun
  remoteFlash(r) {
    const gun = r.model.gunHolder.children[0];
    const mz = gun && gun.userData && gun.userData.muzzle;
    if (!mz) return;
    let f = mz.userData.flash;
    if (!f) {
      f = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      f.scale.setScalar(0.45);
      f.position.z = -0.08;
      mz.add(f);
      mz.userData.flash = f;
    }
    f.visible = true;
    f.material.rotation = Math.random() * Math.PI;
    f.userData.until = this.clock + 0.05;
    (this.remoteFlashes || (this.remoteFlashes = new Set())).add(f);
  }

  // ---------- dropped guns and kits ----------
  onDrops(m) {
    const seen = new Set();
    for (const [id, kind, w, x, y, z, yaw] of m.list || []) {
      seen.add(id);
      let d = this.drops.get(id);
      if (!d) {
        if (kind === 'gun' && !WEAPONS[w]) continue;
        const model = makeDropModel(kind, w);
        this.scene.add(model);
        d = { id, kind, w, model, x, y, z, yaw, throwT: 1, from: null };
        this.drops.set(id, d);
        if (id === m.fresh && m.from) {
          d.from = m.from; d.throwT = 0;
          sfx.playDrop({ x, y, z });
        }
      }
      Object.assign(d, { x, y, z, yaw });
    }
    for (const [id, d] of this.drops) {
      if (!seen.has(id)) { this.scene.remove(d.model); this.drops.delete(id); }
    }
  }

  updateDrops(dt) {
    for (const d of this.drops.values()) {
      const m = d.model;
      if (d.throwT < 1 && d.from) {
        // short arc from the thrower's hands to the floor
        d.throwT = Math.min(1, d.throwT + dt / 0.35);
        const k = d.throwT;
        m.position.set(d.from[0] + (d.x - d.from[0]) * k, d.from[1] + (d.y - d.from[1]) * k + Math.sin(Math.PI * k) * 0.4, d.from[2] + (d.z - d.from[2]) * k);
        m.rotation.set(0, d.yaw + (1 - k) * 4, 0);
      } else {
        m.position.set(d.x, d.y, d.z);
        m.rotation.set(0, d.yaw, 0);
      }
    }
    // the bomb flying out of someone's hands
    if (this.bombThrow) {
      const bt = this.bombThrow;
      bt.t = Math.min(1, bt.t + dt / 0.35);
      if (bt.t >= 1 || this.bomb.state !== 'dropped') this.bombThrow = null;
    }
  }

  // The dropped gun you'd pick up with E / ✋ (looking at it, or standing on it), if any
  pickTarget() {
    const me = this.me;
    if (!me.alive || me.using) return null;
    const ex = me.pos.x, ey = me.pos.y + me.eyeOff, ez = me.pos.z;
    const fx = -Math.sin(me.yaw) * Math.cos(me.pitch), fy = Math.sin(me.pitch), fz = -Math.cos(me.yaw) * Math.cos(me.pitch);
    let best = null, bestScore = -Infinity;
    for (const d of this.drops.values()) {
      if (d.kind !== 'gun') continue;
      const horiz = Math.hypot(d.x - me.pos.x, d.z - me.pos.z);
      if (horiz > 2.2 || Math.abs(d.y - me.pos.y) > 1.5) continue;
      const dx = d.x - ex, dy = d.y + 0.05 - ey, dz = d.z - ez;
      const len = Math.hypot(dx, dy, dz) || 1;
      const look = (dx * fx + dy * fy + dz * fz) / len;
      if (look < 0.85 && horiz > 0.8) continue;
      const score = look - horiz * 0.3;
      if (score > bestScore) { best = d; bestScore = score; }
    }
    return best;
  }

  tryPick() {
    const d = this.pickTarget();
    if (!d) return false;
    const w = WEAPONS[d.w];
    const cur = this.me.inv[w.slot];
    const a = cur ? this.ammoOf(cur) : null;
    this.transport.send({ t: 'pick', id: d.id, am: a ? [a.mag, a.res] : null });
    return true;
  }

  dropWeapon() {
    const me = this.me;
    if (!me.alive || me.using) return;
    const id = me.weapon;
    if (id === 'c4') { this.transport.send({ t: 'drop', w: 'c4' }); return; }
    if (id === me.melee) { this.hud.center('', 'The spoon stays with you', '#fff', 1); sfx.playDeny(); return; }
    if (!WEAPONS[id]) return;
    const slot = WEAPONS[id].slot;
    if (!me.inv[slot === 'primary' ? 'secondary' : 'primary']) { this.hud.center('', 'You can\'t drop your last weapon', '#fff', 1); sfx.playDeny(); return; }
    const a = this.ammoOf(id);
    this.transport.send({ t: 'drop', w: id, am: [a.mag, a.res] });
    // switch straight away; the host confirms with a new inventory
    me.inv = { ...me.inv, [slot]: null };
    this.equip(this.bestWeapon(), true);
  }

  // ---------- sound helpers ----------
  // what's underfoot at a spot: sand, snow, gravel, hard, metal, wood or water
  surfaceAt(x, y, z) {
    const theme = this.world.def.theme;
    const ground = { desert: 'sand', industrial: 'hard', snow: 'snow', harbour: 'hard', quarry: 'gravel', railyard: 'gravel', village: 'hard', tuscan: 'hard' }[theme] || 'hard';
    if (y < 0.3 && this.world.waterAt(x, z) > 0) return 'water';
    if (y < 0.1) return ground;
    const spans = this.world.cellSpans(Math.floor(x / CELL), Math.floor(z / CELL));
    let best = null;
    for (const sp of spans) if (Math.abs(sp.y1 - y) < 0.25) best = sp;
    if (!best) return ground;
    if (best.prop >= 0) return best.m === 'barrel' ? 'metal' : 'wood';
    const kind = (THEMES[theme] && THEMES[theme].mats[best.m] || ['blocks'])[0];
    return kind === 'metal' ? 'metal' : kind === 'crate' ? 'wood' : kind === 'sand' ? (theme === 'snow' ? 'snow' : 'sand') : 'hard';
  }
  // how much a wall is in the way between your ears and a sound (0 clear … 1 solid wall)
  occlusion(x, y, z) {
    const c = this.camera.position;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z, d = Math.hypot(dx, dy, dz);
    if (d < 1) return 0;
    const tr = this.world.trace(c.x, c.y, c.z, dx / d, dy / d, dz / d, d);
    if (tr.solid && tr.t < d - 0.4) return 1;
    return tr.pen.some(([a]) => a < d - 0.4) ? 0.35 : 0;
  }
  // is there a roof over this spot?
  roofOver(x, y, z) {
    const spans = this.world.cellSpans(Math.floor(x / CELL), Math.floor(z / CELL));
    return spans.some(sp => sp.y0 > y + 0.2 && sp.y0 < y + 7);
  }
  cancelReloadSfx() {
    if (this.reloadSfx) { this.reloadSfx(); this.reloadSfx = null; }
    if (this.boltSfx) { this.boltSfx(); this.boltSfx = null; }
  }

  panTo(x, z) {
    const dx = x - this.me.pos.x, dz = z - this.me.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    return (dx * Math.cos(this.camYaw || 0) - dz * Math.sin(this.camYaw || 0)) / len;
  }

  // ---------- night mode: flashlights ----------
  // Every player has a flashlight (L / 🔦). Others see the beam, the light it throws on walls
  // and the glow of the lens. The lights stay in the scene and only change brightness, so
  // switching them on and off never makes the game stutter.
  setupFlashlights() {
    this.flash = new Map();   // (my own flashlight state is me.light, off at the start)
    if (!this.night && !this.br) return;
    // (the Backrooms' flashlight reaches further and wider: it is what you have in the dark areas)
    this.myLight = this.br ? new THREE.SpotLight('#fff1d2', 0, 48, 0.36, 0.9, 1.0) : new THREE.SpotLight('#fff1d2', 0, 38, 0.36, 0.55, 1.1);
    this.myLight.castShadow = false;
    this.scene.add(this.myLight, this.myLight.target);
    this.beamTex = radialTexture('rgba(255,244,214,1)', 'rgba(255,230,180,0)');
  }

  flashlightFor(r) {
    let f = this.flash.get(r.id);
    if (f) return f;
    const spot = this.br ? new THREE.SpotLight('#fff1d2', 0, 42, 0.36, 0.9, 1.0) : new THREE.SpotLight('#fff1d2', 0, 32, 0.36, 0.55, 1.1);
    const L = 8;
    const geo = new THREE.ConeGeometry(1.9, L, 20, 1, true);
    geo.translate(0, -L / 2, 0);
    geo.rotateX(Math.PI / 2);   // tip at the lens, widening forward (-z)
    const beam = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { uOn: { value: 0 } },
      vertexShader: 'varying float vL; void main() { vL = clamp(-position.z / 8.0, 0.0, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float uOn; varying float vL; void main() { float a = pow(1.0 - vL, 1.7) * 0.16 * uOn; gl_FragColor = vec4(vec3(1.0, 0.95, 0.82) * a, 1.0); }',
    }));
    beam.frustumCulled = false;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.beamTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.scale.setScalar(0.45);
    const group = new THREE.Group();
    group.add(beam, glow);
    this.scene.add(spot, spot.target, group);
    f = { spot, beam, glow, group };
    this.flash.set(r.id, f);
    return f;
  }

  toggleFlashlight() {
    if ((!this.night && !this.br) || !this.me.alive) return;
    this.me.light = !this.me.light;
    this.transport.send({ t: 'light', on: this.me.light });
    sfx.playClick();
  }

  updateFlashlights() {
    if (!this.night && !this.br) return;
    const me = this.me, cam = this.camera;
    const on = me.alive && me.light;
    this.myLight.intensity = on ? (this.br ? 12.8 : 9) : 0;
    if (on) {
      const fwd = TMP.set(0, 0, -1).applyQuaternion(cam.quaternion);
      this.myLight.position.copy(cam.position).addScaledVector(fwd, 0.2).y -= 0.12;
      this.myLight.target.position.copy(cam.position).addScaledVector(fwd, 10);
    }
    for (const r of this.remotes.values()) {
      if (!r.model) continue;
      const f = this.flashlightFor(r);
      const lit = r.alive && r.light && r.model.root.visible;
      f.spot.intensity = lit ? (this.br ? 11.2 : 9) : 0;
      f.group.visible = lit;
      if (!lit) continue;
      const eye = r.rp.y + EYE - 0.15;
      const cy = Math.cos(r.rp.pitch);
      const dx = -Math.sin(r.rp.yaw) * cy, dy = Math.sin(r.rp.pitch), dz = -Math.cos(r.rp.yaw) * cy;
      const x = r.rp.x + dx * 0.35, y = eye + dy * 0.35, z = r.rp.z + dz * 0.35;
      f.spot.position.set(x, y, z);
      f.spot.target.position.set(x + dx * 10, y + dy * 10, z + dz * 10);
      f.group.position.set(x, y, z);
      f.group.lookAt(x - dx, y - dy, z - dz);   // the cone points along the group's -z
      f.beam.material.uniforms.uOn.value = this.br ? 0.8 : 1;
    }
  }

  // ---------- effects ----------
  setupEffects() {
    this.tracers = [];
    const tgeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    tgeo.translate(0, 0, -0.5);
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(tgeo, new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      m.visible = false;
      this.scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    this.puffs = [];
    const puffTex = radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
    const fxQ = this.gfx.effects || 'medium';
    for (let i = 0; i < (fxQ === 'low' ? 24 : fxQ === 'high' ? 96 : 56); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false }));
      s.visible = false;
      this.scene.add(s);
      this.puffs.push({ sprite: s, life: 0, max: 1, size: 1, rise: 0.4 });
    }
    this.tracerIdx = 0; this.puffIdx = 0;
    // brass casings flying out of the gun (high effects only)
    this.casings = [];
    if (fxQ === 'high') {
      const geo = new THREE.CylinderGeometry(0.006, 0.006, 0.024, 6);
      geo.rotateZ(Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.85, roughness: 0.3 });
      for (let i = 0; i < 16; i++) {
        const m = new THREE.Mesh(geo, mat);
        m.visible = false;
        this.scene.add(m);
        this.casings.push({ mesh: m, life: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), floor: 0 });
      }
    }
    this.casingIdx = 0;
    // rings spreading on canal water (wading feet, bullets)
    this.ripples = [];
    if (this.world.water.length) {
      const rgeo = new THREE.RingGeometry(0.8, 1, 24).rotateX(-Math.PI / 2);
      for (let i = 0; i < 14; i++) {
        const m = new THREE.Mesh(rgeo, new THREE.MeshBasicMaterial({ color: '#e8f4f2', transparent: true, opacity: 0, depthWrite: false }));
        m.visible = false; this.scene.add(m);
        this.ripples.push({ mesh: m, life: 0, max: 1, size: 1 });
      }
    }
    this.rippleIdx = 0;
    this.muzzleTimer = 0;
    // explosion fireball
    this.fireball = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: '#ffb35a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.fireball.visible = false;
    this.scene.add(this.fireball);
    this.blastLight = new THREE.PointLight('#ffb070', 0, 60, 1.5);
    this.scene.add(this.blastLight);
  }

  addTracer(x0, y0, z0, x1, y1, z1) {
    const t = this.tracers[this.tracerIdx++ % this.tracers.length];
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    t.mesh.position.set(x0, y0, z0);
    t.mesh.lookAt(x1, y1, z1);
    t.mesh.rotateY(Math.PI);  // lookAt points +Z toward target for non-cameras; our geometry extends along -Z
    t.mesh.scale.set(1, 1, len);
    t.mesh.visible = true;
    t.life = 0.07;
    t.mesh.material.opacity = 0.9;
  }

  spawnPuff(x, y, z, size, color, life, additive, rise = 0.4) {
    const p = this.puffs[this.puffIdx++ % this.puffs.length];
    p.sprite.position.set(x, y, z);
    p.sprite.material.color.set(color);
    p.sprite.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.sprite.visible = true;
    p.life = p.max = life; p.size = size; p.rise = rise;
    p.sprite.scale.setScalar(size * 0.3);
  }

  // a ring on the water at (x, z); does nothing away from water
  addRipple(x, z, size = 0.6, life = 0.9) {
    const wy = this.world.waterAt(x, z);
    if (!wy || !this.ripples.length) return false;
    const r = this.ripples[this.rippleIdx++ % this.ripples.length];
    r.mesh.position.set(x, wy + 0.01, z); r.mesh.visible = true;
    r.life = r.max = life; r.size = size;
    return true;
  }
  // where a bullet stops: a splash on the canal, dust anywhere else
  impactFx(x, y, z) {
    if (y < 0.4 && this.world.waterAt(x, z) > 0) {
      const wy = this.world.waterAt(x, z);
      this.spawnPuff(x, wy + 0.1, z, 0.55, '#dcecef', 0.4, false, 1.4);
      this.addRipple(x, z, 0.5, 0.7);
      return;
    }
    this.spawnPuff(x, y, z, 0.6, '#d8c8a8', 0.45, false);
  }

  ejectCasing(muzzle, yaw) {
    const c = this.casings[this.casingIdx++ % this.casings.length];
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    c.mesh.position.set(muzzle.x * 0.5 + this.me.pos.x * 0.5, muzzle.y - 0.05, muzzle.z * 0.5 + this.me.pos.z * 0.5);
    c.vel.set(rx * (1.6 + Math.random()) + this.me.vel.x, 1.6 + Math.random(), rz * (1.6 + Math.random()) + this.me.vel.z);
    c.spin.set(Math.random() * 20, Math.random() * 20, Math.random() * 20);
    c.floor = this.world.groundAt(c.mesh.position.x, c.mesh.position.z, 0.05, c.mesh.position.y) + 0.006;
    c.life = 2.5; c.bounced = false;
    c.mesh.visible = true;
  }

  updateEffects(dt) {
    for (const c of this.casings) {
      if (c.life <= 0) continue;
      c.life -= dt;
      const p = c.mesh.position;
      if (p.y > c.floor || c.vel.y > 0) {
        c.vel.y -= 14 * dt;
        p.addScaledVector(c.vel, dt);
        c.mesh.rotation.x += c.spin.x * dt; c.mesh.rotation.y += c.spin.y * dt; c.mesh.rotation.z += c.spin.z * dt;
        if (p.y <= c.floor) {
          p.y = c.floor;
          if (!c.bounced) { c.bounced = true; c.vel.multiplyScalar(0.35); c.vel.y = 1.2; if (Math.hypot(p.x - this.me.pos.x, p.z - this.me.pos.z) < 6) sfx.playCasing({ x: p.x, y: p.y, z: p.z }); } else c.vel.set(0, 0, 0);
        }
      }
      if (c.life <= 0) c.mesh.visible = false;
    }
    for (const r of this.ripples) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = 1 - r.life / r.max;
      r.mesh.scale.setScalar(r.size * (0.25 + k * 1.1));
      r.mesh.material.opacity = Math.max(0, 1 - k) * 0.55;
      if (r.life <= 0) r.mesh.visible = false;
    }
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.sprite.scale.setScalar(p.size * (0.3 + k * 0.9));
      p.sprite.material.opacity = Math.max(0, 1 - k) * 0.8;
      p.sprite.position.y += dt * p.rise;
      if (p.life <= 0) p.sprite.visible = false;
    }
    if (this.remoteFlashes && this.remoteFlashes.size) {
      for (const f of this.remoteFlashes) if (this.clock > f.userData.until) { f.visible = false; this.remoteFlashes.delete(f); }
    }
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) { this.muzzleLight.intensity = 0; this.vmFlash.visible = false; }
    }
    this.updateBlast(dt);
  }

  // ---------- bomb blast: preview + shockwave ----------
  prepareBlast() {
    this.clearBlast();
    const b = this.bomb;
    const bf = blastField(this.world, b.x, b.y, b.z, RULES.blastMax * 1.6);
    // one glowing floor tile per cell the shockwave reaches
    const cells = [];
    for (let iz = 0; iz < bf.H; iz++) for (let ix = 0; ix < bf.W; ix++) {
      const path = bf.field[iz * bf.W + ix];
      if (!(path <= RULES.blastMax * 1.6)) continue;
      const cx = (ix + 0.5) * CELL, cz = (iz + 0.5) * CELL;
      const gy = this.world.groundAt(cx, cz, 0.05, b.y + 0.6);
      cells.push([cx, gy, cz, path, blastDistance(bf, cx, b.y, cz)]);
    }
    const geo = new THREE.PlaneGeometry(CELL, CELL);
    geo.rotateX(-Math.PI / 2);
    const aPath = new Float32Array(cells.length), aEff = new Float32Array(cells.length);
    cells.forEach((c, i) => { aPath[i] = c[3]; aEff[i] = c[4]; });
    geo.setAttribute('aPath', new THREE.InstancedBufferAttribute(aPath, 1));
    geo.setAttribute('aEff', new THREE.InstancedBufferAttribute(aEff, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      uniforms: {
        uMode: { value: 0 }, uR: { value: 0 }, uHp: { value: 100 }, uArmor: { value: 0 }, uAlpha: { value: 0.5 },
        uLethal: { value: RULES.blastLethal }, uMax: { value: RULES.blastMax }, uArmorMul: { value: RULES.blastArmor },
      },
      vertexShader: `
        attribute float aPath; attribute float aEff;
        varying float vPath; varying float vEff;
        void main() {
          vPath = aPath; vEff = aEff;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform float uMode, uR, uHp, uArmor, uAlpha, uLethal, uMax, uArmorMul;
        varying float vPath; varying float vEff;
        float dmg(float d) {
          if (d >= uMax) return 0.0;
          if (d <= uLethal) return 500.0;
          float v = 200.0 * pow((uMax - d) / (uMax - uLethal), 1.6);
          return uArmor > 0.5 ? v * uArmorMul : v;
        }
        void main() {
          if (uMode < 0.5) {
            float d = dmg(vEff);
            if (d <= 0.0) discard;
            bool lethal = d >= uHp;
            vec3 col = lethal ? vec3(1.0, 0.12, 0.08) : vec3(1.0, 0.55, 0.1);
            float a = lethal ? 0.28 : 0.05 + 0.12 * clamp(d / max(uHp, 1.0), 0.0, 1.0);
            gl_FragColor = vec4(col * a * uAlpha, 1.0);
          } else {
            float band = exp(-pow((vPath - uR) / 1.4, 2.0));
            float behind = vPath < uR ? exp(-(uR - vPath) * 0.18) * 0.35 : 0.0;
            float fade = clamp(1.0 - uR / (uMax * 1.6), 0.0, 1.0);
            vec3 col = mix(vec3(1.0, 0.45, 0.12), vec3(1.0, 0.95, 0.75), band);
            gl_FragColor = vec4(col * (band * 1.2 + behind) * fade, 1.0);
          }
        }`,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, cells.length));
    const m4 = new THREE.Matrix4();
    cells.forEach((c, i) => { m4.makeTranslation(c[0], c[1] + 0.03, c[2]); mesh.setMatrixAt(i, m4); });
    mesh.count = cells.length;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    this.blast = { bf, mesh, mat, mode: 0, t: 0 };
  }

  clearBlast() {
    if (!this.blast) return;
    this.scene.remove(this.blast.mesh);
    this.blast.mesh.geometry.dispose();
    this.blast.mat.dispose();
    this.blast = null;
    this.hud.blastPreview(null);
  }

  onExplode(m) {
    this.bomb.state = 'exploded';
    if (!this.blast) { Object.assign(this.bomb, { x: m.x, y: m.y, z: m.z }); this.prepareBlast(); }
    this.blast.mode = 1; this.blast.t = 0;
    this.fireball.position.set(m.x, m.y + 0.5, m.z);
    this.fireball.visible = true;
    this.fireballT = 0;
    this.blastLight.position.set(m.x, m.y + 2, m.z);
    this.blastLight.intensity = 60;
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 3;
      this.spawnPuff(m.x + Math.cos(a) * r, m.y + 0.5 + Math.random() * 2, m.z + Math.sin(a) * r, 10 + Math.random() * 10, i < 4 ? '#ffb347' : '#4a4540', 1.5 + Math.random() * 1.5, i < 4, 1.2);
    }
    const d = Math.hypot(m.x - this.me.pos.x, m.z - this.me.pos.z);
    sfx.playExplosion({ x: m.x, y: m.y + 1, z: m.z });
    this.shake = Math.min(2.5, this.shake + 2.5 * Math.max(0.2, 1 - d / 60));
    this.hud.blastPreview(null);
  }

  updateBlast(dt) {
    if (this.fireball.visible) {
      this.fireballT += dt;
      const k = this.fireballT / 0.7;
      this.fireball.scale.setScalar(0.5 + Math.sqrt(Math.min(1, k)) * RULES.blastLethal);
      this.fireball.material.opacity = Math.max(0, 0.85 * (1 - k));
      this.blastLight.intensity = Math.max(0, 60 * (1 - k));
      if (k >= 1) { this.fireball.visible = false; this.blastLight.intensity = 0; }
    }
    const bl = this.blast;
    if (!bl) return;
    const u = bl.mat.uniforms;
    if (bl.mode === 1) {
      bl.t += dt;
      u.uMode.value = 1;
      u.uR.value = bl.t * BLAST_SPEED;
      if (u.uR.value > RULES.blastMax * 1.7) this.clearBlast();
      return;
    }
    // preview while the bomb ticks: tiles glow where the blast would hurt (red = it would kill you)
    const me = this.me;
    u.uMode.value = 0;
    u.uHp.value = me.alive ? me.hp : 100;
    u.uArmor.value = me.armor > 0 ? 1 : 0;
    const tl = Math.max(0, this.timeLeft - (performance.now() - (this.timeLeftAt || 0)) / 1000);
    const urgency = 1 - Math.min(1, tl / RULES.bombTime);
    u.uAlpha.value = (0.35 + urgency * 0.65) * (0.75 + 0.25 * Math.max(0, this.bombModel.userData.light.visible ? 1 : 0));
    if (me.alive) this.hud.blastPreview(blastDamage(bl.bf, me.pos.x, me.pos.y, me.pos.z, me.armor, RULES), me.hp);
    else this.hud.blastPreview(null);
  }

  // ---------- local player ----------
  canBuy() {
    if (!this.me.alive) return false;
    if (this.practice || this.dm) return true;
    if (this.phase !== 'freeze' && this.phase !== 'live') return false;
    if (this.roundElapsed >= RULES.buyTime) return false;
    return this.world.nearSpawn(this.me.team, this.me.pos.x, this.me.pos.z, 14);
  }

  toggleBuy(open = !this.buyOpen) {
    if (open && !this.canBuy()) { if (this.me.alive) sfx.playDeny(); return; }
    if (open === this.buyOpen) return;
    this.buyOpen = open;
    // free the mouse so you can click the menu, then grab it again
    if (!this.settings.touch) {
      if (open) this.input.releaseForMenu();
      else if (!this.paused) this.input.requestLock();
    }
  }

  equip(id, quiet = false) {
    const w = itemDef(id);
    if (!w) return;
    const me = this.me;
    if (id === me.weapon && !quiet) return;
    me.weapon = id;
    Object.assign(me, { reloading: 0, zoom: 0, rezoom: 0, recoilIdx: 0, recP: 0, recY: 0, burstLeft: 0, fireInacc: 0, autoReloadAt: 0, inspectAt: -1, swingAt: -10 });
    me.deployUntil = this.clock + w.deploy;
    this.ammoOf(id);
    this.setViewModel();
    this.sendTimer = 0;     // tell the host straight away
    this.cancelReloadSfx();
    sfx.playEquip(id);
  }

  // mouse wheel / touch ⇄: primary → pistol → (spoon) → bomb → …
  cycleWeapon(dir) {
    const order = [this.me.inv.primary, this.me.inv.secondary, this.me.melee, 'c4'].filter(id => this.owns(id));
    const i = order.indexOf(this.me.weapon);
    return order[(i + dir + order.length) % order.length];
  }

  eligibleUse() {
    const me = this.me, b = this.bomb;
    if (!me.alive || this.phase === 'freeze') return null;
    if (me.team === 'atk' && b.state === 'carried' && b.carrier === this.myId && this.world.siteAt(me.pos.x, me.pos.z) && me.onGround) return 'plant';
    if ((me.team === 'def' || this.practice) && b.state === 'planted' && Math.hypot(me.pos.x - b.x, me.pos.z - b.z) < 2.0 && Math.abs(me.pos.y - b.y) < 2.2) {
      return this.lookingAtBomb() ? 'defuse' : 'look';
    }
    return null;
  }

  lookingAtBomb() {
    const me = this.me, b = this.bomb;
    const dx = b.x - me.pos.x, dy = b.y + 0.15 - (me.pos.y + me.eyeOff), dz = b.z - me.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const fx = -Math.sin(me.yaw) * Math.cos(me.pitch), fy = Math.sin(me.pitch), fz = -Math.cos(me.yaw) * Math.cos(me.pitch);
    return (dx * fx + dy * fy + dz * fz) / d > 0.55;
  }

  updateLocal(dt) {
    const me = this.me, inp = this.input;
    const [lx, ly] = inp.takeLook();
    const w = itemDef(me.weapon);
    const zoomK = me.zoom ? w.zoom[me.zoom - 1] / (this.settings.fov || 75) : 1;
    if (me.alive) {
      me.yaw -= lx * zoomK;
      me.pitch = Math.max(-1.45, Math.min(1.45, me.pitch - ly * zoomK));
    }
    if (inp.consume('flashlight')) this.toggleFlashlight();
    if (inp.consume('chatAll')) this.openChat(false);
    if (inp.consume('chatTeam')) this.openChat(true);
    if (inp.consume('buy')) this.toggleBuy();
    const closedBuy = inp.consume('escape') && this.buyOpen;
    if (closedBuy) this.toggleBuy(false);
    if (inp.consume('menu') && !closedBuy && !this.buyOpen) this.onPause();
    if (this.buyOpen && !this.canBuy()) this.toggleBuy(false);

    if (!me.alive) {
      // spectating: click/tap cycles players
      if (inp.consume('click') && performance.now() - me.deathTime > 1500) this.cycleSpectate();
      for (const a of ['jump', 'reload', 'alt', 'w1', 'w2', 'w3', 'w5', 'next', 'prev', 'swap', 'drop', 'use', 'inspect', 'flashlight']) inp.consume(a);
      return;
    }

    if (this.br) {
      // no guns, no bomb: just moving (any weapon keys do nothing)
      for (const a of ['reload', 'alt', 'w1', 'w2', 'w3', 'w5', 'next', 'prev', 'swap', 'drop', 'click', 'buy']) inp.consume(a);
      // N / the note button: write or draw a note; nothing else happens while the note is open
      if (inp.consume('note') && this.fx) this.fx.openEditor();
      // M / the map button: the map you've drawn by walking (open or shut)
      if (inp.consume('map') && this.fx) this.fx.toggleMap();
      if (this.fx && this.fx.editing) { inp.consume('use'); inp.consume('inspect'); if (inp.consume('escape')) this.fx.closeEditor(); return; }
      // F (the inspect key) is the flashlight in here, as well as L
      if (inp.consume('inspect')) this.toggleFlashlight();
      // E / the hand button: a door, a switch, or climbing up for the red key
      if (inp.consume('use')) {
        const u = this.useTarget();
        if (u) this.transport.send(u.kind === 'door' ? { t: 'door', i: u.i } : u.kind === 'switch' ? { t: 'switch', i: u.i } : { t: 'boost' });
      }
      // up on someone's shoulders (or holding someone up): nobody moves until it's done
      const b = this.boostMe;
      if (b) {
        const t = this.clock - b.t0;
        if (t > b.dur) this.boostMe = null;
        else {
          me.vel.x = me.vel.y = me.vel.z = 0;
          if (b.climber) {
            const up = Math.min(1, t / 0.45, (b.dur - t) / 0.45);
            me.pos.x += (b.x - me.pos.x) * Math.min(1, dt * 6); me.pos.z += (b.z - me.pos.z) * Math.min(1, dt * 6);
            me.pos.y = 0.95 * up * up * (3 - 2 * up);
          }
          return;
        }
      }
      this.updateMovement(dt, false);
      return;
    }
    const use = this.eligibleUse();
    // E / ✋ with nothing to plant or defuse: swap for the gun you're looking at
    if (inp.consume('use') && use !== 'plant' && use !== 'defuse' && use !== 'look') this.tryPick();
    if (inp.consume('drop')) this.dropWeapon();
    const wasUsing = me.using;
    me.using = (use === 'plant' || use === 'defuse') && inp.useHeld;
    if (me.using) { me.zoom = 0; me.rezoom = 0; }
    if (wasUsing && !me.using) me.useCooldown = this.clock + 0.15;   // short delay before you can shoot again
    const frozen = this.phase === 'freeze' || me.using;

    this.updateMovement(dt, frozen);
    this.updateWeapon(dt, frozen);
  }

  // Backrooms: Shift (the walk key) or holding the run button on a phone sprints
  sprinting() { return !!(this.input.walk || this.input.jumpHeld); }

  // CS-style ground friction + acceleration, air-strafing and bunny-hop timing
  // Teammates' heads you could stand on: [{ x, z, r, top, id }]
  boostPlatforms() {
    const out = [];
    for (const r of this.remotes.values()) {
      if (!r.alive || !this.isMate(r) || !r.buf.length) continue;
      out.push({ id: r.id, x: r.rp.x, z: r.rp.z, r: BOOST_R, top: r.rp.y + PLAYER_HEIGHT });
    }
    return out;
  }

  updateMovement(dt, frozen) {
    const me = this.me, inp = this.input, now = this.clock;
    const w = itemDef(me.weapon);
    // (no jumping in the Backrooms)
    if (inp.consume('jump') && !this.br) me.jumpAt = now;   // remembered briefly so a press just before landing counts

    const mx = frozen ? 0 : inp.move.x, my = frozen ? 0 : inp.move.y;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    const rx = Math.cos(me.yaw), rz = -Math.sin(me.yaw);
    let wx = fx * my + rx * mx, wz = fz * my + rz * mx;
    const wl = Math.hypot(wx, wz);
    const amount = Math.min(1, wl);
    if (wl > 0) { wx /= wl; wz /= wl; }
    const gait = inp.walk ? WALK : 1;
    const wading = me.pos.y < 0.3 && this.world.waterAt(me.pos.x, me.pos.z) > 0;   // knee-deep canal water
    // the Backrooms: you walk (quietly) unless you hold Shift / the run button to sprint
    const maxSpeed = this.br ? (this.sprinting() ? BR.sprint : BR.walk)
      : runSpeed(w, me.zoom > 0) * gait * (1 - 0.45 * me.tag) * (1 - me.landSlow) * (wading ? WADE : 1);
    const wish = maxSpeed * amount;
    const v = me.vel;

    if (me.onGround) {
      let jumped = false;
      if (!frozen && me.jumpAt >= 0 && now - me.jumpAt < 0.1) {
        v.y = JUMP_V; me.onGround = false; me.jumpAt = -1; jumped = true;
        me.peakY = me.pos.y; me.airTime = 0;
      }
      if (!jumped) {
        // friction
        const sp = Math.hypot(v.x, v.z);
        if (sp < 0.02) { v.x = 0; v.z = 0; } else {
          const drop = Math.max(sp, STOP_SPEED) * FRICTION * dt;
          const k = Math.max(0, sp - drop) / sp;
          v.x *= k; v.z *= k;
        }
      }
      if (wish > 0) {
        const sp = Math.hypot(v.x, v.z);
        const cur = v.x * wx + v.z * wz;
        let A = ACCEL;
        if (cur < -0.2 * sp) A *= COUNTER_STRAFE;     // counter-strafe: stop in a frame or two
        const add = wish - cur;
        if (add > 0) {
          const acc = Math.min(A * dt * Math.max(wish, maxSpeed * 0.5), add);
          v.x += wx * acc; v.z += wz * acc;
        }
      }
    } else if (wish > 0) {
      const cur = v.x * wx + v.z * wz;
      const add = Math.min(wish, AIR_CAP) - cur;
      if (add > 0) {
        const acc = Math.min(AIR_ACCEL * wish * dt, add);
        v.x += wx * acc; v.z += wz * acc;
      }
    }
    const hs = Math.hypot(v.x, v.z);
    if (hs > MAX_SPEED) { v.x *= MAX_SPEED / hs; v.z *= MAX_SPEED / hs; }

    // standing on a teammate: they carry you along as they move
    const plats = this.boostPlatforms();
    if (me.standingOn) {
      const mate = plats.find(pl => pl.id === me.standingOn);
      if (mate && me.mateLast) {
        const dx = mate.x - me.mateLast.x, dz = mate.z - me.mateLast.z;
        if (Math.hypot(dx, dz) < 1 && !this.world.blocked(me.pos.x + dx, me.pos.z + dz, PLAYER_RADIUS, me.pos.y, 0.1, PLAYER_HEIGHT)) {
          me.pos.x += dx; me.pos.z += dz;
        }
      }
      me.mateLast = mate ? { x: mate.x, z: mate.z } : null;
    }
    const wasGround = me.onGround;
    me.onGround = this.world.move(me.pos, v, dt, PLAYER_RADIUS, me.onGround, PLAYER_HEIGHT, plats);
    const under = me.onGround ? plats.find(pl => Math.abs(pl.top - me.pos.y) < 0.02 && (me.pos.x - pl.x) ** 2 + (me.pos.z - pl.z) ** 2 < pl.r * pl.r) : null;
    if ((under && under.id) !== me.standingOn) { me.standingOn = under ? under.id : null; me.mateLast = under ? { x: under.x, z: under.z } : null; }
    if (!me.onGround) {
      if (wasGround && v.y <= 0) { me.peakY = me.pos.y; me.airTime = 0; }   // walked off a ledge
      me.peakY = Math.max(me.peakY, me.pos.y);
      me.airTime += dt;
    } else if (!wasGround) this.onLand(now);

    me.tag = Math.max(0, me.tag - dt / 0.5);
    me.landSlow = Math.max(0, me.landSlow - dt * 2.2);
    me.landPen = Math.max(0, me.landPen - dt * 3);

    const speed = Math.hypot(v.x, v.z);
    // wading can't be done quietly: even walking splashes
    const inWater = me.onGround && me.pos.y < 0.3 && this.world.waterAt(me.pos.x, me.pos.z) > 0;
    if (me.onGround && (inWater ? speed > 0.8 : speed > STEP_SPEED && (this.br || !inp.walk))) {
      me.stepTimer -= dt;
      if (me.stepTimer <= 0) {
        me.stepTimer = inWater ? 0.42 : 0.34;
        sfx.playStep({ surface: this.surfaceAt(me.pos.x, me.pos.y, me.pos.z) });
        if (inWater) this.addRipple(me.pos.x, me.pos.z, 0.7);
      }
    }
    this.vmBob += dt * speed * 1.6 * (me.onGround ? 1 : 0);
  }

  onLand(now) {
    const me = this.me;
    const fall = Math.max(0, me.peakY - me.pos.y);
    me.landedAt = now;
    if (me.airTime < 0.12 && fall < 0.3) return;
    const hop = me.jumpAt >= 0 && now - me.jumpAt < 0.08;
    const fallLoss = Math.max(0, fall - 1.4) * 0.08;
    if (hop) {
      // a well-timed jump keeps nearly all your speed; the later the press, the more you lose
      const loss = Math.min(0.5, 0.04 + (now - me.jumpAt) * 0.6 + fallLoss);
      me.vel.x *= 1 - loss; me.vel.z *= 1 - loss;
    } else {
      me.landSlow = Math.min(0.6, 0.2 + Math.max(0, fall - 0.6) * 0.12 + fallLoss);
      me.landPen = Math.min(2, 1 + fall * 0.3);
    }
    this.vmLand = Math.min(1, 0.4 + fall * 0.25);
    if (fall > 0.4 && !this.input.walk) sfx.playLand({ surface: this.surfaceAt(me.pos.x, me.pos.y, me.pos.z), hard: Math.min(1, fall / 3) });
  }

  updateWeapon(dt, frozen) {
    const me = this.me, inp = this.input, now = this.clock;
    // switching: 1 main gun, 2 pistol, 5 bomb, wheel cycles; touch ⇄ swaps guns (and the bomb)
    if (inp.consume('w1') && me.inv.primary) this.equip(me.inv.primary);
    if (inp.consume('w2') && me.inv.secondary) this.equip(me.inv.secondary);
    if (inp.consume('w3') && me.melee) this.equip(me.melee);
    if (inp.consume('w5') && this.owns('c4')) this.equip('c4');
    if (inp.consume('next')) this.equip(this.cycleWeapon(1));
    if (inp.consume('prev')) this.equip(this.cycleWeapon(-1));
    if (inp.consume('swap')) this.equip(this.cycleWeapon(1));
    if (inp.consume('inspect') && me.reloading <= 0 && !me.zoom && !me.using && this.clock >= me.deployUntil) me.inspectAt = this.clock;
    if (me.weapon === 'c4') { this.updateBombHeld(dt); return; }
    if (me.weapon === me.melee) { this.updateMelee(dt, frozen); return; }
    const w = WEAPONS[me.weapon];
    const a = this.ammoOf(me.weapon);

    if (inp.consume('alt')) this.altAction();
    if (inp.consume('reload')) this.startReload();
    if (me.autoReloadAt && now >= me.autoReloadAt) { me.autoReloadAt = 0; this.startReload(); }

    // reloading
    if (me.reloading > 0) {
      me.reloading -= dt;
      if (me.reloading <= 0) {
        if (w.reloadType === 'shell') {
          if (a.res > 0 && a.mag < w.mag) { a.mag++; a.res--; }
          me.reloading = a.mag < w.mag && a.res > 0 ? w.reload : 0;
          if (me.reloading > 0) this.reloadSfx = sfx.reloadSequence(me.weapon, false);   // the next shell
        } else {
          const take = Math.min(w.mag - a.mag, a.res);
          a.mag += take; a.res -= take;
          me.reloading = 0;
        }
      }
    }
    // snipers scope back in after the bolt is worked
    if (me.rezoom && now >= me.rezoomAt) {
      if (me.reloading <= 0 && !me.using) me.zoom = me.rezoom;
      me.rezoom = 0;
    }

    // shooting
    const blocked = frozen || this.buyOpen || me.using || now < me.useCooldown;
    const clicked = inp.consume('click');
    if (w.alt === 'burst' && me.burst) {
      if (clicked && !blocked && now >= me.nextShot && now >= me.deployUntil && me.burstLeft === 0) { me.burstLeft = 3; me.burstNext = now; }
      if (me.burstLeft > 0 && now >= me.burstNext) {
        if (blocked || !this.fireOnce(true)) me.burstLeft = 0;
        else {
          me.burstLeft--;
          me.burstNext = now + w.burstInterval;
          if (me.burstLeft === 0) me.nextShot = now + w.burstCooldown;
        }
      }
    } else if (inp.fire && !blocked && (w.auto || clicked)) this.fireOnce(false);
    if (!inp.fire) me.clickedEmpty = false;

    // recoil + inaccuracy recovery
    const since = now - me.lastFire;
    if (w.auto) {
      if (since > w.interval * 1.4) me.recoilIdx = Math.max(0, me.recoilIdx - dt * (5 + me.recoilIdx * 2.5));
      const [ry, rp] = patternAt(w, me.recoilIdx);
      me.recY = ry; me.recP = rp;
    } else {
      const k = Math.exp(-dt * 7);
      me.recP *= k; me.recY *= k;
    }
    me.fireInacc *= Math.exp(-dt * 3 / w.recover);
    const hk = Math.exp(-dt * 9);
    me.hurtP *= hk; me.hurtY *= hk;
  }

  // The bomb in your hands (key 5) can't shoot; aim punch still settles.
  updateBombHeld(dt) {
    const me = this.me, inp = this.input;
    inp.consume('click'); inp.consume('alt'); inp.consume('reload');
    me.recP *= Math.exp(-dt * 7); me.recY *= Math.exp(-dt * 7);
    me.fireInacc = 0;
    const hk = Math.exp(-dt * 9);
    me.hurtP *= hk; me.hurtY *= hk;
  }

  // The spoon in your hands (key 3): fire slashes (hold to keep swinging), alt (right-click / 🥄) stabs.
  updateMelee(dt, frozen) {
    const me = this.me, inp = this.input, now = this.clock;
    inp.consume('reload');
    const clicked = inp.consume('click'), alt = inp.consume('alt');
    const blocked = frozen || this.buyOpen || me.using || now < me.useCooldown || now < me.deployUntil || now < me.nextShot;
    if (!blocked) {
      if (alt) this.swing(true);
      else if (inp.fire || clicked) this.swing(false);
    }
    me.recP *= Math.exp(-dt * 7); me.recY *= Math.exp(-dt * 7);
    me.fireInacc = 0;
    const hk = Math.exp(-dt * 9);
    me.hurtP *= hk; me.hurtY *= hk;
  }

  // One swing of the spoon. Like a knife it has a short reach and is forgiving about aim:
  // straight ahead is tried first, then a small ring round the crosshair.
  swing(stab) {
    const me = this.me, a = stab ? SPOON.stab : SPOON.slash, now = this.clock;
    me.inspectAt = -1;
    const ex = me.pos.x, ey = me.pos.y + me.eyeOff, ez = me.pos.z;
    const pitch = me.pitch + me.hurtP, yaw = me.yaw + me.hurtY;
    const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const RING = [[0, 0], [0.15, 0], [-0.15, 0], [0, 0.15], [0, -0.15], [0.11, 0.11], [-0.11, 0.11], [0.11, -0.11], [-0.11, -0.11]];
    let best = null, wall = null;
    for (const [ax, ay] of RING) {
      const dir = fwd.clone().addScaledVector(right, ax).addScaledVector(up, ay).normalize();
      const tr = this.world.trace(ex, ey, ez, dir.x, dir.y, dir.z, a.range + 0.2);
      // walls, crates and barrels all stop a spoon
      let stop = tr.solid ? tr.t : Infinity;
      if (tr.pen.length) stop = Math.min(stop, tr.pen[0][0]);
      for (const r of this.remotes.values()) {
        if (!r.alive || !r.buf.length) continue;
        const h = rayVsPlayer(ex, ey, ez, dir.x, dir.y, dir.z, r.rp.x, r.rp.y, r.rp.z, r.rp.yaw);
        if (h && h.t <= a.range && h.t < stop && (!best || h.t < best.t)) best = { ...h, id: r.id, dir };
      }
      if (best) break;
      if (!wall && stop <= a.range) wall = { t: stop, dir };
    }
    const r2 = v => Math.round(v * 100) / 100;
    let hit = null;
    sfx.playSwing();
    if (best) {
      const p = [ex + best.dir.x * best.t, ey + best.dir.y * best.t, ez + best.dir.z * best.t].map(r2);
      hit = { id: best.id, part: best.part, p };
      this.spawnPuff(p[0], p[1], p[2], 0.6, '#c0201a', 0.35, false);
      sfx.playSpoonHit();
      this.shake = Math.min(1, this.shake + 0.25);
    } else if (wall) {
      const t = Math.max(0, wall.t - 0.05);
      this.impactFx(ex + wall.dir.x * t, ey + wall.dir.y * t, ez + wall.dir.z * t);
      sfx.playSpoonWall();
    }
    this.transport.send({ t: 'melee', stab: stab ? 1 : 0, o: [ex, ey, ez].map(r2), hit, wall: wall ? 1 : 0 });
    me.nextShot = now + (best ? a.hit : a.miss);
    me.swingAt = now; me.swingStab = stab; me.swingDir = -me.swingDir;
  }

  altAction() {
    const me = this.me, w = WEAPONS[me.weapon], now = this.clock;
    if (me.using) return;
    me.inspectAt = -1;
    if (w.alt === 'scope') {
      if (me.reloading > 0) return;
      me.zoom = (me.zoom + 1) % 3;
      me.rezoom = 0;
      sfx.playClick();
    } else if (w.alt === 'burst') {
      me.burst = !me.burst;
      sfx.playClick();
      this.hud.center('', me.burst ? 'Burst fire' : 'Semi-automatic', '#fff', 1);
    }
  }

  startReload() {
    const me = this.me, w = WEAPONS[me.weapon], a = this.ammoOf(me.weapon);
    if (me.reloading > 0 || a.mag >= w.mag || a.res <= 0 || me.using) return;
    me.inspectAt = -1;
    me.reloading = w.reload;
    me.reloadEmpty = a.mag === 0;
    me.zoom = 0; me.rezoom = 0;
    me.burstLeft = 0;
    this.cancelReloadSfx();
    this.reloadSfx = sfx.reloadSequence(me.weapon, me.reloadEmpty);
  }

  currentSpread() {
    const me = this.me, w = WEAPONS[me.weapon];
    if (!w) return 0.01;    // bomb in hand
    let s = w.type === 'sniper' && me.zoom ? w.scoped : w.stand;
    // accurate again once you're below 34 % of this gun's top speed
    const max = runSpeed(w, false);
    const thr = max * ACCURATE_SPEED;
    const hs = Math.hypot(me.vel.x, me.vel.z);
    const moveK = Math.max(0, Math.min(1, (hs - thr) / (max - thr)));
    s += w.move * moveK;
    if (!me.onGround) s += w.air;
    s += w.air * 0.35 * me.landPen;
    s += me.fireInacc;
    if (w.alt === 'burst' && me.burst) s += w.burstSpread;
    return s;
  }

  // returns true if a bullet was fired
  fireOnce() {
    const me = this.me, w = WEAPONS[me.weapon], a = this.ammoOf(me.weapon);
    const now = this.clock;
    if (now < me.deployUntil) return false;
    if (!(w.alt === 'burst' && me.burst) && now < me.nextShot) return false;
    if (me.reloading > 0) {
      // shotguns that load shell by shell can fire mid-reload
      if (w.reloadType === 'shell' && a.mag > 0) { me.reloading = 0; this.cancelReloadSfx(); } else return false;
    }
    if (a.mag <= 0) {
      if (!me.clickedEmpty) { sfx.playDryFire(); me.clickedEmpty = true; }
      if (a.res > 0) this.startReload();
      return false;
    }
    a.mag--;
    me.nextShot = now + w.interval;
    me.lastFire = now;
    me.inspectAt = -1;

    const ex = me.pos.x, ey = me.pos.y + me.eyeOff, ez = me.pos.z;
    // the first bullet goes where you aim; recoil only affects the ones after it
    const pitch = me.pitch + me.recP + me.hurtP;
    const yaw = me.yaw - me.recY + me.hurtY;
    const fwd = new THREE.Vector3(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const spread = this.currentSpread();
    const penM = penMetres(w);
    const silenced = !!w.silenced;

    const hits = [], ends = [];
    const muzzle = this.muzzleWorld();
    for (let i = 0; i < w.pellets; i++) {
      const ang = Math.random() * Math.PI * 2, rad = Math.sqrt(Math.random()) * spread;
      const dir = fwd.clone().addScaledVector(right, Math.cos(ang) * rad).addScaledVector(up, Math.sin(ang) * rad).normalize();
      const tr = this.world.trace(ex, ey, ez, dir.x, dir.y, dir.z, 300);
      // cover that is too thick for this weapon stops the bullet inside it
      let wallT = tr.t;
      if (tr.pen.length) {
        let used = 0;
        for (const [p0, p1] of tr.pen) {
          if (p0 >= wallT) break;
          used += p1 - p0;
          if (used >= penM) { wallT = Math.min(wallT, p1 - (used - penM)); break; }
        }
      }
      let best = null;
      for (const r of this.remotes.values()) {
        if (!r.alive || !r.buf.length) continue;
        const h = rayVsPlayer(ex, ey, ez, dir.x, dir.y, dir.z, r.rp.x, r.rp.y, r.rp.z, r.rp.yaw);
        if (h && h.t < wallT && (!best || h.t < best.t)) best = { ...h, id: r.id };
      }
      const t = best ? best.t : wallT;
      const end = [ex + dir.x * t, ey + dir.y * t, ez + dir.z * t].map(v => Math.round(v * 100) / 100);
      // splinters where the bullet enters cover
      if (tr.pen.length && tr.pen[0][0] < t && i < 3) {
        const p0 = tr.pen[0][0];
        this.spawnPuff(ex + dir.x * p0, ey + dir.y * p0, ez + dir.z * p0, 0.5, '#b08850', 0.4, false);
      }
      if (best) {
        hits.push({ id: best.id, part: best.part, p: end });
        const f = penFactor(tr.pen, best.t, penM);
        this.spawnPuff(end[0], end[1], end[2], 0.7 * Math.max(0.4, f), '#c0201a', 0.35, false);
      } else if (tr.solid && wallT >= tr.t) {
        this.impactFx(end[0] + tr.nx * 0.05, end[1] + tr.ny * 0.05, end[2] + tr.nz * 0.05);
      }
      if (ends.length < 3) ends.push(end);
      if (i < 3 && !me.zoom) this.addTracer(muzzle.x, muzzle.y, muzzle.z, end[0], end[1], end[2]);
    }
    this.transport.send({ t: 'shot', w: w.id, o: [ex, ey, ez].map(v => Math.round(v * 100) / 100), e: ends, hits, s: silenced ? 1 : 0 });

    sfx.playShot(w.id, { silenced });
    if (w.id === 'mag7') { this.cancelReloadSfx(); this.boltSfx = sfx.pumpSequence(w.id); }
    // springy view-model recoil: harder-hitting guns kick more
    const R = this.vmRec || (this.vmRec = { z: 0, zv: 0, p: 0, pv: 0, r: 0, rv: 0 });
    const s = Math.min(1.7, 0.45 + (w.damage * w.pellets) / 70);
    R.zv += 0.65 * s; R.pv += 0.3 * s; R.rv += (Math.random() - 0.5) * 1.6 * s;   // mostly a push back; the climb comes from the real recoil
    this.vmKick = 1;
    this.vmFlash.visible = !me.zoom && !silenced;
    this.vmFlash.material.rotation = Math.random() * Math.PI;
    if (!silenced && this.gfx.effects !== 'low') {
      this.muzzleLight.position.copy(muzzle);
      this.muzzleLight.intensity = 5;
      this.muzzleTimer = 0.05;
    } else { this.muzzleTimer = 0.03; }
    if (this.casings.length && w.type !== 'shotgun' && !w.bolt) this.ejectCasing(muzzle, yaw);

    // recoil: automatic guns follow their fixed pattern, the rest kick randomly
    if (w.auto) me.recoilIdx = Math.min(w.mag, me.recoilIdx + 1);
    else {
      me.recP += w.kick[0] * (0.85 + Math.random() * 0.3);
      me.recY += (Math.random() - 0.5) * 2 * w.kick[1];
    }
    me.fireInacc = Math.min(w.fire * 6 + 0.001, me.fireInacc + w.fire);
    if (w.bolt) {
      if (me.zoom) { me.rezoom = me.zoom; me.zoom = 0; }
      me.rezoomAt = now + w.interval * 0.8;
      this.cancelReloadSfx();
      this.boltSfx = sfx.boltSequence(w.id);
    }
    if (a.mag === 0 && a.res > 0) me.autoReloadAt = now + 0.25;
    return true;
  }

  muzzleWorld() {
    if (!this.viewModel || this.me.zoom) {
      return TMP.set(this.me.pos.x, this.me.pos.y + this.me.eyeOff - 0.1, this.me.pos.z).clone();
    }
    // project the view-model muzzle into the world camera
    const p = this.viewModel.userData.muzzle.getWorldPosition(new THREE.Vector3());
    p.project(this.vmCamera);
    p.z = 0.9;
    p.unproject(this.camera);
    const eye = new THREE.Vector3(this.me.pos.x, this.me.pos.y + this.me.eyeOff, this.me.pos.z);
    return eye.lerp(p, 0.9);
  }

  cycleSpectate() {
    const list = [...this.remotes.values()].filter(r => r.alive && !r.dummy && r.team !== 'monster' && !r.escaped);
    const mates = list.filter(r => this.isMate(r));
    const pool = mates.length ? mates : list;
    if (!pool.length) { this.me.spectate = null; return; }
    const i = pool.findIndex(r => r.id === this.me.spectate);
    this.me.spectate = pool[(i + 1) % pool.length].id;
  }

  // ---------- remote interpolation ----------
  updateRemotes(dt) {
    const rt = performance.now() - INTERP_DELAY;
    for (const r of this.remotes.values()) {
      const b = r.buf;
      if (!b.length) { r.model.root.visible = false; continue; }
      let s0 = b[0], s1 = b[b.length - 1];
      for (let i = b.length - 1; i >= 0; i--) {
        if (b[i].t <= rt) { s0 = b[i]; s1 = b[i + 1] || b[i]; break; }
      }
      const span = s1.t - s0.t;
      const k = span > 0 ? Math.min(1, Math.max(0, (rt - s0.t) / span)) : 1;
      const px = r.rp.x, py = r.rp.y, pz = r.rp.z;
      r.rp.x = s0.x + (s1.x - s0.x) * k;
      r.rp.y = s0.y + (s1.y - s0.y) * k;
      r.rp.z = s0.z + (s1.z - s0.z) * k;
      r.rp.yaw = angleLerp(s0.yaw, s1.yaw, k);
      r.rp.pitch = s0.pitch + (s1.pitch - s0.pitch) * k;
      const speed = dt > 0 ? Math.hypot(r.rp.x - px, r.rp.z - pz) / dt : 0;
      const vy = dt > 0 ? (r.rp.y - py) / dt : 0;
      if (dt > 0) {
        const kv = Math.min(1, dt * 12);
        r.vel.x += ((r.rp.x - px) / dt - r.vel.x) * kv; r.vel.y += (vy - r.vel.y) * kv; r.vel.z += ((r.rp.z - pz) / dt - r.vel.z) * kv;
      }
      r.speed = Math.min(Math.hypot(r.vel.x, r.vel.z), 8);

      const m = r.model;
      const hidden = this.me.spectate === r.id && !this.me.alive;
      // the dead are shown as ragdolls instead
      m.root.visible = !hidden && r.alive;
      if (!m.monster) m.root.position.set(r.rp.x, r.rp.y, r.rp.z);
      if (m.monster) {
        m.root.visible = r.alive;
        const mode = String(r.w || '').split(':');      // the host sends 'm:<mode>:<n>[:id of the body in its hand]'
        r.mode = mode[1] || 'walk'; r.modeN = Number(mode[2]) || 0; r.dragId = mode[3] || null;
        let fdt = dt;
        if (r.mode === 'freeze') fdt = 0;                // frozen: it holds the pose it was caught in
        m.root.position.set(r.rp.x, r.rp.y, r.rp.z);
        m.root.rotation.set(0, r.rp.yaw, 0);
        // taller than the doors: it ducks to get through a doorway
        let duck = 0;
        for (const d of this.world.doors || []) {
          const along = (r.rp.x - d.cx) * d.nx + (r.rp.z - d.cz) * d.nz, lat = Math.abs(-(r.rp.x - d.cx) * d.nz + (r.rp.z - d.cz) * d.nx);
          if (lat < 1.2) duck = Math.max(duck, 1 - Math.max(0, Math.abs(along) - 0.4) / 1.1);
        }
        // its eyes: barely there in the light, two burning points in the dark or in your flashlight
        if (m.setGlow && this.fx) m.setGlow(this.fx.eyeGlow(r));
        // (its head: the host sends where its target is, as an angle from straight ahead, in the pitch field)
        animateMonster(m, fdt, { speed: r.speed, mode: r.mode, side: Number(mode[2]) || 0, duck: Math.max(0, duck), lookYaw: r.rp.pitch });
        // its head snapping onto someone: a short whine from the motor in its neck
        if (m.tall && r.mode === 'notice' && r.lastMode !== 'notice') sfx.playBR('servo', { x: r.rp.x, y: r.rp.y + 2.5, z: r.rp.z }, this.occlusion(r.rp.x, r.rp.y + 2, r.rp.z), 1.2);
        r.lastMode = r.mode;
        this.monsterSounds(r, dt, speed);
        continue;
      }
      if (r.w === 'none') setModelWeapon(m, 'none');
      else if (itemDef(r.w)) setModelWeapon(m, r.w);
      if (r.alive) {
        m.root.rotation.set(0, r.rp.yaw, 0);
        const fx = -Math.sin(r.rp.yaw), fz = -Math.cos(r.rp.yaw);
        animateModel(m, dt, {
          speed: r.speed, fwd: r.vel.x * fx + r.vel.z * fz, side: r.vel.x * -fz + r.vel.z * fx,
          pitch: r.rp.pitch, air: Math.abs(r.vel.y) > 1.2, use: !!r.use,
        });
      }
      if (m.label) m.label.visible = r.alive;
      if (!r.alive || r.dummy) continue;
      const d = Math.hypot(r.rp.x - this.me.pos.x, r.rp.z - this.me.pos.z);
      // running footsteps of nearby players (walking is silent)
      const wet = r.rp.y < 0.3 && this.world.waterAt(r.rp.x, r.rp.z) > 0;
      if ((wet ? speed > 0.8 : speed > STEP_SPEED) && Math.abs(vy) < 0.5) {
        r.stepTimer -= dt;
        if (r.stepTimer <= 0) {
          r.stepTimer = wet ? 0.42 : 0.34;
          if (d < 35) sfx.playStep({ pos: { x: r.rp.x, y: r.rp.y + 0.05, z: r.rp.z }, surface: this.surfaceAt(r.rp.x, r.rp.y, r.rp.z), occ: this.occlusion(r.rp.x, r.rp.y + 0.3, r.rp.z) });
          if (wet && d < 60) this.addRipple(r.rp.x, r.rp.z, 0.7);
        }
      }
      // landings are audible too
      if (vy < -2) { if (r.fallFrom == null) r.fallFrom = py; }
      else if (r.fallFrom != null && vy > -0.3) {
        const fall = r.fallFrom - r.rp.y;
        r.fallFrom = null;
        if (fall > 0.5 && d < 30) sfx.playLand({ pos: { x: r.rp.x, y: r.rp.y + 0.05, z: r.rp.z }, surface: this.surfaceAt(r.rp.x, r.rp.y, r.rp.z), hard: Math.min(1, fall / 3), occ: this.occlusion(r.rp.x, r.rp.y + 0.3, r.rp.z) });
      }
    }
  }

  // the door you could open or shut right now: close by and in front of you (or right next to you), or -1
  // what E / the hand button would do where you stand: climb up for the red key, press a switch, or a door
  useTarget() {
    const me = this.me;
    if (!me.alive || !this.br) return null;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    if (this.keySpot && !this.keyTaken && Math.hypot(this.keySpot.x - me.pos.x, this.keySpot.z - me.pos.z) < 1.4) return { kind: 'key' };
    for (let i = 0; i < this.switchSpots.length; i++) {
      const s = this.switchSpots[i], dx = s.fx - me.pos.x, dz = s.fz - me.pos.z, d = Math.hypot(dx, dz);
      if (d < 1.8 && (dx * fx + dz * fz) / (d || 1) > 0.3) return { kind: 'switch', i };
    }
    const di = this.doorTarget();
    return di >= 0 ? { kind: 'door', i: di } : null;
  }

  doorTarget() {
    const me = this.me, ds = this.world.doors;
    if (!me.alive || !ds || !ds.length) return -1;
    const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
    let best = -1, bd = Infinity;
    ds.forEach((d, i) => {
      if (d.broken) return;                    // kicked in: nothing left to shut
      if (d.lock && d.open) return;            // a team door, once open, stays open
      const dx = d.cx - me.pos.x, dz = d.cz - me.pos.z, dist = Math.hypot(dx, dz);
      if (dist > 1.9) return;
      const facing = (dx * fx + dz * fz) / (dist || 1);
      if (dist > 0.9 && facing < 0.3) return;
      const score = dist - facing;
      if (score < bd) { bd = score; best = i; }
    });
    return best;
  }

  // the monster's footsteps, and how close it is (the lights dip and buzz when it's near)
  monsterSounds(r, dt, speed) {
    const d = Math.hypot(r.rp.x - this.me.pos.x, r.rp.z - this.me.pos.z);
    this.monsterDist = Math.min(this.monsterDist ?? Infinity, r.alive ? d : Infinity);
    if (r.model && r.model.tall) {
      // the tall one: a clank of metal each time a foot comes down (its own step clock says when)
      if (r.model.stepHit) {
        r.model.stepHit = false;
        if (r.alive && d < 34) sfx.playBR('clank', { x: r.rp.x, y: r.rp.y + 0.05, z: r.rp.z }, this.occlusion(r.rp.x, r.rp.y + 0.5, r.rp.z), r.use ? 1.5 : 1.0);
      }
      return;
    }
    if (!r.alive || speed < 0.6) return;
    r.stepTimer -= dt;
    if (r.stepTimer > 0) return;
    r.stepTimer = r.use ? 0.26 : 0.55;
    if (d < 32) sfx.playMonsterStep({ x: r.rp.x, y: r.rp.y + 0.05, z: r.rp.z }, this.occlusion(r.rp.x, r.rp.y + 0.5, r.rp.z), !!r.use);
  }

  // ---------- camera + view-model ----------
  updateCamera(dt) {
    const me = this.me, cam = this.camera;
    let x = me.pos.x, y = me.pos.y + me.eyeOff, z = me.pos.z;
    // you see about half of the recoil; bullets go where the full recoil puts them
    let yaw = me.yaw - me.recY * 0.5 + me.hurtY, pitch = me.pitch + me.recP * 0.5 + me.hurtP;
    let spec = null;     // the player we're watching from their eyes (their gun, scope and crosshair are shown)
    const esc = this.escapeScene, escT = esc ? this.clock - esc.t0 : 0;      // (game time: it runs with the frames)
    if (esc) {
      // the ending scene: up to the door, the white swallows everything, your time, then it fades back to watching the others
      const el = document.getElementById('br-escape'), d = esc.door;
      el.classList.toggle('hidden', escT > 7);
      el.style.opacity = String(escT < 1.9 ? 0 : escT < 2.9 ? (escT - 1.9) : escT < 6 ? 1 : Math.max(0, 1 - (escT - 6)));
      el.classList.toggle('words', escT > 3.1 && escT < 6.2);
      if (escT > 7) { this.escapeScene = null; me.deathTime = performance.now() - 2000; }
    }
    if (!me.alive && esc && escT < 6.5) {
      // you are in the doorway: step into it, turn round for one last look back at the Backrooms, then the white
      const s = smoothstep(Math.min(1, escT / 0.6)), tx = d0(esc).x, tz = d0(esc).z;
      x = esc.x + (tx - esc.x) * s; z = esc.z + (tz - esc.z) * s; y = EYE;
      const back = Math.atan2(-esc.door.nx, -esc.door.nz), k = smoothstep(Math.max(0, Math.min(1, (escT - 0.35) / 1.3)));
      let dy = back - esc.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      if (Math.abs(dy) < 0.4) dy += Math.PI * 2 * Math.sign(dy || 1);      // (always a real turn)
      yaw = esc.yaw + dy * k; pitch = esc.pitch * (1 - k) - 0.05 * k;
    } else if (!me.alive) {
      const since = (performance.now() - me.deathTime) / 1000;
      if (since > 2 && !me.spectate) this.cycleSpectate();
      const target = me.spectate && this.remotes.get(me.spectate);
      const body = this.ragdolls.chestOf(this.myId);
      if (target && target.alive && since > 2) {
        x = target.rp.x; y = target.rp.y + EYE; z = target.rp.z; yaw = target.rp.yaw; pitch = target.rp.pitch;
        spec = target;
      } else if (body) {
        if (target && !target.alive) me.spectate = null;
        // watch your own body fall from a little way behind where you were looking
        const back = Math.min(2.6, 0.6 + since * 3);
        const fx = -Math.sin(me.yaw), fz = -Math.cos(me.yaw);
        const ox = body.x, oy = body.y + 0.4, oz = body.z;
        let dx = -fx, dy = 0.55, dz = -fz;
        const len = Math.hypot(dx, dy, dz);
        dx /= len; dy /= len; dz /= len;
        const tr = this.world.trace(ox, oy, oz, dx, dy, dz, back + 0.3);
        const d = Math.max(0.3, Math.min(back, tr.t - 0.3));
        x = ox + dx * d; y = oy + dy * d; z = oz + dz * d;
        yaw = Math.atan2(-(ox - x), -(oz - z));
        pitch = Math.atan2(oy - 0.3 - y, Math.hypot(ox - x, oz - z));
      } else {
        if (target && !target.alive) me.spectate = null;
        y = me.pos.y + 0.5 + Math.max(0, 1.1 - since * 1.5);
        pitch = me.pitch * 0.5 - Math.min(0.4, since * 0.3);
        yaw = me.yaw;
      }
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      yaw += (Math.random() - 0.5) * 0.02 * this.shake;
      pitch += (Math.random() - 0.5) * 0.02 * this.shake;
    }
    // the Backrooms: a hand-held camera that never quite keeps still (more when running, or when it is near)
    let roll = 0;
    if (this.br) {
      const k = this.settings.camShake == null ? 0.5 : this.settings.camShake;
      if (k > 0) {
        const t = this.clock, run = Math.min(1, Math.hypot(me.vel.x, me.vel.z) / 6), dread = this.dread || 0;
        const a = k * (1 + run * 1.2 + dread * 2.2);
        const n = (f, p) => Math.sin(t * f + p) * 0.6 + Math.sin(t * f * 2.37 + p * 1.7) * 0.3 + Math.sin(t * f * 5.1 + p * 0.3) * 0.1;
        yaw += n(0.9, 1.3) * 0.006 * a;
        pitch += n(1.1, 4.2) * 0.005 * a + Math.abs(Math.sin(t * 9)) * 0.004 * run * k;
        roll = n(0.7, 2.6) * 0.008 * a;
        y += n(1.3, 0.4) * 0.006 * a;
        if (dread > 0.5) { yaw += (Math.random() - 0.5) * 0.004 * dread * k; pitch += (Math.random() - 0.5) * 0.004 * dread * k; }
      }
      // head bobbing: your head rises and falls with each step and sways a little from side to side
      // (Settings → General "Head bobbing in the Backrooms": 0 = off … 1 = strong)
      const hb = this.settings.headBob == null ? 0.5 : this.settings.headBob;
      const sp = Math.hypot(me.vel.x, me.vel.z);
      this.bobAmt = (this.bobAmt || 0) + ((me.alive && me.onGround ? Math.min(1, sp / 3) : 0) - (this.bobAmt || 0)) * Math.min(1, dt * 8);
      if (hb > 0 && this.bobAmt > 0.001 && me.alive) {
        this.bobPhase = (this.bobPhase || 0) + dt * sp * 2.2;
        const a = hb * this.bobAmt, s = Math.sin(this.bobPhase);
        y -= Math.abs(s) * 0.07 * a;
        x += Math.cos(yaw) * s * 0.018 * a; z -= Math.sin(yaw) * s * 0.018 * a;
        roll += s * 0.008 * a;
        pitch += (Math.abs(s) - 0.5) * 0.006 * a;
      }
    }
    const sn = this.fx && this.fx.camera(cam);
    if (sn) { x = sn.x; y = sn.y; z = sn.z; yaw = sn.yaw; pitch = sn.pitch; roll = sn.roll; spec = null; }
    if (spec && !itemDef(spec.w)) spec = null;
    this.specTarget = spec;
    cam.position.set(x, y, z);
    cam.rotation.set(pitch, yaw, roll);
    this.camYaw = yaw;
    sfx.setListener(x, y, z, yaw, pitch);
    this.indoorT = (this.indoorT || 0) - dt;
    if (this.indoorT <= 0) { this.indoorT = 0.3; sfx.setIndoor(this.roofOver(x, y, z) ? 1 : 0); }
    // whose gun is in front of the camera: ours, or the spectated player's (built from what the server tells us)
    let V = me;
    if (spec) {
      const sw = itemDef(spec.w);
      if (spec.vmW !== spec.w) { spec.vmW = spec.w; spec.drawUntil = this.clock + (sw.deploy || 0.5); spec.rlAt = null; }
      if (spec.rl && WEAPONS[spec.w]) { if (spec.rlAt == null) spec.rlAt = this.clock; } else spec.rlAt = null;
      const rlLeft = spec.rlAt == null ? 0 : Math.max(0.001, sw.reload - (this.clock - spec.rlAt));
      const vel = spec.vel || { x: 0, y: 0, z: 0 };
      V = {
        alive: true, zoom: spec.zm || 0, weapon: spec.w, team: spec.team, yaw: spec.rp.yaw, pitch: spec.rp.pitch, vel,
        onGround: Math.abs(vel.y || 0) < 1.2, reloading: rlLeft, reloadEmpty: false, deployUntil: spec.drawUntil || 0, inspectAt: -1,
        swingAt: spec.swingAt == null ? -10 : spec.swingAt, swingStab: !!spec.swingStab, swingDir: spec.swingDir || 1,
        recP: 0, recY: 0, lastFire: spec.lastShotAt == null ? -10 : spec.lastShotAt,
      };
    }
    this.view = V;
    const w = itemDef(V.weapon);
    const targetFov = V.alive && V.zoom && w.zoom ? w.zoom[V.zoom - 1] : (this.settings.fov || 75);
    if (Math.abs(cam.fov - targetFov) > 0.1) {
      cam.fov += (targetFov - cam.fov) * Math.min(1, dt * 18);
      cam.updateProjectionMatrix();
    }
    for (const b of this.billboards) b.quaternion.copy(cam.quaternion);
    if (this.mapGroup && this.mapGroup.userData.tick) this.mapGroup.userData.tick(this.clock);   // moving water

    // view-model: draw, reload, recoil, bob, landing dip
    const vTeam = V === me ? me.team : V.team;
    if (V !== me ? V.weapon + '|' + vTeam !== this.vmKey : this.vmKey !== me.weapon + '|' + me.team) this.setViewModel(V.weapon, vTeam);
    const vm = this.viewModel;
    if (vm) {
      vm.visible = V.alive && !V.zoom;
      this.vmKick = Math.max(0, this.vmKick - dt * 9);
      // recoil springs back
      const R = this.vmRec || (this.vmRec = { z: 0, zv: 0, p: 0, pv: 0, r: 0, rv: 0 });
      for (const [x, v, k, c] of [['z', 'zv', 190, 17], ['p', 'pv', 150, 13], ['r', 'rv', 110, 11]]) {
        R[v] += (-k * R[x] - c * R[v]) * dt;
        R[x] += R[v] * dt;
      }
      // sway: the gun lags behind when you turn or look up and down
      let dYaw = V.yaw - (this.vmPrevYaw == null ? V.yaw : this.vmPrevYaw);
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      const dPitch = V.pitch - (this.vmPrevPitch == null ? V.pitch : this.vmPrevPitch);
      this.vmPrevYaw = V.yaw; this.vmPrevPitch = V.pitch;
      const SW = this.vmSway || (this.vmSway = { x: 0, y: 0 });
      const sk = Math.min(1, dt * 9), rate = dt > 0 ? 1 / dt : 0;
      SW.x += (Math.max(-0.07, Math.min(0.07, dYaw * rate * 0.012)) - SW.x) * sk;
      SW.y += (Math.max(-0.05, Math.min(0.05, dPitch * rate * 0.01)) - SW.y) * sk;
      this.vmLand = Math.max(0, this.vmLand - dt * 4);
      const hs = Math.hypot(V.vel.x, V.vel.z);
      const bobAmt = Math.min(1, hs / 5);
      let rel = 0;
      if (V.reloading > 0 && WEAPONS[V.weapon]) rel = w.reloadType === 'shell' ? 0.35 : Math.sin(Math.PI * (1 - V.reloading / w.reload));
      const draw = Math.max(0, Math.min(1, (V.deployUntil - this.clock) / w.deploy));
      const drawK = draw;
      // pull-out (draw) and inspect poses for this weapon
      const dp = drawPose(w.type, drawK);
      let ip = null, trick = null;
      if (V.inspectAt >= 0) {
        ip = inspectPose(V.weapon, w.type, this.clock - V.inspectAt);
        if (!ip || !V.alive) { ip = null; V.inspectAt = -1; }
        else {
          trick = inspectTrick(V.weapon, w.type, this.clock - V.inspectAt);
          this.vmInspect = { vm, ip, trick, at: this.clock };
        }
      }
      // an inspect cut short (shooting, reloading…) blends back in a moment instead of snapping
      if (!ip && this.vmInspect) {
        const L = this.vmInspect, f = 1 - (this.clock - L.at) / 0.13;
        if (L.vm !== vm || f <= 0 || !V.alive) this.vmInspect = null;
        else {
          const e = f * f * (3 - 2 * f), wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
          ip = L.ip.map((v, i) => (i < 3 ? v : wrap(v)) * e);
          if (L.trick) trick = { ...L.trick, oneHand: L.trick.oneHand * e, spin: wrap(L.trick.spin) * e, wrist: L.trick.wrist * e };
        }
      }
      let P = ip ? dp.map((v, i) => v + ip[i]) : dp;
      // swinging the spoon
      const sp = w.type === 'melee' ? swingPose(V.swingStab, this.clock - V.swingAt, V.swingDir) : null;
      if (sp) P = P.map((v, i) => v + sp[i]);
      // breathing while standing still
      this.vmBreathe = (this.vmBreathe ?? 1) + ((ip ? 0 : 1) - (this.vmBreathe ?? 1)) * Math.min(1, dt * 4);
      const breathe = (1 - bobAmt) * this.vmBreathe;
      const t = this.clock;
      // where each kind of gun sits on screen: x, y, z, then the turn the arms are posed for (the elbows
      // are anchored to it). The gun itself is NOT turned: its barrel stays parallel to the view so it
      // points exactly at the crosshair, where the bullets go.
      const HOLD = { pistol: [0.088, -0.088, -0.28, 0.1], smg: [0.11, -0.11, -0.25, 0.15], shotgun: [0.13, -0.125, -0.25, 0.18], rifle: [0.14, -0.13, -0.26, 0.2], sniper: [0.14, -0.135, -0.25, 0.18], bomb: [0.0, -0.14, -0.3], melee: [0.115, -0.135, -0.3, 0.1] };
      const H = HOLD[(vm.userData.parts && vm.userData.parts.kind) || 'rifle'] || HOLD.rifle;
      // walking: a figure-8 bob; strafing tilts the gun; jumping lets it float
      const b = this.vmBob;
      const rx = Math.cos(V.yaw), rz = -Math.sin(V.yaw);
      const strafe = (V.vel.x * rx + V.vel.z * rz);
      const airY = V.onGround ? 0 : Math.max(-0.025, Math.min(0.025, -V.vel.y * 0.004));
      vm.position.set(
        H[0] + Math.sin(b) * 0.011 * bobAmt + P[0] + Math.sin(t * 1.1) * 0.003 * breathe + SW.x * 0.25,
        H[1] - Math.abs(Math.cos(b)) * 0.009 * bobAmt - rel * 0.015 + P[1] - this.vmLand * 0.035 + Math.sin(t * 2.2) * 0.002 * breathe - SW.y * 0.2 + airY,
        H[2] + R.z + P[2],
      );
      // the camera shows half the recoil; the gun takes the other half so it keeps pointing where the
      // next bullet goes (converted between the two cameras' fields of view)
      const fovK = Math.tan(this.vmCamera.fov * Math.PI / 360) / Math.tan(this.camera.fov * Math.PI / 360);
      const aimP = Math.atan(Math.tan(V.recP * 0.5) * fovK), aimY = Math.atan(Math.tan(-V.recY * 0.5) * fovK);
      vm.rotation.set(R.p + aimP + P[3] + Math.sin(t * 1.1) * 0.003 * breathe - SW.y * 0.8,
        aimY + P[4] + Math.sin(t * 0.7) * 0.004 * breathe - SW.x * 1.1,
        R.r + P[5] + Math.sin(b) * 0.022 * bobAmt - strafe * 0.006);
      // hands and moving parts: holding, reloading, slides, bolts and pumps
      const am = V === me && WEAPONS[me.weapon] ? this.ammoOf(me.weapon) : null;
      const canRel = V !== me || !!am;
      const sinceShot = this.clock - V.lastFire;
      poseViewModel(vm, {
        reload: V.reloading > 0 && canRel && w.reloadType !== 'shell' ? 1 - V.reloading / w.reload : -1,
        shell: V.reloading > 0 && canRel && w.reloadType === 'shell' ? 1 - V.reloading / w.reload : -1,
        reloadEmpty: !!V.reloadEmpty,
        empty: !!am && am.mag === 0,
        fireT: sinceShot,
        hold: H,
        dt,
        // the Deagle spin: one-handed, the gun turns forwards round the trigger finger
        trick,
        bolt: w.bolt && sinceShot < w.interval ? sinceShot / w.interval : -1,
        pump: V.weapon === 'mag7' && sinceShot > 0.12 && sinceShot < 0.12 + w.interval * 0.7 ? (sinceShot - 0.12) / (w.interval * 0.7) : -1,
      });
    }
  }

  // ---------- HUD ----------
  updateHud(dt) {
    const me = this.me, hud = this.hud, w = itemDef(me.weapon);
    hud.tick(dt);
    const elapsed = (performance.now() - (this.timeLeftAt || performance.now())) / 1000;
    const tl = Math.max(0, this.timeLeft - (this.phase === 'end' || this.phase === 'over' ? 0 : elapsed));
    const planted = this.bomb.state === 'planted';
    if (this.br) hud.setTimer(this.timeLeft + (this.phase === 'br' ? elapsed : 0), false);
    else if (this.practice && !planted) hud.setTimer(0, false), document.getElementById('timer').textContent = '∞';
    else hud.setTimer(tl, planted);
    const alive = { atk: 0, def: 0 };
    for (const r of this.remotes.values()) if (r.alive && !r.dummy) alive[r.team]++;
    if (me.alive) alive[me.team]++;
    if (this.br) {
      // how many are still inside, how many got out
      let inside = me.alive ? 1 : 0, out = me.escaped ? 1 : 0;
      for (const r of this.remotes.values()) if (r.team !== 'monster') { if (r.alive) inside++; if (r.escaped) out++; }
      // what to do next (owner's design: everything in one order)
      const gate = (l) => (this.world.doors || []).find(d => d.lock === l);
      const hv = gate('heavy'), kd = gate('red'), ex = gate('twin');
      const step = hv && !hv.open ? '1/5  Open the heavy door' : kd && !kd.open ? (this.keyTaken ? '3/5  Find the locked door' : '2/5  Find the key')
        : ex && !ex.open ? '4/5  Cross the pits, pull both levers' : '5/5  Find the exit';
      hud.setBackrooms(inside, out, step);
    } else if (this.dm) {
      let best = null;
      for (const r of this.remotes.values()) if (!r.dummy && (!best || r.kills > best.kills)) best = r;
      hud.setDeathmatch(me.kills || 0, best ? best.kills : 0, best ? best.name : '', RULES.dm.killLimit);
    } else hud.setScore(this.score, this.round, alive, me.team, this.practice);
    const sp0 = this.specTarget;     // spectating: their health, armour and gun
    hud.setHealth(sp0 ? sp0.hp : me.alive ? me.hp : 0);
    hud.setArmor(sp0 ? sp0.armor : me.alive ? me.armor : 0, sp0 ? false : me.helmet);
    hud.setMoney(me.money, this.practice, this.dm);
    hud.kitIcon(me.alive && me.kit);
    const a = this.ammoOf(me.weapon);
    let mode = '';
    if (w.alt === 'burst') mode = me.burst ? 'burst' : 'semi';
    else if (w.silenced) mode = 'silenced';
    if (sp0) hud.setAmmo(sp0.w, null, null, false, '');
    else if (WEAPONS[me.weapon]) hud.setAmmo(me.weapon, a.mag, a.res, me.reloading > 0, mode);
    else hud.setAmmo(me.weapon, null, null, false, '');
    hud.bombIcon(me.alive && this.owns('c4'));
    const spec = this.specTarget;      // watching someone: their scope and their crosshair
    hud.scope(spec ? spec.zm > 0 : me.alive && me.zoom > 0);

    // crosshair gap from spread
    const fovR = this.camera.fov * Math.PI / 180;
    const gap = Math.tan(this.currentSpread()) / Math.tan(fovR / 2) * (window.innerHeight / 2);
    // follow recoil: the camera only shows half the recoil, so put the crosshair where the next bullet
    // really goes (the same direction fireOnce uses), projected onto the screen
    let rox = 0, roy = 0;
    const xc = this.settings.crosshair;
    if (xc && xc.recoil && me.alive && !me.zoom) {
      // the camera was just turned in updateCamera, but its matrices only refresh when the frame is
      // drawn: refresh them now, or the crosshair lags a frame behind the mouse and jitters when turning
      this.camera.updateMatrixWorld();
      const pitch = me.pitch + me.recP + me.hurtP, yaw = me.yaw - me.recY + me.hurtY;
      const p = TMP.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(50).add(this.camera.position).project(this.camera);
      if (p.z < 1) {
        rox = Math.max(-0.45, Math.min(0.45, p.x)) * window.innerWidth / 2;
        roy = -Math.max(-0.45, Math.min(0.45, p.y)) * window.innerHeight / 2;
      }
    }
    if (spec) {
      // their crosshair style; it opens up when they move or jump like theirs would (their exact spray isn't known here)
      const sw = WEAPONS[spec.w], sxc = spec.xh || DEFAULT_CROSSHAIR;
      let sprd = 0.01;
      if (sw) {
        const max = runSpeed(sw, false), thr = max * ACCURATE_SPEED, hs = spec.speed || 0;
        sprd = (sw.type === 'sniper' && spec.zm ? sw.scoped : sw.stand) + sw.move * Math.max(0, Math.min(1, (hs - thr) / (max - thr)))
          + (Math.abs((spec.vel && spec.vel.y) || 0) > 1.2 ? sw.air : 0);
      }
      const sgap = Math.tan(sprd) / Math.tan(fovR / 2) * (window.innerHeight / 2);
      hud.crosshair(Math.max(0, Math.min(60, (sgap - 4) * 0.7)), !spec.zm, { ...sxc, recoil: false }, 0, 0);
    } else hud.crosshair(Math.max(0, Math.min(60, (gap - 4) * 0.7)), me.alive && !me.zoom, xc, rox, roy);

    // plant / defuse
    const use = this.eligibleUse();
    const pick = use ? null : this.pickTarget();
    const b = this.bomb;
    const total = b.state === 'planted' ? b.need : RULES.plantTime;
    if (b.user === this.myId && b.prog > 0) {
      hud.progress(b.state === 'planted' ? `Defusing${me.kit ? ' (kit)' : ''}…` : 'Planting…', b.prog / total);
    } else if (b.user && b.prog > 0 && b.user !== this.myId) {
      const who = this.playerById(b.user);
      if (who.team === me.team) hud.progress(`${who.name} is ${b.state === 'planted' ? 'defusing' : 'planting'}`, b.prog / total);
      else hud.progress(null);
    } else hud.progress(null);
    const touch = this.settings.touch;
    const canBuy = this.canBuy();
    let hint = '';
    if (me.using) hint = '';
    else if (use === 'plant') hint = touch ? 'Hold [[hand]] to plant the bomb' : `Hold ${this.key('use')} to plant the bomb`;
    else if (use === 'defuse') {
      const left = tl;
      hint = (touch ? 'Hold [[hand]] to defuse' : `Hold ${this.key('use')} to defuse`) + (left < b.need ? ' — not enough time!' : '');
    } else if (use === 'look') hint = 'Look at the bomb to defuse it';
    else if (pick) {
      const cur = me.inv[WEAPONS[pick.w].slot];
      hint = `${touch ? 'Tap [[hand]]' : `Press ${this.key('use')}`} to ${cur ? `swap your ${itemName(cur)} for` : 'pick up'} the ${itemName(pick.w)}`;
    } else if (me.alive && me.melee && me.weapon !== me.melee && this.clock < (this.spoonHintUntil || 0)) {
      const rm = reverseMap(this.settings.keys), code = Object.keys(rm).find(c => rm[c] === 'w3');
      hint = touch ? '[[spoon]] Tap [[swap]] for the spoon' : code ? `[[spoon]] Press ${keyLabel(code)} for the spoon` : '[[spoon]] Scroll the mouse wheel for the spoon';
    } else if (me.alive && this.phase === 'freeze') hint = touch ? 'Tap [[cart]] to buy' : `Press ${this.key('buy')} to buy`;
    else if (me.alive && this.dm && this.clock - (this.spawnedAt || 0) < 3) hint = touch ? 'Tap [[cart]] to change guns' : `Press ${this.key('buy')} to change guns`;
    if (this.br) {
      hint = '';
      const u = this.useTarget(), door = u && u.kind === 'door' ? this.world.doors[u.i] : null, press = touch ? 'Tap [[hand]]' : `Press ${this.key('use')}`;
      // (alone in there, the two-player parts work for one: the host's brSolo)
      const alone = (me.alive && !me.escaped ? 1 : 0) + [...this.remotes.values()].filter(r => r.team !== 'monster' && r.alive && !r.escaped).length < 2;
      if (this.boostMe) hint = this.boostMe.climber ? 'Up on their shoulders… reaching for the key' : 'Holding them up…';
      else if (u && u.kind === 'key') hint = alone ? `The key is up on that shelf. ${press} to jump for it` : `The key is up on that shelf. ${press} to climb on a teammate's shoulders (they stand here too)`;
      else if (u && u.kind === 'switch') hint = alone ? `${press} to pull the lever (then the other one)` : `${press} to pull the lever (both levers at the same moment)`;
      else if (door && door.lock && !door.open) hint = door.lock === 'red' ? (me.key ? `${press} to unlock the door` : 'Locked. Its key is on a high shelf somewhere on this side')
        : door.lock === 'heavy' ? (alone ? `${press} to force the heavy door` : `Too heavy for one: two of you ${touch ? 'tap [[hand]]' : `press ${this.key('use')}`} at the same moment`) : 'The exit room is shut. Both levers in the lever room open it';
      else if (door && !door.lock) hint = `${press} to ${door.open ? 'shut' : 'open'} the door`;
      else if (me.alive && me.key && (this.world.doors || []).some(d => d.lock === 'red' && !d.open)) hint = 'You have the key: find the locked door';
      else if (me.alive && this.clock < (this.brHintUntil || 0)) hint = touch ? 'Hold [[run]] to sprint, but it hears you' : `Hold ${this.key('walk')} to sprint, but it hears you`;
      else if (me.alive && this.clock < (this.brHintUntil || 0) + 9) hint = touch ? 'Tap [[note]] to leave a note for the others' : `Press ${this.key('note')} to leave a note for the others`;
      else if (me.alive && this.clock < (this.brHintUntil || 0) + 16 && this.fx && this.fx.dim < 0.3) hint = touch ? 'Dark in here: tap [[light]] for your flashlight' : `Dark in here: press ${this.key('inspect')} for your flashlight`;
      else if (me.alive && this.world.exit && Math.hypot(this.world.exit.x - me.pos.x, this.world.exit.z - me.pos.z) < 6 && (me.pos.x - this.world.exit.x) * this.world.exit.nx + (me.pos.z - this.world.exit.z) * this.world.exit.nz > 0) hint = 'The exit! Go through the door';
      else if (!me.alive && me.escaped) hint = 'You got out. Watching the others…';
    }
    hud.hint(hint);
    const useBtn = document.getElementById('btn-use');
    useBtn.classList.toggle('hidden', use !== 'plant' && use !== 'defuse' && !pick);
    useBtn.classList.toggle('pick', !!pick && use !== 'plant' && use !== 'defuse');
    if (this.br) useBtn.classList.toggle('hidden', !this.useTarget());
    const altBtn = document.getElementById('btn-alt');
    altBtn.classList.toggle('hidden', !w.alt);
    const altLabel = w.alt === 'scope' ? 'scope' : w.alt === 'stab' ? 'spoon' : 'burst';
    if (altBtn.dataset.icon !== altLabel) { altBtn.dataset.icon = altLabel; altBtn.innerHTML = icon(altLabel); }
    document.getElementById('btn-swap').classList.toggle('hidden', !(me.inv.primary && me.inv.secondary) && !this.owns('c4') && !me.melee);
    const lightBtn = document.getElementById('btn-light');
    lightBtn.classList.toggle('hidden', !this.night && !this.br);
    document.getElementById('btn-note').classList.toggle('hidden', !this.br || !me.alive);
    document.getElementById('btn-map').classList.toggle('hidden', !this.br || !me.alive);
    document.getElementById('btn-map').classList.toggle('on', !!(this.fx && this.fx.mapOpen));
    lightBtn.classList.toggle('on', !!me.light);
    document.getElementById('btn-drop').classList.toggle('hidden', !me.alive || this.dm || me.weapon === me.melee || (!!WEAPONS[me.weapon] && !(me.inv.primary && me.inv.secondary)));
    hud.buyButton(canBuy && !touch && !this.buyOpen && !this.dm);
    document.getElementById('btn-buy').classList.toggle('hidden', !canBuy);
    this.buyMenu.update({
      open: this.buyOpen, money: me.money, team: me.team, inv: me.inv, armor: me.armor, helmet: me.helmet, kit: me.kit,
      canBuy, timeLeft: Math.max(0, RULES.buyTime - this.roundElapsed), practice: this.practice, dm: this.dm, refunds: me.refunds,
    });

    if (!me.alive) {
      const target = me.spectate && this.remotes.get(me.spectate);
      const since = (performance.now() - me.deathTime) / 1000;
      let text = me.killedBy ? `Killed by ${me.killedBy}` : 'You are dead';
      if (target && since > 2) text = `Spectating ${target.name} — ${touch ? 'tap' : 'click'} to switch`;
      if (this.practice || this.dm) text = me.killedBy ? `Killed by ${me.killedBy} — respawning…` : 'Respawning…';
      if (this.br && this.escapeScene) text = null;     // (the ending scene says it)
      else if (this.br && !(target && since > 2)) text = me.escaped ? 'You escaped!' : me.killedBy === 'It' ? 'It caught you' : me.killedBy === 'the fall' ? 'You fell into the dark' : 'You are out';
      hud.death(text);
    } else hud.death(null);

    // scoreboard
    const list = [{ id: this.myId, name: this.settings.name, team: me.team, kills: me.kills || 0, deaths: me.deaths || 0, alive: me.alive, me: true, ping: this.myId === 'host' ? 'host' : me.ping, money: me.money }];
    for (const r of this.remotes.values()) {
      if (r.team === 'monster') continue;
      list.push({ name: r.name, team: r.team, kills: r.kills, deaths: r.deaths, alive: r.alive, dummy: r.dummy, ping: r.bot ? 'bot' : r.id === 'host' ? 'host' : r.ping, money: r.money });
    }
    hud.scoreboard(this.input.scoreHeld, list, this.score, me.team, this.dm || this.br);

    // radar
    this.radarTimer = (this.radarTimer || 0) - dt;
    if (this.radarTimer <= 0) {
      this.radarTimer = 0.1;
      const mates = [...this.remotes.values()].filter(r => r.alive && this.isMate(r) && r.buf.length)
        .map(r => ({ x: r.rp.x, z: r.rp.z, color: TEAM_COLORS[r.team].css }));
      let bomb = null;
      if (b.state === 'planted') bomb = { x: b.x, z: b.z, planted: true };
      else if (me.team === 'atk' && b.state === 'dropped') bomb = { x: b.x, z: b.z };
      else if (me.team === 'atk' && b.state === 'carried' && b.carrier !== this.myId) {
        const c = this.remotes.get(b.carrier);
        if (c) bomb = { x: c.rp.x, z: c.rp.z };
      }
      hud.drawRadar({ x: this.camera.position.x, z: this.camera.position.z, yaw: this.camYaw }, mates, bomb);
    }
  }

  updateBomb(dt) {
    const b = this.bomb, m = this.bombModel;
    // keypad beeps while someone plants, tool clicks while someone defuses
    if (b.user && b.prog > 0) {
      this.useTick = (this.useTick || 0) - dt;
      if (this.useTick <= 0) {
        const planting = b.state !== 'planted';
        this.useTick = planting ? 0.38 : 0.55;
        const u = b.user === this.myId ? this.me.pos : (this.remotes.get(b.user) || {}).rp;
        if (u) (planting ? sfx.playKeypad : sfx.playDefuseTick)({ x: u.x, y: u.y + 0.6, z: u.z });
      }
    } else this.useTick = 0;
    const visible = b.state === 'planted' || b.state === 'dropped';
    m.visible = visible;
    if (b.state === 'planted' && !this.blast) this.prepareBlast();   // joined after the plant
    if (b.state !== 'planted' && this.blast && this.blast.mode === 0) this.clearBlast();
    if (!visible) return;
    m.position.set(b.x, b.y, b.z);
    if (this.bombThrow && b.state === 'dropped') {
      const { from, to, t } = this.bombThrow;
      m.position.set(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + Math.sin(Math.PI * t) * 0.4, from[2] + (to[2] - from[2]) * t);
    }
    if (b.state === 'planted') {
      // beeps speed up as the timer runs down
      const tl = Math.max(0, this.timeLeft - (performance.now() - (this.timeLeftAt || 0)) / 1000);
      const interval = Math.max(0.12, Math.min(1, tl / RULES.bombTime));
      this.beepTimer -= dt;
      m.userData.light.visible = this.beepTimer > interval * 0.6;
      if (this.beepTimer <= 0) {
        this.beepTimer = interval;
        const d = Math.hypot(b.x - this.me.pos.x, b.z - this.me.pos.z);
        sfx.playBeep({ x: b.x, y: b.y + 0.2, z: b.z });
      }
    } else m.userData.light.visible = false;
  }

  sendState(dt) {
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    this.sendTimer = 0.05;
    const me = this.me;
    // our crosshair style, so people spectating us see it (sent again whenever it's changed in Settings)
    this.xhTimer = (this.xhTimer || 0) - 0.05;
    if (this.xhTimer <= 0) {
      this.xhTimer = 1;
      const code = crosshairCode(this.settings.crosshair);
      if (code !== this.sentXh) { this.sentXh = code; this.transport.send({ t: 'xh', c: code }); }
    }
    if (!me.alive) return;
    const r = v => Math.round(v * 100) / 100;
    this.transport.send({
      t: 'st', rd: this.round, x: r(me.pos.x), y: r(me.pos.y), z: r(me.pos.z),
      yaw: r(me.yaw), pitch: r(me.pitch), w: me.weapon, u: me.using ? 1 : 0, zm: me.zoom | 0, rl: me.reloading > 0 ? 1 : 0,
      am: [me.inv.primary, me.inv.secondary].flatMap(id => { const a = this.ammoOf(id); return id ? [a.mag, a.res] : [0, 0]; }),
    });
  }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    // FPS cap: skip frames that come too soon
    if (this.gfx.fpsCap && now - this.last < 1000 / this.gfx.fpsCap - 1.5) return;
    // (never below 0: a frame's timestamp can come before the moment the game finished loading, which used to
    // wind the game clock back by seconds and freeze anything timed by it, like the monsters' jerky steps)
    const dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
    this.last = now;
    this.clock += dt;
    // the screen changed size without telling us (phones): catch up
    this.sizeCheck = (this.sizeCheck || 0) - dt;
    if (this.sizeCheck <= 0) { this.sizeCheck = 0.3; if (window.innerWidth !== this.viewW || window.innerHeight !== this.viewH) this.onResize(); }
    if (this.paused) { this.input.takeLook(); }
    else this.updateLocal(dt);
    this.sendState(dt);
    this.updateRemotes(dt);
    if (this.fx) this.fx.update(dt);
    this.ragdolls.update(dt);
    this.updateDrops(dt);
    this.updateBomb(dt);
    this.updateEffects(dt);
    this.updateCamera(dt);
    this.updateFlashlights();
    if (this.builtMap && this.builtMap.group.userData.switchTick) this.builtMap.group.userData.switchTick(this.clock);
    this.updateHud(dt);
    if (this.mapUpdate) {
      const d = this.monsterDist ?? Infinity;
      this.monsterDist = Infinity;
      this.dread = Math.max(0, Math.min(1, (16 - d) / 12));
      this.mapUpdate(dt, this.dread, this.camera.position);
    }
    // the sky follows the camera (so a short view distance never cuts it off)
    const skyK = (this.camera.far * 0.9) / 500;
    for (const s of this.sky) { s.position.copy(this.camera.position); s.scale.setScalar(skyK); }
    if (this.post) this.post.render(this.scene, this.camera);
    else {
      this.renderer.setRenderTarget(null);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
    }
    if (this.br) return;          // no gun in your hands in the Backrooms
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
  }
}
