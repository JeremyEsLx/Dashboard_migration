/**
 * Summary Dashboard — Client-side Logic
 *
 * Architecture: "Hybrid Cube"
 *   - Server sends a pre-aggregated cube (Movement x Supervisor x Shift)
 *   - Supervisor/Shift filtering is instant (JavaScript, no server call)
 *   - Date/Week changes trigger a server reload (new dataset)
 *
 * Sections:
 *   1. Cube Filtering & KPI Computation
 *   2. Plotly Render Functions (Gauge, Charts)
 *   3. Master Render
 *   4. Filter Event Handlers
 *   5. Auto-Refresh Timer (15 min, sessionStorage-persisted)
 *   6. Reset & Refresh Buttons
 *   7. Active Filters Banner + Inline Loading
 */

// ================================================================
// CONSTANTS
// ================================================================
const COLOR_GREEN = '#10b981';
const COLOR_YELLOW = '#f59e0b';
const COLOR_ORANGE = '#f97316';
const COLOR_PINK = '#f87171';
const COLOR_RED = '#dc2626';
const GRID_COLOR = '#f3f4f6';
const REFRESH_INTERVAL = 15 * 60; // seconds


// ================================================================
// INLINE LOADING (banner-based, non-blocking)
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
    // Banner text gets updated by updateFiltersBanner() on next renderAll()
}


// ================================================================
// ACTIVE FILTERS BANNER
// ================================================================

var SELECTED_STATE = {}; // Populated after API response

