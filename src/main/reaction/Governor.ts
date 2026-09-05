import { isWithinRange, parseHhMm, type Clock } from '@shared/time.js'

/** DESIGN.md §13.3 の既定値。 */
export const GOVERNOR_DEFAULTS = {
  maxSpeechPerHour: 6,
  minSpeechIntervalSec: 90,
  /** 起動直後の抑制。起動時の CPU スパイクで反応しないため */
  startupGraceSec: 60,
} as const

export interface GovernorSettings {
  maxSpeechPerHour: number
  minSpeechIntervalSec: number
  quietMode: boolean
  quietHours: { enabled: boolean; from: string; to: string }
}

export interface ReactionRequest {
  ruleId: string
  /** 0=環境 1=リアクション 2=ユーザー操作 3=タイマー 4=システム緊急 */
  priority: number
  cooldownSec: number
  /** 発話を伴うか */
  speaks: boolean
  /** 静音モード中でも実行してよいか（発話しないモーションのみの反応） */
  silentOk: boolean
}

export type GovernorDecision =
  | { allow: true }
  | {
      allow: false
      reason:
        | 'cooldown'
        | 'quietMode'
        | 'quietHours'
        | 'focusMode'
        | 'startupGrace'
        | 'hourlyCap'
        | 'minInterval'
    }

/**
 * リアクションの抑制層 (DESIGN.md §13.3)。
 *
 * 「反応して欲しい」と「うるさい」の境界を守るための層。
 * 抑制されたリアクションは**キューに積まず捨てる**。溜めて後で一気に喋るのは
 * 最悪の体験なので、ここで落としたものは二度と出てこない。
 */
export class Governor {
  private readonly lastFiredAt = new Map<string, number>()
  private speechTimes: number[] = []
  private readonly startedAt: number
  private focusMode = false

  constructor(
    private readonly clock: Clock,
    private settings: GovernorSettings,
  ) {
    this.startedAt = clock.now()
  }

  updateSettings(s: Partial<GovernorSettings>): void {
    this.settings = { ...this.settings, ...s }
  }

  /** 前景がゲーム/会議、またはポモドーロ作業中 (DESIGN.md §13.3)。 */
  setFocusMode(on: boolean): void {
    this.focusMode = on
  }

  evaluate(req: ReactionRequest): GovernorDecision {
    const now = this.clock.now()

    // Pri 4（システム緊急）は何があっても通す
    if (req.priority >= 4) return { allow: true }

    // Pri 3（タイマー）は発話上限をバイパスするが、静音モードは尊重する
    // (DESIGN.md §12.3)。ユーザーが明示的に設定したものを抑制すると
    // 機能として壊れるが、ミュートは明示的な意思表示なので別。
    const isTimer = req.priority === 3

    if (req.speaks && this.settings.quietMode && !req.silentOk)
      return { allow: false, reason: 'quietMode' }
    if (!isTimer) {
      if (now - this.startedAt < GOVERNOR_DEFAULTS.startupGraceSec * 1000) {
        return { allow: false, reason: 'startupGrace' }
      }
      if (this.focusMode && req.priority <= 1) return { allow: false, reason: 'focusMode' }
      if (req.speaks && this.inQuietHours()) return { allow: false, reason: 'quietHours' }
    }

    const last = this.lastFiredAt.get(req.ruleId)
    if (last !== undefined && req.cooldownSec > 0 && now - last < req.cooldownSec * 1000) {
      return { allow: false, reason: 'cooldown' }
    }

    if (req.speaks && !isTimer) {
      const lastSpeech = this.speechTimes[this.speechTimes.length - 1]
      if (
        lastSpeech !== undefined &&
        now - lastSpeech < this.settings.minSpeechIntervalSec * 1000
      ) {
        return { allow: false, reason: 'minInterval' }
      }
      this.pruneSpeech(now)
      if (this.speechTimes.length >= this.settings.maxSpeechPerHour) {
        return { allow: false, reason: 'hourlyCap' }
      }
    }

    return { allow: true }
  }

  /** 実際に実行したときに呼ぶ。`evaluate` は副作用を持たない。 */
  commit(req: ReactionRequest): void {
    const now = this.clock.now()
    this.lastFiredAt.set(req.ruleId, now)
    // タイマーの発話は上限にカウントしない。カウントすると、その後の
    // 通常リアクションが不当に抑制されてしまう
    if (req.speaks && req.priority !== 3) this.speechTimes.push(now)
  }

  /** evaluate して通れば commit するショートハンド。 */
  tryFire(req: ReactionRequest): GovernorDecision {
    const d = this.evaluate(req)
    if (d.allow) this.commit(req)
    return d
  }

  /** 直近 1 時間の発話数。設定画面と手動チェックリストの確認用。 */
  speechCountInLastHour(): number {
    this.pruneSpeech(this.clock.now())
    return this.speechTimes.length
  }

  private pruneSpeech(now: number): void {
    this.speechTimes = this.speechTimes.filter((t) => now - t < 3_600_000)
  }

  private inQuietHours(): boolean {
    const q = this.settings.quietHours
    if (!q.enabled) return false
    const from = parseHhMm(q.from)
    const to = parseHhMm(q.to)
    if (from === null || to === null) return false
    return isWithinRange(this.clock.minutesOfDay(), from, to)
  }
}
