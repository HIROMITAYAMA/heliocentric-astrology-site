# ヘリオセントリック占星術～人生の羅針盤～ 星読みデータツール

生年月日・出生時間・出生地から、ヘリオ／ジオ／ドラコニックの出生図と経過図・進行図を計算し、AIに貼れるテキストを出す静的サイト（GitHub Pages）。

- `index.html` 画面
- `astro-core.js` 計算コア（ブラウザ・Node共用）
- `data/ephem_tables.json` キロン（日心黄経・黄緯・距離、2日おき）と真ノード（日次）の表。1920-01-01〜2080-12-31。Swiss Ephemeris（swisseph-wasm 0.0.5）から生成
- `data/*.json` サビアン360度・恒星101・アスペクト等（占いラボのデータ）
- `vendor/astronomy-engine-2.1.19.js` 天体位置計算（MIT）
- `test/verify.mjs` 検算（ひろみの出生データを astro.com の値と比較）。`node test/verify.mjs`

旧版（地球・水星・金星のみ）は tag `v1-2026-01-22`。

検算の実行には astronomy-engine を解決できる場所が必要（test/verify.mjs 内の createRequire のパスを環境に合わせる）。
