/*
 * tango web - UI
 * Windows版 tango_vb の Web 版。タブは「英訳」「和訳」「設定」。既定は和訳モード。
 */
(function () {
  'use strict';

  var C = window.TangoCore;
  var DB = window.TangoStorage;

  /* ------------------------------------------------------------------ */
  /* 小物                                                                */
  /* ------------------------------------------------------------------ */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (v === true) n.setAttribute(k, '');
      else n.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { n.append(x); });
      else n.append(c);
    }
    return n;
  }

  function newId() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function todayNo() { return new Date().getDate(); }

  function toast(msg, ms) {
    var t = el('div', { class: 'toast' }, msg);
    $('#toastRoot').append(t);
    setTimeout(function () { t.remove(); }, ms || 2600);
  }

  /* ------------------------------------------------------------------ */
  /* 状態                                                                */
  /* ------------------------------------------------------------------ */

  var S = {
    decks: [],            // [{id, name}]
    deckId: null,
    words: [],            // [{e, j, ea, ja, correct, wrong}]
    log: [],              // wrong_log.txt の行（ヘッダなし）
    progress: new Array(32).fill(0),
    goal: 20,
    memo: [],
    tracker: new C.ReviewTracker(),
    tab: 'etoj',          // 既定は和訳モード
    q: -1,                // 出題中の単語の番号
    choices: [],
    answerPos: -1,
    review: 0,            // 0=通常の出題，N=第N回目の復習
    dueCount: 0,
    minValue: 0,
    minCount: 0,
    showAnswer: false,    // F4
    hideAsterisk: false,  // F6
    busy: false,
    modalDepth: 0,
    notified: {}
  };

  var answerEl = null;

  /* ------------------------------------------------------------------ */
  /* 保存                                                                */
  /* ------------------------------------------------------------------ */

  var saveTimer = null;

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!S.deckId) return Promise.resolve();
    return DB.set('deck:' + S.deckId, {
      words: S.words, log: S.log, progress: S.progress, goal: S.goal, memo: S.memo
    });
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }

  function saveMeta() {
    return DB.set('meta', { decks: S.decks, current: S.deckId });
  }

  window.addEventListener('pagehide', function () { if (saveTimer) saveNow(); });
  document.addEventListener('visibilitychange', function () { if (document.hidden && saveTimer) saveNow(); });

  /* ------------------------------------------------------------------ */
  /* 効果音（ピンポン / ブッ）                                            */
  /* ------------------------------------------------------------------ */

  var actx = null;

  function audio() {
    if (!actx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { actx = new AC(); } catch (e) { actx = null; } }
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }

  function tone(freq, start, dur, type, vol) {
    var a = audio();
    if (!a) return;
    var o = a.createOscillator();
    var g = a.createGain();
    var t0 = a.currentTime + start;
    o.type = type || 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(a.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  function playPing() { tone(1174.7, 0, 0.3); tone(880, 0.2, 0.55); }
  function playBeep() { tone(220, 0, 0.25, 'square', 0.07); }

  /* ------------------------------------------------------------------ */
  /* モーダル                                                            */
  /* ------------------------------------------------------------------ */

  /*
   * opts: { title, titleClass, lines: [string | {text, cls}], note, node, buttons: [{label, value, primary, key}],
   *         defaultValue, cancelValue }
   * Enter=標準のボタン，Esc=cancelValue（指定時のみ），key=ショートカット文字
   */
  function modal(opts) {
    return new Promise(function (resolve) {
      var prevFocus = document.activeElement;
      var back = el('div', { class: 'backdrop' });
      var box = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' });
      var buttons = opts.buttons || [{ label: 'OK', value: true, primary: true }];
      var defBtn = null;

      if (opts.title) box.append(el('h2', { class: opts.titleClass || '' }, opts.title));
      if (opts.lines) {
        var body = el('div', { class: 'body' });
        opts.lines.forEach(function (ln) {
          if (ln === '') body.append(el('div', { class: 'gap' }));
          else if (typeof ln === 'string') body.append(el('div', {}, ln));
          else body.append(el('div', { class: ln.cls || '' }, ln.text));
        });
        box.append(body);
      }
      if (opts.node) box.append(opts.node);
      if (opts.note) box.append(el('div', { class: 'note' }, opts.note));

      var bar = el('div', { class: 'buttons' });
      buttons.forEach(function (b) {
        var btn = el('button', { type: 'button', class: b.primary ? 'primary' : '' }, b.label);
        btn.addEventListener('click', function () { close(b.value); });
        if (b.primary && !defBtn) defBtn = btn;
        bar.append(btn);
      });
      if (!opts.node || !opts.node.__ownButtons) box.append(bar);
      back.append(box);
      $('#modalRoot').append(back);
      S.modalDepth++;

      function close(v) {
        document.removeEventListener('keydown', onKey, true);
        back.remove();
        S.modalDepth--;
        if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus();
        resolve(v);
      }

      function onKey(e) {
        var k = e.key;
        var inField = e.target && e.target.closest && e.target.closest('input, textarea, select');
        if (k === 'Escape' && opts.cancelValue !== undefined) {
          e.preventDefault(); e.stopPropagation(); close(opts.cancelValue); return;
        }
        if (k === 'Enter' && !inField && defBtn && !(e.target && e.target.tagName === 'BUTTON')) {
          e.preventDefault(); e.stopPropagation(); defBtn.click(); return;
        }
        if (!inField && !e.ctrlKey && !e.altKey && !e.metaKey) {
          for (var i = 0; i < buttons.length; i++) {
            if (buttons[i].key && buttons[i].key === k.toLowerCase()) {
              e.preventDefault(); e.stopPropagation(); close(buttons[i].value); return;
            }
          }
        }
        if (/^F\d+$/.test(k) && k !== 'F5' && k !== 'F12') e.preventDefault();
        e.stopPropagation(); // 後ろの画面のショートカットを動かさない
      }
      document.addEventListener('keydown', onKey, true);

      var first = box.querySelector('input, textarea') || defBtn || box.querySelector('button');
      if (first) first.focus();
      box.__close = close;
      if (opts.onOpen) opts.onOpen(box, close);
    });
  }

  function confirmBox(title, text, okLabel, danger) {
    return modal({
      title: title,
      lines: text ? text.split('\n') : [],
      buttons: [
        { label: 'キャンセル', value: false },
        { label: okLabel || 'OK', value: true, primary: !danger, key: 'y' }
      ],
      cancelValue: false
    });
  }

  function detailLines(w, extra) {
    var lines = [w.j, { text: w.e, cls: 'sub' }, '', { text: w.ja, cls: 'sub' }, { text: w.ea, cls: 'sub' }];
    if (extra) lines = lines.concat(['', extra]);
    return lines;
  }

  /* ------------------------------------------------------------------ */
  /* 表示                                                                */
  /* ------------------------------------------------------------------ */

  function renderGoal() {
    var p = S.progress[todayNo()] || 0;
    $('#goalText').textContent = '今日 ' + p + '/' + S.goal;
    $('#goalBar').style.width = Math.min(100, S.goal ? (p / S.goal) * 100 : 0) + '%';
  }

  function renderStatus() {
    var n = S.words.length;
    var bar = $('#statusbar');
    if (!n) { bar.textContent = ''; return; }
    bar.textContent = '全 ' + n + ' 語 ・ 正解数が最小（' + S.minValue + '）の単語 ' + S.minCount + '/' + n +
      ' ・ 復習待ち ' + S.dueCount + ' 語 ・ 復習中 ' + S.tracker.states.size + ' 語';
  }

  function applyToggles() {
    var showAns = S.showAnswer;
    $('#j-answer').hidden = !showAns;
    $('#e-answer').hidden = !showAns;
    $('#j-blank').hidden = S.hideAsterisk;
    $('#e-sample').hidden = S.hideAsterisk;
  }

  function renderQuestion() {
    var w = S.words[S.q];
    if (!w) { renderStatus(); renderGoal(); updateViews(); return; }

    var no = '#' + S.q;
    $('#j-qno').textContent = no;
    $('#e-qno').textContent = no;
    ['#j-review', '#e-review'].forEach(function (sel) {
      var b = $(sel);
      b.hidden = !S.review;
      b.textContent = S.review ? '復習問題（第' + S.review + '回目）' : '';
    });

    // 英訳
    $('#j-ja').textContent = w.j;
    $('#j-blank').textContent = C.questionText(w);
    $('#j-ja2').textContent = w.ja;
    $('#j-answer').textContent = w.e;
    answerEl.textContent = '';

    // 和訳
    $('#e-word').textContent = w.e;
    $('#e-sample').textContent = C.questionText(w);
    $('#e-answer').textContent = w.j;
    var list = $('#choices');
    list.textContent = '';
    S.choices.forEach(function (text, i) {
      var key = i === 9 ? '0' : String(i + 1);
      var btn = el('button', { type: 'button', 'data-i': i },
        el('span', { class: 'num' }, key), el('span', {}, text));
      btn.addEventListener('click', function () { choose(i); });
      list.append(el('li', {}, btn));
    });

    applyToggles();
    renderGoal();
    renderStatus();
    updateViews();
  }

  function updateViews() {
    var empty = S.words.length === 0;
    $('#view-empty').hidden = !(empty && S.tab !== 'settings');
    $('#view-jtoe').hidden = !(!empty && S.tab === 'jtoe');
    $('#view-etoj').hidden = !(!empty && S.tab === 'etoj');
    $('#view-settings').hidden = S.tab !== 'settings';
    $$('.tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === S.tab ? 'true' : 'false');
    });
  }

  function setTab(tab) {
    S.tab = tab;
    updateViews();
    if (tab === 'settings') renderSettings();
    if (tab === 'jtoe' && S.q >= 0) answerEl.focus();
    if (tab !== 'settings') window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------ */
  /* 出題（Shutsudai）                                                   */
  /* ------------------------------------------------------------------ */

  function notifyGoal() {
    var p = S.progress[todayNo()] || 0;
    var key = S.deckId + ':' + todayNo() + ':' + p;
    if (!p || S.notified[key]) return;
    if (p >= S.goal) { S.notified[key] = 1; toast('目標を達成しました 🎉', 4200); }
    else if (p * 2 === S.goal) { S.notified[key] = 1; toast('目標の半分を達成しました', 4200); }
  }

  function nextQuestion() {
    if (!S.words.length) { S.q = -1; renderStatus(); renderGoal(); updateViews(); return; }
    S.tracker.questionCounter++; // 出題数を数える（不正解の「5問後」の判定用）
    var pick = C.pickQuestion(S.words, S.tracker, new Date(), Math.random, S.q);
    S.q = pick.index;
    S.review = pick.review;
    S.dueCount = pick.dueCount;
    S.minValue = pick.minValue;
    S.minCount = pick.minCount;
    var ch = C.buildChoices(S.words, S.q, Math.random, 10);
    S.choices = ch.choices;
    S.answerPos = ch.answerPos;
    renderQuestion();
    notifyGoal();
    if (S.tab === 'jtoe') answerEl.focus();
  }

  function recordReview(kind, word) {
    var line = S.tracker.record(kind, word, new Date());
    if (line) S.log.push(line);
  }

  function addMemo(w, silent) {
    for (var i = 0; i < S.memo.length; i++) if (S.memo[i].e === w.e) { if (!silent) toast('すでにメモしてあります'); return; }
    S.memo.push({ e: w.e, j: w.j, ea: w.ea, ja: w.ja, correct: 0, wrong: 0 });
    if (!silent) toast('メモしました');
    saveSoon();
  }

  /* ------------------------------------------------------------------ */
  /* 正解・不正解の処理                                                  */
  /* ------------------------------------------------------------------ */

  async function afterCorrect(mode) {
    playPing();
    var w = S.words[S.q];
    var r = await modal({
      title: '■正解■', titleClass: 'ok',
      lines: detailLines(w),
      note: '[はい]…そのまま進む／[いいえ]…問題・解答を修正する',
      buttons: [
        { label: 'はい（そのまま進む）', value: 'next', primary: true, key: 'y' },
        { label: 'いいえ（問題・解答を修正する）', value: 'edit', key: 'n' }
      ]
    });
    if (r === 'edit') await editWord(S.q);

    w = S.words[S.q];
    var confident = await modal({
      title: '自信あり？',
      lines: [w.e],
      buttons: [
        { label: 'はい', value: true, primary: true, key: 'y' },
        { label: 'いいえ', value: false, key: 'n' }
      ]
    });

    if (confident) {
      w.correct += 1;                                  // 正解数を増やす
      recordReview('C', w.e);                          // 復習中の単語なら次の段階へ（忘却曲線）
      var t = todayNo();
      if (S.goal > (S.progress[t] || 0)) S.progress[t] = (S.progress[t] || 0) + 1;
    } else {
      recordReview('U', w.e);                          // 自信なし：復習の段階は据え置き
    }
    await saveNow();
    renderGoal();

    // 英訳は，自信の有無にかかわらず次の問題へ。和訳は「自信なし」なら同じ問題をもう一度。
    if (mode === 'jtoe' || confident) nextQuestion();
    else renderQuestion();
  }

  async function afterWrong(chosen) {
    playBeep();
    var w = S.words[S.q];
    await modal({
      title: '残念', titleClass: 'bad',
      lines: detailLines(w, chosen ? { text: 'あなたの答え：' + chosen, cls: 'sub' } : null),
      buttons: [{ label: 'OK', value: true, primary: true }]
    });
    addMemo(w, true);                                  // 間違えた単語はメモにためる
    recordReview('W', w.e);                            // 不正解の日時を記録（忘却曲線）
    await saveNow();
    nextQuestion();
  }

  async function run(fn) {
    if (S.busy || S.q < 0) return;
    S.busy = true;
    try { await fn(); } finally { S.busy = false; }
  }

  function choose(i) {
    if (S.tab !== 'etoj' || i < 0 || i >= S.choices.length) return;
    run(function () {
      var btn = $('#choices button[data-i="' + i + '"]');
      if (btn && i === S.answerPos) btn.classList.add('hit');
      return i === S.answerPos ? afterCorrect('etoj') : afterWrong(S.choices[i]);
    });
  }

  function pass() {
    if (S.tab === 'settings') return;
    run(function () { return afterWrong(null); });
  }

  function getAnswerText() { return answerEl.textContent.replace(/[\r\n]+/g, ''); }

  function checkAnswer() {
    if (S.tab !== 'jtoe' || S.q < 0 || S.busy) return;
    if (getAnswerText() === S.words[S.q].e) run(function () { return afterCorrect('jtoe'); });
  }

  /* ------------------------------------------------------------------ */
  /* 英訳の解答欄（赤字マーク）                                           */
  /* ------------------------------------------------------------------ */

  function caretOffset(node) {
    var sel = window.getSelection();
    if (!sel.rangeCount || !node.contains(sel.anchorNode)) return node.textContent.length;
    var r = document.createRange();
    r.selectNodeContents(node);
    r.setEnd(sel.anchorNode, sel.anchorOffset);
    return r.toString().length;
  }

  function setCaret(node, off) {
    var sel = window.getSelection();
    var range = document.createRange();
    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    var n, left = off, done = false;
    while ((n = walker.nextNode())) {
      if (left <= n.length) { range.setStart(n, left); done = true; break; }
      left -= n.length;
    }
    if (!done) { range.selectNodeContents(node); range.collapse(false); } else range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // 解答欄を編集したら赤字マークを消す（以降に入力する文字が赤くならないように）
  function normalizeAnswer() {
    if (!answerEl.children.length) return;
    var off = caretOffset(answerEl);
    answerEl.textContent = answerEl.textContent;
    setCaret(answerEl, off);
  }

  // F5：解答欄の，正解と違う文字を赤字にする（空白の違いは薄い赤の背景も付ける）
  function markDiff() {
    if (S.tab !== 'jtoe' || S.q < 0) return;
    var text = getAnswerText();
    if (!text) return;
    var chars = Array.from(text);
    var flags = C.diffFlags(text, S.words[S.q].e);
    var frag = document.createDocumentFragment();
    var good = '', bad = '';
    function flushGood() { if (good) { frag.append(document.createTextNode(good)); good = ''; } }
    function flushBad() { if (bad) { frag.append(el('span', { class: 'bad' }, bad)); bad = ''; } }
    chars.forEach(function (ch, i) {
      if (!flags[i]) { flushBad(); good += ch; }
      else if (/\s/.test(ch)) { flushGood(); flushBad(); frag.append(el('span', { class: 'bad ws' }, ch)); }
      else { flushGood(); bad += ch; }
    });
    flushGood(); flushBad();
    answerEl.textContent = '';
    answerEl.append(frag);
    answerEl.focus();
    setCaret(answerEl, text.length);
  }

  function toggleAnswer() { S.showAnswer = !S.showAnswer; applyToggles(); }
  function toggleAsterisk() { S.hideAsterisk = !S.hideAsterisk; applyToggles(); }

  /* ------------------------------------------------------------------ */
  /* 問題の修正・追加・削除                                               */
  /* ------------------------------------------------------------------ */

  function editWord(index) {
    var w = S.words[index];
    return new Promise(function (resolve) {
      var fE = el('input', { type: 'text', value: w.e, required: true, spellcheck: 'false' });
      var fJ = el('input', { type: 'text', value: w.j, required: true });
      var fEA = el('input', { type: 'text', value: w.ea, spellcheck: 'false' });
      var fJA = el('input', { type: 'text', value: w.ja });
      var warn = el('div', { class: 'warn-text' });
      function check() {
        warn.textContent = fEA.value && fE.value && fEA.value.indexOf(fE.value) < 0
          ? '※ 例文に英単語がそのまま含まれていません（穴埋めにならない）' : '';
      }
      [fE, fEA].forEach(function (f) { f.addEventListener('input', check); });
      check();
      var form = el('form', { autocomplete: 'off' },
        el('label', {}, '英単語・言い回し', fE),
        el('label', {}, '和訳', fJ),
        el('label', {}, '例文', fEA),
        el('label', {}, '例文の和訳', fJA),
        warn);
      var holder = el('div', {}, form);
      holder.__ownButtons = false;
      modal({
        title: '問題・解答の修正',
        node: holder,
        buttons: [
          { label: 'キャンセル', value: null },
          { label: '保存', value: 'save', primary: true }
        ],
        cancelValue: null,
        onOpen: function (box, close) {
          form.addEventListener('submit', function (ev) { ev.preventDefault(); close('save'); });
        }
      }).then(function (r) {
        if (r === 'save' && fE.value && fJ.value) {
          var old = w.e;
          w.e = C.clean(fE.value); w.j = C.clean(fJ.value); w.ea = C.clean(fEA.value); w.ja = C.clean(fJA.value);
          var line = S.tracker.rename(old, w.e, new Date());   // 復習の記録を新しい英単語に引き継ぐ
          if (line) S.log.push(line);
          saveSoon();
          if (index === S.q) renderQuestion();
          toast('問題・解答文を修正しました');
        }
        resolve();
      });
    });
  }

  async function removeWord(index) {
    var w = S.words[index];
    var ok = await confirmBox('単語を削除', '「' + w.e + '」を削除しますか？', '削除', true);
    if (!ok) return;
    S.words.splice(index, 1);
    if (index < S.q) S.q -= 1;
    else if (index === S.q) { S.q = -1; }
    await saveNow();
    if (S.q < 0) nextQuestion(); else renderQuestion();
    renderSettings();
  }

  /* ------------------------------------------------------------------ */
  /* 設定タブ                                                            */
  /* ------------------------------------------------------------------ */

  function renderDeckSelect() {
    var sel = $('#deckSelect');
    sel.textContent = '';
    S.decks.forEach(function (d) {
      var o = el('option', { value: d.id }, d.name);
      if (d.id === S.deckId) o.selected = true;
      sel.append(o);
    });
    var cur = S.decks.filter(function (d) { return d.id === S.deckId; })[0];
    $('#deckName').value = cur ? cur.name : '';
  }

  function renderProgressRows() {
    var box = $('#progressRows');
    box.textContent = '';
    var t = todayNo();
    for (var d = 1; d <= 31; d++) {
      var p = S.progress[d] || 0;
      var fill = el('div');
      fill.style.width = Math.min(100, S.goal ? (p / S.goal) * 100 : 0) + '%';
      box.append(el('div', { class: 'prow' + (d === t ? ' today' : '') },
        el('span', {}, d + '日'), el('div', { class: 'bar' }, fill), el('span', { class: 'n' }, String(p))));
    }
  }

  var WORD_LIMIT = 200;

  function renderWordTable() {
    var q = $('#wordSearch').value.trim().toLowerCase();
    var tb = $('#wordTable tbody');
    tb.textContent = '';
    var shown = 0, matched = 0;
    for (var i = 0; i < S.words.length; i++) {
      var w = S.words[i];
      if (q && w.e.toLowerCase().indexOf(q) < 0 && w.j.toLowerCase().indexOf(q) < 0) continue;
      matched++;
      if (shown >= WORD_LIMIT) continue;
      shown++;
      (function (idx) {
        tb.append(el('tr', {},
          el('td', { class: 'num' }, String(idx)),
          el('td', {}, w.e),
          el('td', {}, w.j),
          el('td', { class: 'num' }, String(w.correct)),
          el('td', { class: 'num' }, String(w.wrong)),
          el('td', {},
            el('button', { type: 'button', onclick: function () { editWord(idx).then(renderWordTable); } }, '編集'), ' ',
            el('button', { type: 'button', class: 'danger', onclick: function () { removeWord(idx); } }, '削除'))));
      })(i);
    }
    $('#wordCount').textContent = '（' + S.words.length + '語）';
    $('#wordMore').textContent = matched > shown
      ? matched + '件のうち先頭の' + shown + '件を表示しています。検索で絞り込んでください。' : '';
  }

  function renderMemo() {
    $('#memoCount').textContent = '（' + S.memo.length + '語）';
    var ul = $('#memoList');
    ul.textContent = '';
    S.memo.forEach(function (m) { ul.append(el('li', {}, m.e + ' — ' + m.j)); });
  }

  function renderSettings() {
    renderDeckSelect();
    $('#goalInput').value = S.goal;
    renderProgressRows();
    renderWordTable();
    renderMemo();
  }

  /* ---- ファイル ---- */

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.append(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function exportFile(kind) {
    if (kind === 'words') download('words.txt', C.serializeWords(S.words));
    else if (kind === 'wrong_log') download('wrong_log.txt', C.serializeLog(S.log));
    else if (kind === 'progress') download('progress.txt', C.serializeProgress(S.progress));
    else if (kind === 'setting') download('setting.txt', C.serializeSetting(S.goal));
  }

  async function importFiles(files) {
    var list = Array.prototype.slice.call(files);
    // words を先に（読み込み後に他のファイルを反映する）
    function rank(f) { return /wrong|progress|setting/i.test(f.name) ? 1 : 0; }
    list.sort(function (a, b) { return rank(a) - rank(b); });
    var done = [];
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      var text = C.decodeText(await f.arrayBuffer());
      var name = f.name.toLowerCase();
      if (/wrong/.test(name)) {
        S.log = text.split(/\r?\n/).filter(function (l) { return l && l.charAt(0) !== '#'; });
        S.tracker.loadFromLog(S.log);
        done.push('復習の記録');
      } else if (/progress/.test(name)) {
        S.progress = C.parseProgress(text, S.goal);
        done.push('進捗');
      } else if (/setting/.test(name)) {
        S.goal = C.parseSetting(text).goal;
        S.progress = S.progress.map(function (v) { return Math.min(v, S.goal); });
        done.push('設定');
      } else {
        var words = C.parseWords(text);
        if (!words.length) { toast('「' + f.name + '」から単語を読み取れませんでした'); continue; }
        if (S.words.length) {
          var ok = await confirmBox('単語を置き換えますか？',
            'デッキ「' + currentDeck().name + '」の単語 ' + S.words.length + ' 語を、\n「' + f.name + '」の ' + words.length + ' 語に置き換えます。', '置き換える');
          if (!ok) continue;
        }
        S.words = words;
        S.q = -1;
        done.push('単語 ' + words.length + ' 語');
      }
    }
    if (!done.length) return;
    S.tracker.questionCounter = 0;
    S.tracker.loadFromLog(S.log);
    await saveNow();
    S.q = -1;
    nextQuestion();
    renderSettings();
    toast(done.join('・') + ' を読み込みました');
  }

  function currentDeck() {
    return S.decks.filter(function (d) { return d.id === S.deckId; })[0];
  }

  /* ---- デッキ ---- */

  async function loadDeck(id) {
    var data = (await DB.get('deck:' + id)) || {};
    S.deckId = id;
    S.words = data.words || [];
    S.log = data.log || [];
    S.goal = data.goal > 0 ? data.goal : 20;
    S.progress = Array.isArray(data.progress) && data.progress.length === 32 ? data.progress : new Array(32).fill(0);
    S.memo = data.memo || [];
    S.tracker = new C.ReviewTracker();
    S.tracker.loadFromLog(S.log);
    S.q = -1;
    await saveMeta();
    renderDeckSelect();
    nextQuestion();
    if (S.tab === 'settings') renderSettings();
  }

  async function createDeck(name) {
    var d = { id: newId(), name: name };
    S.decks.push(d);
    await saveNow();
    await DB.set('deck:' + d.id, { words: [], log: [], progress: new Array(32).fill(0), goal: 20, memo: [] });
    await loadDeck(d.id);
  }

  function askText(title, label, value) {
    var input = el('input', { type: 'text', value: value || '', maxlength: '40', required: true });
    var form = el('form', { autocomplete: 'off' }, el('label', {}, label, input));
    return new Promise(function (resolve) {
      modal({
        title: title, node: el('div', {}, form),
        buttons: [{ label: 'キャンセル', value: null }, { label: 'OK', value: 'ok', primary: true }],
        cancelValue: null,
        onOpen: function (box, close) {
          form.addEventListener('submit', function (e) { e.preventDefault(); close('ok'); });
        }
      }).then(function (r) { resolve(r === 'ok' && input.value.trim() ? input.value.trim() : null); });
    });
  }

  /* ---- 設定タブのボタン ---- */

  function bindSettings() {
    $('#deckSelect').addEventListener('change', function (e) {
      saveNow().then(function () { return loadDeck(e.target.value); });
    });

    $('#btnRenameDeck').addEventListener('click', function () {
      var name = $('#deckName').value.trim();
      if (!name) return;
      currentDeck().name = name;
      saveMeta();
      renderDeckSelect();
      toast('デッキ名を変更しました');
    });

    $('#btnNewDeck').addEventListener('click', async function () {
      var name = await askText('新しいデッキ', '名前', 'tango' + (S.decks.length + 1));
      if (name) { await saveNow(); await createDeck(name); renderSettings(); toast('デッキ「' + name + '」を作りました。単語ファイルを読み込んでください'); }
    });

    $('#btnDeleteDeck').addEventListener('click', async function () {
      var d = currentDeck();
      var ok = await confirmBox('デッキを削除', 'デッキ「' + d.name + '」の単語・復習の記録・進捗をすべて削除します。\nこの操作は元に戻せません。', '削除する', true);
      if (!ok) return;
      await DB.del('deck:' + d.id);
      S.decks = S.decks.filter(function (x) { return x.id !== d.id; });
      S.deckId = null;
      if (!S.decks.length) { await createDeck('tango1'); }
      else { await loadDeck(S.decks[0].id); }
      renderSettings();
    });

    $('#goalInput').addEventListener('change', function (e) {
      var v = parseInt(e.target.value, 10);
      if (!(v > 0)) { e.target.value = S.goal; return; }
      S.goal = v;
      S.progress = S.progress.map(function (p) { return Math.min(p, S.goal); });
      saveSoon();
      renderGoal();
      renderProgressRows();
    });

    $('#btnClearProgress').addEventListener('click', async function () {
      if (!(await confirmBox('月の進捗をクリア', '月の進捗をクリアしてもいいですか？', 'クリアする', true))) return;
      S.progress = new Array(32).fill(0);
      await saveNow();
      renderGoal();
      renderProgressRows();
    });

    $('#btnImport').addEventListener('click', function () { $('#fileInput').click(); });
    $('#btnLoadFile').addEventListener('click', function () { $('#fileInput').click(); });
    $('#fileInput').addEventListener('change', function (e) {
      if (e.target.files.length) importFiles(e.target.files);
      e.target.value = '';
    });
    $$('[data-export]').forEach(function (b) {
      b.addEventListener('click', function () { exportFile(b.dataset.export); });
    });

    $('#btnLoadSample').addEventListener('click', async function () {
      var words = C.parseWords(window.TangoSample || '');
      if (!words.length) { toast('サンプルを読み込めませんでした'); return; }
      S.words = words; S.q = -1;
      await saveNow();
      nextQuestion();
      toast('サンプルの単語 ' + words.length + ' 語を読み込みました');
    });

    $('#addForm').addEventListener('submit', async function (e) {
      e.preventDefault();
      var w = {
        e: C.clean($('#addE').value.trim()), j: C.clean($('#addJ').value.trim()),
        ea: C.clean($('#addEA').value.trim()), ja: C.clean($('#addJA').value.trim()), correct: 0, wrong: 0
      };
      if (!w.e || !w.j) return;
      if (w.ea.indexOf(w.e) < 0) {
        var ok = await confirmBox('例文に英単語が含まれていません',
          '例文の中に「' + w.e + '」がそのまま入っていないと、[ **** ] の穴埋めになりません。\nこのまま追加しますか？', '追加する');
        if (!ok) return;
      }
      w.correct = $('#addCorrectMode').value === 'mode' ? C.modeCorrect(S.words) : 0;
      S.words.unshift(w);                       // 一番上に追加
      if (S.q >= 0) S.q += 1;
      await saveNow();
      $('#addForm').reset();
      $('#addMsg').textContent = '「' + w.e + '」を追加しました（正解数 ' + w.correct + '）';
      if (S.q < 0) nextQuestion(); else renderStatus();
      renderWordTable();
    });

    $('#wordSearch').addEventListener('input', renderWordTable);

    $('#btnMemoDownload').addEventListener('click', function () {
      if (!S.memo.length) { toast('メモは空です'); return; }
      download('memo.txt', C.serializeWords(S.memo));
    });
    $('#btnMemoClear').addEventListener('click', async function () {
      if (!S.memo.length) return;
      if (await confirmBox('メモを空にする', 'メモ ' + S.memo.length + ' 語を削除しますか？', '削除する', true)) { S.memo = []; saveSoon(); renderMemo(); }
    });

    $('#btnClearCorrect').addEventListener('click', async function () {
      if (!(await confirmBox('正解数をクリア', '正解数をクリアしてもいいですか？', 'クリアする', true))) return;
      S.words.forEach(function (w) { w.correct = 0; });
      await saveNow(); S.q = -1; nextQuestion(); renderWordTable();
    });
    $('#btnClearWrong').addEventListener('click', async function () {
      if (!(await confirmBox('不正解数をクリア', '不正解数をクリアしてもいいですか？', 'クリアする', true))) return;
      S.words.forEach(function (w) { w.wrong = 0; });
      await saveNow(); renderWordTable();
    });
    $('#btnClearLog').addEventListener('click', async function () {
      if (!(await confirmBox('復習の記録をクリア', '不正解の記録（復習の予定）をすべて消してもいいですか？', 'クリアする', true))) return;
      S.log = []; S.tracker.loadFromLog(S.log);
      await saveNow(); renderStatus();
    });
  }

  /* ------------------------------------------------------------------ */
  /* キーボード                                                          */
  /* ------------------------------------------------------------------ */

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (S.modalDepth > 0) return;
      var k = e.key;
      var inField = e.target && e.target.closest && e.target.closest('input, textarea, select');
      switch (k) {
        case 'F1': e.preventDefault(); setTab('jtoe'); return;
        case 'F2': e.preventDefault(); setTab('etoj'); return;
        case 'F3': e.preventDefault(); setTab('settings'); return;
        case 'F4': e.preventDefault(); toggleAnswer(); return;
        case 'F5': if (S.tab === 'jtoe') { e.preventDefault(); markDiff(); } return;
        case 'F6': e.preventDefault(); toggleAsterisk(); return;
        case 'Escape':
          if (S.tab !== 'settings' && S.q >= 0 && !inField) { e.preventDefault(); pass(); }
          return;
      }
      if (S.tab === 'etoj' && !inField && /^[0-9]$/.test(k) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        choose(k === '0' ? 9 : Number(k) - 1);
      }
    });

    $$('.tabs button').forEach(function (b) {
      b.addEventListener('click', function () { setTab(b.dataset.tab); });
    });

    $$('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        switch (b.dataset.act) {
          case 'answer': toggleAnswer(); break;
          case 'diff': markDiff(); break;
          case 'asterisk': toggleAsterisk(); break;
          case 'memo': if (S.q >= 0) addMemo(S.words[S.q]); break;
          case 'pass': pass(); break;
        }
        if (S.tab === 'jtoe' && b.dataset.act !== 'pass' && b.dataset.act !== 'diff') answerEl.focus();
      });
    });

    // 英訳の解答欄
    answerEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    answerEl.addEventListener('input', function (e) {
      if (e.isComposing) return;
      normalizeAnswer();
      checkAnswer();
    });
    answerEl.addEventListener('compositionend', function () { normalizeAnswer(); checkAnswer(); });
    answerEl.addEventListener('paste', function (e) {
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData('text').replace(/[\r\n]+/g, ' ');
      document.execCommand('insertText', false, t);
    });
    answerEl.addEventListener('drop', function (e) { e.preventDefault(); });
  }

  /* ------------------------------------------------------------------ */
  /* 起動                                                                */
  /* ------------------------------------------------------------------ */

  async function init() {
    answerEl = $('#answer');
    bindKeys();
    bindSettings();

    var meta = await DB.get('meta');
    if (meta && meta.decks && meta.decks.length) {
      S.decks = meta.decks;
      var cur = meta.current;
      if (!S.decks.some(function (d) { return d.id === cur; })) cur = S.decks[0].id;
      await loadDeck(cur);
    } else {
      await createDeck('tango1');
    }
    setTab('etoj');   // 既定は和訳モード

    // 開発・動作確認用に状態を覗けるようにしておく
    window.__tango = { S: S, C: C };
  }

  document.addEventListener('DOMContentLoaded', function () {
    init().catch(function (e) {
      console.error(e);
      toast('起動に失敗しました: ' + (e && e.message ? e.message : e), 6000);
    });
  });
})();
