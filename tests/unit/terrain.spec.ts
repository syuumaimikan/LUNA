import { describe, expect, it } from 'vitest'
import type { Surface } from '../../src/shared/types/geometry.js'
import { distanceToSurface, paramAt, pointAt } from '../../src/shared/types/geometry.js'
import { TerrainMap } from '../../src/renderer/overlay/TerrainMap.js'

const floor = (id: string, y: number, x0: number, x1: number): Surface => ({
  id,
  kind: 'floor',
  a: { x: x0, y },
  b: { x: x1, y },
  z: 1,
})

describe('TerrainMap', () => {
  it('追加・取得・削除ができる', () => {
    const t = new TerrainMap()
    t.add(floor('a', 100, 0, 200))
    expect(t.size).toBe(1)
    expect(t.get('a')?.kind).toBe('floor')
    t.remove('a')
    expect(t.size).toBe(0)
    expect(t.get('a')).toBeUndefined()
  })

  it('同じ id を再追加すると置き換わる（セルに残骸を残さない）', () => {
    const t = new TerrainMap()
    t.add(floor('a', 100, 0, 200))
    t.add(floor('a', 900, 5000, 5200))
    expect(t.size).toBe(1)
    // 旧位置のセルに残っていたら、ここで拾えてしまう
    expect(t.queryRect(0, 0, 300, 300).map((s) => s.id)).toEqual([])
    expect(t.queryRect(4900, 800, 5300, 1000).map((s) => s.id)).toEqual(['a'])
  })

  it('差分パッチを適用できる', () => {
    const t = new TerrainMap()
    t.apply({ added: [floor('a', 100, 0, 200), floor('b', 300, 0, 200)] })
    expect(t.size).toBe(2)

    t.apply({ removed: ['a'], moved: [floor('b', 500, 0, 200)] })
    expect(t.size).toBe(1)
    expect(t.get('b')?.a.y).toBe(500)
  })

  it('セルを跨ぐ長い面も全域で拾える', () => {
    const t = new TerrainMap()
    t.add(floor('long', 50, 0, 2000)) // CELL=128 なので 16 セル弱に跨る
    expect(t.queryRect(1900, 0, 1950, 100).map((s) => s.id)).toEqual(['long'])
    expect(t.queryRect(0, 0, 10, 100).map((s) => s.id)).toEqual(['long'])
  })

  it('near は半径内の面だけを近い順に返す', () => {
    const t = new TerrainMap()
    t.add(floor('close', 100, 0, 200))
    t.add(floor('far', 160, 0, 200))
    t.add(floor('outside', 400, 0, 200))

    const found = t.near({ x: 50, y: 98 }, 70).map((s) => s.id)
    expect(found).toEqual(['close', 'far'])
  })

  it('queryRect は重複を返さない', () => {
    const t = new TerrainMap()
    t.add(floor('long', 50, 0, 2000))
    expect(t.queryRect(0, 0, 2000, 100)).toHaveLength(1)
  })
})

describe('面上の座標計算', () => {
  const s = floor('a', 100, 200, 600)

  it('t から座標', () => {
    expect(pointAt(s, 0)).toEqual({ x: 200, y: 100 })
    expect(pointAt(s, 1)).toEqual({ x: 600, y: 100 })
    expect(pointAt(s, 0.5)).toEqual({ x: 400, y: 100 })
  })

  it('座標から t（面外はクランプ）', () => {
    expect(paramAt(s, { x: 400, y: 100 })).toBeCloseTo(0.5, 6)
    expect(paramAt(s, { x: -1000, y: 100 })).toBe(0)
    expect(paramAt(s, { x: 9999, y: 100 })).toBe(1)
  })

  it('点と面の距離', () => {
    expect(distanceToSurface(s, { x: 400, y: 130 })).toBeCloseTo(30, 6)
    // 面の外側にある点は端点からの距離になる
    expect(distanceToSurface(s, { x: 100, y: 100 })).toBeCloseTo(100, 6)
  })
})
