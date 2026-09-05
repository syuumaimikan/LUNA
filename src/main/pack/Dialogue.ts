import { int, type Rng } from '@shared/rng.js'
import type { ValidatedDialogue } from './PackSchema.js'

/** セリフに展開できる変数 (CHARACTER_PACK.md §3)。 */
export interface DialogueVars {
  hour?: number
  minute?: number
  cpu?: number
  mem?: number
  batteryPercent?: number
  appName?: string
  userName?: string
  mascotName?: string
  days?: number
  stage?: number
}

/**
 * 展開を許す変数名 (CHARACTER_PACK.md §3 の表)。
 *
 * ここを許可リストにしているのは、単純なプロパティ参照だと
 * `{{constructor}}` や `{{toString}}` がプロトタイプ鎖に当たって
 * 内部表現を吹き出しに出せてしまうため。
 */
const ALLOWED_VARS = Object.freeze([
  'hour',
  'minute',
  'cpu',
  'mem',
  'batteryPercent',
  'appName',
  'userName',
  'mascotName',
  'days',
  'stage',
] as const satisfies readonly (keyof DialogueVars)[])

const ALLOWED = new Set<string>(ALLOWED_VARS)

/**
 * `{{name}}` を展開する。
 * **エンジンが提供する変数のみ**が対象で、それ以外の名前は空文字になる。
 * パック側から任意の値を差し込ませないための制約。
 */
export function expandPlaceholders(text: string, vars: DialogueVars): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!ALLOWED.has(key)) return ''
    const v = (vars as Record<string, unknown>)[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

/**
 * セリフを 1 本選ぶ (CHARACTER_PACK.md §3)。
 *
 * - 現在のだいすき度以下の行だけが候補になる（段階が上がるほど語彙が増える）
 * - 直前に使ったものは連続で選ばない
 * - 候補が無ければ null（発話をスキップする）
 */
export class DialoguePicker {
  private readonly lastUsed = new Map<string, string>()

  constructor(
    private readonly dialogue: ValidatedDialogue | null,
    private readonly rng: Rng,
  ) {}

  pick(key: string, stage: number, vars: DialogueVars = {}): string | null {
    const lines = this.dialogue?.lines[key]
    if (!lines || lines.length === 0) return null

    const eligible = lines
      .map((l) => (typeof l === 'string' ? { text: l, minStage: 1 } : l))
      .filter((l) => l.minStage <= stage)
      .map((l) => l.text)

    if (eligible.length === 0) return null

    const previous = this.lastUsed.get(key)
    const fresh = eligible.length > 1 ? eligible.filter((t) => t !== previous) : eligible
    const chosen = fresh[int(this.rng, fresh.length)]!

    this.lastUsed.set(key, chosen)
    return expandPlaceholders(chosen, vars)
  }

  /** その段階で利用できる行数。設定画面の「解禁状況」表示に使う。 */
  countAvailable(key: string, stage: number): number {
    const lines = this.dialogue?.lines[key]
    if (!lines) return 0
    return lines.filter((l) => (typeof l === 'string' ? 1 : l.minStage) <= stage).length
  }
}
