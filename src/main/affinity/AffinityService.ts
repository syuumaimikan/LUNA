import { daysSince, isNextCalendarDay, parseIso, toIsoString, type Clock } from '@shared/time.js'

/** DESIGN.md §11.1 の段階しきい値。 */
export const STAGE_THRESHOLDS = [0, 30, 100, 250, 600, 1200] as const
export const MAX_STAGE = STAGE_THRESHOLDS.length

/** DESIGN.md §11.2 の加点と 1 日の上限。 */
export const AFFINITY_POINTS = {
  firstLaunchOfDay: 10,
  maxStreakBonus: 7,
  perPatStroke: 1,
  dailyPatCap: 30,
  perReactionSeen: 0.5,
  dailyReactionCap: 10,
  perPomodoroSet: 3,
  dailyPomodoroCap: 12,
  /** 1 なでセッションで加算できる上限 (DESIGN.md §10.1 の乱用対策) */
  perPatSessionCap: 5,
} as const

export interface AffinityRecord {
  score: number
  stage: number
  patCount: number
  firstMetAt: string
  lastSeenDate: string
  streakDays: number
  daily: { date: string; patPoints: number; reactionPoints: number; pomodoroPoints: number }
}

export interface AffinityFile {
  version: 1
  packs: Record<string, AffinityRecord>
}

export function stageFor(score: number): number {
  let stage = 1
  for (let i = 0; i < STAGE_THRESHOLDS.length; i++) {
    if (score >= STAGE_THRESHOLDS[i]!) stage = i + 1
  }
  return stage
}

/** 次の段階まであといくつか。最大段階なら null。 */
export function pointsToNextStage(score: number): number | null {
  const stage = stageFor(score)
  if (stage >= MAX_STAGE) return null
  return STAGE_THRESHOLDS[stage]! - score
}

function emptyRecord(clock: Clock): AffinityRecord {
  return {
    score: 0,
    stage: 1,
    patCount: 0,
    firstMetAt: toIsoString(clock.now()),
    lastSeenDate: '',
    streakDays: 0,
    daily: { date: '', patPoints: 0, reactionPoints: 0, pomodoroPoints: 0 },
  }
}

/**
 * だいすき度 (DESIGN.md §11)。
 *
 * 設計上の要点は「**下がらない**」こと。放置でパラメータが下がる仕組みは、
 * 常駐アプリでは起動していないことへの罪悪感を生み、第一原則の
 * 「邪魔をしない」に反する。連続日数ボーナスが途切れるだけで十分な動機付けになる。
 */
export class AffinityService {
  constructor(
    private readonly clock: Clock,
    private record: AffinityRecord = emptyRecord(clock),
  ) {}

  static fromFile(clock: Clock, file: AffinityFile | null, packId: string): AffinityService {
    const rec = file?.packs?.[packId]
    return new AffinityService(clock, rec ? { ...rec } : emptyRecord(clock))
  }

  get score(): number {
    return this.record.score
  }
  get stage(): number {
    return this.record.stage
  }
  get streakDays(): number {
    return this.record.streakDays
  }
  get patCount(): number {
    return this.record.patCount
  }
  /** 一緒に過ごした日数（セリフの {{days}}）。 */
  get daysTogether(): number {
    const first = parseIso(this.record.firstMetAt)
    if (first === null) return 0
    return daysSince(first, this.clock.now())
  }

  toRecord(): AffinityRecord {
    return { ...this.record, daily: { ...this.record.daily } }
  }

  /**
   * 起動時・日付跨ぎ時に呼ぶ。加点があれば段階の変化を返す。
   * システム時計が巻き戻された場合は加点せず、日付だけ更新する。
   */
  onDayStart(): { stageUp: number | null } {
    const today = this.clock.today()
    if (this.record.lastSeenDate === today) return { stageUp: null }

    const wentBackwards = this.record.lastSeenDate !== '' && today < this.record.lastSeenDate
    this.record.daily = { date: today, patPoints: 0, reactionPoints: 0, pomodoroPoints: 0 }

    if (wentBackwards) {
      // 時計が巻き戻った。日付だけ更新して加点しない
      this.record.lastSeenDate = today
      return { stageUp: null }
    }

    this.record.streakDays = isNextCalendarDay(this.record.lastSeenDate, today)
      ? this.record.streakDays + 1
      : 1
    this.record.lastSeenDate = today

    const bonus = Math.min(this.record.streakDays, AFFINITY_POINTS.maxStreakBonus)
    return this.award(AFFINITY_POINTS.firstLaunchOfDay + bonus)
  }

  /**
   * 1 なでセッションぶんの加点。
   * セッション内の上限とその日の上限の両方が効く (DESIGN.md §10.1, §11.2)。
   */
  onPatSession(strokes: number): { stageUp: number | null; awarded: number } {
    this.ensureToday()
    this.record.patCount += strokes

    const perSession = Math.min(
      strokes * AFFINITY_POINTS.perPatStroke,
      AFFINITY_POINTS.perPatSessionCap,
    )
    const remaining = Math.max(0, AFFINITY_POINTS.dailyPatCap - this.record.daily.patPoints)
    const awarded = Math.min(perSession, remaining)
    this.record.daily.patPoints += awarded
    return { ...this.award(awarded), awarded }
  }

  onReactionSeen(): { stageUp: number | null } {
    this.ensureToday()
    const remaining = Math.max(
      0,
      AFFINITY_POINTS.dailyReactionCap - this.record.daily.reactionPoints,
    )
    const awarded = Math.min(AFFINITY_POINTS.perReactionSeen, remaining)
    this.record.daily.reactionPoints += awarded
    return this.award(awarded)
  }

  onPomodoroSetDone(): { stageUp: number | null } {
    this.ensureToday()
    const remaining = Math.max(
      0,
      AFFINITY_POINTS.dailyPomodoroCap - this.record.daily.pomodoroPoints,
    )
    const awarded = Math.min(AFFINITY_POINTS.perPomodoroSet, remaining)
    this.record.daily.pomodoroPoints += awarded
    return this.award(awarded)
  }

  /** 設定画面からの明示的なリセット (DESIGN.md §11.4)。 */
  reset(): void {
    this.record = emptyRecord(this.clock)
  }

  private ensureToday(): void {
    const today = this.clock.today()
    if (this.record.daily.date !== today) {
      this.record.daily = { date: today, patPoints: 0, reactionPoints: 0, pomodoroPoints: 0 }
    }
  }

  private award(points: number): { stageUp: number | null } {
    if (points <= 0) return { stageUp: null }
    const before = this.record.stage
    this.record.score += points
    this.record.stage = stageFor(this.record.score)
    return { stageUp: this.record.stage > before ? this.record.stage : null }
  }
}