function formatDateNice(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

function isToday(dateStr) {
    if (!dateStr) return false;
    var today = new Date();
    var y = today.getFullYear();
    var m = String(today.getMonth() + 1).padStart(2, '0');
    var day = String(today.getDate()).padStart(2, '0');
    return dateStr === y + '-' + m + '-' + day;
}

function updateFiltersBanner() {
    var bannerDate = document.getElementById('banner-date-range');
    var bannerChips = document.getElementById('banner-chips');
    if (!bannerDate || !bannerChips) return;

    // Date display
    var dateVal = SELECTED_STATE.date || '';
    var week = SELECTED_STATE.week || 'All';

    if (dateVal) {
        if (isToday(dateVal)) {
            bannerDate.innerHTML = '<strong>Showing:</strong> Today &mdash; ' + formatDateNice(dateVal);
        } else {
            bannerDate.innerHTML = '<strong>Showing:</strong> ' + formatDateNice(dateVal);
        }
    } else if (week && week !== 'All') {
        bannerDate.innerHTML = '<strong>Showing:</strong> Week ' + week;
    } else {
        bannerDate.innerHTML = '<strong>Showing:</strong> Today';
    }

    // Filter chips
    var chips = [];
    var sup = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;

    if (sup && sup !== 'All') chips.push({ label: 'Supervisor', value: sup });
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
// KPI COLOR HELPER
// ================================================================

function getUphPctColor(pct) {
    if (pct >= 95) return '#22c55e';  // Green (Power BI: >= 0.95)
    if (pct >= 80) return '#eab308';  // Yellow (Power BI: >= 0.8)
    return '#dc2626';                 // Red (Power BI: < 0.8)
}

function getProductivityColor(pct) {
    if (pct <= 0)    return '#059669';
    if (pct <= 15)   return '#65a30d';
    if (pct <= 30)   return '#f59e0b';
    if (pct <= 50)   return '#f97316';
    if (pct <= 80)   return '#ef4444';
    return '#dc2626';
}


// ================================================================
// 1. CUBE FILTERING & KPI COMPUTATION
// ================================================================

function filterCube(supervisor, shift) {
    var rows = CUBE;
    if (supervisor && supervisor !== 'All') {
        rows = rows.filter(r => r.s === supervisor);
    }
    if (shift && shift !== 'All') {
        rows = rows.filter(r => r.sh === shift);
    }
    return rows;
}

function computeAll(filtered) {
    var totalQty = 0, totalLd = 0, totalTt = 0;
    for (var i = 0; i < filtered.length; i++) {
        totalQty += filtered[i].q;
        totalLd += filtered[i].ld;
        totalTt += filtered[i].tt;
    }

    var uph = totalLd > 0 ? Math.round(totalQty / (totalLd / 60)) : 0;
    var targetUph = totalTt > 0 ? Math.round(totalQty / totalTt) : 0;
    var uphPct = targetUph > 0 ? Math.round((uph / targetUph) * 100) : 0;
    var actualTime = Math.round(totalLd / 60 * 100) / 100;
    var standardTime = Math.round(totalTt * 100) / 100;
    var productivity = standardTime > 0 ? Math.round((actualTime / standardTime - 1) * 100) : 0;

    var byMovement = {};
    for (var i = 0; i < filtered.length; i++) {
        var r = filtered[i];
        if (!byMovement[r.m]) byMovement[r.m] = {q: 0, ld: 0, tt: 0};
        byMovement[r.m].q += r.q;
        byMovement[r.m].ld += r.ld;
        byMovement[r.m].tt += r.tt;
    }

    var qtyEntries = Object.entries(byMovement).map(([m, v]) => [m, Math.round(v.q)]);
    qtyEntries.sort((a, b) => b[1] - a[1]);

    var targetEntries = Object.entries(byMovement).map(([m, v]) => {
        var pct = v.ld > 0 ? Math.round(v.tt * 60 / v.ld * 100) : 0;
        return [m, pct];
    });
    targetEntries.sort((a, b) => b[1] - a[1]);

    var prodEntries = Object.entries(byMovement).map(([m, v]) => {
        var p = v.tt > 0 ? Math.round(((v.ld / 60) / v.tt - 1) * 100) : 0;
        return [m, p];
    });
    prodEntries.sort((a, b) => a[1] - b[1]);

    return {
        uph: uph, targetUph: targetUph, uphPct: uphPct,
        actualTime: actualTime, standardTime: standardTime,
        productivity: productivity,
        qtyByProcess: qtyEntries, targetByProcess: targetEntries,
        prodByProcess: prodEntries
    };
}


// ================================================================
// 2. PLOTLY RENDER FUNCTIONS
// ================================================================

function renderGauge(uph, target) {
    // Dynamic max: use target with 20% headroom (like Power BI gauge)
    var gaugeMax = Math.max(target, uph) * 1.2;
    gaugeMax = Math.ceil(gaugeMax / 50) * 50; // Round up to nearest 50

    // Color bar based on Power BI UPH rules: >=0.95 green, >=0.8 yellow, <0.8 red
    var uphPct = target > 0 ? (uph / target * 100) : 0;
    var barColor = uphPct >= 95 ? '#22c55e' : uphPct >= 80 ? '#eab308' : '#dc2626';

    Plotly.react('gauge-container', [{
        type: 'indicator',
        mode: 'gauge+number',
        value: uph,
        number: {
            font: { size: 44, color: '#111827', family: 'Inter, sans-serif' },
            suffix: ''
        },
        gauge: {
            shape: 'angular',
            axis: {
                range: [0, gaugeMax],
                tickwidth: 1,
                tickcolor: '#d1d5db',
                dtick: Math.round(gaugeMax / 5),
                tickfont: { size: 10, color: '#9ca3af', family: 'Inter' }
            },
            bar: { color: barColor, thickness: 0.2 },
            bgcolor: '#f3f4f6',
            borderwidth: 0,
            steps: [
                { range: [0, target * 0.8], color: '#fef2f2' },
                { range: [target * 0.8, target * 0.95], color: '#fef9c3' },
                { range: [target * 0.95, gaugeMax], color: '#dcfce7' }
            ],
            threshold: {
                line: { color: '#1d4ed8', width: 3 },
                thickness: 0.8,
                value: target
            }
        }
    }], {
        margin: { t: 18, b: 32, l: 20, r: 20 },
        height: 200,
        paper_bgcolor: 'transparent',
        font: { family: 'Inter, sans-serif' },
        annotations: [{
            x: 0.5, y: -0.18,
            text: '<b>Target: ' + target + '</b>',
            showarrow: false,
            font: { size: 13, color: '#1d4ed8', family: 'Inter' }
        }]
    }, { responsive: true, displayModeBar: false });
}

function renderKPIs(data) {
    var uphEl = document.getElementById('kpi-uph-pct');
    uphEl.textContent = data.uphPct + '%';
    uphEl.style.color = getUphPctColor(data.uphPct);

    document.getElementById('kpi-actual').textContent = data.actualTime;
    document.getElementById('kpi-standard').textContent = data.standardTime;

    var prodEl = document.getElementById('kpi-productivity');
    prodEl.textContent = data.productivity + '%';
    prodEl.style.color = getProductivityColor(data.productivity);
}

function renderQtyChart(entries) {
    var labels = entries.map(e => e[0]).reverse();
    var values = entries.map(e => e[1]).reverse();
    Plotly.react('chart-quantity', [{
        type: 'bar', y: labels, x: values, orientation: 'h',
        text: values.map(v => v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v),
        textposition: 'outside',
        marker: {
            color: '#86efac',  // All bars green (matches Power BI)
            line: { width: 0 }
        },
        hovertemplate: '%{y}: %{x:,.0f}<extra></extra>'
    }], {
        margin: { t: 5, b: 30, l: 110, r: 50 },
        xaxis: { title: '', gridcolor: GRID_COLOR },
        yaxis: { automargin: true },
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
    }, { responsive: true, displayModeBar: false });
}

function renderTargetChart(entries) {
    var labels = entries.map(e => e[0]).reverse();
    var values = entries.map(e => e[1]).reverse();
    Plotly.react('chart-uph-target', [{
        type: 'bar', y: labels, x: values, orientation: 'h',
        text: values.map(v => v + '%'),
        textposition: 'outside',
        marker: {
            color: values.map(v => {
                if (v >= 95) return '#86efac';  // Green (Power BI: >= 0.95)
                if (v >= 80) return '#fde047';  // Yellow (Power BI: >= 0.8)
                return '#fca5a5';               // Red/Pink (Power BI: < 0.8)
            }),
            line: { width: 0 }
        },
        hovertemplate: '%{y}: %{x}%<extra></extra>'
    }], {
        margin: { t: 5, b: 30, l: 120, r: 55 },
        xaxis: { title: '', range: [0, Math.max(...values, 0) * 1.15], gridcolor: GRID_COLOR },
        yaxis: { automargin: true },
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
    }, { responsive: true, displayModeBar: false });
}

function renderProdChart(entries) {
    var labels = entries.map(e => e[0]).reverse();
    var values = entries.map(e => e[1]).reverse();
    var mn = Math.min(...values, 0);
    var mx = Math.max(...values, 0);
    Plotly.react('chart-productivity', [{
        type: 'bar', y: labels, x: values, orientation: 'h',
        text: values.map(v => v + '%'),
        textposition: 'auto',
        marker: {
            color: values.map(v => {
                if (v <= 5)  return '#86efac';  // Green (Power BI: <= 0.05)
                if (v <= 20) return '#fde047';  // Yellow (Power BI: <= 0.2)
                return '#fca5a5';               // Pink (Power BI: > 0.2)
            }),
            line: { width: 0 }
        },
        hovertemplate: '%{y}: %{x}%<extra></extra>'
    }], {
        margin: { t: 5, b: 30, l: 120, r: 55 },
        yaxis: { automargin: true },
        xaxis: { range: [mn * 1.15, mx * 1.15], gridcolor: GRID_COLOR, zeroline: true, zerolinecolor: '#94a3b8' },
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
    }, { responsive: true, displayModeBar: false });
}


// ================================================================
// 3. MASTER RENDER
// ================================================================

function renderAll() {
    if (!CUBE) return;
    var supervisor = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;
    var filtered = filterCube(supervisor, shift);
    var data = computeAll(filtered);
    renderGauge(data.uph, data.targetUph);
    renderKPIs(data);
    renderQtyChart(data.qtyByProcess);
    renderTargetChart(data.targetByProcess);
    renderProdChart(data.prodByProcess);
    // Wait for browser to paint charts before announcing "ready"
    requestAnimationFrame(function() {
        hideLoading();
        updateFiltersBanner();
    });
}


// ================================================================
// 4. FILTER EVENT HANDLERS
// ================================================================

// Client-side filters -> show loading, then re-render after paint
function renderWithLoading() {
    showLoading();
    requestAnimationFrame(function() {
        renderAll();
    });
}
document.getElementById('filter-supervisor').addEventListener('change', renderWithLoading);
document.getElementById('filter-shift').addEventListener('change', renderWithLoading);

function reloadForDate() {
    showLoading();
    var params = new URLSearchParams();
    var sup = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;
    var dateVal = document.getElementById('filter-date').value;
    if (sup !== 'All') params.set('supervisor', sup);
    if (shift !== 'All') params.set('shift', shift);
    if (dateVal) params.set('date', dateVal);
    preserveTimer();
    window.location.href = '/' + (params.toString() ? '?' + params.toString() : '');
}

function reloadForWeek() {
    showLoading();
    var params = new URLSearchParams();
    var sup = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;
    var week = document.getElementById('filter-week').value;
    if (sup !== 'All') params.set('supervisor', sup);
    if (shift !== 'All') params.set('shift', shift);
    if (week !== 'All') params.set('week', week);
    preserveTimer();
    window.location.href = '/' + (params.toString() ? '?' + params.toString() : '');
}

document.getElementById('filter-date').addEventListener('change', reloadForDate);
document.getElementById('filter-week').addEventListener('change', reloadForWeek);


// ================================================================
// 5. AUTO-REFRESH TIMER (15 min)
// ================================================================

var timerEl = document.getElementById('refresh-timer');
var timerStart;

function preserveTimer() {
    sessionStorage.setItem('lms_timer_summary', timerStart.toString());
}

function initTimer() {
    var stored = sessionStorage.getItem('lms_timer_summary');
    if (stored) {
        timerStart = parseInt(stored, 10);
        var elapsed = Math.floor((Date.now() - timerStart) / 1000);
        if (elapsed >= REFRESH_INTERVAL) {
            sessionStorage.removeItem('lms_timer_summary');
            window.location.reload();
            return;
        }
    } else {
        timerStart = Date.now();
        sessionStorage.setItem('lms_timer_summary', timerStart.toString());
    }
}

function getSecondsLeft() {
    var elapsed = Math.floor((Date.now() - timerStart) / 1000);
    return Math.max(0, REFRESH_INTERVAL - elapsed);
}

function updateTimerDisplay() {
    var left = getSecondsLeft();
    var mins = Math.floor(left / 60);
    var secs = left % 60;
    timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
}

function tickTimer() {
    if (getSecondsLeft() <= 0) {
        sessionStorage.removeItem('lms_timer_summary');
        window.location.reload();
    } else {
        updateTimerDisplay();
    }
}

initTimer();
updateTimerDisplay();
setInterval(tickTimer, 1000);


// ================================================================
// 6. RESET & REFRESH BUTTONS
// ================================================================

document.getElementById('btn-reset').addEventListener('click', function() {
    showLoading();
    preserveTimer();
    window.location.href = '/';
});

document.getElementById('btn-refresh').addEventListener('click', function() {
    showLoading();
    sessionStorage.removeItem('lms_timer_summary');
    sessionStorage.removeItem(CACHE_KEY);
    sessionStorage.removeItem(FILTER_CACHE_KEY);
    window.location.reload();
});




// ================================================================
// EXCEL EXPORT (client-side via SheetJS)
// ================================================================

function exportSummary() {
    if (!CUBE) return;

    var supervisor = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;
    var filtered = filterCube(supervisor, shift);

    // Group by movement and compute metrics
    var byMovement = {};
    for (var i = 0; i < filtered.length; i++) {
        var r = filtered[i];
        if (!byMovement[r.m]) byMovement[r.m] = {q: 0, ld: 0, tt: 0};
        byMovement[r.m].q += r.q;
        byMovement[r.m].ld += r.ld;
        byMovement[r.m].tt += r.tt;
    }

    var rows = [['Movement', 'Quantity', 'Actual Time (hrs)', 'Standard Time (hrs)', 'Productivity %', 'UPH', 'Target UPH', 'UPH %']];
    var movements = Object.keys(byMovement).sort();
    for (var i = 0; i < movements.length; i++) {
        var m = movements[i];
        var v = byMovement[m];
        var actualTime = v.ld / 60;
        var standardTime = v.tt;
        var uph = actualTime > 0 ? Math.round(v.q / actualTime) : 0;
        var targetUph = standardTime > 0 ? Math.round(v.q / standardTime) : 0;
        var uphPct = targetUph > 0 ? Math.round((uph / targetUph) * 100) : 0;
        var productivity = standardTime > 0 ? Math.round((actualTime / standardTime - 1) * 100) : 0;
        rows.push([m, Math.round(v.q), Math.round(actualTime * 100) / 100, Math.round(standardTime * 100) / 100, productivity, uph, targetUph, uphPct]);
    }

    // Build filename
    var dateVal = SELECTED_STATE.date || '';
    var week = SELECTED_STATE.week || '';
    var filename = 'LMS_Summary';
    if (dateVal) filename += '_' + dateVal;
    else if (week && week !== 'All') filename += '_Week_' + week;
    filename += '.xlsx';

    var wb = XLSX.utils.book_new();
    var ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Summary');
    XLSX.writeFile(wb, filename);
}

document.getElementById('btn-export').addEventListener('click', exportSummary);

// ================================================================
// INIT — Stale-While-Revalidate with sessionStorage Cache
// ================================================================

var CACHE_KEY = 'lms_summary_cache';
var FILTER_CACHE_KEY = 'lms_filters_cache';
var CACHE_MAX_AGE = 15 * 60 * 1000;

function removeSkeleton() {
    var skels = document.querySelectorAll('.skeleton');
    for (var i = 0; i < skels.length; i++) skels[i].style.display = 'none';
    document.getElementById('kpi-uph-pct').style.display = '';
    document.getElementById('kpi-actual').style.display = '';
    document.getElementById('kpi-standard').style.display = '';
    document.getElementById('kpi-productivity').style.display = '';
    var section = document.getElementById('kpi-section');
    if (section) section.classList.remove('loading');
}

function populateDropdown(selectId, options, selected) {
    var el = document.getElementById(selectId);
    if (!el || !options) return;
    var current = selected || el.value || 'All';
    el.innerHTML = '';
    for (var i = 0; i < options.length; i++) {
        var opt = document.createElement('option');
        opt.value = options[i];
        opt.textContent = options[i];
        if (options[i] === current) opt.selected = true;
        el.appendChild(opt);
    }
}

function populateFilters(filters, selected) {
    if (!filters) return;
    populateDropdown('filter-supervisor', filters.supervisors, selected.supervisor);
    populateDropdown('filter-week', filters.weeks, selected.week);
    populateDropdown('filter-shift', filters.shifts, selected.shift);
    try { sessionStorage.setItem(FILTER_CACHE_KEY, JSON.stringify(filters)); } catch(e) {}
}

function getCachedData() {
    try {
        var raw = sessionStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        var cached = JSON.parse(raw);
        if (Date.now() - cached.timestamp > CACHE_MAX_AGE) {
            sessionStorage.removeItem(CACHE_KEY);
            return null;
        }
        return cached;
    } catch(e) { return null; }
}

function setCacheData(cube, filters, selected) {
    try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
            cube: cube,
            filters: filters,
            selected: selected,
            timestamp: Date.now()
        }));
    } catch(e) {}
}

