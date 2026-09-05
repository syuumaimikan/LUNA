import { z } from 'zod'

/**
 * CHARACTER_PACK.md のスキーマ (検証 V1)。
 *
 * 重要なのは、ここに **実行可能なものを一切許さない**こと。
 * 条件は閉じた DSL、アクションは列挙された種類のみ。ここを緩めると
 * キャラ配布がそのまま任意コード実行の配布路になる (DESIGN.md §16)。
 */

export const PACK_LIMITS = {
  maxFrames: 512,
  maxReactions: 100,
  maxActionsPerRule: 8,
  maxConditionDepth: 5,
  maxWaitMs: 5000,
  maxTotalWaitMs: 10_000,
  maxLineLength: 60,
  maxImagePixels: 4096,
  maxPackBytes: 64 * 1024 * 1024,
  maxSoundBytes: 512 * 1024,
} as const

export const EFFECTS = [
  'zzz',
  'sweat',
  'note',
  'heart',
  'question',
  'exclaim',
  'sparkle',
  'dust',
] as const

export const MOVE_TARGETS = ['cornerNearest', 'cursor', 'center', 'floor'] as const

export const SIGNALS = [
  'cpu.high',
  'cpu.sustainedHigh',
  'cpu.calm',
  'mem.high',
  'battery.low',
  'battery.critical',
  'battery.charging',
  'battery.full',
  'time.hourly',
  'time.morning',
  'time.noon',
  'time.evening',
  'time.lateNight',
  'user.away',
  'user.back',
  'session.lock',
  'session.unlock',
  'session.suspend',
  'session.resume',
  'app.changed',
  'app.fullscreen',
  'net.offline',
  'net.online',
  'display.changed',
  'pomodoro.focusStart',
  'pomodoro.breakStart',
  'pomodoro.setDone',
  'alarm.fired',
  'affinity.stageUp',
] as const

export const TIMER_SIGNAL_PREFIXES = ['pomodoro.', 'alarm.'] as const

export const REQUIRED_ANIMATIONS = ['idle', 'walk', 'drag', 'fall'] as const

const packId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{1,31}$/, 'packId は英小文字・数字・_- のみ、2-32 文字')

/**
 * パック内の相対パス (検証 V9)。
 * `..`・絶対パス・ドライブ指定・先頭スラッシュ・バックスラッシュを拒否する。
 * これはセキュリティ上の必須要件で、緩めてはならない。
 */
export const relativePackPath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => !p.includes('\\'), 'バックスラッシュは使えない')
  .refine((p) => !p.startsWith('/'), '絶対パスは使えない')
  .refine((p) => !/^[a-zA-Z]:/.test(p), 'ドライブ指定は使えない')
  .refine((p) => !p.split('/').includes('..'), '親ディレクトリへの参照は使えない')
  .refine((p) => !p.split('/').some((seg) => seg === ''), '空のパス要素は使えない')

const hhmm = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, '"HH:MM" 形式で指定する')

const animationFrame = z.union([
  z.string().min(1),
  z.object({ name: z.string().min(1), durationMs: z.number().positive().max(60_000) }),
])

const animationDef = z.object({
  frames: z.array(animationFrame).min(1).max(PACK_LIMITS.maxFrames),
  fps: z.number().positive().max(120).optional(),
  loop: z.boolean().optional(),
  moveSpeed: z.number().min(0).max(2000).optional(),
  flipWhenFacingLeft: z.boolean().optional(),
  events: z
    .array(
      z.object({
        atFrame: z.number().int().min(0),
        sound: relativePackPath,
        volume: z.number().min(0).max(1).optional(),
      }),
    )
    .max(32)
    .optional(),
})

const stateDef = z.object({
  animation: z.string().min(1),
  minDurationSec: z.number().min(0).max(86_400),
  maxDurationSec: z.number().min(0).max(86_400),
  movement: z.enum(['none', 'surface']).optional(),
  interruptible: z.boolean().optional(),
  effect: z.enum(EFFECTS).optional(),
  minStage: z.number().int().min(1).max(6).optional(),
  next: z
    .array(z.object({ state: z.string().min(1), weight: z.number().min(0).max(1000) }))
    .max(32)
    .optional(),
})

const comparison = z.object({
  eq: z.unknown().optional(),
  ne: z.unknown().optional(),
  gt: z.number().optional(),
  gte: z.number().optional(),
  lt: z.number().optional(),
  lte: z.number().optional(),
  in: z
    .array(z.union([z.string(), z.number(), z.boolean()]))
    .max(32)
    .optional(),
})

