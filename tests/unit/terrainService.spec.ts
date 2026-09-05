import { describe, expect, it } from 'vitest'
import type { Rect } from '../../src/shared/types/geometry.js'
import type { DisplayInfo, Win32Window } from '../../src/main/platform/win32/types.js'
import { scaleDipConverter } from '../../src/main/platform/win32/types.js'
import {
  buildDisplaySurfaces,
  buildWindowSurfaces,
  dropOccluded,
  filterWindows,
  MIN_SURFACE_LENGTH,
  MIN_WINDOW_SIZE,
  type BuildOptions,
} from '../../src/main/terrain/SurfaceBuilder.js'
import {
  isEmptyPatch,
  patchForDisplay,
  scanIntervalMs,
  SCAN_INTERVALS_MS,
  TerrainService,
} from '../../src/main/terrain/TerrainService.js'

const identity = scaleDipConverter(1)

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({
  left,
  top,
  right,
  bottom,
})

const display = (over: Partial<DisplayInfo> = {}): DisplayInfo => ({
  id: 'd1',
  bounds: rect(0, 0, 1920, 1080),
  workArea: rect(0, 0, 1920, 1040), // 下 40px がタスクバー
  scaleFactor: 1,
  ...over,
})

const win = (over: Partial<Win32Window> = {}): Win32Window => ({
  hwnd: 1,
  rect: rect(100, 200, 700, 600),
  isVisible: true,
  isMinimized: false,
  isCloaked: false,
  isToolWindow: false,
  zOrder: 0,
  ...over,
})

const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({
  climbWindows: true,
  keepOnScreen: false,
  ownHwnds: new Set(),
  ...over,
})

describe('ウィンドウの除外 (DESIGN §7.2)', () => {
  const cases: [string, Partial<Win32Window>, string][] = [
    ['非表示', { isVisible: false }, 'invisible'],
    ['最小化', { isMinimized: true }, 'minimized'],
    ['DWM クローク', { isCloaked: true }, 'cloaked'],
    ['ツールウィンドウ', { isToolWindow: true }, 'toolWindow'],
  ]
  for (const [label, patch, reason] of cases) {
    it(`${label}は除外する`, () => {
      const r = filterWindows([win(patch)], [display()], identity, opts())
      expect(r.kept).toHaveLength(0)
      expect(r.excluded[0]?.reason).toBe(reason)
    })
  }

  it('DWM クロークは isVisible が true でも除外される', () => {
    // 仮想デスクトップの別ページの窓は「可視」のまま返ってくるので、
    // isVisible だけを見ていると地形に混ざる
    const r = filterWindows(
      [win({ isVisible: true, isCloaked: true })],
      [display()],
      identity,
      opts(),
    )
    expect(r.kept).toHaveLength(0)
    expect(r.excluded[0]?.reason).toBe('cloaked')
  })

  it('自分のオーバーレイ窓は除外する', () => {
    const r = filterWindows(
      [win({ hwnd: 42 })],
      [display()],
      identity,
      opts({ ownHwnds: new Set([42]) }),
    )
    expect(r.excluded[0]?.reason).toBe('ownWindow')
  })

  it('小さすぎる窓は除外する', () => {
    const small = win({ rect: rect(0, 0, MIN_WINDOW_SIZE - 1, 500) })
    expect(filterWindows([small], [display()], identity, opts()).excluded[0]?.reason).toBe(
      'tooSmall',
    )
  })

  it('普通の窓は残る', () => {
    expect(filterWindows([win()], [display()], identity, opts()).kept).toHaveLength(1)
  })

  it('ディスプレイを覆う窓は面を作らず、退避対象として報告する', () => {
    const full = win({ rect: rect(0, 0, 1920, 1080) })
    const r = filterWindows([full], [display()], identity, opts())
    expect(r.kept).toHaveLength(0)
    expect(r.excluded[0]?.reason).toBe('fullscreen')
    expect(r.fullscreenDisplayIds).toEqual(['d1'])
  })

  it('高DPI では物理ピクセルを DIP に直してから判定する', () => {
    // 150% の環境で 1920x1080 の論理画面 = 2880x1620 物理
    const d = display({
      bounds: rect(0, 0, 1920, 1080),
      workArea: rect(0, 0, 1920, 1040),
      scaleFactor: 1.5,
    })
    const toDip = scaleDipConverter(1.5)
    // 物理 90px = DIP 60px。しきい値 48 を上回るので残るべき
    const w = win({ rect: rect(0, 0, 90, 90) })
    expect(filterWindows([w], [d], toDip, opts()).kept).toHaveLength(1)

    // 物理 60px = DIP 40px。しきい値を下回る
    const tiny = win({ rect: rect(0, 0, 60, 60) })
    expect(filterWindows([tiny], [d], toDip, opts()).excluded[0]?.reason).toBe('tooSmall')
  })
})

