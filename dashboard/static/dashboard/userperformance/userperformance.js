/**
 * User Performance — Search-First Pattern
 * Page loads empty. User selects filters, clicks Search.
 * Server-side filtering keeps result sets manageable (max 10K rows).
 * Client-side pagination renders 100 rows at a time.
 */

var CUBE = null;
var PAGE_SIZE = 100;
var currentPage = 1;
var filtered = [];

// Column definitions
var COLUMNS = [
    { key: 'at', label: 'Activity Type' },
    { key: 'u',  label: 'User Name' },
    { key: 'dl', label: 'Delivery' },
    { key: 'vt', label: 'VAS Type' },
    { key: 'po', label: 'Packing Object' },
    { key: 'to', label: 'Transfer Order Number' },
    { key: 'sst', label: 'Source Storage Type' },
    { key: 'ssb', label: 'Source Storage Bin' },
    { key: 'dst', label: 'Destination Storage Type' },
    { key: 'dsb', label: 'Destination Storage Bin' },
    { key: 'pm', label: 'Process_Map' },
    { key: 'pr', label: 'Process' },
    { key: 'mv', label: 'Movement' },
    { key: 'ft', label: 'Flow Type' },
    { key: 'fm', label: 'Flow_Type_Map' },
    { key: 'ct', label: 'Cart Type' },
    { key: 'tt', label: 'Target_Time', numeric: true },
    { key: 'ld', label: 'Line Day Activity', numeric: true },
    { key: 'it', label: 'Idle Time Day', numeric: true },
];

// ================================================================
// HELPERS
// ================================================================

function fmtDate(isoStr) {
    if (!isoStr) return '';
    var p = isoStr.split('-');
    if (p.length !== 3) return isoStr;
    return p[1] + '/' + p[2] + '/' + p[0];
}

function showLoading() {
    var banner = document.getElementById('active-filters-banner');
    var bannerDate = document.getElementById('banner-date-range');
    var bannerIcon = document.getElementById('banner-icon');
    if (banner) banner.classList.add('is-loading');
    if (bannerIcon) bannerIcon.innerHTML = '<div class="inline-spinner"></div>';
    if (bannerDate) bannerDate.innerHTML = 'Searching...';
}

function hideLoading() {
    var banner = document.getElementById('active-filters-banner');
    var bannerIcon = document.getElementById('banner-icon');
    if (banner) banner.classList.remove('is-loading');
    if (bannerIcon) bannerIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12"/><path d="M5.5 1.5v3"/><path d="M10.5 1.5v3"/></svg>';
}

// ================================================================
// PAGINATION
// ================================================================

function getTotalPages() {
    return Math.ceil(filtered.length / PAGE_SIZE) || 1;
}

