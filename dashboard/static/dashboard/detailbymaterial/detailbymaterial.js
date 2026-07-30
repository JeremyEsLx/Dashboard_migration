/* ============================================================
   DETAIL BY MATERIAL — Auto-load + Stale-While-Revalidate
   Horizontal bar chart: Quantity by Process (Plotly)
   ============================================================ */

var CACHE_KEY = 'lms_detailbymaterial_cache';
var TIMER_KEY = 'lms_timer_detailbymaterial';
var CACHE_MAX_AGE = 30 * 60 * 1000;
var REFRESH_INTERVAL = 15 * 60;

var UNITS_RAW = [];

var CALENDAR_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12"/><path d="M5.5 1.5v3"/><path d="M10.5 1.5v3"/></svg>';

function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.split('-');
    return p[1] + '/' + p[2] + '/' + p[0];
}

function showLoading() {
    var banner = document.getElementById('active-filters-banner');
    var icon = document.getElementById('banner-icon');
    var dateEl = document.getElementById('banner-date-range');
    if (banner) banner.classList.add('is-loading');
    if (icon) icon.innerHTML = '<div class="inline-spinner"></div>';
    if (dateEl) dateEl.innerHTML = 'Loading new data\u2026';
}

function hideLoading(df, dt) {
    var banner = document.getElementById('active-filters-banner');
    var icon = document.getElementById('banner-icon');
    var dateEl = document.getElementById('banner-date-range');
    if (banner) banner.classList.remove('is-loading');
    if (icon) icon.innerHTML = CALENDAR_SVG;
    if (dateEl) {
        if (df && dt) {
            dateEl.innerHTML = '<strong>Showing:</strong> ' + fmtDate(df) + ' \u2014 ' + fmtDate(dt);
        }
    }
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

// ================================================================
// RENDER CHART (Plotly horizontal bar)
// ================================================================

function renderUnitsChart(data) {
    var container = document.getElementById('chart-units');
    container.innerHTML = '';
    if (!data || !data.length) {
        container.innerHTML = '<p style="color:#6b7280; text-align:center; padding:40px;">No data found</p>';
        return;
    }

    // Sort ascending so largest bar is at top (Plotly horizontal reverses)
    var sorted = data.slice().sort(function(a, b) { return a.qty - b.qty; });

    var labels = sorted.map(function(d) { return d.process; });
    var values = sorted.map(function(d) { return d.qty; });

    var trace = {
        type: 'bar',
        orientation: 'h',
        x: values,
        y: labels,
        marker: { color: '#3b82f6' },
        text: values.map(function(v) {
            return v >= 1000000 ? (v / 1000000).toFixed(2) + 'M' :
                   v >= 1000 ? (v / 1000).toFixed(1) + 'K' : String(v);
        }),
        textposition: 'outside',
        hovertemplate: '%{y}: %{x:,.0f} units<extra></extra>',
    };

    var layout = {
        margin: { l: 130, r: 60, t: 10, b: 30 },
        xaxis: { title: '', showgrid: true, gridcolor: '#f3f4f6' },
        yaxis: { title: '', automargin: true },
        height: Math.max(250, sorted.length * 45 + 60),
        plot_bgcolor: 'white',
        paper_bgcolor: 'white',
        font: { family: 'Inter, sans-serif', size: 12 },
    };

    Plotly.newPlot(container, [trace], layout, { responsive: true, displayModeBar: false });
}

// ================================================================
// FETCH DATA
// ================================================================

function loadData(skipCache) {
    if (!skipCache) {
        var cached = getCachedData();
        if (cached) {
            UNITS_RAW = cached.units || [];
            if (cached.selected) {
                if (cached.selected.date_from) document.getElementById('filter-date-from').value = cached.selected.date_from;
                if (cached.selected.date_to) document.getElementById('filter-date-to').value = cached.selected.date_to;
            }
            renderUnitsChart(UNITS_RAW);
            hideLoading(cached.selected.date_from, cached.selected.date_to);
        } else {
            showLoading();
        }
    } else {
        showLoading();
    }

    var df = document.getElementById('filter-date-from').value;
    var dt = document.getElementById('filter-date-to').value;

    var params = new URLSearchParams();
    if (df) params.set('date_from', df);
    if (dt) params.set('date_to', dt);

    fetch('/api/detailbymaterial/?' + params.toString())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var units = (typeof data.units_json === 'string') ? JSON.parse(data.units_json) : (data.units_json || []);
            UNITS_RAW = units;

            // Populate filter dropdowns
            if (data.filters && data.filters.processes) {
                var sel = document.getElementById('filter-process');
                var current = sel.value;
                sel.innerHTML = '<option value="All">All</option>';
                data.filters.processes.forEach(function(p) {
                    sel.innerHTML += '<option value="' + p + '">' + p + '</option>';
                });
                sel.value = current;
            }

            // Set dates
            if (data.selected) {
                if (data.selected.date_from) document.getElementById('filter-date-from').value = data.selected.date_from;
                if (data.selected.date_to) document.getElementById('filter-date-to').value = data.selected.date_to;
            }

            // Cache
            try {
                sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                    units: units,
                    selected: data.selected || {},
                    filters: data.filters || {},
                    timestamp: Date.now()
                }));
            } catch(e) {}

            renderUnitsChart(units);
            hideLoading(data.selected.date_from, data.selected.date_to);
        })
        .catch(function(err) {
            console.error('[DetailByMaterial] Fetch error:', err);
            hideLoading('', '');
            document.getElementById('chart-units').innerHTML = '<p style="color:#dc2626; text-align:center;">Error loading data.</p>';
        });
}

