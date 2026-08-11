/**
 * SPAC Details Dashboard - Client-side Logic
 *
 * Architecture: Hybrid Cube + Stale-While-Revalidate
 * Reuses /api/spacuph/ endpoint (same cube data).
 * Left: 3 KPIs (UPH, Units, Hours). Right: Detail table (row-level data).
 */

(function() {
    'use strict';

    var CACHE_KEY = 'lms_spacdetails_cache';
    var CACHE_TTL = 15;
    var REFRESH_INTERVAL = 15;
    var API_URL = '/api/spacdetails/';

    var DATA = null;
    var CUBE = [];
    var cache = new LMS.Cache(CACHE_KEY, CACHE_TTL);
    var timer = new LMS.Timer('lms_timer_spacdetails', REFRESH_INTERVAL, function() { doFetch(true); });

    // ================================================================
    // INIT
    // ================================================================
    function init() {
        var dfEl = document.getElementById('filter-date-from');
        var dtEl = document.getElementById('filter-date-to');
        if (!dfEl.value) {
            var today = new Date();
            var fiveDaysAgo = new Date(today);
            fiveDaysAgo.setDate(today.getDate() - 4);
            dfEl.value = fiveDaysAgo.toISOString().split('T')[0];
            dtEl.value = today.toISOString().split('T')[0];
        }

        var cached = cache.get();
        if (cached) {
            DATA = cached;
            CUBE = JSON.parse(DATA.detail_json || '[]');
            if (DATA.filters && DATA.filters.users) {
                var users = DATA.filters.users.filter(function(v) { return v !== 'All'; });
                LMS.populateDropdown('filter-user', users, 'All');
            }
            if (DATA.filters && DATA.filters.dates) {
                var dates = DATA.filters.dates.filter(function(v) { return v !== 'All'; });
                LMS.populateDropdown('filter-date', dates, 'All');
            }
            showContent();
            renderFromCube();
        }

        doFetch(!cached);

        // Date range => server re-fetch
        dfEl.addEventListener('change', function() { document.getElementById('filter-date').value = 'All'; doFetch(true); });
        dtEl.addEventListener('change', function() { document.getElementById('filter-date').value = 'All'; doFetch(true); });
        // Single date + User => client-side filter
        document.getElementById('filter-date').addEventListener('change', function() { renderFromCube(); });
        document.getElementById('filter-user').addEventListener('change', function() { renderFromCube(); });
        document.getElementById('btn-reset').addEventListener('click', doReset);
        document.getElementById('btn-refresh').addEventListener('click', function() { cache.clear(); doFetch(true); });
        document.getElementById('btn-export').addEventListener('click', doExport);
    }

    // ================================================================
    // FETCH
    // ================================================================
    function doFetch(showSpinner) {
        if (showSpinner) {
            document.getElementById('spd-widgets').classList.add('hidden');
            document.getElementById('skeleton-loading').style.display = '';
        }
        var params = new URLSearchParams({
            date_from: document.getElementById('filter-date-from').value,
            date_to: document.getElementById('filter-date-to').value,
        });
        fetch(API_URL + '?' + params.toString())
            .then(function(r) { return r.json(); })
            .then(function(data) {
                DATA = data;
                CUBE = JSON.parse(data.detail_json || '[]');
                cache.set(data);
                if (data.filters && data.filters.users) {
                    var users = data.filters.users.filter(function(v) { return v !== 'All'; });
                    LMS.populateDropdown('filter-user', users, 'All');
                }
                if (data.filters && data.filters.dates) {
                    var dates = data.filters.dates.filter(function(v) { return v !== 'All'; });
                    LMS.populateDropdown('filter-date', dates, 'All');
                }
                showContent();
                renderFromCube();
                requestAnimationFrame(function() {
                    LMS.hideLoading(data.selected.date_from, data.selected.date_to);
                });
            })
            .catch(function(err) {
                console.error('[SPAC Details] Fetch failed:', err);
                showContent();
            });
    }

    // ================================================================
    // CLIENT-SIDE FILTERING + RENDER
    // ================================================================
    function getFilteredCube() {
        var selectedUser = document.getElementById('filter-user').value;
        var selectedDate = document.getElementById('filter-date').value;
        return CUBE.filter(function(row) {
            if (selectedUser !== 'All' && row.user !== selectedUser) return false;
            if (selectedDate !== 'All' && row.day !== selectedDate) return false;
            return true;
        });
    }

    function renderFromCube() {
        if (!DATA || !CUBE.length) return;
        var filtered = getFilteredCube();

        // KPI aggregation
        var totalUnits = 0, totalDuration = 0;
        for (var i = 0; i < filtered.length; i++) {
            totalUnits += filtered[i].units;
            totalDuration += filtered[i].duration;
        }
        var uph = totalDuration > 0 ? Math.round((totalUnits / totalDuration) * 60) : 0;
        var hours = (totalDuration / 60).toFixed(2);

        // Format units with K suffix if >= 1000
        var unitsStr = totalUnits >= 1000 ? (totalUnits / 1000).toFixed(2) + 'K' : totalUnits.toLocaleString();

        document.getElementById('kpi-uph').textContent = uph.toLocaleString();
        document.getElementById('kpi-units').textContent = unitsStr;
        document.getElementById('kpi-hours').textContent = hours;

        // Updated On
        var updEl = document.getElementById('updated-on');
        if (DATA.last_update) {
            var d = new Date(DATA.last_update);
            if (!isNaN(d.getTime())) {
                updEl.textContent = 'Updated on ' + (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear() + ' ' + d.toLocaleTimeString();
            } else {
                updEl.textContent = 'Updated on ' + DATA.last_update;
            }
        }

        // Detail table: show individual rows sorted by start time descending
        // Each cube row has: day, hour, user, units, duration
        // We need to show the raw data from the cube grouped per row
        var rows = [];
        for (var j = 0; j < filtered.length; j++) {
            var r = filtered[j];
            if (!r.user) continue;
            var rowUph = r.duration > 0 ? Math.round((r.units / r.duration) * 60) : 0;
            rows.push({
                user: r.user,
                wave: r.wave || '',
                mission: r.mission || '',
                start: r.start || '',
                end: r.end || '',
                duration: r.duration,
                units: r.units,
                uph: rowUph
            });
        }
        // Sort by start descending
        rows.sort(function(a, b) {
            if (a.start > b.start) return -1;
            if (a.start < b.start) return 1;
            return 0;
        });

        renderTable(rows);
    }

    function renderTable(rows) {
        var tbody = document.getElementById('detail-tbody');
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            html += '<tr>' +
                '<td>' + r.user + '</td>' +
                '<td>' + r.wave + '</td>' +
                '<td>' + r.mission + '</td>' +
                '<td>' + formatDateTime(r.start) + '</td>' +
                '<td>' + formatDateTime(r.end) + '</td>' +
                '<td class="num">' + r.duration.toFixed(2) + '</td>' +
                '<td class="num">' + r.units + '</td>' +
                '<td class="num">' + r.uph + '</td>' +
                '</tr>';
        }
        tbody.innerHTML = html || '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:20px">No data</td></tr>';
    }

    function formatDateTime(iso) {
        if (!iso) return '';
        var d = new Date(iso);
        if (isNaN(d.getTime())) return iso;
        var m = d.getMonth() + 1;
        var day = d.getDate();
        var y = d.getFullYear();
        var h = d.getHours();
        var min = d.getMinutes();
        var sec = d.getSeconds();
        var ampm = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return m + '/' + day + '/' + y + ' ' + h + ':' + (min < 10 ? '0' : '') + min + ':' + (sec < 10 ? '0' : '') + sec + ' ' + ampm;
    }

    // ================================================================
    // HELPERS
    // ================================================================
    function showContent() {
        document.getElementById('skeleton-loading').style.display = 'none';
        document.getElementById('spd-widgets').classList.remove('hidden');
    }

    function doReset() {
        var today = new Date();
        var fiveDaysAgo = new Date(today);
        fiveDaysAgo.setDate(today.getDate() - 4);
        document.getElementById('filter-date-from').value = fiveDaysAgo.toISOString().split('T')[0];
        document.getElementById('filter-date-to').value = today.toISOString().split('T')[0];
        document.getElementById('filter-date').value = 'All';
        document.getElementById('filter-user').value = 'All';
        cache.clear();
        doFetch(true);
    }

    function doExport() {
        if (!DATA || !CUBE.length) return;
        var filtered = getFilteredCube();
        var exportRows = [['User', 'Wave Number', 'Mission', 'Start', 'End', 'Duration', 'Units', 'UPH']];
        for (var i = 0; i < filtered.length; i++) {
            var r = filtered[i];
            if (!r.user) continue;
            var rowUph = r.duration > 0 ? Math.round((r.units / r.duration) * 60) : 0;
            exportRows.push([r.user, r.wave || '', r.mission || '', r.start || '', r.end || '', r.duration, r.units, rowUph]);
        }
        LMS.exportXLSX([{ name: 'SPAC Details', rows: exportRows }],
            'SPAC_Details_' + DATA.selected.date_from + '_to_' + DATA.selected.date_to + '.xlsx');
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
