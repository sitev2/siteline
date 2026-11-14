// Post-processing for the higher graphics settings, written for SITELINE (no add-on files):
//   ambient occlusion (darkens creases and corners), bloom (bright things glow),
//   FXAA (smooths jagged edges), and the 'look' shaders (opts.look, graphics option "Picture shaders"): a little
//   sharpening, a film-like contrast curve with slightly richer colour, warm highlights over cool shadows, a faint
//   colour fringe and a soft vignette towards the corners, and a hair of dither so dark gradients don't band.
//   The first-person gun is drawn afterwards, straight on top, so it stays crisp.
import * as THREE from 'three';

const VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const AO_FRAG = `
  uniform sampler2D tDepth; uniform vec2 texel; uniform float near, far, projScale, radius, strength;
  varying vec2 vUv;
  float lin(vec2 uv) {
    float z = texture2D(tDepth, uv).x * 2.0 - 1.0;
    return (2.0 * near * far) / (far + near - z * (far - near));
  }
  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
  void main() {
    float d = lin(vUv);
    if (d > far * 0.8) { gl_FragColor = vec4(1.0); return; }
    // look at pairs of points on opposite sides: if both are nearer than this pixel
    // (a crease or corner) it gets darker; flat walls and floors stay untouched
    float r = clamp(radius * projScale / d, 2.0 * texel.y, 0.08);
    float a0 = hash(vUv * 731.0) * 6.2832;
    float occ = 0.0;
    for (int i = 0; i < 6; i++) {
      float a = a0 + float(i) * 0.5236;
      float rr = r * (0.35 + 0.65 * fract(float(i) * 0.618 + 0.3));
      vec2 o = vec2(cos(a), sin(a)) * rr * vec2(texel.y / texel.x, 1.0);
      float s1 = lin(vUv + o), s2 = lin(vUv - o);
      float crease = d - 0.5 * (s1 + s2);
      float range = smoothstep(radius * 3.0, 0.0, abs(d - min(s1, s2)));
      occ += clamp(crease / (0.06 * d + 0.02), 0.0, 1.0) * range;
    }
    gl_FragColor = vec4(vec3(1.0 - strength * occ / 6.0), 1.0);
  }`;

const BRIGHT_FRAG = `
  uniform sampler2D tColor; uniform float threshold; varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    gl_FragColor = vec4(c * smoothstep(threshold, threshold + 0.25, l), 1.0);
  }`;

const BLUR_FRAG = `
  uniform sampler2D tColor; uniform vec2 dir; varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb * 0.227;
    c += texture2D(tColor, vUv + dir * 1.385).rgb * 0.316;
    c += texture2D(tColor, vUv - dir * 1.385).rgb * 0.316;
    c += texture2D(tColor, vUv + dir * 3.231).rgb * 0.070;
    c += texture2D(tColor, vUv - dir * 3.231).rgb * 0.070;
    gl_FragColor = vec4(c, 1.0);
  }`;

