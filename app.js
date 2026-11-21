/* app.js — 나의 생리 캘린더: 화면 · 입력 · 저장
   개인 데이터 없음. 기록은 이 브라우저의 localStorage(mycycle-v1)에만 저장됩니다. */
(function () {
  'use strict';
  var G = typeof window !== 'undefined' ? window : globalThis;
  var C = G.CycleCore;

  var S = null;
  var TAB = 'today';
  var CAL = null;            // 보고 있는 달 'YYYY-MM'
  var SEL = null;            // 캘린더에서 고른 날짜
  var SHEET = null;          // {type:'day'|'range'|'manage'|'import'|'confirm'|'info', ...}
  var NEWROWS = [];          // 기록 관리: 새로 추가할 기간들
  var PENDING = null;        // 불러오기 대기
  var saveTimer = null;

  var ICON = {
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 15.5 4 19z"/></svg>'
  };

  /* ---------------- 도우미 ---------------- */

  function q(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function today() { return C.todayISO(); }

  function toast(msg) {
    var t = q('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 2300);
  }

  function load() {
    var raw = null;
    try { raw = localStorage.getItem(C.STORE_KEY); } catch (e) { raw = null; }
    if (!raw) return C.freshState();
    try { return C.normalizeState(JSON.parse(raw)); } catch (e) { return C.freshState(); }
  }

  function saveNow() {
    clearTimeout(saveTimer);
    saveTimer = null;
    try {
      localStorage.setItem(C.STORE_KEY, JSON.stringify(S));
    } catch (e) {
      toast('저장 공간이 부족해 저장하지 못했어요');
    }
  }

  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 450);
  }

  function save() { saveNow(); }

  function dday(n) {
    if (n === 0) return '오늘';
    if (n > 0) return 'D-' + n;
    return 'D+' + (-n);
  }

  function flowDots(k) {
    var n = k === 'light' ? 1 : k === 'heavy' ? 3 : k === 'medium' ? 2 : 0;
    var h = '';
    for (var i = 0; i < 3; i++) h += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    return '<span class="dots">' + h + '</span>';
  }

  /* ---------------- 저장 후 화면 갱신 ---------------- */

  function apply(fn, msg) {
    fn();
    save();
    render();
    if (SHEET) renderSheet(true);
    if (msg) toast(msg);
  }

  /* ---------------- 헤더 ---------------- */

  function renderHeader() {
    var t = today();
    var h = '';
    var title = '오늘', sub = C.dateLabelKo(t), btn = '';
    if (TAB === 'calendar') {
      title = '캘린더';
      sub = C.monthLabel(CAL || C.ymOf(t));
      btn = '<button class="hbtn" data-act="open-range-sheet">' + ICON.plus + '기간 기록</button>';
    } else if (TAB === 'history') {
      title = '기록과 분석';
      sub = '주기 ' + C.periodsOf(S).length + '회 · ' + C.countDays(S) + '일 기록';
      btn = '<button class="hbtn" data-act="open-manage-sheet">' + ICON.edit + '기록 관리</button>';
    } else if (TAB === 'settings') {
      title = '설정';
      sub = '이 기기에만 저장돼요';
    } else {
      var sm = C.summary(S, t);
      if (sm.kind === 'period') sub = C.dateLabelKo(t) + ' · 생리 ' + sm.periodDay + '일째';
    }
    h = '<div class="hrow"><div><h1 class="htitle">' + title + '</h1><div class="hsub">' + esc(sub) + '</div></div>' +
      '<div class="hspacer"></div>' + btn + '</div>';
    var hdr = q('hdr');
    hdr.innerHTML = h;
    hdr.classList.toggle('shadow', (q('main') || {}).scrollTop > 2);
  }

  /* ---------------- 오늘 화면 ---------------- */

  function heroHTML(sm) {
    var kind = sm.kind === 'period' ? 'period' : sm.kind === 'empty' ? 'empty' :
      ((sm.inFertile || sm.inOvulation) && S.settings.showFertile !== false ? 'fertile' : 'period');

    var label = '', big = '', unit = '', sub = '';
    if (sm.kind === 'empty') {
      label = '생리 캘린더';
      big = '시작';
      sub = '생리 시작일만 기록하면 예측이 시작돼요';
    } else if (sm.kind === 'period') {
      label = '생리 중';
      big = String(sm.periodDay);
      unit = '일째';
      sub = C.dateSlash(sm.period.start) + ' 시작 · ' + C.dateSlash(C.addDays(sm.period.start, sm.periodLen - 1)) + '까지 예상';
    } else if (sm.kind === 'due') {
      label = '다음 생리';
      big = '오늘';
      sub = C.rangeLabel(sm.next.start, sm.next.end) + ' 예정';
    } else if (sm.kind === 'late') {
      label = '생리 예정일에서';
      big = String(sm.lateDays);
      unit = '일 지남';
      sub = C.rangeLabel(sm.next.start, sm.next.end) + ' 예정이었어요';
    } else {
      label = '다음 생리까지';
      big = String(sm.daysUntil);
      unit = '일';
      sub = C.dateLabelKo(sm.next.start) + ' 시작 예정';
    }

    var phase = phaseLabel(sm);
    var p = sm.kind === 'empty' ? 0.03 : Math.max(0.035, Math.min(1, sm.progress));
    var R = 78, circ = 2 * Math.PI * R;
    var off = (circ * (1 - p)).toFixed(1);

    var grad = kind === 'fertile' ? 'gMint' : 'gRose';
    var chips = '';
    if (sm.next && sm.kind !== 'empty') {
      chips += '<span class="chip rose">🩸 생리 예정 <b>' + C.rangeLabel(sm.next.start, sm.next.end) + '</b></span>';
    }
    if (sm.fertileStart && sm.fertileEnd && S.settings.showFertile !== false) {
      chips += '<span class="chip mint">🌿 가임기 <b>' + C.rangeLabel(sm.fertileStart, sm.fertileEnd) + '</b></span>';
    }
    if (!chips) {
      chips = '<span class="chip dim">기록을 시작하면 다음 일정이 여기에 보여요</span>';
    }

    return '' +
      '<section class="hero" data-kind="' + kind + '">' +
        '<div class="hero-top"><span class="dot"></span>' + esc(C.dateLabelKo(sm.today)) +
          '<span class="sp"></span><span class="phase">' + esc(phase) + '</span></div>' +
        '<div class="ringwrap">' +
          '<svg viewBox="0 0 180 180" aria-hidden="true">' +
            '<defs>' +
              '<linearGradient id="gRose" x1="0" y1="0" x2="1" y2="1">' +
                '<stop offset="0%" stop-color="#FFB49C"/><stop offset="55%" stop-color="#FF7E9B"/><stop offset="100%" stop-color="#E8345C"/>' +
              '</linearGradient>' +
              '<linearGradient id="gMint" x1="0" y1="0" x2="1" y2="1">' +
                '<stop offset="0%" stop-color="#96F0DC"/><stop offset="55%" stop-color="#3FDDBE"/><stop offset="100%" stop-color="#0FAE90"/>' +
              '</linearGradient>' +
            '</defs>' +
            '<circle class="ring-bg" cx="90" cy="90" r="' + R + '"/>' +
            (kind === 'empty' ? '' : '<circle class="ring-fg" cx="90" cy="90" r="' + R + '" stroke="url(#' + grad + ')" stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + off + '"/>') +
          '</svg>' +
          '<div class="ring-center">' +
            '<div class="ring-label">' + esc(label) + '</div>' +
            '<div class="ring-big">' + esc(big) + (unit ? '<span class="unit">' + esc(unit) + '</span>' : '') + '</div>' +
            '<div class="ring-sub">' + esc(sub) + '</div>' +
          '</div>' +
        '</div>' +
        '<div class="hero-chips">' + chips + '</div>' +
      '</section>';
  }

  function phaseLabel(sm) {
    if (sm.kind === 'empty') return '기록 전';
    if (sm.kind === 'period') return '생리 D+' + sm.periodDay + '일째';
    if (sm.kind === 'due') return '생리 예정일';
    if (sm.kind === 'late') return '생리 예정 ' + sm.lateDays + '일 지남';
    if (sm.inOvulation && S.settings.showOvulation !== false) return '배란일';
    if (sm.inFertile && S.settings.showFertile !== false) return '가임기';
    return '생리 예정 ' + dday(sm.daysUntil);
  }

  function scheduleCardHTML(sm) {
    if (sm.kind === 'empty') {
      return '<section class="card">' +
        '<div class="card-title">주기 요약</div>' +
        '<div class="emptynote"><span class="big">🌷</span>생리 시작일을 기록하면<br>다음 생리·가임기·배란일을 예측해 드려요.</div>' +
        '</section>';
    }
    var rows = '';
    rows += '<button class="rowline" data-act="goto-date" data-date="' + sm.next.start + '">' +
      '<span class="ico rose">🩸</span><span class="rowmain"><b>다음 생리 예정</b>' +
      '<small>' + esc(C.rangeLabel(sm.next.start, sm.next.end)) + ' · ' + sm.periodLen + '일</small></span>' +
      '<span class="rowside">' + dday(sm.daysUntil) + '</span><span class="rowgo">›</span></button>';

    if (S.settings.showFertile !== false && sm.fertileStart) {
      var dF = C.diffDays(sm.today, sm.fertileStart);
      var sideF = sm.inFertile ? '오늘' : (dF >= 0 ? dday(dF) : '지남');
      rows += '<button class="rowline" data-act="goto-date" data-date="' + sm.fertileStart + '">' +
        '<span class="ico mint">🌿</span><span class="rowmain"><b>가임기</b>' +
        '<small>' + esc(C.rangeLabel(sm.fertileStart, sm.fertileEnd)) + ' · ' + (C.diffDays(sm.fertileStart, sm.fertileEnd) + 1) + '일</small></span>' +
        '<span class="rowside mint">' + sideF + '</span><span class="rowgo">›</span></button>';
    }
    if (S.settings.showOvulation !== false && sm.ovulation) {
      var dO = C.diffDays(sm.today, sm.ovulation);
      rows += '<button class="rowline" data-act="goto-date" data-date="' + sm.ovulation + '">' +
        '<span class="ico teal">🥚</span><span class="rowmain"><b>배란 예정일</b>' +
        '<small>' + esc(C.dateLabelKo(sm.ovulation)) + '</small></span>' +
        '<span class="rowside mint">' + (sm.inOvulation ? '오늘' : dday(dO)) + '</span><span class="rowgo">›</span></button>';
    }

    var avgNote = sm.cycleBasis === 'data' ? '기록 ' + sm.cycleCount + '회 평균' : '기본값';
    var perNote = sm.periodBasis === 'data' ? '기록 ' + sm.periodCount + '구간 평균' : '기본값';
    return '<section class="card">' +
      '<div class="card-title">주기 요약 <span class="sub">예측 일정은 날짜로 표시돼요</span></div>' +
      '<div class="rows">' + rows + '</div>' +
      '<div class="divider"></div>' +
      '<div class="sumgrid">' +
        '<div class="sumcell"><div class="k">평균 주기</div><div class="v">' + sm.cycleLen + '<small>일</small></div>' +
          '<div class="tiny">' + esc(avgNote) + '</div></div>' +
        '<div class="sumcell"><div class="k">평균 생리 기간</div><div class="v">' + sm.periodLen + '<small>일</small></div>' +
          '<div class="tiny">' + esc(perNote) + '</div></div>' +
      '</div>' +
      '</section>';
  }

  function flowSegHTML(date, rec) {
    var cur = rec.flow || '';
    var h = '<div class="field"><div class="flabel">출혈량 <span class="hint">고르면 생리일로 기록돼요</span></div><div class="seg">';
    for (var i = 0; i < C.FLOWS.length; i++) {
      var f = C.FLOWS[i];
      h += '<button data-act="flow" data-date="' + date + '" data-flow="' + f.k + '" class="' + (cur === f.k ? 'on' : '') + '">' +
        flowDots(f.k) + '<span>' + f.t + '</span></button>';
    }
    return h + '</div></div>';
  }

  function chipsHTML(date, list, field, rec, cls, withEmoji) {
    var cur = rec[field] || [];
    var h = '<div class="chips ' + cls + '">';
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      h += '<button data-act="' + field + '" data-date="' + date + '" data-k="' + it.k + '" class="' + (cur.indexOf(it.k) >= 0 ? 'on' : '') + '">' +
        (withEmoji ? '<span class="e">' + it.e + '</span>' : '') + esc(it.t) + '</button>';
    }
    return h + '</div>';
  }

  function memoHTML(date, rec) {
    var v = rec.memo || '';
    return '<div class="field"><div class="flabel">메모 <span class="hint">분비물·컨디션 등 자유롭게</span></div>' +
      '<textarea data-memo="' + date + '" maxlength="500" placeholder="예: 투명하고 끈적한 분비물, 컨디션 좋음">' + esc(v) + '</textarea>' +
      '<div class="memo-foot"><span class="memocnt">' + v.length + '</span>/500</div></div>';
  }

  function controlsHTML(date) {
    var rec = C.dayRec(S, date) || {};
    return flowSegHTML(date, rec) +
      '<div class="field"><div class="flabel">증상</div>' + chipsHTML(date, C.SYMPTOMS, 'symptoms', rec, '', true) + '</div>' +
      '<div class="field"><div class="flabel">기분</div>' + chipsHTML(date, C.MOODS, 'moods', rec, 'mood', true) + '</div>' +
      '<div class="field"><div class="flabel">분비물</div>' + chipsHTML(date, C.DISCHARGE, 'discharge', rec, 'dis', false) + '</div>' +
      memoHTML(date, rec);
  }

  function periodButtonsHTML(date, compact) {
    var isP = C.isPeriodDay(S, date);
    var isToday = date === today();
    if (isP) {
      return '<div class="bigbtns">' +
        '<button class="btn ghost rose" data-act="end-period" data-date="' + date + '">' + (isToday ? '생리 종료' : '이 날로 종료') + '</button>' +
        '<button class="btn ghost" data-act="unset-period" data-date="' + date + '">생리 아님</button>' +
        '</div>';
    }
    return '<div class="bigbtns">' +
      '<button class="btn primary" data-act="start-period" data-date="' + date + '">생리 시작</button>' +
      (isToday ? '<button class="btn ghost" data-act="start-yesterday" data-date="' + date + '">어제 시작</button>' : '') +
      '</div>';
  }

  function todayRecordCard(sm) {
    var t = sm.today;
    var rec = C.dayRec(S, t) || {};
    var pill = sm.kind === 'period' ? '<span class="pill">생리 ' + sm.periodDay + '일째</span>' :
      (sm.inFertile && S.settings.showFertile !== false ? '<span class="pill mint">가임기</span>' :
        (sm.inOvulation && S.settings.showOvulation !== false ? '<span class="pill mint">배란일</span>' : '<span class="pill gray">' + esc(phaseLabel(sm)) + '</span>'));
    return '<section class="card">' +
      '<div class="rec-head"><span class="d">' + esc(C.dateLabelKo(t)) + '</span>' + pill + '</div>' +
      periodButtonsHTML(t) +
      controlsHTML(t) +
      '<div class="tiny center" style="margin-top:10px">오늘 기록은 자동으로 저장돼요 · 이 기기에만</div>' +
      '</section>';
  }

  function viewToday() {
    var sm = C.summary(S, today());
    var html = heroHTML(sm) + '<div class="spacer8"></div>' + scheduleCardHTML(sm) + todayRecordCard(sm);
    if (sm.kind === 'empty') {
      html = heroHTML(sm) + '<div class="spacer8"></div>' + introCard();
    }
    return html;
  }

  function introCard() {
    return '<section class="card">' +
      '<div class="card-title">시작하기</div>' +
      '<div class="bigbtns">' +
        '<button class="btn primary" data-act="start-period" data-date="' + today() + '">오늘 생리 시작</button>' +
        '<button class="btn ghost" data-act="open-range-sheet">지난 생리 기록</button>' +
      '</div>' +
      '<div class="info">• 생리 시작일과 종료일만 넣어도 다음 생리·가임기·배란일을 예측해요.<br>' +
      '• 이미 쓰던 앱(Flo 등)의 JSON 백업이 있으면 <b>설정 → 불러오기</b>로 한 번에 옮길 수 있어요.<br>' +
      '• 기록은 서버로 보내지 않고 이 기기에만 저장돼요.</div>' +
      '</section>';
  }

  /* ---------------- 캘린더 ---------------- */

  function calIdxFor(ym) {
    var from = C.addDays(ym + '-01', -20);
    var to = C.addDays(C.monthEnd(ym), 20);
    return C.predictIndex(S, from, to);
  }

  function cellClass(info, date, ym) {
    var cls = ['cell'];
    if (C.ymOf(date) !== ym) cls.push('other');
    var dow = C.dowOf(date);
    if (dow === 0) cls.push('sun');
    if (dow === 6) cls.push('sat');
    if (info.period) cls.push('period');
    else if (info.pred) cls.push('pred');
    else if (info.ovu) cls.push('ovu');
    else if (info.fertile) cls.push('fert');
    if (date === today()) cls.push('today');
    return cls.join(' ');
  }

  function cellHTML(info, date, ym) {
    var num = +date.slice(8, 10);
    var mks = '';
    if (info.period) {
      var n = info.flow === 'light' ? 1 : info.flow === 'heavy' ? 3 : info.flow === 'medium' ? 2 : 0;
      if (n) {
        mks = '<span class="mks">';
        for (var i = 0; i < n; i++) mks += '<i></i>';
        mks += '</span>';
      }
    }
    var egg = info.ovu ? '<span class="egg">🥚</span>' : '';
    return '<button class="' + cellClass(info, date, ym) + '" data-act="open-day" data-date="' + date + '" ' +
      'aria-label="' + esc(C.dateLabelKo(date) + (info.period ? ', 생리일' : info.pred ? ', 생리 예정' : info.ovu ? ', 배란 예정' : info.fertile ? ', 가임기' : '')) + '">' +
      egg + '<span class="n">' + num + '</span>' + mks +
      (date === today() ? '<i class="dot-today"></i>' : '') + '</button>';
  }


  function monthRangeRows(ym) {
    var from = ym + '-01', to = C.monthEnd(ym);
    var idx = calIdxFor(ym);
    var rows = [];

    C.periodsOf(S).forEach(function (ep) {
      if (C.diffDays(ep.start, to) >= 0 && C.diffDays(from, ep.end) >= 0) {
        rows.push({ type: 'period', start: ep.start, end: ep.end, label: '생리 (기록)' });
      }
    });

    var nxt = C.nextPeriod(S, today());
    var sm0 = C.summary(S, today());
    if (nxt) {
      var cyc = sm0.cycleLen;
      var plen = sm0.periodLen;
      // 이 달에 걸치는 주기(예정 생리 · 그 앞의 가임기/배란)를 최대 30주기까지 훑는다
      for (var k = 0; k <= 30; k++) {
        var st = C.addDays(nxt.start, cyc * k);
        var en = C.addDays(st, plen - 1);
        var ovu = C.addDays(st, -C.LUTEAL);
        var fs = C.addDays(ovu, -C.FERTILE_BEFORE);
        var fe = C.addDays(ovu, C.FERTILE_AFTER);
        var predHit = C.diffDays(st, to) >= 0 && C.diffDays(en, from) <= 0;
        if (predHit) rows.push({ type: 'pred', start: st, end: en, label: '생리 예정' });
        if (C.diffDays(ovu, en) > 0) {
          if (S.settings.showFertile !== false && C.diffDays(fs, to) >= 0 && C.diffDays(from, fe) >= 0) {
            rows.push({ type: 'fert', start: fs, end: fe, label: '가임기' });
          }
          if (S.settings.showOvulation !== false && C.diffDays(from, ovu) >= 0 && C.diffDays(ovu, to) >= 0) {
            rows.push({ type: 'ovu', start: ovu, end: ovu, label: '배란 예정' });
          }
        }
      }
    }

    // 정렬: 시작일 순, 같은 날은 기록 → 예정 → 가임기 → 배란
    var order = { period: 0, pred: 1, fert: 2, ovu: 3 };
    rows.sort(function (a, b) {
      if (a.start === b.start) return order[a.type] - order[b.type];
      return a.start < b.start ? -1 : 1;
    });
    return rows.slice(0, 8);
  }

  function viewCalendar() {
    var ym = CAL || C.ymOf(today());
    CAL = ym;
    if (!SEL) SEL = null;
    var cells = C.monthGrid(ym);
    var idx = calIdxFor(ym);
    var grid = '';
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var info = C.dayInfo(S, c.date, idx);
      if (!c.inMonth) { info = { period: false, pred: false, fertile: false, ovu: false }; }
      grid += cellHTML(info, c.date, ym);
    }

    var rows = monthRangeRows(ym);
    var list = '';
    for (var r = 0; r < rows.length; r++) {
      var it = rows[r];
      var cls = it.type === 'period' ? 'pink' : it.type === 'pred' ? 'pink' : 'mint';
      var bar = it.type === 'period' ? '' : it.type === 'pred' ? '' : it.type === 'ovu' ? 'teal' : 'mint';
      var val = it.type === 'ovu' ? C.dateLabelKo(it.start) : C.rangeLabelDays(it.start, it.end);
      list += '<div class="mrow"><span class="bar ' + bar + '"></span><span class="lab">' + it.label + '</span>' +
        '<span class="val ' + cls + '">' + esc(val) + '</span></div>';
    }
    if (!list) list = '<div class="mrow"><span class="val dim">이 달에 표시할 생리 기록이 없어요</span></div>';

    var legend = '<div class="legend">' +
      '<span><i class="period"></i>생리</span>' +
      '<span><i class="pred"></i>생리 예정</span>' +
      (S.settings.showFertile !== false ? '<span><i class="fert"></i>가임기</span>' : '') +
      (S.settings.showOvulation !== false ? '<span><i class="ovu"></i>배란 예정</span>' : '') +
      '</div>';

    return '<section class="card">' +
      '<div class="calnav">' +
        '<button class="nav" data-act="month" data-d="-1" aria-label="이전 달">‹</button>' +
        '<span class="m">' + C.monthLabel(ym) + '</span>' +
        '<button class="nav" data-act="month" data-d="1" aria-label="다음 달">›</button>' +
        '<button class="todaychip" data-act="go-today">오늘</button>' +
      '</div>' +
      '<div class="dowrow">' + C.DOW.map(function (d, i) {
        return '<span class="' + (i === 0 ? 'sun' : i === 6 ? 'sat' : '') + '">' + d + '</span>';
      }).join('') + '</div>' +
      '<div class="calgrid">' + grid + '</div>' +
      legend +
      '<div class="spacer8"></div>' +
      '<button class="btn ghost rose block sm" data-act="open-range-sheet">생리 기간으로 한 번에 기록</button>' +
      '</section>' +
      '<section class="card">' +
      '<div class="card-title">' + C.monthLabelShort(ym) + ' 일정 <span class="sub">예측 포함</span></div>' +
      '<div class="monthlist">' + list + '</div>' +
      '<div class="tiny" style="margin-top:8px">점선은 예측일이에요. 실제 기록이 들어오면 예측이 다시 계산돼요.</div>' +
      '</section>';
  }

  /* ---------------- 기록 ---------------- */

  function chartHTML(h) {
    var chart = h.chart;
    if (!chart.length) {
      return '<section class="card"><div class="card-title">최근 주기 길이</div>' +
        '<div class="emptynote">생리 기록이 2구간 이상 쌓이면<br>주기 길이 변화가 여기에 보여요.</div></section>';
    }
    var W = 320, H = 134, padL = 5, padR = 10, top = 20, bottom = 20;
    var vals = chart.map(function (c) { return c.length; });
    var avg = h.avgCycle.value;
    var lo = Math.min.apply(null, vals.concat([avg])) - 2;
    var hi = Math.max.apply(null, vals.concat([avg])) + 2;
    if (hi - lo < 8) { lo -= 2; hi += 2; }
    var innerH = H - top - bottom;
    var bw = (W - padL - padR) / chart.length;
    var yOf = function (v) { return top + innerH - ((v - lo) / (hi - lo)) * innerH; };

    var bars = '', labels = '';
    for (var i = 0; i < chart.length; i++) {
      var c = chart[i];
      var x = padL + bw * i + bw * 0.16;
      var w = bw * 0.68;
      var y = yOf(c.length);
      var hgt = Math.max(3, H - bottom - y);
      var out = c.length < 21 || c.length > 35;
      bars += '<rect class="bar' + (out ? ' out' : '') + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hgt.toFixed(1) + '" rx="4"/>';
      bars += '<text class="val" x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" text-anchor="middle">' + c.length + '</text>';
      if (chart.length <= 8 || i % 2 === (chart.length % 2 === 0 ? 1 : 0)) {
        labels += '<text class="mlab" x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 5) + '" text-anchor="middle">' + esc(C.dateMD(c.start)) + '</text>';
      }
    }
    var ay = yOf(avg);
    return '<section class="card">' +
      '<div class="card-title">최근 주기 길이 <span class="sub">평균 ' + avg + '일</span></div>' +
      '<div class="chartwrap"><svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="최근 주기 길이 막대 그래프">' +
        '<defs><linearGradient id="gBar" x1="0" y1="0" x2="0" y2="1">' +
          '<stop offset="0%" stop-color="#FF8FA6"/><stop offset="100%" stop-color="#CB3050"/></linearGradient></defs>' +
        '<line class="axis" x1="' + padL + '" y1="' + (H - bottom) + '" x2="' + (W - padR) + '" y2="' + (H - bottom) + '"/>' +
        '<line class="avgl" x1="' + padL + '" y1="' + ay.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + ay.toFixed(1) + '"/>' +
        bars + labels +
      '</svg></div>' +
      '<div class="chart-note"><span>점선 = 평균 ' + avg + '일</span><span>가로축 = 생리 시작일</span></div>' +
      (h.recentAvg ? '<div class="tiny center" style="margin-top:6px">최근 ' + h.recentCount + '회 평균 <b>' + h.recentAvg + '일</b> · 전체 ' + h.validCycles + '회 평균 <b>' + avg + '일</b></div>' : '') +
      '</section>';
  }

  function viewHistory() {
    var h = C.history(S);
    var rows = h.rows;
    var list = '';
    for (var i = 0; i < Math.min(rows.length, 12); i++) {
      var r = rows[i];
      var cyc = r.cycle ? (r.cycle + '일 주기') : '첫 기록';
      list += '<button class="prow" data-act="goto-date" data-date="' + r.start + '" style="background:none;border-left:none;border-right:none;border-top:none;width:100%;text-align:left">' +
        '<span class="pdot"></span>' +
        '<span class="pmain"><b>' + esc(C.dateDot(r.start) + ' ~ ' + C.dateDot(r.end)) + '</b>' +
        '<small>' + r.span + '일' + (r.marked !== r.span ? ' (' + r.marked + '일 기록)' : '') + '</small></span>' +
        '<span class="pbadge ' + (r.cycle ? '' : 'gray') + '">' + cyc + '</span></button>';
    }
    var listCard = '<section class="card">' +
      '<div class="card-title">생리 기록 <span class="sub">' + h.episodes + '구간</span>' +
        '<button class="right" data-act="open-manage-sheet">관리</button></div>' +
      (list ? '<div class="plist">' + list + '</div>' :
        '<div class="emptynote"><span class="big">📝</span>아직 생리 기록이 없어요.</div>') +
      '<div class="spacer8"></div>' +
      '<button class="btn ghost rose block sm" data-act="open-manage-sheet">과거 생리 기록 추가 · 수정</button>' +
      '</section>';

    var stats = '<div class="statgrid">' +
      '<div class="stat"><div class="k">평균 주기</div><div class="v">' + h.avgCycle.value + '<small>일</small></div>' +
        '<div class="b">' + (h.avgCycle.basis === 'data' ? h.avgCycle.count + '회 평균' : '기본값') + '</div></div>' +
      '<div class="stat"><div class="k">평균 생리 기간</div><div class="v">' + h.avgPeriod.value + '<small>일</small></div>' +
        '<div class="b">' + (h.avgPeriod.basis === 'data' ? h.avgPeriod.count + '구간 평균' : '기본값') + '</div></div>' +
      '<div class="stat"><div class="k">기록 구간</div><div class="v">' + h.episodes + '<small>회</small></div>' +
        '<div class="b">주기 ' + h.validCycles + '회 측정</div></div>' +
      '</div>';

    var rangeCard = '';
    if (h.validCycles >= 2) {
      rangeCard = '<div class="tiny center" style="margin-top:8px">가장 짧은 주기 <b>' + h.shortest + '일</b> · 가장 긴 주기 <b>' + h.longest + '일</b></div>';
    }

    return stats + '<div class="spacer8"></div>' + chartHTML(h) + listCard + rangeCard;
  }

  /* ---------------- 설정 ---------------- */

  function stepperHTML(key, label, hint, min, max, unit) {
    var v = S.settings[key];
    return '<div class="setrow"><div class="setmain"><b>' + label + '</b><small>' + hint + '</small></div>' +
      '<div class="stepper">' +
        '<button data-act="step" data-key="' + key + '" data-d="-1" aria-label="줄이기">−</button>' +
        '<span class="val">' + v + '<small>' + unit + '</small></span>' +
        '<button data-act="step" data-key="' + key + '" data-d="1" aria-label="늘리기">+</button>' +
      '</div></div>';
  }

  function toggleHTML(key, label, hint, mint) {
    return '<div class="setrow"><div class="setmain"><b>' + label + '</b><small>' + hint + '</small></div>' +
      '<label class="switch' + (mint ? ' mint' : '') + '"><input type="checkbox" data-toggle="' + key + '"' +
      (S.settings[key] ? ' checked' : '') + '><i></i></label></div>';
  }

  function viewSettings() {
    var h = C.history(S);
    return '' +
      '<section class="card">' +
        '<div class="card-title">기본값 <span class="sub">기록이 쌓이면 실제 평균을 써요</span></div>' +
        stepperHTML('cycleLen', '평균 주기 길이', '마지막 생리 시작일에서 다음 시작일까지', 21, 45, '일') +
        stepperHTML('periodLen', '평균 생리 기간', '생리 시작일부터 마지막 날까지', 2, 10, '일') +
        '<div class="tiny" style="margin-top:6px">기록이 2구간 이상이면 실제 평균이 이 값을 대신해요. 설정값은 기록이 부족할 때 쓰여요.</div>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-title">캘린더에 표시</div>' +
        toggleHTML('showFertile', '가임기 표시', '배란 5일 전 ~ 배란 다음 날, 민트색', true) +
        toggleHTML('showOvulation', '배란 예정일 표시', '다음 생리 14일 전을 배란일로 계산', true) +
      '</section>' +

      '<section class="card">' +
        '<div class="card-title">기록</div>' +
        '<div class="setrow"><div class="setmain"><b>생리 기록 관리</b><small>여러 기간을 한 번에 추가·수정·삭제</small></div>' +
          '<button class="btn ghost sm rose" data-act="open-manage-sheet">열기</button></div>' +
        '<div class="setrow"><div class="setmain"><b>예시 데이터</b><small>화면을 미리 볼 수 있는 가상 기록이에요</small></div>' +
          '<button class="btn ghost sm" data-act="load-sample">넣어 보기</button></div>' +
        '<div class="setrow"><div class="setmain"><b>전체 초기화</b><small>이 기기의 모든 기록을 지워요</small></div>' +
          '<button class="btn ghost sm danger" data-act="reset-all">초기화</button></div>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-title">백업 · 가져오기 <span class="sub">JSON</span></div>' +
        '<div class="backupbtns">' +
          '<button class="btn ghost rose" data-act="export-json">내보내기</button>' +
          '<button class="btn ghost mint" data-act="import-json">불러오기</button>' +
        '</div>' +
        '<div class="info" style="margin-top:10px">' +
          '<b>내 백업</b>과 <b>Flo 등 다른 앱의 JSON</b>을 모두 읽을 수 있어요. ' +
          '다른 앱 파일은 periods · cycle_days · cycles 같은 여러 구조를 자동으로 찾아 생리 날짜만 옮겨요.<br>' +
          '불러올 때 <b>합치기</b>를 고르면 지금 기록은 그대로 두고 없는 날짜만 채워요.' +
        '</div>' +
      '</section>' +

      '<section class="card">' +
        '<div class="card-title">정보</div>' +
        '<div class="info">' +
          '기록 <b>' + h.episodes + '구간 · ' + C.countDays(S) + '일</b><br>' +
          '저장 위치 <b>이 브라우저 localStorage</b> (서버 전송 없음)<br>' +
          '버전 <b>1.0</b> · 아이폰은 사파리 공유 → <b>홈 화면에 추가</b>로 앱처럼 쓸 수 있어요.<br>' +
          '브라우저 데이터를 지우면 기록도 사라지니 가끔 내보내기로 백업해 주세요.' +
        '</div>' +
      '</section>';
  }

  /* ---------------- 렌더 ---------------- */

  function render() {
    if (!CAL) CAL = C.ymOf(today());
    renderHeader();
    var main = q('main');
    var scroll = G.scrollY;
    var html = TAB === 'today' ? viewToday() : TAB === 'calendar' ? viewCalendar() :
      TAB === 'history' ? viewHistory() : viewSettings();
    main.innerHTML = html;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].getAttribute('data-tab') === TAB);
    if (scroll) G.scrollTo(0, scroll);
  }

  /* ---------------- 시트 ---------------- */

  function openSheet(state) {
    SHEET = state;
    var root = q('sheetRoot');
    root.hidden = false;
    root.innerHTML = '<div class="sheet-bd" data-act="close-sheet"></div><div class="sheet" id="sheetPanel"></div>';
    renderSheet();
    G.requestAnimationFrame(function () { root.classList.add('open'); });
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    SHEET = null;
    var root = q('sheetRoot');
    root.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(function () {
      if (!SHEET) { root.hidden = true; root.innerHTML = ''; }
    }, 220);
  }

  function sheetHead(title, sub) {
    return '<div class="grab"></div><button class="close" data-act="close-sheet" aria-label="닫기">✕</button>' +
      '<h3>' + title + '</h3><div class="sub">' + sub + '</div>';
  }

  function daySummaryLine(date) {
    var sm = C.summary(S, date);
    var isP = C.isPeriodDay(S, date);
    var parts = [];
    var ps = C.periodsOf(S);
    var beforeFirst = ps.length && C.diffDays(date, ps[ps.length - 1].start) > 0;
    if (isP) parts.push('생리 ' + (C.diffDays(C.episodeAt(S, date).start, date) + 1) + '일째');
    else if (beforeFirst) parts.push('지난 날');
    else if (sm.kind !== 'empty') {
      var idx = C.predictIndex(S, C.addDays(date, -1), C.addDays(date, 1));
      var info = C.dayInfo(S, date, idx);
      if (info.pred) parts.push('생리 예정일');
      else if (info.ovu) parts.push('배란 예정일');
      else if (info.fertile) parts.push('가임기');
      else parts.push('생리 예정 ' + (sm.daysUntil === 0 ? '오늘' : dday(sm.daysUntil)));
    }
    var rec = C.dayRec(S, date);
    if (rec && (rec.symptoms || rec.moods)) parts.push('증상·기분 기록');
    if (!parts.length) parts.push('기록 없음');
    return esc(parts.join(' · '));
  }

  function sheetHTML() {
    var st = SHEET;
    if (!st) return '';
    if (st.type === 'day') {
      return sheetHead(esc(C.dateLabelKo(st.date)) + '', daySummaryLine(st.date)) +
        periodButtonsHTML(st.date) +
        controlsHTML(st.date) +
        '<div class="sheet-actions">' +
          '<button class="btn ghost danger" data-act="clear-day" data-date="' + st.date + '">이 날 기록 지우기</button>' +
          '<button class="btn primary" data-act="close-sheet">닫기</button>' +
        '</div>';
    }
    if (st.type === 'range') {
      var end = st.end || today();
      var start = st.start || C.addDays(end, -(C.avgPeriod(S).value - 1));
      return sheetHead('생리 기간 기록', '시작일과 종료일 사이가 모두 생리일이 돼요.') +
        '<div class="daterow">' +
          '<input type="date" id="rgStart" value="' + start + '" max="' + today() + '">' +
          '<span class="tilde">~</span>' +
          '<input type="date" id="rgEnd" value="' + end + '" max="' + today() + '">' +
        '</div>' +
        '<div class="spacer8"></div>' +
        '<div class="tiny">최근 3개월 기록을 한 번에 넣을 때도 이 화면을 여러 번 쓰면 돼요. 기록 관리에서는 여러 기간을 동시에 넣을 수 있어요.</div>' +
        '<div class="sheet-actions">' +
          '<button class="btn ghost" data-act="open-manage-sheet">여러 개 넣기</button>' +
          '<button class="btn primary" data-act="apply-range">기록하기</button>' +
        '</div>';
    }
    if (st.type === 'manage') {
      var eps = C.periodsOf(S).slice().reverse();
      var rows = '';
      for (var i = 0; i < eps.length; i++) {
        var ep = eps[i];
        rows += '<div class="eprow">' +
          '<input type="date" data-ep-start="' + ep.start + '" value="' + ep.start + '">' +
          '<span class="tilde">~</span>' +
          '<input type="date" data-ep-end="' + ep.start + '" value="' + ep.end + '">' +
          '<button class="del" data-act="delete-episode" data-start="' + ep.start + '" aria-label="이 구간 삭제">🗑</button>' +
          '</div>';
      }
      if (!eps.length) rows = '<div class="emptynote" style="padding:12px">아직 기록이 없어요. 아래에서 추가해 보세요.</div>';
      var nrs = '';
      for (var j = 0; j < NEWROWS.length; j++) {
        nrs += '<div class="newrow">' +
          '<input type="date" data-new-s="' + j + '" value="' + (NEWROWS[j].s || '') + '" max="' + today() + '">' +
          '<span class="tilde">~</span>' +
          '<input type="date" data-new-e="' + j + '" value="' + (NEWROWS[j].e || '') + '" max="' + today() + '">' +
          '<button class="rm" data-act="remove-row" data-i="' + j + '" aria-label="줄 삭제">×</button></div>';
      }
      return sheetHead('생리 기록 관리', '여러 기간을 한 번에 추가하거나 고칠 수 있어요.') +
        '<div class="flabel">기존 기록 <span class="hint">날짜를 바꾸면 바로 저장</span></div>' +
        rows +
        '<div class="divider"></div>' +
        '<div class="flabel">새 기록 <span class="hint">시작일 ~ 종료일</span></div>' +
        nrs +
        '<button class="btn ghost sm mint" data-act="add-row">+ 기간 추가</button>' +
        '<div class="sheet-actions">' +
          '<button class="btn ghost" data-act="close-sheet">닫기</button>' +
          '<button class="btn primary" data-act="save-new-rows" ' + (NEWROWS.length ? '' : 'disabled') + '>새 기간 저장</button>' +
        '</div>';
    }
    if (st.type === 'import') {
      var p = st.pending;
      var w = '';
      if (p.warnings && p.warnings.length) {
        w = '<div class="info" style="color:var(--amber);margin-top:8px">' + p.warnings.map(esc).join('<br>') + '</div>';
      }
      var desc = p.source === 'my-cycle'
        ? '내 백업 파일 · ' + p.periods + '개 구간 · ' + p.days + '일'
        : '다른 앱 기록 · ' + p.periods + '개 구간 · ' + p.days + '일';
      return sheetHead('기록을 불러올까요?', esc(desc)) +
        '<div class="info">' +
          (p.source === 'my-cycle'
            ? '내보낸 설정과 하루 기록까지 그대로 복원해요.'
            : '찾아낸 생리 날짜와 하루 기록만 옮겨요. 화면에 보이는 것과 같은지 한 번 확인해 주세요.') +
        '</div>' + w +
        '<div class="spacer8"></div>' +
        '<div class="info"><b>합치기</b>는 지금 기록을 두고 겹치지 않는 날짜만 더해요. <b>덮어쓰기</b>는 지금 기록을 모두 바꿔요.</div>' +
        '<div class="sheet-actions">' +
          '<button class="btn ghost" data-act="apply-import" data-mode="replace">덮어쓰기</button>' +
          '<button class="btn primary" data-act="apply-import" data-mode="merge">합치기</button>' +
        '</div>';
    }
    if (st.type === 'confirm') {
      return sheetHead(esc(st.title), esc(st.text || '')) +
        '<div class="sheet-actions">' +
          '<button class="btn ghost" data-act="close-sheet">취소</button>' +
          '<button class="btn ' + (st.danger ? 'danger' : 'primary') + '" data-act="confirm-yes">' + esc(st.ok || '확인') + '</button>' +
        '</div>';
    }
    return '';
  }

  function renderSheet(keepScroll) {
    var panel = q('sheetPanel');
    if (!panel) return;
    var top = keepScroll ? panel.scrollTop : 0;
    panel.innerHTML = sheetHTML();
    if (keepScroll) panel.scrollTop = top;
  }

  /* ---------------- 동작 ---------------- */

  function markStart(date) {
    C.setPeriod(S, date, true);
    if (!C.dayRec(S, date).flow) C.setFlow(S, date, 'medium');
  }

  function openDay(date) {
    openSheet({ type: 'day', date: date });
  }

  function gotoDate(date) {
    CAL = C.ymOf(date);
    SEL = date;
    TAB = 'calendar';
    render();
    G.scrollTo(0, 0);
    openDay(date);
  }

  function handleAct(act, el) {
    var date = el.getAttribute('data-date') || today();
    switch (act) {
      case 'tab':
        TAB = el.getAttribute('data-tab');
        if (TAB === 'calendar' && !CAL) CAL = C.ymOf(today());
        render();
        G.scrollTo(0, 0);
        break;
      case 'start-period':
        apply(function () { markStart(date); }, '생리 시작을 기록했어요');
        break;
      case 'start-yesterday':
        apply(function () {
          C.setPeriod(S, C.addDays(date, -1), true);
          markStart(date);
        }, '어제부터 생리로 기록했어요');
        break;
      case 'end-period':
        apply(function () { C.endPeriodAt(S, date); }, '생리 종료로 기록했어요');
        break;
      case 'unset-period':
        apply(function () { C.setPeriod(S, date, false); }, '이 날을 생리 아님으로 바꿨어요');
        break;
      case 'flow':
        (function () {
          var f = el.getAttribute('data-flow');
          var cur = (C.dayRec(S, date) || {}).flow;
          apply(function () { C.setFlow(S, date, cur === f ? null : f); });
        })();
        break;
      case 'symptoms':
        apply(function () { C.toggleSymptom(S, date, el.getAttribute('data-k')); });
        break;
      case 'moods':
        apply(function () { C.toggleMood(S, date, el.getAttribute('data-k')); });
        break;
      case 'discharge':
        (function () {
          var k = el.getAttribute('data-k');
          var cur = (C.dayRec(S, date) || {}).discharge;
          apply(function () { C.setDischarge(S, date, cur === k ? null : k); });
        })();
        break;
      case 'clear-day':
        openSheet({
          type: 'confirm', title: '이 날 기록을 지울까요?',
          text: C.dateLabelKo(date) + '의 생리·증상·메모가 모두 사라져요.',
          ok: '지우기', danger: true, back: { type: 'day', date: date },
          then: function () { C.clearDay(S, date); save(); render(); }
        });
        break;
      case 'open-day':
        openDay(date);
        break;
      case 'close-sheet':
        if (SHEET && SHEET.back) {
          var back = SHEET.back;
          openSheet(back);
        } else closeSheet();
        break;
      case 'month':
        CAL = C.addMonths(CAL || C.ymOf(today()), +el.getAttribute('data-d'));
        SEL = null;
        render();
        break;
      case 'go-today':
        CAL = C.ymOf(today());
        SEL = today();
        render();
        break;
      case 'goto-date':
        gotoDate(date);
        break;
      case 'open-range-sheet':
        openSheet({ type: 'range' });
        break;
      case 'apply-range':
        (function () {
          var s = (q('rgStart') || {}).value, e2 = (q('rgEnd') || {}).value;
          if (!C.validDate(s) || !C.validDate(e2)) { toast('시작일과 종료일을 골라 주세요'); return; }
          if (C.diffDays(s, e2) < 0) { toast('종료일이 시작일보다 빨라요'); return; }
          if (C.diffDays(s, e2) > 30) { toast('한 번에 30일까지만 기록할 수 있어요'); return; }
          apply(function () {
            C.markPeriodRange(S, s, e2);
            CAL = C.ymOf(s); SEL = s; TAB = 'calendar';
          }, (C.diffDays(s, e2) + 1) + '일을 생리로 기록했어요');
          closeSheet();
        })();
        break;
      case 'open-manage-sheet':
        if (!NEWROWS.length) NEWROWS = [{ s: '', e: '' }];
        openSheet({ type: 'manage' });
        break;
      case 'add-row':
        NEWROWS.push({ s: '', e: '' });
        renderSheet(true);
        break;
      case 'remove-row':
        NEWROWS.splice(+el.getAttribute('data-i'), 1);
        renderSheet(true);
        break;
      case 'save-new-rows':
        (function () {
          var ok = 0, bad = 0;
          NEWROWS.forEach(function (r) {
            if (!r.s && !r.e) return;
            if (!C.validDate(r.s) || !C.validDate(r.e)) { bad++; return; }
            if (C.diffDays(r.s, r.e) < 0) { bad++; return; }
            C.markPeriodRange(S, r.s, r.e);
            ok++;
          });
          NEWROWS = [{ s: '', e: '' }];
          save();
          render();
          renderSheet(true);
          toast(ok ? ok + '개 기간을 저장했어요' + (bad ? ' (' + bad + '개는 날짜 확인)' : '') : '날짜를 확인해 주세요');
        })();
        break;
      case 'delete-episode':
        (function () {
          var start = el.getAttribute('data-start');
          var ep = C.episodeAt(S, start);
          if (ep) C.clearPeriodFlags(S, ep);
          save(); render(); renderSheet(true);
          toast('구간을 지웠어요');
        })();
        break;
      case 'step':
        (function () {
          var key = el.getAttribute('data-key');
          var d = +el.getAttribute('data-d');
          var lo = key === 'cycleLen' ? C.CYCLE_MIN : C.PERIOD_MIN;
          var hi = key === 'cycleLen' ? C.CYCLE_MAX : C.PERIOD_MAX;
          S.settings[key] = Math.max(lo, Math.min(hi, S.settings[key] + d));
          save(); render();
        })();
        break;
      case 'export-json':
        exportJSON();
        break;
      case 'import-json':
        q('fileJSON').click();
        break;
      case 'apply-import':
        (function () {
          if (!PENDING) return;
          var mode = el.getAttribute('data-mode');
          var imp = PENDING.state;
          S = mode === 'merge' ? C.mergeStates(S, imp) : imp;
          PENDING = null;
          save(); render(); closeSheet();
          toast(mode === 'merge' ? '기록을 합쳤어요' : '기록을 불러왔어요');
        })();
        break;
      case 'load-sample':
        openSheet({
          type: 'confirm', title: '예시 데이터를 넣을까요?',
          text: '가상의 생리 기록 5구간이 더해져요. 설정에서 언제든 초기화할 수 있어요.',
          ok: '넣기',
          then: function () {
            S = C.mergeStates(S, C.sampleState(today()));
            save(); render();
            toast('예시 데이터를 넣었어요');
          }
        });
        break;
      case 'reset-all':
        openSheet({
          type: 'confirm', title: '모든 기록을 지울까요?',
          text: '이 기기의 생리 기록·증상·메모·설정이 모두 사라져요. 되돌릴 수 없어요.',
          ok: '전체 초기화', danger: true,
          then: function () {
            S = C.freshState();
            CAL = C.ymOf(today()); SEL = null; TAB = 'today';
            save(); render();
            toast('모든 기록을 지웠어요');
          }
        });
        break;
      case 'confirm-yes':
        (function () {
          var then = SHEET && SHEET.then;
          closeSheet();
          if (then) then();
        })();
        break;
      default:
        break;
    }
  }

  function exportJSON() {
    var txt = C.exportJSON(S);
    var blob = new Blob([txt], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'my-cycle-backup-' + today() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
      a.parentNode && a.parentNode.removeChild(a);
    }, 1500);
    toast('백업 파일을 내려받았어요');
  }

  function readImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var res = C.parseImport(String(reader.result || ''));
      if (!res.ok) { toast(res.error || '불러오지 못했어요'); return; }
      PENDING = res;
      openSheet({ type: 'import', pending: res });
    };
    reader.onerror = function () { toast('파일을 읽지 못했어요'); };
    reader.readAsText(file);
  }

  /* ---------------- 이벤트 ---------------- */

  function bind() {
    document.addEventListener('click', function (e) {
      var t = e.target;
      while (t && t !== document && !(t.getAttribute && (t.getAttribute('data-act') || t.getAttribute('data-tab')))) {
        t = t.parentNode;
      }
      if (!t || t === document) return;
      if (t.getAttribute && t.getAttribute('data-tab')) {
        handleAct('tab', t);
        return;
      }
      var act = t.getAttribute('data-act');
      if (act) {
        e.preventDefault();
        handleAct(act, t);
      }
    });

    document.addEventListener('input', function (e) {
      var t = e.target;
      if (t && t.getAttribute && t.getAttribute('data-memo')) {
        var date = t.getAttribute('data-memo');
        C.setMemo(S, date, t.value);
        saveSoon();
        var cnt = t.parentNode.querySelector('.memocnt');
        if (cnt) cnt.textContent = t.value.length;
      }
      if (t && t.getAttribute && t.getAttribute('data-new-s') != null) {
        NEWROWS[+t.getAttribute('data-new-s')].s = t.value;
      }
      if (t && t.getAttribute && t.getAttribute('data-new-e') != null) {
        NEWROWS[+t.getAttribute('data-new-e')].e = t.value;
      }
    });

    document.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      if (t.getAttribute('data-toggle')) {
        var key = t.getAttribute('data-toggle');
        S.settings[key] = !!t.checked;
        save(); render();
        return;
      }
      if (t.getAttribute('data-ep-start') || t.getAttribute('data-ep-end')) {
        var oldStart = t.getAttribute('data-ep-start') || t.getAttribute('data-ep-end');
        var row = t.parentNode;
        var inputs = row.querySelectorAll('input');
        var s = inputs[0].value, en = inputs[1].value;
        if (!C.validDate(s) || !C.validDate(en)) return;
        if (C.diffDays(s, en) < 0) { toast('종료일이 시작일보다 빨라요'); renderSheet(true); return; }
        if (C.diffDays(s, en) > 30) { toast('한 구간은 30일까지만 가능해요'); renderSheet(true); return; }
        C.replaceEpisode(S, oldStart, s, en);
        save(); render(); renderSheet(true);
        toast('기간을 수정했어요');
      }
      if (t.getAttribute('id') === 'rgStart' || t.getAttribute('id') === 'rgEnd') {
        if (SHEET && SHEET.type === 'range') {
          SHEET.start = (q('rgStart') || {}).value;
          SHEET.end = (q('rgEnd') || {}).value;
        }
      }
    });

    q('fileJSON').addEventListener('change', function () {
      var f = this.files && this.files[0];
      readImportFile(f);
      this.value = '';
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && SHEET) closeSheet();
    });

    G.addEventListener('scroll', function () {
      var hdr = q('hdr');
      if (hdr) hdr.classList.toggle('shadow', G.scrollY > 2);
    }, { passive: true });

    // 캘린더 좌우 스와이프
    var sx = null, sy = null;
    var main = q('main');
    main.addEventListener('touchstart', function (e) {
      if (TAB !== 'calendar' || !e.touches[0]) return;
      sx = e.touches[0].clientX;
      sy = e.touches[0].clientY;
    }, { passive: true });
    main.addEventListener('touchend', function (e) {
      if (TAB !== 'calendar' || sx == null || !e.changedTouches[0]) return;
      var dx = e.changedTouches[0].clientX - sx;
      var dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        CAL = C.addMonths(CAL || C.ymOf(today()), dx < 0 ? 1 : -1);
        SEL = null;
        render();
      }
      sx = null; sy = null;
    }, { passive: true });
  }

  /* ---------------- 시작 ---------------- */

  function boot() {
    S = load();
    CAL = C.ymOf(today());
    bind();
    render();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    }
    G.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveNow();
    });
  }

  G.CycleApp = { boot: boot, _state: function () { return S; } };
})();
