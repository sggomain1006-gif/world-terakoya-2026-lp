/* =============================================================================
   spring.js — 動きの「つまみ」を減衰比 ζ と整定時間の2つに絞ったバネ
   physics-lab/lib/physics.js からこのLPに要る部分だけを移植。
   - 速度を保持するので、スクロールで割り込まれても破綻しない
   - dt が大きくても ω₀·h ≤ 0.25 になるよう内部で分割する（安定と正確は別物）
   ============================================================================= */

export function zetaForOvershoot(overshoot) {
  if (overshoot <= 0) return 1;
  const L = Math.log(overshoot);
  return -L / Math.sqrt(Math.PI * Math.PI + L * L);
}

/** 体感（何秒で止まるか・何%跳ねるか）→ 物理量 */
export function springFromFeel({ settle = 0.4, overshoot = 0.05, tol = 0.02 } = {}) {
  const zeta = zetaForOvershoot(overshoot);
  // 近似式は ζ≈0.7 で約7%ずれるので、数値で整定時間を測って1回補正する
  let omega0 = -Math.log(tol) / (zeta * settle);
  for (let i = 0; i < 2; i++) {
    const actual = settleTimeExact(omega0, zeta, tol);
    if (!Number.isFinite(actual) || actual <= 0) break;
    omega0 *= actual / settle;
  }
  return { omega0, zeta };
}

function settleTimeExact(omega0, zeta, tol, tMax = 20, dt = 0.001) {
  let x = 1, v = 0, last = 0;
  const k = omega0 * omega0, c = 2 * zeta * omega0;
  for (let t = 0; t < tMax; t += dt) {
    const a = -k * x - c * v;
    v += a * dt;
    x += v * dt;
    if (Math.abs(x) > tol) last = t;
  }
  return last;
}

export class Spring {
  constructor({ omega0 = 16, zeta = 0.7, value = 0, velocity = 0, target = 0 } = {}) {
    this.omega0 = omega0;
    this.zeta = zeta;
    this.value = value;
    this.velocity = velocity;
    this.target = target;
  }

  static fromFeel(feel, init = {}) {
    return new Spring({ ...springFromFeel(feel), ...init });
  }

  step(dt) {
    const maxH = Math.min(
      0.25 / Math.max(this.omega0, 1e-6),
      0.5 / Math.max(this.zeta * this.omega0, 1e-6)
    );
    const n = Math.max(1, Math.ceil(dt / maxH));
    const h = dt / n;
    const k = this.omega0 * this.omega0;
    const c = 2 * this.zeta * this.omega0;
    for (let i = 0; i < n; i++) {
      const a = -k * (this.value - this.target) - c * this.velocity;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  setTarget(t) { this.target = t; return this; }
  snap(v) { this.value = this.target = v; this.velocity = 0; return this; }
  isSettled(eps = 1e-3, epsV = 1e-2) {
    return Math.abs(this.value - this.target) < eps && Math.abs(this.velocity) < epsV;
  }
}

/** 半減期で指定する指数平滑（lerp 係数の置き換え。フレームレートに依らない） */
export function expSmooth(current, target, halfLife, dt) {
  if (halfLife <= 0) return target;
  return target + (current - target) * Math.pow(0.5, dt / halfLife);
}

/** タブ復帰などで巨大な dt が来たときに物理を吹き飛ばさない */
export function safeDt(rawSeconds, maxSeconds = 1 / 30) {
  if (!Number.isFinite(rawSeconds) || rawSeconds < 0) return 0;
  return Math.min(rawSeconds, maxSeconds);
}
