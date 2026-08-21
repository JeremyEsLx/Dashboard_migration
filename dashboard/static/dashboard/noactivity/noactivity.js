/**
 * No Activity Between — Client-side Logic
 * Shows employees who clocked in and went directly to clock out (no productive scans).
 * Architecture: same hybrid-cube pattern as Strong Start/Finish.
 */

var CACHE_KEY = 'lms_noactivity_cache';
var REFRESH_INTERVAL = 15 * 60;
var CHART_COLOR = '#ef4444'; // Red — misplaced/wasted time

// ================================================================
// HELPERS
// ================================================================

function fmtDate(isoStr) {
    // Convert yyyy-mm-dd to mm/dd/yyyy
    if (!isoStr) return '';
    var p = isoStr.split('-');
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

function removeSkeletons() {
    document.querySelectorAll('.skeleton').forEach(function(el) { el.remove(); });
}

// ================================================================
// FILTER + RENDER
// ================================================================

function getFiltered() {
    if (!CUBE || !CUBE.length) return [];
    var sup = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;
    var dateVal = document.getElementById('filter-date').value;
    var emp = document.getElementById('filter-employee').value.trim().toLowerCase();

    return CUBE.filter(function(r) {
        if (sup && sup !== 'All' && r.s !== sup) return false;
        if (shift && shift !== 'All' && r.sh !== shift) return false;
        if (dateVal && dateVal !== 'All' && r.d !== dateVal) return false;
        if (emp && (r.fn || '').toLowerCase().indexOf(emp) === -1 &&
                   (r.u || '').toLowerCase().indexOf(emp) === -1) return false;
        return true;
    });
}

function renderAll() {
    var filtered = getFiltered();

    // Remove all skeleton placeholders
    removeSkeletons();

    // KPI: Misplaced Hours = sum(ld) / 60
    var totalHrs = 0;
    for (var i = 0; i < filtered.length; i++) totalHrs += filtered[i].ld;
    totalHrs = totalHrs / 60;
    var kpiEl = document.getElementById('kpi-hours');
    var skelEl = document.getElementById('kpi-skel');
    if (skelEl) skelEl.style.display = 'none';
    kpiEl.style.display = '';
    kpiEl.textContent = totalHrs >= 1000 ? (totalHrs / 1000).toFixed(1) + 'K' : Math.round(totalHrs).toLocaleString();

    // Chart: Duration by Date (vertical bar)
    var byDate = {};
    filtered.forEach(function(r) {
        if (!byDate[r.d]) byDate[r.d] = 0;
        byDate[r.d] += r.ld / 60;
    });
    var dateEntries = Object.entries(byDate).sort(function(a, b) { return a[0].localeCompare(b[0]); });
    // Shorter date labels: "Jul 02" format
    var dateLabels = dateEntries.map(function(e) {
        var parts = e[0].split('-');
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return months[parseInt(parts[1], 10) - 1] + ' ' + parseInt(parts[2], 10);
    });
    var dateValues = dateEntries.map(function(e) { return Math.round(e[1]); });

    Plotly.react('chart-date', [{
        type: 'bar', x: dateLabels, y: dateValues,
        text: dateValues.map(function(v) { return v > 0 ? v : ''; }),
        textposition: 'outside',
        textfont: { size: 11, color: '#374151' },
        marker: { color: CHART_COLOR, cornerradius: 3 },
        hovertemplate: '%{x}: %{y} hrs<extra></extra>'
    }], {
        margin: { t: 30, b: 50, l: 45, r: 20 },
        xaxis: { tickangle: -45, tickfont: { size: 10 }, gridcolor: '#f3f4f6' },
        yaxis: { title: '', gridcolor: '#f3f4f6', tickfont: { size: 10 } },
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
        height: 220,
        bargap: 0.15
    }, { responsive: true, displayModeBar: false, staticPlot: true });

    // Detail table
    var tbody = document.getElementById('detail-tbody');
    if (!filtered.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:#6b7280;">No records found</td></tr>';
        hideLoading();
        updateBanner();
        return;
    }
    var html = '';
    // Sort by date desc, then user name
    var sorted = filtered.slice().sort(function(a, b) {
        if (a.d !== b.d) return b.d.localeCompare(a.d);
        return (a.u || '').localeCompare(b.u || '');
    });
    for (var i = 0; i < sorted.length; i++) {
        var r = sorted[i];
        var duration = r.ld / 60;
        html += '<tr>';
        html += '<td>' + r.sh + '</td>';
        html += '<td>' + r.u + '</td>';
        html += '<td>' + r.s + '</td>';
        html += '<td>' + fmtDate(r.d) + '</td>';
        html += '<td>' + (r.cit || '') + '</td>';
        html += '<td>' + (r.cot || '') + '</td>';
        html += '<td class="col-num">' + duration.toFixed(2) + '</td>';
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
        bannerDate.innerHTML = '<strong>Showing:</strong> ' + formatDateNice(df) + ' &mdash; ' + formatDateNice(dt);
    } else {
        bannerDate.innerHTML = '<strong>Showing:</strong> All dates';
    }

    var chips = [];
    var sup = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;
    if (sup && sup !== 'All') chips.push({label:'Supervisor', value:sup});
    if (shift && shift !== 'All') chips.push({label:'Shift', value:shift});

    if (!chips.length) {
        bannerChips.innerHTML = '<span class="banner-chip banner-chip-all">All Filters</span>';
    } else {
        bannerChips.innerHTML = chips.map(function(c) {
            return '<span class="banner-chip"><strong>' + c.label + ':</strong> ' + c.value + '</span>';
        }).join('');
    }
}

// ================================================================
// POPULATE FILTERS
// ================================================================

function populateFilters(data) {
    var supSel = document.getElementById('filter-supervisor');
    supSel.innerHTML = '<option value="All">All</option>';
    (data.filters.supervisors || []).forEach(function(s) {
        if (s === 'All') return;
        var opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        if (s === data.selected.supervisor) opt.selected = true;
        supSel.appendChild(opt);
    });

    var shiftSel = document.getElementById('filter-shift');
    shiftSel.innerHTML = '';
    (data.filters.shifts || ['All','A','B','C','D']).forEach(function(s) {
        var opt = document.createElement('option');
        opt.value = s; opt.textContent = s;
        if (s === data.selected.shift) opt.selected = true;
        shiftSel.appendChild(opt);
    });

    // Date dropdown from cube data — display as mm/dd/yyyy, value stays iso for filtering
    var dateSel = document.getElementById('filter-date');
    dateSel.innerHTML = '<option value="All">All Dates</option>';
    if (CUBE && CUBE.length) {
        var dates = [...new Set(CUBE.map(function(r) { return r.d; }))].sort().reverse();
        dates.forEach(function(d) {
            var opt = document.createElement('option');
            opt.value = d; opt.textContent = fmtDate(d);
            dateSel.appendChild(opt);
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

    fetch('/api/noactivity/?' + params.toString())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            CUBE = JSON.parse(data.cube_json);
            populateFilters(data);
            renderAll();
            try {
                sessionStorage.setItem(CACHE_KEY, JSON.stringify({ts: Date.now(), data: data}));
            } catch(e) {}
        })
        .catch(function(err) {
            console.error('[NoActivity] Fetch error:', err);
            hideLoading();
        });
}

// ================================================================
// EVENT HANDLERS
// ================================================================

document.getElementById('filter-supervisor').addEventListener('change', renderAll);
document.getElementById('filter-shift').addEventListener('change', renderAll);
document.getElementById('filter-date').addEventListener('change', renderAll);
document.getElementById('filter-employee').addEventListener('input', renderAll);

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
    document.getElementById('filter-supervisor').value = 'All';
    document.getElementById('filter-shift').value = 'All';
    document.getElementById('filter-date').value = 'All';
    document.getElementById('filter-employee').value = '';
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
    var csv = 'Shift,User Name,Supervisor,Date,Clock In,Clock Out,Duration (hrs)\n';
    filtered.forEach(function(r) {
        var dur = (r.ld / 60).toFixed(2);
        csv += [r.sh, r.u, '"' + r.s + '"', fmtDate(r.d), r.cit, r.cot, dur].join(',') + '\n';
    });
    var blob = new Blob([csv], {type: 'text/csv'});
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'no_activity_between.csv';
    a.click();
});

// Auto-refresh timer
var _timerKey = 'lms_timer_noactivity';
var _timerStart = parseInt(sessionStorage.getItem(_timerKey) || '0') || Math.floor(Date.now()/1000);
sessionStorage.setItem(_timerKey, _timerStart);
setInterval(function() {
    var elapsed = Math.floor(Date.now()/1000) - _timerStart;
    var remaining = REFRESH_INTERVAL - elapsed;
    if (remaining <= 0) {
        _timerStart = Math.floor(Date.now()/1000);
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
