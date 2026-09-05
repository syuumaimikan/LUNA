import { describe, expect, it } from 'vitest'
import { DragController, GENTLE_RELEASE_SPEED } from '../../src/renderer/overlay/DragController.js'

describe('DragController', () => {
  it('つかんだ点のずれを保つ', () => {
    const d = new DragController()
    // カーソルはキャラの中心から 20,10 ずれた位置で掴んだ
    d.begin({ x: 100, y: 100 }, { x: 120, y: 110 }, 0)
    expect(d.isDragging).toBe(true)

    // 完全追従させれば、ずれを保った位置になる
    const p = d.move({ x: 200, y: 200 }, 16, 1)
    expect(p).toEqual({ x: 220, y: 210 })
  })

  it('1 フレーム遅れで追従する（ぶら下がっている感じを出す）', () => {
    const d = new DragController()
    d.begin({ x: 0, y: 0 }, { x: 0, y: 0 }, 0)

    const p = d.move({ x: 100, y: 0 }, 16, 0.35)
    expect(p.x).toBeGreaterThan(0)
    expect(p.x).toBeLessThan(100) // 追いついていない
    expect(p.x).toBeCloseTo(35, 5)
  })

  it('追従を繰り返せばカーソルに収束する', () => {
    const d = new DragController()
    d.begin({ x: 0, y: 0 }, { x: 0, y: 0 }, 0)
    let p = { x: 0, y: 0 }
    for (let i = 1; i <= 60; i++) p = d.move({ x: 100, y: 0 }, i * 16)
    expect(p.x).toBeCloseTo(100, 3)
  })

  it('素早く振って離すと投げられる', () => {
    const d = new DragController()
    d.begin({ x: 0, y: 0 }, { x: 0, y: 0 }, 1000)
    for (let i = 1; i <= 6; i++) d.move({ x: i * 100, y: 0 }, 1000 + i * 10, 1)

    const r = d.release(1060)
    expect(r.kind).toBe('thrown')
    expect(Math.abs(r.velocity.x)).toBeGreaterThanOrEqual(GENTLE_RELEASE_SPEED)
    expect(d.isDragging).toBe(false)
  })

  it('ゆっくり離すとそっと置かれる', () => {
    const d = new DragController()
    d.begin({ x: 0, y: 0 }, { x: 0, y: 0 }, 1000)
    // 100ms で 5dip しか動かない
    for (let i = 1; i <= 5; i++) d.move({ x: i, y: 0 }, 1000 + i * 20, 1)

    const r = d.release(1100)
    expect(r.kind).toBe('placed')
    expect(r.velocity).toEqual({ x: 0, y: 0 })
  })

  it('掴んでいなければ離しても静止', () => {
    const d = new DragController()
    expect(d.release(0)).toEqual({ kind: 'placed', velocity: { x: 0, y: 0 } })
  })

  it('掴んでいなければ move は無視される', () => {
    const d = new DragController()
    expect(d.move({ x: 500, y: 500 }, 0)).toEqual({ x: 0, y: 0 })
  })

  it('cancel すると投げ速度が残らない', () => {
    const d = new DragController()
    d.begin({ x: 0, y: 0 }, { x: 0, y: 0 }, 1000)
    for (let i = 1; i <= 6; i++) d.move({ x: i * 100, y: 0 }, 1000 + i * 10, 1)

    d.cancel()
    expect(d.isDragging).toBe(false)
    expect(d.release(1060)).toEqual({ kind: 'placed', velocity: { x: 0, y: 0 } })
  })

  it('古いサンプルは投げ速度に影響しない', () => {
    const d = new DragController()
    d.begin({ x: 0, y: 0 }, { x: 0, y: 0 }, 0)
    // 大きく動いたあと、しばらく止まってから離す
    for (let i = 1; i <= 6; i++) d.move({ x: i * 200, y: 0 }, i * 10, 1)
    for (let i = 1; i <= 10; i++) d.move({ x: 1200, y: 0 }, 100 + i * 20, 1)

    expect(d.release(300).kind).toBe('placed')
  })
})
