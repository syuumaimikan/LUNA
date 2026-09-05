import { collectSignals, conditionDepth } from '@main/reaction/ConditionEvaluator.js'
import {
  dialogueSchema,
  hasForbiddenExtension,
  mascotPackSchema,
  PACK_LIMITS,
  REQUIRED_ANIMATIONS,
  TIMER_SIGNAL_PREFIXES,
  type ValidatedDialogue,
  type ValidatedPack,
} from './PackSchema.js'

export interface PackIssue {
  /** CHARACTER_PACK.md §4 の検証番号 */
  rule: string
  message: string
}

export interface PackValidationResult {
  ok: boolean
  issues: PackIssue[]
  pack: ValidatedPack | null
  dialogue: ValidatedDialogue | null
}

export interface PackInput {
  /** ディレクトリ名。V3 で id と突き合わせる */
  dirName: string
  mascotJson: unknown
  dialogueJson?: unknown
  /** パック内の全ファイル名（相対パス）。V12 の検出に使う */
  files?: string[]
}

function frameNames(pack: ValidatedPack): Set<string> {
  const out = new Set<string>()
  for (const anim of Object.values(pack.animations)) {
    for (const f of anim.frames) out.add(typeof f === 'string' ? f : f.name)
  }
  return out
}

/**
 * パックの検証 (CHARACTER_PACK.md §4)。
 *
 * 1 つでも落ちればそのパックだけ無効化し、アプリは起動を続ける。
 * V9 (パスの閉じ込め) と V12 (実行ファイルの排除) はセキュリティ上の
 * 必須要件で、緩めてはならない。
 */
export function validatePack(input: PackInput): PackValidationResult {
  const issues: PackIssue[] = []
  const add = (rule: string, message: string) => issues.push({ rule, message })

  // V1 / V2: スキーマ適合と schemaVersion（V9 のパス検証もスキーマ内で行う）
  const parsed = mascotPackSchema.safeParse(input.mascotJson)
  if (!parsed.success) {
    for (const e of parsed.error.errors) {
      add('V1', `${e.path.join('.') || '(root)'}: ${e.message}`)
    }
    return { ok: false, issues, pack: null, dialogue: null }
  }
  const pack = parsed.data

  // V12: 実行可能ファイルが同梱されていない
  for (const f of input.files ?? []) {
    if (hasForbiddenExtension(f)) add('V12', `実行可能ファイルが含まれている: ${f}`)
  }

  // V3: id とディレクトリ名の一致
  if (pack.id !== input.dirName) {
    add('V3', `id "${pack.id}" がディレクトリ名 "${input.dirName}" と一致しない`)
  }

  // V4: 必須アニメーション
  for (const req of REQUIRED_ANIMATIONS) {
    if (!pack.animations[req]) add('V4', `必須アニメーション "${req}" が無い`)
  }

  // V11: フレーム総数
  const frames = frameNames(pack)
  if (frames.size > PACK_LIMITS.maxFrames) {
    add('V11', `フレーム数が上限 ${PACK_LIMITS.maxFrames} を超えている (${frames.size})`)
  }

  // 状態の相互参照
  if (!pack.states['idle']) add('V6', '状態 "idle" が無い')
  for (const [id, st] of Object.entries(pack.states)) {
    if (!pack.animations[st.animation]) {
      add('V6', `状態 ${id} の animation "${st.animation}" が未定義`)
    }
    if (st.minDurationSec > st.maxDurationSec) {
      add('V6', `状態 ${id} の minDurationSec が maxDurationSec を超えている`)
    }
    for (const n of st.next ?? []) {
      if (!pack.states[n.state]) add('V6', `状態 ${id} の next "${n.state}" が未定義`)
    }
  }

  // セリフ
  let dialogue: ValidatedDialogue | null = null
  if (input.dialogueJson !== undefined) {
    const d = dialogueSchema.safeParse(input.dialogueJson)
    if (!d.success) {
      for (const e of d.error.errors) add('V1', `dialogue.${e.path.join('.')}: ${e.message}`)
    } else {
      dialogue = d.data
    }
  }
  const sayKeys = new Set(Object.keys(dialogue?.lines ?? {}))

  const checkAction = (ctx: string, a: Record<string, unknown>) => {
    if (typeof a['play'] === 'string' && !pack.animations[a['play']]) {
      add('V7', `${ctx}: play "${a['play']}" が未定義`)
    }
    if (typeof a['say'] === 'string' && !sayKeys.has(a['say'])) {
      add('V7', `${ctx}: say "${a['say']}" が dialogue に無い`)
    }
    if (typeof a['setState'] === 'string' && !pack.states[a['setState']]) {
      add('V7', `${ctx}: setState "${a['setState']}" が未定義`)
    }
  }

  // V7: interactions（headPat は段階ごとの入れ子）
  for (const [key, value] of Object.entries(pack.interactions ?? {})) {
    const v = value as Record<string, unknown>
    const isNested = !('play' in v || 'say' in v || 'effect' in v || 'cooldownSec' in v)
    if (isNested) {
      for (const [tier, tv] of Object.entries(v)) {
        checkAction(`interactions.${key}.${tier}`, tv as Record<string, unknown>)
      }
    } else {
      checkAction(`interactions.${key}`, v)
    }
  }

  // V7 / V8: reactions
  const seenIds = new Set<string>()
  for (const r of pack.reactions ?? []) {
    const ctx = `reaction ${r.id}`
    if (seenIds.has(r.id)) add('V8', `${ctx}: id が重複している`)
    seenIds.add(r.id)

    if (conditionDepth(r.when) > PACK_LIMITS.maxConditionDepth) {
      add('V8', `${ctx}: 条件が ${PACK_LIMITS.maxConditionDepth} 段を超えてネストしている`)
    }

    const totalWait = r.do.reduce((sum, a) => sum + (a.wait ?? 0), 0)
    if (totalWait > PACK_LIMITS.maxTotalWaitMs) {
      add('V8', `${ctx}: 待ち時間の合計が ${PACK_LIMITS.maxTotalWaitMs}ms を超えている`)
    }

    for (const a of r.do) checkAction(ctx, a as Record<string, unknown>)

    // priority 3 はタイマー由来のシグナルにのみ許される
    // (ここを開けると全てのルールが発話上限を無視できてしまう)
    if (r.priority === 3) {
      const signals = collectSignals(r.when)
      const allTimer =
        signals.length > 0 &&
        signals.every((s) => TIMER_SIGNAL_PREFIXES.some((p) => s.startsWith(p)))
      if (!allTimer) {
        add('V8', `${ctx}: priority 3 はタイマー由来のシグナルにのみ許される`)
      }
    }
  }

  // V14: dialogue の minStage は 1-6（スキーマで担保済みだが、キーの存在も見る）
  for (const [key, lines] of Object.entries(dialogue?.lines ?? {})) {
    if (lines.length === 0) add('V14', `dialogue ${key}: 空の配列`)
  }

  return { ok: issues.length === 0, issues, pack, dialogue }
}

/**
 * priority 3 の丸め (CHARACTER_PACK.md §2.7)。
 * 検証で弾く方針だが、実行時にも念のため丸める。
 */
export function effectivePriority(priority: number | undefined, signals: string[]): number {
  const p = priority ?? 1
  if (p !== 3) return p
  const allTimer =
    signals.length > 0 && signals.every((s) => TIMER_SIGNAL_PREFIXES.some((x) => s.startsWith(x)))
  return allTimer ? 3 : 2
}
