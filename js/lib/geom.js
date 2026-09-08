/* =============================================================================
   geom.js — 扉に要るジオメトリだけ（面取り箱・球・板）
   すべて { positions, normals, colors, uvs, indices } の平坦配列を返す。
   ============================================================================= */

/** 複数メッシュ定義を1つに結合する */
export function merge(parts) {
  const out = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  let base = 0;
  for (const p of parts) {
    out.positions.push(...p.positions);
    out.normals.push(...p.normals);
    out.colors.push(...p.colors);
    out.uvs.push(...p.uvs);
    for (const i of p.indices) out.indices.push(i + base);
    base += p.positions.length / 3;
  }
  return out;
}

/** 4点で四角形（反時計回りで表）。法線は明示。色は面ごと */
function quad(acc, a, b, c, d, n, col, uv = [[0, 0], [1, 0], [1, 1], [0, 1]]) {
  const base = acc.positions.length / 3;
  for (const [p, t] of [[a, uv[0]], [b, uv[1]], [c, uv[2]], [d, uv[3]]]) {
    acc.positions.push(p[0], p[1], p[2]);
    acc.normals.push(n[0], n[1], n[2]);
    acc.colors.push(col[0], col[1], col[2]);
    acc.uvs.push(t[0], t[1]);
  }
  acc.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function tri(acc, a, b, c, n, col) {
  const base = acc.positions.length / 3;
  for (const p of [a, b, c]) {
    acc.positions.push(p[0], p[1], p[2]);
    acc.normals.push(n[0], n[1], n[2]);
    acc.colors.push(col[0], col[1], col[2]);
    acc.uvs.push(0, 0);
  }
  acc.indices.push(base, base + 1, base + 2);
}

function normalOf(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / l, n[1] / l, n[2] / l];
}

/**
 * 前後の面の周囲だけ面取りした箱。中心が原点。
 *   w,h,d : 幅・高さ・奥行き / c : 面取り幅
 *   colors: { front, back, side, bevel }（0-1 の RGB）
 * 面取りがあると縁に斜めの面ができ、ガラスならそこで分散（虹）が出る。
 */
export function chamferBox(w, h, d, c, colors, translate = [0, 0, 0]) {
  const acc = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  const [tx, ty, tz] = translate;
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const P = (x, y, z) => [x + tx, y + ty, z + tz];
  const cf = colors.front, cb = colors.back || colors.front, cs = colors.side, cv = colors.bevel || colors.side;

  // 内側矩形（面取り分だけ小さい）と外側矩形（面取りで下がった z）
  for (const sign of [1, -1]) {
    const z0 = sign * hd;          // 面取りされた面の z
    const z1 = sign * (hd - c);    // 側面が始まる z
    const inner = [P(-hw + c, -hh + c, z0), P(hw - c, -hh + c, z0), P(hw - c, hh - c, z0), P(-hw + c, hh - c, z0)];
    const outer = [P(-hw, -hh, z1), P(hw, -hh, z1), P(hw, hh, z1), P(-hw, hh, z1)];
    const col = sign > 0 ? cf : cb;
    if (sign > 0) {
      quad(acc, inner[0], inner[1], inner[2], inner[3], [0, 0, 1], col,
        [[0, 0], [1, 0], [1, 1], [0, 1]]);
    } else {
      quad(acc, inner[1], inner[0], inner[3], inner[2], [0, 0, -1], col,
        [[1, 0], [0, 0], [0, 1], [1, 1]]);
    }
    // 面取り帯（下・右・上・左）
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
    for (const [i, j] of edges) {
      const a = inner[i], b = inner[j], cc = outer[j], dd = outer[i];
      if (sign > 0) {
        const n = normalOf(a, b, cc);
        quad(acc, a, b, cc, dd, n, cv);
      } else {
        const n = normalOf(b, a, dd);
        quad(acc, b, a, dd, cc, n, cv);
      }
    }
    // 角の小さな三角（inner[i], outer[i] と隣接する面取り帯をつなぐ）
    // 面取り帯同士は outer の角で接しているので、角は inner[i]-outer[i] の縮退で閉じている。
  }

  // 側面（4面）: outer 矩形 z1(+) ↔ z1(-)
  const zp = hd - c, zn = -(hd - c);
  const o = (x, y, z) => P(x, y, z);
  // 右 (+x)
  quad(acc, o(hw, -hh, zp), o(hw, -hh, zn), o(hw, hh, zn), o(hw, hh, zp), [1, 0, 0], cs);
  // 左 (-x)
  quad(acc, o(-hw, -hh, zn), o(-hw, -hh, zp), o(-hw, hh, zp), o(-hw, hh, zn), [-1, 0, 0], cs);
  // 上 (+y)
  quad(acc, o(-hw, hh, zp), o(hw, hh, zp), o(hw, hh, zn), o(-hw, hh, zn), [0, 1, 0], cs);
  // 下 (-y)
  quad(acc, o(-hw, -hh, zn), o(hw, -hh, zn), o(hw, -hh, zp), o(-hw, -hh, zp), [0, -1, 0], cs);

  return acc;
}

