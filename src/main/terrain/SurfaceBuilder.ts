import {
  rectContains,
  rectHeight,
  rectWidth,
  type Rect,
  type Surface,
} from '@shared/types/geometry.js'
import type { DipConverter, DisplayInfo, Win32Window } from '@main/platform/win32/types.js'

/** これより短い面は掴めないので捨てる (DESIGN.md §7.2)。 */
export const MIN_SURFACE_LENGTH = 48

/** これより小さいウィンドウは地形にしない。 */
export const MIN_WINDOW_SIZE = 48

export interface BuildOptions {
  /** 設定「ウィンドウに乗る」。false ならウィンドウ由来の面を作らない */
  climbWindows: boolean
  /** 設定「画面外に出ない」。true なら画面端を壁と天井にする */
  keepOnScreen: boolean
  /** 自分のオーバーレイ窓の hwnd。地形から除外する */
  ownHwnds: ReadonlySet<number>
}

export type ExclusionReason =
  | 'invisible'
  | 'minimized'
  | 'cloaked'
  | 'toolWindow'
  | 'ownWindow'
  | 'tooSmall'
  | 'fullscreen'
  | 'occluded'

export interface WindowFilterResult {
  kept: Win32Window[]
  excluded: { hwnd: number; reason: ExclusionReason }[]
  /** 全画面でディスプレイを覆っている窓があるディスプレイ */
  fullscreenDisplayIds: string[]
}

/**
 * 地形にしてはいけないウィンドウを落とす (DESIGN.md §7.2)。
 *
 * これを怠ると地形がゴミだらけになり、キャラが虚空に立つ。特に
 * **DWM クロークは `isVisible` だけでは弾けない** — 仮想デスクトップの
 * 別ページにある窓は「可視」のまま返ってくる。
 */
export function filterWindows(
  windows: readonly Win32Window[],
  displays: readonly DisplayInfo[],
  toDip: DipConverter,
  opts: BuildOptions,
): WindowFilterResult {
  const kept: Win32Window[] = []
  const excluded: { hwnd: number; reason: ExclusionReason }[] = []
  const fullscreenDisplayIds = new Set<string>()

  for (const w of windows) {
    const exclude = (reason: ExclusionReason) => excluded.push({ hwnd: w.hwnd, reason })

    if (opts.ownHwnds.has(w.hwnd)) {
      exclude('ownWindow')
      continue
    }
    if (!w.isVisible) {
      exclude('invisible')
      continue
    }
    if (w.isMinimized) {
      exclude('minimized')
      continue
    }
    if (w.isCloaked) {
      exclude('cloaked')
      continue
    }
    if (w.isToolWindow) {
      exclude('toolWindow')
      continue
    }

    const dip = toDip(w.rect)
    if (rectWidth(dip) < MIN_WINDOW_SIZE || rectHeight(dip) < MIN_WINDOW_SIZE) {
      exclude('tooSmall')
      continue
    }

    // ディスプレイを覆う窓は面を作らず、退避 (§9.6) に回す
    const covered = displays.find((d) => rectContains(dip, d.bounds))
    if (covered) {
      fullscreenDisplayIds.add(covered.id)
      exclude('fullscreen')
      continue
    }

    kept.push(w)
  }

  return { kept, excluded, fullscreenDisplayIds: [...fullscreenDisplayIds] }
}

/**
 * 手前のウィンドウに完全に隠れている窓を落とす。
 *
 * 部分的な遮蔽は無視する。厳密にやると計算量が跳ね上がる割に、
 * キャラが一瞬窓の裏に立つ程度の実害しかないため
 * (DESIGN.md §7.2 の「遮蔽の扱い」)。
 */
export function dropOccluded(
  windows: readonly Win32Window[],
  toDip: DipConverter,
): { kept: Win32Window[]; occluded: number[] } {
  const sorted = [...windows].sort((a, b) => a.zOrder - b.zOrder)
  const kept: Win32Window[] = []
  const occluded: number[] = []
  const front: Rect[] = []

  for (const w of sorted) {
    const dip = toDip(w.rect)
    if (front.some((f) => rectContains(f, dip))) {
      occluded.push(w.hwnd)
      continue
    }
    kept.push(w)
    front.push(dip)
  }
  return { kept, occluded }
}

function horizontal(
  id: string,
  kind: 'floor' | 'ceiling',
  y: number,
  x0: number,
  x1: number,
  z: number,
  hwnd?: number,
): Surface | null {
  if (Math.abs(x1 - x0) < MIN_SURFACE_LENGTH) return null
  return hwnd === undefined
    ? { id, kind, a: { x: x0, y }, b: { x: x1, y }, z }
    : { id, kind, a: { x: x0, y }, b: { x: x1, y }, z, ownerHwnd: hwnd }
}

function vertical(
  id: string,
  kind: 'wallLeft' | 'wallRight',
  x: number,
  y0: number,
  y1: number,
  z: number,
  hwnd?: number,
): Surface | null {
  if (Math.abs(y1 - y0) < MIN_SURFACE_LENGTH) return null
  return hwnd === undefined
    ? { id, kind, a: { x, y: y0 }, b: { x, y: y1 }, z }
    : { id, kind, a: { x, y: y0 }, b: { x, y: y1 }, z, ownerHwnd: hwnd }
}

/** ディスプレイ由来の面 (DESIGN.md §7.2)。 */
export function buildDisplaySurfaces(display: DisplayInfo, opts: BuildOptions): Surface[] {
  const wa = display.workArea
  const z = 1000 // 常に最奥
  const out: Surface[] = []

  // 作業領域の下端＝タスクバーの上。ここが基本の床
  const floor = horizontal(`display:${display.id}:floor`, 'floor', wa.bottom, wa.left, wa.right, z)
  if (floor) out.push(floor)

  if (opts.keepOnScreen) {
    const left = vertical(`display:${display.id}:left`, 'wallRight', wa.left, wa.top, wa.bottom, z)
    const right = vertical(
      `display:${display.id}:right`,
      'wallLeft',
      wa.right,
      wa.top,
      wa.bottom,
      z,
    )
    const ceiling = horizontal(
      `display:${display.id}:ceiling`,
      'ceiling',
      wa.top,
      wa.left,
      wa.right,
      z,
    )
    if (left) out.push(left)
    if (right) out.push(right)
    if (ceiling) out.push(ceiling)
  }
  return out
}

/**
 * ウィンドウ 1 枚から 4 面を作る。
 * 上端＝立てる床、下端＝ぶら下がる天井、左右＝登る壁。
 */
export function buildWindowSurfaces(w: Win32Window, toDip: DipConverter): Surface[] {
  const r = toDip(w.rect)
  const id = (part: string) => `hwnd:${w.hwnd}:${part}`
  const out: Surface[] = []

  const top = horizontal(id('top'), 'floor', r.top, r.left, r.right, w.zOrder, w.hwnd)
  const bottom = horizontal(id('bottom'), 'ceiling', r.bottom, r.left, r.right, w.zOrder, w.hwnd)
  // 窓の左端は「その左側に張り付く」面なので wallRight（面の右側が窓の中）
  const left = vertical(id('left'), 'wallRight', r.left, r.top, r.bottom, w.zOrder, w.hwnd)
  const right = vertical(id('right'), 'wallLeft', r.right, r.top, r.bottom, w.zOrder, w.hwnd)

  for (const s of [top, bottom, left, right]) if (s) out.push(s)
  return out
}
