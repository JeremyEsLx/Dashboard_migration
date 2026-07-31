/* ============================================================
   DETAIL BY MATERIAL - Page-specific logic
   Uses LMS core library (lms-core.js) for shared utilities.
   ============================================================ */

var cache = new LMS.Cache('lms_detailbymaterial_cache', 30);

var UNITS_RAW = [];
var DETAIL_RAW = [];
var DETAIL_FILTERED = [];
var TOTAL_ROWS = 0;
var TOTAL_QTY = 0;

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
// DETAIL TABLE + PAGINATION
// ================================================================

var DETAIL_COLS = ['Date', 'Time', 'Process', 'Movement', 'User Name',
    'Source Storage Type', 'Source Storage Bin',
    'Destination Storage Type', 'Destination Storage Bin',
    'Material', 'Grid Value', 'Stock Category', 'Quantity'];

function applyClientFilters() {
    var proc = document.getElementById('filter-process').value;
    var mov = document.getElementById('filter-movement').value;
    var mat = (document.getElementById('filter-material').value || '').toLowerCase();
    var grid = (document.getElementById('filter-grid').value || '').toLowerCase();
    var stockCat = (document.getElementById('filter-stock-cat').value || '').toLowerCase();
    var destBin = (document.getElementById('filter-dest-bin').value || '').toLowerCase();
    var srcBin = (document.getElementById('filter-source-bin').value || '').toLowerCase();

    DETAIL_FILTERED = DETAIL_RAW.filter(function(r) {
        if (proc !== 'All' && r['Process'] !== proc) return false;
        if (mov !== 'All' && r['Movement'] !== mov) return false;
        if (mat && (r['Material'] || '').toLowerCase().indexOf(mat) === -1) return false;
        if (grid && (r['Grid Value'] || '').toLowerCase().indexOf(grid) === -1) return false;
        if (stockCat && (r['Stock Category'] || '').toLowerCase().indexOf(stockCat) === -1) return false;
        if (destBin && (r['Destination Storage Bin'] || '').toLowerCase().indexOf(destBin) === -1) return false;
        if (srcBin && (r['Source Storage Bin'] || '').toLowerCase().indexOf(srcBin) === -1) return false;
        return true;
    });

    renderDetailTable();
}

function renderDetailTable() {
    var tbody = document.getElementById('detail-tbody');

    if (!DETAIL_FILTERED.length) {
        tbody.innerHTML = '<tr><td colspan="13" style="text-align:center; color:#6b7280; padding:20px;">No data</td></tr>';
    } else {
        var html = '';
        DETAIL_FILTERED.forEach(function(row) {
            html += '<tr>';
            DETAIL_COLS.forEach(function(col) {
                html += '<td>' + (row[col] != null ? row[col] : '') + '</td>';
            });
            html += '</tr>';
        });
        // Total row (server-side total qty)
        html += '<tr class="total-row">';
        html += '<td colspan="12"><strong>Total</strong></td>';
        html += '<td><strong>' + TOTAL_QTY.toLocaleString() + '</strong></td>';
        html += '</tr>';
        tbody.innerHTML = html;
    }

    // Update count
    var countEl = document.getElementById('detail-count');
    if (countEl) {
        if (TOTAL_ROWS > DETAIL_FILTERED.length) {
            countEl.textContent = 'Showing ' + DETAIL_FILTERED.length.toLocaleString() + ' of ' + TOTAL_ROWS.toLocaleString() + ' rows';
        } else {
            countEl.textContent = DETAIL_FILTERED.length.toLocaleString() + ' rows';
        }
    }
}

// ================================================================
// FETCH DATA
// ================================================================

