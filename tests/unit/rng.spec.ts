import { describe, expect, it } from 'vitest'
import { chance, int, range, SeededRng, weightedPick } from '../../src/shared/rng.js'

describe('SeededRng', () => {
  it('同じシードなら同じ列を返す', () => {
    const a = new SeededRng(12345)
    const b = new SeededRng(12345)
    for (let i = 0; i < 50; i++) expect(a.next()).toBe(b.next())
  })

  it('違うシードなら違う列になる', () => {
    const a = new SeededRng(1)
    const b = new SeededRng(2)
    const sameCount = Array.from({ length: 50 }, () =>
      a.next() === b.next() ? 1 : 0,
    ).reduce<number>((x, y) => x + y, 0)
    expect(sameCount).toBe(0)
  })

  it('[0, 1) の範囲に収まる', () => {
    const r = new SeededRng(7)
    for (let i = 0; i < 10_000; i++) {
      const v = r.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('おおむね一様に分布する', () => {
    const r = new SeededRng(99)
    const buckets = new Array<number>(10).fill(0)
    const n = 100_000
    for (let i = 0; i < n; i++) buckets[Math.floor(r.next() * 10)]!++
    for (const b of buckets) expect(Math.abs(b - n / 10) / (n / 10)).toBeLessThan(0.05)
  })
})

describe('補助関数', () => {
  it('range は範囲内', () => {
    const r = new SeededRng(3)
    for (let i = 0; i < 1000; i++) {
      const v = range(r, 5, 10)
      expect(v).toBeGreaterThanOrEqual(5)
      expect(v).toBeLessThan(10)
    }
  })

  it('int は 0..n-1', () => {
    const r = new SeededRng(3)
    const seen = new Set<number>()
    for (let i = 0; i < 1000; i++) seen.add(int(r, 4))
    expect([...seen].sort()).toEqual([0, 1, 2, 3])
  })

  it('chance(0) は常に false、chance(1) は常に true', () => {
    const r = new SeededRng(3)
    for (let i = 0; i < 100; i++) {
      expect(chance(r, 0)).toBe(false)
      expect(chance(r, 1)).toBe(true)
    }
  })
})

describe('weightedPick', () => {
  it('重みに比例して選ばれる', () => {
    const r = new SeededRng(5)
    const items = [
      { id: 'a', w: 75 },
      { id: 'b', w: 25 },
    ]
    const counts: Record<string, number> = { a: 0, b: 0 }
    for (let i = 0; i < 20_000; i++) counts[weightedPick(r, items, (x) => x.w)!.id]!++
    expect(counts['a']! / 20_000).toBeCloseTo(0.75, 1)
  })

  it('重み 0 の要素は選ばれない', () => {
    const r = new SeededRng(5)
    const items = [
      { id: 'a', w: 1 },
      { id: 'never', w: 0 },
    ]
    for (let i = 0; i < 500; i++) expect(weightedPick(r, items, (x) => x.w)!.id).toBe('a')
  })

  it('負の重みは 0 として扱う', () => {
    const r = new SeededRng(5)
    const items = [
      { id: 'a', w: 1 },
      { id: 'neg', w: -100 },
    ]
    for (let i = 0; i < 500; i++) expect(weightedPick(r, items, (x) => x.w)!.id).toBe('a')
  })

  it('候補が空、または重みの合計が 0 なら null', () => {
    const r = new SeededRng(5)
    expect(weightedPick(r, [], () => 1)).toBeNull()
    expect(weightedPick(r, [{ w: 0 }], (x) => x.w)).toBeNull()
  })
})
