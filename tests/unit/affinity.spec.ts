import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../src/shared/time.js'
import {
  AFFINITY_POINTS,
  AffinityService,
  MAX_STAGE,
  pointsToNextStage,
  stageFor,
  STAGE_THRESHOLDS,
} from '../../src/main/affinity/AffinityService.js'

const svc = (iso = '2026-01-01T09:00:00') => {
  const clock = new FakeClock(Date.parse(iso))
  return { clock, a: new AffinityService(clock) }
}

describe('stageFor', () => {
  it('しきい値どおりに段階が決まる', () => {
    expect(stageFor(0)).toBe(1)
    expect(stageFor(29)).toBe(1)
    expect(stageFor(30)).toBe(2)
    expect(stageFor(100)).toBe(3)
    expect(stageFor(250)).toBe(4)
    expect(stageFor(600)).toBe(5)
    expect(stageFor(1200)).toBe(6)
    expect(stageFor(99999)).toBe(MAX_STAGE)
  })

  it('次の段階までの残りを返す', () => {
    expect(pointsToNextStage(0)).toBe(STAGE_THRESHOLDS[1])
    expect(pointsToNextStage(25)).toBe(5)
    expect(pointsToNextStage(1200)).toBeNull()
  })
})

describe('日ごとの加点', () => {
  it('その日はじめての起動で加点し、連続日数が増える', () => {
    const { clock, a } = svc()
    a.onDayStart()
    expect(a.streakDays).toBe(1)
    expect(a.score).toBe(AFFINITY_POINTS.firstLaunchOfDay + 1)

    clock.advance(86_400)
    a.onDayStart()
    expect(a.streakDays).toBe(2)
    expect(a.score).toBe(AFFINITY_POINTS.firstLaunchOfDay * 2 + 1 + 2)
  })

  it('同じ日に何度起動しても 1 回しか加点しない', () => {
    const { a } = svc()
    a.onDayStart()
    const after = a.score
    a.onDayStart()
    a.onDayStart()
    expect(a.score).toBe(after)
  })

  it('日が飛ぶと連続日数がリセットされる（ただしスコアは減らない）', () => {
    const { clock, a } = svc()
    a.onDayStart()
    clock.advance(86_400)
    a.onDayStart()
    expect(a.streakDays).toBe(2)

    const before = a.score
    clock.advance(86_400 * 3)
    a.onDayStart()
    expect(a.streakDays).toBe(1)
    expect(a.score).toBeGreaterThan(before) // 減らない
  })

  it('連続日数ボーナスには上限がある', () => {
    const { clock, a } = svc()
    for (let i = 0; i < 20; i++) {
      a.onDayStart()
      clock.advance(86_400)
    }
    // 20 日目のボーナスが 7 で頭打ちになっていること
    const before = a.score
    a.onDayStart()
    expect(a.score - before).toBe(AFFINITY_POINTS.firstLaunchOfDay + AFFINITY_POINTS.maxStreakBonus)
  })

  it('システム時計が巻き戻っても加点しない', () => {
    const { clock, a } = svc('2026-03-10T09:00:00')
    a.onDayStart()
    const after = a.score

    clock.setTo('2026-03-01T09:00:00')
    a.onDayStart()
    expect(a.score).toBe(after)
  })
})

describe('なでによる加点', () => {
  it('ストローク数ぶん加点される', () => {
    const { a } = svc()
    const r = a.onPatSession(3)
    expect(r.awarded).toBe(3)
    expect(a.score).toBe(3)
    expect(a.patCount).toBe(3)
  })

  it('1 セッションの上限が効く（連打で伸ばせない）', () => {
    const { a } = svc()
    const r = a.onPatSession(100)
    expect(r.awarded).toBe(AFFINITY_POINTS.perPatSessionCap)
    expect(a.patCount).toBe(100) // 回数自体は記録する
  })

  it('1 日の上限が効く', () => {
    const { a } = svc()
    let total = 0
    for (let i = 0; i < 20; i++) total += a.onPatSession(5).awarded
    expect(total).toBe(AFFINITY_POINTS.dailyPatCap)
  })

  it('日が変われば上限がリセットされる', () => {
    const { clock, a } = svc()
    for (let i = 0; i < 20; i++) a.onPatSession(5)
    expect(a.onPatSession(5).awarded).toBe(0)

    clock.advance(86_400)
    expect(a.onPatSession(5).awarded).toBe(AFFINITY_POINTS.perPatSessionCap)
  })
})

describe('リアクションとポモドーロによる加点', () => {
  it('リアクションは 1 日の上限まで', () => {
    const { a } = svc()
    for (let i = 0; i < 100; i++) a.onReactionSeen()
    expect(a.score).toBe(AFFINITY_POINTS.dailyReactionCap)
  })

  it('ポモドーロは 1 日の上限まで', () => {
    const { a } = svc()
    for (let i = 0; i < 100; i++) a.onPomodoroSetDone()
    expect(a.score).toBe(AFFINITY_POINTS.dailyPomodoroCap)
  })
})

describe('段階の上昇', () => {
  it('しきい値を跨いだときだけ stageUp を返す', () => {
    const { a } = svc()
    // 29 点まで積む（stage 1 のまま）
    for (let i = 0; i < 29; i++) expect(a.onPatSession(1).stageUp).toBeNull()
    expect(a.score).toBe(29)
    expect(a.stage).toBe(1)

    expect(a.onPatSession(1).stageUp).toBe(2)
    expect(a.stage).toBe(2)
  })

  it('スコアは決して下がらない（放置ペナルティが無い）', () => {
    const { clock, a } = svc()
    a.onDayStart()
    a.onPatSession(5)
    const before = a.score

    clock.advance(86_400 * 365)
    a.onDayStart()
    expect(a.score).toBeGreaterThanOrEqual(before)
    expect(a.stage).toBeGreaterThanOrEqual(stageFor(before))
  })
})

describe('永続化', () => {
  it('保存した記録から復元できる', () => {
    const { clock, a } = svc()
    a.onDayStart()
    a.onPatSession(4)
    const saved = { version: 1 as const, packs: { luna: a.toRecord() } }

    const restored = AffinityService.fromFile(clock, saved, 'luna')
    expect(restored.score).toBe(a.score)
    expect(restored.stage).toBe(a.stage)
    expect(restored.patCount).toBe(a.patCount)
  })

  it('未知のパックは新規の記録になる', () => {
    const { clock, a } = svc()
    a.onPatSession(4)
    const saved = { version: 1 as const, packs: { luna: a.toRecord() } }

    const other = AffinityService.fromFile(clock, saved, 'someone-else')
    expect(other.score).toBe(0)
    expect(other.stage).toBe(1)
  })

  it('toRecord は内部状態のコピーを返す（外から壊せない）', () => {
    const { a } = svc()
    a.onPatSession(4)
    const rec = a.toRecord()
    rec.score = 99999
    rec.daily.patPoints = 99999
    expect(a.score).toBe(4)
  })

  it('リセットで初期状態に戻る', () => {
    const { a } = svc()
    a.onDayStart()
    a.onPatSession(10)
    a.reset()
    expect(a.score).toBe(0)
    expect(a.stage).toBe(1)
    expect(a.patCount).toBe(0)
  })
})
