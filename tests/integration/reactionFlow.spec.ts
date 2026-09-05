import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../src/shared/time.js'
import { SeededRng } from '../../src/shared/rng.js'
import { validatePack } from '../../src/main/pack/validatePack.js'
import {
  Governor,
  GOVERNOR_DEFAULTS,
  type GovernorSettings,
} from '../../src/main/reaction/Governor.js'
import { ReactionEngine, bubbleDurationMs } from '../../src/main/reaction/ReactionEngine.js'
import { AffinityService } from '../../src/main/affinity/AffinityService.js'
import { TimerService } from '../../src/main/timer/TimerService.js'

/**
 * 実際の packs/luna を使った、シグナル → リアクションの結合テスト。
 * ここが通れば、パックの書き方とエンジンの解釈が食い違っていないことになる。
 */

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))
const readJson = (p: string) => JSON.parse(readFileSync(root(p), 'utf-8'))

const settings = (over: Partial<GovernorSettings> = {}): GovernorSettings => ({
  maxSpeechPerHour: GOVERNOR_DEFAULTS.maxSpeechPerHour,
  minSpeechIntervalSec: GOVERNOR_DEFAULTS.minSpeechIntervalSec,
  quietMode: false,
  quietHours: { enabled: false, from: '23:00', to: '07:00' },
  ...over,
})

function setup(over: Partial<GovernorSettings> = {}, iso = '2026-01-05T12:00:00', seed = 1) {
  const result = validatePack({
    dirName: 'luna',
    mascotJson: readJson('packs/luna/mascot.json'),
    dialogueJson: readJson('packs/luna/dialogue/ja.json'),
  })
  if (!result.pack) throw new Error(`パックが読めない: ${JSON.stringify(result.issues)}`)

  const clock = new FakeClock(Date.parse(iso))
  const governor = new Governor(clock, settings(over))
  clock.advance(GOVERNOR_DEFAULTS.startupGraceSec + 1) // 起動直後の抑制を抜ける

  const engine = new ReactionEngine(
    result.pack,
    governor,
    clock,
    new SeededRng(seed),
    result.dialogue,
  )
  return { clock, governor, engine }
}

const ctx = (over: Partial<Parameters<ReactionEngine['handle']>[1]> = {}) => ({
  activeSignals: new Set<string>(),
  affinityStage: 3,
  vars: { cpu: 93, batteryPercent: 15, hour: 2, userName: 'ゆう', days: 12 },
  ...over,
})

