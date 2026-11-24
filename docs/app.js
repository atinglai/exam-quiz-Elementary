/* 初等考試一般行政 考古題測驗
 * 資料來源：window.BANK（由 build.py 產生）
 * 流程：首頁選科目 → 依該科最近一年的出題方式，從各年度題庫打散抽題組新試卷
 *       → 依官方考試時間倒數 → 交卷自動批改、顯示分數與每題解析
 */
(function () {
  "use strict";

  var LETTERS = ["A", "B", "C", "D", "E"];
  var SUBJECTS = ["國文", "公民與英文", "法學大意", "行政學大意"];
  var KEY_STATE = "quiz-state-v1";
  var KEY_HISTORY = "quiz-history-v1";

  var app = document.getElementById("app");
  var S = null; // 進行中的測驗狀態
  var timerId = null;

  /* ---------- 小工具 ---------- */
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.slice(0, 2) === "on") node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? "" : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function fmtTime(sec) {
    sec = Math.max(0, sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ":" : "") + pad(m) + ":" + pad(s);
  }
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 忽略 */ }
  }
  function drop(key) { try { localStorage.removeItem(key); } catch (e) { /* 忽略 */ } }

  var QMAP = {};
  SUBJECTS.forEach(function (s) {
    (BANK[s].questions || []).forEach(function (q) { QMAP[s + "|" + q.id] = q; });
  });

  /* ---------- 組卷 ---------- */
  // 每一區段（如單選 35 題、複選 10 題、公民 35 題、英文 15 題）各自從題庫打散抽題。
  // 屬於同一題組（同一篇閱讀／克漏字）的題目會整組一起抽，避免文章與題目被拆開。
  function compose(subject) {
    var cfg = BANK[subject];
    var paper = [];
    cfg.sections.forEach(function (sec) {
      var pool = cfg.questions.filter(function (q) { return q.sec === sec.name && q.type === sec.type; });
      var singles = [], groupMap = {};
      pool.forEach(function (q) {
        if (q.g) { (groupMap[q.g] = groupMap[q.g] || []).push(q); }
        else singles.push([q]);
      });
      var units = singles.concat(Object.keys(groupMap).map(function (g) {
        return groupMap[g].sort(function (a, b) { return a.no - b.no; });
      }));
      units = shuffle(units);
      var picked = [], n = 0;
      for (var i = 0; i < units.length && n < sec.count; i++) {
        if (n + units[i].length <= sec.count) { picked = picked.concat(units[i]); n += units[i].length; }
      }
      picked.forEach(function (q) { paper.push({ id: q.id, sec: sec.name }); });
    });
    return paper;
  }

  /* ---------- 計分 ---------- */
  function secOf(subject, name) {
    return BANK[subject].sections.filter(function (s) { return s.name === name; })[0];
  }
  // 單選：答對得分。複選：每個選項獨立判定，錯 1 個選項得 (1-0.4)=60%、錯 2 個得 20%、錯多於 2 個或未作答為 0（官方計分規則）
  function scoreOf(q, sec, ans) {
    var pts = sec.pts;
    if (q.a === "ALL") return pts;
    if (!ans) return 0;
    // 單選若有「多個答案均給分」的更正（如 "BD"），選其中任一個都算對
    if (q.type === "single") return ans.length === 1 && q.a.indexOf(ans) >= 0 ? pts : 0;
    var wrong = 0;
    for (var i = 0; i < q.o.length; i++) {
      var L = LETTERS[i];
      if ((ans.indexOf(L) >= 0) !== (q.a.indexOf(L) >= 0)) wrong++;
    }
    if (wrong === 0) return pts;
    if (wrong <= 2) return Math.round(pts * (1 - 0.4 * wrong) * 100) / 100;
    return 0;
  }
  function isFull(q, sec, ans) { return scoreOf(q, sec, ans) === sec.pts; }

  /* ---------- 畫面：首頁 ---------- */
  function showHome() {
    stopTimer();
    S = null;
    clear(app);
    var wrap = el("div", { class: "wrap" });
    wrap.appendChild(el("h1", { text: "初等考試・一般行政　考古題測驗" }));
    wrap.appendChild(el("p", { class: "sub", text: "題目取自歷屆試題，跨年度打散重新組成新試卷；題數與時間依各科官方規定，交卷後自動對答案並計分。" }));

    var saved = load(KEY_STATE, null);
    if (saved && saved.subject && !saved.done) {
      wrap.appendChild(el("div", { class: "banner" },
        el("span", { text: "你有一份尚未交卷的「" + saved.subject + "」試卷。" }),
        el("span", {},
          el("button", { class: "primary", text: "繼續作答", onclick: function () { resume(saved); } }),
          " ",
          el("button", { text: "放棄", onclick: function () { drop(KEY_STATE); showHome(); } }))));
    }

    var grid = el("div", { class: "grid" });
    SUBJECTS.forEach(function (name) {
      var cfg = BANK[name];
      var ready = cfg.questions.length > 0;
      var card = el("div", { class: "card" }, el("h2", { text: name }));
      if (ready) {
        var total = cfg.sections.reduce(function (a, s) { return a + s.count; }, 0);
        var full = cfg.sections.reduce(function (a, s) { return a + s.count * s.pts; }, 0);
        card.appendChild(el("p", { class: "meta", text: "每份 " + total + " 題・滿分 " + full + " 分・" + cfg.minutes + " 分鐘" }));
        var ul = el("ul");
        cfg.sections.forEach(function (s) {
          ul.appendChild(el("li", { text: s.name + " " + s.count + " 題（" + (s.type === "multiple" ? "複選" : "單選") + "，每題 " + s.pts + " 分）" }));
        });
        ul.appendChild(el("li", { text: "題庫 " + cfg.questions.length + " 題，涵蓋 " + cfg.years.join("、") + " 年" }));
        card.appendChild(ul);
        card.appendChild(el("button", { class: "primary", text: "開始測驗", onclick: function () { start(name); } }));
      } else {
        card.appendChild(el("p", { class: "meta", text: "題庫準備中" }));
        card.appendChild(el("button", { text: "尚無題目", disabled: true }));
      }
      grid.appendChild(card);
    });
    wrap.appendChild(grid);

    var hist = load(KEY_HISTORY, []);
    if (hist.length) {
      var box = el("div", { class: "history" }, el("h2", { text: "最近成績（存在這個瀏覽器）" }));
      var tb = el("table");
      tb.appendChild(el("tr", {}, el("th", { text: "時間" }), el("th", { text: "科目" }), el("th", { text: "分數" }), el("th", { text: "答對題數" })));
      hist.slice(0, 10).forEach(function (h) {
        tb.appendChild(el("tr", {},
          el("td", { text: h.at }), el("td", { text: h.subject }),
          el("td", { text: h.score + " / " + h.full }), el("td", { text: h.correct + " / " + h.n })));
      });
      box.appendChild(tb);
      wrap.appendChild(box);
    }
    app.appendChild(wrap);
    window.scrollTo(0, 0);
  }

  /* ---------- 開始／繼續 ---------- */
  function start(subject) {
    var cfg = BANK[subject];
    S = {
      subject: subject,
      paper: compose(subject),
      answers: {},
      deadline: Date.now() + cfg.minutes * 60 * 1000,
      done: false
    };
    save(KEY_STATE, S);
    showExam();
  }
  function resume(saved) {
    var ok = saved.paper.every(function (p) { return QMAP[saved.subject + "|" + p.id]; });
    if (!ok) { drop(KEY_STATE); showHome(); return; }
    S = saved;
    showExam();
  }

  /* ---------- 題目卡片 ---------- */
  function questionCard(idx, mode, result) {
    var p = S.paper[idx];
    var q = QMAP[S.subject + "|" + p.id];
    var sec = secOf(S.subject, p.sec);
    var ans = S.answers[p.id] || "";
    var cls = "q";
    if (mode === "review") cls += result.full ? " ok" : " bad";
    var card = el("div", { class: cls, id: "q" + (idx + 1) });

    var head = el("div", { class: "head" }, el("b", { text: "第 " + (idx + 1) + " 題" }));
    head.appendChild(el("span", { text: sec.pts + " 分" }));
    if (q.type === "multiple") head.appendChild(el("span", { class: "tag", text: "複選" }));
    if (mode === "review") {
      head.appendChild(el("span", { text: "出處：" + q.y + " 年第 " + q.no + " 題" }));
      if (q.cat) head.appendChild(el("span", { class: "tag", text: q.cat }));
    }
    card.appendChild(head);

    if (q.g && BANK[S.subject].groups[q.g]) {
      var prev = idx > 0 ? QMAP[S.subject + "|" + S.paper[idx - 1].id] : null;
      var firstOfGroup = !prev || prev.g !== q.g;
      var passage = el("div", { class: "passage", text: BANK[S.subject].groups[q.g] });
      if (firstOfGroup) card.appendChild(passage);
      else card.appendChild(el("div", { class: "head", text: "（題組：同上方文章／題幹）" }));
    }
    card.appendChild(el("div", { class: "stem", text: q.s }));

    var opts = el("div", { class: "opts" });
    q.o.forEach(function (text, i) {
      var L = LETTERS[i];
      var picked = ans.indexOf(L) >= 0;
      var isCorrect = q.a === "ALL" ? false : q.a.indexOf(L) >= 0;
      var c = "opt" + (q.type === "multiple" ? " multi" : "");
      if (mode === "exam") {
        if (picked) c += " sel";
      } else {
        if (picked && isCorrect) c += " correct";
        else if (picked && !isCorrect && q.a !== "ALL") c += " wrong";
        else if (!picked && isCorrect) c += " correct missed";
      }
      var b = el("button", {
        class: c, type: "button", disabled: mode === "review",
        onclick: mode === "exam" ? function () { choose(idx, L); } : null
      }, el("span", { class: "L", text: L }), el("span", { class: "t", text: text }));
      opts.appendChild(b);
    });
    card.appendChild(opts);

    if (mode === "review") {
      var v = el("div", { class: "verdict" });
      var correctText = q.a === "ALL" ? "本題一律給分"
        : (q.type === "single" && q.a.length > 1) ? "正確答案：" + q.a.split("").join(" 或 ") + "（更正答案，均給分）"
        : "正確答案：" + q.a.split("").join("、");
      v.appendChild(el("b", { class: result.full ? "ok" : "bad", text: result.full ? "答對" : (result.score > 0 ? "部分得分" : (ans ? "答錯" : "未作答")) }));
      v.appendChild(document.createTextNode("　" + correctText + "　你的答案：" + (ans ? ans.split("").join("、") : "—") + "　得分 " + result.score + " / " + sec.pts));
      card.appendChild(v);
    }
    return card;
  }

  /* ---------- 畫面：作答 ---------- */
  function showExam() {
    clear(app);
    var cfg = BANK[S.subject];

    var timer = el("span", { class: "timer", id: "timer", text: "--:--" });
    var progress = el("span", { class: "progress", id: "progress" });
    var top = el("div", { class: "topbar" }, el("div", { class: "in" },
      el("span", { class: "title", text: S.subject + "（" + cfg.minutes + " 分鐘）" }),
      progress, timer,
      el("button", { class: "danger", text: "交卷", onclick: function () { confirmSubmit(); } })));
    app.appendChild(top);

    var wrap = el("div", { class: "wrap" });
    var nav = el("div", { class: "nav", id: "nav" });
    S.paper.forEach(function (p, i) {
      nav.appendChild(el("a", { href: "#q" + (i + 1), id: "n" + (i + 1), text: String(i + 1) }));
    });
    wrap.appendChild(nav);

    var lastSec = null;
    S.paper.forEach(function (p, i) {
      if (p.sec !== lastSec) {
        var sec = secOf(S.subject, p.sec);
        wrap.appendChild(el("div", { class: "sec-head" },
          el("b", { text: p.sec }),
          el("small", { text: "　每題 " + sec.pts + " 分" + (sec.type === "multiple" ? "；每題至少有二個正確答案，各選項獨立判定，答錯一個選項得 " + (sec.pts * 0.6).toFixed(1) + " 分、答錯二個得 " + (sec.pts * 0.2).toFixed(1) + " 分，其餘 0 分" : "") })));
        lastSec = p.sec;
      }
      wrap.appendChild(questionCard(i, "exam"));
    });
    wrap.appendChild(el("div", { class: "actions" },
      el("button", { class: "danger", text: "交卷並對答案", onclick: function () { confirmSubmit(); } })));
    app.appendChild(wrap);

    updateProgress();
    tick();
    timerId = setInterval(tick, 500);
    window.scrollTo(0, 0);
  }

  function choose(idx, L) {
    var p = S.paper[idx];
    var q = QMAP[S.subject + "|" + p.id];
    var cur = S.answers[p.id] || "";
    if (q.type === "single") {
      cur = cur === L ? "" : L; // 再點一次可取消
    } else {
      var set = cur.split("").filter(Boolean);
      var at = set.indexOf(L);
      if (at >= 0) set.splice(at, 1); else set.push(L);
      cur = set.sort().join("");
    }
    if (cur) S.answers[p.id] = cur; else delete S.answers[p.id];
    save(KEY_STATE, S);

    // 局部更新該題選項外觀與導覽
    var card = document.getElementById("q" + (idx + 1));
    var btns = card.querySelectorAll(".opt");
    for (var i = 0; i < btns.length; i++) {
      if (cur.indexOf(LETTERS[i]) >= 0) btns[i].classList.add("sel"); else btns[i].classList.remove("sel");
    }
    updateProgress();
  }

  function updateProgress() {
    var n = Object.keys(S.answers).length;
    var pr = document.getElementById("progress");
    if (pr) pr.textContent = "已作答 " + n + " / " + S.paper.length;
    S.paper.forEach(function (p, i) {
      var a = document.getElementById("n" + (i + 1));
      if (a) a.className = S.answers[p.id] ? "done" : "";
    });
  }

  function tick() {
    var left = Math.round((S.deadline - Date.now()) / 1000);
    var t = document.getElementById("timer");
    if (t) {
      t.textContent = fmtTime(left);
      t.className = "timer" + (left <= 60 ? " crit" : left <= 300 ? " low" : "");
    }
    if (left <= 0) { stopTimer(); submit(true); }
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  /* ---------- 交卷 ---------- */
  function confirmSubmit() {
    var blank = S.paper.length - Object.keys(S.answers).length;
    var msg = blank > 0 ? "還有 " + blank + " 題尚未作答，確定要交卷嗎？交卷後無法修改答案。" : "確定要交卷嗎？交卷後無法修改答案。";
    var bg = el("div", { class: "modal-bg" }, el("div", { class: "modal" },
      el("p", { text: msg }),
      el("div", { class: "row" },
        el("button", { text: "繼續作答", onclick: function () { document.body.removeChild(bg); } }),
        el("button", { class: "danger", text: "確定交卷", onclick: function () { document.body.removeChild(bg); submit(false); } }))));
    document.body.appendChild(bg);
  }

  function submit(auto) {
    stopTimer();
    var results = S.paper.map(function (p) {
      var q = QMAP[S.subject + "|" + p.id];
      var sec = secOf(S.subject, p.sec);
      var ans = S.answers[p.id] || "";
      var sc = scoreOf(q, sec, ans);
      return { score: sc, full: sc === sec.pts, sec: p.sec, pts: sec.pts };
    });
    var score = results.reduce(function (a, r) { return a + r.score; }, 0);
    var full = results.reduce(function (a, r) { return a + r.pts; }, 0);
    var correct = results.filter(function (r) { return r.full; }).length;
    score = Math.round(score * 100) / 100;

    var d = new Date();
    var hist = load(KEY_HISTORY, []);
    hist.unshift({
      at: d.getFullYear() + "/" + pad(d.getMonth() + 1) + "/" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()),
      subject: S.subject, score: score, full: full, correct: correct, n: S.paper.length
    });
    save(KEY_HISTORY, hist.slice(0, 30));
    drop(KEY_STATE);
    S.done = true;
    showResult(results, score, full, correct, auto);
  }

  /* ---------- 畫面：成績與解析 ---------- */
  function showResult(results, score, full, correct, auto) {
    clear(app);
    var wrap = el("div", { class: "wrap" });
    wrap.appendChild(el("h1", { text: S.subject + "　測驗結果" }));
    if (auto) wrap.appendChild(el("p", { class: "sub", text: "時間到，系統已自動交卷。" }));

    var secScores = {};
    results.forEach(function (r) {
      var o = secScores[r.sec] = secScores[r.sec] || { score: 0, full: 0 };
      o.score += r.score; o.full += r.pts;
    });
    var box = el("div", { class: "result" },
      el("div", { class: "score" }, String(score), el("small", { text: " / " + full + " 分" })),
      el("div", { class: "stats" },
        el("span", { text: "完全答對 " + correct + " / " + S.paper.length + " 題" }),
        el("span", { text: "未作答 " + (S.paper.length - Object.keys(S.answers).length) + " 題" })));
    var ss = el("div", { class: "secscore" });
    Object.keys(secScores).forEach(function (k) {
      ss.appendChild(el("span", { text: k + "：" + Math.round(secScores[k].score * 100) / 100 + " / " + secScores[k].full }));
    });
    box.appendChild(ss);
    wrap.appendChild(box);

    var list = el("div", { id: "review" });
    function render(onlyWrong) {
      clear(list);
      var lastSec = null;
      S.paper.forEach(function (p, i) {
        if (onlyWrong && results[i].full) return;
        if (p.sec !== lastSec) { list.appendChild(el("div", { class: "sec-head" }, el("b", { text: p.sec }))); lastSec = p.sec; }
        list.appendChild(questionCard(i, "review", results[i]));
      });
      if (!list.firstChild) list.appendChild(el("p", { class: "sub", text: "全部答對，太棒了！" }));
    }
    var fAll = el("button", { class: "active", text: "全部題目" });
    var fWrong = el("button", { text: "只看答錯／未答" });
    fAll.addEventListener("click", function () { fAll.className = "active"; fWrong.className = ""; render(false); });
    fWrong.addEventListener("click", function () { fWrong.className = "active"; fAll.className = ""; render(true); });
    wrap.appendChild(el("div", { class: "filter" }, fAll, fWrong));

    var nav = el("div", { class: "nav" });
    S.paper.forEach(function (p, i) {
      nav.appendChild(el("a", { href: "#q" + (i + 1), class: results[i].full ? "ok" : "bad", text: String(i + 1) }));
    });
    wrap.appendChild(nav);
    wrap.appendChild(list);
    render(false);

    var again = S.subject;
    wrap.appendChild(el("div", { class: "actions" },
      el("button", { class: "primary", text: "再考一次（重新組新試卷）", onclick: function () { start(again); } }),
      el("button", { text: "回首頁", onclick: showHome })));
    wrap.appendChild(el("p", { class: "note", text: "答案依考選部公布之標準答案；若有更正答案公告，以更正答案為準。" }));
    app.appendChild(wrap);
    window.scrollTo(0, 0);
  }

  // 離開頁面前提醒（作答中）
  window.addEventListener("beforeunload", function (e) {
    if (S && !S.done) { e.preventDefault(); e.returnValue = ""; }
  });

  showHome();
})();
