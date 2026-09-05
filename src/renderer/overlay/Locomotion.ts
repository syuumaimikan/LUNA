import { attachModeFor, type AttachedTo, type Facing } from '@shared/types/actor.js'
import {
  clamp01,
  isHorizontal,
  paramAt,
  pointAt,
  surfaceLength,
  type Surface,
  type Vec2,
} from '@shared/types/geometry.js'
import { chance, type Rng } from '@shared/rng.js'
import type { TerrainMap } from './TerrainMap.js'

/** 乗り換え候補とみなす距離 (DESIGN.md §7.5)。 */
export const HANDOFF_RADIUS = 8
/** dive を検討する最低の高さ。 */
export const DIVE_MIN_HEIGHT = 120
/** dive の基礎確率。personality.curiosity × 2 が掛かる。 */
export const DIVE_BASE_CHANCE = 0.03
/** 面の移動がこれを超えたら振り落とす (DESIGN.md §7.6)。 */
export const SHAKE_OFF_DISTANCE = 100

export type CornerOutcome =
  | {
      kind: 'transfer'
      attachment: AttachedTo
      facing: Facing
      animation: 'cornerOut' | 'cornerIn'
    }
  | { kind: 'turn'; facing: Facing }
  | { kind: 'dive' }
  | { kind: 'fall' }

export interface CornerContext {
  terrain: TerrainMap
  rng: Rng
  /** 現在の接着 */
  attachment: AttachedTo
  /** 進行方向。水平面では ±x、垂直面では ±y に対応する */
  facing: Facing
  /** パックの personality.curiosity (0-1) */
  curiosity: number
  /** 床面の y。dive の高さ判定に使う */
  groundY: number
  /** 設定「ウィンドウに乗る」。false ならウィンドウ由来の面へは移らない */
  climbWindows: boolean
  /** 設定「飛び降りる頻度」 */
  diveFrequency: 'never' | 'rare' | 'often'
}

const DIVE_MULTIPLIER: Record<CornerContext['diveFrequency'], number> = {
  never: 0,
  rare: 1,
  often: 3,
}

/**
 * 面の端に到達したときの分岐 (DESIGN.md §7.5)。
 *
 * 判定順は「乗り換え → 角を曲がる → 飛び降りる → 引き返す」。
 * この順序には理由があって、近くに足場があるのに飛び降りるのは不自然だし、
 * 同じ窓の角を曲がれるのに引き返すのも不自然だから。
 */
export function resolveCorner(ctx: CornerContext): CornerOutcome {
  const current = ctx.terrain.get(ctx.attachment.surfaceId)
  if (!current) return { kind: 'fall' }

  const edge = edgePoint(current, ctx.attachment.t, ctx.facing)

  // 1. 近傍の面へ乗り換える
  const transfer = findTransfer(ctx, current, edge)
  if (transfer) return transfer

  // 2. 同じウィンドウの隣接面へ角を曲がる
  const corner = findSameWindowCorner(ctx, current, edge)
  if (corner) return corner

  // 3. 意味もなく飛び降りる
  if (current.kind === 'floor') {
    const height = ctx.groundY - current.a.y
    const p = DIVE_BASE_CHANCE * (ctx.curiosity * 2) * DIVE_MULTIPLIER[ctx.diveFrequency]
    if (height >= DIVE_MIN_HEIGHT && p > 0 && chance(ctx.rng, p)) return { kind: 'dive' }
  }

  // 4. 引き返す
  return { kind: 'turn', facing: ctx.facing === 'left' ? 'right' : 'left' }
}

/** 面上で進行方向側の端の座標。 */
function edgePoint(s: Surface, t: number, facing: Facing): Vec2 {
  if (isHorizontal(s.kind)) {
    // 水平面では facing がそのまま ±x
    const goingToB = s.b.x > s.a.x === (facing === 'right')
    return goingToB ? { ...s.b } : { ...s.a }
  }
  // 垂直面では facing 'right' を「下方向」に割り当てる（climb の向き）
  const goingToB = s.b.y > s.a.y === (facing === 'right')
  return goingToB ? { ...s.b } : { ...s.a }
}