describe('シグナルからリアクションへ', () => {
  it('CPU 高負荷で汗をかいて喋る', () => {
    const { engine } = setup()
    const r = engine.handle({ signal: 'cpu.sustainedHigh' }, ctx())

    expect(r.directives).toHaveLength(1)
    const d = r.directives[0]!
    expect(d.ruleId).toBe('cpu-hot')
    expect(d.actions.some((a) => a.kind === 'play' && a.animation === 'sweat')).toBe(true)
    expect(d.actions.some((a) => a.kind === 'say')).toBe(true)
  })

  it('セリフのプレースホルダが展開される', () => {
    const { engine } = setup()
    const r = engine.handle({ signal: 'cpu.sustainedHigh' }, ctx())
    const say = r.directives[0]!.actions.find((a) => a.kind === 'say')
    expect(say).toBeDefined()
    if (say?.kind !== 'say') return
    expect(say.text).not.toContain('{{')
  })

  it('充電中はバッテリー低下の警告を出さない（not 条件）', () => {
    const { engine } = setup()
    const charging = ctx({ activeSignals: new Set(['battery.charging']) })
    const r = engine.handle({ signal: 'battery.low' }, charging)
    expect(r.directives.find((d) => d.ruleId === 'battery-low')).toBeUndefined()
  })

  it('充電していなければ警告する', () => {
    const { engine } = setup()
    const r = engine.handle({ signal: 'battery.low' }, ctx())
    expect(r.directives.some((d) => d.ruleId === 'battery-low')).toBe(true)
  })

  it('30 分以上の離席から戻ると挨拶する（where 条件）', () => {
    const { engine } = setup()
    expect(
      engine.handle({ signal: 'user.back', payload: { awaySec: 3600 } }, ctx()).directives,
    ).toHaveLength(1)

    const { engine: e2 } = setup()
    expect(
      e2.handle({ signal: 'user.back', payload: { awaySec: 60 } }, ctx()).directives,
    ).toHaveLength(0)
  })

  it('ゲームを起動すると隅へ移動して座る（発話しない）', () => {
    const { engine } = setup()
    const r = engine.handle({ signal: 'app.changed', payload: { category: 'game' } }, ctx())

    const d = r.directives.find((x) => x.ruleId === 'focus-game')!
    expect(d).toBeDefined()
    expect(d.actions.some((a) => a.kind === 'moveTo')).toBe(true)
    expect(d.actions.some((a) => a.kind === 'say')).toBe(false)
  })

  it('関係ないカテゴリでは反応しない', () => {
    const { engine } = setup()
    const r = engine.handle({ signal: 'app.changed', payload: { category: 'browser' } }, ctx())
    expect(r.directives).toHaveLength(0)
  })

  it('深夜のあくびは時間帯の条件を満たすときだけ', () => {
    const inRange = setup({}, '2026-01-05T02:00:00')
    expect(inRange.engine.handle({ signal: 'time.lateNight' }, ctx()).directives).toHaveLength(1)

    const outOfRange = setup({}, '2026-01-05T22:00:00')
    expect(outOfRange.engine.handle({ signal: 'time.lateNight' }, ctx()).directives).toHaveLength(0)
  })

  it('だいすき度が足りないと甘えない（minStage 条件）', () => {
    const low = setup()
    expect(
      low.engine
        .handle({ signal: 'user.back', payload: { awaySec: 60 } }, ctx({ affinityStage: 4 }))
        .directives.some((d) => d.ruleId === 'snuggle-when-close'),
    ).toBe(false)

    const high = setup()
    expect(
      high.engine
        .handle({ signal: 'user.back', payload: { awaySec: 60 } }, ctx({ affinityStage: 5 }))
        .directives.some((d) => d.ruleId === 'snuggle-when-close'),
    ).toBe(true)
  })
})

describe('Governor との結合', () => {
  it('クールダウン中は同じリアクションが出ない', () => {
    const { clock, engine } = setup()
    expect(engine.handle({ signal: 'cpu.sustainedHigh' }, ctx()).directives).toHaveLength(1)

    clock.advance(60)
    const second = engine.handle({ signal: 'cpu.sustainedHigh' }, ctx())
    expect(second.directives).toHaveLength(0)
    expect(second.suppressed[0]).toEqual({ ruleId: 'cpu-hot', reason: 'cooldown' })

    clock.advance(900)
    expect(engine.handle({ signal: 'cpu.sustainedHigh' }, ctx()).directives).toHaveLength(1)
  })

  it('静音モードでは喋らないが、モーションだけの反応は出る', () => {
    const { engine } = setup({ quietMode: true })
    expect(engine.handle({ signal: 'cpu.sustainedHigh' }, ctx()).directives).toHaveLength(0)

    const silent = engine.handle({ signal: 'battery.charging' }, ctx())
    expect(silent.directives).toHaveLength(1)
    expect(silent.directives[0]!.actions.some((a) => a.kind === 'say')).toBe(false)
  })

  it('1 時間の発話が上限を超えない（実パックでの確認）', () => {
    const { clock, engine } = setup()
    const signals = ['cpu.sustainedHigh', 'battery.low', 'time.morning', 'net.offline'] as const

    let spoke = 0
    for (let i = 0; i < 200; i++) {
      const r = engine.handle({ signal: signals[i % signals.length]! }, ctx())
      spoke += r.directives.filter((d) => d.actions.some((a) => a.kind === 'say')).length
      clock.advance(30)
    }
    // 200 回 × 30 秒 = 約 100 分ぶんなので、上限 6/時 の 2 倍強が上限
    expect(spoke).toBeLessThanOrEqual(GOVERNOR_DEFAULTS.maxSpeechPerHour * 3)
    expect(spoke).toBeGreaterThan(0)
  })

  it('集中モード中は Pri 1 のリアクションが止まる', () => {
    const { governor, engine } = setup()
    governor.setFocusMode(true)
    expect(engine.handle({ signal: 'cpu.sustainedHigh' }, ctx()).directives).toHaveLength(0)
  })

  it('集中モード中でもタイマーは通る', () => {
    const { governor, engine } = setup()
    governor.setFocusMode(true)
    const r = engine.handle({ signal: 'pomodoro.breakStart' }, ctx())
    expect(r.directives).toHaveLength(1)
    expect(r.directives[0]!.priority).toBe(3)
  })

  it('発話上限に達していてもアラームは鳴る', () => {
    const { clock, engine } = setup()
    for (let i = 0; i < 30; i++) {
      engine.handle({ signal: 'cpu.sustainedHigh' }, ctx())
      engine.handle({ signal: 'battery.low' }, ctx())
      clock.advance(120)
    }
    const r = engine.handle({ signal: 'alarm.fired', payload: { intensity: 'loud' } }, ctx())
    expect(r.directives.some((d) => d.ruleId === 'alarm-loud')).toBe(true)
  })

  it('優先度の高い順に並ぶ', () => {
    const { engine } = setup()
    const r = engine.handle({ signal: 'alarm.fired', payload: { intensity: 'loud' } }, ctx())
    for (let i = 1; i < r.directives.length; i++) {
      expect(r.directives[i - 1]!.priority).toBeGreaterThanOrEqual(r.directives[i]!.priority)
    }
  })
})

