import { describe, expect, it } from 'vitest'
import type { Surface } from '../../src/shared/types/geometry.js'
import {
  FreeFallIntegrator,
  PHYSICS_DEFAULTS,
  throwVelocity,
} from '../../src/renderer/overlay/Physics.js'
import { TerrainMap } from '../../src/renderer/overlay/TerrainMap.js'

const floor = (id: string, y: number, x0 = 0, x1 = 1000, z = 10): Surface => ({
  id,
  kind: 'floor',
  a: { x: x0, y },
  b: { x: x1, y },
  z,
})

function terrainWith(...s: Surface[]): TerrainMap {
  const t = new TerrainMap()
  for (const x of s) t.add(x)
  return t
}

describe('FreeFallIntegrator', () => {
  it('落下して床に着地する', () => {
    const t = terrainWith(floor('ground', 800))
    const it_ = new FreeFallIntegrator(t)
    const body = { position: { x: 100, y: 0 }, velocity: { x: 0, y: 0 } }

    let landed: Surface | null = null
    for (let i = 0; i < 600 && !landed; i++) landed = it_.advance(body, 1 / 60).surface

    expect(landed?.id).toBe('ground')
    expect(body.position.y).toBe(800)
    expect(body.velocity).toEqual({ x: 0, y: 0 })
  })

  it('描画フレームレートが違っても同じ位置に着地する（固定タイムステップ）', () => {
    const run = (dt: number) => {
      const it_ = new FreeFallIntegrator(terrainWith(floor('ground', 900)))
      const body = { position: { x: 0, y: 0 }, velocity: { x: 200, y: 0 } }
      let landed: Surface | null = null
      for (let i = 0; i < 2000 && !landed; i++) landed = it_.advance(body, dt).surface
      return body.position
    }
    const at60 = run(1 / 60)
    const at30 = run(1 / 30)
    const at10 = run(1 / 10)

    expect(at30.x).toBeCloseTo(at60.x, 6)
    expect(at10.x).toBeCloseTo(at60.x, 6)
    expect(at30.y).toBe(at60.y)
  })

  it('高速落下でも薄い床をすり抜けない（スイープ判定）', () => {
    const t = terrainWith(floor('thin', 500))
    const it_ = new FreeFallIntegrator(t)
    // 終端速度で真下へ。1 ステップの移動量は 2400/120 = 20dip
    const body = { position: { x: 50, y: 0 }, velocity: { x: 0, y: 2400 } }

    let landed: Surface | null = null
    for (let i = 0; i < 200 && !landed; i++) landed = it_.advance(body, 1 / 60).surface

    expect(landed?.id).toBe('thin')
    expect(body.position.y).toBe(500)
  })

  it('着地時に一度跳ねる', () => {
    const it_ = new FreeFallIntegrator(terrainWith(floor('ground', 400)))
    const body = { position: { x: 10, y: 0 }, velocity: { x: 0, y: 0 } }
    let bounces = 0
    let landed: Surface | null = null
    for (let i = 0; i < 1200 && !landed; i++) {
      const r = it_.advance(body, 1 / 120)
      bounces += r.bounces
      landed = r.surface
    }
    expect(bounces).toBeGreaterThan(0)
    expect(landed?.id).toBe('ground')
  })

  it('床の範囲外は通り抜ける', () => {
    const it_ = new FreeFallIntegrator(terrainWith(floor('narrow', 300, 0, 100)))
    const body = { position: { x: 500, y: 0 }, velocity: { x: 0, y: 0 } }
    let landed: Surface | null = null
    for (let i = 0; i < 120; i++) landed = it_.advance(body, 1 / 60).surface
    expect(landed).toBeNull()
    expect(body.position.y).toBeGreaterThan(300)
  })

  it('天井とウィンドウの壁は落下中に通過する（DESIGN §8.1 の非対称な扱い）', () => {
    const t = terrainWith(
      { id: 'ceil', kind: 'ceiling', a: { x: 0, y: 200 }, b: { x: 1000, y: 200 }, z: 1 },
      { id: 'wall', kind: 'wallLeft', a: { x: 100, y: 0 }, b: { x: 100, y: 600 }, z: 1 },
      floor('ground', 800),
    )
    const it_ = new FreeFallIntegrator(t)
    const body = { position: { x: 100, y: 0 }, velocity: { x: 0, y: 0 } }
    let landed: Surface | null = null
    for (let i = 0; i < 600 && !landed; i++) landed = it_.advance(body, 1 / 60).surface
    expect(landed?.id).toBe('ground')
  })

  it('画面端の壁を越えず、反発係数ぶんの速度で跳ね返る', () => {
    const it_ = new FreeFallIntegrator(terrainWith(floor('ground', 800)))
    const body = { position: { x: 500, y: 0 }, velocity: { x: 1000, y: 0 } }
    const maxX = 520

    let reversed = false
    for (let i = 0; i < 10; i++) {
      it_.advance(body, 1 / 60, { minX: 0, maxX })
      // 壁を越えないことが本質的な不変条件。クランプ後も同じフレーム内の
      // 次のサブステップで内側へ動くため、位置が壁ちょうどになるとは限らない
      expect(body.position.x).toBeLessThanOrEqual(maxX)
      if (!reversed && body.velocity.x < 0) {
        expect(Math.abs(body.velocity.x)).toBeCloseTo(1000 * PHYSICS_DEFAULTS.restitution, 5)
        reversed = true
      }
    }
    expect(reversed).toBe(true)
  })

  it('画面左端でも同様に反発する', () => {
    const it_ = new FreeFallIntegrator(terrainWith(floor('ground', 800)))
    const body = { position: { x: 20, y: 0 }, velocity: { x: -1000, y: 0 } }

    let reversed = false
    for (let i = 0; i < 10; i++) {
      it_.advance(body, 1 / 60, { minX: 0, maxX: 520 })
      expect(body.position.x).toBeGreaterThanOrEqual(0)
      if (!reversed && body.velocity.x > 0) {
        expect(body.velocity.x).toBeCloseTo(1000 * PHYSICS_DEFAULTS.restitution, 5)
        reversed = true
      }
    }
    expect(reversed).toBe(true)
  })

  it('壁を指定しなければ画面外へ出ていく（設定「画面外に出ない」OFF）', () => {
    const it_ = new FreeFallIntegrator(terrainWith(floor('ground', 800)))
    const body = { position: { x: 500, y: 0 }, velocity: { x: 1000, y: 0 } }
    for (let i = 0; i < 10; i++) it_.advance(body, 1 / 60)
    expect(body.position.x).toBeGreaterThan(520)
  })
})