describe('遮蔽の除外', () => {
  it('手前の窓に完全に隠れた窓を落とす', () => {
    const front = win({ hwnd: 1, zOrder: 0, rect: rect(0, 0, 1000, 1000) })
    const behind = win({ hwnd: 2, zOrder: 1, rect: rect(100, 100, 500, 500) })
    const r = dropOccluded([front, behind], identity)
    expect(r.kept.map((w) => w.hwnd)).toEqual([1])
    expect(r.occluded).toEqual([2])
  })

  it('部分的な重なりは落とさない', () => {
    const front = win({ hwnd: 1, zOrder: 0, rect: rect(0, 0, 500, 500) })
    const behind = win({ hwnd: 2, zOrder: 1, rect: rect(400, 400, 900, 900) })
    expect(dropOccluded([front, behind], identity).kept).toHaveLength(2)
  })

  it('奥の窓が手前の窓を隠すことはない', () => {
    const behind = win({ hwnd: 2, zOrder: 5, rect: rect(0, 0, 1000, 1000) })
    const front = win({ hwnd: 1, zOrder: 0, rect: rect(100, 100, 500, 500) })
    const r = dropOccluded([behind, front], identity)
    expect(r.kept.map((w) => w.hwnd).sort()).toEqual([1, 2])
  })
})

describe('面の生成', () => {
  it('ウィンドウから 4 面ができる', () => {
    const s = buildWindowSurfaces(win({ hwnd: 0x1234, rect: rect(100, 200, 700, 600) }), identity)
    expect(s.map((x) => x.kind).sort()).toEqual(['ceiling', 'floor', 'wallLeft', 'wallRight'])

    const top = s.find((x) => x.id.endsWith(':top'))!
    expect(top.kind).toBe('floor')
    expect(top.a).toEqual({ x: 100, y: 200 })
    expect(top.b).toEqual({ x: 700, y: 200 })

    const bottom = s.find((x) => x.id.endsWith(':bottom'))!
    expect(bottom.kind).toBe('ceiling')
    expect(bottom.a.y).toBe(600)

    // 左端は「その左側に張り付く」面
    expect(s.find((x) => x.id.endsWith(':left'))!.kind).toBe('wallRight')
    expect(s.find((x) => x.id.endsWith(':right'))!.kind).toBe('wallLeft')
  })

  it('全ての面が由来ウィンドウを持つ', () => {
    for (const s of buildWindowSurfaces(win({ hwnd: 7 }), identity)) {
      expect(s.ownerHwnd).toBe(7)
    }
  })

  it('短すぎる辺は面にしない', () => {
    const thin = win({ rect: rect(0, 0, 600, MIN_SURFACE_LENGTH - 1) })
    const kinds = buildWindowSurfaces(thin, identity).map((s) => s.kind)
    // 上下（長さ600）は残り、左右（高さ47）は落ちる
    expect(kinds).toContain('floor')
    expect(kinds).toContain('ceiling')
    expect(kinds).not.toContain('wallLeft')
    expect(kinds).not.toContain('wallRight')
  })

  it('ディスプレイからは既定で床だけができる', () => {
    const s = buildDisplaySurfaces(display(), opts())
    expect(s).toHaveLength(1)
    expect(s[0]!.kind).toBe('floor')
    // 作業領域の下端＝タスクバーの上
    expect(s[0]!.a.y).toBe(1040)
    expect(s[0]!.ownerHwnd).toBeUndefined()
  })

  it('「画面外に出ない」が ON なら壁と天井もできる', () => {
    const s = buildDisplaySurfaces(display(), opts({ keepOnScreen: true }))
    expect(s.map((x) => x.kind).sort()).toEqual(['ceiling', 'floor', 'wallLeft', 'wallRight'])
  })

  it('ディスプレイ由来の面は最奥に置かれる', () => {
    const d = buildDisplaySurfaces(display(), opts())[0]!
    const w = buildWindowSurfaces(win({ zOrder: 0 }), identity)[0]!
    expect(d.z).toBeGreaterThan(w.z)
  })
})

