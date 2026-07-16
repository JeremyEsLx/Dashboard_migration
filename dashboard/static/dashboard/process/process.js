/**
 * Performance by Process — Client-side Logic
 *
 * Single hierarchical table: Process -> Flow_Type_Map -> Cart Type
 * with subtotals at each group level.
 *
 * Cube rows: { p, f, c, s, sh, q, ld, tt }
 *   p=Process, f=Flow_Type_Map, c=Cart Type, s=Supervisor, sh=Shift
 *   q=Quantity, ld=Line Day Activity, tt=Target Time
 *
 * Client-side filters: Process, Shift (instant)
 * Server-side filters: Date Range, Week (reload)
 */

// ================================================================
// COLOR HELPERS
// ================================================================

function getProductivityClass(pct) {
    // Power BI rules: 0-<1% green, 1-<2% yellow, >=2% red
    if (pct < 0)   return '';               // negative = efficient, no highlight
    if (pct < 1)   return 'bg-green-strong'; // 0% to <1% → green
    if (pct < 2)   return 'bg-yellow';       // 1% to <2% → yellow/amber
    return 'bg-red-light';                   // >=2% → red/pink
}

function getUphPctClass(pct) {
    // Higher = better (meeting/exceeding target)
    if (pct >= 140) return 'bg-green-strong';
    if (pct >= 105) return 'bg-green-light';
    if (pct >= 80)  return 'bg-yellow';
    if (pct >= 50)  return 'bg-red-light';
    return 'bg-red-medium';
}


// ================================================================
// INLINE LOADING (banner-based)
// ================================================================

var CALENDAR_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12"/><path d="M5.5 1.5v3"/><path d="M10.5 1.5v3"/></svg>';

function showLoading() {
    var banner = document.getElementById('active-filters-banner');
    var bannerDate = document.getElementById('banner-date-range');
    var bannerIcon = document.getElementById('banner-icon');
    var bannerChips = document.getElementById('banner-chips');
    if (banner) banner.classList.add('is-loading');
    if (bannerIcon) bannerIcon.innerHTML = '<div class="inline-spinner"></div>';
    if (bannerDate) bannerDate.innerHTML = 'Loading new data...';
    if (bannerChips) bannerChips.innerHTML = '';
}

function hideLoading() {
    var banner = document.getElementById('active-filters-banner');
    var bannerIcon = document.getElementById('banner-icon');
    if (banner) banner.classList.remove('is-loading');
    if (bannerIcon) bannerIcon.innerHTML = CALENDAR_SVG;
}


// ================================================================
// ACTIVE FILTERS BANNER
// ================================================================

var SELECTED_STATE = {};

