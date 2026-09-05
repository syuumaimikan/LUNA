/**
 * 時刻の抽象。DESIGN.md §20 のとおり、`Date.now()` の直呼びは lint で禁止しており、
 * 振る舞い・親密度・タイマー・抑制はすべてこのインターフェース経由で時刻を得る。
 * これが無いと「30 分後に何が起きるか」を테스트できない。
 */
export interface Clock {
  /** エポックからのミリ秒 */
  now(): number
  /** ローカルタイムの暦日 (YYYY-MM-DD)。日付跨ぎの判定に使う */
  today(): string
  /** ローカルタイムの分単位の時刻 (0-1439)。時間帯判定に使う */
  minutesOfDay(): number
}

export const systemClock: Clock = {
  now: () => Date.now(),
  today: () => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  },
  minutesOfDay: () => {
    const d = new Date()
    return d.getHours() * 60 + d.getMinutes()
  },
}

/** テスト用の手動時計。`advance()` で時間を進める。 */
export class FakeClock implements Clock {
  constructor(private ms: number = Date.parse('2026-01-01T09:00:00')) {}
  now(): number {
    return this.ms
  }
  today(): string {
    const d = new Date(this.ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  minutesOfDay(): number {
    const d = new Date(this.ms)
    return d.getHours() * 60 + d.getMinutes()
  }
  /** 秒単位で進める */
  advance(seconds: number): void {
    this.ms += seconds * 1000
  }
  setTo(iso: string): void {
    this.ms = Date.parse(iso)
  }
}

/** "HH:MM" を分単位に変換する。不正な値は null。 */
export function parseHhMm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

/**
 * 現在時刻が [from, to) の範囲内か。日を跨ぐ範囲 ("23:00"-"05:00") も扱う。
 * パックの `timeBetween` 条件と就寝時間帯の判定に使う。
 */
export function isWithinRange(nowMin: number, from: number, to: number): boolean {
  return from <= to ? nowMin >= from && nowMin < to : nowMin >= from || nowMin < to
}
