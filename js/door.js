/* =============================================================================
   door.js — 「扉」の WebGL2 シーン（依存ゼロ）

   ロゴの E は扉の枠、d には扉。マスコットも扉。
   このLPの主役はその「扉」で、FV では筋ガラスの扉の向こうに現地の映像が見え、
   スクロールで扉を押し開けて向こう側へ歩いていく。最終CTAで扉がもう一度現れる。

   技法（alche.studio の解析 TECH_REPORT.md から持ち帰ったもの）
     1. 背景スナップショット取り込み … ガラスより先に描いた画面を縮小コピーし、
        ガラスはそれを法線でずらして読む（物理屈折は計算しない）
     2. R/G/B 別のずらし量 = 分散（プリズムの虹。プライドフラッグへの目配せ）
     3. 乱数ジッタ × 8 サンプル = すりガラス
     4. GGX ハイライト + Schlick フレネル
   このLP独自の追加
     5. 筋ガラス（縦の溝）。法線を溝ごとに揺らすので、閉じていても虹の縦縞が走る
     6. ステンシルによる「扉の向こう」の映像（枠の内側だけに世界がある）
     7. 扉の開き・カメラのドリー・視線の追従を、バネと半減期でつなぐ

   描画順（毎フレーム）
     A_ms: 虚空 → 開口ステンシル → 映像 → 枠・ノブ → 粒子
     A_ms → A_res（解決） → B（縮小コピー＝背景スナップショット）
     A_ms: ガラス（B を読む）
     A_ms → A_res → 画面（粒子・ビネット）
   ============================================================================= */

import {
  createProgram, createMesh, drawMesh, createMsaaTarget, createTexTarget,
  createVideoTexture, FULLSCREEN_VS,
} from './lib/gl.js?v=2026091196';
import * as M from './lib/mat4.js?v=2026091196';
import { Spring, expSmooth, safeDt } from './lib/spring.js?v=2026091196';
import { chamferBox, sphere, cylinder, merge, plane } from './lib/geom.js?v=2026091196';

// ---------------------------------------------------------------------------
// 寸法・色（1 単位 ≒ 50cm。扉は 1m × 2.1m）
// ---------------------------------------------------------------------------
// 両開き。DOOR_W は開口の全幅で、扉は LEAF_W の板が左右から閉じる
const DOOR_W = 4.0;
const DOOR_H = 4.2;
const FRAME_T = 0.18;
const FRAME_D = 0.36;
const CHAMFER = 0.028;
const PANEL_GAP = 0.02;
const PANEL_W = DOOR_W / 2 - PANEL_GAP * 1.5;   // 1枚ぶん
const PANEL_H = DOOR_H - PANEL_GAP * 2;
const PANEL_D = 0.07;
const STILE = 0.12;
const RAIL_TOP = 0.12;
const RAIL_BOTTOM = 0.30;
const VIDEO_Z = -1.7;
const FLOOR_Y = -DOOR_H / 2 - 0.09;
const FOV = 30 * M.DEG;
const MAX_DPR = 1.75;
const MSAA = 4;
const BACKDROP = 640;
const PARTICLES = 220;

const CREAM = [0.961, 0.937, 0.902];
const CREAM_DIM = [0.88, 0.85, 0.80];
const CREAM_BACK = [0.72, 0.68, 0.63];
const WINE = [0.333, 0.086, 0.122];
const WINE_DEEP = [0.20, 0.05, 0.07];
const YELLOW = [1.0, 0.847, 0.243];
const YELLOW_DIM = [0.85, 0.68, 0.16];

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------
const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
layout(location=2) in vec3 aColor;
layout(location=3) in vec2 aUv;
uniform mat4 uProj, uView, uModel;
uniform mat3 uNormalMat;   // view * model の回転部
out vec3 vNormal;          // ビュー空間
out vec3 vViewPos;         // ビュー空間
out vec3 vColor;
out vec2 vUv;
out vec3 vLocal;
out vec3 vLocalNormal;
out vec3 vWorld;
void main(){
  vec4 wp = uModel * vec4(aPos, 1.0);
  vec4 vp = uView * wp;
  vViewPos = vp.xyz;
  vWorld = wp.xyz;
  vNormal = normalize(uNormalMat * aNormal);
  vColor = aColor;
  vUv = aUv;
  vLocal = aPos;
  vLocalNormal = aNormal;
  gl_Position = uProj * vp;
}`;

// 枠・ノブ・床用（頂点色 × 簡易ライティング）
const LIT_FS = `#version 300 es
precision highp float;
in vec3 vNormal; in vec3 vViewPos; in vec3 vColor; in vec2 vUv; in vec3 vWorld;
uniform float uWarm;     // 開口からの暖色の回り込み 0-1
uniform vec3 uKeyDir;    // ビュー空間
uniform float uReflect;  // 0 = 本体 / >0 = 床の映り込み（強さ）
uniform float uFloorY;
out vec4 o;
void main(){
  float a = 1.0;
  if (uReflect > 0.0) {
    // 鏡像は床より下にある。床から離れるほど薄く
    a = uReflect * (1.0 - smoothstep(0.0, 2.4, uFloorY - vWorld.y));
  }
  vec3 N = normalize(vNormal);
  vec3 V = normalize(-vViewPos);
  vec3 L = normalize(uKeyDir);
  float diff = max(dot(N, L), 0.0);
  float amb = 0.40;
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 56.0) * 0.22;
  // 扉の奥（-z）から暖かい光が回り込む。開くほど強い
  vec3 warmL = normalize(vec3(0.15, -0.2, -1.0));
  float warm = max(dot(N, warmL), 0.0) * uWarm * 0.55;
  vec3 col = vColor * (amb + diff * 0.66) + rim * vec3(0.98, 0.93, 0.86) * 0.28 + spec;
  col += vec3(1.0, 0.82, 0.55) * warm * vColor;
  o = vec4(col * a, a);   // 事前乗算（ONE, ONE_MINUS_SRC_ALPHA で合成）
}`;

// 開口の向こうの映像（ステンシルで開口の内側だけ）
const VIDEO_FS = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vViewPos;
uniform sampler2D uVideo;
uniform float uDim;
out vec4 o;
void main(){
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec3 c = texture(uVideo, uv).rgb;
  // 縁を少し落として奥行きを出す
  vec2 d = abs(vUv - 0.5) * 2.0;
  float vig = 1.0 - smoothstep(0.55, 1.15, length(d)) * 0.55;
  o = vec4(c * vig * uDim, 1.0);
}`;

