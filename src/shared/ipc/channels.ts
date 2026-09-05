/**
 * IPC 契約 (DESIGN.md §18)。
 *
 * チャンネル名の文字列リテラルを各所へ直書きすることを禁じ、ここを単一の
 * 定義とする。**毎フレームの IPC は存在しない**（イベント駆動のみ）という
 * 方針もここで型として表現している。
 */
import type { ActorSnapshot } from '@shared/types/actor.js'
import type { Surface, Vec2 } from '@shared/types/geometry.js'

/** Renderer → Main。invoke は応答あり、send は一方向。 */
export interface RendererToMain {
  'overlay:ready': { send: { displayId: string } }
  'overlay:setInteractive': { send: { displayId: string; interactive: boolean } }
  'actor:handoff': { send: { snapshot: ActorSnapshot; toDisplayId: string } }
  'actor:contextMenu': { send: { actorId: string; x: number; y: number } }
  'gesture:headPat': {
    send: { actorId: string; strokes: number; phase: 'start' | 'stroke' | 'end' }
  }
  'gesture:shake': { send: { actorId: string } }
  'timer:control': { send: { action: 'start' | 'pause' | 'resume' | 'skip' | 'stop' | 'snooze' } }
  'settings:get': { invoke: void; result: unknown }
  'settings:set': { invoke: Record<string, unknown>; result: void }
  'pack:list': { invoke: void; result: { id: string; name: string; ok: boolean }[] }
}

/** Main → Renderer。 */
export interface MainToRenderer {
  'actor:spawn': { actorId: string; packId: string; position: Vec2 }
  'actor:despawn': { actorId: string }
  'actor:adopt': { snapshot: ActorSnapshot }
  'terrain:patch': { displayId: string; added: Surface[]; removed: string[]; moved: Surface[] }
  'directive:react': { actorId: string; ruleId: string; actions: unknown[] }
  'directive:say': { actorId: string; text: string; durationMs: number }
  'env:contextChanged': {
    timeOfDay: 'morning' | 'day' | 'evening' | 'lateNight'
    quiet: boolean
    focusMode: boolean
    batteryLow: boolean
    affinityStage: number
  }
  'timer:state': { mode: string; remainingSec: number; completedSets: number }
  'overlay:visibility': { displayId: string; visible: boolean; fadeMs: number }
  'settings:changed': Record<string, unknown>
}

export type RendererToMainChannel = keyof RendererToMain
export type MainToRendererChannel = keyof MainToRenderer

/** 実行時にも参照できるチャンネル名の一覧。preload の許可リストに使う。 */
export const RENDERER_TO_MAIN_CHANNELS = [
  'overlay:ready',
  'overlay:setInteractive',
  'actor:handoff',
  'actor:contextMenu',
  'gesture:headPat',
  'gesture:shake',
  'timer:control',
  'settings:get',
  'settings:set',
  'pack:list',
] as const satisfies readonly RendererToMainChannel[]

export const MAIN_TO_RENDERER_CHANNELS = [
  'actor:spawn',
  'actor:despawn',
  'actor:adopt',
  'terrain:patch',
  'directive:react',
  'directive:say',
  'env:contextChanged',
  'timer:state',
  'overlay:visibility',
  'settings:changed',
] as const satisfies readonly MainToRendererChannel[]
