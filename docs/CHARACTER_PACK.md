# キャラクターパック仕様 v1

LUNA のキャラクターは **JSON + PNG のデータのみ**で構成される。
**パックは実行可能コードを一切含まない。** 振る舞いは本書の宣言的スキーマで表現する（[DESIGN.md §12](./DESIGN.md#12-セキュリティ) 参照）。

---

## 1. ディレクトリ構成

```
packs/<packId>/
├─ mascot.json            必須  マニフェスト（本書の中心）
├─ sprites/
│  ├─ <name>@1x.png       必須  スプライトシート
│  ├─ <name>@1x.json      必須  アトラス（TexturePacker Hash 形式）
│  ├─ <name>@2x.png       任意  高DPI用
│  └─ <name>@2x.json      任意
├─ dialogue/
│  ├─ ja.json             必須  セリフ（既定ロケール）
│  └─ en.json             任意
└─ sounds/                任意  効果音 (.ogg / .wav)
```

`packId` は `^[a-z0-9][a-z0-9_-]{1,31}$`。ディレクトリ名と `mascot.json` の `id` は一致していなければならない。

インストール先は `%APPDATA%\LUNA\packs\<packId>\`。同梱パックはアプリの `resources/packs/` に置かれ、同名があればユーザー側が優先される。

---

## 2. mascot.json

### 2.1 トップレベル

```jsonc
{
  "schemaVersion": 1,           // 必須。互換性判定に使う
  "id": "luna",                 // 必須
  "name": "ルナ",                // 必須 表示名
  "author": "syuumaimikan",
  "version": "1.0.0",           // semver
  "license": "CC-BY-4.0",
  "description": "月みたいにのんびりした子",

  "display": { ... },           // 必須 §2.2
  "sprite":  { ... },           // 必須 §2.3
  "animations": { ... },        // 必須 §2.4
  "states": { ... },            // 必須 §2.5
  "interactions": { ... },      // 任意 §2.6
  "reactions": [ ... ],         // 任意 §2.7
  "personality": { ... }        // 任意 §2.8
}
```

### 2.2 display — 大きさと基準点

```jsonc
"display": {
  "baseHeight": 128,       // dip。この高さになるようスプライトを一律スケールする
  "anchor": { "x": 0.5, "y": 1.0 },   // 基準点（0–1）。既定は「足元中央」
  "footOffset": 2,         // 基準点から実際の接地位置までのpxオフセット（影のはみ出し補正）
  "hitPadding": 3          // ヒットマスクの膨張px（DESIGN.md §5.3 のヒステリシス用）
}
```

`baseHeight` を基準に全アニメが同じ倍率でスケールされるため、フレーム間で身長が揺れない。

### 2.3 sprite — アトラス参照

```jsonc
"sprite": {
  "atlases": [
    { "scale": 1, "image": "sprites/luna@1x.png", "data": "sprites/luna@1x.json" },
    { "scale": 2, "image": "sprites/luna@2x.png", "data": "sprites/luna@2x.json" }
  ],
  "scaleMode": "nearest"   // "nearest" | "linear"。ドット絵は nearest
}
```

エンジンは実行時の `devicePixelRatio × display.scalePercent` に対し、**それ以上で最小の `scale`** を選ぶ。
無ければ最大のものを使う。@1x のみでも動作する（拡大時に少しぼやける）。

アトラス JSON は **TexturePacker の JSON (Hash)** 形式。必要なキーは以下だけで、他は無視される。

```jsonc
{
  "frames": {
    "idle_00": {
      "frame":  { "x": 0, "y": 0, "w": 64, "h": 64 },
      "rotated": false,
      "trimmed": true,
      "spriteSourceSize": { "x": 4, "y": 2, "w": 56, "h": 62 },
      "sourceSize": { "w": 64, "h": 64 }
    }
  },
  "meta": { "image": "luna@1x.png", "size": { "w": 512, "h": 512 }, "scale": "1" }
}
```

> **注意**: `trimmed: true` のフレームは `spriteSourceSize` が無いと位置が狂う。エクスポート時に必ず含めること。

### 2.4 animations — アニメーション定義

```jsonc
"animations": {
  "idle": {
    "frames": ["idle_00", "idle_01", "idle_02", "idle_01"],
    "fps": 6,
    "loop": true
  },
  "blink": {
    "frames": [
      { "name": "idle_00", "durationMs": 2000 },   // 可変尺も書ける
      { "name": "blink_00", "durationMs": 80 },
      { "name": "blink_01", "durationMs": 60 }
    ],
    "loop": true
  },
  "walk": {
    "frames": ["walk_00", "walk_01", "walk_02", "walk_03"],
    "fps": 10,
    "loop": true,
    "moveSpeed": 42,          // dip/s。歩行系のみ有効
    "events": [
      { "atFrame": 0, "sound": "sounds/step.ogg", "volume": 0.3 },
      { "atFrame": 2, "sound": "sounds/step.ogg", "volume": 0.3 }
    ]
  },
  "drag": { "frames": ["drag_00", "drag_01"], "fps": 8, "loop": true },
  "fall": { "frames": ["fall_00"], "fps": 1, "loop": true },
  "land": { "frames": ["land_00", "land_01", "idle_00"], "fps": 12, "loop": false }
}
```

| フィールド | 型 | 既定 | 説明 |
|-----------|----|------|------|
| `frames` | `(string \| {name, durationMs})[]` | 必須 | 1 以上 512 以下 |
| `fps` | number | 8 | `durationMs` 指定フレームには適用されない |
| `loop` | boolean | true | `false` なら再生完了で状態遷移をトリガ |
| `moveSpeed` | number | 0 | 移動系状態でのみ使用 |
| `flipWhenFacingLeft` | boolean | true | 左向き時に水平反転する |
| `events` | object[] | — | フレーム到達時の効果音。`sound` はパック内相対パスのみ |

**必須アニメーション**: `idle`, `walk`, `drag`, `fall`。これらが無いパックは読み込みを拒否する。
他はフォールバックする（例: `run` が無ければ `walk` を `moveSpeed` 2 倍で代用）。

### 2.5 states — 振る舞いの遷移

```jsonc
"states": {
  "idle": {
    "animation": "blink",
    "minDurationSec": 2,
    "maxDurationSec": 8,
    "interruptible": true,
    "next": [
      { "state": "walk", "weight": 40 },
      { "state": "look", "weight": 25 },
      { "state": "sit",  "weight": 20 },
      { "state": "idle", "weight": 15 }
    ]
  },
  "walk": {
    "animation": "walk",
    "minDurationSec": 2,
    "maxDurationSec": 6,
    "movement": "horizontal",     // "none" | "horizontal"
    "next": [
      { "state": "idle", "weight": 60 },
      { "state": "run",  "weight": 15 },
      { "state": "walk", "weight": 25 }
    ]
  },
  "sit": {
    "animation": "sit",
    "minDurationSec": 5,
    "maxDurationSec": 30,
    "next": [
      { "state": "idle",  "weight": 70 },
      { "state": "sleep", "weight": 30 }
    ]
  },
  "sleep": {
    "animation": "sleep",
    "minDurationSec": 20,
    "maxDurationSec": 300,
    "effect": "zzz",              // 内蔵エフェクト（§2.9）
    "next": [{ "state": "idle", "weight": 100 }]
  }
}
```

| フィールド | 説明 |
|-----------|------|
| `animation` | 再生するアニメーション名 |
| `min/maxDurationSec` | 滞在時間の一様乱数範囲。`loop:false` のアニメでは再生完了が優先 |
| `movement` | `horizontal` なら `animation.moveSpeed` で移動する |
| `interruptible` | `false` なら Pri 2 未満の割り込みを拒否（既定 `true`） |
| `effect` | 付随する内蔵エフェクト |
| `next` | 遷移候補と重み。重みはエンジン側で文脈補正される（DESIGN.md §7.3） |

**エンジン予約状態**: `drag` / `fall` / `land` / `climbEdge` / `hang` / `talk` / `react` は
物理・入力・リアクションが直接制御するため `next` を書いても無視される。アニメーション定義だけ用意すればよい。

`states` には `idle` が必ず必要。遷移先に存在しない状態名を書いた場合は読み込みエラー。

### 2.6 interactions — ユーザー操作への反応

```jsonc
"interactions": {
  "click":       { "play": "surprised", "say": "click", "cooldownSec": 3 },
  "doubleClick": { "play": "happy", "say": "pet", "cooldownSec": 5 },
  "dragStart":   { "play": "drag" },
  "dragEnd":     { "play": "fall" },
  "hover":       { "play": "look", "cooldownSec": 10 }
}
```

`say` の値は `dialogue/<locale>.json` のキー。

### 2.7 reactions — PC 状況への反応

パックが定義できる**唯一の条件付きロジック**。宣言的で、評価はエンジンが行う。

```jsonc
"reactions": [
  {
    "id": "cpu-hot",
    "when": { "signal": "cpu.sustainedHigh" },
    "priority": 1,
    "cooldownSec": 900,
    "silentOk": false,           // 静音モード中は実行しない
    "do": [
      { "play": "sweat" },
      { "say": "cpu_high" }
    ]
  },
  {
    "id": "battery-low",
    "when": {
      "all": [
        { "signal": "battery.low" },
        { "not": { "signal": "battery.charging" } }
      ]
    },
    "priority": 2,
    "cooldownSec": 1800,
    "do": [{ "play": "point" }, { "say": "battery_low" }]
  },
  {
    "id": "welcome-back",
    "when": { "signal": "user.back", "where": { "awaySec": { "gte": 1800 } } },
    "priority": 1,
    "cooldownSec": 300,
    "do": [{ "play": "wave" }, { "say": "welcome_back" }]
  },
  {
    "id": "game-quiet",
    "when": { "signal": "app.changed", "where": { "category": { "eq": "game" } } },
    "priority": 1,
    "cooldownSec": 60,
    "silentOk": true,            // 発話しないので静音モードでも可
    "do": [{ "moveTo": "cornerNearest" }, { "play": "sit" }]
  }
]
```

#### 条件 DSL

閉じた小さな文法のみを許す。任意式・関数・正規表現は**受け付けない**。

| 形 | 意味 |
|----|------|
| `{ "signal": "<id>" }` | そのシグナルが発火した |
| `{ "signal": "<id>", "where": {...} }` | 加えてペイロードが条件を満たす |
| `{ "all": [ ... ] }` | 全て真 |
| `{ "any": [ ... ] }` | いずれか真 |
| `{ "not": { ... } }` | 否定 |
| `{ "timeBetween": ["23:00", "05:00"] }` | 現在時刻が範囲内 |

`where` の比較演算子: `eq` / `ne` / `gt` / `gte` / `lt` / `lte` / `in`。値はプリミティブと配列のみ。
ネストの深さは 5 まで、1 パックあたりのルール数は 100 まで。

#### アクション (`do`)

| アクション | 引数 | 説明 |
|-----------|------|------|
| `play` | アニメーション名 | 1 回再生して元の状態へ戻る |
| `say` | セリフキー | 吹き出し表示（Governor の抑制対象） |
| `effect` | 内蔵エフェクト名 | §2.9 |
| `moveTo` | `cornerNearest` \| `cursor` \| `center` | 移動先。座標指定は不可 |
| `setState` | 状態名 | 指定状態へ遷移 |
| `sound` | パック内相対パス | 効果音 |
| `wait` | ミリ秒 (≤5000) | 次のアクションまでの待ち |

1 ルールあたりのアクション数は 8 まで。合計待ち時間は 10 秒まで。

#### 利用可能なシグナル

`cpu.high` / `cpu.sustainedHigh` / `cpu.calm` / `mem.high` /
`battery.low` / `battery.critical` / `battery.charging` / `battery.full` /
`time.hourly` / `time.morning` / `time.noon` / `time.evening` / `time.lateNight` /
`user.away` / `user.back` /
`session.lock` / `session.unlock` / `session.suspend` / `session.resume` /
`app.changed` / `app.fullscreen` /
`net.offline` / `net.online` /
`display.changed`

ペイロードは [DESIGN.md §9.1](./DESIGN.md#91-センサー一覧) の表に対応する
（例: `app.changed` は `{ exe, title?, category }`、`user.back` は `{ awaySec }`、`cpu.*` は `{ percent }`）。

### 2.8 personality — 素の性格

```jsonc
"personality": {
  "activity": 0.5,      // 0=じっとしている  1=動き回る
  "talkative": 0.4,     // 0=無口  1=よく喋る
  "curiosity": 0.6,     // カーソルやウィンドウに寄っていく度合い
  "sleepiness": 0.5     // sleep への遷移しやすさ
}
```

`states` の重みに乗算される係数。エンジンの文脈補正（DESIGN.md §7.3）と合成される。

### 2.9 内蔵エフェクト

パック側で画像を用意しなくてもエンジンが描く汎用エフェクト。

`zzz` / `sweat` / `note` / `heart` / `question` / `exclaim` / `sparkle` / `dust`

---

## 3. dialogue/<locale>.json

```jsonc
{
  "locale": "ja",
  "lines": {
    "click":        ["わっ", "なあに？", "くすぐったいよ"],
    "pet":          ["えへへ", "もっと〜"],
    "cpu_high":     ["うわ、パソコンあつあつだよ…", "{{cpu}}%…がんばりすぎ！"],
    "battery_low":  ["そろそろ充電しよ？", "のこり{{batteryPercent}}%だよ"],
    "welcome_back": ["おかえり！", "まってたよ〜"],
    "late_night":   ["そろそろ寝よ…？", "もう{{hour}}時だよ"]
  }
}
```

- 値は配列。実行時にランダムで 1 本選ばれ、**直前に使ったものは連続で選ばれない**。
- 1 行は 60 文字まで。超過分は切り詰められる。
- プレースホルダは `{{name}}` 形式で、**エンジンが提供する変数のみ**展開される。未知の名前は空文字になる。

| 変数 | 内容 |
|------|------|
| `{{hour}}` `{{minute}}` | 現在時刻 |
| `{{cpu}}` `{{mem}}` | 使用率(整数%) |
| `{{batteryPercent}}` | 電池残量 |
| `{{appName}}` | 前景アプリの表示名 |
| `{{userName}}` | 設定で入力した呼び名（未設定なら「きみ」） |
| `{{mascotName}}` | `mascot.json` の `name` |

ロケール解決は `設定のロケール → ja → 最初に見つかったファイル` の順。欠けたキーは他ロケールにフォールバックし、それも無ければ発話をスキップする。

---

## 4. 検証ルール

読み込み時に以下を全て通したパックのみ有効になる。1 つでも落ちれば**そのパックだけ**無効化し、アプリは起動を続ける（エラーは設定画面に一覧表示）。

| # | 検証 |
|---|------|
| V1 | zod スキーマ適合（型・必須・列挙値） |
| V2 | `schemaVersion` がサポート範囲内（現在 `1`） |
| V3 | `id` がディレクトリ名と一致し、命名規則を満たす |
| V4 | 必須アニメーション (`idle`/`walk`/`drag`/`fall`) が存在 |
| V5 | 全 `frames` の名前がアトラスに存在 |
| V6 | `states` に `idle` が存在し、全 `next.state` が定義済み |
| V7 | `interactions` / `reactions` の `play` / `say` 参照先が存在 |
| V8 | 条件 DSL のネスト ≤ 5、ルール数 ≤ 100、アクション数 ≤ 8 |
| V9 | 全ファイル参照がパックルート配下に正規化される（`..`・絶対パス・ドライブ指定・シンボリックリンクを拒否） |
| V10 | 画像は PNG のみ、1 枚 4096×4096 以下 |
| V11 | パック総容量 ≤ 64MB、総フレーム数 ≤ 512、音声 1 本 ≤ 512KB |
| V12 | **JS/実行ファイルが含まれていない**（`.js` `.exe` `.dll` `.bat` `.ps1` 等を検出したら拒否） |

V9 と V12 はセキュリティ上の必須要件で、緩めてはならない。

---

## 5. 最小パックの例

動く最小構成は次の 3 ファイル。

```
packs/minimal/
├─ mascot.json
├─ sprites/m@1x.png
└─ sprites/m@1x.json
```

```jsonc
{
  "schemaVersion": 1,
  "id": "minimal",
  "name": "ミニマル",
  "version": "1.0.0",
  "display": { "baseHeight": 96 },
  "sprite": { "atlases": [{ "scale": 1, "image": "sprites/m@1x.png", "data": "sprites/m@1x.json" }] },
  "animations": {
    "idle": { "frames": ["a"], "loop": true },
    "walk": { "frames": ["a"], "loop": true, "moveSpeed": 40 },
    "drag": { "frames": ["a"], "loop": true },
    "fall": { "frames": ["a"], "loop": true }
  },
  "states": {
    "idle": { "animation": "idle", "minDurationSec": 2, "maxDurationSec": 6,
              "next": [{ "state": "walk", "weight": 50 }, { "state": "idle", "weight": 50 }] },
    "walk": { "animation": "walk", "minDurationSec": 2, "maxDurationSec": 5, "movement": "horizontal",
              "next": [{ "state": "idle", "weight": 100 }] }
  }
}
```

`dialogue` が無いパックは一切喋らない（それも仕様として正しい）。

---

## 6. 互換性ポリシー

- `schemaVersion` は破壊的変更時にのみ上げる。フィールド追加は上げない。
- エンジンは**未知のフィールドを黙って無視**する（前方互換）。
- 新しい `schemaVersion` のパックを古いエンジンが読んだ場合は、V2 で明示的に「エンジンの更新が必要」と表示して拒否する。
- 既定パック `luna` は常に最新スキーマの参照実装として維持する。