function buildApiUrl() {
    var params = new URLSearchParams(window.location.search);
    return '/api/summary/' + (params.toString() ? '?' + params.toString() : '');
}

function hydrateFromData(data) {
    if (typeof data.cube_json === 'string') {
        CUBE = JSON.parse(data.cube_json);
    } else if (Array.isArray(data.cube_json)) {
        CUBE = data.cube_json;
    } else if (Array.isArray(data.cube)) {
        CUBE = data.cube;
    } else {
        CUBE = [];
    }
    SELECTED_STATE = data.selected || {};
    if (data.filters) {
        populateFilters(data.filters, data.selected || {});
    }
    removeSkeleton();
    renderAll();
}

function loadData(skipCache) {
    if (!skipCache) {
        var cached = getCachedData();
        if (cached) {
            console.log('[LMS] Rendering from cache (age: ' +
                Math.round((Date.now() - cached.timestamp)/1000) + 's)');
            hydrateFromData(cached);
        } else {
            showLoading();
            try {
                var f = sessionStorage.getItem(FILTER_CACHE_KEY);
                if (f) populateFilters(JSON.parse(f), {});
            } catch(e) {}
        }
    }

    fetch(buildApiUrl())
        .then(function(resp) {
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            return resp.json();
        })
        .then(function(data) {
            var cube = (typeof data.cube_json === 'string') ? JSON.parse(data.cube_json) : (data.cube_json || []);
            setCacheData(cube, data.filters, data.selected);
            CUBE = cube;
            SELECTED_STATE = data.selected || {};
            if (data.filters) populateFilters(data.filters, data.selected || {});
            removeSkeleton();
            renderAll();
        })
        .catch(function(err) {
            console.error('[LMS] Failed to load summary data:', err);
            hideLoading();
            if (!CUBE || CUBE.length === 0) {
                removeSkeleton();
                document.getElementById('kpi-uph-pct').textContent = '--';
                document.getElementById('kpi-actual').textContent = 'Load failed';
                document.getElementById('kpi-standard').textContent = '';
                document.getElementById('kpi-productivity').textContent = '';
            }
        });
}

loadData(false);