describe('throwVelocity', () => {
  it('直近 100ms の平均速度に倍率を掛ける', () => {
    const v = throwVelocity(
      [
        { position: { x: 0, y: 0 }, timeMs: 1000 },
        { position: { x: 50, y: 0 }, timeMs: 1050 },
      ],
      1050,
    )
    // 50dip / 0.05s = 1000dip/s、×1.2 = 1200
    expect(v.x).toBeCloseTo(1200, 5)
  })

  it('100ms より古いサンプルは無視する', () => {
    const v = throwVelocity(
      [
        { position: { x: -9999, y: 0 }, timeMs: 0 },
        { position: { x: 0, y: 0 }, timeMs: 1000 },
        { position: { x: 10, y: 0 }, timeMs: 1050 },
      ],
      1050,
    )
    expect(v.x).toBeCloseTo(240, 5)
  })

  it('上限速度でクランプされる', () => {
    const v = throwVelocity(
      [
        { position: { x: 0, y: 0 }, timeMs: 0 },
        { position: { x: 10000, y: 0 }, timeMs: 10 },
      ],
      10,
    )
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(PHYSICS_DEFAULTS.maxThrowSpeed, 5)
  })

  it('サンプルが足りなければ静止', () => {
    expect(throwVelocity([{ position: { x: 0, y: 0 }, timeMs: 0 }], 0)).toEqual({ x: 0, y: 0 })
  })
})