// 虚空（画面全体・最初に描く）
const VOID_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform vec2 uRes;
uniform vec2 uDoor;      // 扉中心の NDC → 0-1
uniform float uGlow;     // 扉から漏れる光
uniform float uTime;
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 p = (uv - uDoor) * vec2(aspect, 1.0);
  vec3 deep = vec3(0.102, 0.020, 0.031);   // #1A0508
  vec3 mid  = vec3(0.228, 0.059, 0.082);   // #3A0F15
  float r = length(p);
  vec3 col = mix(mid, deep, smoothstep(0.15, 1.05, r));
  // 扉の背後から漏れる暖かい光（開くほど強い）
  float glow = exp(-r * r * 3.2) * (0.16 + uGlow * 0.55);
  col += vec3(0.95, 0.68, 0.36) * glow * 0.42;
  // 床の水平線（扉の足元）にごく淡い明るさ
  float floorY = uDoor.y - 0.30;
  float horizon = exp(-abs(uv.y - floorY) * 26.0) * 0.045 * (0.5 + uGlow);
  col += vec3(0.9, 0.7, 0.55) * horizon;
  // ディザ（バンディング防止）
  col += (hash(gl_FragCoord.xy + uTime) - 0.5) / 255.0 * 2.0;
  o = vec4(col, 1.0);
}`;

// 浮遊粒子
const PART_VS = `#version 300 es
layout(location=0) in vec4 aSeed;   // x,y,z, phase
uniform mat4 uProj, uView;
uniform float uTime;
uniform float uDpr;
uniform float uMotion;
out float vA;
void main(){
  float ph = aSeed.w * 6.2831;
  vec3 p = aSeed.xyz;
  p.y += sin(uTime * 0.18 + ph) * 0.22 * uMotion + uTime * 0.03 * uMotion;
  p.y = mod(p.y + 3.5, 7.0) - 3.5;
  p.x += cos(uTime * 0.13 + ph * 1.7) * 0.18 * uMotion;
  vec4 vp = uView * vec4(p, 1.0);
  gl_Position = uProj * vp;
  float dist = -vp.z;
  gl_PointSize = clamp((2.6 + fract(aSeed.w * 7.0) * 2.4) * uDpr * 6.0 / max(dist, 1.0), 1.0, 9.0 * uDpr);
  vA = smoothstep(0.0, 1.5, dist) * (1.0 - smoothstep(9.0, 16.0, dist));
  vA *= 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 0.7 + ph * 3.0));
}`;
const PART_FS = `#version 300 es
precision highp float;
in float vA;
out vec4 o;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = (1.0 - smoothstep(0.35, 1.0, d)) * vA * 0.55;
  o = vec4(vec3(0.99, 0.92, 0.80) * a, a);
}`;

// ★ 筋ガラス。背景スナップショットを法線でずらして読む
const GLASS_FS = `#version 300 es
precision highp float;
in vec3 vNormal; in vec3 vViewPos; in vec3 vColor; in vec2 vUv; in vec3 vLocal; in vec3 vLocalNormal;
uniform sampler2D uBackdrop;
uniform vec2 uRes;
uniform mat3 uNormalMat;
uniform float uFlute;     // 溝の幅（ローカル単位）
uniform float uReedK;     // 溝の丸み（法線の傾き）
uniform float uRefract;   // ずらし量
uniform float uDisp;      // 分散
uniform float uRough;     // すりガラス
uniform vec3  uTint;
uniform float uSeed;
out vec4 o;
#define SAMPLES 8
#define PI 3.14159265359
float random(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float ggx(float dNH, float r){
  float a2 = r * r; a2 *= a2;
  float d2 = dNH * dNH;
  if (d2 <= 0.0) return 0.0;
  return a2 / (PI * pow(d2 * (a2 - 1.0) + 1.0, 2.0));
}
float fresnel(float d){ float f0 = 0.06; return f0 + (1.0 - f0) * pow(1.0 - d, 5.0); }
void main(){
  vec2 scr = gl_FragCoord.xy / uRes;
  // 溝: パネルのローカル x で周期的に法線を傾ける（前後の面だけ。面取りは元の法線）
  float fx = vLocal.x / uFlute;
  float f = fract(fx) * 2.0 - 1.0;
  float faceMix = smoothstep(0.6, 0.95, abs(vLocalNormal.z));
  vec3 reed = normalize(vec3(f * uReedK, 0.0, 1.0)) * sign(vLocalNormal.z + 1e-4);
  vec3 nLocal = normalize(mix(vLocalNormal, reed, faceMix));
  vec3 N = normalize(uNormalMat * nLocal);
  // 屈折方向: 法線の画面成分。正面を向くほど弱める（厚みの擬似表現）
  vec2 refr = N.xy * (1.0 - abs(N.z) * 0.7);
  vec3 col = vec3(0.0);
  for (int i = 0; i < SAMPLES; i++){
    float fi = float(i);
    float slide = 0.6 + random(scr + fi * 0.2 + uSeed) * 0.8;
    vec2 jitter = (vec2(random(scr + fi * 0.1 + uSeed), random(scr + fi * 0.3 + uSeed)) - 0.5) * uRough;
    vec2 base = scr + jitter - refr * uRefract;
    vec2 uvR = base - refr * uDisp * slide * 1.0;
    vec2 uvG = base - refr * uDisp * slide * 2.0;
    vec2 uvB = base - refr * uDisp * slide * 4.0;
    col += vec3(texture(uBackdrop, uvR).r, texture(uBackdrop, uvG).g, texture(uBackdrop, uvB).b);
  }
  col /= float(SAMPLES);
  // ハイライト（溝に沿って縦に走る）＋ フレネルで環境を少し混ぜる
  vec3 V = normalize(-vViewPos);
  vec3 L = normalize(vec3(-0.55, 0.85, 0.95));
  vec3 H = normalize(L + V);
  float spec = ggx(max(dot(N, H), 0.0), 0.10) * 0.55;
  vec3 L2 = normalize(vec3(0.7, 0.3, 0.9));
  vec3 H2 = normalize(L2 + V);
  spec += ggx(max(dot(N, H2), 0.0), 0.16) * 0.18;
  float F = fresnel(max(dot(V, N), 0.0));
  vec3 R = reflect(-V, N);
  vec3 env = mix(vec3(0.30, 0.09, 0.12), vec3(0.98, 0.95, 0.90), smoothstep(-0.3, 0.9, R.y));
  col = col * (1.0 - F * 0.55) + env * F * 0.45 + vec3(spec);
  col *= uTint;
  o = vec4(col, 1.0);
}`;

// 開口ステンシル用（色を書かない）
const FLAT_FS = `#version 300 es
precision highp float;
out vec4 o;
void main(){ o = vec4(0.0); }`;

// 最終合成（粒子・ビネット）
const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uTime;
uniform float uFade;   // 1 = 真っ暗
out vec4 o;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  // 背景は CSS の写真に任せるので、描いていないところは透過のまま返す。
  // ここで alpha を 1 に固定すると、canvas が全面を塗って写真が隠れる。
  vec4 s = texture(uScene, vUv);
  vec3 c = s.rgb;
  vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  float vig = 1.0 - smoothstep(0.55, 1.35, length(d)) * 0.42;
  float g = (hash(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * 0.045;
  c = c * vig + g * s.a;          // 粒子は描いたところにだけ乗せる
  float k = 1.0 - uFade;
  o = vec4(c * k, s.a * k);       // premultipliedAlpha なので色も alpha も同じだけ落とす
}`;

// ---------------------------------------------------------------------------
// ジオメトリ
// ---------------------------------------------------------------------------
function buildFrame() {
  const col = { front: CREAM, back: CREAM_BACK, side: WINE, bevel: CREAM_DIM };
  const jambX = DOOR_W / 2 + FRAME_T / 2;
  const parts = [
    chamferBox(FRAME_T, DOOR_H, FRAME_D, CHAMFER, col, [-jambX, 0, 0]),
    chamferBox(FRAME_T, DOOR_H, FRAME_D, CHAMFER, col, [jambX, 0, 0]),
    chamferBox(DOOR_W + FRAME_T * 2, FRAME_T, FRAME_D, CHAMFER, col, [0, DOOR_H / 2 + FRAME_T / 2, 0]),
    // 敷居（一段。少し手前に出す）
    chamferBox(DOOR_W + FRAME_T * 2 + 0.36, 0.09, FRAME_D + 0.42, 0.02,
      { front: WINE, back: WINE_DEEP, side: WINE_DEEP, bevel: WINE }, [0, -DOOR_H / 2 - 0.045, 0.06]),
  ];
  return merge(parts);
}

function buildPanelFrame() {
  // 蝶番をローカル x=0 に置く（左端）。回転はモデル行列で
  const col = { front: CREAM, back: CREAM_BACK, side: CREAM_DIM, bevel: CREAM_DIM };
  const cx = PANEL_W / 2;
  const parts = [
    chamferBox(STILE, PANEL_H, PANEL_D, 0.016, col, [STILE / 2, 0, 0]),
    chamferBox(STILE, PANEL_H, PANEL_D, 0.016, col, [PANEL_W - STILE / 2, 0, 0]),
    chamferBox(PANEL_W - STILE * 2, RAIL_TOP, PANEL_D, 0.016, col, [cx, PANEL_H / 2 - RAIL_TOP / 2, 0]),
    chamferBox(PANEL_W - STILE * 2, RAIL_BOTTOM, PANEL_D, 0.016, col, [cx, -PANEL_H / 2 + RAIL_BOTTOM / 2, 0]),
  ];
  // ノブ（黄）: 右のスタイルに。球＋短い軸
  // ノブは合わせ目（自由端）側。両開きなので中央で向かい合う
  const kx = PANEL_W - STILE / 2 - 0.02, ky = -0.28;
  parts.push(sphere(0.085, 22, 14, YELLOW, [kx, ky, PANEL_D / 2 + 0.11]));
  const shaft = cylinder(0.032, 0.12, 16, YELLOW_DIM);
  // Y軸円柱を Z軸向きに（y↔z 入れ替え）
  for (let i = 0; i < shaft.positions.length; i += 3) {
    const y = shaft.positions[i + 1], z = shaft.positions[i + 2];
    shaft.positions[i] += kx; shaft.positions[i + 1] = z + ky; shaft.positions[i + 2] = y + PANEL_D / 2 + 0.05;
    const ny = shaft.normals[i + 1], nz = shaft.normals[i + 2];
    shaft.normals[i + 1] = nz; shaft.normals[i + 2] = ny;
  }
  parts.push(shaft);
  return merge(parts);
}

function buildPanelGlass() {
  const gw = PANEL_W - STILE * 2 + 0.02;
  const gh = PANEL_H - RAIL_TOP - RAIL_BOTTOM + 0.02;
  const gy = (RAIL_BOTTOM - RAIL_TOP) / 2;
  const col = { front: CREAM, back: CREAM, side: CREAM, bevel: CREAM };
  return chamferBox(gw, gh, 0.05, 0.03, col, [PANEL_W / 2, gy, 0]);
}

function buildParticles() {
  const a = new Float32Array(PARTICLES * 4);
  let s = 1234567;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let i = 0; i < PARTICLES; i++) {
    a[i * 4] = (rnd() - 0.5) * 13;
    a[i * 4 + 1] = (rnd() - 0.5) * 7;
    a[i * 4 + 2] = (rnd() - 0.6) * 9;
    a[i * 4 + 3] = rnd();
  }
  return a;
}

