/**
 * SPAC Performance by User - Client-side Logic
 *
 * Architecture: Hybrid Cube + Stale-While-Revalidate
 * Reuses /api/spacuph/ endpoint (same cube data).
 * Left: User Performance table (units + UPH per user)
 * Right: UPH line chart by Date & Hour (area fill + target line)
 */

(function() {
    'use strict';

    var CACHE_KEY = 'lms_spacperfbyuser_cache';
    var CACHE_TTL = 15;
    var REFRESH_INTERVAL = 15;
    var API_URL = '/api/spacuph/';
    var TARGET_UPH = 120;

    var DATA = null;
    var CUBE = [];
    var cache = new LMS.Cache(CACHE_KEY, CACHE_TTL);
    var timer = new LMS.Timer('lms_timer_spacperfbyuser', REFRESH_INTERVAL, function() { doFetch(true); });

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

        dfEl.addEventListener('change', function() { document.getElementById('filter-date').value = 'All'; doFetch(true); });
        dtEl.addEventListener('change', function() { document.getElementById('filter-date').value = 'All'; doFetch(true); });
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
            document.getElementById('spbu-widgets').classList.add('hidden');
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
                console.error('[SPAC PerfByUser] Fetch failed:', err);
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

        // Aggregate by user
        var userMap = {};
        for (var i = 0; i < filtered.length; i++) {
            var r = filtered[i];
            if (!r.user) continue;
            if (!userMap[r.user]) userMap[r.user] = { units: 0, duration: 0 };
            userMap[r.user].units += r.units;
            userMap[r.user].duration += r.duration;
        }

        // Sort by units descending
        var userList = Object.keys(userMap).map(function(u) {
            var d = userMap[u];
            return { user: u, units: d.units, uph: d.duration > 0 ? Math.round((d.units / d.duration) * 60) : 0 };
        });
        userList.sort(function(a, b) { return b.units - a.units; });

        renderUserList(userList);

        // Aggregate by day+hour for line chart
        var hourMap = {};
        for (var j = 0; j < filtered.length; j++) {
            var row = filtered[j];
            var key = row.day + '|' + row.hour;
            if (!hourMap[key]) hourMap[key] = { day: row.day, hour: row.hour, units: 0, duration: 0 };
            hourMap[key].units += row.units;
            hourMap[key].duration += row.duration;
        }
        var hourData = Object.keys(hourMap).map(function(k) { return hourMap[k]; });
        hourData.sort(function(a, b) { return a.day < b.day ? -1 : a.day > b.day ? 1 : a.hour - b.hour; });

        renderLineChart(hourData);

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
    }

    function renderUserList(userList) {
        var container = document.getElementById('user-list');
        var html = '';
        for (var i = 0; i < userList.length; i++) {
            var u = userList[i];
            html += '<div class="user-item">' +
                '<div class="user-item-name">' + u.user + '</div>' +
                '<div class="user-item-stats">' +
                    '<div class="user-item-stat"><span class="stat-value">' + u.units.toLocaleString() + '</span><span class="stat-label">Units</span></div>' +
                    '<div class="user-item-stat"><span class="stat-value">' + u.uph.toLocaleString() + '</span><span class="stat-label">UPH</span></div>' +
                '</div></div>';
        }
        container.innerHTML = html;
    }

    function renderLineChart(hourData) {
        if (!hourData || !hourData.length) {
            Plotly.react('uph-line-chart', [], {}, { displayModeBar: false });
            return;
        }

        // Use sequential x values to guarantee correct left-to-right order
        var xVals = [], tickLabels = [], yUPH = [], textVals = [];
        var lastDate = '';
        for (var i = 0; i < hourData.length; i++) {
            var h = hourData[i];
            var parts = h.day.split('-');
            var dateLabel = parseInt(parts[1]) + '/' + parseInt(parts[2]) + '/' + parts[0];
            var hourLabel = h.hour < 10 ? '0' + h.hour : String(h.hour);

            // Show date below hour label only on first occurrence of each day
            if (h.day !== lastDate) {
                tickLabels.push(hourLabel + '<br>' + dateLabel);
                lastDate = h.day;
            } else {
                tickLabels.push(hourLabel);
            }

            xVals.push(i);
            var uph = h.duration > 0 ? Math.round((h.units / h.duration) * 60) : 0;
            yUPH.push(uph);
            textVals.push(String(uph));
        }

        Plotly.react('uph-line-chart', [{
            type: 'scatter',
            mode: 'lines+markers+text',
            x: xVals,
            y: yUPH,
            text: textVals,
            textposition: 'top center',
            textfont: { size: 8, color: '#6b7280' },
            line: { color: '#3b82f6', width: 2, shape: 'spline' },
            marker: { color: '#3b82f6', size: 4 },
            fill: 'tozeroy',
            fillcolor: 'rgba(59, 130, 246, 0.15)',
            cliponaxis: false,
            hovertemplate: '%{text} UPH<extra></extra>',
        }], {
            autosize: true,
            margin: { t: 10, b: 50, l: 35, r: 40 },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            font: { family: 'Inter, sans-serif', size: 10 },
            xaxis: {
                tickmode: 'array',
                tickvals: xVals,
                ticktext: tickLabels,
                tickfont: { size: 9 },
            },
            yaxis: { gridcolor: '#f3f4f6', zeroline: false, title: { text: 'UPH', font: { size: 10 } } },
            shapes: [{
                type: 'line',
                x0: 0, x1: 1, xref: 'paper',
                y0: TARGET_UPH, y1: TARGET_UPH,
                line: { color: '#22c55e', width: 1.5, dash: 'dash' },
            }],
            annotations: [{
                x: 1, xref: 'paper', xanchor: 'left',
                y: TARGET_UPH, yanchor: 'middle',
                text: ' ' + TARGET_UPH,
                showarrow: false,
                font: { size: 9, color: '#22c55e', family: 'Inter' },
            }],
        }, { responsive: true, displayModeBar: false });
    }

    // ================================================================
    // HELPERS
    // ================================================================
    function showContent() {
        document.getElementById('skeleton-loading').style.display = 'none';
        document.getElementById('spbu-widgets').classList.remove('hidden');
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
        // Aggregate by user for export
        var userMap = {};
        for (var i = 0; i < filtered.length; i++) {
            var r = filtered[i];
            if (!r.user) continue;
            if (!userMap[r.user]) userMap[r.user] = { units: 0, duration: 0 };
            userMap[r.user].units += r.units;
            userMap[r.user].duration += r.duration;
        }
        var rows = [['User', 'Units', 'UPH']];
        var userList = Object.keys(userMap).map(function(u) {
            var d = userMap[u];
            return { user: u, units: d.units, uph: d.duration > 0 ? Math.round((d.units / d.duration) * 60) : 0 };
        });
        userList.sort(function(a, b) { return b.units - a.units; });
        for (var j = 0; j < userList.length; j++) {
            rows.push([userList[j].user, userList[j].units, userList[j].uph]);
        }
        LMS.exportXLSX([{ name: 'User Performance', rows: rows }],
            'SPAC_PerfByUser_' + DATA.selected.date_from + '_to_' + DATA.selected.date_to + '.xlsx');
    }

    // Boot
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
