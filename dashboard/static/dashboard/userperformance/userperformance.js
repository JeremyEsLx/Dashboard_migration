/**
 * User Performance — Client-side Logic
 * Raw detail table with client-side filtering.
 * Cube fields: { d, wk, sh, u, fn, s, at, pr, mv, dl, vt, po, to, sst, ssb, dst, dsb, pm, ft, fm, ct, tt, ld, it, hr }
 */

var CACHE_KEY = 'lms_userperf_cache';
var REFRESH_INTERVAL = 15 * 60;

// Column definitions: key → cube field mapping
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

function formatDateNice(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr + 'T00:00:00');
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days[d.getDay()] + ', ' + months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
}

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
    if (bannerIcon) bannerIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12"/><path d="M5.5 1.5v3"/><path d="M10.5 1.5v3"/></svg>';
}

// ================================================================
// FILTER + RENDER
// ================================================================

function getFiltered() {
    if (!CUBE || !CUBE.length) return [];
    var wk = document.getElementById('filter-week').value;
    var shift = document.getElementById('filter-shift').value;
    var name = document.getElementById('filter-name').value.trim().toLowerCase();
    var sup = document.getElementById('filter-supervisor').value;
    var fullname = document.getElementById('filter-fullname').value.trim().toLowerCase();
    var proc = document.getElementById('filter-process').value;
    var mv = document.getElementById('filter-movement').value;
    var hr = document.getElementById('filter-hour').value;

    return CUBE.filter(function(r) {
        if (wk && wk !== 'All' && r.wk !== wk) return false;
        if (shift && shift !== 'All' && r.sh !== shift) return false;
        if (name && (r.u || '').toLowerCase().indexOf(name) === -1) return false;
        if (sup && sup !== 'All' && r.s !== sup) return false;
        if (fullname && (r.fn || '').toLowerCase().indexOf(fullname) === -1) return false;
        if (proc && proc !== 'All' && r.pr !== proc) return false;
        if (mv && mv !== 'All' && r.mv !== mv) return false;
        if (hr && hr !== 'All' && r.hr !== parseInt(hr, 10)) return false;
        return true;
    });
}

function renderAll() {
    var filtered = getFiltered();

    // Remove skeletons
    document.querySelectorAll('.skeleton').forEach(function(el) { el.remove(); });

    // Row count
    var countEl = document.getElementById('row-count');
    countEl.textContent = filtered.length.toLocaleString() + ' rows' +
        (CUBE ? ' (of ' + CUBE.length.toLocaleString() + ' total)' : '');

    // Detail table
    var tbody = document.getElementById('detail-tbody');
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="19" style="text-align:center;padding:24px;color:#6b7280;">No records found</td></tr>';
        hideLoading();
        updateBanner();
        return;
    }

    var html = '';
    for (var i = 0; i < filtered.length; i++) {
        var r = filtered[i];
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

    hideLoading();
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
        bannerDate.innerHTML = '<strong>Showing:</strong> ' + fmtDate(df) + ' &mdash; ' + fmtDate(dt);
    } else {
        bannerDate.innerHTML = '<strong>Showing:</strong> All dates';
    }

    var chips = [];
    var wk = document.getElementById('filter-week').value;
    var shift = document.getElementById('filter-shift').value;
    var sup = document.getElementById('filter-supervisor').value;
    var proc = document.getElementById('filter-process').value;
    var mv = document.getElementById('filter-movement').value;
    var hr = document.getElementById('filter-hour').value;
    if (wk && wk !== 'All') chips.push({ label: 'Week', value: wk });
    if (shift && shift !== 'All') chips.push({ label: 'Shift', value: shift });
    if (sup && sup !== 'All') chips.push({ label: 'Supervisor', value: sup });
    if (proc && proc !== 'All') chips.push({ label: 'Process', value: proc });
    if (mv && mv !== 'All') chips.push({ label: 'Movement', value: mv });
    if (hr && hr !== 'All') chips.push({ label: 'Hour', value: hr });

    if (!chips.length) {
        bannerChips.innerHTML = '<span class="banner-chip banner-chip-all">All Filters</span>';
    } else {
        bannerChips.innerHTML = chips.map(function(c) {
            return '<span class="banner-chip"><strong>' + c.label + ':</strong> ' + c.value + '</span>';
        }).join('');
    }
}

// ================================================================
// POPULATE FILTERS (from cube data)
// ================================================================

