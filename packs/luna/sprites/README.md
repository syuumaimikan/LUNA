# sprites/

このディレクトリに以下を配置する（M1 で作成）。

| ファイル | 内容 |
|---------|------|
| `luna@1x.png` | スプライトシート（等倍） |
| `luna@1x.json` | TexturePacker JSON (Hash) 形式のアトラス |
| `luna@2x.png` | 高DPI用（任意） |
| `luna@2x.json` | 同上 |

`mascot.json` の `animations` が参照するフレーム名は次の通り。
アトラスの `frames` キーがこの名前と一致している必要がある（検証 V5）。

```
idle_00 idle_01
blink_00 blink_01
look_00 look_01 look_02
walk_00 walk_01 walk_02 walk_03
run_00 run_01 run_02 run_03
sit_00 sit_01
sleep_00 sleep_01
peek_00 peek_01
drag_00 drag_01
fall_00
land_00 land_01
climb_00 climb_01 climb_02
hang_00 hang_01
wave_00 wave_01 wave_02
happy_00 happy_01
surprised_00 surprised_01
sweat_00 sweat_01
point_00 point_01
yawn_00 yawn_01 yawn_02
stretch_00 stretch_01 stretch_02
tilt_00 tilt_01
cheer_00 cheer_01
```

合計 52 フレーム。仕様は [CHARACTER_PACK.md](../../../docs/CHARACTER_PACK.md#23-sprite--アトラス参照) を参照。

作画ガイド:
- キャンバス 64×64 px（@1x）を基準。`display.baseHeight: 128` で 2 倍に表示される。
- 足元が下端に接するように描く（`anchor` が足元中央のため）。
- 右向きを正とし、左向きは自動反転される。左右非対称な意匠は避けるか、`flipWhenFacingLeft: false` にして専用フレームを用意する。
- 書き出しは `trimmed` 有効・`spriteSourceSize` 込みで。
