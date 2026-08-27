
(function () {
  'use strict';

  var LOG_PAGE_SIZE = 50;
  var DEFAULT_DATE_FROM = '2025-02-01';
  var DEFAULT_DATE_TO = '2025-03-01';
  var FUNNEL_COLORS = ['#213448', '#183B4E', '#27548A', '#205781'];

  var FILTER_DIMS = [
    { dim: 'country', optionsId: 'countryOptions', badgeId: 'countryBadge' },
    { dim: 'device_type', optionsId: 'deviceOptions', badgeId: 'deviceBadge' },
    { dim: 'event_name', optionsId: 'eventOptions', badgeId: 'eventBadge' },
    { dim: 'screen_name', optionsId: 'screenOptions', badgeId: 'screenBadge' }
  ];

  var state = {
    rawRows: [],
    truncated: false,
    totalFetched: 0,
    dateFrom: DEFAULT_DATE_FROM,
    dateTo: DEFAULT_DATE_TO,
    selected: {
      country: new Set(),
      device_type: new Set(),
      event_name: new Set(),
      screen_name: new Set()
    },
    funnelDimension: 'screen_name',
    funnelSteps: 5,
    trendGroup: 'day',
    trendMetric: 'users',
    logSearch: '',
    logSortDir: 'desc',
    logPage: 1,
    signupTimes: new Map()
  };

  function qs(id) { return document.getElementById(id); }

  function formatNumber(n) {
    return Number(n || 0).toLocaleString('en-US');
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // ---------- state panels ----------

  function hideAllStates() {
    qs('loadingState').hidden = true;
    qs('errorState').hidden = true;
    qs('emptyState').hidden = true;
    qs('dataView').hidden = true;
  }

  function showLoading() { hideAllStates(); qs('loadingState').hidden = false; }
  function showError(msg) { hideAllStates(); qs('errorText').textContent = msg; qs('errorState').hidden = false; }
  function showEmpty() { hideAllStates(); qs('emptyState').hidden = false; }
  function showData() { hideAllStates(); qs('dataView').hidden = false; }

  function updateStatus(ok) {
    var dot = qs('statusDot');
    var text = qs('statusText');
    if (ok) {
      dot.className = 'status-dot status-ok';
      text.textContent = 'Live · ' + formatNumber(state.rawRows.length) + ' events loaded' + (state.truncated ? ' (capped)' : '');
    } else {
      dot.className = 'status-dot status-error';
      text.textContent = 'Connection error';
    }
  }

  // ---------- data loading ----------

  function computeSignupTimes(rows) {
    var map = new Map();
    rows.forEach(function (r) {
      if (!r.User_ID) return;
      var t = Date.parse(r.timestamp);
      if (Number.isNaN(t)) return;
      if (!map.has(r.User_ID) || t < map.get(r.User_ID)) map.set(r.User_ID, t);
    });
    return map;
  }

  function formatElapsed(ms) {
    if (ms === null || ms === undefined || Number.isNaN(ms) || ms < 0) return '—';
    var totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return totalSeconds + 's';
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    if (minutes < 60) return minutes + 'm ' + seconds + 's';
    var hours = Math.floor(minutes / 60);
    var remMinutes = minutes % 60;
    return hours + 'h ' + remMinutes + 'm';
  }

  function loadData() {
    showLoading();
    var params = new URLSearchParams();
    if (state.dateFrom) params.set('from', state.dateFrom);
    if (state.dateTo) params.set('to', state.dateTo);
    var qsStr = params.toString();
    fetch('api/funnel-data' + (qsStr ? '?' + qsStr : ''))
      .then(function (resp) {
        if (!resp.ok) {
          return resp.json().catch(function () { return {}; }).then(function (body) {
            throw new Error(body.error || ('Request failed (' + resp.status + ')'));
          });
        }
        return resp.json();
      })
      .then(function (data) {
        state.rawRows = data.rows || [];
        state.truncated = Boolean(data.truncated);
        state.totalFetched = data.totalFetched || state.rawRows.length;
        state.logPage = 1;
        state.signupTimes = computeSignupTimes(state.rawRows);
        buildFilterOptions();
        syncFilterCheckboxes();
        if (state.rawRows.length === 0) {
          showEmpty();
        } else {
          showData();
          renderAll();
        }
        updateStatus(true);
      })
      .catch(function (err) {
        showError(err.message || 'Failed to load funnel data.');
        updateStatus(false);
      });
  }

  // ---------- filters ----------

  function applyFilters(rows) {
    var sel = state.selected;
    return rows.filter(function (r) {
      return (!sel.country.size || sel.country.has(r.country)) &&
        (!sel.device_type.size || sel.device_type.has(r.device_type)) &&
        (!sel.event_name.size || sel.event_name.has(r.event_name)) &&
        (!sel.screen_name.size || sel.screen_name.has(r.screen_name));
    });
  }

  function toggleFilterValue(dim, value) {
    var set = state.selected[dim];
    if (set.has(value)) set.delete(value); else set.add(value);
    state.logPage = 1;
    syncFilterCheckboxes();
    renderAll();
  }

  function buildFilterOptions() {
    FILTER_DIMS.forEach(function (cfg) {
      var counts = new Map();
      state.rawRows.forEach(function (r) {
        var v = r[cfg.dim];
        if (v === null || v === undefined || v === '') return;
        counts.set(v, (counts.get(v) || 0) + 1);
      });
      var values = Array.from(counts.entries())
        .sort(function (a, b) { return b[1] - a[1] || String(a[0]).localeCompare(String(b[0])); })
        .slice(0, 30);

      var container = qs(cfg.optionsId);
      container.textContent = '';
      if (values.length === 0) {
        container.appendChild(el('p', 'panel-empty', 'No values available.'));
        return;
      }
      values.forEach(function (entry) {
        var val = entry[0];
        var count = entry[1];
        var label = el('label', 'option-row');
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.value = val;
        input.checked = state.selected[cfg.dim].has(val);
        input.addEventListener('change', function () { toggleFilterValue(cfg.dim, val); });
        var span = el('span', null, val + ' (' + formatNumber(count) + ')');
        label.appendChild(input);
        label.appendChild(span);
        container.appendChild(label);
      });
    });
  }

  function syncFilterCheckboxes() {
    FILTER_DIMS.forEach(function (cfg) {
      qs(cfg.optionsId).querySelectorAll('input[type=checkbox]').forEach(function (cb) {
        cb.checked = state.selected[cfg.dim].has(cb.value);
      });
      var badge = qs(cfg.badgeId);
      var n = state.selected[cfg.dim].size;
      badge.textContent = String(n);
      badge.hidden = n === 0;
    });
    updateFilterSummary();
  }

  function updateFilterSummary() {
    var totalSelected = FILTER_DIMS.reduce(function (s, cfg) { return s + state.selected[cfg.dim].size; }, 0);
    var hasDate = (state.dateFrom !== DEFAULT_DATE_FROM) || (state.dateTo !== DEFAULT_DATE_TO);
    var parts = [];
    if (totalSelected) parts.push(totalSelected + ' segment filter' + (totalSelected > 1 ? 's' : ''));
    if (hasDate) parts.push('custom date range');
    qs('filterSummaryText').textContent = parts.length ? (parts.join(' + ') + ' applied') : 'No filters applied';
    qs('resetBtn').disabled = !(totalSelected || hasDate);
  }

  function resetAll() {
    FILTER_DIMS.forEach(function (cfg) { state.selected[cfg.dim].clear(); });
    qs('dateFrom').value = DEFAULT_DATE_FROM;
    qs('dateTo').value = DEFAULT_DATE_TO;
    state.dateFrom = DEFAULT_DATE_FROM;
    state.dateTo = DEFAULT_DATE_TO;
    state.logSearch = '';
    qs('logSearch').value = '';
    state.logPage = 1;
    loadData();
  }

  // ---------- rendering ----------

  function renderAll() {
    var filtered = applyFilters(state.rawRows);
    renderFunnel(filtered);
    renderTrend(filtered);
    renderBarList('deviceBars', toCountList(filtered, 'device_type', 'sessions'), 'device_type', state.selected.device_type);
    renderBarList('countryBars', toCountList(filtered, 'country', 'sessions'), 'country', state.selected.country);
    renderBarList('screenBars', toCountList(filtered, 'screen_name', 'events'), 'screen_name', state.selected.screen_name);
    renderElementsTable(filtered);
    renderLog(filtered);
  }

  function toCountList(rows, dim, mode) {
    var map = new Map();
    rows.forEach(function (r) {
      var v = r[dim];
      if (v === null || v === undefined || v === '') return;
      if (mode === 'sessions') {
        if (!map.has(v)) map.set(v, new Set());
        map.get(v).add(r.session_id);
      } else {
        map.set(v, (map.get(v) || 0) + 1);
      }
    });
    var items = Array.from(map.entries()).map(function (entry) {
      return { value: entry[0], count: mode === 'sessions' ? entry[1].size : entry[1] };
    });
    items.sort(function (a, b) { return b.count - a.count; });
    return items.slice(0, 8);
  }

  function renderBarList(containerId, items, dim, selectedSet) {
    var ul = qs(containerId);
    ul.textContent = '';
    if (items.length === 0) {
      ul.appendChild(el('li', 'panel-empty', 'No data for this filter set.'));
      return;
    }
    var max = Math.max.apply(null, items.map(function (i) { return i.count; }).concat([1]));
    items.forEach(function (item) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bar-btn';
      var active = selectedSet.has(item.value);
      btn.setAttribute('aria-pressed', String(active));
      if (active) btn.classList.add('is-active');

      var label = el('span', 'bar-label', item.value || '(not set)');
      var track = el('span', 'bar-track');
      var fill = el('span', 'bar-fill');
      fill.style.width = Math.max((item.count / max) * 100, 3) + '%';
      track.appendChild(fill);
      var value = el('span', 'bar-value', formatNumber(item.count));

      btn.appendChild(label);
      btn.appendChild(track);
      btn.appendChild(value);
      btn.addEventListener('click', function () { toggleFilterValue(dim, item.value); });

      li.appendChild(btn);
      ul.appendChild(li);
    });
  }

  function computeFunnelStages(rows, dimension, steps) {
    var sessionsByValue = new Map();
    var tsAgg = new Map();
    rows.forEach(function (r, idx) {
      var val = r[dimension];
      if (val === null || val === undefined || val === '') return;
      if (!sessionsByValue.has(val)) sessionsByValue.set(val, new Set());
      sessionsByValue.get(val).add(r.session_id);
      var parsed = Date.parse(r.timestamp);
      var t = Number.isNaN(parsed) ? idx : parsed;
      if (!tsAgg.has(val)) tsAgg.set(val, { sum: 0, n: 0 });
      var agg = tsAgg.get(val);
      agg.sum += t;
      agg.n += 1;
    });

    var values = Array.from(sessionsByValue.entries()).map(function (entry) {
      var val = entry[0];
      var set = entry[1];
      var agg = tsAgg.get(val);
      return { value: val, count: set.size, sessions: set, avgTs: agg.sum / agg.n };
    });
    values.sort(function (a, b) { return b.count - a.count; });
    values = values.slice(0, steps);
    values.sort(function (a, b) { return a.avgTs - b.avgTs; });

    var running = null;
    return values.map(function (v) {
      running = running === null ? v.sessions : new Set(Array.from(running).filter(function (s) { return v.sessions.has(s); }));
      return { label: v.value, count: running.size };
    });
  }

  function renderFunnel(rows) {
    var container = qs('funnelSignal');
    var emptyNote = qs('funnelEmpty');
    container.textContent = '';
    var stages = computeFunnelStages(rows, state.funnelDimension, state.funnelSteps);
    if (stages.length === 0) {
      emptyNote.hidden = false;
      return;
    }
    emptyNote.hidden = true;
    var base = stages[0].count || 1;

    var chart = el('div', 'funnel-chart');
    chart.setAttribute('role', 'group');
    chart.setAttribute('aria-label', 'Funnel stage counts and drop-off across ' + stages.length + ' stages');
    var srList = el('ul', 'sr-only');

    stages.forEach(function (stage, i) {
      var col = el('div', 'funnel-col');
      var track = el('div', 'funnel-bar-track');
      var bar = el('div', 'funnel-bar');
      var pct = Math.round((stage.count / base) * 100);
      bar.style.height = Math.max(pct, 3) + '%';
      bar.style.background = FUNNEL_COLORS[i % FUNNEL_COLORS.length];
      track.appendChild(bar);
      var value = el('p', 'funnel-value', formatNumber(stage.count));
      var pctEl = el('p', 'funnel-pct', pct + '%');
      var label = el('p', 'funnel-label', stage.label || '(not set)');
      col.appendChild(track);
      col.appendChild(value);
      col.appendChild(pctEl);
      col.appendChild(label);
      chart.appendChild(col);

      var srLi = el('li', null, 'Stage ' + (i + 1) + ': ' + (stage.label || '(not set)') + ', ' + formatNumber(stage.count) + ' (' + pct + '%)');
      srList.appendChild(srLi);

      if (i < stages.length - 1) {
        var next = stages[i + 1];
        var dropPct = stage.count > 0 ? Math.round((1 - next.count / stage.count) * 100) : 0;
        var drop = el('div', 'funnel-drop');
        drop.setAttribute('aria-hidden', 'true');
        drop.appendChild(el('span', 'funnel-drop-icon', '▾'));
        drop.appendChild(el('span', null, dropPct + '% drop'));
        chart.appendChild(drop);
        srLi.textContent += '; drop-off to next stage: ' + dropPct + '%';
      }
    });

    container.appendChild(chart);
    container.appendChild(srList);
  }

  function bucketKeyFor(dateStr, group) {
    if (!dateStr) return null;
    if (group === 'month') return dateStr.slice(0, 7);
    if (group === 'week') {
      var d = new Date(dateStr + 'T00:00:00Z');
      if (Number.isNaN(d.getTime())) return dateStr;
      var day = d.getUTCDay();
      var diff = (day === 0 ? -6 : 1) - day;
      var monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() + diff);
      return monday.toISOString().slice(0, 10);
    }
    return dateStr;
  }

  function bucketLabel(key, group) {
    if (group === 'month') {
      var parts = key.split('-');
      var d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, 1));
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    }
    if (group === 'week') {
      var d2 = new Date(key + 'T00:00:00Z');
      return 'Wk ' + d2.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    }
    var d3 = new Date(key + 'T00:00:00Z');
    return d3.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  function renderTrend(rows) {
    var container = qs('trendChart');
    container.textContent = '';
    var group = state.trendGroup;
    var metric = state.trendMetric;

    var buckets = new Map();
    var totalUsers = new Set();
    var totalSessions = new Set();

    rows.forEach(function (r) {
      var d = r.first_seen_date;
      if (!d) return;
      var key = bucketKeyFor(d, group);
      if (key === null) return;
      if (!buckets.has(key)) buckets.set(key, { users: new Set(), sessions: new Set() });
      var b = buckets.get(key);
      if (r.User_ID) { b.users.add(r.User_ID); totalUsers.add(r.User_ID); }
      if (r.session_id) { b.sessions.add(r.session_id); totalSessions.add(r.session_id); }
    });

    var points = Array.from(buckets.entries()).map(function (entry) {
      var key = entry[0];
      var b = entry[1];
      var uUsers = b.users.size;
      var uSessions = b.sessions.size;
      var val;
      if (metric === 'users') val = uUsers;
      else if (metric === 'usersPct') val = totalUsers.size ? (uUsers / totalUsers.size) * 100 : 0;
      else if (metric === 'sessions') val = uSessions;
      else val = totalSessions.size ? (uSessions / totalSessions.size) * 100 : 0;
      return { key: key, label: bucketLabel(key, group), value: val };
    }).sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });

    if (points.length === 0) {
      container.appendChild(el('p', 'panel-empty', 'No dated sessions in this filter set.'));
      return;
    }

    var isPct = metric === 'usersPct' || metric === 'sessionsPct';
    var w = 680, h = 220, padL = 46, padR = 16, padT = 16, padB = 34;
    var rawMax = Math.max.apply(null, points.map(function (p) { return p.value; }).concat([isPct ? 10 : 1]));
    var maxVal = isPct ? (Math.min(100, Math.ceil(rawMax / 10) * 10) || 10) : (Math.ceil(rawMax * 1.1) || 1);

    var innerW = w - padL - padR, innerH = h - padT - padB;
    var stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
    var coords = points.map(function (p, i) {
      var x = padL + i * stepX;
      var y = padT + innerH - (p.value / maxVal) * innerH;
      return { x: x, y: y, p: p };
    });

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('role', 'img');
    var metricLabel = metric === 'users' ? 'unique users' : metric === 'usersPct' ? 'user share' : metric === 'sessions' ? 'unique sessions' : 'session share';
    svg.setAttribute('aria-label', 'Trend of ' + metricLabel + ' grouped by ' + group + ' across ' + points.length + ' points');
    svg.classList.add('trend-svg');

    var tickCount = 4;
    for (var t = 0; t <= tickCount; t++) {
      var ty = padT + innerH - (t / tickCount) * innerH;
      var gline = document.createElementNS(svgNS, 'line');
      gline.setAttribute('x1', String(padL));
      gline.setAttribute('x2', String(w - padR));
      gline.setAttribute('y1', String(ty));
      gline.setAttribute('y2', String(ty));
      gline.setAttribute('class', 'trend-grid');
      svg.appendChild(gline);

      var tval = (t / tickCount) * maxVal;
      var tlabel = document.createElementNS(svgNS, 'text');
      tlabel.setAttribute('x', String(padL - 8));
      tlabel.setAttribute('y', String(ty + 4));
      tlabel.setAttribute('class', 'trend-axis-label');
      tlabel.setAttribute('text-anchor', 'end');
      tlabel.textContent = isPct ? Math.round(tval) + '%' : formatNumber(Math.round(tval));
      svg.appendChild(tlabel);
    }

    var areaPath = document.createElementNS(svgNS, 'path');
    var dstr = 'M ' + coords[0].x + ' ' + (padT + innerH) + ' ';
    coords.forEach(function (c) { dstr += 'L ' + c.x + ' ' + c.y + ' '; });
    dstr += 'L ' + coords[coords.length - 1].x + ' ' + (padT + innerH) + ' Z';
    areaPath.setAttribute('d', dstr);
    areaPath.setAttribute('class', 'trend-area');
    svg.appendChild(areaPath);

    var line = document.createElementNS(svgNS, 'polyline');
    line.setAttribute('points', coords.map(function (c) { return c.x + ',' + c.y; }).join(' '));
    line.setAttribute('class', 'trend-line');
    svg.appendChild(line);

    var labelStep = Math.max(1, Math.ceil(points.length / 8));
    coords.forEach(function (c, i) {
      var circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', String(c.x));
      circle.setAttribute('cy', String(c.y));
      circle.setAttribute('r', '3');
      circle.setAttribute('class', 'trend-dot');
      svg.appendChild(circle);

      if (i % labelStep === 0 || i === coords.length - 1) {
        var xlabel = document.createElementNS(svgNS, 'text');
        xlabel.setAttribute('x', String(c.x));
        xlabel.setAttribute('y', String(h - 8));
        xlabel.setAttribute('class', 'trend-axis-label');
        xlabel.setAttribute('text-anchor', 'middle');
        xlabel.textContent = c.p.label;
        svg.appendChild(xlabel);
      }
    });

    container.appendChild(svg);
    var caption = el('p', 'chart-caption', points[0].label + ' – ' + points[points.length - 1].label + ' · ' + points.length + ' ' + group + (points.length === 1 ? '' : 's') + ' shown');
    container.appendChild(caption);
  }

  function renderElementsTable(rows) {
    var tbody = qs('elementsBody');
    tbody.textContent = '';
    var empty = qs('elementsEmpty');
    var counts = new Map();
    rows.forEach(function (r) {
      var elName = r.screen_element_name;
      if (!elName) return;
      var key = elName + '␟' + (r.screen_name || '');
      if (!counts.has(key)) counts.set(key, { element: elName, screen: r.screen_name || '(not set)', count: 0 });
      counts.get(key).count++;
    });
    var items = Array.from(counts.values()).sort(function (a, b) { return b.count - a.count; }).slice(0, 10);
    if (items.length === 0) { empty.hidden = false; return; }
    empty.hidden = true;
    var total = items.reduce(function (s, i) { return s + i.count; }, 0) || 1;
    items.forEach(function (item, i) {
      var tr = document.createElement('tr');
      tr.appendChild(el('td', null, String(i + 1)));
      tr.appendChild(el('td', null, item.element));
      tr.appendChild(el('td', null, item.screen));
      tr.appendChild(el('td', null, formatNumber(item.count)));
      tr.appendChild(el('td', null, Math.round((item.count / total) * 100) + '%'));
      tbody.appendChild(tr);
    });
  }

  function renderLog(rows) {
    var tbody = qs('logBody');
    tbody.textContent = '';
    var list = rows;
    var q = state.logSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(function (r) {
        return (String(r.session_id || '')).toLowerCase().indexOf(q) !== -1 ||
          (String(r.User_ID || '')).toLowerCase().indexOf(q) !== -1;
      });
    }
    list = list.slice().sort(function (a, b) {
      var ta = Date.parse(a.timestamp);
      var tb = Date.parse(b.timestamp);
      var va = Number.isNaN(ta) ? (a.timestamp || '') : ta;
      var vb = Number.isNaN(tb) ? (b.timestamp || '') : tb;
      if (va < vb) return state.logSortDir === 'asc' ? -1 : 1;
      if (va > vb) return state.logSortDir === 'asc' ? 1 : -1;
      return 0;
    });

    var totalPages = Math.max(1, Math.ceil(list.length / LOG_PAGE_SIZE));
    if (state.logPage > totalPages) state.logPage = totalPages;
    var startIdx = (state.logPage - 1) * LOG_PAGE_SIZE;
    var pageItems = list.slice(startIdx, startIdx + LOG_PAGE_SIZE);

    pageItems.forEach(function (r) {
      var tr = document.createElement('tr');
      [r.timestamp, r.session_id, r.User_ID, r.country, r.device_type, r.event_name, r.screen_name, r.screen_element_name].forEach(function (val) {
        var display = (val === null || val === undefined || val === '') ? '—' : String(val);
        tr.appendChild(el('td', null, display));
      });
      var signupTime = r.User_ID ? state.signupTimes.get(r.User_ID) : undefined;
      var ts = Date.parse(r.timestamp);
      var elapsed = (signupTime !== undefined && !Number.isNaN(ts)) ? (ts - signupTime) : null;
      tr.appendChild(el('td', null, formatElapsed(elapsed)));
      tbody.appendChild(tr);
    });

    var shownFrom = list.length ? startIdx + 1 : 0;
    var shownTo = Math.min(startIdx + LOG_PAGE_SIZE, list.length);
    qs('logSummary').textContent = 'Showing ' + shownFrom + '–' + shownTo + ' of ' + formatNumber(list.length) + ' filtered events' +
      (state.truncated ? (' (first ' + formatNumber(state.rawRows.length) + ' events loaded)') : '') + '.';
    qs('logPageText').textContent = 'Page ' + state.logPage + ' of ' + totalPages;
    qs('logPrevBtn').disabled = state.logPage <= 1;
    qs('logNextBtn').disabled = state.logPage >= totalPages;
    qs('sortIndicator').textContent = state.logSortDir === 'asc' ? '▴' : '▾';
    var th = qs('sortTimestampBtn').closest('th');
    th.setAttribute('aria-sort', state.logSortDir === 'asc' ? 'ascending' : 'descending');
  }

  // ---------- init ----------

  function init() {
    state.dateFrom = qs('dateFrom').value || DEFAULT_DATE_FROM;
    state.dateTo = qs('dateTo').value || DEFAULT_DATE_TO;
    state.trendGroup = qs('trendGroup').value;
    state.trendMetric = qs('trendMetric').value;

    qs('refreshBtn').addEventListener('click', loadData);
    qs('retryBtn').addEventListener('click', loadData);
    qs('emptyResetBtn').addEventListener('click', resetAll);
    qs('resetBtn').addEventListener('click', resetAll);

    qs('applyRangeBtn').addEventListener('click', function () {
      state.dateFrom = qs('dateFrom').value;
      state.dateTo = qs('dateTo').value;
      loadData();
    });

    qs('funnelDimension').addEventListener('change', function (e) {
      state.funnelDimension = e.target.value;
      renderAll();
    });
    qs('funnelSteps').addEventListener('change', function (e) {
      state.funnelSteps = Number(e.target.value);
      renderAll();
    });

    qs('trendGroup').addEventListener('change', function (e) {
      state.trendGroup = e.target.value;
      renderTrend(applyFilters(state.rawRows));
    });
    qs('trendMetric').addEventListener('change', function (e) {
      state.trendMetric = e.target.value;
      renderTrend(applyFilters(state.rawRows));
    });

    qs('logSearch').addEventListener('input', function (e) {
      state.logSearch = e.target.value;
      state.logPage = 1;
      renderLog(applyFilters(state.rawRows));
    });
    qs('sortTimestampBtn').addEventListener('click', function () {
      state.logSortDir = state.logSortDir === 'asc' ? 'desc' : 'asc';
      renderLog(applyFilters(state.rawRows));
    });
    qs('logPrevBtn').addEventListener('click', function () {
      if (state.logPage > 1) {
        state.logPage--;
        renderLog(applyFilters(state.rawRows));
      }
    });
    qs('logNextBtn').addEventListener('click', function () {
      state.logPage++;
      renderLog(applyFilters(state.rawRows));
    });

    loadData();
  }

  init();
})();
