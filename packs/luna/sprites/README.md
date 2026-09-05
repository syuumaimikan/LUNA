# sprites/

このディレクトリに以下を配置する（M1–M2 で作成）。

| ファイル | 内容 |
|---------|------|
| `luna@1x.png` | スプライトシート（等倍） |
| `luna@1x.json` | TexturePacker JSON (Hash) 形式のアトラス |
| `luna@2x.png` | 高DPI用（任意） |
| `luna@2x.json` | 同上 |

---

## 必要なフレーム（合計 87 枚）

`mascot.json` の `animations` が参照する名前。アトラスの `frames` キーがこの名前と一致している必要がある（検証 V5）。

参照作品 [Little LUMI Model](https://store.steampowered.com/app/5075020/Little_LUMI_Model/) は
64 挙動 / 122 フレームを手描きで用意している。**枚数が体験の質を決める**ため、
下の分類は「上から順に描けば、その時点で動く」順に並べてある。

### 待機・表情（7枚）

```
idle_00
idle_01
blink_00
blink_01
look_00
look_01
look_02
```
### 歩行・走行（8枚）

```
walk_00
walk_01
walk_02
walk_03
run_00
run_01
run_02
run_03
```
### 休息（6枚）

```
sit_00
sit_01
sleep_00
sleep_01
peek_00
peek_01
```
### 地形移動（18枚）

```
climb_00
climb_01
climb_02
climb_03
hang_00
hang_01
hangmove_00
hangmove_01
hangmove_02
cornerout_00
cornerout_01
cornerout_02
cornerin_00
cornerin_01
turn_00
turn_01
dive_00
dive_01
```
### つかむ・落ちる（10枚）

```
pickup_00
pickup_01
drag_00
drag_01
shake_00
shake_01
shake_02
fall_00
land_00
land_01
```
### なでなで（9枚）

```
pat_soft_00
pat_soft_01
pat_happy_00
pat_happy_01
pat_bliss_00
pat_bliss_01
pat_bliss_02
sulk_00
sulk_01
```
### 感情・リアクション（23枚）

```
wave_00
wave_01
wave_02
happy_00
happy_01
surprised_00
surprised_01
sweat_00
sweat_01
point_00
point_01
yawn_00
yawn_01
yawn_02
stretch_00
stretch_01
stretch_02
tilt_00
tilt_01
cheer_00
cheer_01
siren_00
siren_01
```
### だいすき度 解禁（6枚）

```
snuggle_00
snuggle_01
snuggle_02
celebrate_00
celebrate_01
celebrate_02
```
---

## 作画ガイド

- キャンバス **64×64 px**（@1x）を基準。`display.baseHeight: 128` で 2 倍に表示される。
- **足元が下端に接する**ように描く（`anchor` が足元中央のため）。
- **右向きを正**とし、左向きは自動反転される。左右非対称な意匠は避けるか、
  `flipWhenFacingLeft: false` にして専用フレームを用意する。
- **頭の位置**は `display.headRegion`（既定 x:0.26 y:0.02 w:0.48 h:0.34）に収まるように描く。
  なでなでの判定領域なので、ここがずれると「頭を撫でているのに反応しない」ことになる。
- 地形移動（`climb` / `hang` / `hangMove`）は**キャラを回転させない**。
  壁を登るときも直立のまま、手足だけ壁に向ける。回転させると足元基準が破綻する。
- `cornerOut` は「面の端で向きを変えて別の面に移る」動き。1枚目が旧面、最終フレームが新面の姿勢になるように。
- 書き出しは `trimmed` 有効・`spriteSourceSize` 込みで。

## 描く順番

| 段階 | 描くもの | この時点でできること |
|------|---------|---------------------|
| 1 | 待機・歩行・つかむ・落ちる（必須4種） | 床を歩き、つかんで投げられる |
| 2 | 地形移動 | 窓によじ登り、ぶら下がり、飛び降りる |
| 3 | なでなで | 頭を撫でて反応が返る |
| 4 | 感情・リアクション | PC の状況に反応する |
| 5 | 休息・だいすき度解禁 | 長く一緒にいるほど表情が増える |

仕様は [CHARACTER_PACK.md](../../../docs/CHARACTER_PACK.md#24-animations--アニメーション定義) を参照。
