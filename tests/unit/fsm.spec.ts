import { describe, expect, it } from 'vitest'
import { SeededRng } from '../../src/shared/rng.js'
import type { MascotPack } from '../../src/shared/types/pack.js'
import {
  BehaviorFSM,
  contextMultiplier,
  NEUTRAL_CONTEXT,
  type BehaviorContext,
} from '../../src/renderer/overlay/BehaviorFSM.js'

const pack = (): MascotPack => ({
  schemaVersion: 1,
  id: 'test',
  name: 'テスト',
  version: '1.0.0',
  display: { baseHeight: 128 },
  sprite: { atlases: [{ scale: 1, image: 'a.png', data: 'a.json' }] },
  animations: {
    idle: { frames: ['i'] },
    walk: { frames: ['w'], moveSpeed: 40 },
    sleep: { frames: ['s'] },
    snuggle: { frames: ['n'] },
  },
  states: {
    idle: {
      animation: 'idle',
      minDurationSec: 2,
      maxDurationSec: 4,
      next: [
        { state: 'walk', weight: 50 },
        { state: 'sleep', weight: 25 },
        { state: 'snuggle', weight: 25 },
      ],
    },
    walk: {
      animation: 'walk',
      minDurationSec: 1,
      maxDurationSec: 2,
      movement: 'surface',
      next: [{ state: 'idle', weight: 100 }],
    },
    sleep: {
      animation: 'sleep',
      minDurationSec: 5,
      maxDurationSec: 10,
      next: [{ state: 'idle', weight: 100 }],
    },
    snuggle: {
      animation: 'snuggle',
      minDurationSec: 3,
      maxDurationSec: 5,
      minStage: 5,
      next: [{ state: 'idle', weight: 100 }],
    },
  },
  personality: { activity: 0.5, talkative: 0.5, curiosity: 0.5, sleepiness: 0.5 },
})

const ctx = (over: Partial<BehaviorContext> = {}): BehaviorContext => ({
  ...NEUTRAL_CONTEXT,
  affinityStage: 6,
  ...over,
})

/** 遷移先の分布を数える */
function distribution(c: BehaviorContext, seed = 1, samples = 4000): Record<string, number> {
  const out: Record<string, number> = {}
  const p = pack()
  for (let i = 0; i < samples; i++) {
    const fsm = new BehaviorFSM(p, new SeededRng(seed + i), 'idle')
    const next = fsm.pickNext(c)
    out[next] = (out[next] ?? 0) + 1
  }
  return out
}

describe('BehaviorFSM', () => {
  it('滞在時間が尽きるまで遷移しない', () => {
    const fsm = new BehaviorFSM(pack(), new SeededRng(1), 'sleep')
    expect(fsm.update(1, ctx())).toBeNull()
    expect(fsm.stateId).toBe('sleep')
  })

  it('滞在時間が尽きたら遷移する', () => {
    const fsm = new BehaviorFSM(pack(), new SeededRng(1), 'walk')
    const next = fsm.update(100, ctx())
    expect(next).toBe('idle')
    expect(fsm.stateId).toBe('idle')
  })

  it('滞在時間は min-max の範囲に入る', () => {
    for (let i = 0; i < 200; i++) {
      const fsm = new BehaviorFSM(pack(), new SeededRng(i), 'sleep')
      expect(fsm.state.remainingSec).toBeGreaterThanOrEqual(5)
      expect(fsm.state.remainingSec).toBeLessThanOrEqual(10)
    }
  })

  it('同じシードなら完全に同じ挙動になる', () => {
    const runOnce = () => {
      const fsm = new BehaviorFSM(pack(), new SeededRng(42), 'idle')
      const trace: string[] = []
      for (let i = 0; i < 100; i++) {
        const n = fsm.update(1, ctx())
        if (n) trace.push(n)
      }
      return trace
    }
    expect(runOnce()).toEqual(runOnce())
    expect(runOnce().length).toBeGreaterThan(5)
  })

  it('存在しない状態を指定しても idle に落ちる', () => {
    const fsm = new BehaviorFSM(pack(), new SeededRng(1), 'nonexistent')
    expect(fsm.stateId).toBe('idle')
    fsm.forceState('also-missing')
    expect(fsm.stateId).toBe('idle')
  })

  it('forceState で強制遷移できる', () => {
    const fsm = new BehaviorFSM(pack(), new SeededRng(1), 'idle')
    fsm.forceState('sleep')
    expect(fsm.stateId).toBe('sleep')
  })
})

