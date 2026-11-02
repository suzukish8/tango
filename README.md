# tango web

Windows 版の英単語学習アプリ **tango_vb** の Web 版です。ブラウザだけで動き、インストールもサーバーも要りません。

- **和訳モード**（既定）… 英単語を見て、10個の選択肢から日本語を選ぶ
- **英訳モード** … 日本語を見て、英語を入力する（`F5` で間違ったところを赤字で示す）
- **忘却曲線による復習** … 不正解にした単語を **5問後 → 1日後 → 2日後 → 6日後 → 31日後** に出し直す
- **Windows 版のファイルがそのまま使える** … `words.txt` / `wrong_log.txt` / `progress.txt` / `setting.txt`
- デッキ（`tango1`〜`tango4` のような単語ファイルの組）を切り替えて学習できる
- データはブラウザの IndexedDB にだけ保存（サーバーへは送信しません）

## 使い方

1. このフォルダで `python -m http.server 8793` を実行し、<http://localhost:8793/> を開きます（動作確認はこの方法で行っています）。  
   `index.html` をダブルクリックして開いても動くように作ってありますが（`fetch` や ES モジュールは使っていません）、ブラウザによっては `file://` のときに保存が制限されることがあります。その場合は上の方法で開いてください。
2. 初回は「サンプルで試す」か、設定タブ →「ファイルを読み込む…」で Windows 版の `words.txt` を読み込みます。
   同じフォルダの `wrong_log.txt`・`progress.txt`・`setting.txt` も一緒に選ぶと、復習の記録・進捗・目標も引き継がれます。
3. 学習したあと、設定タブから `words.txt` などを書き出すと、Windows 版にそのまま戻せます（バックアップにも使えます）。

> ブラウザのデータ（サイトデータ）を消すと学習記録も消えます。ときどき書き出してバックアップしてください。

## ショートカット

| キー | 動作 |
|---|---|
| `F1` / `F2` / `F3` | 英訳 / 和訳 / 設定 のタブ切り替え |
| `F4` | 答えの表示・非表示 |
| `F5` | （英訳）解答欄の、正解と違う文字を赤字で示す |
| `F6` | `[ **** ]` で穴埋めした英文の表示・非表示 |
| `Esc` | パス（答えを見て次へ） |
| `1`〜`9`, `0` | （和訳）選択肢を選ぶ |

ブラウザによっては `F1`・`F3`・`F5`・`F6` がブラウザ自身の機能に使われます。うまく動かないときは画面のボタンを使ってください。

## 単語ファイル（words.txt）の形式

UTF-8（Shift_JIS も読めます）、タブ区切り、1行に1語、6列です。

```
英単語・言い回し <TAB> 和訳 <TAB> 例文 <TAB> 例文の和訳 <TAB> 正解数 <TAB> 不正解数
```

- **1列目は、3列目の例文の中にそのまま含まれている必要があります。** 例文の中の1列目が `[ **** ]` に置き換えられて出題されます。
  `something` のような置き換え語は使わず、例文に出てくる具体的な形を1列目に書いてください。
- 学習が進んだデッキに単語を追加するときは、正解数を **そのデッキの最頻値** に合わせてください（0 で追加すると、追加した単語ばかりが出題されます）。
  設定タブの「単語を追加」は、既定でこの最頻値を使います。

## 出題の決め方

1. 復習の時期になった単語があれば、いちばん遅れているものを優先して出す。
2. なければ、正解数がいちばん少ない単語の中からランダムに出す（直前と同じ問題は、他に選べれば避ける）。
3. 不正解にすると、その単語は最初の段階（5問後）からやり直し。復習に正解して「自信あり」と答えるたびに次の段階へ進み、31日後の復習を終えると卒業。
4. 復習の時期より前に出て正解しても、段階は進まない。

Windows 版との違い：旧・再出題アルゴリズム（不正解数方式）は移植していません。間違えた単語は自動で「メモ」にたまります（Windows 版はデスクトップにファイルを書き出していました）。

## 開発

ビルドは不要です（素の HTML / CSS / JavaScript）。

```
index.html        画面
css/style.css     見た目（ライト / ダーク自動切り替え）
js/core.js        ロジック（単語ファイル・穴埋め・違いの判定・復習・出題）  ← Windows 版 Form1.vb の移植
js/storage.js     IndexedDB への保存
js/app.js         画面の動き
sample/           サンプルの単語ファイル
tests/test.html   core.js のテスト（ブラウザで開くと結果が出ます）
```

`tests/test.html` をブラウザで開くと `core.js` のテストが走ります（ローカルサーバー経由でも、ファイルを直接開いても可）。

---

# English

**tango web** is a browser version of *tango_vb*, a Windows flashcard app for English vocabulary. It runs entirely in the browser (static files, no server, no build).

- **EN→JA mode** (default tab): see an English word, pick the Japanese meaning from 10 choices.
- **JA→EN mode**: see the Japanese, type the English. `F5` marks the characters that differ from the answer in red.
- **Spaced review** of missed words: after 5 questions → 1 day → 2 days → 6 days → 31 days.
- Reads and writes the Windows app's files as-is (`words.txt`, `wrong_log.txt`, `progress.txt`, `setting.txt`).
- Study data stays in your browser's IndexedDB; nothing is uploaded.

Open `index.html` in a browser (or serve the folder with `python -m http.server`). Use *Settings → Load files…* to import your `words.txt`, or try the bundled sample.