function formatDateNice(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function updateFiltersBanner() {
    var bannerDate = document.getElementById('banner-date-range');
    var bannerChips = document.getElementById('banner-chips');
    if (!bannerDate || !bannerChips) return;

    var dateFrom = SELECTED_STATE.date_from || '';
    var dateTo = SELECTED_STATE.date_to || '';
    var week = SELECTED_STATE.week || 'All';

    if (dateFrom && dateTo) {
        if (dateFrom === dateTo) {
            bannerDate.innerHTML = '<strong>Showing:</strong> ' + formatDateNice(dateFrom);
        } else {
            bannerDate.innerHTML = '<strong>Showing:</strong> ' + formatDateNice(dateFrom) + ' &mdash; ' + formatDateNice(dateTo);
        }
    } else if (dateFrom) {
        bannerDate.innerHTML = '<strong>Showing:</strong> From ' + formatDateNice(dateFrom);
    } else if (week && week !== 'All') {
        bannerDate.innerHTML = '<strong>Showing:</strong> Week ' + week;
    } else {
        bannerDate.innerHTML = '<strong>Showing:</strong> Current Week';
    }

    var dateFromInput = document.getElementById('filter-date-from');
    var dateToInput = document.getElementById('filter-date-to');
    if (dateFromInput && dateFrom && !dateFromInput.value) dateFromInput.value = dateFrom;
    if (dateToInput && dateTo && !dateToInput.value) dateToInput.value = dateTo;

    var chips = [];
    var proc = document.getElementById('filter-process').value;
    var shift = document.getElementById('filter-shift').value;
    if (proc && proc !== 'All') chips.push({ label: 'Process', value: proc });
    if (shift && shift !== 'All') chips.push({ label: 'Shift', value: shift });

    if (chips.length === 0) {
        bannerChips.innerHTML = '<span class="banner-chip banner-chip-all">All Filters</span>';
    } else {
        bannerChips.innerHTML = chips.map(function(c) {
            return '<span class="banner-chip"><strong>' + c.label + ':</strong> ' + c.value + '</span>';
        }).join('');
    }
}


// ================================================================
// CUBE FILTERING (client-side)
// ================================================================

function getFilters() {
    return {
        process: document.getElementById('filter-process').value,
        shift: document.getElementById('filter-shift').value
    };
}

function filterCube() {
    var f = getFilters();
    var rows = CUBE;
    if (f.process && f.process !== 'All') {
        rows = rows.filter(function(r) { return r.p === f.process; });
    }
    if (f.shift && f.shift !== 'All') {
        rows = rows.filter(function(r) { return r.sh === f.shift; });
    }
    return rows;
}


// ================================================================
// METRICS COMPUTATION
// ================================================================

function computeMetrics(q, ld, tt) {
    var actualTime = ld / 60;
    var standardTime = tt;
    var uph = actualTime > 0 ? Math.round(q / actualTime) : 0;
    var targetUph = standardTime > 0 ? Math.round(q / standardTime) : 0;
    var uphPct = targetUph > 0 ? Math.round((uph / targetUph) * 100) : 0;
    var productivity = standardTime > 0 ? Math.round((actualTime / standardTime - 1) * 100 * 10) / 10 : 0;

    return {
        qty: Math.round(q),
        actualTime: Math.round(actualTime * 100) / 100,
        standardTime: Math.round(standardTime * 100) / 100,
        productivity: productivity,
        uph: uph,
        targetUph: targetUph,
        uphPct: uphPct
    };
}

function numCells(m) {
    return '<td class="col-num">' + m.qty.toLocaleString() + '</td>'
         + '<td class="col-num">' + m.actualTime.toFixed(2) + '</td>'
         + '<td class="col-num">' + m.standardTime.toFixed(2) + '</td>'
         + '<td class="col-num ' + getProductivityClass(m.productivity) + '">' + m.productivity.toFixed(1) + '%</td>'
         + '<td class="col-num">' + m.uph + '</td>'
         + '<td class="col-num">' + m.targetUph + '</td>'
         + '<td class="col-num ' + getUphPctClass(m.uphPct) + '">' + m.uphPct + '%</td>';
}


// ================================================================
// HIERARCHICAL TABLE
// ================================================================

function buildHierarchy(filteredCube) {
    var tree = {};
    for (var i = 0; i < filteredCube.length; i++) {
        var r = filteredCube[i];
        var p = r.p || '(blank)';
        var f = r.f || '(blank)';
        var c = r.c || '(blank)';

        if (!tree[p]) tree[p] = {};
        if (!tree[p][f]) tree[p][f] = {};
        if (!tree[p][f][c]) tree[p][f][c] = {q: 0, ld: 0, tt: 0};

        tree[p][f][c].q += r.q;
        tree[p][f][c].ld += r.ld;
        tree[p][f][c].tt += r.tt;
    }
    return tree;
}

function renderTable() {
    var filtered = filterCube();
    var tree = buildHierarchy(filtered);
    var tbody = document.getElementById('process-tbody');
    var html = '';
    var grandQ = 0, grandLd = 0, grandTt = 0;
    var processes = Object.keys(tree).sort();

    for (var pi = 0; pi < processes.length; pi++) {
        var p = processes[pi];
        var flows = tree[p];
        var pQ = 0, pLd = 0, pTt = 0;
        var flowKeys = Object.keys(flows).sort();

        for (var fi = 0; fi < flowKeys.length; fi++) {
            var f = flowKeys[fi];
            var carts = flows[f];
            var cartKeys = Object.keys(carts);
            for (var ci = 0; ci < cartKeys.length; ci++) {
                pQ += carts[cartKeys[ci]].q;
                pLd += carts[cartKeys[ci]].ld;
                pTt += carts[cartKeys[ci]].tt;
            }
        }
        grandQ += pQ; grandLd += pLd; grandTt += pTt;

        var pMetrics = computeMetrics(pQ, pLd, pTt);
        var pId = 'p-' + pi;

        html += '<tr class="row-level-0 row-toggle" data-target="' + pId + '">';
        html += '<td><span class="toggle-icon">&#9654;</span> ' + p + '</td>';
        html += numCells(pMetrics);
        html += '</tr>';

        for (var fi = 0; fi < flowKeys.length; fi++) {
            var f = flowKeys[fi];
            var carts = flows[f];
            var cartKeys = Object.keys(carts).sort();
            var fQ = 0, fLd = 0, fTt = 0;

            for (var ci = 0; ci < cartKeys.length; ci++) {
                fQ += carts[cartKeys[ci]].q;
                fLd += carts[cartKeys[ci]].ld;
                fTt += carts[cartKeys[ci]].tt;
            }
            var fMetrics = computeMetrics(fQ, fLd, fTt);
            var fId = pId + '-f-' + fi;

            html += '<tr class="row-level-1 row-hidden row-toggle ' + pId + '" data-target="' + fId + '">';
            html += '<td><span class="toggle-icon">&#9654;</span> ' + f + '</td>';
            html += numCells(fMetrics);
            html += '</tr>';

            for (var ci = 0; ci < cartKeys.length; ci++) {
                var c = cartKeys[ci];
                var cMetrics = computeMetrics(carts[c].q, carts[c].ld, carts[c].tt);
                html += '<tr class="row-level-2 row-hidden ' + fId + '">';
                html += '<td>' + c + '</td>';
                html += numCells(cMetrics);
                html += '</tr>';
            }
        }
    }

    var grandMetrics = computeMetrics(grandQ, grandLd, grandTt);
    html += '<tr class="row-total">';
    html += '<td>TOTAL</td>';
    html += numCells(grandMetrics);
    html += '</tr>';

    tbody.innerHTML = html;
    attachToggleListeners();
}


// ================================================================
// RENDER ALL
// ================================================================

function renderAll() {
    if (!CUBE) return;
    renderTable();
    requestAnimationFrame(function() {
        hideLoading();
        updateFiltersBanner();
    });
}


// ================================================================
// EXPAND / COLLAPSE
// ================================================================

function attachToggleListeners() {
    var toggles = document.querySelectorAll('.row-toggle');
    for (var i = 0; i < toggles.length; i++) {
        toggles[i].addEventListener('click', function() {
            var target = this.getAttribute('data-target');
            var children = document.querySelectorAll('.' + target);
            var isExpanded = this.classList.contains('expanded');
            if (isExpanded) {
                this.classList.remove('expanded');
                collapseRecursive(target);
            } else {
                this.classList.add('expanded');
                for (var j = 0; j < children.length; j++) {
                    children[j].classList.remove('row-hidden');
                }
            }
        });
    }
}

function collapseRecursive(parentClass) {
    var children = document.querySelectorAll('.' + parentClass);
    for (var i = 0; i < children.length; i++) {
        children[i].classList.add('row-hidden');
        children[i].classList.remove('expanded');
        var subTarget = children[i].getAttribute('data-target');
        if (subTarget) collapseRecursive(subTarget);
    }
}


// ================================================================
// FILTER HANDLERS
// ================================================================

function renderWithLoading() {
    showLoading();
    requestAnimationFrame(function() { renderAll(); });
}
document.getElementById('filter-process').addEventListener('change', renderWithLoading);
document.getElementById('filter-shift').addEventListener('change', renderWithLoading);

function buildServerUrl() {
    var params = new URLSearchParams();
    var proc = document.getElementById('filter-process').value;
    var shift = document.getElementById('filter-shift').value;
    var week = document.getElementById('filter-week').value;
    var dateFrom = document.getElementById('filter-date-from').value;
    var dateTo = document.getElementById('filter-date-to').value;

    if (proc !== 'All') params.set('process', proc);
    if (shift !== 'All') params.set('shift', shift);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (!dateFrom && !dateTo && week !== 'All') params.set('week', week);

    return '/process/' + (params.toString() ? '?' + params.toString() : '');
}

function reloadForDate() {
    showLoading();
    window.location.href = buildServerUrl();
}
function reloadForWeek() {
    showLoading();
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    window.location.href = buildServerUrl();
}

document.getElementById('filter-date-from').addEventListener('change', reloadForDate);
document.getElementById('filter-date-to').addEventListener('change', reloadForDate);
document.getElementById('filter-week').addEventListener('change', reloadForWeek);


// ================================================================
// EXCEL EXPORT
// ================================================================

function exportData() {
    var filtered = filterCube();
    var tree = buildHierarchy(filtered);
    var rows = [['Process', 'Flow Type', 'Cart Type', 'Quantity', 'Actual Time (hrs)', 'Standard Time (hrs)', 'Productivity %', 'UPH', 'Target UPH', 'UPH %']];

    var processes = Object.keys(tree).sort();
    for (var pi = 0; pi < processes.length; pi++) {
        var p = processes[pi];
        var flows = tree[p];
        var flowKeys = Object.keys(flows).sort();
        for (var fi = 0; fi < flowKeys.length; fi++) {
            var f = flowKeys[fi];
            var carts = flows[f];
            var cartKeys = Object.keys(carts).sort();
            for (var ci = 0; ci < cartKeys.length; ci++) {
                var c = cartKeys[ci];
                var m = computeMetrics(carts[c].q, carts[c].ld, carts[c].tt);
                rows.push([p, f, c, m.qty, m.actualTime, m.standardTime, m.productivity, m.uph, m.targetUph, m.uphPct]);
            }
        }
    }

    var dateFrom = SELECTED_STATE.date_from || '';
    var dateTo = SELECTED_STATE.date_to || '';
    var filename = 'LMS_Process';
    if (dateFrom && dateTo) filename += '_' + dateFrom + '_to_' + dateTo;
    filename += '.xlsx';

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'By Process');
    XLSX.writeFile(wb, filename);
}

