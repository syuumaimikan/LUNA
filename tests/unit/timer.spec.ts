import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../src/shared/time.js'
import {
  ALARM_SOFTEN_AFTER_SEC,
  dayOfWeek,
  POMODORO_DEFAULTS,
  TimerService,
  type AlarmSpec,
  type TimerEvent,
} from '../../src/main/timer/TimerService.js'

const svc = (iso = '2026-01-05T09:00:00') => {
  const clock = new FakeClock(Date.parse(iso))
  return { clock, t: new TimerService(clock) }
}

const types = (events: TimerEvent[]) => events.map((e) => e.type)

describe('ポモドーロ', () => {
  it('開始していなければ何も起きない（自動起動しない）', () => {
    const { clock, t } = svc()
    expect(t.state.mode).toBe('off')
    clock.advance(3600)
    expect(t.tick()).toEqual([])
    expect(t.state.mode).toBe('off')
  })

  it('開始すると作業が始まる', () => {
    const { t } = svc()
    expect(types(t.start())).toEqual(['pomodoro.focusStart'])
    expect(t.state.mode).toBe('focus')
    expect(t.state.remainingSec).toBe(POMODORO_DEFAULTS.focusMin * 60)
    expect(t.isFocusing).toBe(true)
  })

  it('作業時間が尽きると自分で休憩へ移る', () => {
    const { clock, t } = svc()
    t.start()

    clock.advance(POMODORO_DEFAULTS.focusMin * 60 - 1)
    expect(t.tick()).toEqual([])
    expect(t.state.mode).toBe('focus')

    clock.advance(2)
    expect(types(t.tick())).toEqual(['pomodoro.setDone', 'pomodoro.breakStart'])
    expect(t.state.mode).toBe('shortBreak')
    expect(t.isFocusing).toBe(false)
  })

  it('休憩が終われば自分で作業へ戻る', () => {
    const { clock, t } = svc()
    t.start()
    clock.advance(POMODORO_DEFAULTS.focusMin * 60)
    t.tick()

    clock.advance(POMODORO_DEFAULTS.shortBreakMin * 60)
    expect(types(t.tick())).toEqual(['pomodoro.focusStart'])
    expect(t.state.mode).toBe('focus')
  })

  it('4 セットごとに長い休憩になる', () => {
    const { clock, t } = svc()
    t.start()

    const modes: string[] = []
    for (let i = 0; i < 8; i++) {
      clock.advance(POMODORO_DEFAULTS.focusMin * 60)
      t.tick()
      modes.push(t.state.mode)
      clock.advance(
        (t.state.mode === 'longBreak'
          ? POMODORO_DEFAULTS.longBreakMin
          : POMODORO_DEFAULTS.shortBreakMin) * 60,
      )
      t.tick()
    }
    expect(modes).toEqual([
      'shortBreak',
      'shortBreak',
      'shortBreak',
      'longBreak',
      'shortBreak',
      'shortBreak',
      'shortBreak',
      'longBreak',
    ])
  })

  it('長い休憩は短い休憩より長い', () => {
    const { clock, t } = svc()
    t.start()
    for (let i = 0; i < 4; i++) {
      clock.advance(POMODORO_DEFAULTS.focusMin * 60)
      t.tick()
      if (t.state.mode === 'longBreak') break
      clock.advance(POMODORO_DEFAULTS.shortBreakMin * 60)
      t.tick()
    }
    expect(t.state.remainingSec).toBe(POMODORO_DEFAULTS.longBreakMin * 60)
  })

  it('breakStart は長短を区別する', () => {
    const { clock, t } = svc()
    t.start()
    for (let i = 0; i < 3; i++) {
      clock.advance(POMODORO_DEFAULTS.focusMin * 60)
      t.tick()
      clock.advance(POMODORO_DEFAULTS.shortBreakMin * 60)
      t.tick()
    }
    clock.advance(POMODORO_DEFAULTS.focusMin * 60)
    const e = t.tick().find((x) => x.type === 'pomodoro.breakStart')
    expect(e).toEqual({ type: 'pomodoro.breakStart', long: true })
  })

  it('一時停止すると時間が進まない', () => {
    const { clock, t } = svc()
    t.start()
    clock.advance(60)
    const before = t.state.remainingSec

    t.pause()
    expect(t.state.mode).toBe('paused')
    clock.advance(3600)
    expect(t.tick()).toEqual([])
    expect(t.state.remainingSec).toBe(before)

    t.resume()
    expect(t.state.mode).toBe('focus')
    expect(t.state.remainingSec).toBe(before)
  })

  it('停止すると初期状態に戻る', () => {
    const { clock, t } = svc()
    t.start()
    clock.advance(POMODORO_DEFAULTS.focusMin * 60)
    t.tick()
    t.stop()
    expect(t.state).toEqual({ mode: 'off', remainingSec: 0, completedSets: 0 })
  })

  it('スキップで次の区間へ進む', () => {
    const { t } = svc()
    t.start()
    expect(types(t.skip())).toEqual(['pomodoro.setDone', 'pomodoro.breakStart'])
    expect(t.state.mode).toBe('shortBreak')
  })

  it('停止中のスキップは何もしない', () => {
    const { t } = svc()
    expect(t.skip()).toEqual([])
  })

  it('設定を変えると次の区間から反映される', () => {
    const { clock, t } = svc()
    t.setPomodoroSettings({ focusMin: 1, shortBreakMin: 1 })
    t.start()
    expect(t.state.remainingSec).toBe(60)

    clock.advance(60)
    t.tick()
    expect(t.state.remainingSec).toBe(60)
  })

  it('完了セット数が増えていく', () => {
    const { clock, t } = svc()
    t.start()
    for (let i = 0; i < 3; i++) {
      clock.advance(POMODORO_DEFAULTS.focusMin * 60)
      t.tick()
      clock.advance(POMODORO_DEFAULTS.shortBreakMin * 60)
      t.tick()
    }
    expect(t.state.completedSets).toBe(3)
  })
})