// ---------------------------------------------------------------------------
// シーン
// ---------------------------------------------------------------------------
export function createDoorScene({ canvas, video, poster, reduceMotion = false }) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: true, depth: true, stencil: true, premultipliedAlpha: true,
    premultipliedAlpha: false, powerPreference: 'high-performance',
  });
  if (!gl) return null;

  const progs = {
    lit: createProgram(gl, MESH_VS, LIT_FS, 'lit'),
    video: createProgram(gl, MESH_VS, VIDEO_FS, 'video'),
    flat: createProgram(gl, MESH_VS, FLAT_FS, 'flat'),
    glass: createProgram(gl, MESH_VS, GLASS_FS, 'glass'),
    void: createProgram(gl, FULLSCREEN_VS, VOID_FS, 'void'),
    comp: createProgram(gl, FULLSCREEN_VS, COMPOSITE_FS, 'composite'),
    part: createProgram(gl, PART_VS, PART_FS, 'particles'),
  };

  const meshes = {
    frame: createMesh(gl, buildFrame()),
    panelFrame: createMesh(gl, buildPanelFrame()),
    panelGlass: createMesh(gl, buildPanelGlass()),
    opening: createMesh(gl, plane(DOOR_W, DOOR_H, CREAM, [0, 0, 0])),
    videoPlane: createMesh(gl, plane(16, 9, CREAM, [0, 0.35, VIDEO_Z])),
  };

  // 粒子 VAO
  const partVao = gl.createVertexArray();
  gl.bindVertexArray(partVao);
  const partBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, partBuf);
  gl.bufferData(gl.ARRAY_BUFFER, buildParticles(), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
  gl.bindVertexArray(null);

  const fsVao = gl.createVertexArray();

  // 映像テクスチャ（先にポスターを入れておく。動画が来るまで黒にしない）
  const videoTex = createVideoTexture(gl);
  let videoReady = false;
  let lastVideoTime = -1;
  if (poster) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (videoReady) return;
      gl.bindTexture(gl.TEXTURE_2D, videoTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      gl.bindTexture(gl.TEXTURE_2D, null);
      needsFrame = true;
    };
    img.src = poster;
  }

  // 描画先
  let msaa = null, resolved = null, backdrop = null;
  let W = 1, H = 1, dpr = 1;

  const proj = new Float32Array(16);
  const view = new Float32Array(16);
  const model = new Float32Array(16);
  const nmat = new Float32Array(9);
  const tmpA = new Float32Array(16);
  const tmpB = new Float32Array(16);
  const mirrorM = new Float32Array(16);

  // ---- 状態 ----
  const state = {
    mode: 'fv',          // 'fv' | 'final'
    pTarget: 0, p: 0,    // スクロール進捗（FV）
    pointer: [0, 0],     // -1..1
    pointerOn: false,
    active: false,
    time: 0,
    motion: reduceMotion ? 0 : 1,
    fade: 1,             // 1 = 暗幕
    introK: 0,
    layout: 'pc',
  };
  const springs = {
    yaw: Spring.fromFeel({ settle: 0.9, overshoot: 0.02 }),
    pitch: Spring.fromFeel({ settle: 0.9, overshoot: 0.02 }),
    hover: Spring.fromFeel({ settle: 0.8, overshoot: 0.06 }),   // 扉のホバー押し
    intro: Spring.fromFeel({ settle: 1.6, overshoot: 0.10 }),
    fade: Spring.fromFeel({ settle: 1.2, overshoot: 0 }),
    modeD: Spring.fromFeel({ settle: 1.3, overshoot: 0.02 }),   // 'final' の距離
    modeOpen: Spring.fromFeel({ settle: 1.4, overshoot: 0.05 }),
  };
  springs.fade.snap(1);
  let needsFrame = true;
  let raf = 0;
  let lastNow = 0;

  // 扉が画面のどこに来るか（NDC）。SP は中央下、PC は右寄り
  function layoutTargets() {
    // 見出しを外して扉を全幅にしたので、画面の中央に据える。
    // （以前は左に見出し、右に扉という配置だったので右へ寄せていた）
    const aspect = W / H;
    if (aspect < 0.9) return { ndcX: 0.0, ndcY: -0.03, fit: 0.52 };
    if (aspect < 1.3) return { ndcX: 0.0, ndcY: -0.02, fit: 0.56 };
    return { ndcX: 0.0, ndcY: -0.02, fit: 0.60 };
  }

  function resize() {
    const cw = canvas.clientWidth || window.innerWidth;
    const ch = canvas.clientHeight || window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    if (w === W && h === H && msaa) return;
    W = w; H = h;
    canvas.width = W; canvas.height = H;
    if (msaa) { msaa.dispose(); resolved.dispose(); backdrop.dispose(); }
    msaa = createMsaaTarget(gl, W, H, MSAA);
    resolved = createTexTarget(gl, W, H);
    backdrop = createTexTarget(gl, BACKDROP, Math.round(BACKDROP * H / W));
    state.layout = W / H < 0.9 ? 'sp' : 'pc';
    needsFrame = true;
  }

  // ---- カメラ ----
  const cam = { eye: [0, 0, 10], target: [0, 0, 0], d: 10 };

  function baseDistance(fit) {
    // 扉の高さ（枠込み）が画面高の fit 割になる距離
    const totalH = DOOR_H + FRAME_T + 0.1;
    const aspect = W / H;
    let d = totalH / (2 * fit * Math.tan(FOV / 2));
    // 横は画面いっぱいにはしない。両端に余白を残して収める
    const totalW = DOOR_W + FRAME_T * 2;
    const dW = totalW / (2 * 0.80 * Math.tan(FOV / 2) * aspect);
    return Math.max(d, dW);
  }

  function updateCamera(dt) {
    const L = layoutTargets();
    const d0 = baseDistance(L.fit);
    const p = state.p;
    const s = M.smoothstep;

    // ---- 進捗 → 開き角・距離・横ずれ ----
    let openDeg, d, ndcX, ndcY, hoverK, warm;
    if (state.mode === 'final') {
      // 最終CTA: 文字は上半分、扉は足元（下半分・敷居は画面の下に少し切れる）
      springs.modeD.setTarget(baseDistance(state.layout === 'sp' ? 0.56 : 0.66));
      springs.modeOpen.setTarget(58);
      hoverK = 1; ndcX = 0; ndcY = state.layout === 'sp' ? -0.62 : -0.58;
      openDeg = springs.modeOpen.step(dt);
      d = springs.modeD.step(dt);
      warm = 1;
    } else {
      const k = s(0.06, 0.52, p);
      openDeg = M.lerp(9, 106, k);
      const dk = s(0.18, 0.96, p);
      // 歩き出しはゆっくり、途中から一定速で近づく
      const walk = dk * dk * (3 - 2 * dk) * 0.35 + dk * 0.65;
      d = M.lerp(d0, 0.32, walk);
      const cK = s(0.12, 0.62, p);
      ndcX = L.ndcX * (1 - cK);
      ndcY = L.ndcY * (1 - cK) + 0.02 * cK;
      hoverK = 1 - s(0.0, 0.35, p);
      warm = k;
      springs.modeD.snap(d);
      springs.modeOpen.snap(openDeg);
    }

    // ---- イントロ（幕が開くときに扉が閉→少し開く／カメラが寄る）----
    const intro = springs.intro.step(dt);
    const introEase = M.clamp(intro, 0, 1.2);
    d = M.lerp(d * 1.16, d, Math.min(1, introEase));
    openDeg = openDeg * Math.min(1.25, Math.max(0, intro));

    // ---- 視線（ポインタ）----
    const px = state.pointerOn ? state.pointer[0] : 0;
    const py = state.pointerOn ? state.pointer[1] : 0;
    springs.yaw.setTarget(px * 6.5 * M.DEG * hoverK * state.motion);
    springs.pitch.setTarget(py * 3.2 * M.DEG * hoverK * state.motion);
    springs.hover.setTarget((px > 0.15 ? (px - 0.15) : 0) * 7 * hoverK * state.motion);
    const yaw = springs.yaw.step(dt);
    const pitch = springs.pitch.step(dt);
    const hover = springs.hover.step(dt);
    const idle = state.motion * Math.sin(state.time * 0.55) * 0.9 * hoverK;
    const open = (openDeg + hover + idle) * M.DEG;

    // ---- カメラ位置 ----
    const visH = 2 * d * Math.tan(FOV / 2);
    const visW = visH * (W / H);
    const sx = -ndcX * visW / 2;
    const sy = -ndcY * visH / 2;
    const ex = Math.sin(yaw) * Math.cos(pitch) * d;
    const ey = Math.sin(pitch) * d;
    const ez = Math.cos(yaw) * Math.cos(pitch) * d;
    cam.eye = [ex + sx, ey + sy, ez];
    cam.target = [sx, sy, 0];
    cam.d = d;
    M.lookAt(cam.eye, cam.target, [0, 1, 0], view);
    M.perspective(FOV, W / H, 0.05, 60, proj);

    return { open, openK: M.clamp((openDeg - 9) / 97, 0, 1), warm, d, ndcX, ndcY };
  }

  // ---- uniform 補助 ----
  function useMesh(prog, modelMat) {
    gl.useProgram(prog.prog);
    gl.uniformMatrix4fv(prog.uniforms.uProj, false, proj);
    gl.uniformMatrix4fv(prog.uniforms.uView, false, view);
    gl.uniformMatrix4fv(prog.uniforms.uModel, false, modelMat);
    M.multiply(view, modelMat, tmpA);
    M.normalMat3(tmpA, nmat);
    if (prog.uniforms.uNormalMat) gl.uniformMatrix3fv(prog.uniforms.uNormalMat, false, nmat);
  }

  function uploadVideo() {
    if (!video || video.readyState < 2) return;
    if (video.currentTime === lastVideoTime && videoReady) return;
    lastVideoTime = video.currentTime;
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);
      videoReady = true;
    } catch (e) { /* まだデコードされていないフレーム。次で拾う */ }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ---- 描画 ----
  const KEY_DIR = [-0.45, 0.75, 0.9];

  function render(dt) {
    const c = updateCamera(dt);
    uploadVideo();

    // 扉パネルのモデル行列。両開きなので2枚。
    //   左: 左の戸当たりを蝶番に +open
    //   右: 右の戸当たりを蝶番に -open（鏡像なので X を反転してから同じ板を使う）
    M.translation(-DOOR_W / 2 + PANEL_GAP, 0, 0, tmpB);
    M.rotationY(c.open, tmpA);
    const leafL = M.multiply(tmpB, tmpA, new Float32Array(16));

    M.translation(DOOR_W / 2 - PANEL_GAP, 0, 0, tmpB);
    M.rotationY(-c.open, tmpA);
    const leafR = M.multiply(tmpB, tmpA, new Float32Array(16));
    // X 反転（右の板は左右対称）
    const flip = new Float32Array(16); M.identity(flip); flip[0] = -1;
    M.multiply(leafR, flip, leafR);

    const panelModel = leafL;   // 既存の呼び出し互換（左板）
    M.identity(model);

    // ===== Pass 1: 不透明なもの → A_ms =====
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaa.fb);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.disable(gl.STENCIL_TEST);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 0);   // 背景は CSS の写真に任せる
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    // 虚空
    // 虚空の塗りは描かない。背景は CSS の写真に任せ、canvas は透過のままにする。
    // （扉の位置は下の粒子でも使うので計算だけ残す）
    const doorNdc = M.transformPoint(M.multiply(proj, view, tmpA), [0, 0, 0]);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // 開口をステンシルに書く（色・深度は書かない）
    gl.enable(gl.STENCIL_TEST);
    gl.stencilFunc(gl.ALWAYS, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
    gl.colorMask(false, false, false, false);
    gl.depthMask(false);
    useMesh(progs.flat, model);
    drawMesh(gl, meshes.opening);
    gl.colorMask(true, true, true, true);
    gl.depthMask(true);

    // 開口の向こうの映像。板は「いまのカメラから画面を覆う大きさ」に毎フレーム合わせる。
    // こうすると映像は常に画面いっぱいの構図で固定され、扉の開口だけが近づくにつれ広がる。
    // 通り抜けた瞬間に、開口の中身がそのまま全画面の映像になる。
    gl.stencilFunc(gl.EQUAL, 1, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    {
      const dist = cam.eye[2] - VIDEO_Z;
      const visH = 2 * dist * Math.tan(FOV / 2) * 1.14;
      const visW = visH * (W / H);
      const sH = Math.max(visH / 9, visW / 16);   // cover
      M.scaling(sH, sH, sH, tmpB);
      // plane は z=VIDEO_Z を焼き込んであるので、スケール後も z=VIDEO_Z に戻す
      // （z を 1 倍にしたまま補正すると板が奥へ逃げて通り抜けの終わりで小さく見える。実測で踏んだ）
      tmpB[14] = VIDEO_Z * (1 - sH);
      // 画面中央（カメラの注視点）に合わせて横にずらす
      tmpB[12] = cam.target[0];
      tmpB[13] = cam.target[1] - 0.35 * sH;
      useMesh(progs.video, tmpB);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, videoTex);
    gl.uniform1i(progs.video.uniforms.uVideo, 0);
    gl.uniform1f(progs.video.uniforms.uDim, 0.92 + 0.08 * c.openK);
    drawMesh(gl, meshes.videoPlane);
    gl.disable(gl.STENCIL_TEST);

    // 枠
    useMesh(progs.lit, model);
    gl.uniform3fv(progs.lit.uniforms.uKeyDir, KEY_DIR);
    gl.uniform1f(progs.lit.uniforms.uWarm, c.openK);
    gl.uniform1f(progs.lit.uniforms.uReflect, 0);
    gl.uniform1f(progs.lit.uniforms.uFloorY, FLOOR_Y);
    drawMesh(gl, meshes.frame);
    // パネルの枠とノブ
    useMesh(progs.lit, panelModel);
    gl.uniform3fv(progs.lit.uniforms.uKeyDir, KEY_DIR);
    gl.uniform1f(progs.lit.uniforms.uWarm, c.openK);
    gl.uniform1f(progs.lit.uniforms.uReflect, 0);
    gl.uniform1f(progs.lit.uniforms.uFloorY, FLOOR_Y);
    drawMesh(gl, meshes.panelFrame);
    useMesh(progs.lit, leafR);
    gl.uniform3fv(progs.lit.uniforms.uKeyDir, KEY_DIR);
    gl.uniform1f(progs.lit.uniforms.uWarm, c.openK);
    gl.uniform1f(progs.lit.uniforms.uReflect, 0);
    gl.uniform1f(progs.lit.uniforms.uFloorY, FLOOR_Y);
    drawMesh(gl, meshes.panelFrame);

    // 床への映り込み（鏡像を薄く重ねる。ガラスは屈折が破綻するので枠とノブだけ）
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    M.identity(mirrorM);
    mirrorM[5] = -1; mirrorM[13] = 2 * FLOOR_Y;
    useMesh(progs.lit, mirrorM);
    gl.uniform3fv(progs.lit.uniforms.uKeyDir, KEY_DIR);
    gl.uniform1f(progs.lit.uniforms.uWarm, c.openK);
    gl.uniform1f(progs.lit.uniforms.uReflect, 0.16);
    gl.uniform1f(progs.lit.uniforms.uFloorY, FLOOR_Y);
    drawMesh(gl, meshes.frame);
    M.multiply(mirrorM, panelModel, tmpA);
    useMesh(progs.lit, tmpA);
    gl.uniform3fv(progs.lit.uniforms.uKeyDir, KEY_DIR);
    gl.uniform1f(progs.lit.uniforms.uWarm, c.openK);
    gl.uniform1f(progs.lit.uniforms.uReflect, 0.16);
    gl.uniform1f(progs.lit.uniforms.uFloorY, FLOOR_Y);
    drawMesh(gl, meshes.panelFrame);
    M.multiply(mirrorM, leafR, tmpA);
    useMesh(progs.lit, tmpA);
    gl.uniform3fv(progs.lit.uniforms.uKeyDir, KEY_DIR);
    gl.uniform1f(progs.lit.uniforms.uWarm, c.openK);
    gl.uniform1f(progs.lit.uniforms.uReflect, 0.16);
    gl.uniform1f(progs.lit.uniforms.uFloorY, FLOOR_Y);
    drawMesh(gl, meshes.panelFrame);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // 加算合成（粒子用）。色だけ足す。alpha まで足すと、背景の上に
    // 「色の無い不透明」が広がって黒い面になる
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
    gl.depthMask(false);

    // 粒子
    gl.useProgram(progs.part.prog);
    gl.uniformMatrix4fv(progs.part.uniforms.uProj, false, proj);
    gl.uniformMatrix4fv(progs.part.uniforms.uView, false, view);
    gl.uniform1f(progs.part.uniforms.uTime, state.time);
    gl.uniform1f(progs.part.uniforms.uDpr, dpr);
    gl.uniform1f(progs.part.uniforms.uMotion, state.motion);
    gl.bindVertexArray(partVao);
    gl.drawArrays(gl.POINTS, 0, PARTICLES);
    gl.bindVertexArray(null);
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    // ===== 解決 → 背景スナップショット =====
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaa.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolved.fb);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, resolved.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, backdrop.fb);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, backdrop.w, backdrop.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);

    // ===== Pass 2: ガラス → A_ms（深度は残っている）=====
    gl.bindFramebuffer(gl.FRAMEBUFFER, msaa.fb);
    useMesh(progs.glass, panelModel);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, backdrop.tex);
    const gu = progs.glass.uniforms;
    gl.uniform1i(gu.uBackdrop, 0);
    gl.uniform2f(gu.uRes, W, H);
    // 実物の筋ガラスに寄せる。縞は細かく浅く、虹は控えめに、曇りは強めに。
    // （縞を強く虹を派手にすると、絵に描いたガラスに見える）
    gl.uniform1f(gu.uFlute, 0.052);   // 溝の間隔（細かく）
    gl.uniform1f(gu.uReedK, 0.42);    // 溝の深さ（浅く）
    gl.uniform1f(gu.uRefract, 0.030);
    gl.uniform1f(gu.uDisp, 0.0026);   // 分散（虹）を抑える
    gl.uniform1f(gu.uRough, 0.042);   // すりガラス感
    gl.uniform3f(gu.uTint, 0.94, 0.955, 0.965);
    gl.uniform1f(gu.uSeed, 0.0);
    drawMesh(gl, meshes.panelGlass);
    // 右の板のガラス
    useMesh(progs.glass, leafR);
    gl.uniform1f(gu.uSeed, 0.37);
    drawMesh(gl, meshes.panelGlass);

    // ===== 解決 → 画面合成 =====
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, msaa.fb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, resolved.fb);
    gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(progs.comp.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, resolved.tex);
    gl.uniform1i(progs.comp.uniforms.uScene, 0);
    gl.uniform2f(progs.comp.uniforms.uRes, W, H);
    gl.uniform1f(progs.comp.uniforms.uTime, state.time);
    gl.uniform1f(progs.comp.uniforms.uFade, state.fade);
    gl.bindVertexArray(fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    return c;
  }

  // ---- ループ ----
  function tick(now) {
    raf = 0;
    if (!state.active) return;
    const dt = safeDt((now - (lastNow || now)) / 1000);
    lastNow = now;
    state.time += dt;
    state.p = expSmooth(state.p, state.pTarget, 0.055, dt);
    state.fade = springs.fade.step(dt);
    render(dt);
    raf = requestAnimationFrame(tick);
  }

  function start() {
    if (state.active) return;
    state.active = true;
    lastNow = 0;
    resize();
    raf = requestAnimationFrame(tick);
  }
  function stop() {
    state.active = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  resize();
  window.addEventListener('resize', () => { resize(); });

  return {
    gl,
    start, stop, resize,
    setProgress(p) { state.pTarget = M.clamp(p, 0, 1); },
    snapProgress(p) { state.pTarget = state.p = M.clamp(p, 0, 1); },
    setMode(m) { state.mode = m; },
    getMode() { return state.mode; },
    setPointer(x, y, on = true) { state.pointer[0] = M.clamp(x, -1, 1); state.pointer[1] = M.clamp(y, -1, 1); state.pointerOn = on; },
    /** 幕が開くとき。扉が閉じた状態から少し開き、カメラが寄る */
    intro() { springs.intro.snap(0); springs.intro.setTarget(1); springs.fade.setTarget(0); },
    fadeIn() { springs.fade.setTarget(0); },
    fadeOut() { springs.fade.setTarget(1); },
    setReduceMotion(v) { state.motion = v ? 0 : 1; },
    isActive() { return state.active; },
    dims() { return { W, H, dpr }; },
  };
}
