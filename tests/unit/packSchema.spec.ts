import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SeededRng } from '../../src/shared/rng.js'
import { FakeClock } from '../../src/shared/time.js'
import {
  hasForbiddenExtension,
  mascotPackSchema,
  relativePackPath,
} from '../../src/main/pack/PackSchema.js'
import { validatePack } from '../../src/main/pack/validatePack.js'
import { DialoguePicker, expandPlaceholders } from '../../src/main/pack/Dialogue.js'
import {
  collectSignals,
  conditionDepth,
  evaluateCondition,
} from '../../src/main/reaction/ConditionEvaluator.js'

const root = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url))
const readJson = (p: string) => JSON.parse(readFileSync(root(p), 'utf-8'))

function minimalPack(over: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    id: 'minimal',
    name: 'ミニマル',
    version: '1.0.0',
    display: { baseHeight: 96 },
    sprite: { atlases: [{ scale: 1, image: 'sprites/m@1x.png', data: 'sprites/m@1x.json' }] },
    animations: {
      idle: { frames: ['a'] },
      walk: { frames: ['a'], moveSpeed: 40 },
      drag: { frames: ['a'] },
      fall: { frames: ['a'] },
    },
    states: {
      idle: {
        animation: 'idle',
        minDurationSec: 2,
        maxDurationSec: 6,
        next: [{ state: 'idle', weight: 1 }],
      },
    },
    ...over,
  }
}

describe('実際の packs/luna を読み込める', () => {
  it('mascot.json がスキーマを通る', () => {
    const parsed = mascotPackSchema.safeParse(readJson('packs/luna/mascot.json'))
    if (!parsed.success) console.error(parsed.error.errors)
    expect(parsed.success).toBe(true)
  })

  it('全ての検証を通る', () => {
    const result = validatePack({
      dirName: 'luna',
      mascotJson: readJson('packs/luna/mascot.json'),
      dialogueJson: readJson('packs/luna/dialogue/ja.json'),
      files: ['mascot.json', 'dialogue/ja.json', 'sprites/luna@1x.png'],
    })
    if (!result.ok) console.error(result.issues)
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('CHARACTER_PACK.md の最小パックの例も通る', () => {
    const result = validatePack({ dirName: 'minimal', mascotJson: minimalPack() })
    expect(result.issues).toEqual([])
  })
})

describe('V9: パストラバーサルの拒否（セキュリティ必須要件）', () => {
  const rejected = [
    '../../../etc/passwd',
    '/etc/passwd',
    'C:\\Windows\\System32\\cmd.exe',
    'sprites\\..\\..\\secret.png',
    'a/../../b.png',
    './/x.png',
  ]
  for (const p of rejected) {
    it(`拒否する: ${p}`, () => {
      expect(relativePackPath.safeParse(p).success).toBe(false)
    })
  }

  const accepted = ['sprites/luna@1x.png', 'a/b/c.ogg', 'file.png']
  for (const p of accepted) {
    it(`許可する: ${p}`, () => {
      expect(relativePackPath.safeParse(p).success).toBe(true)
    })
  }

  it('パック内のパス指定にも効く', () => {
    const bad = minimalPack({
      sprite: { atlases: [{ scale: 1, image: '../../../etc/passwd', data: 'a.json' }] },
    })
    const r = validatePack({ dirName: 'minimal', mascotJson: bad })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.rule === 'V1')).toBe(true)
  })
})

describe('V12: 実行可能ファイルの排除（セキュリティ必須要件）', () => {
  for (const f of ['evil.js', 'x.EXE', 'a/b/run.bat', 'setup.ps1', 'mod.dll', 'go.sh', 'p.py']) {
    it(`検出する: ${f}`, () => expect(hasForbiddenExtension(f)).toBe(true))
  }
  for (const f of ['sprites/luna.png', 'dialogue/ja.json', 'sounds/step.ogg']) {
    it(`通す: ${f}`, () => expect(hasForbiddenExtension(f)).toBe(false))
  }

  it('同梱されていたらパックを拒否する', () => {
    const r = validatePack({
      dirName: 'minimal',
      mascotJson: minimalPack(),
      files: ['mascot.json', 'payload.js'],
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.rule === 'V12')).toBe(true)
  })
})