describe('minStage による解禁', () => {
  it('段階が足りなければ候補に現れない', () => {
    const d = distribution(ctx({ affinityStage: 1 }))
    expect(d['snuggle']).toBeUndefined()
    expect(d['walk']).toBeGreaterThan(0)
  })

  it('段階を満たせば現れる', () => {
    const d = distribution(ctx({ affinityStage: 5 }))
    expect(d['snuggle']).toBeGreaterThan(0)
  })
})

describe('文脈による重み補正 (DESIGN §9.3)', () => {
  it('深夜は sleep が増え、移動が減る', () => {
    const day = distribution(ctx())
    const night = distribution(ctx({ timeOfDay: 'lateNight' }))
    expect(night['sleep']!).toBeGreaterThan(day['sleep']!)
    expect(night['walk']!).toBeLessThan(day['walk']!)
  })

  it('ゲーム/会議中は移動がほぼ止まる', () => {
    const normal = distribution(ctx())
    const focus = distribution(ctx({ focusApp: true }))
    expect(focus['walk']!).toBeLessThan(normal['walk']! * 0.3)
  })

  it('ポモドーロ作業中は静かになり、休憩中は活発になる', () => {
    const off = distribution(ctx())
    const working = distribution(ctx({ pomodoro: 'focus' }))
    const resting = distribution(ctx({ pomodoro: 'break' }))
    expect(working['walk']!).toBeLessThan(off['walk']!)
    expect(resting['walk']!).toBeGreaterThan(off['walk']!)
  })

  it('バッテリー低下時は移動が減る', () => {
    expect(distribution(ctx({ batteryLow: true }))['walk']!).toBeLessThan(
      distribution(ctx())['walk']!,
    )
  })

  it('ユーザー離席中は眠りやすくなる', () => {
    expect(distribution(ctx({ userAway: true }))['sleep']!).toBeGreaterThan(
      distribution(ctx())['sleep']!,
    )
  })

  it('活発さ設定が移動の頻度を変える', () => {
    const calm = distribution(ctx({ activity: 'calm' }))
    const lively = distribution(ctx({ activity: 'lively' }))
    expect(lively['walk']!).toBeGreaterThan(calm['walk']!)
  })

  it('補正は乗算で合成される', () => {
    const p = pack()
    const def = p.states['walk']!
    const personality = p.personality!
    const both = contextMultiplier(
      'walk',
      def,
      ctx({ focusApp: true, batteryLow: true }),
      personality,
    )
    const onlyFocus = contextMultiplier('walk', def, ctx({ focusApp: true }), personality)
    const onlyBattery = contextMultiplier('walk', def, ctx({ batteryLow: true }), personality)
    const neutral = contextMultiplier('walk', def, ctx(), personality)
    expect(both).toBeCloseTo((onlyFocus * onlyBattery) / neutral, 8)
  })

  it('性格が重みに反映される', () => {
    const p = pack()
    const lazy = { ...p.personality!, activity: 0 }
    const hyper = { ...p.personality!, activity: 1 }
    const def = p.states['walk']!
    expect(contextMultiplier('walk', def, ctx(), hyper)).toBeGreaterThan(
      contextMultiplier('walk', def, ctx(), lazy),
    )
  })

  it('全候補が塞がれても idle に落ちて止まらない', () => {
    const p = pack()
    p.states['idle']!.next = [{ state: 'ghost', weight: 100 }]
    const fsm = new BehaviorFSM(p, new SeededRng(3), 'idle')
    expect(fsm.pickNext(ctx())).toBe('idle')
  })
})
