/**
 * Strong Start — Client-side Logic
 *
 * Widgets:
 *   1. KPI: Total Inactive Hours (sum of Duration)
 *   2. Bar chart: Inactive Hours by Shift
 *   3. Bar chart: Inactive Hours by Date
 *   4. Detail table: Date, User Name, Supervisor, Process, Shift, Duration
 *
 * Cube rows: { d, u, s, p, sh, ld }
 *   d=Date, u=User Name, s=Supervisor, p=Process, sh=Shift, ld=Line Day Activity
 *   Duration (hrs) = ld / 60
 *
 * Client-side filters: Shift, Supervisor (instant)
 * Server-side filters: Date Range (reload)
 */

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

    if (dateFrom && dateTo) {
        if (dateFrom === dateTo) {
            bannerDate.innerHTML = '<strong>Showing:</strong> ' + formatDateNice(dateFrom);
        } else {
            bannerDate.innerHTML = '<strong>Showing:</strong> ' + formatDateNice(dateFrom) + ' &mdash; ' + formatDateNice(dateTo);
        }
    } else if (dateFrom) {
        bannerDate.innerHTML = '<strong>Showing:</strong> From ' + formatDateNice(dateFrom);
    } else {
        bannerDate.innerHTML = '<strong>Showing:</strong> Current Week';
    }

    var dateFromInput = document.getElementById('filter-date-from');
    var dateToInput = document.getElementById('filter-date-to');
    if (dateFromInput && dateFrom && !dateFromInput.value) dateFromInput.value = dateFrom;
    if (dateToInput && dateTo && !dateToInput.value) dateToInput.value = dateTo;

    var chips = [];
    var shift = document.getElementById('filter-shift').value;
    var supervisor = document.getElementById('filter-supervisor').value;
    var dateFilter = document.getElementById('filter-date').value;
    var employee = document.getElementById('filter-employee').value.trim();
    if (shift && shift !== 'All') chips.push({ label: 'Shift', value: shift });
    if (supervisor && supervisor !== 'All') chips.push({ label: 'Supervisor', value: supervisor });
    if (dateFilter && dateFilter !== 'All') chips.push({ label: 'Date', value: dateFilter });
    if (employee) chips.push({ label: 'Employee', value: employee });

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

function filterCube() {
    var shift = document.getElementById('filter-shift').value;
    var supervisor = document.getElementById('filter-supervisor').value;
    var dateFilter = document.getElementById('filter-date').value;
    var employee = document.getElementById('filter-employee').value.trim().toLowerCase();
    var rows = CUBE;
    if (shift && shift !== 'All') {
        rows = rows.filter(function(r) { return r.sh === shift; });
    }
    if (supervisor && supervisor !== 'All') {
        rows = rows.filter(function(r) { return r.s === supervisor; });
    }
    if (dateFilter && dateFilter !== 'All') {
        rows = rows.filter(function(r) { return r.d === dateFilter; });
    }
    if (employee) {
        rows = rows.filter(function(r) {
            return (r.u && r.u.toLowerCase().indexOf(employee) !== -1) ||
                   (r.fn && r.fn.toLowerCase().indexOf(employee) !== -1);
        });
    }
    return rows;
}


// ================================================================
// RENDER KPI
// ================================================================

function renderKPI(filtered) {
    var totalLd = 0;
    for (var i = 0; i < filtered.length; i++) {
        totalLd += filtered[i].ld;
    }
    var hours = (totalLd / 60);
    var el = document.getElementById('kpi-hours');
    var skel = document.getElementById('kpi-skel');
    el.textContent = Math.round(hours);
    el.style.display = '';
    if (skel) skel.style.display = 'none';
}


// ================================================================
// RENDER CHARTS
// ================================================================

var CHART_COLORS = {
    'A': '#10b981',
    'B': '#3b82f6',
    'C': '#f59e0b',
    'D': '#8b5cf6',
    'NO SHIFT MAPPED': '#9ca3af'
};

