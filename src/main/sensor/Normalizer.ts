/**
 * 生のセンサー値を安定したシグナルに変える (DESIGN.md §13.2)。
 *
 * 生値をそのまま流すとリアクションが暴れる。ここが担うのは 3 つ:
 *   1. EMA 平滑化 — 瞬間的なスパイクで反応しない
 *   2. シュミットトリガ — しきい値の境界で ON/OFF が振動しない
 *   3. 持続条件 — 「一定時間続いたら 1 度だけ」
 */

/** 指数移動平均。 */
export class Ema {
  private value: number | null = null
  constructor(private readonly alpha: number) {}

  push(v: number): number {
    this.value = this.value === null ? v : this.alpha * v + (1 - this.alpha) * this.value
    return this.value
  }

  get current(): number | null {
    return this.value
  }

  reset(): void {
    this.value = null
  }
}

export type TriggerEdge = 'enter' | 'exit' | null

/**
 * シュミットトリガ。`onAt` で ON、`offAt` まで下がって初めて OFF。
 * 例: CPU は 80% で ON、65% まで下がって初めて OFF。
 */
export class SchmittTrigger {
  private on = false

  constructor(
    private readonly onAt: number,
    private readonly offAt: number,
  ) {
    if (offAt > onAt) throw new Error('offAt は onAt 以下でなければならない')
  }

  get isOn(): boolean {
    return this.on
  }

  /** 状態が変化したときだけ 'enter' / 'exit' を返す（継続中は null）。 */
  push(v: number): TriggerEdge {
    if (!this.on && v >= this.onAt) {
      this.on = true
      return 'enter'
    }
    if (this.on && v <= this.offAt) {
      this.on = false
      return 'exit'
    }
    return null
  }

  reset(): void {
    this.on = false
  }
}

/**
 * 「ON 状態が指定秒数続いたら 1 度だけ発火」。
 * `cpu.sustainedHigh` のような持続条件に使う。
 */
export class SustainedCondition {
  private since: number | null = null
  private fired = false

  constructor(private readonly durationSec: number) {}

  /** 条件が満たされた瞬間に true を返す。以降は OFF に戻るまで false。 */
  push(active: boolean, nowMs: number): boolean {
    if (!active) {
      this.since = null
      this.fired = false
      return false
    }
    if (this.since === null) this.since = nowMs
    if (this.fired) return false
    if (nowMs - this.since >= this.durationSec * 1000) {
      this.fired = true
      return true
    }
    return false
  }

  reset(): void {
    this.since = null
    this.fired = false
  }
}

/** CPU など「平滑化 → シュミット → 持続」を一続きにしたもの。 */
export class LoadSignal {
  private readonly ema: Ema
  private readonly trigger: SchmittTrigger
  private readonly sustained: SustainedCondition

  constructor(opts: { alpha?: number; onAt: number; offAt: number; sustainedSec: number }) {
    this.ema = new Ema(opts.alpha ?? 0.3)
    this.trigger = new SchmittTrigger(opts.onAt, opts.offAt)
    this.sustained = new SustainedCondition(opts.sustainedSec)
  }

  push(raw: number, nowMs: number): { smoothed: number; edge: TriggerEdge; sustained: boolean } {
    const smoothed = this.ema.push(raw)
    const edge = this.trigger.push(smoothed)
    const sustained = this.sustained.push(this.trigger.isOn, nowMs)
    return { smoothed, edge, sustained }
  }

  get isHigh(): boolean {
    return this.trigger.isOn
  }
}
