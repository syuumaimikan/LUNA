import { describe, expect, it } from 'vitest'
import {
  GestureRecognizer,
  PAT_PARAMS,
  SHAKE_PARAMS,
  type GestureEvent,
  type PointerSample,
} from '../../src/renderer/overlay/GestureRecognizer.js'

/**
 * カーソルの往復軌跡を合成する。
 * DESIGN.md §20 のとおり、ここは本来「実際になでた記録」を資産として持ち、
 * 閾値を触ったときの影響が見えるようにする箇所。
 */
function strokes(opts: {
  count: number
  amplitude: number
  intervalMs?: number
  startMs?: number
  overHead?: boolean
  pressed?: boolean
  stepsPerStroke?: number
}): PointerSample[] {
  const {
    count,
    amplitude,
    intervalMs = 100,
    startMs = 1000,
    overHead = true,
    pressed = false,
    stepsPerStroke = 2,
  } = opts

  const out: PointerSample[] = []
  let x = 0
  let t = startMs
  let dir = 1
  out.push({ position: { x, y: 0 }, timeMs: t, overHead, pressed })

  for (let s = 0; s <= count; s++) {
    for (let k = 0; k < stepsPerStroke; k++) {
      x += (dir * amplitude) / stepsPerStroke
      t += intervalMs / stepsPerStroke
      out.push({ position: { x, y: 0 }, timeMs: t, overHead, pressed })
    }
    dir *= -1
  }
  return out
}

function run(r: GestureRecognizer, samples: PointerSample[]): GestureEvent[] {
  return samples.flatMap((s) => r.feed(s))
}

describe('なで検出', () => {
  it('往復 2 ストロークで開始する', () => {
    const r = new GestureRecognizer()
    const events = run(r, strokes({ count: 3, amplitude: 20 }))
    expect(events.filter((e) => e.type === 'patStart')).toHaveLength(1)
    expect(r.isPatting).toBe(true)
  })

  it('振幅が小さすぎるとストロークにならない（微振動を拾わない）', () => {
    const r = new GestureRecognizer()
    const events = run(r, strokes({ count: 10, amplitude: PAT_PARAMS.minStrokeDip - 2 }))
    expect(events.filter((e) => e.type === 'patStart')).toHaveLength(0)
    expect(r.isPatting).toBe(false)
  })

  it('ゆっくりすぎる往復では開始しない（時間窓の外）', () => {
    const r = new GestureRecognizer()
    const events = run(r, strokes({ count: 4, amplitude: 20, intervalMs: 5000 }))
    expect(events.filter((e) => e.type === 'patStart')).toHaveLength(0)
  })

  it('ストローク数で 3 段階に変わる', () => {
    const r = new GestureRecognizer()
    const events = run(r, strokes({ count: 12, amplitude: 20 }))
    const tiers = events.filter((e) => e.type === 'patStroke').map((e) => e.tier)
    expect(tiers).toContain('soft')
    expect(tiers).toContain('happy')
    expect(tiers).toContain('bliss')
    // soft → happy → bliss の順に現れ、逆行しない
    const order = { soft: 0, happy: 1, bliss: 2 }
    for (let i = 1; i < tiers.length; i++) {
      expect(order[tiers[i]!]).toBeGreaterThanOrEqual(order[tiers[i - 1]!])
    }
  })

  it('境界のストローク数で段階が切り替わる', () => {
    const r = new GestureRecognizer()
    const events = run(r, strokes({ count: 12, amplitude: 20 }))
    const byStroke = new Map(
      events.filter((e) => e.type === 'patStroke').map((e) => [e.strokes, e.tier]),
    )
    expect(byStroke.get(PAT_PARAMS.happyAtStrokes - 1)).toBe('soft')
    expect(byStroke.get(PAT_PARAMS.happyAtStrokes)).toBe('happy')
    expect(byStroke.get(PAT_PARAMS.blissAtStrokes - 1)).toBe('happy')
    expect(byStroke.get(PAT_PARAMS.blissAtStrokes)).toBe('bliss')
  })

  it('頭から離れると終了する', () => {
    const r = new GestureRecognizer()
    run(r, strokes({ count: 4, amplitude: 20 }))
    expect(r.isPatting).toBe(true)

    const off = r.feed({
      position: { x: 500, y: 0 },
      timeMs: 9000,
      overHead: false,
      pressed: false,
    })
    expect(off.some((e) => e.type === 'patEnd')).toBe(true)
    expect(r.isPatting).toBe(false)
  })

  it('ストロークが途切れると終了する', () => {
    const r = new GestureRecognizer()
    run(r, strokes({ count: 4, amplitude: 20 }))
    expect(r.isPatting).toBe(true)

    // 猶予は「最後のサンプル」ではなく「最後のストローク」からなので、
    // 反転を 1 つ与えて基準時刻を確定させる
    // 直前のストロークから猶予内に置かないと、この feed 自体で終了してしまう
    const lastStrokeMs = 1_600
    r.feed({
      position: { x: 100, y: 0 },
      timeMs: lastStrokeMs - 10,
      overHead: true,
      pressed: false,
    })
    r.feed({ position: { x: 0, y: 0 }, timeMs: lastStrokeMs, overHead: true, pressed: false })

    expect(r.tick(lastStrokeMs + PAT_PARAMS.idleTimeoutMs - 1)).toHaveLength(0)
    expect(r.isPatting).toBe(true)

    const ended = r.tick(lastStrokeMs + PAT_PARAMS.idleTimeoutMs + 1)
    expect(ended[0]?.type).toBe('patEnd')
    expect(r.isPatting).toBe(false)
  })

  it('頭の外の往復には反応しない', () => {
    const r = new GestureRecognizer()
    const events = run(r, strokes({ count: 8, amplitude: 30, overHead: false }))
    expect(events).toHaveLength(0)
  })

  it('ボタンを押しながらの往復はなでにならない', () => {
    const r = new GestureRecognizer()
    const events = run(r, strokes({ count: 3, amplitude: 30, pressed: true }))
    expect(events.filter((e) => e.type === 'patStart')).toHaveLength(0)
  })

  it('reset で状態が消える', () => {
    const r = new GestureRecognizer()
    run(r, strokes({ count: 4, amplitude: 20 }))
    r.reset()
    expect(r.isPatting).toBe(false)
  })
})

