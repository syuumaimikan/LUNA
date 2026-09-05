/**
 * 乱数の抽象。DESIGN.md §20 のとおり `Math.random()` の直呼びは lint で禁止。
 * 振る舞いの遷移・滞在時間・dive の発生はすべてここを通すため、
 * シードを固定すれば状態機械は完全に決定論的になる。
 */
export interface Rng {
  /** [0, 1) */
  next(): number
}

/** [min, max) の実数 */
export function range(rng: Rng, min: number, max: number): number {
  return min + rng.next() * (max - min)
}

/** [0, n) の整数 */
export function int(rng: Rng, n: number): number {
  return Math.floor(rng.next() * n)
}

/** 確率 p で true */
export function chance(rng: Rng, p: number): boolean {
  return rng.next() < p
}

/**
 * 重み付き抽選。重みの合計が 0 以下なら null を返す（呼び出し側でフォールバックする）。
 * 負の重みは 0 として扱う。
 */
export function weightedPick<T>(
  rng: Rng,
  items: readonly T[],
  weightOf: (item: T) => number,
): T | null {
  let total = 0
  for (const it of items) total += Math.max(0, weightOf(it))
  if (total <= 0) return null

  let r = rng.next() * total
  for (const it of items) {
    r -= Math.max(0, weightOf(it))
    if (r < 0) return it
  }
  return items[items.length - 1] ?? null
}

/** mulberry32。小さく、速く、シードから完全に再現できる。 */
export class SeededRng implements Rng {
  private s: number
  constructor(seed: number) {
    this.s = seed >>> 0
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0
    let t = this.s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const systemRng: Rng = { next: () => Math.random() }
