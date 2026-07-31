/* ============================================================
   USER SUMMARY - Search-first page
   Requires Supervisor or User Name to search.
   ============================================================ */

var PERF_RAW = [];
var HOUR_RAW = [];
var DETAIL_RAW = [];

var DETAIL_COLS = ['Date', 'Time', 'Process', 'Flow Type', 'Quantity',
    'Source Storage Type', 'Source Storage Bin',
    'Destination Storage Type', 'Destination Storage Bin',
    'Line Day Activity', 'Working Gap Minutes'];

// ================================================================
// RENDER: Performance Chart (horizontal bar: IN TASK vs OFF TASK)
// ================================================================

function renderPerfChart(data) {
    var container = document.getElementById('chart-perf');
    container.innerHTML = '';
    if (!data || !data.length) {
        container.innerHTML = '<p style="color:#6b7280; text-align:center; padding:40px;">No data</p>';
        return;
    }
    var labels = data.map(function(d) { return d.category; });
    var values = data.map(function(d) { return d.hours; });
    var colors = labels.map(function(l) { return l === 'IN TASK' ? '#10b981' : '#f59e0b'; });

    Plotly.newPlot(container, [{
        type: 'bar', orientation: 'h', x: values, y: labels,
        marker: { color: colors },
        text: values.map(function(v) { return v.toFixed(1) + 'h'; }),
        textposition: 'outside',
        hovertemplate: '%{y}: %{x:.1f} hours<extra></extra>',
    }], {
        margin: { l: 80, r: 50, t: 10, b: 30 },
        xaxis: { title: 'Hours', showgrid: true, gridcolor: '#f3f4f6' },
        yaxis: { title: '' },
        height: 200,
        plot_bgcolor: 'white', paper_bgcolor: 'white',
        font: { family: 'Inter, sans-serif', size: 12 },
    }, { responsive: true, displayModeBar: false });
}

// ================================================================
// RENDER: By Hour Chart (grouped bar: IN TASK + OFF TASK by hour)
// ================================================================

function renderHourChart(data) {
    var container = document.getElementById('chart-hour');
    container.innerHTML = '';
    if (!data || !data.length) {
        container.innerHTML = '<p style="color:#6b7280; text-align:center; padding:40px;">No data</p>';
        return;
    }

    // Group by category
    var inTask = [], offTask = [], hours = [];
    var hourSet = {};
    data.forEach(function(d) { hourSet[d.hour] = true; });
    hours = Object.keys(hourSet).map(Number).sort(function(a,b){return a-b;});

    var inMap = {}, offMap = {};
    data.forEach(function(d) {
        if (d.category === 'IN TASK') inMap[d.hour] = d.hours;
        else offMap[d.hour] = d.hours;
    });

    var inValues = hours.map(function(h) { return inMap[h] || 0; });
    var offValues = hours.map(function(h) { return offMap[h] || 0; });
    var hourLabels = hours.map(function(h) { return h + ':00'; });

    Plotly.newPlot(container, [
        { type: 'bar', name: 'IN TASK', x: hourLabels, y: inValues, marker: { color: '#10b981' } },
        { type: 'bar', name: 'OFF TASK', x: hourLabels, y: offValues, marker: { color: '#f59e0b' } },
    ], {
        barmode: 'group',
        margin: { l: 40, r: 20, t: 10, b: 40 },
        xaxis: { title: 'Hour', tickangle: -45 },
        yaxis: { title: 'Hours' },
        height: 280,
        legend: { orientation: 'h', y: 1.12 },
        plot_bgcolor: 'white', paper_bgcolor: 'white',
        font: { family: 'Inter, sans-serif', size: 11 },
    }, { responsive: true, displayModeBar: false });
}

// ================================================================
// RENDER: Detail Table
// ================================================================

function renderDetailTable(data) {
    var tbody = document.getElementById('us-detail-tbody');
    var countEl = document.getElementById('us-row-count');
    if (!data || !data.length) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#6b7280;padding:20px;">No data</td></tr>';
        if (countEl) countEl.textContent = '0 rows';
        return;
    }
    var html = '';
    data.forEach(function(row) {
        html += '<tr>';
        DETAIL_COLS.forEach(function(col) {
            var val = row[col] != null ? row[col] : '';
            html += '<td>' + val + '</td>';
        });
        html += '</tr>';
    });
    tbody.innerHTML = html;
    if (countEl) countEl.textContent = data.length.toLocaleString() + ' rows';
}

