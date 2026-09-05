import type { Surface, Vec2 } from './geometry.js'

/**
 * 接着状態 (DESIGN.md §7.4)。
 * `t` は面上の正規化パラメータ。面が動いても t を保てばキャラは面と一緒に動く。
 */
export type Attachment =
  | { mode: 'free' }
  | { mode: 'stand'; surfaceId: string; t: number }
  | { mode: 'cling'; surfaceId: string; t: number }
  | { mode: 'hang'; surfaceId: string; t: number }

/** 面に接着している状態だけを取り出したもの。`free` を含まない。 */
export type AttachedTo = Exclude<Attachment, { mode: 'free' }>

export type Facing = 'left' | 'right'

/** 面の種類から、そこに接着したときのモードを決める。 */
export function attachModeFor(kind: Surface['kind']): AttachedTo['mode'] {
  switch (kind) {
    case 'floor':
      return 'stand'
    case 'ceiling':
      return 'hang'
    default:
      return 'cling'
  }
}

/**
 * ディスプレイ間の受け渡しに使うアクターの完全なスナップショット (DESIGN.md §4.1)。
 * 毎フレームの IPC は行わず、境界を跨ぐ瞬間にだけこれを送る。
 */
export interface ActorSnapshot {
  actorId: string
  packId: string
  position: Vec2
  velocity: Vec2
  facing: Facing
  attachment: Attachment
  stateId: string
  stateRemainingSec: number
  animationName: string
  animationElapsedMs: number
  affinityStage: number
}
