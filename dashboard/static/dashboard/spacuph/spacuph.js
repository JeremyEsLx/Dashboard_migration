/**
 * SPAC UPH Dashboard - Client-side Logic
 *
 * Architecture: Hybrid Cube + Stale-While-Revalidate
 *   - Server sends FULL cube for date range (all users, all days/hours)
 *   - User/Date filters are applied CLIENT-SIDE (instant, no server call)
 *   - Only date range changes or Refresh button trigger server re-fetch
 *   - 15-min auto-refresh timer reloads from server
 */

(function() {
    'use strict';

    // ================================================================
    // CONSTANTS
    // ================================================================
    var CACHE_KEY = 'lms_spacuph_cache';
    var CACHE_TTL = 15; // minutes
    var REFRESH_INTERVAL = 15; // minutes (LMS.Timer expects minutes)
    var API_URL = '/api/spacuph/';

    // ================================================================
    // STATE
    // ================================================================
    var DATA = null;   // raw server response (cube_json, filters, selected, etc.)
    var CUBE = [];     // parsed cube array [{day, hour, user, units, duration}]
    var cache = new LMS.Cache(CACHE_KEY, CACHE_TTL);
    var timer = new LMS.Timer('lms_timer_spacuph', REFRESH_INTERVAL, function() { doFetch(true); });

    // ================================================================
    // INIT
    // ================================================================
    function init() {
        // Set default dates (current week) if empty
        var dfEl = document.getElementById('filter-date-from');
        var dtEl = document.getElementById('filter-date-to');
        if (!dfEl.value) {
            var today = new Date();
            var fiveDaysAgo = new Date(today);
            fiveDaysAgo.setDate(today.getDate() - 4); // last 5 days including today
            dfEl.value = fiveDaysAgo.toISOString().split('T')[0];
            dtEl.value = today.toISOString().split('T')[0];
        }

        // Try cache first (stale-while-revalidate)
        var cached = cache.get();
        if (cached) {
            DATA = cached;
            CUBE = JSON.parse(DATA.cube_json);
            renderFromCube();
            showContent();
        }

        // Always fetch fresh in background
        doFetch(!cached);

        // Event listeners
        // Date range changes => SERVER re-fetch (new cube)
        dfEl.addEventListener('change', function() {
            document.getElementById('filter-date').value = 'All';
            doFetch(true);
        });
        dtEl.addEventListener('change', function() {
            document.getElementById('filter-date').value = 'All';
            doFetch(true);
        });
        // Single date + User => CLIENT-SIDE filter (instant, no server call)
        document.getElementById('filter-date').addEventListener('change', function() { renderFromCube(); });
        document.getElementById('filter-user').addEventListener('change', function() { renderFromCube(); });
        document.getElementById('btn-reset').addEventListener('click', doReset);
        document.getElementById('btn-refresh').addEventListener('click', function() { cache.clear(); doFetch(true); });
        document.getElementById('btn-export').addEventListener('click', doExport);
    }

    // ================================================================
    // FETCH (only on date range change or refresh)
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

                // Populate dropdowns from server filter lists
                // Strip 'All' from server data (LMS.populateDropdown adds it)
                if (data.filters && data.filters.users) {
                    var users = data.filters.users.filter(function(v) { return v !== 'All'; });
                    LMS.populateDropdown('filter-user', users, 'All');
                }
                if (data.filters && data.filters.dates) {
                    var dates = data.filters.dates.filter(function(v) { return v !== 'All'; });
                    LMS.populateDropdown('filter-date', dates, 'All');
                }

                renderFromCube();
                showContent();
                requestAnimationFrame(function() {
                    LMS.hideLoading(data.selected.date_from, data.selected.date_to);
                });
            })
            .catch(function(err) {
                console.error('[SPAC] Fetch failed:', err);
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

        // Compute KPIs from filtered cube
        var totalUnits = 0;
        var totalDuration = 0;
        for (var i = 0; i < filtered.length; i++) {
            totalUnits += filtered[i].units;
            totalDuration += filtered[i].duration;
        }
        var uph = totalDuration > 0 ? Math.round((totalUnits / totalDuration) * 60 * 10) / 10 : 0;

        // KPI display
        document.getElementById('kpi-total-units').textContent = totalUnits.toLocaleString();

        // Updated On (format nicely)
        var updEl = document.getElementById('updated-on');
        if (DATA.last_update) {
            var d = new Date(DATA.last_update);
            if (!isNaN(d.getTime())) {
                updEl.textContent = 'Updated on ' + (d.getMonth()+1) + '/' + d.getDate() + '/' + d.getFullYear() + ' ' + d.toLocaleTimeString();
            } else {
                updEl.textContent = 'Updated on ' + DATA.last_update;
            }
        }

        // Gauge
        document.getElementById('gauge-target').textContent = 'Target: ' + DATA.target;
        renderGauge(uph);

        // Hour chart: aggregate filtered cube by day+hour
        var hourMap = {};
        for (var j = 0; j < filtered.length; j++) {
            var key = filtered[j].day + '|' + filtered[j].hour;
            if (!hourMap[key]) hourMap[key] = { day: filtered[j].day, hour: filtered[j].hour, units: 0 };
            hourMap[key].units += filtered[j].units;
        }
        // Sort by day then hour
        var hourData = Object.keys(hourMap).map(function(k) { return hourMap[k]; });
        hourData.sort(function(a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : a.hour - b.hour; });

        renderHourChart(hourData);
    }

    function renderGauge(uph) {
        var target = DATA.target;
        var gaugeMax = DATA.gauge_max;

        // Color zones: 0-80 red, 80-100 yellow, 100-150 green (matching Power BI screenshot)
        var barColor;
        if (uph >= target) barColor = '#22c55e';
        else if (uph >= target * 0.67) barColor = '#eab308';
        else barColor = '#dc2626';

        Plotly.react('gauge-container', [{
            type: 'indicator',
            mode: 'gauge+number',
            value: uph,
            number: {
                font: { size: 48, color: '#111827', family: 'Inter, sans-serif' },
            },
            gauge: {
                shape: 'angular',
                axis: {
                    range: [0, gaugeMax],
                    tickwidth: 1,
                    tickcolor: '#d1d5db',
                    dtick: 50,
                    tickfont: { size: 11, color: '#6b7280', family: 'Inter' },
                },
                bar: { color: barColor, thickness: 0.2 },
                bgcolor: '#f3f4f6',
                borderwidth: 0,
                steps: [
                    { range: [0, 50], color: '#fee2e2' },
                    { range: [50, 100], color: '#fef9c3' },
                    { range: [100, gaugeMax], color: '#dcfce7' },
                ],
                threshold: {
                    line: { color: '#059669', width: 3 },
                    thickness: 0.8,
                    value: target,
                },
            },
        }], {
            margin: { t: 20, b: 10, l: 30, r: 30 },
            height: 210,
            paper_bgcolor: 'transparent',
            font: { family: 'Inter, sans-serif' },
        }, { responsive: true, displayModeBar: false });
    }

    function renderHourChart(hourData) {
        if (!hourData || !hourData.length) {
            Plotly.react('hour-chart', [], { margin: { t: 20, b: 40, l: 40, r: 20 }, height: 260 }, { displayModeBar: false });
            return;
        }

        // Multicategory x-axis: [[hours], [dates]] — Plotly groups by date like Power BI
        var xHours = [];
        var xDates = [];
        var yValues = [];
        var textValues = [];

        for (var i = 0; i < hourData.length; i++) {
            var d = hourData[i];
            // Format date as M/D/YYYY for display
            var parts = d.day.split('-');
            var dateLabel = parseInt(parts[1]) + '/' + parseInt(parts[2]) + '/' + parts[0];
            xHours.push(String(d.hour));
            xDates.push(dateLabel);
            yValues.push(d.units);
            textValues.push(d.units.toLocaleString());
        }

        Plotly.react('hour-chart', [{
            type: 'bar',
            x: [xDates, xHours],
            y: yValues,
            text: textValues,
            textposition: 'outside',
            textfont: { size: 10, color: '#374151' },
            marker: { color: '#6b7280' },
            hovertemplate: 'Hour %{x}: %{y} units<extra></extra>',
        }], {
            margin: { t: 10, b: 70, l: 40, r: 20 },
            height: 280,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { family: 'Inter, sans-serif', size: 11 },
            xaxis: {
                type: 'multicategory',
                tickfont: { size: 10 },
            },
            yaxis: {
                gridcolor: '#f3f4f6',
                zeroline: false,
            },
            bargap: 0.3,
            shapes: [{
                type: 'line',
                x0: -0.5,
                x1: hourData.length - 0.5,
                y0: DATA.target,
                y1: DATA.target,
                line: { color: '#3b82f6', width: 1.5, dash: 'dash' },
            }],
        }, { responsive: true, displayModeBar: false });
    }

    // ================================================================
    // HELPERS
    // ================================================================
    function showContent() {
        document.getElementById('skeleton-loading').classList.add('hidden');
        document.querySelector('.spac-grid').classList.remove('hidden');
        document.querySelector('.spac-chart-card').classList.remove('hidden');
    }

    function doReset() {
        var today = new Date();
        var fiveDaysAgo = new Date(today);
        fiveDaysAgo.setDate(today.getDate() - 4); // last 5 days including today
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

        // Detail rows
        var rows = [['Date', 'Hour', 'User', 'Units', 'Duration']];
        for (var i = 0; i < filtered.length; i++) {
            rows.push([filtered[i].day, filtered[i].hour, filtered[i].user, filtered[i].units, filtered[i].duration]);
        }

        // Summary KPIs
        var totalUnits = 0, totalDuration = 0;
        for (var j = 0; j < filtered.length; j++) {
            totalUnits += filtered[j].units;
            totalDuration += filtered[j].duration;
        }
        var uph = totalDuration > 0 ? Math.round((totalUnits / totalDuration) * 60 * 10) / 10 : 0;
        var summary = [[''], ['Total Units Packed', totalUnits], ['UPH', uph], ['Target', DATA.target]];

        LMS.exportXLSX([
            { name: 'Units by Hour', rows: rows },
            { name: 'Summary', rows: summary },
        ], 'SPAC_UPH_' + DATA.selected.date_from + '_to_' + DATA.selected.date_to + '.xlsx');
    }

    // ================================================================
    // BOOT
    // ================================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
