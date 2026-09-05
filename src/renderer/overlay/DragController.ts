import type { Vec2 } from '@shared/types/geometry.js'
import { PHYSICS_DEFAULTS, throwVelocity, type PhysicsParams } from './Physics.js'

/** これ未満の速度で離したら「そっと置いた」扱い (DESIGN.md §10.2)。 */
export const GENTLE_RELEASE_SPEED = 300

/** 軌跡を保持する時間。投げ速度は直近 100ms から求める。 */
const SAMPLE_WINDOW_MS = 200

export interface DragSample {
  position: Vec2
  timeMs: number
}

export type ReleaseResult = { kind: 'thrown'; velocity: Vec2 } | { kind: 'placed'; velocity: Vec2 }

/**
 * つかむ・はこぶ・投げる (DESIGN.md §10.2)。
 *
 * カーソルへの追従は 1 フレーム遅れの補間にしてある。完全に追従させると
 * 板が動いているように見えて、「ぶら下がっている」感じが出ないため。
 */
export class DragController {
  private samples: DragSample[] = []
  private dragging = false
  private grabOffset: Vec2 = { x: 0, y: 0 }
  private current: Vec2 = { x: 0, y: 0 }

  constructor(private readonly params: PhysicsParams = PHYSICS_DEFAULTS) {}

  get isDragging(): boolean {
    return this.dragging
  }

  /** つかんだ位置とキャラの位置のずれを保つ（掴んだ点がずれない）。 */
  begin(cursor: Vec2, actorPosition: Vec2, timeMs: number): void {
    this.dragging = true
    this.grabOffset = { x: actorPosition.x - cursor.x, y: actorPosition.y - cursor.y }
    this.current = { ...actorPosition }
    this.samples = [{ position: { ...actorPosition }, timeMs }]
  }

  /**
   * カーソル移動を反映し、キャラの新しい位置を返す。
   * `followRate` は 1 フレームで詰める割合 (0-1)。1 で完全追従。
   */
  move(cursor: Vec2, timeMs: number, followRate = 0.35): Vec2 {
    if (!this.dragging) return this.current

    const target = { x: cursor.x + this.grabOffset.x, y: cursor.y + this.grabOffset.y }
    this.current = {
      x: this.current.x + (target.x - this.current.x) * followRate,
      y: this.current.y + (target.y - this.current.y) * followRate,
    }

    this.samples.push({ position: { ...this.current }, timeMs })
    this.samples = this.samples.filter((s) => timeMs - s.timeMs <= SAMPLE_WINDOW_MS)
    return this.current
  }

  /** 離したときの速度を決める。ゆっくり離したら投げずにそっと落とす。 */
  release(timeMs: number): ReleaseResult {
    const velocity = this.dragging
      ? throwVelocity(this.samples, timeMs, this.params)
      : { x: 0, y: 0 }
    this.dragging = false
    this.samples = []

    const speed = Math.hypot(velocity.x, velocity.y)
    return speed >= GENTLE_RELEASE_SPEED
      ? { kind: 'thrown', velocity }
      : { kind: 'placed', velocity: { x: 0, y: 0 } }
  }

  cancel(): void {
    this.dragging = false
    this.samples = []
  }
}
