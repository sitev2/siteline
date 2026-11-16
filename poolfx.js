// The Poolrooms' own materials, all written for SITELINE (no image files, no add-ons):
//   tileMaterial  — every tiled or plastered surface. The 5 cm mosaic is drawn by the shader itself (so it stays
//                   sharp close up and never shimmers far away), lit by light baked into each corner (aLight), by
//                   the low sun through one shadow picture taken when the level loads, by the water's dancing
//                   reflections, and seen through water where it is under the surface (teal with depth).
//   waterMaterial — the surface: gentle ripples, rings spreading from players, a true mirror picture of the hall
//                   on Medium and up (a simple one on Low), sun glints.
//   shaft / dust / chrome / glow materials for the light beams, the specks in them, the steel ladders, the windows.
import * as THREE from 'three';

export const MAX_RIPPLES = 12;
// everything the Poolrooms' shaders share (one object: set once a frame)
export function poolUniforms(sunDir) {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-sunDir[0], -sunDir[1], -sunDir[2]) },      // towards the sun
    uSunCol: { value: new THREE.Color(3.3, 2.4, 1.4) },
    uShadow: { value: null }, uShadowMat: { value: new THREE.Matrix4() }, uShadowTexel: { value: 1 / 2048 },
    uDyn: { value: null }, uDynMat: { value: new THREE.Matrix4() }, uDynOn: { value: 0 },
    uWaterY: { value: 2.88 }, uGreatY: { value: 2.88 },
    uClipY: { value: -1e6 }, uLite: { value: 0 },
    uHaze: { value: new THREE.Color(0.98, 0.93, 0.80) }, uHazeK: { value: 0.0075 },
    uExposure: { value: 1.0 },
    uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0)) },
    uBlobs: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -99, 0, 0)) },
    uRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
  };
}

// ---- pieces of shader used by more than one material ----
const COMMON = /* glsl */`
  uniform float uTime;
  float hash21(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
  // The water's slow swell: the slope of a handful of wave trains running different ways (calm: a couple of degrees).
  vec2 swell(vec2 p, float t) {
    vec2 g = vec2(0.0);
    g += vec2(1.9, 0.6) * (0.0038 * cos(1.9 * p.x + 0.6 * p.y + 0.9 * t));
    g += vec2(-0.8, 2.3) * (0.0036 * cos(-0.8 * p.x + 2.3 * p.y + 1.1 * t + 1.3));
    g += vec2(3.4, -2.6) * (0.0030 * cos(3.4 * p.x - 2.6 * p.y + 1.7 * t + 2.9));
    #ifdef FINE
    g += vec2(-5.2, -3.9) * (0.0026 * cos(-5.2 * p.x - 3.9 * p.y + 2.3 * t + 4.1));
    g += vec2(7.3, 5.1) * (0.0014 * cos(7.3 * p.x + 5.1 * p.y + 3.1 * t + 0.7));
    g += vec2(-11.0, 6.0) * (0.0007 * cos(-11.0 * p.x + 6.0 * p.y + 3.9 * t + 2.2));
    #endif
    return g;
  }
  // Caustics: the bright net the ripples throw on the pool floor (and back up onto walls and ceilings). Worked
  // out the way light really bunches up under a wavy surface: where the bent rays cross (the surface's curvature
  // squeezes an area to nothing) it is bright, in between it is dim. Average brightness about 1.
  float caustic(vec2 p, float t) {
    p += 0.35 * vec2(sin(p.y * 0.61 + t * 0.21), cos(p.x * 0.53 - t * 0.17));
    float hxx = 0.0, hyy = 0.0, hxy = 0.0, s;
    s = sin(5.1 * p.x + 1.3 * p.y + 1.1 * t);        hxx += 26.0 * s; hyy += 1.7 * s;  hxy += 6.6 * s;
    s = sin(-2.2 * p.x + 4.6 * p.y + 0.9 * t + 1.7); hxx += 4.8 * s;  hyy += 21.2 * s; hxy -= 10.1 * s;
    s = sin(3.1 * p.x - 3.9 * p.y + 1.3 * t + 3.1);  hxx += 8.6 * s;  hyy += 13.7 * s; hxy -= 10.9 * s;
    #ifdef FINE
    s = sin(-6.3 * p.x - 2.4 * p.y + 1.6 * t + 4.4); hxx += 23.8 * s; hyy += 3.5 * s;  hxy += 9.1 * s;
    s = sin(1.2 * p.x + 7.1 * p.y + 1.9 * t + 5.9);  hxx += 0.7 * s;  hyy += 25.2 * s; hxy += 4.3 * s;
    float d = 0.0128;
    #else
    float d = 0.0205;
    #endif
    float J = (1.0 - d * hxx) * (1.0 - d * hyy) - d * d * hxy * hxy;
    return min(0.62 / (abs(J) + 0.16), 3.4);
  }
`;