const COMPOSITE_FRAG = `
  uniform sampler2D tColor, tAO, tBloom; uniform float useAO, bloomStrength, vignette, look, time; uniform vec2 aoTexel, texel;
  varying vec2 vUv;
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    if (look > 0.0) {
      // a faint colour fringe towards the corners, like a real lens (nothing in the middle of the screen)
      vec2 q0 = vUv - 0.5; float r2 = dot(q0, q0);
      vec2 off = q0 * r2 * 0.012 * look;
      c.r = texture2D(tColor, vUv + off).r; c.b = texture2D(tColor, vUv - off).b;
      // sharpen: push each pixel away from the average of its four neighbours (clamped, so edges don't ring)
      vec3 blur = 0.25 * (texture2D(tColor, vUv + vec2(texel.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(texel.x, 0.0)).rgb
        + texture2D(tColor, vUv + vec2(0.0, texel.y)).rgb + texture2D(tColor, vUv - vec2(0.0, texel.y)).rgb);
      c = max(vec3(0.0), c + clamp(c - blur, -0.06, 0.06) * 0.6 * look);
    }
    if (useAO > 0.5) {
      float ao = texture2D(tAO, vUv).r * 0.4;
      ao += texture2D(tAO, vUv + vec2(aoTexel.x, 0.0)).r * 0.15;
      ao += texture2D(tAO, vUv - vec2(aoTexel.x, 0.0)).r * 0.15;
      ao += texture2D(tAO, vUv + vec2(0.0, aoTexel.y)).r * 0.15;
      ao += texture2D(tAO, vUv - vec2(0.0, aoTexel.y)).r * 0.15;
      c *= ao;
    }
    if (bloomStrength > 0.0) c += texture2D(tBloom, vUv).rgb * bloomStrength;
    vec2 q = vUv - 0.5;
    if (look > 0.0) {
      // the grade, worked out on the picture as the eye sees it (not on raw light): a gentle S-curve for contrast,
      // a touch more colour, highlights leaning warm and shadows leaning cool
      vec3 g = pow(max(c, 0.0), vec3(1.0 / 2.2));
      float l = dot(g, vec3(0.299, 0.587, 0.114));
      g = mix(g, g * g * (3.0 - 2.0 * g), 0.22 * look);
      g = mix(vec3(dot(g, vec3(0.299, 0.587, 0.114))), g, 1.0 + 0.1 * look);
      g += (vec3(0.012, 0.004, -0.014) * smoothstep(0.45, 1.0, l) + vec3(-0.008, 0.0, 0.012) * (1.0 - smoothstep(0.0, 0.4, l))) * look;
      // a soft vignette that falls away faster right in the corners
      float v = dot(q, q);
      g *= 1.0 - vignette * (v * 1.2 + v * v * 2.2);
      // a hair of dither (less than one step of brightness): stops dark walls breaking into bands. Not film grain.
      g += (hash12(gl_FragCoord.xy + fract(time) * 61.0) - 0.5) / 255.0;
      c = pow(clamp(g, 0.0, 1.0), vec3(2.2));
    } else c *= 1.0 - vignette * dot(q, q) * 1.6;
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;

// classic FXAA (simplified "FXAA 3.11 console" style)
const FXAA_FRAG = `
  uniform sampler2D tColor; uniform vec2 texel; varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  void main() {
    vec3 rgbNW = texture2D(tColor, vUv + vec2(-1.0, -1.0) * texel).rgb;
    vec3 rgbNE = texture2D(tColor, vUv + vec2(1.0, -1.0) * texel).rgb;
    vec3 rgbSW = texture2D(tColor, vUv + vec2(-1.0, 1.0) * texel).rgb;
    vec3 rgbSE = texture2D(tColor, vUv + vec2(1.0, 1.0) * texel).rgb;
    vec3 rgbM = texture2D(tColor, vUv).rgb;
    float lNW = luma(rgbNW), lNE = luma(rgbNE), lSW = luma(rgbSW), lSE = luma(rgbSE), lM = luma(rgbM);
    float lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
    float lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
    vec2 dir = vec2(-((lNW + lNE) - (lSW + lSE)), ((lNW + lSW) - (lNE + lSE)));
    float red = max((lNW + lNE + lSW + lSE) * 0.03125, 1.0 / 128.0);
    float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
    dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * texel;
    vec3 a = 0.5 * (texture2D(tColor, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(tColor, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
    vec3 b = a * 0.5 + 0.25 * (texture2D(tColor, vUv + dir * -0.5).rgb + texture2D(tColor, vUv + dir * 0.5).rgb);
    float lB = luma(b);
    gl_FragColor = vec4((lB < lMin || lB > lMax) ? a : b, 1.0);
    #include <colorspace_fragment>
  }`;

export class PostFX {
  // opts: { ao, bloom, fxaa, msaa, look }
  constructor(renderer, opts) {
    this.r = renderer;
    this.o = opts;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    const mat = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    this.aoMat = mat(AO_FRAG, { tDepth: { value: null }, texel: { value: new THREE.Vector2() }, near: { value: 0.05 }, far: { value: 300 }, projScale: { value: 1 }, radius: { value: 0.55 }, strength: { value: 0.75 } });
    this.brightMat = mat(BRIGHT_FRAG, { tColor: { value: null }, threshold: { value: 0.78 } });
    this.blurMat = mat(BLUR_FRAG, { tColor: { value: null }, dir: { value: new THREE.Vector2() } });
    this.compMat = mat(COMPOSITE_FRAG, {
      tColor: { value: null }, tAO: { value: null }, tBloom: { value: null }, useAO: { value: 0 }, bloomStrength: { value: 0 },
      vignette: { value: 0.35 }, aoTexel: { value: new THREE.Vector2() },
      look: { value: opts.look ? 1 : 0 }, time: { value: 0 }, texel: { value: new THREE.Vector2() },
    });
    this.fxaaMat = mat(FXAA_FRAG, { tColor: { value: null }, texel: { value: new THREE.Vector2() } });
    this.targets = [];
  }

  makeTarget(w, h, extra = {}) {
    const t = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, ...extra });
    this.targets.push(t);
    return t;
  }

  setSize(w, h) {
    for (const t of this.targets) t.dispose();
    this.targets = [];
    this.w = w; this.h = h;
    const o = this.o;
    // the picture is kept with sRGB steps (fine in the dark), not plain 8-bit linear: that had only a few steps
    // near black, so dark areas came out in hard bands and dark yellow broke up into red streaks
    const fine = { colorSpace: THREE.SRGBColorSpace };
    this.sceneRT = this.makeTarget(w, h, {
      ...fine,
      depthBuffer: true,
      depthTexture: o.ao ? new THREE.DepthTexture(w, h) : null,
      samples: o.msaa ? 4 : 0,
    });
    if (o.ao) this.aoRT = this.makeTarget(w >> 1, h >> 1);
    if (o.bloom) {
      this.bloomA = this.makeTarget(w >> 2, h >> 2);
      this.bloomB = this.makeTarget(w >> 2, h >> 2);
    }
    if (o.fxaa) this.ldrRT = this.makeTarget(w, h, fine);
  }

  pass(material, target) {
    this.quad.material = material;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  // draws the world through the effects to the screen
  render(scene, camera) {
    const r = this.r, o = this.o;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    if (size.x !== this.w || size.y !== this.h) this.setSize(size.x, size.y);
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);
    if (o.ao) {
      const u = this.aoMat.uniforms;
      u.tDepth.value = this.sceneRT.depthTexture;
      u.texel.value.set(1 / this.w, 1 / this.h);
      u.near.value = camera.near; u.far.value = camera.far;
      u.projScale.value = camera.projectionMatrix.elements[5] * 0.5;
      this.pass(this.aoMat, this.aoRT);
    }
    if (o.bloom) {
      this.brightMat.uniforms.tColor.value = this.sceneRT.texture;
      this.pass(this.brightMat, this.bloomA);
      const bu = this.blurMat.uniforms;
      for (let i = 0; i < (o.look ? 3 : 2); i++) {         // (with the look shaders: one more, wider round, so lights glow softer)
        bu.tColor.value = this.bloomA.texture; bu.dir.value.set(4 / this.w * (i + 1), 0); this.pass(this.blurMat, this.bloomB);
        bu.tColor.value = this.bloomB.texture; bu.dir.value.set(0, 4 / this.h * (i + 1)); this.pass(this.blurMat, this.bloomA);
      }
    }
    const cu = this.compMat.uniforms;
    cu.tColor.value = this.sceneRT.texture;
    cu.tAO.value = o.ao ? this.aoRT.texture : null;
    cu.useAO.value = o.ao ? 1 : 0;
    cu.aoTexel.value.set(2 / this.w, 2 / this.h);
    cu.tBloom.value = o.bloom ? this.bloomA.texture : null;
    cu.bloomStrength.value = o.bloom ? 0.55 : 0;
    cu.texel.value.set(1 / this.w, 1 / this.h);
    cu.time.value = (cu.time.value + 0.137) % 1000;
    if (o.fxaa) {
      this.pass(this.compMat, this.ldrRT);
      this.fxaaMat.uniforms.tColor.value = this.ldrRT.texture;
      this.fxaaMat.uniforms.texel.value.set(1 / this.w, 1 / this.h);
      this.pass(this.fxaaMat, null);
    } else this.pass(this.compMat, null);
    r.setRenderTarget(null);
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    for (const m of [this.aoMat, this.brightMat, this.blurMat, this.compMat, this.fxaaMat]) m.dispose();
    this.quad.geometry.dispose();
  }
}
