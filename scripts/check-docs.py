#!/usr/bin/env python3
"""ドキュメントの内部リンクとキャラクターパックの整合性を検査する。

CI (npm run check:docs) から呼ぶ想定。失敗すると非ゼロで終了する。
アンカーの生成規則は GitHub の github-slugger に合わせてある
（記号を除去し、空白を「1つずつ」ハイフンに置換する — 連続空白は連続ハイフンになる）。
"""
import json, os, re, sys, glob, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# github-slugger は Unicode の句読点・記号カテゴリ (P* / S*) を除去し、
# ハイフンとアンダースコアだけを残す。空白は「1文字ずつ」ハイフンに置換されるため、
# 連続空白（記号を挟んだ「a — b」など）は連続ハイフンになる点に注意。
_KEEP = {'-', '_'}

def slug(heading: str) -> str:
    s = ''.join(
        c for c in heading.strip()
        if c in _KEEP or not unicodedata.category(c).startswith(('P', 'S', 'C'))
    )
    return s.lower().replace(' ', '-')

# 検査対象から外すディレクトリ（依存パッケージやビルド成果物の README まで拾わない）
EXCLUDED_DIRS = {'node_modules', 'out', 'dist', 'coverage', '.git', '.venv'}


def project_markdown_files():
    """リポジトリ自身の .md だけを列挙する。"""
    out = []
    for dirpath, dirnames, filenames in os.walk(ROOT):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS]
        for fn in filenames:
            if fn.endswith('.md'):
                out.append(os.path.relpath(os.path.join(dirpath, fn), ROOT))
    return sorted(out)


def check_links(errors):
    anchors = {}
    files = project_markdown_files()
    for f in files:
        text = open(os.path.join(ROOT, f), encoding='utf-8').read()
        anchors[os.path.normpath(f)] = {slug(m) for m in re.findall(r'^#{1,6}\s+(.*)$', text, re.M)}
    for f in files:
        base = os.path.dirname(f)
        text = open(os.path.join(ROOT, f), encoding='utf-8').read()
        for _, link in re.findall(r'\[([^\]]*)\]\(([^)]+)\)', text):
            if link.startswith(('http://', 'https://', 'mailto:')):
                continue
            path, _, frag = link.partition('#')
            target = os.path.normpath(os.path.join(base, path)) if path else os.path.normpath(f)
            if not os.path.exists(os.path.join(ROOT, target)):
                errors.append(f'{f}: リンク先のファイルが無い -> {link}')
            elif frag and frag not in anchors.get(target, set()):
                errors.append(f'{f}: アンカーが見つからない -> {link}')

EFFECTS = {'zzz', 'sweat', 'note', 'heart', 'question', 'exclaim', 'sparkle', 'dust'}
MOVE_TO = {'cornerNearest', 'cursor', 'center', 'floor'}
SIGNALS = set("""cpu.high cpu.sustainedHigh cpu.calm mem.high battery.low battery.critical
battery.charging battery.full time.hourly time.morning time.noon time.evening time.lateNight
user.away user.back session.lock session.unlock session.suspend session.resume app.changed
app.fullscreen net.offline net.online display.changed pomodoro.focusStart pomodoro.breakStart
pomodoro.setDone alarm.fired affinity.stageUp""".split())
REQUIRED_ANIMS = ('idle', 'walk', 'drag', 'fall')

