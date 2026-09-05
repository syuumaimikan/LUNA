import type { Rect } from '@shared/types/geometry.js'

/**
 * Win32 のウィンドウ列挙が返す 1 件 (DESIGN.md §7.2)。
 *
 * **タイトルを持たない**のは意図的。ウィンドウの列挙は「今どのアプリで何を
 * しているか」を映す情報なので、地形の生成に必要な矩形と hwnd 以外を
 * 保持しないことを実装規約としている (DESIGN.md §16)。
 * この型に title を足さないことがその規約の担保になる。
 */
export interface Win32Window {
  hwnd: number
  /** 物理ピクセル。DIP への変換は TerrainService が行う */
  rect: Rect
  isVisible: boolean
  isMinimized: boolean
  /** DWMWA_CLOAKED。仮想デスクトップの別ページや UWP のサスペンド窓 */
  isCloaked: boolean
  /** WS_EX_TOOLWINDOW */
  isToolWindow: boolean
  /** Z 順。0 が最前面 */
  zOrder: number
}

/** ディスプレイ情報。単位は DIP。 */
export interface DisplayInfo {
  id: string
  /** ディスプレイ全体 */
  bounds: Rect
  /** タスクバーなどを除いた作業領域 */
  workArea: Rect
  scaleFactor: number
}

/** 物理ピクセル矩形を DIP に変換する。Electron では screen.screenToDipRect が担う。 */
export type DipConverter = (physical: Rect) => Rect

/** scaleFactor による単純な変換。実機では Electron の API を使う。 */
export function scaleDipConverter(scaleFactor: number): DipConverter {
  return (r) => ({
    left: r.left / scaleFactor,
    top: r.top / scaleFactor,
    right: r.right / scaleFactor,
    bottom: r.bottom / scaleFactor,
  })
}