describe('アラーム', () => {
  const alarm = (over: Partial<AlarmSpec> = {}): AlarmSpec => ({
    id: 'a1',
    time: '09:30',
    label: '休憩',
    intensity: 'loud',
    enabled: true,
    days: [],
    ...over,
  })

  it('指定時刻に発火する', () => {
    const { clock, t } = svc('2026-01-05T09:29:00')
    t.setAlarms([alarm()])
    expect(t.tick()).toEqual([])

    clock.advance(60)
    expect(t.tick()).toEqual([{ type: 'alarm.fired', id: 'a1', label: '休憩', intensity: 'loud' }])
  })

  it('同じ分に二重発火しない', () => {
    const { clock, t } = svc('2026-01-05T09:30:00')
    t.setAlarms([alarm()])
    expect(t.tick()).toHaveLength(1)
    clock.advance(10)
    expect(t.tick()).toEqual([])
    clock.advance(10)
    expect(t.tick()).toEqual([])
  })

  it('翌日は再び発火する', () => {
    const { clock, t } = svc('2026-01-05T09:30:00')
    t.setAlarms([alarm()])
    expect(t.tick()).toHaveLength(1)

    clock.advance(86_400)
    expect(t.tick()).toHaveLength(1)
  })

  it('無効なアラームは鳴らない', () => {
    const { t } = svc('2026-01-05T09:30:00')
    t.setAlarms([alarm({ enabled: false })])
    expect(t.tick()).toEqual([])
  })

  it('曜日指定が効く', () => {
    // 2026-01-05 は月曜
    const { t } = svc('2026-01-05T09:30:00')
    t.setAlarms([alarm({ days: [1] })]) // 月曜のみ
    expect(t.tick()).toHaveLength(1)

    const sunday = svc('2026-01-04T09:30:00')
    sunday.t.setAlarms([alarm({ days: [1] })])
    expect(sunday.t.tick()).toEqual([])
  })

  it('曜日を空にすると毎日鳴る', () => {
    for (const day of ['2026-01-04', '2026-01-05', '2026-01-06']) {
      const s = svc(`${day}T09:30:00`)
      s.t.setAlarms([alarm({ days: [] })])
      expect(s.t.tick()).toHaveLength(1)
    }
  })

  it('主張度がイベントに乗る', () => {
    for (const intensity of ['quiet', 'normal', 'loud'] as const) {
      const s = svc('2026-01-05T09:30:00')
      s.t.setAlarms([alarm({ intensity })])
      const e = s.t.tick()[0]
      expect(e).toMatchObject({ type: 'alarm.fired', intensity })
    }
  })

  it('複数のアラームが同時に鳴る', () => {
    const { t } = svc('2026-01-05T09:30:00')
    t.setAlarms([alarm({ id: 'a' }), alarm({ id: 'b' })])
    expect(t.tick()).toHaveLength(2)
  })

  it('不正な時刻指定は無視する', () => {
    const { t } = svc('2026-01-05T09:30:00')
    t.setAlarms([alarm({ time: '99:99' })])
    expect(t.tick()).toEqual([])
  })

  it('ポモドーロと同時に動く', () => {
    const { clock, t } = svc('2026-01-05T09:00:00')
    t.setAlarms([alarm({ time: '09:25' })])
    t.start()

    clock.advance(25 * 60)
    const e = t.tick()
    expect(types(e)).toContain('alarm.fired')
    expect(types(e)).toContain('pomodoro.setDone')
  })
})

