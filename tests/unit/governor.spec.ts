import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../src/shared/time.js'
import {
  Governor,
  GOVERNOR_DEFAULTS,
  type GovernorSettings,
  type ReactionRequest,
} from '../../src/main/reaction/Governor.js'

const settings = (over: Partial<GovernorSettings> = {}): GovernorSettings => ({
  maxSpeechPerHour: GOVERNOR_DEFAULTS.maxSpeechPerHour,
  minSpeechIntervalSec: GOVERNOR_DEFAULTS.minSpeechIntervalSec,
  quietMode: false,
  quietHours: { enabled: false, from: '23:00', to: '07:00' },
  ...over,
})

const req = (over: Partial<ReactionRequest> = {}): ReactionRequest => ({
  ruleId: 'r1',
  priority: 1,
  cooldownSec: 0,
  speaks: true,
  silentOk: false,
  ...over,
})

/** 起動直後の抑制を抜けた状態の Governor を作る */
function ready(over: Partial<GovernorSettings> = {}, iso = '2026-01-01T12:00:00') {
  const clock = new FakeClock(Date.parse(iso))
  const g = new Governor(clock, settings(over))
  clock.advance(GOVERNOR_DEFAULTS.startupGraceSec + 1)
  return { clock, g }
}

describe('起動直後の抑制', () => {
  it('起動から 60 秒はリアクションを抑制する', () => {
    const clock = new FakeClock(Date.parse('2026-01-01T12:00:00'))
    const g = new Governor(clock, settings())
    expect(g.evaluate(req())).toEqual({ allow: false, reason: 'startupGrace' })

    clock.advance(GOVERNOR_DEFAULTS.startupGraceSec + 1)
    expect(g.evaluate(req()).allow).toBe(true)
  })

  it('タイマーは起動直後でも通る', () => {
    const clock = new FakeClock(Date.parse('2026-01-01T12:00:00'))
    const g = new Governor(clock, settings())
    expect(g.evaluate(req({ priority: 3 })).allow).toBe(true)
  })
})

describe('クールダウン', () => {
  it('同じルールはクールダウン中に再発火しない', () => {
    const { clock, g } = ready()
    const r = req({ cooldownSec: 900, speaks: false })
    expect(g.tryFire(r).allow).toBe(true)
    expect(g.evaluate(r)).toEqual({ allow: false, reason: 'cooldown' })

    clock.advance(899)
    expect(g.evaluate(r).allow).toBe(false)
    clock.advance(2)
    expect(g.evaluate(r).allow).toBe(true)
  })

  it('別のルールは互いのクールダウンに影響しない', () => {
    const { g } = ready()
    g.tryFire(req({ ruleId: 'a', cooldownSec: 900, speaks: false }))
    expect(g.evaluate(req({ ruleId: 'b', cooldownSec: 900, speaks: false })).allow).toBe(true)
  })

  it('evaluate は副作用を持たない', () => {
    const { g } = ready()
    const r = req({ cooldownSec: 900, speaks: false })
    g.evaluate(r)
    g.evaluate(r)
    expect(g.evaluate(r).allow).toBe(true) // commit していないので通り続ける
  })
})

describe('発話の上限', () => {
  it('最短間隔が効く', () => {
    const { clock, g } = ready()
    expect(g.tryFire(req({ ruleId: 'a' })).allow).toBe(true)
    expect(g.evaluate(req({ ruleId: 'b' }))).toEqual({ allow: false, reason: 'minInterval' })

    clock.advance(GOVERNOR_DEFAULTS.minSpeechIntervalSec + 1)
    expect(g.evaluate(req({ ruleId: 'b' })).allow).toBe(true)
  })

  it('1 時間に 6 回を超えて喋らない', () => {
    const { clock, g } = ready()
    let spoke = 0
    // 10 分ごとに 1 時間ぶん試行する
    for (let i = 0; i < 30; i++) {
      if (g.tryFire(req({ ruleId: `r${i}` })).allow) spoke++
      clock.advance(120)
    }
    expect(spoke).toBe(GOVERNOR_DEFAULTS.maxSpeechPerHour)
    // 窓は流れ続けるので、ループ終了時点の直近 1 時間はこれ以下になる
    expect(g.speechCountInLastHour()).toBeLessThanOrEqual(GOVERNOR_DEFAULTS.maxSpeechPerHour)
  })

  it('どの 1 時間を切り取っても上限を超えない', () => {
    const { clock, g } = ready()
    const fired: number[] = []
    for (let i = 0; i < 200; i++) {
      if (g.tryFire(req({ ruleId: `r${i}` })).allow) fired.push(clock.now())
      clock.advance(100)
    }
    expect(fired.length).toBeGreaterThan(0)
    for (const start of fired) {
      const inWindow = fired.filter((t) => t >= start && t - start < 3_600_000)
      expect(inWindow.length).toBeLessThanOrEqual(GOVERNOR_DEFAULTS.maxSpeechPerHour)
    }
  })

  it('1 時間の窓が流れれば再び喋れる', () => {
    const { clock, g } = ready()
    for (let i = 0; i < 10; i++) {
      g.tryFire(req({ ruleId: `r${i}` }))
      clock.advance(120)
    }
    expect(g.evaluate(req({ ruleId: 'x' })).allow).toBe(false)

    clock.advance(3700)
    expect(g.speechCountInLastHour()).toBe(0)
    expect(g.evaluate(req({ ruleId: 'x' })).allow).toBe(true)
  })

  it('発話しないリアクションは上限に数えない', () => {
    const { g } = ready()
    for (let i = 0; i < 50; i++) {
      expect(g.tryFire(req({ ruleId: `r${i}`, speaks: false })).allow).toBe(true)
    }
    expect(g.speechCountInLastHour()).toBe(0)
  })
})

