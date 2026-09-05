/** すべて Virtual dip 座標 (DESIGN.md §4)。 */
export interface Vec2 {
  x: number
  y: number
}

/**
 * 面の種類 (DESIGN.md §7.1)。
 * どちら側に接着できるかを表す。`floor` は上、`ceiling` は下、
 * `wallLeft` は面の左側、`wallRight` は面の右側にキャラが居る。
 */
export type SurfaceKind = 'floor' | 'ceiling' | 'wallLeft' | 'wallRight'

/** キャラが接着できる有向線分。floor/ceiling は水平、wall は垂直。 */
export interface Surface {
  id: string
  kind: SurfaceKind
  a: Vec2
  b: Vec2
  /** 由来ウィンドウ。消滅・移動の追跡に使う。画面由来の面には無い */
  ownerHwnd?: number
  /** Z 順。小さいほど手前 */
  z: number
}

export const isHorizontal = (k: SurfaceKind): boolean => k === 'floor' || k === 'ceiling'
export const isVertical = (k: SurfaceKind): boolean => !isHorizontal(k)

/** 面の長さ。 */
export function surfaceLength(s: Surface): number {
  return isHorizontal(s.kind) ? Math.abs(s.b.x - s.a.x) : Math.abs(s.b.y - s.a.y)
}

/** 正規化パラメータ t (0-1) から面上の座標を得る。 */
export function pointAt(s: Surface, t: number): Vec2 {
  const c = clamp01(t)
  return { x: s.a.x + (s.b.x - s.a.x) * c, y: s.a.y + (s.b.y - s.a.y) * c }
}

/** 面上の座標から正規化パラメータ t を得る。面外の点は 0-1 にクランプされる。 */
export function paramAt(s: Surface, p: Vec2): number {
  const dx = s.b.x - s.a.x
  const dy = s.b.y - s.a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return 0
  return clamp01(((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / len2)
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** 面上の点のうち p に最も近いものまでの距離。乗り換え候補の探索に使う。 */
export function distanceToSurface(s: Surface, p: Vec2): number {
  const q = pointAt(s, paramAt(s, p))
  return Math.hypot(q.x - p.x, q.y - p.y)
}