describe('相互参照の検証', () => {
  it('V3: id とディレクトリ名の不一致', () => {
    const r = validatePack({ dirName: 'other', mascotJson: minimalPack() })
    expect(r.issues.some((i) => i.rule === 'V3')).toBe(true)
  })

  it('V4: 必須アニメーションの欠落', () => {
    const p = minimalPack()
    delete (p['animations'] as Record<string, unknown>)['drag']
    const r = validatePack({ dirName: 'minimal', mascotJson: p })
    expect(r.issues.some((i) => i.rule === 'V4' && i.message.includes('drag'))).toBe(true)
  })

  it('V6: 未定義の状態への遷移', () => {
    const p = minimalPack({
      states: {
        idle: {
          animation: 'idle',
          minDurationSec: 1,
          maxDurationSec: 2,
          next: [{ state: 'ghost', weight: 1 }],
        },
      },
    })
    const r = validatePack({ dirName: 'minimal', mascotJson: p })
    expect(r.issues.some((i) => i.rule === 'V6' && i.message.includes('ghost'))).toBe(true)
  })

  it('V6: 未定義のアニメーション参照', () => {
    const p = minimalPack({
      states: { idle: { animation: 'missing', minDurationSec: 1, maxDurationSec: 2 } },
    })
    expect(
      validatePack({ dirName: 'minimal', mascotJson: p }).issues.some((i) => i.rule === 'V6'),
    ).toBe(true)
  })

  it('V6: min > max の滞在時間', () => {
    const p = minimalPack({
      states: { idle: { animation: 'idle', minDurationSec: 10, maxDurationSec: 2 } },
    })
    expect(
      validatePack({ dirName: 'minimal', mascotJson: p }).issues.some((i) => i.rule === 'V6'),
    ).toBe(true)
  })

  it('V7: dialogue に無いセリフキー', () => {
    const p = minimalPack({
      reactions: [{ id: 'r', when: { signal: 'net.offline' }, do: [{ say: 'nonexistent' }] }],
    })
    const r = validatePack({
      dirName: 'minimal',
      mascotJson: p,
      dialogueJson: { locale: 'ja', lines: { other: ['x'] } },
    })
    expect(r.issues.some((i) => i.rule === 'V7')).toBe(true)
  })

  it('V8: priority 3 をタイマー以外に付けたら弾く', () => {
    const p = minimalPack({
      reactions: [
        { id: 'sneaky', when: { signal: 'cpu.high' }, priority: 3, do: [{ play: 'idle' }] },
      ],
    })
    const r = validatePack({ dirName: 'minimal', mascotJson: p })
    expect(r.issues.some((i) => i.rule === 'V8' && i.message.includes('priority 3'))).toBe(true)
  })

  it('V8: priority 3 はタイマー由来なら通る', () => {
    const p = minimalPack({
      reactions: [
        { id: 'ok', when: { signal: 'alarm.fired' }, priority: 3, do: [{ play: 'idle' }] },
      ],
    })
    expect(validatePack({ dirName: 'minimal', mascotJson: p }).issues).toEqual([])
  })

  it('V8: リアクション id の重複', () => {
    const p = minimalPack({
      reactions: [
        { id: 'dup', when: { signal: 'net.offline' }, do: [{ play: 'idle' }] },
        { id: 'dup', when: { signal: 'net.online' }, do: [{ play: 'idle' }] },
      ],
    })
    expect(
      validatePack({ dirName: 'minimal', mascotJson: p }).issues.some((i) => i.rule === 'V8'),
    ).toBe(true)
  })

  it('V8: 待ち時間の合計が上限を超える', () => {
    const p = minimalPack({
      reactions: [
        {
          id: 'slow',
          when: { signal: 'net.offline' },
          do: Array.from({ length: 3 }, () => ({ wait: 5000 })),
        },
      ],
    })
    expect(
      validatePack({ dirName: 'minimal', mascotJson: p }).issues.some((i) => i.rule === 'V8'),
    ).toBe(true)
  })

  it('未知のシグナル名は弾く', () => {
    const p = minimalPack({
      reactions: [{ id: 'x', when: { signal: 'made.up' }, do: [{ play: 'idle' }] }],
    })
    expect(validatePack({ dirName: 'minimal', mascotJson: p }).ok).toBe(false)
  })

  it('V13: headRegion が枠を出ていたら弾く', () => {
    const p = minimalPack({
      display: { baseHeight: 96, headRegion: { x: 0.8, y: 0, w: 0.5, h: 0.3 } },
    })
    expect(validatePack({ dirName: 'minimal', mascotJson: p }).ok).toBe(false)
  })
})

