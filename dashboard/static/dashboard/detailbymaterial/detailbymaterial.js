/* ============================================================
   DETAIL BY MATERIAL - Search-first page
   User must search by Material and/or Grid Value.
   Uses LMS core library (lms-core.js) for shared utilities.
   ============================================================ */

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
    var gridVal = document.getElementById('filter-grid-value').value;
    var proc = document.getElementById('filter-process').value;
    var mov = document.getElementById('filter-movement').value;
    var stockCat = (document.getElementById('filter-stock-cat').value || '').toLowerCase();
    var destBin = (document.getElementById('filter-dest-bin').value || '').toLowerCase();
    var srcBin = (document.getElementById('filter-source-bin').value || '').toLowerCase();

    DETAIL_FILTERED = DETAIL_RAW.filter(function(r) {
        if (gridVal !== 'All' && r['Grid Value'] !== gridVal) return false;
        if (proc !== 'All' && r['Process'] !== proc) return false;
        if (mov !== 'All' && r['Movement'] !== mov) return false;
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
// SEARCH (fetch data from server)
// ================================================================

function doSearch() {
    var material = (document.getElementById('search-material').value || '').trim();
    var grid = (document.getElementById('search-grid').value || '').trim();

    if (!material && !grid) {
        alert('Please enter a Material or Grid Value to search.');
        return;
    }

    // Show results, hide empty state
    document.getElementById('dm-empty-state').style.display = 'none';
    document.getElementById('dm-results').classList.add('visible');

    // Banner -> loading state
    var banner = document.getElementById('active-filters-banner');
    banner.classList.add('is-loading');
    document.getElementById('banner-icon').innerHTML = '<div class="inline-spinner"></div>';
    document.getElementById('banner-date-range').textContent = 'Loading data...';

    var df = document.getElementById('filter-date-from').value;
    var dt = document.getElementById('filter-date-to').value;

    var params = new URLSearchParams();
    if (df) params.set('date_from', df);
    if (dt) params.set('date_to', dt);
    if (material) params.set('material', material);
    if (grid) params.set('grid', grid);

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
            renderUnitsChart(units);

            // Populate secondary filter dropdowns
            if (data.filters) {
                LMS.populateDropdown('filter-process', data.filters.processes);
                LMS.populateDropdown('filter-movement', data.filters.movements);
            }

            // Populate Grid Value dropdown from detail data
            var gridValues = [];
            var gridSeen = {};
            detail.forEach(function(r) {
                var gv = r['Grid Value'] || '';
                if (gv && !gridSeen[gv]) { gridSeen[gv] = true; gridValues.push(gv); }
            });
            gridValues.sort();
            LMS.populateDropdown('filter-grid-value', gridValues);

            // Update dates from response
            if (data.selected) {
                if (data.selected.date_from) document.getElementById('filter-date-from').value = data.selected.date_from;
                if (data.selected.date_to) document.getElementById('filter-date-to').value = data.selected.date_to;
            }

            // Banner -> ready state
            var banner = document.getElementById('active-filters-banner');
            banner.classList.remove('is-loading');
            document.getElementById('banner-icon').innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>';
            var mat = document.getElementById('search-material').value || '';
            var grd = document.getElementById('search-grid').value || '';
            var msg = 'Showing results for ';
            if (mat) msg += '<strong>' + mat + '</strong>';
            if (mat && grd) msg += ' + ';
            if (grd) msg += '<strong>' + grd + '</strong>';
            msg += ' (' + TOTAL_ROWS.toLocaleString() + ' total rows)';
            document.getElementById('banner-date-range').innerHTML = msg;
        })
        .catch(function(err) {
            console.error('[DetailByMaterial] Fetch error:', err);
            var banner = document.getElementById('active-filters-banner');
            banner.classList.remove('is-loading');
            document.getElementById('banner-date-range').textContent = 'Error loading data.';
            document.getElementById('chart-units').innerHTML = '<p style="color:#dc2626; text-align:center;">Error loading data.</p>';
        });
}

// ================================================================
// EVENT HANDLERS
// ================================================================

// Search button
document.getElementById('btn-search').addEventListener('click', doSearch);

// Enter key on search inputs triggers search
document.getElementById('search-material').addEventListener('keydown', function(e) { if (e.key === 'Enter') doSearch(); });
document.getElementById('search-grid').addEventListener('keydown', function(e) { if (e.key === 'Enter') doSearch(); });

// Reset: return to empty state
document.getElementById('btn-reset').addEventListener('click', function() {
    document.getElementById('search-material').value = '';
    document.getElementById('search-grid').value = '';
    document.getElementById('dm-empty-state').style.display = '';
    document.getElementById('dm-results').classList.remove('visible');
    // Restore banner
    var banner = document.getElementById('active-filters-banner');
    banner.classList.remove('is-loading');
    document.getElementById('banner-icon').innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>';
    document.getElementById('banner-date-range').innerHTML = 'Enter a <strong>Material</strong> or <strong>Grid Value</strong> and click Search';
    UNITS_RAW = []; DETAIL_RAW = []; DETAIL_FILTERED = [];
    TOTAL_ROWS = 0; TOTAL_QTY = 0;
});

// Export (client-side via SheetJS)
document.getElementById('btn-export').addEventListener('click', function() {
    if (!UNITS_RAW.length && !DETAIL_FILTERED.length) { alert('No data to export.'); return; }
    var unitsRows = [['Process', 'Quantity']];
    UNITS_RAW.forEach(function(r) { unitsRows.push([r.process, r.qty]); });
    var detailRows = [DETAIL_COLS];
    DETAIL_FILTERED.forEach(function(r) {
        detailRows.push(DETAIL_COLS.map(function(c) { return r[c] != null ? r[c] : ''; }));
    });
    detailRows.push([]);
    detailRows.push(['Total', '', '', '', '', '', '', '', '', '', '', '', TOTAL_QTY]);
    var df = document.getElementById('filter-date-from').value || '';
    var dt = document.getElementById('filter-date-to').value || '';
    var mat = document.getElementById('search-material').value || '';
    var filename = 'LMS_DetailByMaterial' + (mat ? '_' + mat : '') + (df && dt ? '_' + df + '_to_' + dt : '') + '.xlsx';
    LMS.exportXLSX([{name: 'Units by Process', rows: unitsRows}, {name: 'Details', rows: detailRows}], filename);
});

// Client-side secondary filter narrowing
document.getElementById('filter-grid-value').addEventListener('change', applyClientFilters);
document.getElementById('filter-process').addEventListener('change', applyClientFilters);
document.getElementById('filter-movement').addEventListener('change', applyClientFilters);
document.getElementById('filter-stock-cat').addEventListener('input', applyClientFilters);
document.getElementById('filter-dest-bin').addEventListener('input', applyClientFilters);
document.getElementById('filter-source-bin').addEventListener('input', applyClientFilters);

// ================================================================
// INIT - page starts empty (search-first)
// ================================================================
