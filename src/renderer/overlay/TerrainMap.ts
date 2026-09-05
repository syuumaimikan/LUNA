import { distanceToSurface, isHorizontal, type Surface, type Vec2 } from '@shared/types/geometry.js'

const CELL = 128 // dip。DESIGN.md §7.5 の空間ハッシュのセルサイズ

/**
 * 面の空間インデックス (DESIGN.md §7.3, §7.5)。
 *
 * 面は数百になり得るので、コーナー遷移の近傍探索と落下のスイープ判定で
 * 毎回全件を走査するわけにはいかない。128dip 格子のハッシュで候補を絞る。
 */
export class TerrainMap {
  private readonly surfaces = new Map<string, Surface>()
  private readonly cells = new Map<string, Set<string>>()

  get size(): number {
    return this.surfaces.size
  }

  all(): IterableIterator<Surface> {
    return this.surfaces.values()
  }

  get(id: string): Surface | undefined {
    return this.surfaces.get(id)
  }

  /** 差分適用 (DESIGN.md §7.3 の terrain:patch)。 */
  apply(patch: { added?: Surface[]; removed?: string[]; moved?: Surface[] }): void {
    for (const id of patch.removed ?? []) this.remove(id)
    for (const s of patch.moved ?? []) {
      this.remove(s.id)
      this.add(s)
    }
    for (const s of patch.added ?? []) this.add(s)
  }

  add(s: Surface): void {
    if (this.surfaces.has(s.id)) this.remove(s.id)
    this.surfaces.set(s.id, s)
    for (const key of this.cellKeys(s)) {
      let set = this.cells.get(key)
      if (!set) this.cells.set(key, (set = new Set()))
      set.add(s.id)
    }
  }

  remove(id: string): void {
    const s = this.surfaces.get(id)
    if (!s) return
    for (const key of this.cellKeys(s)) {
      const set = this.cells.get(key)
      if (!set) continue
      set.delete(id)
      if (set.size === 0) this.cells.delete(key)
    }
    this.surfaces.delete(id)
  }

  clear(): void {
    this.surfaces.clear()
    this.cells.clear()
  }

  /** 矩形に重なる可能性のある面。厳密な交差判定は呼び出し側で行う。 */
  queryRect(minX: number, minY: number, maxX: number, maxY: number): Surface[] {
    const out: Surface[] = []
    const seen = new Set<string>()
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
        for (const id of this.cells.get(`${cx},${cy}`) ?? []) {
          if (seen.has(id)) continue
          seen.add(id)
          const s = this.surfaces.get(id)
          if (s) out.push(s)
        }
      }
    }
    return out
  }

  /** 点から半径 r 以内にある面を、近い順に返す。 */
  near(p: Vec2, r: number): Surface[] {
    return this.queryRect(p.x - r, p.y - r, p.x + r, p.y + r)
      .map((s) => ({ s, d: distanceToSurface(s, p) }))
      .filter(({ d }) => d <= r)
      .sort((l, r2) => l.d - r2.d)
      .map(({ s }) => s)
  }

  private *cellKeys(s: Surface): Generator<string> {
    // 面は軸平行なので、覆うセルの範囲は矩形で表せる
    const minX = Math.min(s.a.x, s.b.x)
    const maxX = Math.max(s.a.x, s.b.x)
    const minY = Math.min(s.a.y, s.b.y)
    const maxY = Math.max(s.a.y, s.b.y)
    for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
      for (let cy = Math.floor(minY / CELL); cy <= Math.floor(maxY / CELL); cy++) {
        yield `${cx},${cy}`
      }
    }
  }
}

/** 面 s の始点/終点のうち、x が小さい方・大きい方（水平面用）。 */
export function horizontalSpan(s: Surface): { lo: number; hi: number; y: number } {
  if (!isHorizontal(s.kind)) throw new Error(`not horizontal: ${s.id}`)
  return { lo: Math.min(s.a.x, s.b.x), hi: Math.max(s.a.x, s.b.x), y: s.a.y }
}

/** 面 s の始点/終点のうち、y が小さい方・大きい方（垂直面用）。 */
export function verticalSpan(s: Surface): { lo: number; hi: number; x: number } {
  if (isHorizontal(s.kind)) throw new Error(`not vertical: ${s.id}`)
  return { lo: Math.min(s.a.y, s.b.y), hi: Math.max(s.a.y, s.b.y), x: s.a.x }
}