// ================================================================
// EVENT HANDLERS
// ================================================================

// Date change: re-fetch from server
document.getElementById('filter-date-from').addEventListener('change', function() { loadData(true); });
document.getElementById('filter-date-to').addEventListener('change', function() { loadData(true); });

// Reset
document.getElementById('btn-reset').addEventListener('click', function() {
    showLoading();
    try { sessionStorage.removeItem(CACHE_KEY); } catch(e) {}
    window.location.href = '/detailbymaterial/';
});

// Refresh
document.getElementById('btn-refresh').addEventListener('click', function() {
    showLoading();
    try { sessionStorage.removeItem(CACHE_KEY); sessionStorage.removeItem(TIMER_KEY); } catch(e) {}
    window.location.reload();
});

// Export
document.getElementById('btn-export').addEventListener('click', function() {
    if (!UNITS_RAW.length) { alert('No data to export.'); return; }
    var rows = [['Process', 'Quantity']];
    UNITS_RAW.forEach(function(r) { rows.push([r.process, r.qty]); });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Units by Process');
    var df = document.getElementById('filter-date-from').value || '';
    var dt = document.getElementById('filter-date-to').value || '';
    var filename = 'LMS_DetailByMaterial';
    if (df && dt) filename += '_' + df + '_to_' + dt;
    filename += '.xlsx';
    XLSX.writeFile(wb, filename);
});

// ================================================================
// AUTO-REFRESH TIMER (15 min)
// ================================================================

var timerEl = document.getElementById('refresh-timer');

function getTimerStart() {
    try {
        var stored = sessionStorage.getItem(TIMER_KEY);
        if (stored) {
            var ts = parseInt(stored, 10);
            var elapsed = Math.floor((Date.now() - ts) / 1000);
            if (elapsed >= REFRESH_INTERVAL) {
                sessionStorage.setItem(TIMER_KEY, String(Date.now()));
                try { sessionStorage.removeItem(CACHE_KEY); } catch(e) {}
                window.location.reload();
                return Date.now();
            }
            return ts;
        }
    } catch(e) {}
    var now = Date.now();
    try { sessionStorage.setItem(TIMER_KEY, String(now)); } catch(e) {}
    return now;
}

var timerStart = getTimerStart();
function updateTimer() {
    var left = Math.max(0, REFRESH_INTERVAL - Math.floor((Date.now() - timerStart) / 1000));
    if (left <= 0) {
        try { sessionStorage.setItem(TIMER_KEY, String(Date.now())); sessionStorage.removeItem(CACHE_KEY); } catch(e) {}
        window.location.reload();
        return;
    }
    var mins = Math.floor(left / 60);
    var secs = left % 60;
    if (timerEl) timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
}
updateTimer();
setInterval(updateTimer, 1000);

// ================================================================
// INIT
// ================================================================
loadData(false);
