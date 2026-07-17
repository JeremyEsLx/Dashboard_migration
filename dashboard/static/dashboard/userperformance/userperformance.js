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
// CLIENT-SIDE FILTER (post-search narrowing by week/hour)
// ================================================================

function applyClientFilter() {
    if (!CUBE || !CUBE.length) { filtered = []; renderPage(); return; }
    var wk = document.getElementById('filter-week').value;
    var hr = document.getElementById('filter-hour').value;

    filtered = CUBE.filter(function(r) {
        if (wk && wk !== 'All' && r.wk !== wk) return false;
        if (hr && hr !== 'All' && r.hr !== parseInt(hr, 10)) return false;
        return true;
    });
    currentPage = 1;
    renderPage();
    updateBanner();
}

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
    var supSel = document.getElementById('filter-supervisor');
    supSel.innerHTML = '<option value="All">All</option>';
    (data.filters.supervisors || []).forEach(function(s) {
        if (s === 'All') return;
        var opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        supSel.appendChild(opt);
    });

    var shiftSel = document.getElementById('filter-shift');
    shiftSel.innerHTML = '';
    (data.filters.shifts || ['All','A','B','C','D']).forEach(function(s) {
        var opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        shiftSel.appendChild(opt);
    });

    var procSel = document.getElementById('filter-process');
    procSel.innerHTML = '<option value="All">All</option>';
    (data.filters.processes || []).forEach(function(p) {
        if (p === 'All') return;
        var opt = document.createElement('option');
        opt.value = p; opt.textContent = p;
        procSel.appendChild(opt);
    });

    // Movement from cube
    if (CUBE && CUBE.length) {
        var mvSel = document.getElementById('filter-movement');
        mvSel.innerHTML = '<option value="All">All</option>';
        var mvs = [...new Set(CUBE.map(function(r) { return r.mv; }))].filter(Boolean).sort();
        mvs.forEach(function(m) {
            var opt = document.createElement('option');
            opt.value = m; opt.textContent = m;
            mvSel.appendChild(opt);
        });

        var wkSel = document.getElementById('filter-week');
        wkSel.innerHTML = '<option value="All">All</option>';
        var weeks = [...new Set(CUBE.map(function(r) { return r.wk; }))].filter(Boolean).sort();
        weeks.forEach(function(w) {
            var opt = document.createElement('option');
            opt.value = w; opt.textContent = w;
            wkSel.appendChild(opt);
        });

        var hrSel = document.getElementById('filter-hour');
        hrSel.innerHTML = '<option value="All">All</option>';
        var hrs = [...new Set(CUBE.map(function(r) { return r.hr; }))].sort(function(a,b){return a-b;});
        hrs.forEach(function(h) {
            var opt = document.createElement('option');
            opt.value = h; opt.textContent = h + ':00';
            hrSel.appendChild(opt);
        });
    }
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
    var df = document.getElementById('filter-date-from').value;
    var dt = document.getElementById('filter-date-to').value;

    var hasFilter = (sup && sup !== 'All') || name || (proc && proc !== 'All') ||
                   (mv && mv !== 'All') || (shift && shift !== 'All');

    if (!hasFilter) {
        alert('Please select at least one filter (Supervisor, Name, Process, Movement, or Shift) before searching.');
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
            populateFilters(data);
            if (data.selected.date_from) document.getElementById('filter-date-from').value = data.selected.date_from;
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
document.getElementById('filter-week').addEventListener('change', applyClientFilter);
document.getElementById('filter-hour').addEventListener('change', applyClientFilter);

document.getElementById('btn-reset').addEventListener('click', function() {
    document.getElementById('filter-week').value = 'All';
    document.getElementById('filter-shift').value = 'All';
    document.getElementById('filter-name').value = '';
    document.getElementById('filter-supervisor').value = 'All';
    document.getElementById('filter-fullname').value = '';
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
// INIT
// ================================================================
loadFiltersOnly();