/** 条件 DSL。任意式・関数・正規表現は受け付けない (DESIGN.md §16)。 */
export type Condition =
  // exactOptionalPropertyTypes 下では zod の .optional() が undefined を含むため、
  // 手書きの型側でも明示的に undefined を許す必要がある
  | { signal: string; where?: Record<string, z.infer<typeof comparison>> | undefined }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { timeBetween: [string, string] }
  | { minStage: number }

const condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      signal: z.enum(SIGNALS),
      where: z.record(z.string(), comparison).optional(),
    }),
    z.object({ all: z.array(condition).min(1).max(16) }),
    z.object({ any: z.array(condition).min(1).max(16) }),
    z.object({ not: condition }),
    z.object({ timeBetween: z.tuple([hhmm, hhmm]) }),
    z.object({ minStage: z.number().int().min(1).max(6) }),
  ]),
)

const action = z
  .object({
    play: z.string().min(1).optional(),
    say: z.string().min(1).optional(),
    effect: z.enum(EFFECTS).optional(),
    moveTo: z.enum(MOVE_TARGETS).optional(),
    setState: z.string().min(1).optional(),
    sound: relativePackPath.optional(),
    wait: z.number().int().min(0).max(PACK_LIMITS.maxWaitMs).optional(),
  })
  .refine((a) => Object.keys(a).length > 0, '空のアクションは書けない')

const reaction = z.object({
  id: z.string().min(1).max(64),
  when: condition,
  priority: z.number().int().min(0).max(3).optional(),
  cooldownSec: z.number().min(0).max(86_400).optional(),
  silentOk: z.boolean().optional(),
  do: z.array(action).min(1).max(PACK_LIMITS.maxActionsPerRule),
})

const interactionAction = z.object({
  play: z.string().min(1).optional(),
  say: z.string().min(1).optional(),
  effect: z.enum(EFFECTS).optional(),
  cooldownSec: z.number().min(0).max(86_400).optional(),
})

export const mascotPackSchema = z.object({
  schemaVersion: z.literal(1),
  id: packId,
  name: z.string().min(1).max(64),
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'semver で指定する'),
  author: z.string().max(128).optional(),
  license: z.string().max(128).optional(),
  description: z.string().max(512).optional(),

  display: z.object({
    baseHeight: z.number().positive().max(1024),
    anchor: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
    footOffset: z.number().min(-100).max(100).optional(),
    hitPadding: z.number().min(0).max(32).optional(),
    // 検証 V13: headRegion は 0-1 に収まり、矩形が枠を出ない
    headRegion: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().positive().max(1),
        h: z.number().positive().max(1),
      })
      .refine((r) => r.x + r.w <= 1 && r.y + r.h <= 1, 'headRegion が枠からはみ出している')
      .optional(),
  }),

  sprite: z.object({
    atlases: z
      .array(
        z.object({
          scale: z.number().positive().max(8),
          image: relativePackPath,
          data: relativePackPath,
        }),
      )
      .min(1)
      .max(8),
    scaleMode: z.enum(['nearest', 'linear']).optional(),
  }),

  animations: z.record(z.string().min(1), animationDef),
  states: z.record(z.string().min(1), stateDef),
  interactions: z
    .record(
      z.string().min(1),
      z.union([interactionAction, z.record(z.string(), interactionAction)]),
    )
    .optional(),
  reactions: z.array(reaction).max(PACK_LIMITS.maxReactions).optional(),
  personality: z
    .object({
      activity: z.number().min(0).max(1),
      talkative: z.number().min(0).max(1),
      curiosity: z.number().min(0).max(1),
      sleepiness: z.number().min(0).max(1),
    })
    .optional(),
})

export type ValidatedPack = z.infer<typeof mascotPackSchema>

const dialogueLine = z.union([
  z.string().min(1).max(PACK_LIMITS.maxLineLength),
  z.object({
    text: z.string().min(1).max(PACK_LIMITS.maxLineLength),
    minStage: z.number().int().min(1).max(6),
  }),
])

export const dialogueSchema = z.object({
  locale: z.string().min(2).max(16),
  lines: z.record(z.string().min(1), z.array(dialogueLine).min(1).max(64)),
})

export type ValidatedDialogue = z.infer<typeof dialogueSchema>

/** 検証 V12: パックに含めてはならない拡張子。 */
export const FORBIDDEN_EXTENSIONS = [
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.ps1',
  '.sh',
  '.vbs',
  '.scr',
  '.com',
  '.msi',
  '.jar',
  '.py',
] as const

export function hasForbiddenExtension(filename: string): boolean {
  const lower = filename.toLowerCase()
  return FORBIDDEN_EXTENSIONS.some((ext) => lower.endsWith(ext))
}
