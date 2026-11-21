/* core.js — 나의 생리 캘린더: 주기 계산 · 데이터 로직 (DOM 없음, 테스트 가능)
   · 모든 기록은 날짜별 하루 기록(days)으로 저장하고, 연속된 생리일은 "생리 구간"으로 묶습니다.
   · 하루를 빠뜨려도 같은 생리로 보도록 간격 1일까지 병합합니다(MERGE_GAP).
   · 평균 주기/생리 기간은 기록이 2구간 이상일 때 실제 값, 그 전에는 설정 기본값을 씁니다.
   · 배란일 = 다음 생리 예정일 − 14일, 가임기 = 배란일 5일 전 ~ 배란 다음 날. */
(function (root) {
  'use strict';

  var SCHEMA = 1;
  var STORE_KEY = 'mycycle-v1';

  var MERGE_GAP = 1;        // 생리일 사이에 비어 있는 날 허용 (1일)
  var MIN_CYCLE = 15;       // 평균 계산에 넣는 주기 길이 범위(일)
  var MAX_CYCLE = 60;
  var MAX_SPAN = 14;        // 평균 생리 기간에 넣는 구간 길이 상한(일)
  var LUTEAL = 14;          // 배란일 = 다음 생리 예정일 − 14일
  var FERTILE_BEFORE = 5;   // 가임기 = 배란 5일 전부터
  var FERTILE_AFTER = 1;    // 배란 다음 날까지 (배란일 -5 ~ +1)
  var PREDICT_CYCLES = 24;  // 앞으로 예측해 두는 주기 수(약 2년)

  var CYCLE_MIN = 21, CYCLE_MAX = 45;
  var PERIOD_MIN = 2, PERIOD_MAX = 10;

  var FLOWS = [
    { k: 'light', t: '적음', dots: 1 },
    { k: 'medium', t: '보통', dots: 2 },
    { k: 'heavy', t: '많음', dots: 3 }
  ];

  var SYMPTOMS = [
    { k: 'cramps', t: '복통', e: '🌀' },
    { k: 'headache', t: '두통', e: '🤕' },
    { k: 'backache', t: '요통', e: '🦴' },
    { k: 'bloating', t: '부종', e: '🎈' },
    { k: 'fatigue', t: '피로', e: '🥱' },
    { k: 'acne', t: '여드름', e: '🔴' },
    { k: 'appetite', t: '식욕변화', e: '🍫' },
    { k: 'breast', t: '가슴통증', e: '💗' },
    { k: 'nausea', t: '메스꺼움', e: '🤢' },
    { k: 'dizzy', t: '어지럼', e: '💫' },
    { k: 'insomnia', t: '불면', e: '🌙' },
    { k: 'constipation', t: '변비', e: '🚽' }
  ];

  var MOODS = [
    { k: 'calm', t: '평온', e: '🍵' },
    { k: 'happy', t: '행복', e: '😊' },
    { k: 'sensitive', t: '예민', e: '🌶️' },
    { k: 'low', t: '우울', e: '🌧️' },
    { k: 'anxious', t: '불안', e: '😰' },
    { k: 'tired', t: '피곤', e: '😪' },
    { k: 'irritable', t: '짜증', e: '💢' },
    { k: 'energetic', t: '활기', e: '⚡' }
  ];

  var DISCHARGE = [
    { k: 'none', t: '없음' },
    { k: 'dry', t: '건조' },
    { k: 'sticky', t: '끈적' },
    { k: 'creamy', t: '크림색' },
    { k: 'clear', t: '투명' },
    { k: 'watery', t: '물처럼' }
  ];

  var DOW = ['일', '월', '화', '수', '목', '금', '토'];

  /* ---------------- 숫자 · 날짜 도우미 ---------------- */

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function clampInt(v, lo, hi, def) {
    var n = Math.round(Number(v));
    if (!isFinite(n)) return def;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function todayISO(d) {
    var t = d || new Date();
    return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
  }

  function validDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10);
    if (m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(y, m - 1, d, 12);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }

  /* 날짜 문자열 → 그날 정오(서머타임 영향 없음) */
  function parseISO(s) {
    var p = String(s).split('-');
    return new Date(+p[0], (+p[1]) - 1, +p[2], 12);
  }

  function isoOf(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(s, n) {
    var d = parseISO(s);
    d.setDate(d.getDate() + (Number(n) || 0));
    return isoOf(d);
  }

  /* a → b 까지의 일수 (b가 미래면 양수) */
  function diffDays(a, b) {
    return Math.round((parseISO(b) - parseISO(a)) / 86400000);
  }

  function dowOf(s) { return parseISO(s).getDay(); }

  function ymOf(s) { return String(s).slice(0, 7); }

  function addMonths(ym, delta) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var d = new Date(y, m - 1 + delta, 1, 12);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function daysInMonth(ym) {
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    return new Date(y, m, 0, 12).getDate();
  }

  function monthEnd(ym) { return ym + '-' + pad2(daysInMonth(ym)); }

  function monthLabel(ym) { return (+ym.slice(0, 4)) + '년 ' + (+ym.slice(5, 7)) + '월'; }

  function monthLabelShort(ym) { return (+ym.slice(5, 7)) + '월'; }

  /* 11월 22일 (일) */
  function dateLabelKo(s) {
    if (!validDate(s)) return '';
    return (+s.slice(5, 7)) + '월 ' + (+s.slice(8, 10)) + '일 (' + DOW[dowOf(s)] + ')';
  }

  /* 2026.11.22 */
  function dateDot(s) {
    return s ? s.slice(0, 4) + '.' + s.slice(5, 7) + '.' + s.slice(8, 10) : '';
  }

  /* 11.22 */
  function dateMD(s) {
    return s ? (+s.slice(5, 7)) + '.' + (+s.slice(8, 10)) : '';
  }

  /* 11/22 — 구간 강조용 */
  function dateSlash(s) {
    return s ? (+s.slice(5, 7)) + '/' + (+s.slice(8, 10)) : '';
  }

  /* 11/28 ~ 12/2 : 가임기·예정일 구간을 한눈에 */
  function rangeLabel(start, end) {
    if (!validDate(start) || !validDate(end)) return '';
    if (start === end) return dateSlash(start);
    return dateSlash(start) + ' ~ ' + dateSlash(end);
  }

  /* 11/28 ~ 12/2 (6일) */
  function rangeLabelDays(start, end) {
    if (!validDate(start) || !validDate(end)) return '';
    return rangeLabel(start, end) + ' (' + (diffDays(start, end) + 1) + '일)';
  }

  /* 달력 격자: 일요일 시작, 5~6주 */
  function monthGrid(ym) {
    var first = ym + '-01';
    var lead = dowOf(first);
    var total = lead + daysInMonth(ym);
    var rows = Math.ceil(total / 7);
    var cells = [];
    var i;
    for (i = 0; i < rows * 7; i++) {
      var dayNum = i - lead + 1;
      var date = addDays(first, dayNum - 1);
      cells.push({
        date: date,
        day: +date.slice(8, 10),
        inMonth: ymOf(date) === ym,
        dow: dowOf(date)
      });
    }
    return cells;
  }

  function uid(p) {
    return (p || 'd') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* ---------------- 상태 ---------------- */

  function freshState() {
    return {
      v: SCHEMA,
      settings: {
        cycleLen: 28,
        periodLen: 5,
        showFertile: true,
        showOvulation: true
      },
      days: {}
    };
  }

  function normSettings(raw) {
    var s = freshState().settings;
    if (!raw || typeof raw !== 'object') return s;
    s.cycleLen = clampInt(raw.cycleLen, CYCLE_MIN, CYCLE_MAX, 28);
    s.periodLen = clampInt(raw.periodLen, PERIOD_MIN, PERIOD_MAX, 5);
    if (raw.showFertile === false) s.showFertile = false;
    if (raw.showOvulation === false) s.showOvulation = false;
    return s;
  }

  function knownKeys(list) {
    var m = {};
    for (var i = 0; i < list.length; i++) m[list[i].k] = 1;
    return m;
  }
  var SYM_MAP = knownKeys(SYMPTOMS);
  var MOOD_MAP = knownKeys(MOODS);
  var FLOW_MAP = knownKeys(FLOWS);
  var DIS_MAP = knownKeys(DISCHARGE);

  function cleanKeys(arr, map, max) {
    var out = [], seen = {};
    if (!Array.isArray(arr)) return out;
    for (var i = 0; i < arr.length; i++) {
      var k = String(arr[i] == null ? '' : arr[i]);
      if (map[k] && !seen[k]) { seen[k] = 1; out.push(k); }
      if (out.length >= (max || 12)) break;
    }
    return out;
  }

  function cleanText(v, max) {
    if (typeof v !== 'string') return '';
    var t = v.replace(/\r\n/g, '\n').replace(/\s+$/, '');
    return t.length > max ? t.slice(0, max) : t;
  }

  function cleanDay(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var d = {};
    if (raw.period) d.period = 1;
    if (FLOW_MAP[raw.flow]) { d.flow = raw.flow; d.period = 1; }
    var sym = cleanKeys(raw.symptoms, SYM_MAP);
    if (sym.length) d.symptoms = sym;
    var mood = cleanKeys(raw.moods, MOOD_MAP);
    if (mood.length) d.moods = mood;
    if (DIS_MAP[raw.discharge]) d.discharge = raw.discharge;
    var memo = cleanText(raw.memo, 500);
    if (memo) d.memo = memo;
    return Object.keys(d).length ? d : null;
  }

  function normalizeState(raw) {
    var st = freshState();
    if (!raw || typeof raw !== 'object') return st;
    st.settings = normSettings(raw.settings);
    var days = raw.days && typeof raw.days === 'object' ? raw.days : null;
    if (days) {
      Object.keys(days).forEach(function (k) {
        if (!validDate(k)) return;
        var d = cleanDay(days[k]);
        if (d) st.days[k] = d;
      });
    }
    return st;
  }

  function dayRec(st, date) {
    return (st && st.days && st.days[date]) || null;
  }

  function isPeriodDay(st, date) {
    var r = dayRec(st, date);
    return !!(r && r.period);
  }

  function hasAnyData(st) {
    return !!(st && st.days && Object.keys(st.days).length);
  }

  /* ---------------- 하루 기록 쓰기 ---------------- */

  function ensureDay(st, date) {
    if (!validDate(date)) return null;
    if (!st.days) st.days = {};
    if (!st.days[date]) st.days[date] = {};
    return st.days[date];
  }

  function pruneDay(st, date) {
    var r = st.days[date];
    if (r && !Object.keys(r).length) delete st.days[date];
  }

  function setDayField(st, date, field, value) {
    if (!validDate(date)) return null;
    var r = ensureDay(st, date);
    if (value === '' || value === null || value === undefined) delete r[field];
    else r[field] = value;
    pruneDay(st, date);
    return dayRec(st, date);
  }

  /* 생리일 켜기/끄기 */
  function setPeriod(st, date, on) {
    if (!validDate(date)) return;
    if (on) {
      var r = ensureDay(st, date);
      r.period = 1;
    } else if (st.days && st.days[date]) {
      delete st.days[date].period;
      delete st.days[date].flow;
      pruneDay(st, date);
    }
  }

  /* 출혈량 — 기록하면 그날은 생리일이 됩니다 */
  function setFlow(st, date, flow) {
    if (!validDate(date)) return;
    if (!flow) {
      setDayField(st, date, 'flow', null);
      return;
    }
    if (!FLOW_MAP[flow]) return;
    var r = ensureDay(st, date);
    r.flow = flow;
    r.period = 1;
  }

  function toggleKey(st, date, field, key, map) {
    if (!validDate(date) || !map[key]) return;
    var r = ensureDay(st, date);
    var arr = Array.isArray(r[field]) ? r[field].slice() : [];
    var i = arr.indexOf(key);
    if (i >= 0) arr.splice(i, 1); else arr.push(key);
    if (arr.length) r[field] = arr;
    else delete r[field];
    pruneDay(st, date);
    return dayRec(st, date);
  }

  function toggleSymptom(st, date, key) { return toggleKey(st, date, 'symptoms', key, SYM_MAP); }
  function toggleMood(st, date, key) { return toggleKey(st, date, 'moods', key, MOOD_MAP); }

  function setDischarge(st, date, key) {
    if (key && !DIS_MAP[key]) return;
    setDayField(st, date, 'discharge', key || null);
  }

  function setMemo(st, date, text) {
    setDayField(st, date, 'memo', cleanText(text, 500));
  }

  function clearDay(st, date) {
    if (st.days && st.days[date]) delete st.days[date];
  }

  /* 시작일~종료일을 한 번에 생리일로 */
  function markPeriodRange(st, start, end) {
    if (!validDate(start) || !validDate(end)) return 0;
    if (diffDays(start, end) < 0) { var t = start; start = end; end = t; }
    var n = diffDays(start, end);
    if (n > 60) return 0;
    var count = 0;
    for (var i = 0; i <= n; i++) {
      var d = addDays(start, i);
      ensureDay(st, d).period = 1;
      count++;
    }
    return count;
  }

  /* 그 구간의 마지막 생리일을 date로 (이후 날짜는 생리 아님으로) */
  function endPeriodAt(st, date) {
    if (!validDate(date)) return;
    var ep = episodeAt(st, date);
    if (!ep) { setPeriod(st, date, true); return; }
    var all = episodeDays(st, ep);
    for (var i = 0; i < all.length; i++) {
      if (diffDays(date, all[i]) > 0) setPeriod(st, all[i], false);
    }
    ensureDay(st, date).period = 1;
  }

  function clearPeriodFlags(st, ep) {
    var all = episodeDays(st, ep);
    for (var i = 0; i < all.length; i++) {
      var d = all[i];
      if (st.days[d]) {
        delete st.days[d].period;
        delete st.days[d].flow;
        pruneDay(st, d);
      }
    }
  }

  /* ---------------- 생리 구간 ---------------- */

  function episodeDays(st, ep) {
    // 구간에 표시된 날짜 전부(빈 날 포함)
    var out = [], n = diffDays(ep.start, ep.end);
    for (var i = 0; i <= n; i++) out.push(addDays(ep.start, i));
    return out;
  }

  /* 날짜별 생리일을 연속 구간으로 묶는다 (간격 MERGE_GAP일까지 병합) */
  function periodsOf(st) {
    var dates = [];
    if (st && st.days) {
      Object.keys(st.days).forEach(function (k) {
        if (st.days[k] && st.days[k].period && validDate(k)) dates.push(k);
      });
    }
    dates.sort();
    var out = [];
    var cur = null;
    for (var i = 0; i < dates.length; i++) {
      var d = dates[i];
      if (!cur) {
        cur = { start: d, end: d, marked: 1 };
      } else {
        var gap = diffDays(cur.end, d);
        if (gap <= 1 + MERGE_GAP) {
          cur.end = d;
          cur.marked += 1;
        } else {
          out.push(cur);
          cur = { start: d, end: d, marked: 1 };
        }
      }
    }
    if (cur) out.push(cur);
    out.forEach(function (ep) { ep.span = diffDays(ep.start, ep.end) + 1; });
    return out;
  }

  function episodeAt(st, date) {
    var ps = periodsOf(st);
    for (var i = 0; i < ps.length; i++) {
      if (diffDays(ps[i].start, date) >= 0 && diffDays(date, ps[i].end) >= 0) return ps[i];
    }
    return null;
  }

  /* 구간별 주기 길이 (이전 생리 시작일과의 차이) */
  function cycleLengths(st) {
    var ps = periodsOf(st), out = [];
    for (var i = 1; i < ps.length; i++) {
      var len = diffDays(ps[i - 1].start, ps[i].start);
      out.push({
        start: ps[i].start,
        prevStart: ps[i - 1].start,
        length: len,
        valid: len >= MIN_CYCLE && len <= MAX_CYCLE
      });
    }
    return out;
  }

  function mean(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return arr.length ? s / arr.length : 0;
  }

  /* 평균 주기: 기록 2구간 이상 + 정상 범위 주기가 있을 때 실제 평균 */
  function avgCycle(st) {
    var def = st && st.settings ? normSettings(st.settings).cycleLen : 28;
    var ps = periodsOf(st);
    var lens = [];
    cycleLengths(st).forEach(function (c) { if (c.valid) lens.push(c.length); });
    if (ps.length >= 2 && lens.length) {
      return { value: Math.round(mean(lens)), basis: 'data', count: lens.length, def: def, raw: mean(lens) };
    }
    return { value: def, basis: 'default', count: lens.length, def: def, raw: 0 };
  }

  /* 평균 생리 기간: 기록 2구간 이상 + 정상 범위 구간일 때 실제 평균 */
  function avgPeriod(st) {
    var def = st && st.settings ? normSettings(st.settings).periodLen : 5;
    var ps = periodsOf(st);
    var spans = [];
    ps.forEach(function (ep) { if (ep.span >= 1 && ep.span <= MAX_SPAN) spans.push(ep.span); });
    if (ps.length >= 2 && spans.length) {
      return { value: Math.max(1, Math.round(mean(spans))), basis: 'data', count: spans.length, def: def, raw: mean(spans) };
    }
    return { value: def, basis: 'default', count: spans.length, def: def, raw: 0 };
  }

  /* ---------------- 예측 ---------------- */

  function nextPeriod(st, today) {
    var ps = periodsOf(st);
    if (!ps.length) return null;
    var t = validDate(today) ? today : todayISO();
    var cyc = avgCycle(st).value;
    var plen = avgPeriod(st).value;
    var last = ps[ps.length - 1];
    var k = 1;
    var start = addDays(last.start, cyc);
    // 예정 구간이 이미 완전히 지나 버렸으면 다음 주기로 넘긴다 (기록을 잊은 경우)
    while (diffDays(t, addDays(start, Math.max(0, plen - 1))) < 0 && k < PREDICT_CYCLES) {
      k++;
      start = addDays(last.start, cyc * k);
    }
    return {
      start: start,
      end: addDays(start, plen - 1),
      daysUntil: diffDays(t, start),
      cycleNo: k,
      lastStart: last.start,
      lastEnd: last.end
    };
  }

  /* 오늘 기준 요약 */
  function summary(st, today) {
    var t = validDate(today) ? today : todayISO();
    var ps = periodsOf(st);
    var ac = avgCycle(st), ap = avgPeriod(st);
    var cyc = ac.value, plen = ap.value;
    var cur = episodeAt(st, t);
    var next = nextPeriod(st, t);

    var ovu = null, fertileStart = null, fertileEnd = null, inFertile = false, inOvu = false, daysToOvu = null;
    if (next) {
      ovu = addDays(next.start, -LUTEAL);
      var lastEnd = ps[ps.length - 1].end;
      if (diffDays(lastEnd, ovu) <= 0) ovu = addDays(ovu, cyc); // 생리 중/직후면 다음 주기 배란
      while (diffDays(t, ovu) < 0) ovu = addDays(ovu, cyc);
      fertileStart = addDays(ovu, -FERTILE_BEFORE);
      fertileEnd = addDays(ovu, FERTILE_AFTER);
      inFertile = diffDays(fertileStart, t) >= 0 && diffDays(t, fertileEnd) >= 0;
      inOvu = t === ovu;
      daysToOvu = diffDays(t, ovu);
      // 배란 다음 날(+1)까지는 지난 창에 들어 있다 (달력 표시와 같은 기준)
      if (!inFertile) {
        var prevOvu = addDays(ovu, -cyc);
        if (diffDays(lastEnd, prevOvu) > 0) {
          var pf = addDays(prevOvu, -FERTILE_BEFORE), pe = addDays(prevOvu, FERTILE_AFTER);
          if (diffDays(pf, t) >= 0 && diffDays(t, pe) >= 0) {
            inFertile = true;
            fertileStart = pf;
            fertileEnd = pe;
          }
        }
      }
    }

    var cycleDay = null;
    if (ps.length && diffDays(ps[ps.length - 1].start, t) >= 0) {
      cycleDay = diffDays(ps[ps.length - 1].start, t) + 1;
    }

    var kind, dayNo = null, daysUntil = next ? next.daysUntil : null;
    if (cur) {
      kind = 'period';
      dayNo = diffDays(cur.start, t) + 1;
    } else if (!next) {
      kind = 'empty';
    } else if (daysUntil === 0) {
      kind = 'due';
    } else if (daysUntil > 0) {
      kind = 'waiting';
    } else {
      kind = 'late';
    }

    return {
      today: t,
      kind: kind,
      period: cur,
      periodDay: dayNo,
      cycleDay: cycleDay,
      next: next,
      daysUntil: daysUntil,
      lateDays: daysUntil === null ? null : (daysUntil < 0 ? -daysUntil : 0),
      ovulation: ovu,
      fertileStart: fertileStart,
      fertileEnd: fertileEnd,
      inFertile: inFertile,
      inOvulation: inOvu,
      daysToOvulation: daysToOvu,
      cycleLen: cyc,
      periodLen: plen,
      cycleBasis: ac.basis,
      periodBasis: ap.basis,
      cycleCount: ac.count,
      periodCount: ap.count,
      episodes: ps.length,
      progress: cyc > 0 ? Math.min(1, Math.max(0, ((cycleDay || 1) - 1) / cyc)) : 0
    };
  }

  /* 달력에 칠할 예측 표시: date -> {pred, fertile, ovu} */
  function predictIndex(st, from, to) {
    var out = {};
    var ps = periodsOf(st);
    if (!ps.length) return out;
    var cyc = avgCycle(st).value;
    var plen = avgPeriod(st).value;
    var last = ps[ps.length - 1];

    function mark(d, flag) {
      if (!validDate(d)) return;
      if (from && diffDays(from, d) < 0) return;
      if (to && diffDays(d, to) < 0) return;
      if (!out[d]) out[d] = {};
      out[d][flag] = 1;
    }

    for (var k = 1; k <= PREDICT_CYCLES; k++) {
      var start = addDays(last.start, cyc * k);
      if (to && diffDays(to, start) > 0) break;   // start > to
      for (var i = 0; i < plen; i++) mark(addDays(start, i), 'pred');
      var ovu = addDays(start, -LUTEAL);
      if (diffDays(last.end, ovu) > 0) {
        for (var j = FERTILE_BEFORE; j >= -FERTILE_AFTER; j--) {
          mark(addDays(ovu, -j), j === 0 ? 'ovu' : 'fertile');
        }
      }
    }
    return out;
  }

  /* 달력 한 날의 표시 상태 */
  function dayInfo(st, date, idx) {
    var rec = dayRec(st, date);
    var p = idx && idx[date] ? idx[date] : null;
    var period = !!(rec && rec.period);
    var info = {
      date: date,
      period: period,
      flow: rec && rec.flow ? rec.flow : '',
      pred: !!(p && p.pred) && !period,
      fertile: !!(p && p.fertile) && !period,
      ovu: !!(p && p.ovu) && !period,
      has: !!(rec && Object.keys(rec).length)
    };
    if (st && st.settings) {
      if (!st.settings.showFertile) info.fertile = false;
      if (!st.settings.showOvulation) info.ovu = false;
    }
    return info;
  }

  /* ---------------- 기록 분석 ---------------- */

  function history(st) {
    var ps = periodsOf(st).slice().reverse();   // 최근 → 과거
    var cl = cycleLengths(st);
    var byStart = {};
    cl.forEach(function (c) { byStart[c.start] = c; });
    var rows = ps.map(function (ep) {
      var c = byStart[ep.start] || null;
      return {
        start: ep.start,
        end: ep.end,
        span: ep.span,
        marked: ep.marked,
        cycle: c ? c.length : null,
        cycleValid: c ? c.valid : false,
        isCurrent: false
      };
    });
    var validLens = cl.filter(function (c) { return c.valid; }).map(function (c) { return c.length; });
    var recentLens = validLens.slice(-6);
    return {
      recentAvg: recentLens.length >= 2 ? Math.round(mean(recentLens)) : null,
      recentCount: recentLens.length,
      rows: rows,
      episodes: ps.length,
      cycles: cl.length,
      validCycles: validLens.length,
      shortest: validLens.length ? Math.min.apply(null, validLens) : null,
      longest: validLens.length ? Math.max.apply(null, validLens) : null,
      avgCycle: avgCycle(st),
      avgPeriod: avgPeriod(st),
      chart: cl.slice(-12)
    };
  }

  function countDays(st) {
    return st && st.days ? Object.keys(st.days).length : 0;
  }

  /* ---------------- 백업 ---------------- */

  function exportJSON(st) {
    var st2 = normalizeState(st);
    var payload = {
      app: 'my-cycle',
      v: SCHEMA,
      exportedAt: new Date().toISOString(),
      settings: st2.settings,
      days: st2.days
    };
    return JSON.stringify(payload, null, 2);
  }

  function importJSON(text) {
    var parsed;
    if (text && typeof text === 'object') parsed = text;
    else {
      try { parsed = JSON.parse(String(text)); }
      catch (e) { return { ok: false, error: 'JSON 형식이 아니에요', state: null, warnings: [] }; }
    }
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: '백업 파일 내용이 비어 있어요', state: null, warnings: [] };
    }
    var src = parsed.state && typeof parsed.state === 'object' ? parsed.state : parsed;
    if (!src.days && !src.settings) {
      return { ok: false, error: '이 앱의 백업 파일이 아니에요', state: null, warnings: [] };
    }
    var warnings = [];
    var rawDays = src.days && typeof src.days === 'object' ? Object.keys(src.days).length : 0;
    var st = normalizeState(src);
    var kept = countDays(st);
    if (rawDays > kept) warnings.push(rawDays - kept + '개 날짜는 형식이 맞지 않아 건너뛰었어요');
    if (parsed.app && parsed.app !== 'my-cycle') warnings.push('다른 앱의 백업이에요 — 읽을 수 있는 기록만 가져왔어요');
    return { ok: true, error: '', state: st, warnings: warnings, kept: kept, raw: rawDays };
  }

  /* ---------------- 예시 (가상 데이터) ---------------- */

  function sampleState(today) {
    var t = validDate(today) ? today : todayISO();
    var st = freshState();
    var lastStart = addDays(t, -12);           // 오늘은 주기 13일째
    var offsets = [113, 84, 56, 28, 0];        // 다섯 구간
    var spans = [5, 4, 5, 6, 5];
    var flows = [
      ['medium', 'heavy', 'heavy', 'medium', 'light'],
      ['medium', 'medium', 'heavy', 'light'],
      ['light', 'medium', 'heavy', 'medium', 'light'],
      ['heavy', 'heavy', 'medium', 'medium', 'light', 'light'],
      ['light', 'medium', 'medium', 'light', 'light']
    ];
    var sym = [
      ['cramps', 'fatigue'], ['cramps', 'bloating', 'headache'], ['cramps', 'backache'],
      ['fatigue', 'appetite'], ['cramps', 'cramps'], []
    ];
    for (var e = 0; e < offsets.length; e++) {
      var start = addDays(lastStart, -offsets[e]);
      for (var i = 0; i < spans[e]; i++) {
        var d = addDays(start, i);
        var r = ensureDay(st, d);
        r.period = 1;
        r.flow = flows[e][i] || 'medium';
        if (i < 2) r.symptoms = (i === 0 ? ['cramps', 'fatigue'] : ['bloating', 'headache']);
        if (i === 0) r.moods = ['sensitive'];
        if (i === 2) r.moods = ['low'];
      }
      var mid = addDays(start, Math.round(spans[e] / 2));
      if (st.days[mid]) st.days[mid].memo = '예시 기록 — 실제 내 기록은 아니에요';
    }
    st.settings.cycleLen = 28;
    st.settings.periodLen = 5;
    return st;
  }

  /* ---------------- 다른 앱(Flo 등) JSON 가져오기 ----------------
     Flo·애플 건강·기타 주기 앱의 내보내기는 구조가 제각각이라, 날짜가 들어 있는
     배열/객체를 폭넓게 찾아 "생리일"과 "하루 기록"만 골라냅니다. */

  var START_KEYS = ['start', 'startDate', 'start_date', 'start_date_utc', 'startDateUtc', 'from', 'begin',
    'first_day', 'firstDay', 'date_start', 'period_start', 'periodStart', 'startDateLocal'];
  var END_KEYS = ['end', 'endDate', 'end_date', 'end_date_utc', 'endDateUtc', 'to', 'last_day', 'lastDay',
    'date_end', 'period_end', 'periodEnd', 'finish', 'endDateLocal'];
  var DAY_KEYS = ['date', 'day', 'day_date', 'log_date', 'logged_at', 'loggedAt', 'timestamp',
    'time', 'date_string', 'dateString', 'dayDate'];
  var FLOW_KEYS = ['flow', 'bleeding', 'intensity', 'flow_intensity', 'flowIntensity',
    'bleeding_intensity', 'bleedingIntensity', 'amount', 'flow_level', 'flowLevel'];
  var SYM_KEYS = ['symptoms', 'symptom', 'symptoms_list', 'symptom_ids', 'pains', 'pain'];
  var MOOD_KEYS = ['moods', 'mood', 'mood_list', 'emotions', 'emotion'];
  var NOTE_KEYS = ['note', 'notes', 'memo', 'comment', 'text', 'journal'];
  var DIS_KEYS = ['discharge', 'cervical_mucus', 'mucus', 'discharge_type', 'dischargeType'];

  var FLOW_WORDS = {
    light: ['light', 'spotting', 'spot', 'little', 'small', 'low', '적음', '약간', '소량', '적은'],
    medium: ['medium', 'normal', 'moderate', 'middle', '보통', '중간'],
    heavy: ['heavy', 'large', 'high', '많음', '많이', '다량', '심함']
  };

  var SYM_ALIAS = {
    cramps: ['cramps', 'cramp', 'period pain', '복통', '생리통', '아랫배'],
    headache: ['headache', 'migraine', '두통', '편두통'],
    backache: ['backache', 'back pain', 'lower back', '요통', '허리'],
    bloating: ['bloating', 'bloat', '부종', '붓기'],
    fatigue: ['fatigue', 'tired', '피로', '무기력'],
    acne: ['acne', 'pimple', 'skin', '여드름', '피부'],
    appetite: ['appetite', 'cravings', 'hunger', '식욕', '식욕변화'],
    breast: ['breast', 'tender', '가슴', '가슴통증'],
    nausea: ['nausea', 'sick', '메스꺼', '구역'],
    dizzy: ['dizzy', 'dizziness', '어지'],
    insomnia: ['insomnia', 'sleepless', '불면'],
    constipation: ['constipation', '변비']
  };

  var MOOD_ALIAS = {
    calm: ['calm', '평온', '차분'],
    happy: ['happy', '행복', '기쁨'],
    sensitive: ['sensitive', '예민', '민감'],
    low: ['low', 'sad', '우울', '슬픔'],
    anxious: ['anxious', 'anxiety', '불안', '걱정'],
    tired: ['tired', '피곤', '지침'],
    irritable: ['irritable', 'angry', '짜증', '화남'],
    energetic: ['energetic', 'energy', '활기', '의욕']
  };

  function firstOf(obj, keys) {
    if (!obj || typeof obj !== 'object') return null;
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== null && v !== undefined && v !== '') return v;
    }
    return null;
  }

  function isScalarDateLike(v) {
    return (typeof v === 'string' && v.length >= 6) || (typeof v === 'number' && isFinite(v));
  }

  /* 여러 앱의 날짜 표기를 YYYY-MM-DD로: '2025-01-05', '2025/1/5', '1/5/2025', 1736000000000, 20250105 */
  function toISODate(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number' && isFinite(v)) {
      var n = Math.floor(v);
      if (n >= 19000101 && n <= 22001231) {
        var s8 = String(n);
        var iso8 = s8.slice(0, 4) + '-' + s8.slice(4, 6) + '-' + s8.slice(6, 8);
        return validDate(iso8) ? iso8 : '';
      }
      var ms = n < 1e11 ? n * 1000 : n;   // 초 단위 / 밀리초 단위
      if (ms < 0 || ms > 7258118400000) return '';
      var d = new Date(ms);
      if (isNaN(d.getTime())) return '';
      var y = d.getFullYear();
      if (y < 1900 || y > 2200) return '';
      return isoOf(d);
    }
    if (typeof v !== 'string') return '';
    var t = v.trim();
    var m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      var iso = m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
      return validDate(iso) ? iso : '';
    }
    m = t.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
    if (m) {
      var iso2 = m[1] + '-' + pad2(+m[2]) + '-' + pad2(+m[3]);
      return validDate(iso2) ? iso2 : '';
    }
    m = t.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
    if (m) {
      var a = +m[1], b = +m[2], yy = +m[3];
      var mm = a > 12 ? b : a, dd = a > 12 ? a : b;
      var iso3 = yy + '-' + pad2(mm) + '-' + pad2(dd);
      return validDate(iso3) ? iso3 : '';
    }
    m = t.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) {
      var iso4 = m[1] + '-' + m[2] + '-' + m[3];
      return validDate(iso4) ? iso4 : '';
    }
    return '';
  }

  function textLabel(v) {
    if (v && typeof v === 'object') {
      v = v.key || v.id || v.name || v.type || v.value || v.label || v.title || '';
    }
    return String(v === null || v === undefined ? '' : v).toLowerCase().trim();
  }

  function mapByAlias(v, list, alias) {
    var s = textLabel(v);
    if (!s) return '';
    for (var i = 0; i < list.length; i++) {
      var k = list[i].k;
      if (s === k || s === String(list[i].t).toLowerCase()) return k;
    }
    for (var key in alias) {
      if (!alias.hasOwnProperty(key)) continue;
      var arr = alias[key];
      for (var j = 0; j < arr.length; j++) {
        if (s === arr[j]) return key;
      }
    }
    for (var key2 in alias) {
      if (!alias.hasOwnProperty(key2)) continue;
      var arr2 = alias[key2];
      for (var n = 0; n < arr2.length; n++) {
        var w = arr2[n];
        if (w.length >= 2 && /[가-힣]/.test(w) && s.indexOf(w) >= 0) return key2;
      }
    }
    return '';
  }

  function mapFlow(v) {
    if (v === true) return 'medium';
    if (v && typeof v === 'object') v = firstOf(v, ['key', 'name', 'type', 'value', 'label', 'intensity', 'level']);
    var s = textLabel(v);
    if (!s) return '';
    if (/^\d+$/.test(s)) {
      var n = +s;
      return n <= 1 ? 'light' : (n >= 3 ? 'heavy' : 'medium');
    }
    for (var k in FLOW_WORDS) {
      if (!FLOW_WORDS.hasOwnProperty(k)) continue;
      for (var i = 0; i < FLOW_WORDS[k].length; i++) {
        if (s === FLOW_WORDS[k][i] || s.indexOf(FLOW_WORDS[k][i]) >= 0) return k;
      }
    }
    return '';
  }

  function listOf(v) {
    if (v === null || v === undefined) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'object') return [v];
    return String(v).split(/[;,|]/);
  }

  function isDateMap(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
    var keys = Object.keys(o);
    if (!keys.length || keys.length > 4000) return null;
    var out = [];
    for (var i = 0; i < keys.length; i++) {
      var d = toISODate(keys[i]);
      if (!d) return null;
      out.push({ key: keys[i], date: d });
    }
    return out;
  }

  function looksLikeEntry(x) {
    if (!isScalarDateLike(x) && (typeof x !== 'object' || x === null || Array.isArray(x))) return false;
    if (typeof x !== 'object') return true;
    var i;
    for (i = 0; i < START_KEYS.length; i++) if (x[START_KEYS[i]] != null) return true;
    for (i = 0; i < DAY_KEYS.length; i++) if (x[DAY_KEYS[i]] != null) return true;
    return false;
  }

  var PERIOD_KEY_RE = /period|cycle|menstru|bleed|flow|day_?log|logs?|record|history|entr/i;

  /* 한 덩어리(기간/하루)에서 기록 추출 */
  function extractOne(node, ex) {
    if (node === null || node === undefined) return false;
    if (typeof node === 'string' || typeof node === 'number') {
      var d0 = toISODate(node);
      if (d0) { ex.marks.push(d0); return true; }
      return false;
    }
    if (Array.isArray(node)) {
      if (node.length === 2 && isScalarDateLike(node[0]) && isScalarDateLike(node[1])) {
        var a = toISODate(node[0]), b = toISODate(node[1]);
        if (a && b) { ex.ranges.push([a, b]); return true; }
      }
      var any = false;
      for (var i = 0; i < node.length; i++) if (extractOne(node[i], ex)) any = true;
      return any;
    }
    if (typeof node !== 'object') return false;

    var used = false;
    var dayKey = toISODate(firstOf(node, DAY_KEYS));
    if (dayKey) {
      used = extractDayRec(node, dayKey, ex) || used;
      // 날짜만 달랑 있는 항목은 생리일로 본다 (예: period_days:[{date:'2025-07-01'}])
      var hasMeta = firstOf(node, FLOW_KEYS) != null || firstOf(node, SYM_KEYS) != null ||
        firstOf(node, MOOD_KEYS) != null || firstOf(node, NOTE_KEYS) != null ||
        firstOf(node, DIS_KEYS) != null;
      if (!hasMeta) { ex.marks.push(dayKey); used = true; }
    }

    var s = toISODate(firstOf(node, START_KEYS));
    var e = toISODate(firstOf(node, END_KEYS));
    if (s) {
      if (e) ex.ranges.push([s, e]);
      else ex.marks.push(s);
      used = true;
    }

    var arr = firstOf(node, ['days', 'dates', 'day_list', 'dayList', 'period_days', 'periodDays', 'cycle_days', 'cycleDays']);
    if (Array.isArray(arr)) {
      for (var j = 0; j < arr.length; j++) {
        var x = arr[j];
        var xd = toISODate(x && typeof x === 'object' ? firstOf(x, DAY_KEYS) : x);
        if (xd) ex.marks.push(xd);
        else if (x && typeof x === 'object') extractDayRec(x, '', ex);
      }
      used = true;
    }
    return used;
  }

  function extractDayRec(o, date, ex) {
    if (!date) date = toISODate(firstOf(o, DAY_KEYS));
    if (!date) return false;
    var rec = {};
    var flow = mapFlow(firstOf(o, FLOW_KEYS));
    if (flow) { rec.flow = flow; rec.period = 1; }
    var bleeding = firstOf(o, ['has_period', 'is_period', 'period', 'bleeding']);
    if (!flow && (bleeding === true || bleeding === 1 || /^(yes|true|period|on)$/i.test(String(bleeding || '')))) {
      rec.period = 1;
    }
    var symArr = listOf(firstOf(o, SYM_KEYS));
    var syms = [];
    for (var i = 0; i < symArr.length; i++) {
      var sk = mapByAlias(symArr[i], SYMPTOMS, SYM_ALIAS);
      if (sk && syms.indexOf(sk) < 0) syms.push(sk);
    }
    if (syms.length) rec.symptoms = syms;
    var moodArr = listOf(firstOf(o, MOOD_KEYS));
    var moods = [];
    for (var j = 0; j < moodArr.length; j++) {
      var mk = mapByAlias(moodArr[j], MOODS, MOOD_ALIAS);
      if (mk && moods.indexOf(mk) < 0) moods.push(mk);
    }
    if (moods.length) rec.moods = moods;
    var memo = firstOf(o, NOTE_KEYS);
    if (typeof memo === 'string' && memo.trim()) rec.memo = cleanText(memo, 500);
    var dis = firstOf(o, DIS_KEYS);
    if (dis && typeof dis === 'string') {
      for (var n = 0; n < DISCHARGE.length; n++) {
        if (textLabel(dis) === DISCHARGE[n].k) { rec.discharge = DISCHARGE[n].k; break; }
      }
    }
    if (Object.keys(rec).length) ex.recs.push({ date: date, rec: rec });
    return !!Object.keys(rec).length;
  }

  var SETTING_KEYS = {
    cycle: ['cycle_length', 'cycleLength', 'average_cycle_length', 'avg_cycle_length', 'avgCycleLength', 'cycle_len'],
    period: ['period_length', 'periodLength', 'average_period_length', 'avg_period_length', 'avgPeriodLength', 'period_len']
  };

  function readSetting(o, keys, lo, hi) {
    for (var i = 0; i < keys.length; i++) {
      if (o && o[keys[i]] != null && isFinite(Number(o[keys[i]]))) {
        var n = Math.round(Number(o[keys[i]]));
        if (n >= lo && n <= hi) return n;
      }
    }
    return null;
  }

  function extractForeign(root) {
    var ex = { marks: [], ranges: [], recs: [], warnings: [], arrays: 0, settings: {} };

    function walk(node, key, depth) {
      if (!node || typeof node !== 'object' || depth > 8) return;
      if (Array.isArray(node)) {
        var entryLike = node.length > 0 && node.every(looksLikeEntry);
        var rangeLike = node.length > 0 && node.every(function (x) {
          return x && typeof x === 'object' && firstOf(x, START_KEYS) != null && firstOf(x, END_KEYS) != null;
        });
        if (PERIOD_KEY_RE.test(key || '') || rangeLike || (entryLike && !key)) {
          for (var i = 0; i < node.length; i++) extractOne(node[i], ex);
          ex.arrays++;
        } else {
          for (var j = 0; j < node.length; j++) walk(node[j], key, depth + 1);
        }
        return;
      }
      var dm = isDateMap(node);
      if (dm) {
        for (var d = 0; d < dm.length; d++) {
          var v = node[dm[d].key];
          if (v === true || v === 1) { ex.marks.push(dm[d].date); continue; }
          if (v && typeof v === 'object') extractDayRec(v, dm[d].date, ex);
        }
        ex.arrays++;
        return;
      }
      var allKeys = Object.keys(node);
      var cFound = readSetting(node, SETTING_KEYS.cycle, 15, 60);
      var pFound = readSetting(node, SETTING_KEYS.period, 1, 15);
      if (cFound && !ex.settings.cycleLen) ex.settings.cycleLen = cFound;
      if (pFound && !ex.settings.periodLen) ex.settings.periodLen = pFound;
      for (var k = 0; k < allKeys.length; k++) {
        var child = node[allKeys[k]];
        if (child && typeof child === 'object') walk(child, allKeys[k], depth + 1);
      }
    }

    var cyc = readSetting(root, SETTING_KEYS.cycle, 15, 60);
    var plen = readSetting(root, SETTING_KEYS.period, 1, 15);
    if (cyc) ex.settings.cycleLen = cyc;
    if (plen) ex.settings.periodLen = plen;
    var nested = root && root.settings && typeof root.settings === 'object' ? root.settings : null;
    if (nested) {
      var c2 = readSetting(nested, SETTING_KEYS.cycle, 15, 60);
      var p2 = readSetting(nested, SETTING_KEYS.period, 1, 15);
      if (c2) ex.settings.cycleLen = c2;
      if (p2) ex.settings.periodLen = p2;
    }

    walk(root, '', 0);
    return ex;
  }

  function applyRec(st, date, rec) {
    if (!validDate(date) || !rec) return;
    var r = ensureDay(st, date);
    if (rec.period || rec.flow) r.period = 1;
    if (rec.flow) r.flow = rec.flow;
    if (rec.symptoms && rec.symptoms.length) {
      var cur = Array.isArray(r.symptoms) ? r.symptoms : [];
      for (var i = 0; i < rec.symptoms.length; i++) if (cur.indexOf(rec.symptoms[i]) < 0) cur.push(rec.symptoms[i]);
      r.symptoms = cur;
    }
    if (rec.moods && rec.moods.length) {
      var cur2 = Array.isArray(r.moods) ? r.moods : [];
      for (var j = 0; j < rec.moods.length; j++) if (cur2.indexOf(rec.moods[j]) < 0) cur2.push(rec.moods[j]);
      r.moods = cur2;
    }
    if (rec.discharge) r.discharge = rec.discharge;
    if (rec.memo && !r.memo) r.memo = rec.memo;
  }

  function buildImported(ex) {
    var st = freshState();
    if (ex.settings && (ex.settings.cycleLen || ex.settings.periodLen)) {
      st.settings = normSettings({
        cycleLen: ex.settings.cycleLen || 28,
        periodLen: ex.settings.periodLen || 5,
        showFertile: true, showOvulation: true
      });
    }
    for (var i = 0; i < ex.recs.length; i++) applyRec(st, ex.recs[i].date, ex.recs[i].rec);
    for (var j = 0; j < ex.marks.length; j++) ensureDay(st, ex.marks[j]).period = 1;
    for (var n = 0; n < ex.ranges.length; n++) {
      var a = ex.ranges[n][0], b = ex.ranges[n][1];
      if (diffDays(a, b) < 0) { var t = a; a = b; b = t; }
      var span = diffDays(a, b);
      if (span > 90) {
        ex.warnings.push(dateDot(a) + '~' + dateDot(b) + ' 구간이 너무 길어 90일까지만 반영했어요');
        span = 90;
      }
      for (var m = 0; m <= span; m++) ensureDay(st, addDays(a, m)).period = 1;
    }
    return st;
  }

  /* 불러온 기록을 지금 기록에 합치기 (같은 날짜는 채워 넣기) */
  function mergeStates(base, add) {
    var st = normalizeState(base);
    var ad = normalizeState(add);
    Object.keys(ad.days).forEach(function (k) {
      var a = st.days[k] || {};
      var b = ad.days[k];
      var m = {};
      if (a.period || b.period) m.period = 1;
      var flow = b.flow || a.flow;
      if (flow) m.flow = flow;
      var sym = [];
      (a.symptoms || []).concat(b.symptoms || []).forEach(function (x) { if (sym.indexOf(x) < 0) sym.push(x); });
      if (sym.length) m.symptoms = sym;
      var mo = [];
      (a.moods || []).concat(b.moods || []).forEach(function (x) { if (mo.indexOf(x) < 0) mo.push(x); });
      if (mo.length) m.moods = mo;
      var dis = b.discharge || a.discharge;
      if (dis) m.discharge = dis;
      var memo = b.memo || a.memo;
      if (memo) m.memo = memo;
      st.days[k] = m;
    });
    return st;
  }

  /* 내 백업 / 다른 앱(Flo 등) JSON을 모두 받아들인다 */
  function parseImport(text) {
    var parsed;
    if (text && typeof text === 'object') parsed = text;
    else {
      try { parsed = JSON.parse(String(text)); }
      catch (e) { return { ok: false, error: 'JSON 형식이 아니에요', state: null, warnings: [] }; }
    }
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, error: '백업 파일 내용이 비어 있어요', state: null, warnings: [] };
    }
    var src = parsed.state && typeof parsed.state === 'object' ? parsed.state : parsed;
    var ours = parsed.app === 'my-cycle' || (parsed.state && parsed.state.days) ||
      (src.settings && src.days && !Array.isArray(src.days) &&
        Object.keys(src.days).every(validDate));

    if (ours) {
      var r = importJSON(parsed.state ? parsed.state : parsed);
      if (!r.ok) return { ok: false, error: r.error, state: null, warnings: [] };
      var st0 = r.state;
      return {
        ok: true, source: 'my-cycle', state: st0, days: countDays(st0),
        periods: periodsOf(st0).length, warnings: r.warnings
      };
    }

    var ex = extractForeign(parsed);
    var total = ex.marks.length + ex.ranges.length + ex.recs.length;
    if (!total) {
      return {
        ok: false, state: null, warnings: [],
        error: '생리 날짜를 찾지 못했어요. Flo 주기 기록이 들어 있는 JSON인지 확인해 주세요.'
      };
    }
    var st = buildImported(ex);
    var warnings = ex.warnings.slice();
    if (!periodsOf(st).length) warnings.push('생리일은 찾았지만 구간을 만들 수 없었어요');
    return {
      ok: true, source: 'other', state: st, days: countDays(st),
      periods: periodsOf(st).length, warnings: warnings,
      ranges: ex.ranges.length, marks: ex.marks.length, records: ex.recs.length
    };
  }

  /* 기존 구간을 새 기간으로 바꾸기 (기록 관리용) */
  function replaceEpisode(st, oldStart, newStart, newEnd) {
    var ep = oldStart ? episodeAt(st, oldStart) : null;
    if (ep) clearPeriodFlags(st, ep);
    return markPeriodRange(st, newStart, newEnd);
  }

  /* ---------------- 내보내기 ---------------- */

  var API = {
    SCHEMA: SCHEMA, STORE_KEY: STORE_KEY,
    MERGE_GAP: MERGE_GAP, MIN_CYCLE: MIN_CYCLE, MAX_CYCLE: MAX_CYCLE, MAX_SPAN: MAX_SPAN,
    LUTEAL: LUTEAL, FERTILE_BEFORE: FERTILE_BEFORE, FERTILE_AFTER: FERTILE_AFTER,
    CYCLE_MIN: CYCLE_MIN, CYCLE_MAX: CYCLE_MAX, PERIOD_MIN: PERIOD_MIN, PERIOD_MAX: PERIOD_MAX,
    FLOWS: FLOWS, SYMPTOMS: SYMPTOMS, MOODS: MOODS, DISCHARGE: DISCHARGE, DOW: DOW,
    pad2: pad2, clampInt: clampInt, todayISO: todayISO, validDate: validDate,
    parseISO: parseISO, isoOf: isoOf, addDays: addDays, diffDays: diffDays,
    dowOf: dowOf, ymOf: ymOf, addMonths: addMonths, daysInMonth: daysInMonth, monthEnd: monthEnd,
    monthLabel: monthLabel, monthLabelShort: monthLabelShort, dateLabelKo: dateLabelKo,
    dateDot: dateDot, dateMD: dateMD, dateSlash: dateSlash,
    rangeLabel: rangeLabel, rangeLabelDays: rangeLabelDays, monthGrid: monthGrid,
    freshState: freshState, normalizeState: normalizeState, normSettings: normSettings,
    dayRec: dayRec, isPeriodDay: isPeriodDay, hasAnyData: hasAnyData, countDays: countDays,
    setPeriod: setPeriod, setFlow: setFlow, toggleSymptom: toggleSymptom, toggleMood: toggleMood,
    setDischarge: setDischarge, setMemo: setMemo, setDayField: setDayField, clearDay: clearDay,
    markPeriodRange: markPeriodRange, endPeriodAt: endPeriodAt, clearPeriodFlags: clearPeriodFlags,
    replaceEpisode: replaceEpisode,
    periodsOf: periodsOf, episodeAt: episodeAt, episodeDays: episodeDays, cycleLengths: cycleLengths,
    avgCycle: avgCycle, avgPeriod: avgPeriod, nextPeriod: nextPeriod, summary: summary,
    predictIndex: predictIndex, dayInfo: dayInfo, history: history,
    exportJSON: exportJSON, importJSON: importJSON, sampleState: sampleState, uid: uid,
    toISODate: toISODate, parseImport: parseImport, mergeStates: mergeStates,
    extractForeign: extractForeign, buildImported: buildImported
  };

  root.CycleCore = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
