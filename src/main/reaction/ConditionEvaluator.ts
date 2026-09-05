import { isWithinRange, parseHhMm, type Clock } from '@shared/time.js'
import type { Condition } from '@main/pack/PackSchema.js'

/** 評価時に与える文脈。 */
export interface EvalContext {
  /** 今まさに発火したシグナル */
  firedSignal: string
  /** そのペイロード */
  payload: Record<string, unknown>
  /** 継続中の状態系シグナル（battery.charging など） */
  activeSignals: ReadonlySet<string>
  affinityStage: number
}

type Comparison = {
  eq?: unknown
  ne?: unknown
  gt?: number | undefined
  gte?: number | undefined
  lt?: number | undefined
  lte?: number | undefined
  in?: (string | number | boolean)[] | undefined
}

function compare(value: unknown, c: Comparison): boolean {
  if ('eq' in c && c.eq !== undefined && value !== c.eq) return false
  if ('ne' in c && c.ne !== undefined && value === c.ne) return false
  if (c.in !== undefined && !c.in.includes(value as string | number | boolean)) return false

  const numeric = [c.gt, c.gte, c.lt, c.lte].some((v) => v !== undefined)
  if (numeric) {
    if (typeof value !== 'number') return false
    if (c.gt !== undefined && !(value > c.gt)) return false
    if (c.gte !== undefined && !(value >= c.gte)) return false
    if (c.lt !== undefined && !(value < c.lt)) return false
    if (c.lte !== undefined && !(value <= c.lte)) return false
  }
  return true
}

/**
 * パックの条件 DSL を評価する (CHARACTER_PACK.md §2.7)。
 *
 * 文法は閉じており、任意式・関数・正規表現は存在しない。
 * `signal` は「今発火した」か「継続中」のどちらかで真になる。
 * `not` の中では継続中のみを見る（発火していないことを表現するため）。
 */
export function evaluateCondition(cond: Condition, ctx: EvalContext, clock: Clock): boolean {
  if ('all' in cond) return cond.all.every((c) => evaluateCondition(c, ctx, clock))
  if ('any' in cond) return cond.any.some((c) => evaluateCondition(c, ctx, clock))
  if ('not' in cond) return !evaluateCondition(cond.not, ctx, clock)

  if ('timeBetween' in cond) {
    const from = parseHhMm(cond.timeBetween[0])
    const to = parseHhMm(cond.timeBetween[1])
    if (from === null || to === null) return false
    return isWithinRange(clock.minutesOfDay(), from, to)
  }

  if ('minStage' in cond) return ctx.affinityStage >= cond.minStage

  if ('signal' in cond) {
    const matched = ctx.firedSignal === cond.signal || ctx.activeSignals.has(cond.signal)
    if (!matched) return false
    if (!cond.where) return true
    // where はいま発火したシグナルのペイロードにのみ適用する
    if (ctx.firedSignal !== cond.signal) return false
    return Object.entries(cond.where).every(([key, c]) =>
      compare(ctx.payload[key], c as Comparison),
    )
  }

  return false
}

/** 条件に現れるシグナル名を全て集める。priority 3 の検証などに使う。 */
export function collectSignals(cond: Condition, out: string[] = []): string[] {
  if ('signal' in cond) out.push(cond.signal)
  else if ('all' in cond) for (const c of cond.all) collectSignals(c, out)
  else if ('any' in cond) for (const c of cond.any) collectSignals(c, out)
  else if ('not' in cond) collectSignals(cond.not, out)
  return out
}

/** 条件のネストの深さ (検証 V8)。 */
export function conditionDepth(cond: Condition): number {
  if ('all' in cond) return 1 + Math.max(...cond.all.map(conditionDepth))
  if ('any' in cond) return 1 + Math.max(...cond.any.map(conditionDepth))
  if ('not' in cond) return 1 + conditionDepth(cond.not)
  return 1
}