function renderPage() {
    var tbody = document.getElementById('detail-tbody');
    var countEl = document.getElementById('row-count');
    var paginationEl = document.getElementById('pagination-controls');

    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="19" style="text-align:center;padding:24px;color:#6b7280;">No records found</td></tr>';
        countEl.textContent = '0 rows';
        if (paginationEl) paginationEl.innerHTML = '';
        return;
    }

    var totalPages = getTotalPages();
    if (currentPage > totalPages) currentPage = totalPages;
    var startIdx = (currentPage - 1) * PAGE_SIZE;
    var endIdx = Math.min(startIdx + PAGE_SIZE, filtered.length);
    var pageRows = filtered.slice(startIdx, endIdx);

    countEl.textContent = filtered.length.toLocaleString() + ' rows';

    var html = '';
    for (var i = 0; i < pageRows.length; i++) {
        var r = pageRows[i];
        html += '<tr>';
        html += '<td>' + r.at + '</td>';
        html += '<td>' + r.u + '</td>';
        html += '<td>' + r.dl + '</td>';
        html += '<td>' + r.vt + '</td>';
        html += '<td>' + r.po + '</td>';
        html += '<td>' + r.to + '</td>';
        html += '<td>' + r.sst + '</td>';
        html += '<td>' + r.ssb + '</td>';
        html += '<td>' + r.dst + '</td>';
        html += '<td>' + r.dsb + '</td>';
        html += '<td>' + r.pm + '</td>';
        html += '<td>' + r.pr + '</td>';
        html += '<td>' + r.mv + '</td>';
        html += '<td>' + r.ft + '</td>';
        html += '<td>' + r.fm + '</td>';
        html += '<td>' + r.ct + '</td>';
        html += '<td class="col-num">' + (r.tt > 0.0000001 ? r.tt.toFixed(4) : '0') + '</td>';
        html += '<td class="col-num">' + r.ld.toFixed(4) + '</td>';
        html += '<td class="col-num">' + r.it.toFixed(4) + '</td>';
        html += '</tr>';
    }
    tbody.innerHTML = html;

    // Pagination controls
    if (paginationEl) {
        var pH = '';
        pH += '<button class="pg-btn" id="pg-first" ' + (currentPage === 1 ? 'disabled' : '') + '>&laquo;</button>';
        pH += '<button class="pg-btn" id="pg-prev" ' + (currentPage === 1 ? 'disabled' : '') + '>&lsaquo;</button>';
        pH += '<span class="pg-info">Page ' + currentPage + ' of ' + totalPages + '</span>';
        pH += '<span class="pg-info pg-range">(' + (startIdx + 1).toLocaleString() + '\u2013' + endIdx.toLocaleString() + ')</span>';
        pH += '<button class="pg-btn" id="pg-next" ' + (currentPage >= totalPages ? 'disabled' : '') + '>&rsaquo;</button>';
        pH += '<button class="pg-btn" id="pg-last" ' + (currentPage >= totalPages ? 'disabled' : '') + '>&raquo;</button>';
        paginationEl.innerHTML = pH;

        document.getElementById('pg-first').onclick = function() { currentPage = 1; renderPage(); };
        document.getElementById('pg-prev').onclick = function() { if (currentPage > 1) { currentPage--; renderPage(); } };
        document.getElementById('pg-next').onclick = function() { if (currentPage < totalPages) { currentPage++; renderPage(); } };
        document.getElementById('pg-last').onclick = function() { currentPage = totalPages; renderPage(); };
    }
}

// ================================================================
// CLIENT-SIDE FILTER (no longer used — Week/Hour are server-side)
// ================================================================

// ================================================================
// BANNER
// ================================================================

function updateBanner() {
    var bannerDate = document.getElementById('banner-date-range');
    var bannerChips = document.getElementById('banner-chips');
    if (!bannerDate) return;

    var df = document.getElementById('filter-date-from').value;
    var dt = document.getElementById('filter-date-to').value;
    if (df && dt) {
        bannerDate.innerHTML = '<strong>Showing:</strong> ' + fmtDate(df) + ' \u2014 ' + fmtDate(dt);
    } else {
        bannerDate.innerHTML = '<strong>Showing:</strong> Select filters and click Search';
    }

    var chips = [];
    var sup = document.getElementById('filter-supervisor').value;
    var proc = document.getElementById('filter-process').value;
    var mv = document.getElementById('filter-movement').value;
    var shift = document.getElementById('filter-shift').value;
    var name = document.getElementById('filter-name').value.trim();
    if (sup && sup !== 'All') chips.push({ label: 'Supervisor', value: sup });
    if (proc && proc !== 'All') chips.push({ label: 'Process', value: proc });
    if (mv && mv !== 'All') chips.push({ label: 'Movement', value: mv });
    if (shift && shift !== 'All') chips.push({ label: 'Shift', value: shift });
    if (name) chips.push({ label: 'Name', value: name });

    if (!chips.length) {
        bannerChips.innerHTML = '<span class="banner-chip banner-chip-all">No filter \u2014 select at least one</span>';
    } else {
        bannerChips.innerHTML = chips.map(function(c) {
            return '<span class="banner-chip"><strong>' + c.label + ':</strong> ' + c.value + '</span>';
        }).join('');
    }
}

// ================================================================
// POPULATE FILTER DROPDOWNS
// ================================================================

