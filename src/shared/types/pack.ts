/** CHARACTER_PACK.md のスキーマに対応する型。zod スキーマは main/pack/PackSchema.ts。 */

export interface AnimationFrame {
  name: string
  durationMs?: number
}

export interface AnimationDef {
  frames: (string | AnimationFrame)[]
  fps?: number
  loop?: boolean
  moveSpeed?: number
  flipWhenFacingLeft?: boolean
  events?: { atFrame: number; sound: string; volume?: number }[]
}

export interface StateTransition {
  state: string
  weight: number
}

export interface StateDef {
  animation: string
  minDurationSec: number
  maxDurationSec: number
  movement?: 'none' | 'surface'
  interruptible?: boolean
  effect?: string
  minStage?: number
  next?: StateTransition[]
}

export interface Personality {
  activity: number
  talkative: number
  curiosity: number
  sleepiness: number
}

export const DEFAULT_PERSONALITY: Personality = {
  activity: 0.5,
  talkative: 0.5,
  curiosity: 0.5,
  sleepiness: 0.5,
}

export interface MascotPack {
  schemaVersion: 1
  id: string
  name: string
  version: string
  author?: string
  license?: string
  description?: string
  display: {
    baseHeight: number
    anchor?: { x: number; y: number }
    footOffset?: number
    hitPadding?: number
    headRegion?: { x: number; y: number; w: number; h: number }
  }
  sprite: {
    atlases: { scale: number; image: string; data: string }[]
    scaleMode?: 'nearest' | 'linear'
  }
  animations: Record<string, AnimationDef>
  states: Record<string, StateDef>
  interactions?: Record<string, unknown>
  reactions?: unknown[]
  personality?: Personality
}
