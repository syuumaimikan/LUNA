import { range, weightedPick, type Rng } from '@shared/rng.js'
import {
  DEFAULT_PERSONALITY,
  type MascotPack,
  type Personality,
  type StateDef,
} from '@shared/types/pack.js'

/** 行動の重みを補正する文脈 (DESIGN.md §9.3)。 */
export interface BehaviorContext {
  timeOfDay: 'morning' | 'day' | 'evening' | 'lateNight'
  /** ユーザーが 5 分以上操作していない */
  userAway: boolean
  /** 前景がゲーム/会議 */
  focusApp: boolean
  /** ポモドーロ */
  pomodoro: 'off' | 'focus' | 'break'
  quietMode: boolean
  batteryLow: boolean
  affinityStage: number
  /** 設定「活発さ」 */
  activity: 'calm' | 'normal' | 'lively'
}

export const NEUTRAL_CONTEXT: BehaviorContext = {
  timeOfDay: 'day',
  userAway: false,
  focusApp: false,
  pomodoro: 'off',
  quietMode: false,
  batteryLow: false,
  affinityStage: 1,
  activity: 'normal',
}

const MOVEMENT_STATES = new Set(['walk', 'run'])
const SLEEP_STATES = new Set(['sleep'])

const ACTIVITY_MULTIPLIER: Record<BehaviorContext['activity'], number> = {
  calm: 0.5,
  normal: 1,
  lively: 1.8,
}

/**
 * 状態 `id` の重みに掛かる補正係数 (DESIGN.md §9.3)。
 *
 * パックは「素の性格」だけを書けばよく、環境への適応はエンジンが行う。
 * 補正は乗算し、最後に正規化される（weightedPick が合計で割るため明示的な
 * 正規化は不要）。
 */
export function contextMultiplier(
  stateId: string,
  def: StateDef,
  ctx: BehaviorContext,
  personality: Personality,
): number {
  let m = 1
  const isMove = MOVEMENT_STATES.has(stateId) || def.movement === 'surface'
  const isSleep = SLEEP_STATES.has(stateId)

  if (isMove) m *= 0.4 + personality.activity * 1.2
  if (isSleep) m *= 0.4 + personality.sleepiness * 1.2

  if (isMove) m *= ACTIVITY_MULTIPLIER[ctx.activity]

  if (ctx.timeOfDay === 'lateNight') {
    if (isSleep) m *= 4
    if (stateId === 'run') m *= 0.2
  }
  if (ctx.userAway) {
    if (isSleep) m *= 3
    if (isMove) m *= 0.5
  }
  if (ctx.focusApp && isMove) m *= 0.1
  if (ctx.pomodoro === 'focus' && isMove) m *= 0.1
  if (ctx.pomodoro === 'break' && isMove) m *= 2
  if (ctx.quietMode && isMove) m *= 0.3
  if (ctx.batteryLow && isMove) m *= 0.3

  return m
}

export interface FsmState {
  stateId: string
  remainingSec: number
}

/**
 * アンビエント行動の状態機械 (DESIGN.md §9.1, §9.3)。
 *
 * エンジン予約状態（drag / fall / climb / headPat など）はここでは扱わない。
 * それらは物理・入力・リアクションが直接制御するため。
 */
export class BehaviorFSM {
  private current: FsmState

  constructor(
    private readonly pack: MascotPack,
    private readonly rng: Rng,
    startStateId = 'idle',
  ) {
    this.current = this.enter(startStateId)
  }

  get state(): FsmState {
    return { ...this.current }
  }

  get stateId(): string {
    return this.current.stateId
  }

  /** dt 秒ぶん進める。滞在時間が尽きたら遷移し、新しい状態 id を返す。 */
  update(dtSec: number, ctx: BehaviorContext): string | null {
    this.current.remainingSec -= dtSec
    if (this.current.remainingSec > 0) return null
    const next = this.pickNext(ctx)
    this.current = this.enter(next)
    return next
  }

  /** リアクションなどからの強制遷移。 */
  forceState(stateId: string): void {
    if (this.pack.states[stateId]) this.current = this.enter(stateId)
  }

  /** 次の状態を選ぶ。候補が全て塞がれていたら idle に落とす。 */
  pickNext(ctx: BehaviorContext): string {
    const def = this.pack.states[this.current.stateId]
    const personality = this.pack.personality ?? DEFAULT_PERSONALITY

    const candidates = (def?.next ?? []).filter((t) => {
      const d = this.pack.states[t.state]
      if (!d) return false
      // 親密度で解禁される状態 (CHARACTER_PACK.md §2.5 の minStage)
      return (d.minStage ?? 1) <= ctx.affinityStage
    })

    const picked = weightedPick(this.rng, candidates, (t) => {
      const d = this.pack.states[t.state]!
      return t.weight * contextMultiplier(t.state, d, ctx, personality)
    })

    return picked?.state ?? 'idle'
  }

  private enter(stateId: string): FsmState {
    const def = this.pack.states[stateId] ?? this.pack.states['idle']
    const id = this.pack.states[stateId] ? stateId : 'idle'
    if (!def) return { stateId: id, remainingSec: 1 }
    return { stateId: id, remainingSec: range(this.rng, def.minDurationSec, def.maxDurationSec) }
  }
}
