import type { Clock } from '@shared/time.js'
import { parseHhMm } from '@shared/time.js'

/** ポモドーロの設定 (DESIGN.md §12.1)。 */
export interface PomodoroSettings {
  focusMin: number
  shortBreakMin: number
  longBreakMin: number
  setsPerLongBreak: number
}

export const POMODORO_DEFAULTS: PomodoroSettings = {
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  setsPerLongBreak: 4,
}

export type PomodoroMode = 'off' | 'focus' | 'shortBreak' | 'longBreak' | 'paused'

export interface AlarmSpec {
  id: string
  /** "HH:MM" */
  time: string
  label: string
  intensity: 'quiet' | 'normal' | 'loud'
  enabled: boolean
  /** 0=日曜。空配列なら毎日 */
  days: number[]
}

/** 鳴っているアラーム。クリックで止めるまで保持する。 */
export interface RingingAlarm {
  id: string
  label: string
  intensity: AlarmSpec['intensity']
  /** 発火からの経過秒 */
  elapsedSec: number
  /** 主張度が自動的に落とされたか (DESIGN.md §12.2) */
  softened: boolean
}

/** 主張の強いアラームを自動的に静める猶予 (DESIGN.md §12.2)。 */
export const ALARM_SOFTEN_AFTER_SEC = 300

export type TimerEvent =
  | { type: 'pomodoro.focusStart'; setIndex: number }
  | { type: 'pomodoro.breakStart'; long: boolean }
  | { type: 'pomodoro.setDone'; setIndex: number }
  | { type: 'alarm.fired'; id: string; label: string; intensity: AlarmSpec['intensity'] }

export interface PomodoroState {
  mode: PomodoroMode
  remainingSec: number
  /** 完了したセット数 */
  completedSets: number
}

/**
 * ポモドーロとアラーム (DESIGN.md §12)。
 *
 * **自動起動はしない。** ユーザーが明示的に開始したときだけ動く。
 * 「作業を検知して勝手に計測」は監視されている感が強く、第一原則の
 * 「邪魔をしない」に反するため。
 */
export class TimerService {
  private mode: PomodoroMode = 'off'
  private endsAt = 0
  private remainingWhenPaused = 0
  private completedSets = 0
  private pomodoro: PomodoroSettings
  private alarms: AlarmSpec[] = []
  /** 同じ分に二重発火しないための記録 */
  private readonly firedAt = new Map<string, string>()
  private ringing: { spec: AlarmSpec; since: number; softened: boolean } | null = null
  private readonly snoozeUntil = new Map<string, number>()
  private snoozeMin = 5

  constructor(
    private readonly clock: Clock,
    settings: PomodoroSettings = POMODORO_DEFAULTS,
  ) {
    this.pomodoro = settings
  }

  setPomodoroSettings(s: Partial<PomodoroSettings>): void {
    this.pomodoro = { ...this.pomodoro, ...s }
  }

  setAlarms(alarms: AlarmSpec[]): void {
    this.alarms = alarms
  }

  setSnoozeMinutes(min: number): void {
    this.snoozeMin = min
  }

  /** 鳴っているアラーム。無ければ null。 */
  get ringingAlarm(): RingingAlarm | null {
    if (!this.ringing) return null
    const elapsedSec = Math.floor((this.clock.now() - this.ringing.since) / 1000)
    return {
      id: this.ringing.spec.id,
      label: this.ringing.spec.label,
      // 猶予を過ぎたら主張度を落とす。無限に走り回らせない
      intensity: this.ringing.softened ? 'quiet' : this.ringing.spec.intensity,
      elapsedSec,
      softened: this.ringing.softened,
    }
  }

  /** クリックで停止。 */
  dismissAlarm(): void {
    this.ringing = null
  }

  /** スヌーズ。指定分だけ後に鳴り直す。 */
  snoozeAlarm(): void {
    if (!this.ringing) return
    const spec = this.ringing.spec
    this.ringing = null
    // 次に鳴る時刻を firedAt から外して、スヌーズ後に再発火できるようにする
    this.firedAt.delete(spec.id)
    this.snoozeUntil.set(spec.id, this.clock.now() + this.snoozeMin * 60_000)
  }

  get state(): PomodoroState {
    return {
      mode: this.mode,
      remainingSec: this.remainingSec(),
      completedSets: this.completedSets,
    }
  }

  /** ポモドーロ作業中か。行動の重み補正と Governor の集中モードに使う。 */
  get isFocusing(): boolean {
    return this.mode === 'focus'
  }

  start(): TimerEvent[] {
    this.completedSets = 0
    return this.beginFocus()
  }

