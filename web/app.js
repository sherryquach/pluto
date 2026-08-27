
(function () {
  'use strict';

  var LOG_PAGE_SIZE = 50;

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
    dateFrom: '',
    dateTo: '',
    selected: {
      country: new Set(),
      device_type: new Set(),
      event_name: new Set(),
      screen_name: new Set()
    },
    funnelDimension: 'screen_name',
    funnelSteps: 5,
    logSearch: '',
    logSortDir: 'desc',
    logPage: 1
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
    var hasDate = Boolean(state.dateFrom || state.dateTo);
    var parts = [];
    if (totalSelected) parts.push(totalSelected + ' segment filter' + (totalSelected > 1 ? 's' : ''));
    if (hasDate) parts.push('date range');
    qs('filterSummaryText').textContent = parts.length ? (parts.join(' + ') + ' applied') : 'No filters applied';
    qs('resetBtn').disabled = !(totalSelected || hasDate);
  }

  function resetAll() {
    FILTER_DIMS.forEach(function (cfg) { state.selected[cfg.dim].clear(); });
    qs('dateFrom').value = '';
    qs('dateTo').value = '';
    state.dateFrom = '';
    state.dateTo = '';
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
    var ol = qs('funnelSignal');
    var emptyNote = qs('funnelEmpty');
    ol.textContent = '';
    var stages = computeFunnelStages(rows, state.funnelDimension, state.funnelSteps);
    if (stages.length === 0) {
      emptyNote.hidden = false;
      return;
    }
    emptyNote.hidden = true;
    var base = stages[0].count || 1;

    stages.forEach(function (stage, i) {
      var li = el('li', 'signal-stage');
      var node = el('span', 'signal-node');
      node.setAttribute('aria-hidden', 'true');
      var body = el('div', 'signal-body');
      var row = el('div', 'signal-row');
      row.appendChild(el('span', 'signal-label', stage.label || '(not set)'));
      row.appendChild(el('span', 'signal-count', formatNumber(stage.count)));
      row.appendChild(el('span', 'signal-pct', Math.round((stage.count / base) * 100) + '%'));
      var track = el('div', 'signal-bar-track');
      var fill = el('div', 'signal-bar-fill');
      fill.style.width = Math.max((stage.count / base) * 100, 3) + '%';
      track.appendChild(fill);
      body.appendChild(row);
      body.appendChild(track);
      li.appendChild(node);
      li.appendChild(body);
      ol.appendChild(li);

      if (i < stages.length - 1) {
        var next = stages[i + 1];
        var dropPct = stage.count > 0 ? Math.round((1 - next.count / stage.count) * 100) : 0;
        var dropLi = el('li', 'signal-drop');
        var line = el('span', 'drop-line');
        line.setAttribute('aria-hidden', 'true');
        var dropLabel = el('span', 'drop-label', '▾ ' + dropPct + '% drop-off');
        dropLi.appendChild(line);
        dropLi.appendChild(dropLabel);
        ol.appendChild(dropLi);
      }
    });
  }

  function renderTrend(rows) {
    var container = qs('trendChart');
    container.textContent = '';
    var byDate = new Map();
    rows.forEach(function (r) {
      var d = r.first_seen_date;
      if (!d) return;
      if (!byDate.has(d)) byDate.set(d, new Set());
      byDate.get(d).add(r.session_id);
    });
    var points = Array.from(byDate.entries()).map(function (entry) {
      return { date: entry[0], count: entry[1].size };
    }).sort(function (a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); });

    if (points.length === 0) {
      container.appendChild(el('p', 'panel-empty', 'No dated sessions in this filter set.'));
      return;
    }

    var w = 640, h = 160, pad = 20;
    var maxCount = Math.max.apply(null, points.map(function (p) { return p.count; }).concat([1]));
    var stepX = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
    var coords = points.map(function (p, i) {
      var x = pad + i * stepX;
      var y = h - pad - (p.count / maxCount) * (h - pad * 2);
      return { x: x, y: y, date: p.date, count: p.count };
    });

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Sessions per day trend across ' + points.length + ' days, peak ' + maxCount + ' sessions');
    svg.classList.add('trend-svg');

    var areaPath = document.createElementNS(svgNS, 'path');
    var d = 'M ' + coords[0].x + ' ' + (h - pad) + ' ';
    coords.forEach(function (c) { d += 'L ' + c.x + ' ' + c.y + ' '; });
    d += 'L ' + coords[coords.length - 1].x + ' ' + (h - pad) + ' Z';
    areaPath.setAttribute('d', d);
    areaPath.setAttribute('class', 'trend-area');
    svg.appendChild(areaPath);

    var line = document.createElementNS(svgNS, 'polyline');
    line.setAttribute('points', coords.map(function (c) { return c.x + ',' + c.y; }).join(' '));
    line.setAttribute('class', 'trend-line');
    svg.appendChild(line);

    coords.forEach(function (c) {
      var circle = document.createElementNS(svgNS, 'circle');
      circle.setAttribute('cx', String(c.x));
      circle.setAttribute('cy', String(c.y));
      circle.setAttribute('r', '3');
      circle.setAttribute('class', 'trend-dot');
      svg.appendChild(circle);
    });

    container.appendChild(svg);
    var caption = el('p', 'chart-caption', points[0].date + ' – ' + points[points.length - 1].date + ' · peak ' + formatNumber(maxCount) + ' sessions/day');
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