document.getElementById('btn-export').addEventListener('click', exportData);


// ================================================================
// RESET & REFRESH
// ================================================================

document.getElementById('btn-reset').addEventListener('click', function() {
    showLoading();
    window.location.href = '/process/';
});

document.getElementById('btn-refresh').addEventListener('click', function() {
    showLoading();
    try {
        sessionStorage.removeItem('lms_process_cache');
        sessionStorage.removeItem('lms_filters_cache');
        sessionStorage.removeItem(TIMER_KEY);
    } catch(e) {}
    window.location.reload();
});


// ================================================================
// AUTO-REFRESH (15 min)
// ================================================================
var REFRESH_INTERVAL = 15 * 60;
var timerEl = document.getElementById('refresh-timer');
var TIMER_KEY = 'lms_timer_process';

// Persist timer across page navigations — only resets on explicit Refresh
function getTimerStart() {
    try {
        var stored = sessionStorage.getItem(TIMER_KEY);
        if (stored) {
            var ts = parseInt(stored, 10);
            var elapsed = Math.floor((Date.now() - ts) / 1000);
            if (elapsed >= REFRESH_INTERVAL) {
                // Timer expired while away — refresh now
                sessionStorage.setItem(TIMER_KEY, String(Date.now()));
                window.location.reload();
                return Date.now();
            }
            return ts;
        }
    } catch(e) {}
    // First visit or storage cleared — start fresh
    var now = Date.now();
    try { sessionStorage.setItem(TIMER_KEY, String(now)); } catch(e) {}
    return now;
}
var timerStart = getTimerStart();

