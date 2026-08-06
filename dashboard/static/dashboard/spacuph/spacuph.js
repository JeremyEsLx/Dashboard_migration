/**
 * SPAC UPH Dashboard - Client-side Logic
 *
 * Architecture: Auto-load + Stale-While-Revalidate
 *   - Page loads, fetches /api/spacuph/ with date range (current week default)
 *   - Renders: KPI (Total Units), Gauge (UPH), Bar chart (Units by Day & Hour)
 *   - User/Date filters trigger server reload
 *   - 15-min auto-refresh timer
 */

(function() {
    'use strict';

    // ================================================================
    // CONSTANTS
    // ================================================================
    var CACHE_KEY = 'lms_spacuph_cache';
    var CACHE_TTL = 15; // minutes
    var REFRESH_INTERVAL = 15 * 60; // seconds
    var API_URL = '/api/spacuph/';

    // ================================================================
    // STATE
    // ================================================================
    var DATA = null;
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
            var monday = new Date(today);
            monday.setDate(today.getDate() - today.getDay() + 1);
            dfEl.value = monday.toISOString().split('T')[0];
            dtEl.value = today.toISOString().split('T')[0];
        }

        // Try cache first
        var cached = cache.get();
        if (cached) {
            DATA = cached;
            renderAll();
            showContent();
        }

        // Always fetch fresh
        doFetch(false);

        // Event listeners
        dfEl.addEventListener('change', function() { doFetch(true); });
        dtEl.addEventListener('change', function() { doFetch(true); });
        document.getElementById('filter-user').addEventListener('change', function() { doFetch(true); });
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
            user: document.getElementById('filter-user').value,
        });

        fetch(API_URL + '?' + params.toString())
            .then(function(r) { return r.json(); })
            .then(function(data) {
                DATA = data;
                cache.set(data);
                renderAll();
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
    // RENDER
    // ================================================================
    function renderAll() {
        if (!DATA) return;

        // KPI
        document.getElementById('kpi-total-units').textContent = DATA.total_units.toLocaleString();

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

        // Gauge target display
        document.getElementById('gauge-target').textContent = 'Target: ' + DATA.target;

        // Populate user dropdown (preserve selection)
        if (DATA.filters && DATA.filters.users) {
            LMS.populateDropdown('filter-user', DATA.filters.users, DATA.selected.user);
        }

        renderGauge();
        renderHourChart();
    }

    function renderGauge() {
        var uph = DATA.uph;
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

    function renderHourChart() {
        var hourData = JSON.parse(DATA.hour_json);
        if (!hourData.length) {
            Plotly.react('hour-chart', [], { margin: { t: 20, b: 40, l: 40, r: 20 }, height: 260 }, { displayModeBar: false });
            return;
        }

        // Build x-axis labels: "hour\ndate" format
        var xLabels = [];
        var yValues = [];
        var textValues = [];
        var prevDay = '';

        for (var i = 0; i < hourData.length; i++) {
            var d = hourData[i];
            var dayLabel = '';
            if (d.day !== prevDay) {
                // Format date as M/D/YYYY
                var parts = d.day.split('-');
                dayLabel = parseInt(parts[1]) + '/' + parseInt(parts[2]) + '/' + parts[0];
                prevDay = d.day;
            }
            xLabels.push(d.hour + (dayLabel ? '<br>' + dayLabel : ''));
            yValues.push(d.units);
            textValues.push(d.units.toLocaleString());
        }

        Plotly.react('hour-chart', [{
            type: 'bar',
            x: xLabels,
            y: yValues,
            text: textValues,
            textposition: 'outside',
            textfont: { size: 10, color: '#374151' },
            marker: { color: '#6b7280' },
            hovertemplate: '%{x}: %{y} units<extra></extra>',
        }], {
            margin: { t: 10, b: 60, l: 40, r: 20 },
            height: 260,
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { family: 'Inter, sans-serif', size: 11 },
            xaxis: {
                type: 'category',
                tickangle: 0,
                tickfont: { size: 9 },
            },
            yaxis: {
                gridcolor: '#f3f4f6',
                zeroline: false,
            },
            bargap: 0.3,
            shapes: [{
                type: 'line',
                x0: -0.5,
                x1: xLabels.length - 0.5,
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
        var monday = new Date(today);
        monday.setDate(today.getDate() - today.getDay() + 1);
        document.getElementById('filter-date-from').value = monday.toISOString().split('T')[0];
        document.getElementById('filter-date-to').value = today.toISOString().split('T')[0];
        document.getElementById('filter-user').value = 'All';
        cache.clear();
        doFetch(true);
    }

    function doExport() {
        if (!DATA) return;
        var hourData = JSON.parse(DATA.hour_json);
        var rows = [['Date', 'Hour', 'Units']];
        for (var i = 0; i < hourData.length; i++) {
            rows.push([hourData[i].day, hourData[i].hour, hourData[i].units]);
        }
        // Add KPI summary row
        var summary = [[''], ['Total Units Packed', DATA.total_units], ['UPH', DATA.uph], ['Target', DATA.target]];
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
