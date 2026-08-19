/* ============================================================
   HxH Data - Raw data table view
   Reuses /api/hxh/ cube, displays as table rows.
   ============================================================ */
(function() {
    'use strict';

    var cache = new LMS.Cache('lms_hxh_data_cache', 30);
    var timer = new LMS.Timer('lms_timer_hxh_data', 15, function() {
        cache.clear();
        doFetch(true);
    });

    var CUBE = [];
    var DATA = null;
    var FIRST_LOAD = true;

    // ============================================================
    // HELPERS
    // ============================================================

    function getShift(hour) {
        return (hour >= 6 && hour <= 18) ? 'Morning Shift' : 'Night Shift';
    }

    function getFilterVal(id) {
        var el = document.getElementById(id);
        return el ? el.value : 'All';
    }

    function fmtNumber(n) {
        return n.toLocaleString();
    }

    // ============================================================
    // FILTERING
    // ============================================================

    function filterCube() {
        var processVal = getFilterVal('filter-process');
        var flowVal = getFilterVal('filter-flow');
        var shiftVal = getFilterVal('filter-shift');
        var dateVal = getFilterVal('filter-date');
        var userVal = getFilterVal('filter-user');

        return CUBE.filter(function(r) {
            if (processVal !== 'All' && r.p !== processVal) return false;
            if (flowVal !== 'All' && r.f !== flowVal) return false;
            if (shiftVal !== 'All' && getShift(r.h) !== shiftVal) return false;
            if (dateVal !== 'All' && r.d !== dateVal) return false;
            if (userVal !== 'All' && r.u !== userVal) return false;
            return true;
        });
    }

    // ============================================================
    // RENDER TABLE
    // ============================================================

    function renderTable() {
        var filtered = filterCube();
        var tbody = document.getElementById('data-tbody');
        var countEl = document.getElementById('row-count');

        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:20px;">No data matching filters</td></tr>';
            countEl.textContent = '0 rows';
            return;
        }

        // Sort by date desc, then hour asc, then user
        filtered.sort(function(a, b) {
            if (a.d !== b.d) return a.d > b.d ? -1 : 1;
            if (a.h !== b.h) return a.h - b.h;
            return a.u.localeCompare(b.u);
        });

        var html = '';
        var totalUnits = 0;
        for (var i = 0; i < filtered.length; i++) {
            var r = filtered[i];
            totalUnits += r.units;
            html += '<tr>' +
                '<td>' + LMS.fmtDate(r.d) + '</td>' +
                '<td>' + r.f + '</td>' +
                '<td>' + r.h + '</td>' +
                '<td>' + r.p + '</td>' +
                '<td>' + getShift(r.h) + '</td>' +
                '<td>' + fmtNumber(r.units) + '</td>' +
                '<td>' + r.u + '</td>' +
                '</tr>';
        }
        // Total row
        html += '<tr class="total-row">' +
            '<td><strong>Total</strong></td>' +
            '<td></td><td></td><td></td><td></td>' +
            '<td><strong>' + fmtNumber(totalUnits) + '</strong></td>' +
            '<td></td></tr>';
        tbody.innerHTML = html;
        countEl.textContent = fmtNumber(filtered.length) + ' rows';
    }

    // ============================================================
    // RENDER ALL
    // ============================================================

    function renderAll() {
        document.getElementById('skeleton-loading').classList.add('hidden');
        var widgets = document.getElementById('data-widgets');
        widgets.classList.remove('hidden');
        renderTable();
    }

    // ============================================================
    // DATA FETCHING
    // ============================================================

    function showSkeleton() {
        document.getElementById('skeleton-loading').classList.remove('hidden');
        document.getElementById('data-widgets').classList.add('hidden');
    }

    function doFetch(showSkel) {
        if (showSkel) showSkeleton();
        LMS.showLoading();

        var dateFrom = document.getElementById('filter-date-from').value;
        var dateTo = document.getElementById('filter-date-to').value;
        var url = '/api/hxh/?date_from=' + encodeURIComponent(dateFrom) + '&date_to=' + encodeURIComponent(dateTo);

        fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(data) {
                DATA = data;
                CUBE = JSON.parse(data.cube_json || '[]');

                // Populate filter dropdowns
                LMS.populateDropdown('filter-process', data.filters.processes, getFilterVal('filter-process'));
                LMS.populateDropdown('filter-flow', data.filters.flows, getFilterVal('filter-flow'));
                LMS.populateDropdown('filter-date', data.filters.dates, getFilterVal('filter-date'));
                // Format date dropdown display to mm/dd/yyyy
                var dSel = document.getElementById('filter-date');
                if (dSel) Array.from(dSel.options).forEach(function(o) {
                    if (o.value !== 'All') o.textContent = LMS.fmtDate(o.value);
                });

                // Build user list from cube
                var users = [];
                var seen = {};
                CUBE.forEach(function(r) {
                    if (r.u && !seen[r.u]) { seen[r.u] = true; users.push(r.u); }
                });
                users.sort();
                LMS.populateDropdown('filter-user', users, getFilterVal('filter-user'));

                // On first load, default Process to PUTAWAY and Date to today
                if (FIRST_LOAD) {
                    FIRST_LOAD = false;
                    var pEl = document.getElementById('filter-process');
                    if (pEl) {
                        pEl.value = 'PUTAWAY';
                        if (pEl.value !== 'PUTAWAY') pEl.value = 'All';
                    }
                    // Default Date to today (last date in list)
                    var dEl = document.getElementById('filter-date');
                    if (dEl && data.filters.dates && data.filters.dates.length) {
                        var today = data.filters.dates[data.filters.dates.length - 1];
                        dEl.value = today;
                    }
                }

                // Cache
                cache.set(data);
                LMS.hideLoading(data.selected.date_from, data.selected.date_to);

                renderAll();
            })
            .catch(function(err) {
                console.error('Fetch error:', err);
                LMS.hideLoading('', '');
            });
    }

    function loadData() {
        var cached = cache.get();
        if (cached) {
            DATA = cached;
            CUBE = JSON.parse(cached.cube_json || '[]');

            LMS.populateDropdown('filter-process', cached.filters.processes, getFilterVal('filter-process'));
            LMS.populateDropdown('filter-flow', cached.filters.flows, getFilterVal('filter-flow'));
            LMS.populateDropdown('filter-date', cached.filters.dates, getFilterVal('filter-date'));

            var users = [];
            var seen = {};
            CUBE.forEach(function(r) {
                if (r.u && !seen[r.u]) { seen[r.u] = true; users.push(r.u); }
            });
            users.sort();
            LMS.populateDropdown('filter-user', users, getFilterVal('filter-user'));

            LMS.hideLoading(cached.selected.date_from, cached.selected.date_to);
            renderAll();
        }
        // Always revalidate in background
        doFetch(!cached);
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    // Client-side filter changes re-render table
    ['filter-process', 'filter-flow', 'filter-shift', 'filter-date', 'filter-user'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', function() {
            if (DATA) renderTable();
        });
    });

    // Date range changes trigger fresh fetch
    ['filter-date-from', 'filter-date-to'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', function() {
            cache.clear();
            doFetch(true);
        });
    });

    // Reset filters
    var resetBtn = document.getElementById('btn-reset');
    if (resetBtn) resetBtn.addEventListener('click', function() {
        ['filter-process', 'filter-flow', 'filter-shift', 'filter-date', 'filter-user'].forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.value = 'All';
        });
        if (DATA) renderTable();
    });

    // Refresh
    var refreshBtn = document.getElementById('btn-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function() {
        cache.clear();
        doFetch(true);
    });

    // Export
    var exportBtn = document.getElementById('btn-export');
    if (exportBtn) exportBtn.addEventListener('click', function() {
        if (!DATA) return;
        var filtered = filterCube();

        filtered.sort(function(a, b) {
            if (a.d !== b.d) return a.d > b.d ? -1 : 1;
            if (a.h !== b.h) return a.h - b.h;
            return a.u.localeCompare(b.u);
        });

        var rows = [['Date', 'Flow', 'Hour', 'Process', 'Shift', 'Units', 'User']];
        filtered.forEach(function(r) {
            rows.push([LMS.fmtDate(r.d), r.f, r.h, r.p, getShift(r.h), r.units, r.u]);
        });

        var dateFrom = document.getElementById('filter-date-from').value;
        var dateTo = document.getElementById('filter-date-to').value;
        var filename = 'HxH_Data_' + dateFrom + '_to_' + dateTo + '.xlsx';

        LMS.exportXLSX([
            { name: 'Data', rows: rows },
        ], filename);
    });

    // ============================================================
    // INIT
    // ============================================================

    (function init() {
        loadData();
    })();

})();