function populateFilters(data) {
    // Supervisor
    var supSel = document.getElementById('filter-supervisor');
    supSel.innerHTML = '<option value="All">All</option>';
    (data.filters.supervisors || []).forEach(function(s) {
        if (s === 'All') return;
        var opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        supSel.appendChild(opt);
    });

    // Week
    var wkSel = document.getElementById('filter-week');
    wkSel.innerHTML = '<option value="All">All</option>';
    (data.filters.weeks || []).forEach(function(w) {
        if (w === 'All') return;
        var opt = document.createElement('option');
        opt.value = w; opt.textContent = w;
        wkSel.appendChild(opt);
    });

    // Shift
    var shiftSel = document.getElementById('filter-shift');
    shiftSel.innerHTML = '';
    (data.filters.shifts || ['All','A','B','C','D']).forEach(function(s) {
        var opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        shiftSel.appendChild(opt);
    });

    // Process (from cube distinct values)
    var procSel = document.getElementById('filter-process');
    procSel.innerHTML = '<option value="All">All</option>';
    if (CUBE && CUBE.length) {
        var procs = [...new Set(CUBE.map(function(r) { return r.pr; }))].filter(Boolean).sort();
        procs.forEach(function(p) {
            var opt = document.createElement('option');
            opt.value = p; opt.textContent = p;
            procSel.appendChild(opt);
        });
    }

    // Movement (from cube distinct values)
    var mvSel = document.getElementById('filter-movement');
    mvSel.innerHTML = '<option value="All">All</option>';
    if (CUBE && CUBE.length) {
        var mvs = [...new Set(CUBE.map(function(r) { return r.mv; }))].filter(Boolean).sort();
        mvs.forEach(function(m) {
            var opt = document.createElement('option');
            opt.value = m; opt.textContent = m;
            mvSel.appendChild(opt);
        });
    }

    // Hour (0-23)
    var hrSel = document.getElementById('filter-hour');
    hrSel.innerHTML = '<option value="All">All</option>';
    if (CUBE && CUBE.length) {
        var hrs = [...new Set(CUBE.map(function(r) { return r.hr; }))].sort(function(a, b) { return a - b; });
        hrs.forEach(function(h) {
            var opt = document.createElement('option');
            opt.value = h; opt.textContent = h + ':00';
            hrSel.appendChild(opt);
        });
    }
}

// ================================================================
// FETCH DATA
// ================================================================

function fetchData(useCache) {
    if (useCache) {
        try {
            var cached = sessionStorage.getItem(CACHE_KEY);
            if (cached) {
                var parsed = JSON.parse(cached);
                if (Date.now() - parsed.ts < 30 * 60 * 1000) {
                    CUBE = JSON.parse(parsed.data.cube_json);
                    populateFilters(parsed.data);
                    renderAll();
                    fetchData(false); // background refresh
                    return;
                }
            }
        } catch(e) {}
    }

    showLoading();
    var df = document.getElementById('filter-date-from').value;
    var dt = document.getElementById('filter-date-to').value;
    var params = new URLSearchParams();
    if (df) params.set('date_from', df);
    if (dt) params.set('date_to', dt);

    fetch('/api/userperformance/?' + params.toString())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            CUBE = JSON.parse(data.cube_json);
            populateFilters(data);
            renderAll();
            try {
                sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: data }));
            } catch(e) {}
        })
        .catch(function(err) {
            console.error('[UserPerf] Fetch error:', err);
            hideLoading();
        });
}

// ================================================================
// EVENT HANDLERS
// ================================================================

document.getElementById('filter-week').addEventListener('change', renderAll);
document.getElementById('filter-shift').addEventListener('change', renderAll);
document.getElementById('filter-supervisor').addEventListener('change', renderAll);
document.getElementById('filter-process').addEventListener('change', renderAll);
document.getElementById('filter-movement').addEventListener('change', renderAll);
document.getElementById('filter-hour').addEventListener('change', renderAll);

var _nameTimeout = null;
document.getElementById('filter-name').addEventListener('input', function() {
    clearTimeout(_nameTimeout);
    _nameTimeout = setTimeout(renderAll, 300);
});
var _fnTimeout = null;
document.getElementById('filter-fullname').addEventListener('input', function() {
    clearTimeout(_fnTimeout);
    _fnTimeout = setTimeout(renderAll, 300);
});

// Date range change -> server reload
function reloadForDate() {
    showLoading();
    sessionStorage.removeItem(CACHE_KEY);
    fetchData(false);
}
document.getElementById('filter-date-from').addEventListener('change', reloadForDate);
document.getElementById('filter-date-to').addEventListener('change', reloadForDate);

// Reset
document.getElementById('btn-reset').addEventListener('click', function() {
    document.getElementById('filter-week').value = 'All';
    document.getElementById('filter-shift').value = 'All';
    document.getElementById('filter-name').value = '';
    document.getElementById('filter-supervisor').value = 'All';
    document.getElementById('filter-fullname').value = '';
    document.getElementById('filter-process').value = 'All';
    document.getElementById('filter-movement').value = 'All';
    document.getElementById('filter-hour').value = 'All';
    renderAll();
});

// Refresh
document.getElementById('btn-refresh').addEventListener('click', function() {
    sessionStorage.removeItem(CACHE_KEY);
    fetchData(false);
});

// Export
document.getElementById('btn-export').addEventListener('click', function() {
    var filtered = getFiltered();
    if (!filtered.length) return;
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

// Auto-refresh timer
var _timerKey = 'lms_timer_userperf';
var _timerStart = parseInt(sessionStorage.getItem(_timerKey) || '0') || Math.floor(Date.now() / 1000);
sessionStorage.setItem(_timerKey, _timerStart);
setInterval(function() {
    var elapsed = Math.floor(Date.now() / 1000) - _timerStart;
    var remaining = REFRESH_INTERVAL - elapsed;
    if (remaining <= 0) {
        _timerStart = Math.floor(Date.now() / 1000);
        sessionStorage.setItem(_timerKey, _timerStart);
        fetchData(false);
        return;
    }
    var m = Math.floor(remaining / 60);
    var s = remaining % 60;
    var el = document.getElementById('refresh-timer');
    if (el) el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
}, 1000);

// ================================================================
// INIT
// ================================================================
fetchData(true);
