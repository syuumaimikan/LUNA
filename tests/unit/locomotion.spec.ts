import { describe, expect, it } from 'vitest'
import type { Surface } from '../../src/shared/types/geometry.js'
import { SeededRng } from '../../src/shared/rng.js'
import { TerrainMap } from '../../src/renderer/overlay/TerrainMap.js'
import {
  advanceAlongSurface,
  DIVE_MIN_HEIGHT,
  followMovedSurface,
  resolveCorner,
  SHAKE_OFF_DISTANCE,
  type CornerContext,
} from '../../src/renderer/overlay/Locomotion.js'

const GROUND_Y = 1000

/** 常に 0 を返す ＝ どんな確率判定も必ず成立する */
const alwaysRng = { next: () => 0 }
/** 常に 1 に近い値 ＝ どんな確率判定も成立しない */
const neverRng = { next: () => 0.999999 }

function ctx(
  over: Partial<CornerContext> & Pick<CornerContext, 'terrain' | 'attachment'>,
): CornerContext {
  return {
    rng: neverRng,
    facing: 'right',
    curiosity: 0.6,
    groundY: GROUND_Y,
    climbWindows: true,
    diveFrequency: 'rare',
    ...over,
  }
}

/** ウィンドウ矩形から 4 面を作る（TerrainService が M3 で行うのと同じ形） */
function windowSurfaces(
  hwnd: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  z = 5,
): Surface[] {
  const id = (part: string) => `hwnd:${hwnd}:${part}`
  return [
    { id: id('top'), kind: 'floor', a: { x: x0, y: y0 }, b: { x: x1, y: y0 }, ownerHwnd: hwnd, z },
    {
      id: id('bottom'),
      kind: 'ceiling',
      a: { x: x0, y: y1 },
      b: { x: x1, y: y1 },
      ownerHwnd: hwnd,
      z,
    },
    {
      id: id('left'),
      kind: 'wallLeft',
      a: { x: x0, y: y0 },
      b: { x: x0, y: y1 },
      ownerHwnd: hwnd,
      z,
    },
    {
      id: id('right'),
      kind: 'wallRight',
      a: { x: x1, y: y0 },
      b: { x: x1, y: y1 },
      ownerHwnd: hwnd,
      z,
    },
  ]
}

function terrain(...s: Surface[]): TerrainMap {
  const t = new TerrainMap()
  for (const x of s) t.add(x)
  return t
}

