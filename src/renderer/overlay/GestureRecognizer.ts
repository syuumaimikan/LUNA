import type { Vec2 } from '@shared/types/geometry.js'

/** なでの判定パラメータ (DESIGN.md §10.1)。実測で調整する想定。 */
export const PAT_PARAMS = {
  /** 1 ストロークとみなす最小の移動距離 */
  minStrokeDip: 6,
  /** 開始に必要なストローク数 */
  strokesToStart: 2,
  /** 開始判定の時間窓 */
  startWindowMs: 600,
  /** これだけ動きが途切れたら終了 */
  idleTimeoutMs: 1000,
  /** 段階の境界 */
  happyAtStrokes: 4,
  blissAtStrokes: 8,
} as const

/** ふるの判定パラメータ (DESIGN.md §10.2)。 */
export const SHAKE_PARAMS = {
  /** 反転とみなす最小の振幅 */
  minAmplitudeDip: 20,
  /** 必要な反転回数 */
  reversals: 4,
  /** 時間窓 */
  windowMs: 500,
} as const

export type PatTier = 'soft' | 'happy' | 'bliss'

export type GestureEvent =
  | { type: 'patStart' }
  | { type: 'patStroke'; strokes: number; tier: PatTier }
  | { type: 'patEnd'; strokes: number }
  | { type: 'shake' }

export interface PointerSample {
  /** キャラのローカル座標系での位置 */
  position: Vec2
  timeMs: number
  /** 頭部矩形の中か */
  overHead: boolean
  /** ボタンが押されているか */
  pressed: boolean
}

function tierFor(strokes: number): PatTier {
  if (strokes >= PAT_PARAMS.blissAtStrokes) return 'bliss'
  if (strokes >= PAT_PARAMS.happyAtStrokes) return 'happy'
  return 'soft'
}

/**
 * なで／ふるのジェスチャ認識 (DESIGN.md §10.1-10.2)。
 *
 * どちらも「カーソルの水平方向の往復」を数える点は同じで、
 * 押していなければ「なで」、押していれば「ふる」になる。
 * 状態機械上この 2 つは排他なので、1 つの認識器にまとめている。
 */
export class GestureRecognizer {
  private lastX: number | null = null
  private lastDir: -1 | 0 | 1 = 0
  /** 現在の方向で積み上げた移動距離 */
  private travel = 0

  // なで
  private patActive = false
  private patStrokes = 0
  private patStrokeTimes: number[] = []
  private lastPatMoveMs = 0

  // ふる
  private shakeReversals: number[] = []

  reset(): void {
    this.lastX = null
    this.lastDir = 0
    this.travel = 0
    this.patActive = false
    this.patStrokes = 0
    this.patStrokeTimes = []
    this.shakeReversals = []
  }

  /** ポインタの 1 サンプルを与え、発生したイベントを返す。 */
  feed(s: PointerSample): GestureEvent[] {
    const events: GestureEvent[] = []

    // なで中に頭から外れた／ボタンを押した → 終了
    if (this.patActive && (!s.overHead || s.pressed)) {
      events.push({ type: 'patEnd', strokes: this.patStrokes })
      this.endPat()
    }

    const reversal = this.trackReversal(s)

    if (s.pressed) {
      // ドラッグ中 → ふるの判定
      if (reversal) {
        this.shakeReversals.push(s.timeMs)
        this.shakeReversals = this.shakeReversals.filter(
          (t) => s.timeMs - t <= SHAKE_PARAMS.windowMs,
        )
        if (this.shakeReversals.length >= SHAKE_PARAMS.reversals) {
          events.push({ type: 'shake' })
          this.shakeReversals = []
        }
      }
      return events
    }

    // 押していない → なでの判定
    this.shakeReversals = []
    if (!s.overHead) return events

    if (reversal) {
      this.patStrokes++
      this.lastPatMoveMs = s.timeMs
      this.patStrokeTimes.push(s.timeMs)
      this.patStrokeTimes = this.patStrokeTimes.filter(
        (t) => s.timeMs - t <= PAT_PARAMS.startWindowMs,
      )

      if (!this.patActive && this.patStrokeTimes.length >= PAT_PARAMS.strokesToStart) {
        this.patActive = true
        events.push({ type: 'patStart' })
      }
      if (this.patActive) {
        events.push({ type: 'patStroke', strokes: this.patStrokes, tier: tierFor(this.patStrokes) })
      }
    } else if (this.patActive && s.timeMs - this.lastPatMoveMs > PAT_PARAMS.idleTimeoutMs) {
      events.push({ type: 'patEnd', strokes: this.patStrokes })
      this.endPat()
    }

    return events
  }

  /** 時間経過だけでの終了判定（サンプルが来なくなった場合に呼ぶ）。 */
  tick(nowMs: number): GestureEvent[] {
    if (this.patActive && nowMs - this.lastPatMoveMs > PAT_PARAMS.idleTimeoutMs) {
      const e: GestureEvent = { type: 'patEnd', strokes: this.patStrokes }
      this.endPat()
      return [e]
    }
    return []
  }

  get isPatting(): boolean {
    return this.patActive
  }

  /**
   * 水平方向の符号反転を検出する。
   * 「向きが変わった」だけでは足りず、直前の一方向への移動が
   * 一定距離を超えていることを要求する。これが無いと微振動を拾う。
   */
  private trackReversal(s: PointerSample): boolean {
    const x = s.position.x
    if (this.lastX === null) {
      this.lastX = x
      return false
    }

    const dx = x - this.lastX
    this.lastX = x
    if (dx === 0) return false

    const dir: 1 | -1 = dx > 0 ? 1 : -1
    const threshold = s.pressed ? SHAKE_PARAMS.minAmplitudeDip : PAT_PARAMS.minStrokeDip

    if (this.lastDir === 0) {
      this.lastDir = dir
      this.travel = Math.abs(dx)
      return false
    }

    if (dir === this.lastDir) {
      this.travel += Math.abs(dx)
      return false
    }

    // 向きが変わった。直前の一方向への移動が十分なら 1 ストローク
    const enough = this.travel >= threshold
    this.lastDir = dir
    this.travel = Math.abs(dx)
    return enough
  }

  private endPat(): void {
    this.patActive = false
    this.patStrokes = 0
    this.patStrokeTimes = []
  }
}
