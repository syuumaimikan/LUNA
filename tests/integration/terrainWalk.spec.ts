import { describe, expect, it } from 'vitest'
import type { Rect, Surface } from '../../src/shared/types/geometry.js'
import { pointAt } from '../../src/shared/types/geometry.js'
import type { AttachedTo, Facing } from '../../src/shared/types/actor.js'
import { SeededRng } from '../../src/shared/rng.js'
import {
  scaleDipConverter,
  type DisplayInfo,
  type Win32Window,
} from '../../src/main/platform/win32/types.js'
import { TerrainService } from '../../src/main/terrain/TerrainService.js'
import { TerrainMap } from '../../src/renderer/overlay/TerrainMap.js'
import { FreeFallIntegrator } from '../../src/renderer/overlay/Physics.js'
import {
  advanceAlongSurface,
  followMovedSurface,
  resolveCorner,
} from '../../src/renderer/overlay/Locomotion.js'

/**
 * 地形パイプライン全体の結合テスト。
 *
 * Win32 の列挙結果 → TerrainService（面の生成と差分） → TerrainMap（空間索引）
 * → Locomotion（接着移動とコーナー遷移） → Physics（落下）を実際につないで、
 * ROADMAP の M3 完了条件をヘッドレスで確かめる。
 * ここが通れば、残るのは描画と koffi 束縛だけになる。
 */

const identity = scaleDipConverter(1)
const rect = (l: number, t: number, r: number, b: number): Rect => ({
  left: l,
  top: t,
  right: r,
  bottom: b,
})

const DISPLAY: DisplayInfo = {
  id: 'd1',
  bounds: rect(0, 0, 1920, 1080),
  workArea: rect(0, 0, 1920, 1040),
  scaleFactor: 1,
}
const GROUND_Y = 1040

const editor = (over: Partial<Win32Window> = {}): Win32Window => ({
  hwnd: 100,
  rect: rect(400, 300, 1200, 800),
  isVisible: true,
  isMinimized: false,
  isCloaked: false,
  isToolWindow: false,
  zOrder: 0,
  ...over,
})

const OPTS = { climbWindows: true, keepOnScreen: false, ownHwnds: new Set<number>() }

/** TerrainService の出力を TerrainMap に流し込む、実際の配線と同じ形 */
function pipeline() {
  const service = new TerrainService()
  const map = new TerrainMap()
  return {
    map,
    sync(windows: Win32Window[], displays: DisplayInfo[] = [DISPLAY]) {
      const r = service.update(windows, displays, identity, OPTS)
      map.apply(r.patch)
      return r
    },
  }
}

/** 接着したまま面に沿って歩き、端に着いたら結果を返す */
function walkUntilEdge(
  map: TerrainMap,
  attachment: AttachedTo,
  facing: Facing,
  speed = 42,
): { attachment: AttachedTo; steps: number } {
  let t = attachment.t
  for (let i = 0; i < 10_000; i++) {
    const surface = map.get(attachment.surfaceId)
    if (!surface) throw new Error('面が消えた')
    const r = advanceAlongSurface(surface, t, facing, speed, 1 / 60)
    t = r.t
    if (r.reachedEdge) return { attachment: { ...attachment, t }, steps: i }
  }
  throw new Error('端に到達しなかった')
}