function findTransfer(ctx: CornerContext, current: Surface, edge: Vec2): CornerOutcome | null {
  const candidates = ctx.terrain
    .near(edge, HANDOFF_RADIUS)
    .filter((s) => s.id !== current.id)
    .filter((s) => ctx.climbWindows || s.ownerHwnd === undefined)
    // 同一ウィンドウの隣接面は「角を曲がる」で扱うので、ここでは別ウィンドウ/画面のみ
    .filter((s) => s.ownerHwnd === undefined || s.ownerHwnd !== current.ownerHwnd)

  if (candidates.length === 0) return null

  // 同じ向き > 手前(z 小) > 近い の順に選ぶ
  candidates.sort((l, r) => {
    const sameL = l.kind === current.kind ? 0 : 1
    const sameR = r.kind === current.kind ? 0 : 1
    if (sameL !== sameR) return sameL - sameR
    if (l.z !== r.z) return l.z - r.z
    return 0
  })

  const target = candidates[0]!
  return {
    kind: 'transfer',
    attachment: {
      mode: attachModeFor(target.kind),
      surfaceId: target.id,
      t: paramAt(target, edge),
    },
    facing: ctx.facing,
    animation: target.kind === current.kind ? 'cornerIn' : 'cornerOut',
  }
}

function findSameWindowCorner(
  ctx: CornerContext,
  current: Surface,
  edge: Vec2,
): CornerOutcome | null {
  if (current.ownerHwnd === undefined) return null
  if (!ctx.climbWindows) return null

  const siblings = ctx.terrain
    .near(edge, HANDOFF_RADIUS)
    .filter((s) => s.id !== current.id && s.ownerHwnd === current.ownerHwnd)

  const target = siblings[0]
  if (!target) return null

  // 床から壁へ回り込むときは、そのまま下向きに登り始める
  const facing: Facing =
    isHorizontal(current.kind) && !isHorizontal(target.kind) ? 'right' : ctx.facing

  return {
    kind: 'transfer',
    attachment: {
      mode: attachModeFor(target.kind),
      surfaceId: target.id,
      t: paramAt(target, edge),
    },
    facing,
    animation: 'cornerOut',
  }
}

/**
 * 接着したまま面に沿って移動する。端に達したら `reachedEdge` を立てる。
 * 返り値の t は 0-1 にクランプされる。
 */
export function advanceAlongSurface(
  surface: Surface,
  t: number,
  facing: Facing,
  speedDip: number,
  dtSec: number,
): { t: number; reachedEdge: boolean } {
  const len = surfaceLength(surface)
  if (len <= 0) return { t: 0, reachedEdge: true }

  // t の増加方向が facing と一致するかは面の向きに依る
  const forward = isHorizontal(surface.kind)
    ? surface.b.x > surface.a.x === (facing === 'right')
    : surface.b.y > surface.a.y === (facing === 'right')

  const delta = ((speedDip * dtSec) / len) * (forward ? 1 : -1)
  const next = t + delta
  const clamped = clamp01(next)
  return { t: clamped, reachedEdge: next !== clamped || clamped === 0 || clamped === 1 }
}

/**
 * 面が移動したときの追従 (DESIGN.md §7.6)。
 * 1 更新の移動量が SHAKE_OFF_DISTANCE を超えたら振り落とす。
 */
export function followMovedSurface(
  before: Surface,
  after: Surface,
  t: number,
): { position: Vec2; shakenOff: boolean } {
  const from = pointAt(before, t)
  const to = pointAt(after, t)
  const moved = Math.hypot(to.x - from.x, to.y - from.y)
  return { position: to, shakenOff: moved > SHAKE_OFF_DISTANCE }
}
