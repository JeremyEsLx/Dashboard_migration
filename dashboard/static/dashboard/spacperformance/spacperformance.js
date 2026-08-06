/**
 * SPAC Performance Dashboard - Client-side Logic
 *
 * Architecture: Hybrid Cube + Stale-While-Revalidate
 * Reuses /api/spacuph/ endpoint (same cube data).
 * Renders 3 rows: UPH, Units, Active Users (KPI + bar chart each).
 */

(function() {
    'use strict';

    var CACHE_KEY = 'lms_spacperf_cache';
    var CACHE_TTL = 15;
    var REFRESH_INTERVAL = 15;
    var API_URL = '/api/spacuph/';

    var DATA = null;
    var CUBE = [];
    var cache = new LMS.Cache(CACHE_KEY, CACHE_TTL);
    var timer = new LMS.Timer('lms_timer_spacperf', REFRESH_INTERVAL, function() { doFetch(true); });

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
            CUBE = JSON.parse(DATA.cube_json);
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
        if (showSpinner) LMS.showLoading();
        var params = new URLSearchParams({
            date_from: document.getElementById('filter-date-from').value,
            date_to: document.getElementById('filter-date-to').value,
        });
        fetch(API_URL + '?' + params.toString())
            .then(function(r) { return r.json(); })
            .then(function(data) {
                DATA = data;
                CUBE = JSON.parse(data.cube_json);
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
                console.error('[SPAC Perf] Fetch failed:', err);
                LMS.hideLoading('', '');
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

        // Aggregate by day+hour
        var hourMap = {};
        var totalUnits = 0, totalDuration = 0;
        var allUsers = {};
        for (var i = 0; i < filtered.length; i++) {
            var r = filtered[i];
            var key = r.day + '|' + r.hour;
            if (!hourMap[key]) hourMap[key] = { day: r.day, hour: r.hour, units: 0, duration: 0, users: {} };
            hourMap[key].units += r.units;
            hourMap[key].duration += r.duration;
            if (r.user) hourMap[key].users[r.user] = true;
            totalUnits += r.units;
            totalDuration += r.duration;
            if (r.user) allUsers[r.user] = true;
        }

        // Sort by day then hour
        var hourData = Object.keys(hourMap).map(function(k) { return hourMap[k]; });
        hourData.sort(function(a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : a.hour - b.hour; });

        // KPIs
        var uph = totalDuration > 0 ? Math.round((totalUnits / totalDuration) * 60) : 0;
        var activeUsers = Object.keys(allUsers).length;
        document.getElementById('kpi-uph').textContent = uph.toLocaleString();
        document.getElementById('kpi-units').textContent = totalUnits.toLocaleString();
        document.getElementById('kpi-users').textContent = activeUsers.toLocaleString();

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

        // Build multicategory x-axis arrays
        var xHours = [], xDates = [];
        var yUPH = [], yUnits = [], yUsers = [];
        for (var j = 0; j < hourData.length; j++) {
            var h = hourData[j];
            var parts = h.day.split('-');
            var dateLabel = parseInt(parts[1]) + '/' + parseInt(parts[2]) + '/' + parts[0];
            xHours.push(String(h.hour));
            xDates.push(dateLabel);
            yUPH.push(h.duration > 0 ? Math.round((h.units / h.duration) * 60) : 0);
            yUnits.push(h.units);
            yUsers.push(Object.keys(h.users).length);
        }

        renderBarChart('chart-uph', xDates, xHours, yUPH, 'UPH', '#3b82f6');
        renderBarChart('chart-units', xDates, xHours, yUnits, 'Sum of Count', '#3b82f6');
        renderBarChart('chart-users', xDates, xHours, yUsers, 'Count of User', '#3b82f6');
    }

    function renderBarChart(containerId, xDates, xHours, yValues, yLabel, color) {
        var textVals = yValues.map(function(v) { return v.toLocaleString(); });
        Plotly.react(containerId, [{
            type: 'bar',
            x: [xDates, xHours],
            y: yValues,
            text: textVals,
            textposition: 'outside',
            cliponaxis: false,
            textfont: { size: 9, color: '#374151' },
            marker: { color: color },
            hovertemplate: 'Hour %{x}: %{y}<extra></extra>',
        }], {
            autosize: true,
            margin: { t: 20, b: 60, l: 40, r: 10 },
            height: 200,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { family: 'Inter, sans-serif', size: 10 },
            xaxis: { type: 'multicategory', tickfont: { size: 9 } },
            yaxis: { gridcolor: '#f3f4f6', zeroline: false, title: { text: yLabel, font: { size: 10 } } },
            bargap: 0.3,
        }, { responsive: true, displayModeBar: false });
    }

    // ================================================================
    // HELPERS
    // ================================================================
    function showContent() {
        document.getElementById('skeleton-loading').style.display = 'none';
        document.getElementById('perf-widgets').classList.remove('hidden');
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
        var rows = [['Date', 'Hour', 'User', 'Units', 'Duration', 'UPH']];
        for (var i = 0; i < filtered.length; i++) {
            var r = filtered[i];
            var uphVal = r.duration > 0 ? Math.round((r.units / r.duration) * 60) : 0;
            rows.push([r.day, r.hour, r.user, r.units, r.duration, uphVal]);
        }
        LMS.exportXLSX([{ name: 'SPAC Performance', rows: rows }],
            'SPAC_Performance_' + DATA.selected.date_from + '_to_' + DATA.selected.date_to + '.xlsx');
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
