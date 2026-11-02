/*
 * tango web - core logic (no DOM, no storage)
 *
 * Windows版 tango_vb (Form1.vb) のロジックを移植したもの。
 *   - words.txt の読み書き（タブ区切り6列: 英単語/和訳/英文/和訳文/正解数/不正解数）
 *   - [ **** ] の穴埋め表示（asterisk / questionText）
 *   - 解答と正解の違い判定（文字単位のLCS）
 *   - 忘却曲線による復習スケジュール（wrong_log.txt）
 *   - 出題する問題の選び方、和訳モードの選択肢づくり
 *
 * ブラウザでは window.TangoCore、Node では module.exports として使えます。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TangoCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY_MS = 86400000;

  /* 復習のタイミング：不正解から 5問後 → 1日後 → 2日後 → 6日後 → 31日後
   * （1日15分ほどの学習なので，最初の復習だけは時間ではなく出題数で数える） */
  var REVIEW_FIRST_QUESTIONS = 5;
  var REVIEW_INTERVAL_DAYS = [0, 1, 2, 6, 31]; // 段階0は使わない（出題数で判定）

  var LOG_TIME_RE = /^(\d{4})\/(\d{1,2})\/(\d{1,2}) (\d{1,2}):(\d{2}):(\d{2})$/;
  var LOG_HEADER = '# 日時\t種別(W=不正解,C=復習に正解,U=自信なし,R=英単語の修正)\t英単語\t(Rのみ)新しい英単語';

  /* ------------------------------------------------------------------ */
  /* 小物                                                                */
  /* ------------------------------------------------------------------ */

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatTime(d) {
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function parseTime(s) {
    var m = LOG_TIME_RE.exec(String(s).trim());
    if (!m) return null;
    return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  }

  function toInt(s) {
    var n = parseInt(String(s == null ? '' : s).trim(), 10);
    return isFinite(n) ? n : 0;
  }

  function clean(s) { // タブ・改行はファイル形式を壊すので空白にする
    return String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ');
  }

  /* ------------------------------------------------------------------ */
  /* words.txt                                                           */
  /* ------------------------------------------------------------------ */

  function decodeText(buf) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      return new TextDecoder('shift_jis').decode(buf); // 古いファイルがShift_JISの場合
    }
  }

  function parseWords(text) {
    var words = [];
    var lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i];
      if (raw.trim() === '') continue;
      var f = raw.split('\t');
      if (f.length < 2) continue;
      words.push({
        e: f[0],
        j: f[1] || '',
        ea: f[2] || '',
        ja: f[3] || '',
        correct: toInt(f[4]),
        wrong: toInt(f[5])
      });
    }
    return words;
  }

  // Windows版の Str() が正の数の前に空白を付けるのに合わせて " 107" の形で書き出す
  function serializeWords(words) {
    return words.map(function (w) {
      return [clean(w.e), clean(w.j), clean(w.ea), clean(w.ja), ' ' + w.correct, ' ' + w.wrong].join('\t');
    }).join('\r\n') + (words.length ? '\r\n' : '');
  }

  /* progress.txt（1日〜31日の進捗。先頭は0日目で未使用）と setting.txt */
  function parseProgress(text, goal) {
    var out = new Array(32).fill(0);
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < 32 && i < lines.length; i++) {
      var v = toInt(lines[i]);
      out[i] = goal > 0 ? Math.max(0, Math.min(v, goal)) : Math.max(0, v);
    }
    return out;
  }

  function serializeProgress(progress) {
    var lines = [];
    for (var i = 0; i < 32; i++) lines.push(String(progress[i] || 0));
    return lines.join('\r\n') + '\r\n';
  }

  function parseSetting(text) {
    var lines = String(text).split(/\r?\n/);
    var goal = toInt(lines[0]);
    return { goal: goal > 0 ? goal : 20 };
  }

  function serializeSetting(goal) {
    // 2行目（旧・再出題頻度）と3行目（メモの保存先）はWindows版との互換のために書く
    return goal + '\r\n5\r\n\r\n';
  }

  /* ------------------------------------------------------------------ */
  /* 穴埋め表示                                                          */
  /* ------------------------------------------------------------------ */

  // 小文字の a-z を * に，空白を _ に置き換える（大文字・記号はそのまま）
  function asterisk(s) {
    return String(s).replace(/[a-z]/g, '*').replace(/ /g, '_');
  }

  // 英文（3列目）の中の英単語（1列目）を [ ***** ] に置き換える。
  // 1列目が3列目にそのまま含まれていないと穴埋めにならない。
  function questionText(w) {
    if (!w.e) return w.ea;
    return w.ea.split(w.e).join('[ ' + asterisk(w.e) + ' ]');
  }

  /* ------------------------------------------------------------------ */
  /* 解答と正解の違い（英訳モードの F5）                                  */
  /* ------------------------------------------------------------------ */

  /*
   * 文字単位で最長共通部分列(LCS)を取り，正解と対応しない文字に true を付ける。
   * 正解にあって解答欄に足りない文字は表示できないので，その抜けた位置の直後の文字
   * （末尾が足りないときは最後の文字）に true を付ける。
   * 戻り値は Array.from(ans) と同じ長さの真偽値配列。
   */
  function diffFlags(ans, cor) {
    var a = Array.from(ans);
    var c = Array.from(cor);
    var n = a.length, m = c.length;
    var flags = new Array(n).fill(false);
    var L = [];
    var i, j;
    for (i = 0; i <= n; i++) L.push(new Int32Array(m + 1));
    for (i = n - 1; i >= 0; i--) {
      for (j = m - 1; j >= 0; j--) {
        L[i][j] = a[i] === c[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
      }
    }
    i = 0; j = 0;
    while (i < n && j < m) {
      if (a[i] === c[j]) { i++; j++; }                    // 一致
      else if (L[i + 1][j] >= L[i][j + 1]) { flags[i] = true; i++; } // 解答欄にだけある余分な文字
      else { flags[i] = true; j++; }                      // 足りない文字：抜けた位置の直後を示す
    }
    while (i < n) { flags[i] = true; i++; }               // 残りの解答欄の文字は余分
    if (j < m && n > 0) flags[n - 1] = true;              // 末尾が足りない場合は最後の文字を示す
    return flags;
  }

  /* ------------------------------------------------------------------ */
  /* 忘却曲線による復習（wrong_log.txt）                                  */
  /* ------------------------------------------------------------------ */

  /*
   * wrong_log.txt（追記型）：日時 [Tab] 種別 [Tab] 英単語 [Tab] (R のみ)新しい英単語
   *   W=不正解  C=復習に正解（次の段階へ）  U=正解したが自信なし（段階は据え置き）  R=英単語の修正
   * 先頭から順に読み直して，各単語の「段階」と「最後の日時」を復元する。
   * 復習の時期：段階0=不正解から5問後，段階1=1日後，段階2=2日後，段階3=6日後，段階4=31日後
   */
  function ReviewTracker() {
    this.states = new Map();     // 英単語 -> {stage, lastTime(Date), lastCount}
    this.questionCounter = 0;    // 起動後に出題した問題数（段階0の「5問後」の判定用。保存しない）
  }

  ReviewTracker.prototype.apply = function (kind, word, time, newWord) {
    var st = this.states.get(word);
    switch (kind) {
      case 'W': // 不正解：最初の段階からやり直し
        if (!st) { st = { stage: 0, lastTime: time, lastCount: 0 }; this.states.set(word, st); }
        st.stage = 0; st.lastTime = time; st.lastCount = this.questionCounter;
        break;
      case 'C': // 復習に正解：次の段階へ。全段階を終えたら卒業
        if (st) {
          st.stage += 1; st.lastTime = time; st.lastCount = this.questionCounter;
          if (st.stage >= REVIEW_INTERVAL_DAYS.length) this.states.delete(word);
        }
        break;
      case 'U': // 自信なし：段階はそのままで，起点だけ更新
        if (st) { st.lastTime = time; st.lastCount = this.questionCounter; }
        break;
      case 'R': // 英単語の修正：状態を新しい単語に引き継ぐ
        if (st && newWord && newWord !== word) { this.states.delete(word); this.states.set(newWord, st); }
        break;
    }
  };

  // ログ（行の配列 or テキスト）から状態を復元する
  ReviewTracker.prototype.loadFromLog = function (log) {
    var lines = Array.isArray(log) ? log : String(log).split(/\r?\n/);
    this.states.clear();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || line.charAt(0) === '#') continue;
      var f = line.split('\t');
      if (f.length < 3) continue;
      var t = parseTime(f[0]);
      if (!t) continue;
      this.apply(f[1], f[2], t, f.length >= 4 ? f[3] : '');
    }
    // 前回の起動中に出題数を数えていた段階0の単語は，「5問後」を過ぎたものとして扱う（出題数は保存しないため）
    var self = this;
    this.states.forEach(function (st) { st.lastCount = self.questionCounter - REVIEW_FIRST_QUESTIONS; });
  };

  ReviewTracker.prototype.isDue = function (st, now) {
    if (st.stage === 0) return this.questionCounter - st.lastCount >= REVIEW_FIRST_QUESTIONS;
    return now.getTime() >= st.lastTime.getTime() + REVIEW_INTERVAL_DAYS[st.stage] * DAY_MS;
  };

  // 出題の優先順位（小さいほど先）：段階0は不正解の日時，段階1以降は復習予定の日時
  ReviewTracker.prototype.priority = function (st) {
    if (st.stage === 0) return st.lastTime.getTime();
    return st.lastTime.getTime() + REVIEW_INTERVAL_DAYS[st.stage] * DAY_MS;
  };

  /*
   * 出題結果を記録する。kind: W=不正解，C=正解(自信あり)，U=正解(自信なし)
   * 記録した行（ログに追記する文字列）を返す。記録しなかったときは null。
   */
  ReviewTracker.prototype.record = function (kind, word, now) {
    if (!word) return null;
    now = now || new Date();
    if (kind !== 'W') {
      var st = this.states.get(word);
      if (!st) return null;                     // 復習中でない単語は記録しない
      if (!this.isDue(st, now)) return null;    // 復習の時期前の正解は段階を進めない
    }
    this.apply(kind, word, now, '');
    return formatTime(now) + '\t' + kind + '\t' + word;
  };

  ReviewTracker.prototype.rename = function (oldWord, newWord, now) {
    if (!oldWord || !newWord || oldWord === newWord) return null;
    if (!this.states.has(oldWord)) return null;
    now = now || new Date();
    this.apply('R', oldWord, now, newWord);
    return formatTime(now) + '\tR\t' + oldWord + '\t' + newWord;
  };

  // 復習の時期になった単語のうち，最も遅れているものの番号を返す（なければ -1）
  ReviewTracker.prototype.pickDue = function (words, now) {
    var best = -1, bestDue = Infinity, count = 0;
    for (var i = 0; i < words.length; i++) {
      var st = this.states.get(words[i].e);
      if (st && this.isDue(st, now)) {
        count++;
        var p = this.priority(st);
        if (p < bestDue) { bestDue = p; best = i; }
      }
    }
    return { index: best, count: count };
  };

  ReviewTracker.prototype.stageOf = function (word) {
    var st = this.states.get(word);
    return st ? st.stage : -1;
  };

  function serializeLog(lines) {
    return [LOG_HEADER].concat(lines).join('\r\n') + '\r\n';
  }

  /* ------------------------------------------------------------------ */
  /* 出題                                                                */
  /* ------------------------------------------------------------------ */

  function minCorrect(words) {
    var min = Infinity, idx = [];
    for (var i = 0; i < words.length; i++) {
      if (words[i].correct < min) { min = words[i].correct; idx = [i]; }
      else if (words[i].correct === min) idx.push(i);
    }
    return { value: min, indexes: idx };
  }

  /*
   * 次に出す問題を決める。
   *  1. 復習の時期になった単語があれば，最も遅れているものを優先（review>0 に復習の回数）
   *  2. なければ，正解数が最小の単語の中からランダム（直前と同じ問題は，他に選べれば避ける）
   */
  function pickQuestion(words, tracker, now, rng, avoidIndex) {
    rng = rng || Math.random;
    var due = tracker.pickDue(words, now);
    var mc = minCorrect(words);
    var info = { index: -1, review: 0, dueCount: due.count, minValue: mc.value, minCount: mc.indexes.length };
    if (!words.length) return info;
    if (due.index >= 0) {
      info.index = due.index;
      info.review = tracker.stageOf(words[due.index].e) + 1;
      return info;
    }
    var cand = mc.indexes;
    if (cand.length > 1 && avoidIndex != null && avoidIndex >= 0) {
      cand = cand.filter(function (i) { return i !== avoidIndex; });
    }
    info.index = cand[Math.floor(rng() * cand.length)];
    return info;
  }

  /*
   * 和訳モードの選択肢（既定10個）。正解は1つ，残りは他の単語の和訳から重複なしで選ぶ。
   * 戻り値：{ choices: [和訳...], answerPos: 正解の位置 }
   */
  function buildChoices(words, qIndex, rng, n) {
    rng = rng || Math.random;
    n = n || 10;
    var correct = words[qIndex].j;
    var seen = new Set([correct]);
    var idx = [];
    for (var i = 0; i < words.length; i++) if (i !== qIndex) idx.push(i);
    for (var k = idx.length - 1; k > 0; k--) { // Fisher-Yates
      var r = Math.floor(rng() * (k + 1));
      var t = idx[k]; idx[k] = idx[r]; idx[r] = t;
    }
    var others = [];
    for (var p = 0; p < idx.length && others.length < n - 1; p++) {
      var j = words[idx[p]].j;
      if (!j || seen.has(j)) continue;
      seen.add(j);
      others.push(j);
    }
    var pos = Math.floor(rng() * (others.length + 1));
    others.splice(pos, 0, correct);
    return { choices: others, answerPos: pos };
  }

  // 単語を追加するときの正解数。学習が進んだデッキに0で追加すると，追加した単語ばかりが
  // 出題されてしまうので，そのデッキで最も多い正解数（最頻値）に合わせる。
  function modeCorrect(words) {
    var counts = new Map(), best = 0, bestN = -1;
    words.forEach(function (w) { counts.set(w.correct, (counts.get(w.correct) || 0) + 1); });
    counts.forEach(function (n, v) {
      if (n > bestN || (n === bestN && v > best)) { bestN = n; best = v; }
    });
    return best;
  }

  return {
    REVIEW_FIRST_QUESTIONS: REVIEW_FIRST_QUESTIONS,
    REVIEW_INTERVAL_DAYS: REVIEW_INTERVAL_DAYS,
    DAY_MS: DAY_MS,
    formatTime: formatTime,
    parseTime: parseTime,
    clean: clean,
    decodeText: decodeText,
    parseWords: parseWords,
    serializeWords: serializeWords,
    parseProgress: parseProgress,
    serializeProgress: serializeProgress,
    parseSetting: parseSetting,
    serializeSetting: serializeSetting,
    asterisk: asterisk,
    questionText: questionText,
    diffFlags: diffFlags,
    ReviewTracker: ReviewTracker,
    serializeLog: serializeLog,
    minCorrect: minCorrect,
    pickQuestion: pickQuestion,
    buildChoices: buildChoices,
    modeCorrect: modeCorrect
  };
});