describe('地形パイプラインの結合', () => {
  it('ウィンドウのタイトルバーの上を歩き、端で側面へ回り込む', () => {
    const { map, sync } = pipeline()
    sync([editor()])

    const top = map.get('hwnd:100:top')
    expect(top?.kind).toBe('floor')

    // 天板の左端から右へ歩く
    const walked = walkUntilEdge(map, { mode: 'stand', surfaceId: 'hwnd:100:top', t: 0 }, 'right')
    expect(walked.steps).toBeGreaterThan(0)

    const outcome = resolveCorner({
      terrain: map,
      rng: new SeededRng(1),
      attachment: walked.attachment,
      facing: 'right',
      curiosity: 0.6,
      groundY: GROUND_Y,
      climbWindows: true,
      diveFrequency: 'never',
    })

    expect(outcome.kind).toBe('transfer')
    if (outcome.kind !== 'transfer') return
    expect(outcome.attachment.surfaceId).toBe('hwnd:100:right')
    expect(outcome.attachment.mode).toBe('cling') // 壁に張り付く
  })

  it('側面を降りきると下端にぶら下がる', () => {
    const { map, sync } = pipeline()
    sync([editor()])

    const down = walkUntilEdge(
      map,
      { mode: 'cling', surfaceId: 'hwnd:100:right', t: 0 },
      'right',
      28,
    )
    const outcome = resolveCorner({
      terrain: map,
      rng: new SeededRng(1),
      attachment: down.attachment,
      facing: 'right',
      curiosity: 0.6,
      groundY: GROUND_Y,
      climbWindows: true,
      diveFrequency: 'never',
    })

    expect(outcome.kind).toBe('transfer')
    if (outcome.kind !== 'transfer') return
    expect(outcome.attachment.surfaceId).toBe('hwnd:100:bottom')
    expect(outcome.attachment.mode).toBe('hang')
  })

  it('乗っているウィンドウを動かすとキャラも付いてくる', () => {
    const { map, sync } = pipeline()
    sync([editor()])

    const before = map.get('hwnd:100:top')!
    const t = 0.5
    const posBefore = pointAt(before, t)

    sync([editor({ rect: rect(440, 320, 1240, 820) })])
    const after = map.get('hwnd:100:top')!

    const follow = followMovedSurface(before, after, t)
    expect(follow.shakenOff).toBe(false)
    expect(follow.position.x).toBeCloseTo(posBefore.x + 40, 6)
    expect(follow.position.y).toBeCloseTo(posBefore.y + 20, 6)
  })

  it('ウィンドウを速く振り回すと振り落とされる', () => {
    const { map, sync } = pipeline()
    sync([editor()])
    const before = map.get('hwnd:100:top')!

    sync([editor({ rect: rect(900, 300, 1700, 800) })]) // 500dip 一気に移動
    const after = map.get('hwnd:100:top')!

    expect(followMovedSurface(before, after, 0.5).shakenOff).toBe(true)
  })

  it('乗っているウィンドウを閉じると落下して床に着地する', () => {
    const { map, sync } = pipeline()
    sync([editor()])

    const top = map.get('hwnd:100:top')!
    const standing = pointAt(top, 0.5)

    // ウィンドウが消える
    sync([])
    expect(map.get('hwnd:100:top')).toBeUndefined()

    // 接着先を失ったので自由落下
    const body = { position: { ...standing }, velocity: { x: 0, y: 0 } }
    const physics = new FreeFallIntegrator(map)
    let landed: Surface | null = null
    for (let i = 0; i < 600 && !landed; i++) landed = physics.advance(body, 1 / 60).surface

    expect(landed?.id).toBe('display:d1:floor')
    expect(body.position.y).toBe(GROUND_Y)
  })

  it('落下中に別のウィンドウの天板があればそこに着地する', () => {
    const { map, sync } = pipeline()
    const lower = editor({ hwnd: 200, zOrder: 1, rect: rect(300, 900, 1300, 1000) })
    sync([editor(), lower])

    const start = pointAt(map.get('hwnd:100:top')!, 0.5)
    sync([lower]) // 上の窓だけ閉じる

    const body = { position: { ...start }, velocity: { x: 0, y: 0 } }
    const physics = new FreeFallIntegrator(map)
    let landed: Surface | null = null
    for (let i = 0; i < 600 && !landed; i++) landed = physics.advance(body, 1 / 60).surface

    expect(landed?.id).toBe('hwnd:200:top')
    expect(body.position.y).toBe(900)
  })

  it('全画面アプリが出ると窓の面が消え、退避対象が報告される', () => {
    const { map, sync } = pipeline()
    sync([editor()])
    expect(map.get('hwnd:100:top')).toBeDefined()

    const r = sync([
      editor(),
      { ...editor({ hwnd: 300, zOrder: 0 }), rect: rect(0, 0, 1920, 1080) },
    ])
    expect(r.fullscreenDisplayIds).toEqual(['d1'])
    // 全画面窓自身は面を作らない
    expect(map.get('hwnd:300:top')).toBeUndefined()
  })

  it('仮想デスクトップを切り替えても別ページの窓が地形に混ざらない', () => {
    const { map, sync } = pipeline()
    sync([editor()])
    expect(map.get('hwnd:100:top')).toBeDefined()

    // 別ページへ移動 = クローク扱いになる（isVisible は true のまま）
    sync([editor({ isCloaked: true })])
    expect(map.get('hwnd:100:top')).toBeUndefined()
    expect(map.size).toBe(1) // 画面の床だけ
  })

  it('2 画面にまたがる窓の面が両方の画面から引ける', () => {
    const d2: DisplayInfo = {
      id: 'd2',
      bounds: rect(1920, 0, 3840, 1080),
      workArea: rect(1920, 0, 3840, 1040),
      scaleFactor: 1,
    }
    const { map, sync } = pipeline()
    sync([editor({ rect: rect(1700, 300, 2300, 800) })], [DISPLAY, d2])

    const top = map.get('hwnd:100:top')!
    expect(Math.min(top.a.x, top.b.x)).toBeLessThan(1920)
    expect(Math.max(top.a.x, top.b.x)).toBeGreaterThan(1920)
    // どちらの画面の領域から探しても見つかる
    expect(map.queryRect(1750, 250, 1850, 350).map((s) => s.id)).toContain('hwnd:100:top')
    expect(map.queryRect(2100, 250, 2200, 350).map((s) => s.id)).toContain('hwnd:100:top')
  })

  it('角を曲がれる状況では飛び降りない（判定順が 乗り換え→角→dive のため）', () => {
    const { map, sync } = pipeline()
    // 床から十分高く、周囲に足場が無い窓
    sync([editor({ rect: rect(400, 200, 1200, 400) })])

    const walked = walkUntilEdge(map, { mode: 'stand', surfaceId: 'hwnd:100:top', t: 0 }, 'right')
    let dives = 0
    for (let seed = 0; seed < 300; seed++) {
      const outcome = resolveCorner({
        terrain: map,
        rng: new SeededRng(seed),
        attachment: walked.attachment,
        facing: 'right',
        curiosity: 0.6,
        groundY: GROUND_Y,
        climbWindows: true,
        diveFrequency: 'often',
      })
      // 同じ窓の壁があるので通常は transfer。dive はそこを差し置いては起きない
      expect(['transfer', 'dive', 'turn']).toContain(outcome.kind)
      if (outcome.kind === 'dive') dives++
    }
    // 角を曲がれる状況では飛び降りない（判定順が 乗り換え→角→dive のため）
    expect(dives).toBe(0)
  })

  it('登れる壁が無い単独の足場でだけ dive が起きる', () => {
    const map = new TerrainMap()
    // 天板だけを置く（壁も床の近くの面も無い）
    map.add({ id: 'lone', kind: 'floor', a: { x: 400, y: 300 }, b: { x: 1000, y: 300 }, z: 1 })

    let dives = 0
    for (let seed = 0; seed < 400; seed++) {
      const outcome = resolveCorner({
        terrain: map,
        rng: new SeededRng(seed),
        attachment: { mode: 'stand', surfaceId: 'lone', t: 1 },
        facing: 'right',
        curiosity: 0.6,
        groundY: GROUND_Y,
        climbWindows: true,
        diveFrequency: 'often',
      })
      if (outcome.kind === 'dive') dives++
    }
    // 3% × curiosity 0.6 × 2 × often 3 ≈ 10.8%
    expect(dives).toBeGreaterThan(0)
    expect(dives / 400).toBeLessThan(0.25)
  })
})