describe('resolveCorner — 4分岐', () => {
  it('1. 近くに別の足場があれば乗り換える', () => {
    // 2 つの窓が隣り合っていて、天板の端が 4dip しか離れていない
    const t = terrain(
      ...windowSurfaces(1, 100, 500, 300, 700),
      ...windowSurfaces(2, 304, 500, 500, 700),
    )
    const out = resolveCorner(
      ctx({
        terrain: t,
        attachment: { mode: 'stand', surfaceId: 'hwnd:1:top', t: 1 },
        facing: 'right',
      }),
    )
    expect(out.kind).toBe('transfer')
    if (out.kind !== 'transfer') return
    expect(out.attachment.surfaceId).toBe('hwnd:2:top')
    expect(out.attachment.mode).toBe('stand')
  })

  it('2. 乗り換え先が無ければ同じ窓の角を曲がって壁へ移る', () => {
    const t = terrain(...windowSurfaces(1, 100, 500, 300, 700))
    const out = resolveCorner(
      ctx({
        terrain: t,
        attachment: { mode: 'stand', surfaceId: 'hwnd:1:top', t: 1 },
        facing: 'right',
      }),
    )
    expect(out.kind).toBe('transfer')
    if (out.kind !== 'transfer') return
    // 天板の右端 → 右の壁
    expect(out.attachment.surfaceId).toBe('hwnd:1:right')
    expect(out.attachment.mode).toBe('cling')
    expect(out.facing).toBe('right') // 下向きに登り始める
    expect(out.animation).toBe('cornerOut')
  })

  it('3. 孤立した高い足場では飛び降りることがある', () => {
    // 周囲に何も無い、床から 500dip の高さの単独の面
    const lone: Surface = {
      id: 'lone',
      kind: 'floor',
      a: { x: 0, y: 500 },
      b: { x: 200, y: 500 },
      z: 1,
    }
    const out = resolveCorner(
      ctx({
        terrain: terrain(lone),
        attachment: { mode: 'stand', surfaceId: 'lone', t: 1 },
        rng: alwaysRng,
        diveFrequency: 'often',
      }),
    )
    expect(out.kind).toBe('dive')
  })

  it('3b. 低い足場では飛び降りない', () => {
    const low: Surface = {
      id: 'low',
      kind: 'floor',
      a: { x: 0, y: GROUND_Y - DIVE_MIN_HEIGHT + 1 },
      b: { x: 200, y: GROUND_Y - DIVE_MIN_HEIGHT + 1 },
      z: 1,
    }
    const out = resolveCorner(
      ctx({
        terrain: terrain(low),
        attachment: { mode: 'stand', surfaceId: 'low', t: 1 },
        rng: alwaysRng,
        diveFrequency: 'often',
      }),
    )
    expect(out.kind).toBe('turn')
  })

  it('3c. diveFrequency: never なら決して飛び降りない', () => {
    const lone: Surface = {
      id: 'lone',
      kind: 'floor',
      a: { x: 0, y: 300 },
      b: { x: 200, y: 300 },
      z: 1,
    }
    const out = resolveCorner(
      ctx({
        terrain: terrain(lone),
        attachment: { mode: 'stand', surfaceId: 'lone', t: 1 },
        rng: alwaysRng,
        diveFrequency: 'never',
      }),
    )
    expect(out.kind).toBe('turn')
  })

  it('4. 何も無ければ引き返す（向きが反転する）', () => {
    const lone: Surface = {
      id: 'lone',
      kind: 'floor',
      a: { x: 0, y: 300 },
      b: { x: 200, y: 300 },
      z: 1,
    }
    const out = resolveCorner(
      ctx({
        terrain: terrain(lone),
        attachment: { mode: 'stand', surfaceId: 'lone', t: 1 },
        facing: 'right',
      }),
    )
    expect(out).toEqual({ kind: 'turn', facing: 'left' })
  })

  it('消えた面に接着していたら落下する', () => {
    const out = resolveCorner(
      ctx({ terrain: terrain(), attachment: { mode: 'stand', surfaceId: 'gone', t: 0.5 } }),
    )
    expect(out.kind).toBe('fall')
  })

  it('climbWindows が OFF ならウィンドウの面へは移らない', () => {
    const t = terrain(...windowSurfaces(1, 100, 500, 300, 700))
    const out = resolveCorner(
      ctx({
        terrain: t,
        attachment: { mode: 'stand', surfaceId: 'hwnd:1:top', t: 1 },
        climbWindows: false,
      }),
    )
    expect(out.kind).toBe('turn')
  })

  it('乗り換え候補が複数あるときは手前(z が小さい)を選ぶ', () => {
    const t = terrain(
      ...windowSurfaces(1, 100, 500, 300, 700),
      ...windowSurfaces(2, 304, 500, 500, 700, 9), // 奥
      ...windowSurfaces(3, 305, 500, 500, 700, 2), // 手前
    )
    const out = resolveCorner(
      ctx({ terrain: t, attachment: { mode: 'stand', surfaceId: 'hwnd:1:top', t: 1 } }),
    )
    expect(out.kind).toBe('transfer')
    if (out.kind !== 'transfer') return
    expect(out.attachment.surfaceId).toBe('hwnd:3:top')
  })

  it('左へ歩いて左端に達したら左の壁へ回り込む', () => {
    const t = terrain(...windowSurfaces(1, 100, 500, 300, 700))
    const out = resolveCorner(
      ctx({
        terrain: t,
        attachment: { mode: 'stand', surfaceId: 'hwnd:1:top', t: 0 },
        facing: 'left',
      }),
    )
    expect(out.kind).toBe('transfer')
    if (out.kind !== 'transfer') return
    expect(out.attachment.surfaceId).toBe('hwnd:1:left')
  })

  it('シードを固定すれば dive の判定は再現する', () => {
    const lone: Surface = {
      id: 'lone',
      kind: 'floor',
      a: { x: 0, y: 300 },
      b: { x: 200, y: 300 },
      z: 1,
    }
    const run = () =>
      resolveCorner(
        ctx({
          terrain: terrain(lone),
          attachment: { mode: 'stand', surfaceId: 'lone', t: 1 },
          rng: new SeededRng(12345),
          diveFrequency: 'often',
        }),
      ).kind
    expect(run()).toBe(run())
  })
})