function loadData(skipCache) {
    if (!skipCache) {
        var cached = cache.get();
        if (cached) {
            UNITS_RAW = cached.units || [];
            DETAIL_RAW = cached.detail || [];
            DETAIL_FILTERED = DETAIL_RAW;
            TOTAL_ROWS = cached.total_rows || DETAIL_RAW.length;
            TOTAL_QTY = cached.total_qty || 0;
            if (cached.selected) {
                if (cached.selected.date_from) document.getElementById('filter-date-from').value = cached.selected.date_from;
                if (cached.selected.date_to) document.getElementById('filter-date-to').value = cached.selected.date_to;
            }
            renderUnitsChart(UNITS_RAW);
            renderDetailTable();
            LMS.hideLoading(cached.selected.date_from, cached.selected.date_to);
        } else {
            LMS.showLoading();
        }
    } else {
        LMS.showLoading();
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

            var detail = (typeof data.detail_json === 'string') ? JSON.parse(data.detail_json) : (data.detail_json || []);
            DETAIL_RAW = detail;
            DETAIL_FILTERED = detail;
            TOTAL_ROWS = data.total_rows || detail.length;
            TOTAL_QTY = data.total_qty || 0;
            renderDetailTable();

            // Populate filter dropdowns using shared utility
            if (data.filters) {
                LMS.populateDropdown('filter-process', data.filters.processes);
                LMS.populateDropdown('filter-movement', data.filters.movements);
            }

            // Set dates
            if (data.selected) {
                if (data.selected.date_from) document.getElementById('filter-date-from').value = data.selected.date_from;
                if (data.selected.date_to) document.getElementById('filter-date-to').value = data.selected.date_to;
            }

            // Cache
            cache.set({
                units: units,
                detail: detail,
                total_rows: TOTAL_ROWS,
                total_qty: TOTAL_QTY,
                selected: data.selected || {},
                filters: data.filters || {},
            });

            renderUnitsChart(units);
            LMS.hideLoading(data.selected.date_from, data.selected.date_to);
        })
        .catch(function(err) {
            console.error('[DetailByMaterial] Fetch error:', err);
            LMS.hideLoading('', '');
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
    LMS.showLoading();
    cache.clear();
    window.location.href = '/detailbymaterial/';
});

// Refresh
document.getElementById('btn-refresh').addEventListener('click', function() {
    LMS.showLoading();
    cache.clear();
    timer.reset();
    window.location.reload();
});

// Export (client-side, instant - uses shared LMS.exportXLSX)
document.getElementById('btn-export').addEventListener('click', function() {
    if (!UNITS_RAW.length && !DETAIL_FILTERED.length) { alert('No data to export.'); return; }
    // Sheet 1: Units by Process
    var unitsRows = [['Process', 'Quantity']];
    UNITS_RAW.forEach(function(r) { unitsRows.push([r.process, r.qty]); });
    // Sheet 2: Details
    var detailRows = [DETAIL_COLS];
    DETAIL_FILTERED.forEach(function(r) {
        detailRows.push(DETAIL_COLS.map(function(c) { return r[c] != null ? r[c] : ''; }));
    });
    detailRows.push([]);
    detailRows.push(['Total', '', '', '', '', '', '', '', '', '', '', '', TOTAL_QTY]);
    var df = document.getElementById('filter-date-from').value || '';
    var dt = document.getElementById('filter-date-to').value || '';
    var filename = 'LMS_DetailByMaterial' + (df && dt ? '_' + df + '_to_' + dt : '') + '.xlsx';
    LMS.exportXLSX([{name: 'Units by Process', rows: unitsRows}, {name: 'Details', rows: detailRows}], filename);
});


// Client-side filter narrowing (dropdowns + text inputs)
document.getElementById('filter-process').addEventListener('change', applyClientFilters);
document.getElementById('filter-movement').addEventListener('change', applyClientFilters);
document.getElementById('filter-material').addEventListener('input', applyClientFilters);
document.getElementById('filter-grid').addEventListener('input', applyClientFilters);
document.getElementById('filter-stock-cat').addEventListener('input', applyClientFilters);
document.getElementById('filter-dest-bin').addEventListener('input', applyClientFilters);
document.getElementById('filter-source-bin').addEventListener('input', applyClientFilters);


// ================================================================
// AUTO-REFRESH TIMER (15 min) - uses shared LMS.Timer
// ================================================================

var timer = new LMS.Timer('lms_timer_detailbymaterial', 15, function() {
    cache.clear();
    window.location.reload();
});

// ================================================================
// INIT
// ================================================================
loadData(false);