// ================================================================
// SEARCH
// ================================================================

function doSearch() {
    var supervisor = document.getElementById('filter-supervisor').value;
    var userName = document.getElementById('filter-user').value;

    if (supervisor === 'All' && userName === 'All') {
        alert('Please select a Supervisor or User to search.');
        return;
    }

    // Show results
    document.getElementById('us-empty-state').style.display = 'none';
    document.getElementById('us-results').classList.add('visible');

    // Banner -> loading
    var banner = document.getElementById('active-filters-banner');
    banner.classList.add('is-loading');
    document.getElementById('banner-icon').innerHTML = '<div class="inline-spinner"></div>';
    document.getElementById('banner-date-range').textContent = 'Loading data...';

    var params = new URLSearchParams();
    var dateVal = document.getElementById('filter-date').value;
    var weekVal = document.getElementById('filter-week').value;
    if (weekVal && weekVal !== 'All') params.set('week', weekVal);
    else if (dateVal) params.set('date_filter', dateVal);
    if (supervisor !== 'All') params.set('supervisor', supervisor);
    if (userName !== 'All') params.set('user_name', userName);

    fetch('/api/usersummary/?' + params.toString())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            PERF_RAW = JSON.parse(data.perf_json || '[]');
            HOUR_RAW = JSON.parse(data.hour_json || '[]');
            DETAIL_RAW = JSON.parse(data.detail_json || '[]');

            renderPerfChart(PERF_RAW);
            renderHourChart(HOUR_RAW);
            renderDetailTable(DETAIL_RAW);

            // Populate filter dropdowns
            if (data.filters) {
                LMS.populateDropdown('filter-supervisor', data.filters.supervisors, supervisor);
                LMS.populateDropdown('filter-week', data.filters.weeks, weekVal);
            }

            // Banner -> ready
            banner.classList.remove('is-loading');
            document.getElementById('banner-icon').innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>';
            var msg = 'Showing results';
            if (supervisor !== 'All') msg += ' for <strong>' + supervisor + '</strong>';
            if (userName !== 'All') msg += ' for <strong>' + userName + '</strong>';
            msg += ' (' + DETAIL_RAW.length.toLocaleString() + ' detail rows)';
            document.getElementById('banner-date-range').innerHTML = msg;
        })
        .catch(function(err) {
            console.error('[UserSummary] Fetch error:', err);
            banner.classList.remove('is-loading');
            document.getElementById('banner-date-range').textContent = 'Error loading data.';
        });
}

// ================================================================
// EVENT HANDLERS
// ================================================================

document.getElementById('btn-search').addEventListener('click', doSearch);

// Reset
document.getElementById('btn-reset').addEventListener('click', function() {
    document.getElementById('filter-supervisor').value = 'All';
    document.getElementById('filter-user').value = 'All';
    document.getElementById('filter-week').value = 'All';
    document.getElementById('us-empty-state').style.display = '';
    document.getElementById('us-results').classList.remove('visible');
    var banner = document.getElementById('active-filters-banner');
    banner.classList.remove('is-loading');
    document.getElementById('banner-icon').innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>';
    document.getElementById('banner-date-range').innerHTML = 'Enter a <strong>Supervisor</strong> or <strong>User</strong> and click Search';
    PERF_RAW = []; HOUR_RAW = []; DETAIL_RAW = [];
});

// Export
document.getElementById('btn-export').addEventListener('click', function() {
    if (!DETAIL_RAW.length) { alert('No data to export.'); return; }
    var detailRows = [DETAIL_COLS];
    DETAIL_RAW.forEach(function(r) {
        detailRows.push(DETAIL_COLS.map(function(c) { return r[c] != null ? r[c] : ''; }));
    });
    var sup = document.getElementById('filter-supervisor').value;
    var usr = document.getElementById('filter-user').value;
    var who = (sup !== 'All') ? sup : usr;
    var filename = 'LMS_UserSummary_' + who + '.xlsx';
    LMS.exportXLSX([{name: 'User Summary', rows: detailRows}], filename);
});

// ================================================================
// INIT: populate dropdowns on page load (from shared filter cache)
// ================================================================
(function() {
    // Fetch filter options to populate supervisor dropdown
    fetch('/api/summary/?date_filter=' + document.getElementById('filter-date').value)
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.filters) {
                LMS.populateDropdown('filter-supervisor', data.filters.supervisors || []);
                LMS.populateDropdown('filter-week', data.filters.weeks || []);
            }
        })
        .catch(function() {});
})();