describe('advanceAlongSurface', () => {
  const s: Surface = { id: 'f', kind: 'floor', a: { x: 0, y: 100 }, b: { x: 100, y: 100 }, z: 1 }

  it('速度と時間に応じて t が進む', () => {
    const r = advanceAlongSurface(s, 0, 'right', 50, 1) // 50dip / 長さ100 = 0.5
    expect(r.t).toBeCloseTo(0.5, 6)
    expect(r.reachedEdge).toBe(false)
  })

  it('端に達したら reachedEdge が立ち、t はクランプされる', () => {
    const r = advanceAlongSurface(s, 0.9, 'right', 500, 1)
    expect(r.t).toBe(1)
    expect(r.reachedEdge).toBe(true)
  })

  it('向きによって t の進む方向が変わる', () => {
    const r = advanceAlongSurface(s, 0.5, 'left', 50, 1)
    expect(r.t).toBeCloseTo(0, 6)
  })

  it('a/b が逆順の面でも facing の意味が保たれる', () => {
    const flipped: Surface = {
      id: 'f',
      kind: 'floor',
      a: { x: 100, y: 100 },
      b: { x: 0, y: 100 },
      z: 1,
    }
    // 右へ進むなら x が増える方向 ＝ この面では t が減る方向
    const r = advanceAlongSurface(flipped, 0.5, 'right', 50, 1)
    expect(r.t).toBeCloseTo(0, 6)
  })

  it('長さ 0 の面では即座に端とみなす', () => {
    const degenerate: Surface = {
      id: 'd',
      kind: 'floor',
      a: { x: 5, y: 5 },
      b: { x: 5, y: 5 },
      z: 1,
    }
    expect(advanceAlongSurface(degenerate, 0.5, 'right', 50, 1)).toEqual({
      t: 0,
      reachedEdge: true,
    })
  })
})

describe('followMovedSurface', () => {
  const before: Surface = {
    id: 'w',
    kind: 'floor',
    a: { x: 0, y: 100 },
    b: { x: 200, y: 100 },
    z: 1,
  }

  it('ゆっくり動くウィンドウには乗ったまま追従する', () => {
    const after: Surface = { ...before, a: { x: 10, y: 100 }, b: { x: 210, y: 100 } }
    const r = followMovedSurface(before, after, 0.5)
    expect(r.shakenOff).toBe(false)
    expect(r.position).toEqual({ x: 110, y: 100 })
  })

  it('急に振り回されたら振り落とされる', () => {
    const far = SHAKE_OFF_DISTANCE + 1
    const after: Surface = { ...before, a: { x: far, y: 100 }, b: { x: 200 + far, y: 100 } }
    expect(followMovedSurface(before, after, 0.5).shakenOff).toBe(true)
  })

  it('しきい値ちょうどでは振り落とされない', () => {
    const after: Surface = {
      ...before,
      a: { x: SHAKE_OFF_DISTANCE, y: 100 },
      b: { x: 200 + SHAKE_OFF_DISTANCE, y: 100 },
    }
    expect(followMovedSurface(before, after, 0.5).shakenOff).toBe(false)
  })
})