describe('タイマーからリアクションまでの通し', () => {
  it('ポモドーロの休憩開始がリアクションになる', () => {
    const clockIso = '2026-01-05T12:00:00'
    const { clock, engine } = setup({}, clockIso)
    const timer = new TimerService(clock)

    timer.start()
    clock.advance(25 * 60)
    const events = timer.tick()

    const breakEvent = events.find((e) => e.type === 'pomodoro.breakStart')
    expect(breakEvent).toBeDefined()

    const r = engine.handle({ signal: 'pomodoro.breakStart' }, ctx())
    expect(r.directives.some((d) => d.ruleId === 'pomodoro-break')).toBe(true)
  })

  it('アラームの主張度でリアクションが分かれる', () => {
    const loud = setup()
    expect(
      loud.engine
        .handle({ signal: 'alarm.fired', payload: { intensity: 'loud' } }, ctx())
        .directives.map((d) => d.ruleId),
    ).toContain('alarm-loud')

    const quiet = setup()
    const q = quiet.engine
      .handle({ signal: 'alarm.fired', payload: { intensity: 'quiet' } }, ctx())
      .directives.map((d) => d.ruleId)
    expect(q).toContain('alarm-normal')
    expect(q).not.toContain('alarm-loud')
  })
})

describe('だいすき度との結合', () => {
  it('段階が上がるとセリフの語彙が増える', () => {
    const seen = new Map<number, Set<string>>()
    for (const stage of [1, 2, 5]) {
      const texts = new Set<string>()
      for (let seed = 0; seed < 60; seed++) {
        // 毎回同じシードだと同じ行しか引けないので、シードを振る
        const { engine } = setup({}, '2026-01-05T12:00:00', seed)
        const r = engine.handle(
          { signal: 'user.back', payload: { awaySec: 3600 } },
          ctx({ affinityStage: stage }),
        )
        for (const a of r.directives.flatMap((d) => d.actions)) {
          if (a.kind === 'say') texts.add(a.text)
        }
      }
      seen.set(stage, texts)
    }
    expect(seen.get(2)!.size).toBeGreaterThanOrEqual(seen.get(1)!.size)
    expect(seen.get(5)!.size).toBeGreaterThan(seen.get(1)!.size)
  })

  it('段階上昇イベントが祝われる', () => {
    const clock = new FakeClock(Date.parse('2026-01-05T12:00:00'))
    const affinity = new AffinityService(clock)
    let stageUp: number | null = null
    for (let i = 0; i < 40 && stageUp === null; i++) stageUp = affinity.onPatSession(1).stageUp
    expect(stageUp).toBe(2)

    const { engine } = setup()
    const r = engine.handle({ signal: 'affinity.stageUp', payload: { stage: 2 } }, ctx())
    expect(r.directives.some((d) => d.ruleId === 'stage-up')).toBe(true)
  })
})

describe('吹き出しの表示時間', () => {
  it('短い文でも最低 2.5 秒', () => {
    expect(bubbleDurationMs('わっ')).toBe(2500)
  })

  it('長い文ほど長いが 8 秒で頭打ち', () => {
    expect(bubbleDurationMs('あ'.repeat(30))).toBeGreaterThan(2500)
    expect(bubbleDurationMs('あ'.repeat(200))).toBe(8000)
  })
})