function populateFilters(data) {
    if (!data || !data.filters) {
        console.warn('[UserPerf] No filters in response:', data && data.error);
        return;
    }
    // Helper: populate a <select> from an array, preserving current selection
    // placeholder: text to show for the "All" option (primary = "— Select —", secondary = "All")
    function fillSelect(id, items, placeholder) {
        var sel = document.getElementById(id);
        var cur = sel.value;
        sel.innerHTML = '';
        (items || ['All']).forEach(function(v) {
            var opt = document.createElement('option');
            opt.value = v;
            opt.textContent = (v === 'All') ? (placeholder || 'All') : v;
            sel.appendChild(opt);
        });
        if (cur && cur !== 'All') sel.value = cur;
    }

    // Primary filters: show "— Select —" as placeholder
    fillSelect('filter-supervisor', data.filters.supervisors, '\u2014 Select \u2014');
    fillSelect('filter-shift', data.filters.shifts, '\u2014 Select \u2014');

    // Full Name dropdown: items are objects {v: dbValue, t: displayText}
    var fnSel = document.getElementById('filter-fullname');
    var curFn = fnSel.value;
    fnSel.innerHTML = '';
    (data.filters.full_names || []).forEach(function(item) {
        var opt = document.createElement('option');
        if (typeof item === 'object') {
            opt.value = item.v;
            opt.textContent = item.t;
        } else {
            opt.value = item;
            opt.textContent = (item === 'All') ? '\u2014 Select \u2014' : item;
        }
        fnSel.appendChild(opt);
    });
    if (curFn && curFn !== 'All') fnSel.value = curFn;

    // Secondary filters: show "All" (genuine "no filter" option)
    fillSelect('filter-process', data.filters.processes);
    fillSelect('filter-movement', data.filters.movements);
    fillSelect('filter-week', data.filters.weeks);

    // Hours: show as "6:00", "7:00" etc.
    var hrSel = document.getElementById('filter-hour');
    var curHr = hrSel.value;
    hrSel.innerHTML = '';
    (data.filters.hours || ['All']).forEach(function(h) {
        var opt = document.createElement('option');
        opt.value = h;
        opt.textContent = (h === 'All') ? 'All' : h + ':00';
        hrSel.appendChild(opt);
    });
    if (curHr && curHr !== 'All') hrSel.value = curHr;
}

// ================================================================
// SEARCH (FETCH DATA)
// ================================================================

function doSearch() {
    var sup = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;
    var name = document.getElementById('filter-name').value.trim();
    var proc = document.getElementById('filter-process').value;
    var mv = document.getElementById('filter-movement').value;
    var wk = document.getElementById('filter-week').value;
    var hr = document.getElementById('filter-hour').value;
    var fn = document.getElementById('filter-fullname').value;
    var df = document.getElementById('filter-date-from').value;
    var dt = document.getElementById('filter-date-to').value;

    // Single-date: if Date From is set but Date To is empty, use same day
    if (df && !dt) {
        dt = df;
        document.getElementById('filter-date-to').value = dt;
    }

    var hasFilter = (sup && sup !== 'All') || name || (proc && proc !== 'All') ||
                   (mv && mv !== 'All') || (shift && shift !== 'All') ||
                   (wk && wk !== 'All') || (hr && hr !== 'All') ||
                   (fn && fn !== 'All');

    if (!hasFilter) {
        alert('Please select at least one filter before searching.');
        return;
    }

    showLoading();
    var params = new URLSearchParams();
    if (df) params.set('date_from', df);
    if (dt) params.set('date_to', dt);
    if (sup && sup !== 'All') params.set('supervisor', sup);
    if (name) params.set('user_name', name);
    if (proc && proc !== 'All') params.set('process', proc);
    if (mv && mv !== 'All') params.set('movement', mv);
    if (shift && shift !== 'All') params.set('shift', shift);
    if (wk && wk !== 'All') params.set('week', wk);
    if (hr && hr !== 'All') params.set('hour', hr);
    if (fn && fn !== 'All') params.set('full_name', fn);

    fetch('/api/userperformance/?' + params.toString())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            CUBE = JSON.parse(data.cube_json);
            filtered = CUBE.slice();
            currentPage = 1;
            populateFilters(data);
            renderPage();
            updateBanner();
            hideLoading();

            if (data.capped) {
                var countEl = document.getElementById('row-count');
                countEl.textContent += ' (capped at ' + data.max_rows.toLocaleString() + ' \u2014 narrow filters for full data)';
            }
        })
        .catch(function(err) {
            console.error('[UserPerf] Fetch error:', err);
            hideLoading();
            alert('Error loading data. Check connection and try again.');
        });
}

