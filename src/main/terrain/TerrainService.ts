import type { Surface } from '@shared/types/geometry.js'
import type { DipConverter, DisplayInfo, Win32Window } from '@main/platform/win32/types.js'
import {
  buildDisplaySurfaces,
  buildWindowSurfaces,
  dropOccluded,
  filterWindows,
  type BuildOptions,
} from './SurfaceBuilder.js'

/** 差分パッチ (DESIGN.md §7.3)。全量ではなくこれを配る。 */
export interface TerrainPatch {
  added: Surface[]
  removed: string[]
  moved: Surface[]
}

export const EMPTY_PATCH: TerrainPatch = { added: [], removed: [], moved: [] }

export function isEmptyPatch(p: TerrainPatch): boolean {
  return p.added.length === 0 && p.removed.length === 0 && p.moved.length === 0
}

/** スキャン間隔 (DESIGN.md §7.3)。アクターの状態で変える。 */
export const SCAN_INTERVALS_MS = {
  moving: 200,
  normal: 500,
  resting: 2000,
  /** 「ウィンドウに乗る」が OFF のときは走らせない */
  disabled: Number.POSITIVE_INFINITY,
} as const

export interface ActorActivity {
  anyMoving: boolean
  allResting: boolean
}

export function scanIntervalMs(activity: ActorActivity, climbWindows: boolean): number {
  if (!climbWindows) return SCAN_INTERVALS_MS.disabled
  if (activity.anyMoving) return SCAN_INTERVALS_MS.moving
  if (activity.allResting) return SCAN_INTERVALS_MS.resting
  return SCAN_INTERVALS_MS.normal
}

function sameGeometry(a: Surface, b: Surface): boolean {
  return (
    a.a.x === b.a.x &&
    a.a.y === b.a.y &&
    a.b.x === b.b.x &&
    a.b.y === b.b.y &&
    a.kind === b.kind &&
    a.z === b.z
  )
}

export interface TerrainUpdate {
  patch: TerrainPatch
  /** 全画面アプリに覆われているディスプレイ (DESIGN.md §9.6 の退避対象) */
  fullscreenDisplayIds: string[]
  /** 現在の面の総数。性能予算 (§15) の確認用 */
  surfaceCount: number
}

/**
 * ウィンドウ矩形から地形を組み立て、差分を配る (DESIGN.md §7.2-7.3)。
 *
 * Win32 の呼び出しそのものは `Win32Bridge` の責務で、ここには入れない。
 * `update()` は列挙結果を受け取るだけの純粋な関数として書いてあるので、
 * ウィンドウ列挙をモックにすれば地形の生成規則を丸ごとテストできる。
 */
export class TerrainService {
  private current = new Map<string, Surface>()

  /** 現在保持している面（デバッグと検証用）。 */
  snapshot(): Surface[] {
    return [...this.current.values()]
  }

  reset(): void {
    this.current.clear()
  }

  update(
    windows: readonly Win32Window[],
    displays: readonly DisplayInfo[],
    toDip: DipConverter,
    opts: BuildOptions,
  ): TerrainUpdate {
    const next = new Map<string, Surface>()

    for (const d of displays) {
      for (const s of buildDisplaySurfaces(d, opts)) next.set(s.id, s)
    }

    const filtered = filterWindows(windows, displays, toDip, opts)
    if (opts.climbWindows) {
      const { kept } = dropOccluded(filtered.kept, toDip)
      for (const w of kept) {
        for (const s of buildWindowSurfaces(w, toDip)) next.set(s.id, s)
      }
    }

    const patch = this.diff(next)
    this.current = next
    return {
      patch,
      fullscreenDisplayIds: filtered.fullscreenDisplayIds,
      surfaceCount: next.size,
    }
  }

  private diff(next: Map<string, Surface>): TerrainPatch {
    const added: Surface[] = []
    const moved: Surface[] = []
    const removed: string[] = []

    for (const [id, s] of next) {
      const prev = this.current.get(id)
      if (!prev) added.push(s)
      else if (!sameGeometry(prev, s)) moved.push(s)
    }
    for (const id of this.current.keys()) {
      if (!next.has(id)) removed.push(id)
    }

    return { added, moved, removed }
  }
}

/**
 * ディスプレイごとのオーバーレイに配るためにパッチを絞る。
 * 面が複数ディスプレイに跨る場合は両方に配られる。
 */
export function patchForDisplay(patch: TerrainPatch, display: DisplayInfo): TerrainPatch {
  const touches = (s: Surface): boolean => {
    const minX = Math.min(s.a.x, s.b.x)
    const maxX = Math.max(s.a.x, s.b.x)
    const minY = Math.min(s.a.y, s.b.y)
    const maxY = Math.max(s.a.y, s.b.y)
    const b = display.bounds
    return minX <= b.right && maxX >= b.left && minY <= b.bottom && maxY >= b.top
  }
  return {
    added: patch.added.filter(touches),
    moved: patch.moved.filter(touches),
    // 削除は所属が判らないので全ディスプレイへ送る（存在しない id は無視される）
    removed: patch.removed,
  }
}