const SHADOW = /* glsl */`
  uniform sampler2D uShadow; uniform float uShadowTexel;
  #ifdef DYN
  uniform sampler2D uDyn; uniform float uDynOn;
  #endif
  float tapS(sampler2D m, vec2 uv, float z) { return step(z, texture2D(m, uv).x); }
  // how much of the sun reaches this point (0 … 1), with a soft edge
  float sunLit(vec3 s, vec3 sd, vec2 frag) {
    if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0 || s.z > 1.0) return 0.0;
    float z = s.z - 0.00035, lit = 0.0;
    #ifdef SOFT
    float a = hash21(frag) * 6.2832;
    for (int i = 0; i < 8; i++) {
      float r = sqrt((float(i) + 0.5) / 8.0) * 2.4 * uShadowTexel, th = a + float(i) * 2.39996;
      lit += tapS(uShadow, s.xy + vec2(cos(th), sin(th)) * r, z);
    }
    lit /= 8.0;
    #else
    vec2 o = vec2(uShadowTexel * 0.9);
    lit = 0.25 * (tapS(uShadow, s.xy + o, z) + tapS(uShadow, s.xy - o, z) + tapS(uShadow, s.xy + vec2(o.x, -o.y), z) + tapS(uShadow, s.xy + vec2(-o.x, o.y), z));
    #endif
    #ifdef DYN
    // people's shadows: a second, small picture taken every frame round the camera
    if (uDynOn > 0.5 && lit > 0.0 && sd.x > 0.0 && sd.x < 1.0 && sd.y > 0.0 && sd.y < 1.0 && sd.z < 1.0) {
      float zd = sd.z - 0.0012, e = 1.0 / 1024.0;
      lit *= 0.25 * (tapS(uDyn, sd.xy + vec2(e, e), zd) + tapS(uDyn, sd.xy - vec2(e, e), zd) + tapS(uDyn, sd.xy + vec2(e, -e), zd) + tapS(uDyn, sd.xy + vec2(-e, e), zd));
    }
    #endif
    return lit;
  }
`;

const TONE = /* glsl */`
  uniform float uExposure;
  // bright patches roll off softly into white instead of clipping
  vec3 tone(vec3 c) {
    c *= uExposure;
    return 1.0 - exp(-1.3 * max(c, 0.0));
  }
`;