describe('条件 DSL の評価', () => {
  const clock = new FakeClock(Date.parse('2026-01-01T02:00:00'))
  const ctx = (over: Partial<Parameters<typeof evaluateCondition>[1]> = {}) => ({
    firedSignal: 'cpu.high',
    payload: {},
    activeSignals: new Set<string>(),
    affinityStage: 1,
    ...over,
  })

  it('signal は発火中か継続中で真', () => {
    expect(evaluateCondition({ signal: 'cpu.high' }, ctx(), clock)).toBe(true)
    expect(evaluateCondition({ signal: 'net.offline' }, ctx(), clock)).toBe(false)
    expect(
      evaluateCondition(
        { signal: 'battery.charging' },
        ctx({ activeSignals: new Set(['battery.charging']) }),
        clock,
      ),
    ).toBe(true)
  })

  it('where で数値比較ができる', () => {
    const c = { signal: 'user.back', where: { awaySec: { gte: 1800 } } }
    expect(
      evaluateCondition(c, ctx({ firedSignal: 'user.back', payload: { awaySec: 3600 } }), clock),
    ).toBe(true)
    expect(
      evaluateCondition(c, ctx({ firedSignal: 'user.back', payload: { awaySec: 100 } }), clock),
    ).toBe(false)
  })

  it('where の in / eq が効く', () => {
    const c = { signal: 'app.changed', where: { category: { in: ['game', 'meeting'] } } }
    expect(
      evaluateCondition(
        c,
        ctx({ firedSignal: 'app.changed', payload: { category: 'game' } }),
        clock,
      ),
    ).toBe(true)
    expect(
      evaluateCondition(
        c,
        ctx({ firedSignal: 'app.changed', payload: { category: 'browser' } }),
        clock,
      ),
    ).toBe(false)
  })

  it('数値比較に非数値を渡しても落ちない', () => {
    const c = { signal: 'user.back', where: { awaySec: { gte: 10 } } }
    expect(
      evaluateCondition(c, ctx({ firedSignal: 'user.back', payload: { awaySec: 'x' } }), clock),
    ).toBe(false)
  })

  it('all / any / not が合成できる', () => {
    const c = {
      all: [{ signal: 'cpu.high' }, { not: { signal: 'battery.charging' } }],
    }
    expect(evaluateCondition(c, ctx(), clock)).toBe(true)
    expect(evaluateCondition(c, ctx({ activeSignals: new Set(['battery.charging']) }), clock)).toBe(
      false,
    )

    expect(
      evaluateCondition({ any: [{ signal: 'net.offline' }, { signal: 'cpu.high' }] }, ctx(), clock),
    ).toBe(true)
  })

  it('timeBetween は日を跨ぐ範囲を扱える', () => {
    expect(evaluateCondition({ timeBetween: ['01:00', '04:00'] }, ctx(), clock)).toBe(true)
    expect(evaluateCondition({ timeBetween: ['09:00', '17:00'] }, ctx(), clock)).toBe(false)
    expect(evaluateCondition({ timeBetween: ['23:00', '05:00'] }, ctx(), clock)).toBe(true)
  })

  it('minStage が効く', () => {
    expect(evaluateCondition({ minStage: 5 }, ctx({ affinityStage: 4 }), clock)).toBe(false)
    expect(evaluateCondition({ minStage: 5 }, ctx({ affinityStage: 5 }), clock)).toBe(true)
  })

  it('シグナル名を集められる', () => {
    expect(
      collectSignals({ all: [{ signal: 'cpu.high' }, { not: { signal: 'net.offline' } }] }).sort(),
    ).toEqual(['cpu.high', 'net.offline'])
  })

  it('ネストの深さを測れる', () => {
    expect(conditionDepth({ signal: 'cpu.high' })).toBe(1)
    expect(conditionDepth({ all: [{ signal: 'cpu.high' }] })).toBe(2)
    expect(conditionDepth({ not: { all: [{ any: [{ signal: 'cpu.high' }] }] } })).toBe(4)
  })
})

