import type { Surface, Vec2 } from '@shared/types/geometry.js'
import { horizontalSpan, type TerrainMap } from './TerrainMap.js'

/** DESIGN.md §8 の既定値。単位は dip / 秒。 */
export const PHYSICS_DEFAULTS = {
  gravity: 1800,
  terminalVelocity: 2400,
  restitution: 0.35,
  groundFriction: 0.8,
  throwMultiplier: 1.2,
  maxThrowSpeed: 2000,
  /** 固定タイムステップ。描画 fps が変動しても挙動を変えないため */
  stepSec: 1 / 120,
  /** これ未満の跳ね返り速度は跳ねずに着地とみなす */
  bounceCutoff: 60,
} as const

export type PhysicsParams = typeof PHYSICS_DEFAULTS

export interface FreeBody {
  position: Vec2
  velocity: Vec2
}

export interface LandingResult {
  /** 着地した面。落下し続けている場合は null */
  surface: Surface | null
  /** 着地位置 */
  position: Vec2
  velocity: Vec2
  /** この step で跳ね返った回数 */
  bounces: number
}

/**
 * 自由落下の積分 (DESIGN.md §8)。
 *
 * 固定タイムステップのセミインプリシット・オイラー。`dt` をアキュムレータに溜め、
 * `stepSec` 単位でのみ積分するため、描画フレームレートが 10fps でも 60fps でも
 * 同じ軌道になる。テストが完全に決定論的になるのはこの性質による。
 */
export class FreeFallIntegrator {
  private accumulator = 0

  constructor(
    private readonly terrain: TerrainMap,
    private readonly params: PhysicsParams = PHYSICS_DEFAULTS,
  ) {}

  reset(): void {
    this.accumulator = 0
  }

  /**
   * dt 秒ぶん進める。着地したらその面を返す。
   * `screenWalls` に画面端の壁を渡すと反発する（DESIGN.md §8.1）。
   */
  advance(body: FreeBody, dt: number, screenWalls?: { minX: number; maxX: number }): LandingResult {
    this.accumulator += dt
    let bounces = 0
    let landed: Surface | null = null

    while (this.accumulator >= this.params.stepSec && !landed) {
      this.accumulator -= this.params.stepSec
      const r = this.step(body, screenWalls)
      bounces += r.bounces
      landed = r.surface
    }

    if (landed) this.accumulator = 0
    return { surface: landed, position: body.position, velocity: body.velocity, bounces }
  }

  private step(
    body: FreeBody,
    walls?: { minX: number; maxX: number },
  ): { surface: Surface | null; bounces: number } {
    const h = this.params.stepSec

    // セミインプリシット: 先に速度を更新してから位置に反映する
    body.velocity.y = Math.min(
      body.velocity.y + this.params.gravity * h,
      this.params.terminalVelocity,
    )

    const from = { ...body.position }
    const to = { x: from.x + body.velocity.x * h, y: from.y + body.velocity.y * h }

    const hit = this.sweepFloor(from, to)
    if (hit) {
      body.position = { x: hit.x, y: hit.surface.a.y }
      if (Math.abs(body.velocity.y) > this.params.bounceCutoff) {
        // 跳ねる。水平方向は摩擦で減衰させる
        body.velocity.y = -body.velocity.y * this.params.restitution
        body.velocity.x *= 1 - this.params.groundFriction * h
        return { surface: null, bounces: 1 }
      }
      body.velocity = { x: 0, y: 0 }
      return { surface: hit.surface, bounces: 0 }
    }

    body.position = to

    if (walls) {
      // 画面端の壁だけは反発する。ウィンドウ由来の壁は通過（DESIGN.md §8.1）
      if (body.position.x < walls.minX) {
        body.position.x = walls.minX
        body.velocity.x = Math.abs(body.velocity.x) * this.params.restitution
      } else if (body.position.x > walls.maxX) {
        body.position.x = walls.maxX
        body.velocity.x = -Math.abs(body.velocity.x) * this.params.restitution
      }
    }

    return { surface: null, bounces: 0 }
  }

  /**
   * 線分 from→to が上から交差する floor のうち、最も手前（最初に当たる）もの。
   *
   * 天井とウィンドウの壁は意図的に無視する。落下中に天井へ勝手にぶら下がったり、
   * 壁に叩きつけられて張り付くのは生き物として不自然だという判断
   * (DESIGN.md §8.1 の非対称な扱い)。
   */
  private sweepFloor(from: Vec2, to: Vec2): { surface: Surface; x: number } | null {
    if (to.y < from.y) return null // 上昇中は着地しない

    const candidates = this.terrain.queryRect(
      Math.min(from.x, to.x) - 1,
      from.y - 1,
      Math.max(from.x, to.x) + 1,
      to.y + 1,
    )

    let best: { surface: Surface; x: number; y: number } | null = null
    for (const s of candidates) {
      if (s.kind !== 'floor') continue
      const { lo, hi, y } = horizontalSpan(s)

      // from.y <= y <= to.y の範囲を跨いだか。始点がすでに面より下なら当たらない
      if (y < from.y || y > to.y) continue

      const dy = to.y - from.y
      const t = dy === 0 ? 0 : (y - from.y) / dy
      const x = from.x + (to.x - from.x) * t
      if (x < lo || x > hi) continue

      if (!best || y < best.y) best = { surface: s, x, y }
    }
    return best ? { surface: best.surface, x: best.x } : null
  }
}

/**
 * ドラッグ直近の軌跡から投げ速度を求める (DESIGN.md §8, §10.2)。
 * `samples` は新しい順でも古い順でもよい。100ms より古いものは無視する。
 */
export function throwVelocity(
  samples: readonly { position: Vec2; timeMs: number }[],
  nowMs: number,
  params: PhysicsParams = PHYSICS_DEFAULTS,
): Vec2 {
  const recent = samples.filter((s) => nowMs - s.timeMs <= 100).sort((a, b) => a.timeMs - b.timeMs)
  if (recent.length < 2) return { x: 0, y: 0 }

  const first = recent[0]!
  const last = recent[recent.length - 1]!
  const dtSec = (last.timeMs - first.timeMs) / 1000
  if (dtSec <= 0) return { x: 0, y: 0 }

  let vx = ((last.position.x - first.position.x) / dtSec) * params.throwMultiplier
  let vy = ((last.position.y - first.position.y) / dtSec) * params.throwMultiplier

  const speed = Math.hypot(vx, vy)
  if (speed > params.maxThrowSpeed) {
    const k = params.maxThrowSpeed / speed
    vx *= k
    vy *= k
  }
  return { x: vx, y: vy }
}
