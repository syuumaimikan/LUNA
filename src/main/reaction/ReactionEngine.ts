import type { Clock } from '@shared/time.js'
import type { Rng } from '@shared/rng.js'
import type { ValidatedPack } from '@main/pack/PackSchema.js'
import { DialoguePicker, type DialogueVars } from '@main/pack/Dialogue.js'
import { effectivePriority } from '@main/pack/validatePack.js'
import { collectSignals, evaluateCondition } from './ConditionEvaluator.js'
import type { Governor, ReactionRequest } from './Governor.js'

/** Renderer へ送る実行指示 (DESIGN.md §18 の directive:react)。 */
export interface Directive {
  ruleId: string
  priority: number
  actions: DirectiveAction[]
}

export type DirectiveAction =
  | { kind: 'play'; animation: string }
  | { kind: 'say'; text: string; durationMs: number }
  | { kind: 'effect'; effect: string }
  | { kind: 'moveTo'; target: string }
  | { kind: 'setState'; state: string }
  | { kind: 'sound'; path: string }
  | { kind: 'wait'; ms: number }

export interface SignalEvent {
  signal: string
  payload?: Record<string, unknown>
}

export interface EngineContext {
  activeSignals: ReadonlySet<string>
  affinityStage: number
  vars: DialogueVars
}

/** 吹き出しの表示時間 (DESIGN.md §14.4)。 */
export function bubbleDurationMs(text: string): number {
  return Math.min(8000, Math.max(2500, text.length * 120))
}

export interface EngineResult {
  directives: Directive[]
  /** 抑制されたルールと理由。設定画面のデバッグ表示用 */
  suppressed: { ruleId: string; reason: string }[]
}

/**
 * シグナルからリアクションを組み立てる (DESIGN.md §13)。
 *
 * 抑制されたリアクションは**キューに積まず捨てる**。溜めて後で一気に
 * 喋るのは最悪の体験なので、ここで落としたものは二度と出てこない。
 */
export class ReactionEngine {
  private readonly dialogue: DialoguePicker

  constructor(
    private readonly pack: ValidatedPack,
    private readonly governor: Governor,
    private readonly clock: Clock,
    rng: Rng,
    dialogueSource: ConstructorParameters<typeof DialoguePicker>[0],
  ) {
    this.dialogue = new DialoguePicker(dialogueSource, rng)
  }

  handle(event: SignalEvent, ctx: EngineContext): EngineResult {
    const directives: Directive[] = []
    const suppressed: { ruleId: string; reason: string }[] = []

    for (const rule of this.pack.reactions ?? []) {
      const matched = evaluateCondition(
        rule.when,
        {
          firedSignal: event.signal,
          payload: event.payload ?? {},
          activeSignals: ctx.activeSignals,
          affinityStage: ctx.affinityStage,
        },
        this.clock,
      )
      if (!matched) continue

      const speaks = rule.do.some((a) => a.say !== undefined)
      const priority = effectivePriority(rule.priority, collectSignals(rule.when))

      const request: ReactionRequest = {
        ruleId: rule.id,
        priority,
        cooldownSec: rule.cooldownSec ?? 0,
        speaks,
        silentOk: rule.silentOk ?? false,
      }

      const decision = this.governor.evaluate(request)
      if (!decision.allow) {
        suppressed.push({ ruleId: rule.id, reason: decision.reason })
        continue
      }

      const actions = this.buildActions(rule.do, ctx)
      // セリフが選べず、他に何もすることが無いなら実行しない
      if (actions.length === 0) {
        suppressed.push({ ruleId: rule.id, reason: 'noActions' })
        continue
      }

      this.governor.commit(request)
      directives.push({ ruleId: rule.id, priority, actions })
    }

    // 優先度の高い順。同順位は定義順を保つ
    directives.sort((a, b) => b.priority - a.priority)
    return { directives, suppressed }
  }

  private buildActions(
    steps: readonly Record<string, unknown>[],
    ctx: EngineContext,
  ): DirectiveAction[] {
    const out: DirectiveAction[] = []
    for (const step of steps) {
      if (typeof step['play'] === 'string') out.push({ kind: 'play', animation: step['play'] })
      if (typeof step['effect'] === 'string') out.push({ kind: 'effect', effect: step['effect'] })
      if (typeof step['moveTo'] === 'string') out.push({ kind: 'moveTo', target: step['moveTo'] })
      if (typeof step['setState'] === 'string')
        out.push({ kind: 'setState', state: step['setState'] })
      if (typeof step['sound'] === 'string') out.push({ kind: 'sound', path: step['sound'] })
      if (typeof step['wait'] === 'number') out.push({ kind: 'wait', ms: step['wait'] })
      if (typeof step['say'] === 'string') {
        const text = this.dialogue.pick(step['say'], ctx.affinityStage, ctx.vars)
        // 段階が足りずセリフが無い場合は、その say だけを飛ばす
        if (text !== null) out.push({ kind: 'say', text, durationMs: bubbleDurationMs(text) })
      }
    }
    return out
  }
}