describe('セリフの選択と展開', () => {
  const dialogue = {
    locale: 'ja',
    lines: {
      greet: [
        'おかえり！',
        { text: 'まってたよ〜', minStage: 2 },
        { text: '{{userName}}、おかえり！', minStage: 5 },
      ],
      only5: [{ text: 'ずっといっしょ', minStage: 5 }],
    },
  }

  it('段階に応じて語彙が増える', () => {
    const p = new DialoguePicker(dialogue, new SeededRng(1))
    expect(p.countAvailable('greet', 1)).toBe(1)
    expect(p.countAvailable('greet', 2)).toBe(2)
    expect(p.countAvailable('greet', 5)).toBe(3)
  })

  it('段階が足りない行は選ばれない', () => {
    const p = new DialoguePicker(dialogue, new SeededRng(1))
    for (let i = 0; i < 50; i++) expect(p.pick('greet', 1)).toBe('おかえり！')
  })

  it('段階を満たす行が無ければ null（発話をスキップ）', () => {
    const p = new DialoguePicker(dialogue, new SeededRng(1))
    expect(p.pick('only5', 3)).toBeNull()
  })

  it('存在しないキーは null', () => {
    expect(new DialoguePicker(dialogue, new SeededRng(1)).pick('nope', 6)).toBeNull()
  })

  it('dialogue が無いパックは何も喋らない', () => {
    expect(new DialoguePicker(null, new SeededRng(1)).pick('greet', 6)).toBeNull()
  })

  it('直前に使った行を連続で選ばない', () => {
    const p = new DialoguePicker(dialogue, new SeededRng(7))
    let prev: string | null = null
    for (let i = 0; i < 60; i++) {
      const cur = p.pick('greet', 5, { userName: 'ゆう' })
      expect(cur).not.toBe(prev)
      prev = cur
    }
  })

  it('候補が 1 本しか無ければ繰り返してよい', () => {
    const p = new DialoguePicker(dialogue, new SeededRng(7))
    expect(p.pick('greet', 1)).toBe('おかえり！')
    expect(p.pick('greet', 1)).toBe('おかえり！')
  })

  it('プレースホルダを展開する', () => {
    expect(expandPlaceholders('{{cpu}}%…がんばりすぎ！', { cpu: 93 })).toBe('93%…がんばりすぎ！')
    expect(expandPlaceholders('もう{{hour}}時だよ', { hour: 2 })).toBe('もう2時だよ')
  })

  it('未知の変数は空文字になる（任意の値を差し込ませない）', () => {
    expect(expandPlaceholders('a{{secret}}b', { cpu: 1 })).toBe('ab')
    // プロトタイプ鎖から内部表現が漏れないこと
    expect(expandPlaceholders('a{{constructor}}b', {})).toBe('ab')
    expect(expandPlaceholders('a{{toString}}b', {})).toBe('ab')
    expect(expandPlaceholders('a{{__proto__}}b', {})).toBe('ab')
    expect(expandPlaceholders('a{{hasOwnProperty}}b', {})).toBe('ab')
  })
})