const TILE_VERT = /* glsl */`
  attribute vec3 aLight; attribute vec4 aFx; attribute vec3 aGlint;
  uniform mat4 uShadowMat, uDynMat;
  varying vec3 vW, vN, vL, vG, vS, vSd; varying vec2 vUv; varying vec4 vFx;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal);
    vL = aLight; vG = aGlint; vUv = uv; vFx = aFx;
    vec4 sp = vec4(vW + vN * 0.07, 1.0);
    vS = (uShadowMat * sp).xyz * 0.5 + 0.5;
    vSd = (uDynMat * sp).xyz * 0.5 + 0.5;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// aFx: x = finish (0 cream mosaic, 1 white mosaic, 2 pale blue mosaic, 3 smooth plaster, 4 gutter slot, 5 big cream
// tiles), y = the water this surface can be under (0 none, 1 a pool, 2 the Great Pool (it drains), 3 a flooded
// floor), z = how much of the water's reflected light dances on it, w = how wet it is (shinier)
const TILE_FRAG = /* glsl */`
  ${COMMON}
  ${SHADOW}
  ${TONE}
  uniform vec3 uSunDir, uSunCol, uHaze; uniform float uHazeK, uWaterY, uGreatY, uClipY, uLite;
  uniform vec4 uBlobs[6];
  varying vec3 vW, vN, vL, vG, vS, vSd; varying vec2 vUv; varying vec4 vFx;
  void main() {
    if (vW.y < uClipY) discard;
    vec3 N = normalize(vN);
    vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 V = toCam / dist;
    float fin = floor(vFx.x + 0.5), wk = floor(vFx.y + 0.5);
    float level = wk > 1.5 && wk < 2.5 ? uGreatY : uWaterY;
    float under = wk > 0.5 ? clamp((level - vW.y) * 40.0, 0.0, 1.0) : 0.0;
    float depth = max(level - vW.y, 0.0) * under;
    vec2 uv = vUv;
    // seen through the water's surface the tiles wobble a little (more the deeper they lie)
    if (under > 0.0 && uLite < 0.5) uv += swell(vW.xz, uTime) * min(depth, 2.5) * 0.9;

    // ---- the tiles ----
    vec3 base = fin < 0.5 ? vec3(0.84, 0.765, 0.60) : fin < 1.5 ? vec3(0.90, 0.865, 0.76) : fin < 2.5 ? vec3(0.47, 0.70, 0.82) : fin < 3.5 ? vec3(0.86, 0.81, 0.68) : fin < 4.5 ? vec3(0.10, 0.11, 0.12) : vec3(0.84, 0.765, 0.60);
    float gloss = fin < 2.5 ? 1.0 : fin < 3.5 ? 0.1 : fin < 4.5 ? 0.3 : 1.0;
    vec3 alb = base; vec2 bump = vec2(0.0);
    if (fin < 2.5 || fin > 4.5) {
      float T = fin > 4.5 ? 0.15 : 0.05;
      vec2 g = uv / T, id = floor(g), f = fract(g);
      vec2 fw = max(fwidth(g), vec2(1e-4));
      vec2 e = min(f, 1.0 - f);                                 // how far from the tile's edge
      float gw = fin > 4.5 ? 0.02 : 0.04;
      // how much of this pixel is grout: worked out exactly over the pixel's footprint, so there is neither
      // shimmer nor a dark band where the tiles get smaller than a pixel
      vec2 ga = g + gw - 0.5 * fw, gb = g + gw + 0.5 * fw;
      vec2 cov = clamp((floor(gb) * 2.0 * gw + min(fract(gb), 2.0 * gw) - floor(ga) * 2.0 * gw - min(fract(ga), 2.0 * gw)) / fw, 0.0, 1.0);
      float grout = 1.0 - (1.0 - cov.x) * (1.0 - cov.y);
      float near = 1.0 - smoothstep(0.15, 0.6, max(fw.x, fw.y));
      float h = hash21(id);
      alb = base * (1.0 + (h - 0.5) * 0.07 * near) * (1.0 + (hash21(id + 7.3) - 0.5) * vec3(0.03, 0.0, -0.04) * near);
      alb = mix(alb, base * vec3(0.46, 0.44, 0.42), grout);
      // mosaic comes in sheets of six by six: their seams and the slight difference from sheet to sheet still
      // read as tiling from across the hall, when the little tiles have melted together
      vec2 g6 = g / 6.0, fw6 = fw / 6.0, sa = g6 + 0.012 - 0.5 * fw6, sb = g6 + 0.012 + 0.5 * fw6;
      vec2 c6 = clamp((floor(sb) * 0.024 + min(fract(sb), 0.024) - floor(sa) * 0.024 - min(fract(sa), 0.024)) / fw6, 0.0, 1.0);
      float far6 = 1.0 - smoothstep(0.2, 0.7, max(fw6.x, fw6.y));
      alb *= 1.0 - (1.0 - (1.0 - c6.x) * (1.0 - c6.y)) * 0.42 * (1.0 - near * 0.7);
      alb *= 1.0 + (hash21(floor(g6) + 3.1) - 0.5) * 0.045 * far6;
      gloss *= 1.0 - grout * 0.85;
      // each little tile is not quite flat and not quite level: that is what makes the highlights sparkle
      bump = ((vec2(hash21(id + 1.7), hash21(id + 4.1)) - 0.5) * 0.05 + (f - 0.5) * smoothstep(0.30, 0.50, max(abs(f.x - 0.5), abs(f.y - 0.5))) * 0.5) * near;
    } else if (fin < 3.5) {
      // smooth painted plaster: only the faintest unevenness
      alb *= 0.97 + 0.03 * sin(uv.x * 0.9 + sin(uv.y * 0.7) * 1.3) * sin(uv.y * 1.1 + 0.4);
    } else {
      // the overflow gutter: a dark slot with a white grille across it
      float bar = smoothstep(0.30, 0.42, abs(fract(uv.x / 0.04) - 0.5));
      alb = mix(vec3(0.82, 0.81, 0.77), base, bar);
    }
    // the bump tilts the normal within the surface
    vec3 Np = N;
    if (uLite < 0.5 && (bump.x != 0.0 || bump.y != 0.0)) {
      vec3 dpx = dFdx(vW), dpy = dFdy(vW); vec2 dux = dFdx(vUv), duy = dFdy(vUv);
      vec3 Tg = dpx * duy.y - dpy * dux.y, Bt = dpy * dux.x - dpx * duy.x;
      float inv = inversesqrt(max(dot(Tg, Tg), dot(Bt, Bt)) + 1e-12);
      Np = normalize(N - (Tg * bump.x + Bt * bump.y) * inv);
    }
    float wet = clamp(vFx.w + under, 0.0, 1.0);
    alb *= 1.0 - 0.16 * wet * (1.0 - under);                 // damp tiles are a shade darker

    // ---- light ----
    float sun = max(dot(N, uSunDir), 0.0);
    float lit = sun > 0.0 ? sunLit(vS, vSd, gl_FragCoord.xy) : 0.0;
    vec3 amb = vL;
    // someone standing here: a soft shadow round their feet
    float blob = 1.0;
    for (int i = 0; i < 6; i++) {
      vec4 b = uBlobs[i];
      vec3 d = vW - b.xyz;
      float k = smoothstep(b.w, 0.0, length(d.xz)) * smoothstep(1.3, 0.0, abs(d.y - 0.5) - 0.5);
      blob *= 1.0 - 0.42 * k * max(N.y, 0.25);
    }
    amb *= blob;
    vec3 direct = uSunCol * sun * lit;
    float ca = 1.0;
    if (uLite < 0.5) {
      if (under > 0.0) {
        // the net of light on the pool floor: strong where the sun gets in, faint elsewhere
        ca = caustic(vW.xz * 2.1 + vW.y * 0.3, uTime);
        float k = clamp(depth * 2.2, 0.0, 1.0) * max(N.y, 0.2);
        amb *= mix(1.0, 0.86 + 0.14 * ca, k);
        direct *= mix(1.0, 0.25 + 0.95 * ca, k);
      }
      #ifdef FINE
      else if (vFx.z > 0.01) {
        // above the water: the same net, thrown back up onto walls, pillars and ceilings
        vec2 q = abs(N.y) > 0.5 ? vW.xz : vec2(vUv.x, vW.y * 1.4);
        float c2 = caustic(q * 1.5 + 3.7, uTime * 0.8);
        amb += vec3(1.0, 0.93, 0.74) * vFx.z * max(c2 - 0.32, 0.0) * 0.5;
      }
      #endif
    }
    vec3 col = alb * (amb + direct);

    // ---- shine: glazed tiles mirror the bright things in the room ----
    float F = 0.04 + 0.96 * pow(1.0 - max(dot(Np, V), 0.0), 5.0);
    float shine = gloss * (0.55 + 0.9 * wet);
    vec3 R = reflect(-V, Np);
    float gl = length(vG);
    vec3 spec = vec3(0.0);
    if (gl > 0.003) spec += vec3(1.0, 0.98, 0.94) * pow(max(dot(R, vG / gl), 0.0), mix(22.0, 70.0, wet)) * min(gl, 1.6) * (0.10 + 0.5 * wet) * shine;
    spec += uSunCol * lit * pow(max(dot(R, uSunDir), 0.0), 140.0) * 1.6 * shine;
    col = mix(col, amb * 0.82, F * shine * 0.55) + spec * (1.0 - under);

    // ---- under water: the further the light travels through it, the more teal it gets ----
    if (under > 0.0) {
      float shallow = wk > 2.5 ? 1.0 : 0.0;
      float path = depth / max(V.y, 0.16) + depth * 0.7;
      path = min(path, 16.0) * mix(1.0, 3.2, shallow);
      vec3 keep = exp(-path * vec3(0.46, 0.085, 0.13));
      vec3 glow = mix(vec3(0.05, 0.50, 0.44), vec3(0.06, 0.46, 0.36), shallow) * (amb * 0.9 + direct * 0.22 + 0.02);
      col = col * keep + glow * (1.0 - exp(-path * 0.23));
    }
    // ---- the soft bright haze of a big damp hall: more of it the further away, brighter where there is light ----
    float hz = 1.0 - exp(-dist * uHazeK);
    float bright = clamp(dot(amb, vec3(0.4)) * 1.2 + 0.18, 0.0, 1.0);
    col = mix(col, uHaze * bright, hz * 0.8);
    gl_FragColor = vec4(tone(col), 1.0);
    #include <colorspace_fragment>
  }