describe('ふる検出', () => {
  it('ドラッグ中に素早く 4 回反転させると発火する', () => {
    const r = new GestureRecognizer()
    const events = run(
      r,
      strokes({
        count: 5,
        amplitude: SHAKE_PARAMS.minAmplitudeDip + 10,
        intervalMs: 60,
        pressed: true,
      }),
    )
    expect(events.filter((e) => e.type === 'shake').length).toBeGreaterThanOrEqual(1)
  })

  it('振幅が足りなければ発火しない（普通のドラッグを誤検出しない）', () => {
    const r = new GestureRecognizer()
    const events = run(
      r,
      strokes({
        count: 10,
        amplitude: SHAKE_PARAMS.minAmplitudeDip - 5,
        intervalMs: 60,
        pressed: true,
      }),
    )
    expect(events.filter((e) => e.type === 'shake')).toHaveLength(0)
  })

  it('ゆっくりした往復では発火しない（時間窓の外）', () => {
    const r = new GestureRecognizer()
    const events = run(r, strokes({ count: 10, amplitude: 50, intervalMs: 400, pressed: true }))
    expect(events.filter((e) => e.type === 'shake')).toHaveLength(0)
  })

  it('一直線のドラッグでは発火しない', () => {
    const r = new GestureRecognizer()
    const samples: PointerSample[] = []
    for (let i = 0; i < 30; i++) {
      samples.push({
        position: { x: i * 20, y: 0 },
        timeMs: 1000 + i * 16,
        overHead: false,
        pressed: true,
      })
    }
    expect(run(r, samples).filter((e) => e.type === 'shake')).toHaveLength(0)
  })

  it('ボタンを離していればふるにならない', () => {
    const r = new GestureRecognizer()
    const events = run(
      r,
      strokes({ count: 8, amplitude: 50, intervalMs: 60, pressed: false, overHead: false }),
    )
    expect(events.filter((e) => e.type === 'shake')).toHaveLength(0)
  })
})

describe('なでとふるの排他', () => {
  it('なで中にボタンを押すとなでが終了する', () => {
    const r = new GestureRecognizer()
    run(r, strokes({ count: 4, amplitude: 20 }))
    expect(r.isPatting).toBe(true)

    const pressed = r.feed({
      position: { x: 0, y: 0 },
      timeMs: 9000,
      overHead: true,
      pressed: true,
    })
    expect(pressed.some((e) => e.type === 'patEnd')).toBe(true)
    expect(r.isPatting).toBe(false)
  })
})
