import { describe, expect, it } from 'vitest'
import {
  daysSince,
  FakeClock,
  isNextCalendarDay,
  isWithinRange,
  parseCalendarDate,
  parseHhMm,
  parseIso,
  toIsoString,
} from '../../src/shared/time.js'

describe('parseHhMm', () => {
  it('妥当な時刻を分に変換する', () => {
    expect(parseHhMm('00:00')).toBe(0)
    expect(parseHhMm('23:59')).toBe(1439)
    expect(parseHhMm('7:30')).toBe(450)
  })

  it('不正な値は null', () => {
    expect(parseHhMm('24:00')).toBeNull()
    expect(parseHhMm('12:60')).toBeNull()
    expect(parseHhMm('abc')).toBeNull()
    expect(parseHhMm('')).toBeNull()
  })
})

describe('isWithinRange', () => {
  it('通常の範囲', () => {
    expect(isWithinRange(600, 540, 720)).toBe(true)
    expect(isWithinRange(500, 540, 720)).toBe(false)
    expect(isWithinRange(720, 540, 720)).toBe(false) // 上端は含まない
    expect(isWithinRange(540, 540, 720)).toBe(true) // 下端は含む
  })

  it('日を跨ぐ範囲', () => {
    const from = 23 * 60
    const to = 7 * 60
    expect(isWithinRange(23 * 60 + 30, from, to)).toBe(true)
    expect(isWithinRange(3 * 60, from, to)).toBe(true)
    expect(isWithinRange(12 * 60, from, to)).toBe(false)
    expect(isWithinRange(to, from, to)).toBe(false)
  })
})

describe('日付ユーティリティ', () => {
  it('翌日を判定する', () => {
    expect(isNextCalendarDay('2026-01-01', '2026-01-02')).toBe(true)
    expect(isNextCalendarDay('2026-01-01', '2026-01-03')).toBe(false)
    expect(isNextCalendarDay('2026-01-02', '2026-01-01')).toBe(false)
    expect(isNextCalendarDay('', '2026-01-01')).toBe(false)
  })

  it('月末・年末を跨いでも正しい', () => {
    expect(isNextCalendarDay('2026-01-31', '2026-02-01')).toBe(true)
    expect(isNextCalendarDay('2026-12-31', '2027-01-01')).toBe(true)
    expect(isNextCalendarDay('2028-02-28', '2028-02-29')).toBe(true) // 閏年
  })

  it('不正な日付は null / false', () => {
    expect(parseCalendarDate('2026-1-1')).toBeNull()
    expect(parseCalendarDate('nope')).toBeNull()
    expect(isNextCalendarDay('nope', '2026-01-01')).toBe(false)
  })

  it('経過日数は初日を 1 と数える', () => {
    const t0 = Date.parse('2026-01-01T00:00:00Z')
    expect(daysSince(t0, t0)).toBe(1)
    expect(daysSince(t0, t0 + 86_400_000)).toBe(2)
    expect(daysSince(t0, t0 + 86_400_000 * 9)).toBe(10)
  })

  it('ISO 文字列の往復', () => {
    const ms = Date.parse('2026-05-05T12:34:56.000Z')
    expect(parseIso(toIsoString(ms))).toBe(ms)
    expect(parseIso('not a date')).toBeNull()
  })
})

describe('FakeClock', () => {
  it('進めた時間が反映される', () => {
    const c = new FakeClock(Date.parse('2026-01-01T09:00:00'))
    expect(c.today()).toBe('2026-01-01')
    expect(c.minutesOfDay()).toBe(9 * 60)

    c.advance(86_400)
    expect(c.today()).toBe('2026-01-02')

    c.advance(3600 * 3)
    expect(c.minutesOfDay()).toBe(12 * 60)
  })

  it('setTo で任意の時刻に飛べる', () => {
    const c = new FakeClock()
    c.setTo('2030-07-07T23:45:00')
    expect(c.today()).toBe('2030-07-07')
    expect(c.minutesOfDay()).toBe(23 * 60 + 45)
  })
})