`;

export function tileMaterial(U, q, extra = {}) {
  const defines = {};
  if (q >= 1) { defines.FINE = 1; defines.SOFT = 1; defines.DYN = 1; }
  return new THREE.ShaderMaterial({
    uniforms: U, defines, vertexShader: TILE_VERT, fragmentShader: TILE_FRAG, ...extra,
  });
}

// ---------- water ----------
const WATER_VERT = /* glsl */`
  attribute vec3 aLight; attribute vec3 aGlint;
  uniform mat4 uShadowMat, uReflMat;
  varying vec3 vW, vL, vG, vS; varying vec4 vR;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vL = aLight; vG = aGlint;
    vS = (uShadowMat * vec4(vW, 1.0)).xyz * 0.5 + 0.5;
    vR = uReflMat * w;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const WATER_FRAG = /* glsl */`
  ${COMMON}
  ${SHADOW}
  ${TONE}
  uniform vec3 uSunDir, uSunCol, uHaze; uniform float uHazeK, uReflOn;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  uniform sampler2D uRefl;
  varying vec3 vW, vL, vG, vS; varying vec4 vR;
  void main() {
    vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 V = toCam / dist;
    vec2 p = vW.xz;
    vec2 g = swell(p, uTime);
    // rings spreading from people in the water (and anything else that disturbs it)
    for (int i = 0; i < RIPPLES; i++) {
      vec4 r = uRipples[i];
      float age = uTime - r.z;
      if (age < 0.0 || age > 6.0) continue;
      vec2 d = p - r.xy; float rr = length(d) + 1e-4, front = 0.25 + age * 1.15;
      float x = rr - front;
      float env = exp(-x * x * 2.6) * r.w * (1.0 - age / 6.0) / (1.0 + front * 0.9);
      g += (d / rr) * cos(x * 9.0) * env * 0.5;
    }
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    float ndv = max(dot(N, V), 0.02);
    float F = 0.05 + 0.95 * pow(1.0 - ndv, 3.2);
    vec3 refl;
    #ifdef MIRROR
    if (uReflOn > 0.5) {
      vec2 uv = vR.xy / vR.w + g * (0.3 / (1.0 + dist * 0.08));
      refl = texture2D(uRefl, clamp(uv, 0.002, 0.998)).rgb;
    } else
    #endif
    {
      // (Low: no mirror picture. The ceiling above, as it was lit when the level loaded, stands in for it)
      refl = vL * 0.86;
    }
    float lit = sunLit(vS, vec3(-1.0), gl_FragCoord.xy);
    vec3 R = reflect(-V, N);
    vec3 spec = uSunCol * lit * (pow(max(dot(R, uSunDir), 0.0), 420.0) * 9.0 + pow(max(dot(R, uSunDir), 0.0), 40.0) * 0.12);
    float gl = length(vG);
    #ifndef MIRROR
    if (gl > 0.003) spec += vec3(1.0, 0.98, 0.95) * pow(max(dot(R, vG / gl), 0.0), 90.0) * min(gl, 1.6) * 0.9;
    #else
    if (gl > 0.003 && uReflOn < 0.5) spec += vec3(1.0, 0.98, 0.95) * pow(max(dot(R, vG / gl), 0.0), 90.0) * min(gl, 1.6) * 0.9;
    #endif
    #ifdef MIRROR
    vec3 col = (uReflOn > 0.5 ? refl : tone(refl)) * F + tone(spec);
    #else
    vec3 col = tone(refl) * F + tone(spec);
    #endif
    // (what lies under the surface is already drawn, tinted by the water over it: the mirror goes on top of it)
    float hz = 1.0 - exp(-dist * uHazeK);
    col = mix(col, tone(uHaze * 0.9) * F, hz * 0.5);
    gl_FragColor = vec4(col, F);
    #include <colorspace_fragment>
  }
`;
export function waterMaterial(U, q) {
  const defines = { RIPPLES: q >= 1 ? MAX_RIPPLES : 6 };
  if (q >= 1) { defines.FINE = 1; defines.SOFT = 1; defines.MIRROR = 1; }
  return new THREE.ShaderMaterial({
    uniforms: U, defines, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
    transparent: true, depthWrite: false, premultipliedAlpha: true,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

// ---------- light shafts: the sun's beams made visible by the damp air ----------
// A beam is the prism under a window or skylight. Its sides glow faintly (more where you look along them).
export function shaftMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uShaft: { value: 0.075 } },
    vertexShader: /* glsl */`
      attribute float aAlong;
      varying float vA; varying vec3 vW, vN;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normal; vA = aAlong; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunCol; uniform float uShaft, uTime;
      varying float vA; varying vec3 vW, vN;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        float face = abs(dot(normalize(vN), V));
        float a = uShaft * (0.12 + 0.88 * face * face) * smoothstep(0.0, 0.08, vA) * (1.0 - vA * 0.65);
        a *= 0.92 + 0.08 * sin(vW.x * 1.7 + vW.z * 1.3 + uTime * 0.3);
        float near = smoothstep(0.3, 2.2, length(cameraPosition - vW));
        gl_FragColor = vec4(uSunCol * 0.42 * a * near, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

// dust: tiny specks drifting in the beams
export function dustMaterial(U, pixelRatio) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uPx: { value: pixelRatio } },
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime, uPx;
      varying float vTw;
      void main() {
        vec3 p = position;
        float t = uTime * 0.11;
        p += vec3(sin(t * (0.7 + aSeed.x) + aSeed.y * 6.28), sin(t * (0.5 + aSeed.z) + aSeed.x * 6.28) * 0.6 - 0.15 * fract(t * 0.2 + aSeed.w) + 0.07, cos(t * (0.6 + aSeed.y) + aSeed.z * 6.28)) * 0.35;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vTw = (0.45 + 0.55 * sin(uTime * (0.8 + aSeed.w * 2.0) + aSeed.x * 40.0)) * smoothstep(0.4, 1.6, -mv.z) * smoothstep(26.0, 12.0, -mv.z);
        gl_PointSize = uPx * (1.2 + aSeed.w * 2.2) * 5.0 / max(-mv.z, 0.8);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunCol; varying float vTw;
      void main() {
        vec2 d = gl_PointCoord - 0.5; float r = dot(d, d);
        if (r > 0.25) discard;
        gl_FragColor = vec4(uSunCol * 0.34 * vTw * smoothstep(0.25, 0.02, r), 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

// polished steel (ladders, drains): mirrors a simple picture of a bright tiled hall
export function chromeMaterial(U) {
  return new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */`
      attribute vec3 aLight;
      varying vec3 vW, vN, vL;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vL = aLight; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${TONE}
      uniform float uClipY, uWaterY; uniform vec3 uSunDir, uSunCol;
      varying vec3 vW, vN, vL;
      void main() {
        if (vW.y < uClipY) discard;
        vec3 N = normalize(vN), V = normalize(cameraPosition - vW), R = reflect(-V, N);
        float up = R.y;
        // floor below, a dark line where the walls meet it, bright walls and ceiling above, a hot streak near the top
        vec3 env = mix(vec3(0.34, 0.33, 0.30), vec3(0.95, 0.93, 0.86), smoothstep(-0.25, 0.12, up));
        env *= 1.0 - 0.55 * smoothstep(0.10, 0.0, abs(up + 0.04));
        env += vec3(1.0, 0.97, 0.9) * (smoothstep(0.55, 0.9, up) * 0.9 + pow(max(dot(R, uSunDir), 0.0), 60.0) * 2.0);
        float F = 0.62 + 0.38 * pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 col = env * F * (vL * 1.1 + 0.05);
        if (vW.y < uWaterY) col = col * vec3(0.55, 0.86, 0.82) * 0.8;
        gl_FragColor = vec4(tone(col), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

// a flat colour lit by the baked light (slide tubes, the lift doors): aLight × colour, a little shine
export function plainMaterial(U, params = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uShiny: { value: params.shiny == null ? 0.4 : params.shiny } },
    vertexShader: /* glsl */`
      attribute vec3 aLight; attribute vec3 color;
      varying vec3 vW, vN, vL, vC;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vL = aLight; vC = color; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${TONE}
      uniform float uClipY, uShiny, uHazeK; uniform vec3 uHaze;
      varying vec3 vW, vN, vL, vC;
      void main() {
        if (vW.y < uClipY) discard;
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        vec3 toCam = cameraPosition - vW; float dist = length(toCam); vec3 V = toCam / dist;
        float F = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 R = reflect(-V, N);
        vec3 col = vC * vL + vL * uShiny * (0.12 * F + 0.5 * pow(max(R.y, 0.0), 6.0));
        col = mix(col, uHaze * clamp(dot(vL, vec3(0.45)) + 0.15, 0.0, 1.0), (1.0 - exp(-dist * uHazeK)) * 0.85);
        gl_FragColor = vec4(tone(col), 1.0);
        #include <colorspace_fragment>
      }`,
    side: params.side || THREE.FrontSide,
  });
}

// the soft white bloom round a window or skylight (so they glow on every graphics setting)
export function glowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uGlow: { value: 0.13 } },
    vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uGlow; varying vec2 vUv;
      void main() {
        float a = 1.0 - smoothstep(0.25, 1.0, length((vUv - 0.5) * 2.0));
        gl_FragColor = vec4(vec3(1.0, 0.98, 0.93) * a * a * uGlow, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}
