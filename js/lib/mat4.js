/* =============================================================================
   mat4.js — 依存ゼロの 4x4 行列 / クォータニオン / ベクトル
   列優先（WebGL の uniformMatrix4fv にそのまま渡せる）。
   すべて「新しい配列を返す」か「out を明示して書く」かのどちらか。引数は壊さない。
   ============================================================================= */

export const DEG = Math.PI / 180;

export function identity(out = new Float32Array(16)) {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

export function multiply(a, b, out = new Float32Array(16)) {
  // out = a * b
  const r = out === a || out === b ? new Float32Array(16) : out;
  for (let c = 0; c < 4; c++) {
    for (let rr = 0; rr < 4; rr++) {
      r[c * 4 + rr] =
        a[0 * 4 + rr] * b[c * 4 + 0] +
        a[1 * 4 + rr] * b[c * 4 + 1] +
        a[2 * 4 + rr] * b[c * 4 + 2] +
        a[3 * 4 + rr] * b[c * 4 + 3];
    }
  }
  if (r !== out) out.set(r);
  return out;
}

export function perspective(fovYRad, aspect, near, far, out = new Float32Array(16)) {
  const f = 1 / Math.tan(fovYRad / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

export function lookAt(eye, target, up, out = new Float32Array(16)) {
  const zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  let zl = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / zl, zy / zl, zz / zl];
  const x = cross(up, z);
  const xl = Math.hypot(x[0], x[1], x[2]) || 1;
  x[0] /= xl; x[1] /= xl; x[2] /= xl;
  const y = cross(z, x);
  out[0] = x[0]; out[1] = y[0]; out[2] = z[0]; out[3] = 0;
  out[4] = x[1]; out[5] = y[1]; out[6] = z[1]; out[7] = 0;
  out[8] = x[2]; out[9] = y[2]; out[10] = z[2]; out[11] = 0;
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  out[15] = 1;
  return out;
}

export function translation(x, y, z, out = new Float32Array(16)) {
  identity(out);
  out[12] = x; out[13] = y; out[14] = z;
  return out;
}

export function scaling(x, y, z, out = new Float32Array(16)) {
  identity(out);
  out[0] = x; out[5] = y; out[10] = z;
  return out;
}

export function rotationY(rad, out = new Float32Array(16)) {
  identity(out);
  const c = Math.cos(rad), s = Math.sin(rad);
  out[0] = c; out[2] = -s;
  out[8] = s; out[10] = c;
  return out;
}

export function rotationX(rad, out = new Float32Array(16)) {
  identity(out);
  const c = Math.cos(rad), s = Math.sin(rad);
  out[5] = c; out[6] = s;
  out[9] = -s; out[10] = c;
  return out;
}

/** 法線行列（回転＋一様スケールだけなら model の左上 3x3 で足りる） */
export function normalMat3(m, out = new Float32Array(9)) {
  out[0] = m[0]; out[1] = m[1]; out[2] = m[2];
  out[3] = m[4]; out[4] = m[5]; out[5] = m[6];
  out[6] = m[8]; out[7] = m[9]; out[8] = m[10];
  return out;
}

export function transformPoint(m, p) {
  const x = p[0], y = p[1], z = p[2];
  const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) / w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) / w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) / w,
  ];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