describe('TerrainService の差分', () => {
  const run = (svc: TerrainService, windows: Win32Window[], o = opts()) =>
    svc.update(windows, [display()], identity, o)

  it('初回は全て added', () => {
    const svc = new TerrainService()
    const r = run(svc, [win({ hwnd: 1 })])
    expect(r.patch.added.length).toBe(5) // 床 1 + 窓 4
    expect(r.patch.removed).toEqual([])
    expect(r.patch.moved).toEqual([])
  })

  it('変化が無ければ空のパッチ', () => {
    const svc = new TerrainService()
    run(svc, [win({ hwnd: 1 })])
    const second = run(svc, [win({ hwnd: 1 })])
    expect(isEmptyPatch(second.patch)).toBe(true)
  })

  it('窓が動いたら moved になる', () => {
    const svc = new TerrainService()
    run(svc, [win({ hwnd: 1, rect: rect(100, 200, 700, 600) })])
    const r = run(svc, [win({ hwnd: 1, rect: rect(150, 200, 750, 600) })])
    expect(r.patch.moved).toHaveLength(4)
    expect(r.patch.added).toEqual([])
    expect(r.patch.removed).toEqual([])
  })

  it('窓が閉じたら removed になる', () => {
    const svc = new TerrainService()
    run(svc, [win({ hwnd: 1 }), win({ hwnd: 2, rect: rect(800, 200, 1400, 600) })])
    const r = run(svc, [win({ hwnd: 1 })])
    expect(r.patch.removed).toHaveLength(4)
    expect(r.patch.removed.every((id) => id.startsWith('hwnd:2:'))).toBe(true)
  })

  it('最小化は閉じたのと同じく removed になる', () => {
    const svc = new TerrainService()
    run(svc, [win({ hwnd: 1 })])
    const r = run(svc, [win({ hwnd: 1, isMinimized: true })])
    expect(r.patch.removed).toHaveLength(4)
    expect(svc.snapshot().every((s) => s.ownerHwnd === undefined)).toBe(true)
  })

  it('Z 順が変わっただけでも moved として配る', () => {
    const svc = new TerrainService()
    run(svc, [win({ hwnd: 1, zOrder: 0 })])
    const r = run(svc, [win({ hwnd: 1, zOrder: 3 })])
    expect(r.patch.moved).toHaveLength(4)
  })

  it('climbWindows が OFF なら窓の面を作らない', () => {
    const svc = new TerrainService()
    const r = run(svc, [win({ hwnd: 1 })], opts({ climbWindows: false }))
    expect(r.surfaceCount).toBe(1)
    expect(svc.snapshot()[0]!.ownerHwnd).toBeUndefined()
  })

  it('OFF から ON に切り替えると窓の面が追加される', () => {
    const svc = new TerrainService()
    run(svc, [win({ hwnd: 1 })], opts({ climbWindows: false }))
    const r = run(svc, [win({ hwnd: 1 })], opts({ climbWindows: true }))
    expect(r.patch.added).toHaveLength(4)
  })

  it('全画面のディスプレイを報告する', () => {
    const svc = new TerrainService()
    const r = run(svc, [win({ hwnd: 1, rect: rect(0, 0, 1920, 1080) })])
    expect(r.fullscreenDisplayIds).toEqual(['d1'])
  })

  it('reset で状態が消え、次回が全て added になる', () => {
    const svc = new TerrainService()
    run(svc, [win({ hwnd: 1 })])
    svc.reset()
    expect(run(svc, [win({ hwnd: 1 })]).patch.added).toHaveLength(5)
  })

  it('大量の窓でも面の数が線形に収まる', () => {
    const svc = new TerrainService()
    const many = Array.from({ length: 50 }, (_, i) =>
      win({ hwnd: i + 1, zOrder: i, rect: rect(i * 10, i * 10, i * 10 + 400, i * 10 + 300) }),
    )
    const r = run(svc, many)
    expect(r.surfaceCount).toBeLessThanOrEqual(50 * 4 + 1)
    expect(r.surfaceCount).toBeGreaterThan(50)
  })
})

describe('ディスプレイごとの絞り込み', () => {
  const d2 = display({
    id: 'd2',
    bounds: rect(1920, 0, 3840, 1080),
    workArea: rect(1920, 0, 3840, 1040),
  })

  it('そのディスプレイに触れない面は配らない', () => {
    const svc = new TerrainService()
    const r = svc.update(
      [win({ hwnd: 1, rect: rect(100, 200, 700, 600) })],
      [display(), d2],
      identity,
      opts(),
    )
    const forD2 = patchForDisplay(r.patch, d2)
    expect(forD2.added.every((s) => s.ownerHwnd === undefined)).toBe(true)
  })

  it('ディスプレイを跨ぐ面は両方に配られる', () => {
    const svc = new TerrainService()
    const spanning = win({ hwnd: 1, rect: rect(1700, 200, 2300, 600) })
    const r = svc.update([spanning], [display(), d2], identity, opts())

    const inD1 = patchForDisplay(r.patch, display()).added.filter((s) => s.ownerHwnd === 1)
    const inD2 = patchForDisplay(r.patch, d2).added.filter((s) => s.ownerHwnd === 1)
    expect(inD1.length).toBeGreaterThan(0)
    expect(inD2.length).toBeGreaterThan(0)
  })

  it('削除は全ディスプレイへ送る', () => {
    const patch = { added: [], moved: [], removed: ['hwnd:9:top'] }
    expect(patchForDisplay(patch, d2).removed).toEqual(['hwnd:9:top'])
  })
})

describe('スキャン間隔 (DESIGN §7.3)', () => {
  it('移動中は短く、休息中は長い', () => {
    expect(scanIntervalMs({ anyMoving: true, allResting: false }, true)).toBe(
      SCAN_INTERVALS_MS.moving,
    )
    expect(scanIntervalMs({ anyMoving: false, allResting: false }, true)).toBe(
      SCAN_INTERVALS_MS.normal,
    )
    expect(scanIntervalMs({ anyMoving: false, allResting: true }, true)).toBe(
      SCAN_INTERVALS_MS.resting,
    )
  })

  it('ウィンドウに乗らない設定なら走らせない', () => {
    expect(scanIntervalMs({ anyMoving: true, allResting: false }, false)).toBe(
      SCAN_INTERVALS_MS.disabled,
    )
  })
})