/** 面取りなしの箱（面取り幅 0 は退化するので別関数） */
export function box(w, h, d, colors, translate = [0, 0, 0]) {
  const acc = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  const [tx, ty, tz] = translate;
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const P = (x, y, z) => [x + tx, y + ty, z + tz];
  const cf = colors.front, cb = colors.back || colors.front, cs = colors.side;
  quad(acc, P(-hw, -hh, hd), P(hw, -hh, hd), P(hw, hh, hd), P(-hw, hh, hd), [0, 0, 1], cf);
  quad(acc, P(hw, -hh, -hd), P(-hw, -hh, -hd), P(-hw, hh, -hd), P(hw, hh, -hd), [0, 0, -1], cb);
  quad(acc, P(hw, -hh, hd), P(hw, -hh, -hd), P(hw, hh, -hd), P(hw, hh, hd), [1, 0, 0], cs);
  quad(acc, P(-hw, -hh, -hd), P(-hw, -hh, hd), P(-hw, hh, hd), P(-hw, hh, -hd), [-1, 0, 0], cs);
  quad(acc, P(-hw, hh, hd), P(hw, hh, hd), P(hw, hh, -hd), P(-hw, hh, -hd), [0, 1, 0], cs);
  quad(acc, P(-hw, -hh, -hd), P(hw, -hh, -hd), P(hw, -hh, hd), P(-hw, -hh, hd), [0, -1, 0], cs);
  return acc;
}

/** UV球 */
export function sphere(r, segW = 24, segH = 16, color = [1, 1, 1], translate = [0, 0, 0]) {
  const acc = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  for (let y = 0; y <= segH; y++) {
    const v = y / segH, phi = v * Math.PI;
    for (let x = 0; x <= segW; x++) {
      const u = x / segW, th = u * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(th), ny = Math.cos(phi), nz = Math.sin(phi) * Math.sin(th);
      acc.positions.push(nx * r + translate[0], ny * r + translate[1], nz * r + translate[2]);
      acc.normals.push(nx, ny, nz);
      acc.colors.push(color[0], color[1], color[2]);
      acc.uvs.push(u, v);
    }
  }
  for (let y = 0; y < segH; y++) {
    for (let x = 0; x < segW; x++) {
      const a = y * (segW + 1) + x, b = a + segW + 1;
      acc.indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  return acc;
}

/** 円柱（Y軸。上下の蓋つき） */
export function cylinder(r, h, seg = 24, color = [1, 1, 1], translate = [0, 0, 0]) {
  const acc = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  const [tx, ty, tz] = translate;
  const ring = (y) => {
    const base = acc.positions.length / 3;
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2, nx = Math.cos(th), nz = Math.sin(th);
      acc.positions.push(nx * r + tx, y + ty, nz * r + tz);
      acc.normals.push(nx, 0, nz);
      acc.colors.push(color[0], color[1], color[2]);
      acc.uvs.push(i / seg, y > 0 ? 1 : 0);
    }
    return base;
  };
  const b0 = ring(-h / 2), b1 = ring(h / 2);
  for (let i = 0; i < seg; i++) {
    acc.indices.push(b0 + i, b1 + i, b0 + i + 1, b1 + i, b1 + i + 1, b0 + i + 1);
  }
  for (const [y, ny] of [[h / 2, 1], [-h / 2, -1]]) {
    const center = acc.positions.length / 3;
    acc.positions.push(tx, y + ty, tz); acc.normals.push(0, ny, 0); acc.colors.push(...color); acc.uvs.push(0.5, 0.5);
    const start = acc.positions.length / 3;
    for (let i = 0; i <= seg; i++) {
      const th = (i / seg) * Math.PI * 2;
      acc.positions.push(Math.cos(th) * r + tx, y + ty, Math.sin(th) * r + tz);
      acc.normals.push(0, ny, 0); acc.colors.push(...color); acc.uvs.push(0.5, 0.5);
    }
    for (let i = 0; i < seg; i++) {
      if (ny > 0) acc.indices.push(center, start + i + 1, start + i);
      else acc.indices.push(center, start + i, start + i + 1);
    }
  }
  return acc;
}

/** XY 平面の板（法線 +z、uv 0-1） */
export function plane(w, h, color = [1, 1, 1], translate = [0, 0, 0]) {
  const acc = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  const [tx, ty, tz] = translate;
  const hw = w / 2, hh = h / 2;
  quad(acc, [-hw + tx, -hh + ty, tz], [hw + tx, -hh + ty, tz], [hw + tx, hh + ty, tz], [-hw + tx, hh + ty, tz], [0, 0, 1], color);
  return acc;
}

/** XZ 平面の板（床。法線 +y） z0..z1 の範囲 */
export function floorPlane(x0, x1, z0, z1, y, color = [1, 1, 1]) {
  const acc = { positions: [], normals: [], colors: [], uvs: [], indices: [] };
  quad(acc, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], [0, 1, 0], color,
    [[0, 0], [1, 0], [1, 1], [0, 1]]);
  return acc;
}