function renderShiftChart(filtered) {
    var byShift = {};
    for (var i = 0; i < filtered.length; i++) {
        var sh = filtered[i].sh || 'N/A';
        if (!byShift[sh]) byShift[sh] = 0;
        byShift[sh] += filtered[i].ld / 60;
    }

    // Sort by value ascending (so highest appears at top in horizontal bar)
    var entries = Object.keys(byShift).map(function(s) { return { shift: s, val: byShift[s] }; });
    entries.sort(function(a, b) { return a.val - b.val; });
    var shifts = entries.map(function(e) { return e.shift; });
    var values = entries.map(function(e) { return Math.round(e.val * 100) / 100; });

    Plotly.react('chart-shift', [{
        y: shifts,
        x: values,
        type: 'bar',
        orientation: 'h',
        marker: { color: '#d4979a' },
        text: values.map(function(v) { return Math.round(v); }),
        textposition: 'inside',
        insidetextanchor: 'end',
        textfont: { size: 12, color: '#fff', family: 'Inter' },
        cliponaxis: false,
        hoverinfo: 'x+y'
    }], {
        margin: { t: 5, b: 20, l: 22, r: 10 },
        xaxis: { title: '', showgrid: false, showticklabels: false, zeroline: false },
        yaxis: { title: '', automargin: true, tickfont: { size: 12, color: '#374151' } },
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
        font: { family: 'Inter', size: 11 },
        bargap: 0.35
    }, { responsive: true, displayModeBar: false, staticPlot: false });
}

function renderDateChart(filtered) {
    var byDate = {};
    for (var i = 0; i < filtered.length; i++) {
        var d = filtered[i].d || '';
        if (!byDate[d]) byDate[d] = 0;
        byDate[d] += filtered[i].ld / 60;
    }

    var dates = Object.keys(byDate).sort();
    var values = dates.map(function(d) { return Math.round(byDate[d] * 100) / 100; });

    // Format dates for display (MM/DD)
    var shortDates = dates.map(function(d) {
        var parts = d.split('-');
        return parts[1] + '/' + parts[2];
    });

    Plotly.react('chart-date', [{
        x: shortDates,
        y: values,
        type: 'bar',
        marker: { color: '#d4979a' },
        text: values.map(function(v) { return Math.round(v); }),
        textposition: 'inside',
        insidetextanchor: 'end',
        textfont: { size: 11, color: '#fff', family: 'Inter' },
        cliponaxis: false,
        hoverinfo: 'x+y'
    }], {
        margin: { t: 8, b: 28, l: 35, r: 8 },
        yaxis: { title: '', gridcolor: '#f3f4f6', showgrid: true, zeroline: false, tickfont: { size: 10, color: '#9ca3af' } },
        xaxis: { title: '', type: 'category', tickangle: 0, tickfont: { size: 10, color: '#6b7280' } },
        paper_bgcolor: 'white',
        plot_bgcolor: 'white',
        font: { family: 'Inter', size: 11 },
        bargap: 0.3
    }, { responsive: true, displayModeBar: false, staticPlot: false });
}


// ================================================================
// RENDER DETAIL TABLE
// ================================================================

function renderTable(filtered) {
    var tbody = document.getElementById('detail-tbody');
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="padding:20px;color:#6b7280;">No data for current filters.</td></tr>';
        return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var r = filtered[i];
        var duration = (r.ld / 60);
        html += '<tr>';
        html += '<td>' + r.d + '</td>';
        html += '<td>' + r.u + '</td>';
        html += '<td>' + (r.fn || '') + '</td>';
        html += '<td>' + r.s + '</td>';
        html += '<td>' + r.p + '</td>';
        html += '<td>' + (r.fst || '') + '</td>';
        html += '<td>' + r.sh + '</td>';
        html += '<td class="col-num">' + duration.toFixed(2) + '</td>';
        html += '</tr>';
    }
    tbody.innerHTML = html;
}


// ================================================================
// RENDER ALL
// ================================================================

function renderAll() {
    if (!CUBE) return;
    populateDateDropdown();
    var filtered = filterCube();
    renderKPI(filtered);
    renderShiftChart(filtered);
    renderDateChart(filtered);
    renderTable(filtered);
    requestAnimationFrame(function() {
        hideLoading();
        updateFiltersBanner();
    });
}


// ================================================================
// FILTER HANDLERS
// ================================================================

function renderWithLoading() {
    showLoading();
    requestAnimationFrame(function() { renderAll(); });
}
document.getElementById('filter-shift').addEventListener('change', renderWithLoading);
document.getElementById('filter-supervisor').addEventListener('change', renderWithLoading);
document.getElementById('filter-date').addEventListener('change', renderWithLoading);