function updateTimer() {
    var left = Math.max(0, REFRESH_INTERVAL - Math.floor((Date.now() - timerStart) / 1000));
    if (left <= 0) {
        try { sessionStorage.setItem(TIMER_KEY, String(Date.now())); } catch(e) {}
        window.location.reload();
        return;
    }
    var mins = Math.floor(left / 60);
    var secs = left % 60;
    timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
}
updateTimer();
setInterval(updateTimer, 1000);


// ================================================================
// INIT — Stale-While-Revalidate
// ================================================================
var CACHE_KEY = 'lms_process_cache';
var FILTER_CACHE_KEY = 'lms_filters_cache';
var CACHE_MAX_AGE = 15 * 60 * 1000;

function populateDropdown(id, opts, sel) {
    var el = document.getElementById(id);
    if (!el || !opts) return;
    var cur = sel || el.value || 'All';
    el.innerHTML = '';
    for (var i = 0; i < opts.length; i++) {
        var o = document.createElement('option');
        o.value = opts[i]; o.textContent = opts[i];
        if (opts[i] === cur) o.selected = true;
        el.appendChild(o);
    }
}
function populateFilters(f, s) {
    if (!f) return;
    populateDropdown('filter-week', f.weeks, s.week);
    populateDropdown('filter-process', f.processes, s.process);
    populateDropdown('filter-shift', f.shifts, s.shift);
    try { sessionStorage.setItem(FILTER_CACHE_KEY, JSON.stringify(f)); } catch(e) {}
}
function getCachedData() {
    try {
        var r = sessionStorage.getItem(CACHE_KEY);
        if (!r) return null;
        var c = JSON.parse(r);
        if (Date.now() - c.timestamp > CACHE_MAX_AGE) return null;
        return c;
    } catch(e) { return null; }
}
function buildApiUrl() {
    var params = new URLSearchParams(window.location.search);
    return '/api/process/' + (params.toString() ? '?' + params.toString() : '');
}
function loadData(skip) {
    if (!skip) {
        var cached = getCachedData();
        if (cached) {
            CUBE = cached.cube || [];
            if (cached.filters) populateFilters(cached.filters, cached.selected || {});
            SELECTED_STATE = cached.selected || {};
            renderAll();
        } else {
            showLoading();
            try { var f = sessionStorage.getItem(FILTER_CACHE_KEY); if (f) populateFilters(JSON.parse(f), {}); } catch(e) {}
        }
    }
    fetch(buildApiUrl())
        .then(function(r) { if (!r.ok) throw new Error('HTTP '+r.status); return r.json(); })
        .then(function(d) {
            var c = (typeof d.cube_json==='string') ? JSON.parse(d.cube_json) : (d.cube_json||[]);
            try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({cube:c,filters:d.filters,selected:d.selected,timestamp:Date.now()})); } catch(e) {}
            CUBE = c;
            SELECTED_STATE = d.selected || {};
            if (d.filters) populateFilters(d.filters, d.selected||{});
            renderAll();
        })
        .catch(function(e) {
            console.error('[LMS] Load failed:', e);
            hideLoading();
            if (!CUBE || !CUBE.length) {
                document.getElementById('process-tbody').innerHTML = '<tr><td colspan="8" style="color:#dc2626;padding:20px;">Failed to load. Try refreshing.</td></tr>';
            }
        });
}
loadData(false);