// ================================================================
// INITIAL LOAD (filters only, no heavy query)
// ================================================================

function loadFiltersOnly() {
    fetch('/api/userperformance/')
        .then(function(r) { return r.json(); })
        .then(function(data) {
            console.log('[UserPerf] API response:', data);
            if (data.error) console.error('[UserPerf] Server error:', data.error);
            populateFilters(data);
            if (data.selected.date_from) {
                document.getElementById('filter-date-from').value = data.selected.date_from;
                document.getElementById('filter-date-single').value = data.selected.date_from;
            }
            if (data.selected.date_to) document.getElementById('filter-date-to').value = data.selected.date_to;
            updateBanner();
        })
        .catch(function(err) { console.error('[UserPerf] Filter load error:', err); });
}

// ================================================================
// EVENT HANDLERS
// ================================================================

document.getElementById('btn-search').addEventListener('click', doSearch);
document.getElementById('filter-name').addEventListener('keydown', function(e) { if (e.key === 'Enter') doSearch(); });

document.getElementById('btn-reset').addEventListener('click', function() {
    document.getElementById('filter-week').value = 'All';
    document.getElementById('filter-shift').value = 'All';
    document.getElementById('filter-name').value = '';
    document.getElementById('filter-supervisor').value = 'All';
    document.getElementById('filter-fullname').value = 'All';
    document.getElementById('filter-process').value = 'All';
    document.getElementById('filter-movement').value = 'All';
    document.getElementById('filter-hour').value = 'All';
    CUBE = null; filtered = []; currentPage = 1;
    document.getElementById('detail-tbody').innerHTML = '<tr><td colspan="19" style="text-align:center;padding:24px;color:#6b7280;">Select filters and click Search</td></tr>';
    document.getElementById('row-count').textContent = '';
    document.getElementById('pagination-controls').innerHTML = '';
    updateBanner();
});

document.getElementById('btn-export').addEventListener('click', function() {
    if (!filtered || !filtered.length) return;
    var headers = COLUMNS.map(function(c) { return c.label; });
    var rows = [headers.join(',')];
    filtered.forEach(function(r) {
        var row = COLUMNS.map(function(c) {
            var v = r[c.key];
            if (c.numeric) return (typeof v === 'number') ? v.toFixed(4) : v;
            return '"' + String(v || '').replace(/"/g, '""') + '"';
        });
        rows.push(row.join(','));
    });
    var csv = rows.join('\n');
    var blob = new Blob([csv], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'user_performance.csv';
    a.click();
});

// ================================================================
// DATE MODE TOGGLE
// ================================================================

var dateMode = 'single'; // 'single' or 'range'

function setDateMode(mode) {
    dateMode = mode;
    var btnSingle = document.getElementById('btn-mode-single');
    var btnRange = document.getElementById('btn-mode-range');
    var grpSingle = document.getElementById('group-date-single');
    var grpFrom = document.getElementById('group-date-from');
    var grpTo = document.getElementById('group-date-to');

    if (mode === 'single') {
        btnSingle.classList.add('active');
        btnRange.classList.remove('active');
        grpSingle.classList.remove('hidden');
        grpFrom.classList.add('hidden');
        grpTo.classList.add('hidden');
    } else {
        btnRange.classList.add('active');
        btnSingle.classList.remove('active');
        grpSingle.classList.add('hidden');
        grpFrom.classList.remove('hidden');
        grpTo.classList.remove('hidden');
    }
}

document.getElementById('btn-mode-single').addEventListener('click', function() { setDateMode('single'); });
document.getElementById('btn-mode-range').addEventListener('click', function() { setDateMode('range'); });

// Helper: get effective date_from and date_to based on mode
function getDateParams() {
    if (dateMode === 'single') {
        var d = document.getElementById('filter-date-single').value;
        return { date_from: d, date_to: d };
    } else {
        var df = document.getElementById('filter-date-from').value;
        var dt = document.getElementById('filter-date-to').value;
        if (df && !dt) dt = df; // fallback single day
        return { date_from: df, date_to: dt };
    }
}

// ================================================================
// INIT
// ================================================================
loadFiltersOnly();
