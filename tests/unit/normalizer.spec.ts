import { describe, expect, it } from 'vitest'
import {
  Ema,
  LoadSignal,
  SchmittTrigger,
  SustainedCondition,
} from '../../src/main/sensor/Normalizer.js'

describe('Ema', () => {
  it('最初の値はそのまま', () => {
    expect(new Ema(0.3).push(50)).toBe(50)
  })

  it('スパイクを鈍らせる', () => {
    const e = new Ema(0.3)
    e.push(10)
    const after = e.push(100)
    expect(after).toBeGreaterThan(10)
    expect(after).toBeLessThan(100)
    expect(after).toBeCloseTo(0.3 * 100 + 0.7 * 10, 6)
  })

  it('一定値を与え続ければ収束する', () => {
    const e = new Ema(0.3)
    for (let i = 0; i < 100; i++) e.push(80)
    expect(e.current).toBeCloseTo(80, 5)
  })
})

describe('SchmittTrigger', () => {
  it('onAt で ON、offAt まで下がって OFF', () => {
    const t = new SchmittTrigger(80, 65)
    expect(t.push(79)).toBeNull()
    expect(t.push(80)).toBe('enter')
    expect(t.isOn).toBe(true)

    // 80 を割っても 65 までは ON のまま
    expect(t.push(70)).toBeNull()
    expect(t.push(66)).toBeNull()
    expect(t.isOn).toBe(true)

    expect(t.push(65)).toBe('exit')
    expect(t.isOn).toBe(false)
  })

  it('しきい値の境界で振動しない', () => {
    const t = new SchmittTrigger(80, 65)
    t.push(85)
    let edges = 0
    // 78-82 を往復させる。ヒステリシスが無ければここで何度も切り替わる
    for (let i = 0; i < 100; i++) if (t.push(i % 2 ? 78 : 82) !== null) edges++
    expect(edges).toBe(0)
  })

  it('継続中はエッジを返さない', () => {
    const t = new SchmittTrigger(80, 65)
    expect(t.push(90)).toBe('enter')
    expect(t.push(95)).toBeNull()
    expect(t.push(99)).toBeNull()
  })

  it('offAt > onAt は設定できない', () => {
    expect(() => new SchmittTrigger(65, 80)).toThrow()
  })
})

describe('SustainedCondition', () => {
  it('指定秒数続いてはじめて 1 度だけ発火する', () => {
    const s = new SustainedCondition(30)
    let t = 0
    expect(s.push(true, t)).toBe(false)

    t += 29_000
    expect(s.push(true, t)).toBe(false)

    t += 2_000
    expect(s.push(true, t)).toBe(true)

    // 以降は続いていても再発火しない
    t += 60_000
    expect(s.push(true, t)).toBe(false)
  })

  it('途中で条件が切れたらやり直し', () => {
    const s = new SustainedCondition(30)
    s.push(true, 0)
    s.push(true, 20_000)
    s.push(false, 21_000)

    // 再開後は改めて 30 秒必要
    s.push(true, 22_000)
    expect(s.push(true, 45_000)).toBe(false)
    expect(s.push(true, 53_000)).toBe(true)
  })

  it('OFF に戻れば再び発火できる', () => {
    const s = new SustainedCondition(10)
    s.push(true, 0)
    expect(s.push(true, 11_000)).toBe(true)
    s.push(false, 12_000)
    s.push(true, 13_000)
    expect(s.push(true, 24_000)).toBe(true)
  })
})

describe('LoadSignal（CPU の一連の流れ）', () => {
  it('瞬間的なスパイクでは high にならない', () => {
    const sig = new LoadSignal({ onAt: 80, offAt: 65, sustainedSec: 30 })
    sig.push(5, 0)
    sig.push(5, 3000)
    const r = sig.push(100, 6000) // 1 回だけ跳ねた
    expect(r.edge).toBeNull()
    expect(sig.isHigh).toBe(false)
  })

  it('高負荷が続けば high になり、さらに続けば sustained が 1 度だけ立つ', () => {
    const sig = new LoadSignal({ onAt: 80, offAt: 65, sustainedSec: 30 })
    let t = 0
    let entered = false
    let sustainedCount = 0

    for (let i = 0; i < 40; i++) {
      const r = sig.push(95, t)
      if (r.edge === 'enter') entered = true
      if (r.sustained) sustainedCount++
      t += 3000
    }

    expect(entered).toBe(true)
    expect(sustainedCount).toBe(1)
  })

  it('負荷が下がれば exit する', () => {
    const sig = new LoadSignal({ onAt: 80, offAt: 65, sustainedSec: 30 })
    let t = 0
    for (let i = 0; i < 20; i++) sig.push(95, (t += 3000))
    expect(sig.isHigh).toBe(true)

    let exited = false
    for (let i = 0; i < 20; i++) {
      if (sig.push(10, (t += 3000)).edge === 'exit') exited = true
    }
    expect(exited).toBe(true)
    expect(sig.isHigh).toBe(false)
  })
})