describe('静音モード', () => {
  it('発話するリアクションを止める', () => {
    const { g } = ready({ quietMode: true })
    expect(g.evaluate(req())).toEqual({ allow: false, reason: 'quietMode' })
  })

  it('モーションだけの反応は通す', () => {
    const { g } = ready({ quietMode: true })
    expect(g.evaluate(req({ speaks: false })).allow).toBe(true)
    expect(g.evaluate(req({ speaks: true, silentOk: true })).allow).toBe(true)
  })

  it('タイマーであっても静音モードは尊重する', () => {
    const { g } = ready({ quietMode: true })
    expect(g.evaluate(req({ priority: 3 }))).toEqual({ allow: false, reason: 'quietMode' })
  })

  it('システム緊急(Pri 4)だけは全てを通す', () => {
    const { g } = ready({ quietMode: true })
    expect(g.evaluate(req({ priority: 4 })).allow).toBe(true)
  })
})

describe('就寝時間帯', () => {
  it('日を跨ぐ時間帯の中では喋らない', () => {
    const { g } = ready(
      { quietHours: { enabled: true, from: '23:00', to: '07:00' } },
      '2026-01-01T23:30:00',
    )
    expect(g.evaluate(req())).toEqual({ allow: false, reason: 'quietHours' })
  })

  it('時間帯の外なら喋る', () => {
    const { g } = ready(
      { quietHours: { enabled: true, from: '23:00', to: '07:00' } },
      '2026-01-01T12:00:00',
    )
    expect(g.evaluate(req()).allow).toBe(true)
  })

  it('早朝も時間帯の内側', () => {
    const { g } = ready(
      { quietHours: { enabled: true, from: '23:00', to: '07:00' } },
      '2026-01-01T03:00:00',
    )
    expect(g.evaluate(req()).allow).toBe(false)
  })

  it('タイマーは就寝時間帯でも鳴る（自分で設定したものなので）', () => {
    const { g } = ready(
      { quietHours: { enabled: true, from: '23:00', to: '07:00' } },
      '2026-01-01T23:30:00',
    )
    expect(g.evaluate(req({ priority: 3 })).allow).toBe(true)
  })
})

describe('集中モード', () => {
  it('Pri 1 以下を抑制する', () => {
    const { g } = ready()
    g.setFocusMode(true)
    expect(g.evaluate(req({ priority: 1 }))).toEqual({ allow: false, reason: 'focusMode' })
    expect(g.evaluate(req({ priority: 0, speaks: false }))).toEqual({
      allow: false,
      reason: 'focusMode',
    })
  })

  it('ユーザー操作(Pri 2)とタイマー(Pri 3)は通す', () => {
    const { g } = ready()
    g.setFocusMode(true)
    expect(g.evaluate(req({ priority: 2, speaks: false })).allow).toBe(true)
    expect(g.evaluate(req({ priority: 3 })).allow).toBe(true)
  })

  it('解除すれば戻る', () => {
    const { g } = ready()
    g.setFocusMode(true)
    g.setFocusMode(false)
    expect(g.evaluate(req({ priority: 1 })).allow).toBe(true)
  })
})

describe('タイマーのバイパス (DESIGN §12.3)', () => {
  it('発話上限に達していてもタイマーは鳴る', () => {
    const { clock, g } = ready()
    for (let i = 0; i < 10; i++) {
      g.tryFire(req({ ruleId: `r${i}` }))
      clock.advance(120)
    }
    expect(g.evaluate(req({ ruleId: 'normal' })).allow).toBe(false)
    expect(g.evaluate(req({ ruleId: 'alarm', priority: 3 })).allow).toBe(true)
  })

  it('タイマーの発話は上限にカウントされない', () => {
    const { clock, g } = ready()
    for (let i = 0; i < 20; i++) {
      g.tryFire(req({ ruleId: `alarm${i}`, priority: 3 }))
      clock.advance(60)
    }
    expect(g.speechCountInLastHour()).toBe(0)
    // 通常のリアクションが不当に抑制されていない
    expect(g.evaluate(req({ ruleId: 'normal' })).allow).toBe(true)
  })

  it('タイマーでもクールダウンは効く', () => {
    const { g } = ready()
    const r = req({ ruleId: 'pomo', priority: 3, cooldownSec: 60 })
    expect(g.tryFire(r).allow).toBe(true)
    expect(g.evaluate(r)).toEqual({ allow: false, reason: 'cooldown' })
  })
})