  pause(): void {
    if (this.mode === 'off' || this.mode === 'paused') return
    this.remainingWhenPaused = this.remainingSec()
    this.mode = 'paused'
  }

  resume(): void {
    if (this.mode !== 'paused') return
    // 一時停止前の区間へ戻す。作業中だったか休憩中だったかは
    // completedSets と残り時間からは復元できないので、focus に寄せる
    this.mode = 'focus'
    this.endsAt = this.clock.now() + this.remainingWhenPaused * 1000
  }

  stop(): void {
    this.mode = 'off'
    this.endsAt = 0
    this.completedSets = 0
  }

  /** ディスプレイが全画面アプリに覆われているか。アラームの出し方を変える。 */
  shouldSuppressAlarmVisuals(fullscreenActive: boolean): boolean {
    // 全画面中は音だけ鳴らし、キャラは出てこない (DESIGN.md §12.2)
    return fullscreenActive
  }

  /** 現在の区間を飛ばして次へ。 */
  skip(): TimerEvent[] {
    if (this.mode === 'off') return []
    this.endsAt = this.clock.now()
    return this.tick()
  }

  /**
   * 経過を反映し、発生したイベントを返す。
   * ポモドーロは自分で作業と休憩を行き来する。
   */
  tick(): TimerEvent[] {
    const events: TimerEvent[] = [...this.tickAlarms()]
    if (this.mode === 'off' || this.mode === 'paused') return events
    if (this.clock.now() < this.endsAt) return events

    if (this.mode === 'focus') {
      this.completedSets++
      events.push({ type: 'pomodoro.setDone', setIndex: this.completedSets })
      const long = this.completedSets % this.pomodoro.setsPerLongBreak === 0
      this.mode = long ? 'longBreak' : 'shortBreak'
      const minutes = long ? this.pomodoro.longBreakMin : this.pomodoro.shortBreakMin
      this.endsAt = this.clock.now() + minutes * 60_000
      events.push({ type: 'pomodoro.breakStart', long })
    } else {
      events.push(...this.beginFocus())
    }
    return events
  }

  private beginFocus(): TimerEvent[] {
    this.mode = 'focus'
    this.endsAt = this.clock.now() + this.pomodoro.focusMin * 60_000
    return [{ type: 'pomodoro.focusStart', setIndex: this.completedSets + 1 }]
  }

  private remainingSec(): number {
    if (this.mode === 'paused') return this.remainingWhenPaused
    if (this.mode === 'off') return 0
    return Math.max(0, Math.ceil((this.endsAt - this.clock.now()) / 1000))
  }

  private tickAlarms(): TimerEvent[] {
    const out: TimerEvent[] = []
    const now = this.clock.now()

    // 鳴りっぱなしを一定時間で静める
    if (this.ringing && !this.ringing.softened) {
      if (now - this.ringing.since >= ALARM_SOFTEN_AFTER_SEC * 1000) this.ringing.softened = true
    }

    // スヌーズの満了
    for (const [id, at] of [...this.snoozeUntil]) {
      if (now < at) continue
      this.snoozeUntil.delete(id)
      const spec = this.alarms.find((a) => a.id === id)
      if (!spec || !spec.enabled) continue
      this.ringing = { spec, since: now, softened: false }
      out.push({ type: 'alarm.fired', id: spec.id, label: spec.label, intensity: spec.intensity })
    }

    const today = this.clock.today()
    const nowMin = this.clock.minutesOfDay()
    // 曜日は暦日から求める（Clock は曜日を持たないので日付から導く）
    const dow = dayOfWeek(today)

    for (const a of this.alarms) {
      if (!a.enabled) continue
      if (a.days.length > 0 && dow !== null && !a.days.includes(dow)) continue

      const at = parseHhMm(a.time)
      if (at === null || at !== nowMin) continue

      // 同じ日の同じ分では 1 度だけ
      const key = `${today} ${a.time}`
      if (this.firedAt.get(a.id) === key) continue
      this.firedAt.set(a.id, key)

      this.ringing = { spec: a, since: now, softened: false }
      out.push({ type: 'alarm.fired', id: a.id, label: a.label, intensity: a.intensity })
    }
    return out
  }
}

/** YYYY-MM-DD から曜日 (0=日曜) を求める。Zeller の公式。 */
export function dayOfWeek(day: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) return null
  let y = Number(m[1])
  let mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 3) {
    mo += 12
    y -= 1
  }
  const k = y % 100
  const j = Math.floor(y / 100)
  const h =
    (d + Math.floor((13 * (mo + 1)) / 5) + k + Math.floor(k / 4) + Math.floor(j / 4) + 5 * j) % 7
  // Zeller: 0=土曜。0=日曜に合わせる
  return (h + 6) % 7
}