describe('dayOfWeek', () => {
  it('既知の日付で正しい曜日を返す', () => {
    expect(dayOfWeek('2026-01-04')).toBe(0) // 日
    expect(dayOfWeek('2026-01-05')).toBe(1) // 月
    expect(dayOfWeek('2026-01-10')).toBe(6) // 土
    expect(dayOfWeek('2026-09-05')).toBe(6) // 土
    expect(dayOfWeek('2000-01-01')).toBe(6) // 土
    expect(dayOfWeek('2028-02-29')).toBe(2) // 火（閏日）
  })

  it('不正な形式は null', () => {
    expect(dayOfWeek('2026-1-5')).toBeNull()
    expect(dayOfWeek('nope')).toBeNull()
  })
})

describe('アラームの停止・スヌーズ・自動沈静 (DESIGN §12.2)', () => {
  const alarm = (over: Partial<AlarmSpec> = {}): AlarmSpec => ({
    id: 'a1',
    time: '09:30',
    label: '休憩',
    intensity: 'loud',
    enabled: true,
    days: [],
    ...over,
  })

  it('発火すると鳴り続ける', () => {
    const { t } = svc('2026-01-05T09:30:00')
    t.setAlarms([alarm()])
    t.tick()
    expect(t.ringingAlarm).toMatchObject({ id: 'a1', intensity: 'loud', softened: false })
  })

  it('クリックで止まる', () => {
    const { t } = svc('2026-01-05T09:30:00')
    t.setAlarms([alarm()])
    t.tick()
    t.dismissAlarm()
    expect(t.ringingAlarm).toBeNull()
  })

  it('5 分放置すると自動的に静かになる（無限に走り回らせない）', () => {
    const { clock, t } = svc('2026-01-05T09:30:00')
    t.setAlarms([alarm()])
    t.tick()

    clock.advance(ALARM_SOFTEN_AFTER_SEC - 1)
    t.tick()
    expect(t.ringingAlarm?.intensity).toBe('loud')

    clock.advance(2)
    t.tick()
    expect(t.ringingAlarm).toMatchObject({ intensity: 'quiet', softened: true })
  })

  it('スヌーズすると指定分だけ後に鳴り直す', () => {
    const { clock, t } = svc('2026-01-05T09:30:00')
    t.setSnoozeMinutes(5)
    t.setAlarms([alarm()])
    t.tick()

    t.snoozeAlarm()
    expect(t.ringingAlarm).toBeNull()

    clock.advance(4 * 60)
    expect(t.tick()).toEqual([])
    expect(t.ringingAlarm).toBeNull()

    clock.advance(2 * 60)
    expect(types(t.tick())).toEqual(['alarm.fired'])
    expect(t.ringingAlarm?.id).toBe('a1')
  })

  it('スヌーズ間隔を変えられる', () => {
    const { clock, t } = svc('2026-01-05T09:30:00')
    t.setSnoozeMinutes(1)
    t.setAlarms([alarm()])
    t.tick()
    t.snoozeAlarm()

    clock.advance(70)
    expect(types(t.tick())).toEqual(['alarm.fired'])
  })

  it('スヌーズ中に無効化されたら鳴らない', () => {
    const { clock, t } = svc('2026-01-05T09:30:00')
    t.setAlarms([alarm()])
    t.tick()
    t.snoozeAlarm()

    t.setAlarms([alarm({ enabled: false })])
    clock.advance(6 * 60)
    expect(t.tick()).toEqual([])
  })

  it('鳴っていないときのスヌーズは何もしない', () => {
    const { clock, t } = svc('2026-01-05T09:00:00')
    t.setAlarms([alarm()])
    t.snoozeAlarm()
    clock.advance(10 * 60)
    // 09:10 なので通常の発火時刻でもない
    expect(t.tick()).toEqual([])
  })

  it('全画面中はキャラを出さない判断ができる', () => {
    const { t } = svc()
    expect(t.shouldSuppressAlarmVisuals(true)).toBe(true)
    expect(t.shouldSuppressAlarmVisuals(false)).toBe(false)
  })
})