def check_pack(pack_dir, errors):
    rel = os.path.relpath(pack_dir, ROOT)
    m = json.load(open(os.path.join(pack_dir, 'mascot.json'), encoding='utf-8'))
    dlg_path = os.path.join(pack_dir, 'dialogue', 'ja.json')
    lines = set()
    dialogue = {}
    if os.path.exists(dlg_path):
        dialogue = json.load(open(dlg_path, encoding='utf-8'))['lines']
        lines = set(dialogue)
    anims, states = set(m['animations']), set(m['states'])

    def E(msg): errors.append(f'{rel}: {msg}')

    # V3
    if m['id'] != os.path.basename(pack_dir):
        E(f"V3: id '{m['id']}' がディレクトリ名と一致しない")
    # V4
    for req in REQUIRED_ANIMS:
        if req not in anims:
            E(f"V4: 必須アニメーション '{req}' が無い")
    # V6
    if 'idle' not in states:
        E("V6: 状態 'idle' が無い")
    for s, cfg in m['states'].items():
        if cfg['animation'] not in anims:
            E(f"V6: 状態 {s} の animation '{cfg['animation']}' が未定義")
        for n in cfg.get('next', []):
            if n['state'] not in states:
                E(f"V6: 状態 {s} の next '{n['state']}' が未定義")
        if 'effect' in cfg and cfg['effect'] not in EFFECTS:
            E(f"V7: 状態 {s} の effect '{cfg['effect']}' が不明")
        if 'minStage' in cfg and not 1 <= cfg['minStage'] <= 6:
            E(f"V14: 状態 {s} の minStage が範囲外")

    def check_action(ctx, a):
        for k, v in a.items():
            if k == 'play' and v not in anims:   E(f"V7: {ctx} の play '{v}' が未定義")
            if k == 'say' and v not in lines:    E(f"V7: {ctx} の say '{v}' が未定義")
            if k == 'effect' and v not in EFFECTS: E(f"V7: {ctx} の effect '{v}' が不明")
            if k == 'setState' and v not in states: E(f"V7: {ctx} の setState '{v}' が未定義")
            if k == 'moveTo' and v not in MOVE_TO:  E(f"V7: {ctx} の moveTo '{v}' が不明")
            if k == 'wait' and v > 5000:            E(f"V8: {ctx} の wait が 5000ms 超")

    for k, cfg in m.get('interactions', {}).items():
        if k == 'headPat':
            for tier, tc in cfg.items():
                if tier not in ('soft', 'happy', 'bliss'):
                    E(f"interactions.headPat の段階 '{tier}' が不明")
                check_action(f'interactions.headPat.{tier}', tc)
        else:
            check_action(f'interactions.{k}', cfg)

    def collect_signals(c, out, depth=1, ctx=''):
        if depth > 5: E(f"V8: {ctx} の条件が 5 段を超えてネストしている")
        if 'signal' in c:
            out.append(c['signal'])
            if c['signal'] not in SIGNALS: E(f"{ctx}: 未知のシグナル '{c['signal']}'")
        for key in ('all', 'any'):
            for sub in c.get(key, []): collect_signals(sub, out, depth + 1, ctx)
        if 'not' in c: collect_signals(c['not'], out, depth + 1, ctx)
        if 'minStage' in c and not 1 <= c['minStage'] <= 6:
            E(f"V14: {ctx} の minStage が範囲外")

    reactions = m.get('reactions', [])
    if len(reactions) > 100: E('V8: リアクションが 100 件を超えている')
    for r in reactions:
        ctx = f"reaction {r['id']}"
        sigs = []
        collect_signals(r['when'], sigs, ctx=ctx)
        if len(r['do']) > 8: E(f'V8: {ctx} のアクションが 8 個を超えている')
        if sum(a.get('wait', 0) for a in r['do']) > 10000: E(f'V8: {ctx} の待ち時間合計が 10s 超')
        for a in r['do']: check_action(ctx, a)
        if r.get('priority') == 3 and not all(s.startswith(('pomodoro.', 'alarm.')) for s in sigs):
            E(f'{ctx}: priority 3 はタイマー由来のシグナルにのみ許される {sigs}')

    for k, arr in dialogue.items():
        for e in arr:
            t = e if isinstance(e, str) else e['text']
            if len(t) > 60: E(f'dialogue {k}: 60 文字を超える行がある')
            if isinstance(e, dict) and not 1 <= e['minStage'] <= 6:
                E(f'dialogue {k}: minStage が範囲外')

    hr = m['display'].get('headRegion')
    if hr and (not all(0 <= hr[x] <= 1 for x in 'xywh') or hr['x'] + hr['w'] > 1 or hr['y'] + hr['h'] > 1):
        E('V13: headRegion が 0–1 の範囲に収まっていない')

    frames = set()
    for a in m['animations'].values():
        for f in a['frames']:
            frames.add(f if isinstance(f, str) else f['name'])
    if len(frames) > 512: E('V11: フレーム数が 512 を超えている')
    sr = os.path.join(pack_dir, 'sprites', 'README.md')
    if os.path.exists(sr):
        doc = open(sr, encoding='utf-8').read()
        missing = sorted(f for f in frames if f not in doc)
        if missing: E(f'sprites/README.md に未記載のフレーム: {missing}')

    used = set()
    for k, cfg in m.get('interactions', {}).items():
        tiers = cfg.values() if k == 'headPat' else [cfg]
        for t in tiers:
            if 'say' in t: used.add(t['say'])
    for r in reactions:
        for a in r['do']:
            if 'say' in a: used.add(a['say'])
    unused = lines - used
    if unused: E(f'どこからも参照されていない dialogue キー: {sorted(unused)}')

    return len(anims), len(states), len(reactions), len(frames), len(lines)

def main():
    errors = []
    check_links(errors)
    stats = []
    for pack in sorted(glob.glob(os.path.join(ROOT, 'packs', '*'))):
        if os.path.isfile(os.path.join(pack, 'mascot.json')):
            stats.append((os.path.basename(pack), check_pack(pack, errors)))
    if errors:
        print('\n'.join(f'  ✗ {e}' for e in errors))
        print(f'\n{len(errors)} 件の問題が見つかりました。')
        return 1
    print('✓ ドキュメントの内部リンクは全て解決しました')
    for name, (a, s, r, f, d) in stats:
        print(f'✓ packs/{name}: {a} アニメ / {s} 状態 / {r} リアクション / {f} フレーム / {d} セリフキー')
    return 0

if __name__ == '__main__':
    sys.exit(main())
