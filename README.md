# Web Timer

iPad での利用を前提にした、黒背景・大きな白文字のシンプルなタイマー Web アプリです。

- **STOPWATCH**: START で 00:00 から 1 秒ずつカウントアップ
- **COUNTDOWN**: H / M / S の +/− で時間を設定(長押しで連続変更)→ START でカウントダウン。0 で点滅＋アラーム音
- STOP / RESUME / RESET 対応。時刻は実時間との差分で計算するため、バックグラウンドに回ってもズレません
- 対応ブラウザでは計測中に画面のスリープを防止(Wake Lock API)
- 依存ゼロの静的サイト(HTML + CSS + JavaScript のみ、ビルド不要)

## 公開 URL

**https://kayayayeah39.github.io/web-timer/**

iPad の Safari で開き、共有 → 「ホーム画面に追加」するとフルスクリーンのアプリとして使えます。

## ローカルでの起動

```
python -m http.server 8001
```

→ ブラウザで http://localhost:8001 を開きます。