// Employee search — debounce to avoid re-render on every keystroke
var employeeTimeout = null;
document.getElementById('filter-employee').addEventListener('input', function() {
    clearTimeout(employeeTimeout);
    employeeTimeout = setTimeout(function() { renderWithLoading(); }, 300);
});

function populateDateDropdown() {
    if (!CUBE) return;
    var dates = {};
    for (var i = 0; i < CUBE.length; i++) {
        if (CUBE[i].d) dates[CUBE[i].d] = true;
    }
    var sorted = Object.keys(dates).sort().reverse();
    var el = document.getElementById('filter-date');
    var cur = el.value || 'All';
    el.innerHTML = '<option value="All">All Dates</option>';
    for (var i = 0; i < sorted.length; i++) {
        var o = document.createElement('option');
        o.value = sorted[i]; o.textContent = sorted[i];
        if (sorted[i] === cur) o.selected = true;
        el.appendChild(o);
    }
}

function reloadForDate() {
    showLoading();
    var params = new URLSearchParams();
    var shift = document.getElementById('filter-shift').value;
    var supervisor = document.getElementById('filter-supervisor').value;
    var dateFrom = document.getElementById('filter-date-from').value;
    var dateTo = document.getElementById('filter-date-to').value;
    if (shift !== 'All') params.set('shift', shift);
    if (supervisor !== 'All') params.set('supervisor', supervisor);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    window.location.href = '/strongstart/' + (params.toString() ? '?' + params.toString() : '');
}
document.getElementById('filter-date-from').addEventListener('change', reloadForDate);
document.getElementById('filter-date-to').addEventListener('change', reloadForDate);


// ================================================================
// EXCEL EXPORT
// ================================================================

function exportData() {
    var filtered = filterCube();
    var rows = [['Date', 'User Name', 'Full Name', 'Supervisor', 'Process', 'First Scan Time', 'Shift', 'Duration (hrs)']];
    for (var i = 0; i < filtered.length; i++) {
        var r = filtered[i];
        rows.push([r.d, r.u, r.fn || '', r.s, r.p, r.fst || '', r.sh, Math.round((r.ld / 60) * 100) / 100]);
    }

    var dateFrom = SELECTED_STATE.date_from || '';
    var dateTo = SELECTED_STATE.date_to || '';
    var filename = 'LMS_StrongStart';
    if (dateFrom && dateTo) filename += '_' + dateFrom + '_to_' + dateTo;
    filename += '.xlsx';

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Strong Start');
    XLSX.writeFile(wb, filename);
}
document.getElementById('btn-export').addEventListener('click', exportData);


// ================================================================
// RESET & REFRESH
// ================================================================

document.getElementById('btn-reset').addEventListener('click', function() {
    showLoading();
    window.location.href = '/strongstart/';
});

document.getElementById('btn-refresh').addEventListener('click', function() {
    showLoading();
    try {
        sessionStorage.removeItem('lms_strongstart_cache');
        sessionStorage.removeItem('lms_filters_cache');
    } catch(e) {}
    window.location.reload();
});


// ================================================================
// AUTO-REFRESH (15 min)
// ================================================================
var REFRESH_INTERVAL = 15 * 60;
var timerEl = document.getElementById('refresh-timer');
var timerStart = Date.now();

function updateTimer() {
    var left = Math.max(0, REFRESH_INTERVAL - Math.floor((Date.now() - timerStart) / 1000));
    if (left <= 0) { window.location.reload(); return; }
    var mins = Math.floor(left / 60);
    var secs = left % 60;
    timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
}
updateTimer();
setInterval(updateTimer, 1000);


// ================================================================
// INIT — Stale-While-Revalidate
// ================================================================
var CACHE_KEY = 'lms_strongstart_cache';
var FILTER_CACHE_KEY = 'lms_filters_cache';
var CACHE_MAX_AGE = 30 * 60 * 1000; // 30min (historical data, rarely changes)

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
    populateDropdown('filter-shift', f.shifts, s.shift);
    populateDropdown('filter-supervisor', f.supervisors, s.supervisor);
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
    return '/api/strongstart/' + (params.toString() ? '?' + params.toString() : '');
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
                document.getElementById('detail-tbody').innerHTML = '<tr><td colspan="8" style="color:#dc2626;padding:20px;">Failed to load. Try refreshing.</td></tr>';
            }
        });
}
loadData(false);
