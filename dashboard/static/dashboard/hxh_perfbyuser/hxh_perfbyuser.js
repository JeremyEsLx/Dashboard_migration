/* ============================================================
   HxH Performance by User
   Reuses /api/hxh/ cube - aggregates client-side by user.
   ============================================================ */
(function() {
    'use strict';

    var cache = new LMS.Cache('lms_hxh_perfbyuser_cache', 30);
    var timer = new LMS.Timer('lms_timer_hxh_perfbyuser', 15, function() {
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
        return (hour >= 6 && hour < 18) ? 'Morning Shift' : 'Night Shift';
    }

    function getFilterVal(id) {
        var el = document.getElementById(id);
        return el ? el.value : 'All';
    }

    /**
     * Color gradient: red -> orange -> yellow -> green
     * Maps a value between min and max to a color.
     */
    function gradientColor(value, min, max) {
        if (max === min) return 'rgb(76, 175, 80)';
        var ratio = (value - min) / (max - min);
        // 0 = red, 0.33 = orange, 0.66 = yellow-green, 1 = green
        var r, g, b;
        if (ratio < 0.33) {
            // red -> orange
            var t = ratio / 0.33;
            r = 220; g = Math.round(80 + t * 100); b = 50;
        } else if (ratio < 0.66) {
            // orange -> yellow-green
            var t = (ratio - 0.33) / 0.33;
            r = Math.round(220 - t * 60); g = Math.round(180 + t * 40); b = Math.round(50 + t * 20);
        } else {
            // yellow-green -> green
            var t = (ratio - 0.66) / 0.34;
            r = Math.round(160 - t * 90); g = Math.round(220 - t * 30); b = Math.round(70 + t * 30);
        }
        return 'rgb(' + r + ',' + g + ',' + b + ')';
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
    // AGGREGATION
    // ============================================================

    function aggregateByUser(filtered) {
        var userMap = {};
        filtered.forEach(function(r) {
            if (!r.u) return;
            if (!userMap[r.u]) userMap[r.u] = 0;
            userMap[r.u] += r.units;
        });
        // Sort descending by units
        var users = Object.keys(userMap).map(function(u) {
            return { user: u, units: userMap[u] };
        });
        users.sort(function(a, b) { return b.units - a.units; });
        return users;
    }

    function aggregateByUserHour(filtered) {
        // Group by user -> hour -> sum units
        var map = {};
        filtered.forEach(function(r) {
            if (!r.u) return;
            if (!map[r.u]) map[r.u] = {};
            if (!map[r.u][r.h]) map[r.u][r.h] = 0;
            map[r.u][r.h] += r.units;
        });
        return map;
    }

    // ============================================================
    // CHARTS
    // ============================================================

    var CHART_CONFIG = { displayModeBar: false, responsive: true };

    function renderUnitsByUser(userData) {
        var container = document.getElementById('chart-units-user');
        if (!container || !userData.length) return;

        // Dynamic height: 28px per user, minimum 300px
        var chartHeight = Math.max(300, userData.length * 28);
        container.style.height = chartHeight + 'px';

        // Reverse for Plotly horizontal bar (bottom-to-top)
        var reversed = userData.slice().reverse();
        var users = reversed.map(function(u) { return u.user; });
        var values = reversed.map(function(u) { return u.units; });

        var min = Math.min.apply(null, values);
        var max = Math.max.apply(null, values);
        var colors = values.map(function(v) { return gradientColor(v, min, max); });

        var avg = values.reduce(function(a, b) { return a + b; }, 0) / values.length;

        var trace = {
            y: users,
            x: values,
            type: 'bar',
            orientation: 'h',
            marker: { color: colors },
            text: values.map(function(v) {
                return v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toString();
            }),
            textposition: 'outside',
            textfont: { size: 9 },
            hovertemplate: '%{y}<br>Units: %{x:,}<extra></extra>',
        };

        // Average vertical line
        var avgLine = {
            x: [avg, avg],
            y: [users[0], users[users.length - 1]],
            type: 'scatter',
            mode: 'lines',
            line: { color: '#eab308', width: 2, dash: 'dash' },
            hoverinfo: 'skip',
        };

        var layout = {
            margin: { t: 4, r: 50, b: 30, l: 100 },
            height: chartHeight,
            showlegend: false,
            yaxis: { automargin: true, tickfont: { size: 9 } },
            xaxis: { zeroline: false, gridcolor: '#f1f5f9', rangemode: 'tozero', tickfont: { size: 9 } },
        };

        Plotly.newPlot(container, [trace, avgLine], layout, CHART_CONFIG);
    }

    function renderSmallMultiples(userHourMap, userOrder) {
        var container = document.getElementById('chart-multiples');
        if (!container) return;
        container.innerHTML = '';

        // Show top users based on userOrder (already sorted by units desc)
        var usersToShow = userOrder.slice(0, 20); // Cap at 20 users

        usersToShow.forEach(function(ud) {
            var userName = ud.user;
            var hourData = userHourMap[userName] || {};
            var hours = Object.keys(hourData).map(Number).sort(function(a, b) { return a - b; });
            if (!hours.length) return;

            var panel = document.createElement('div');
            panel.className = 'pbu-user-panel';

            var nameEl = document.createElement('div');
            nameEl.className = 'pbu-user-name';
            nameEl.textContent = userName;
            panel.appendChild(nameEl);

            var chartDiv = document.createElement('div');
            chartDiv.className = 'pbu-user-chart';
            panel.appendChild(chartDiv);
            container.appendChild(panel);

            var values = hours.map(function(h) { return hourData[h]; });
            var labels = hours.map(function(h) { return h.toString(); });

            // Color gradient per bar
            var minV = Math.min.apply(null, values);
            var maxV = Math.max.apply(null, values);
            var colors = values.map(function(v) { return gradientColor(v, minV, maxV); });

            var avg = values.reduce(function(a, b) { return a + b; }, 0) / values.length;

            var barTrace = {
                x: labels,
                y: values,
                type: 'bar',
                marker: { color: colors },
                text: values.map(function(v) {
                    return v >= 1000 ? (v / 1000).toFixed(1) + 'K' : v.toString();
                }),
                textposition: 'outside',
                textfont: { size: 8 },
                hovertemplate: 'Hour %{x}<br>Units: %{y:,}<extra></extra>',
            };

            var avgLine = {
                x: labels,
                y: labels.map(function() { return avg; }),
                type: 'scatter',
                mode: 'lines',
                line: { color: '#eab308', width: 1.5, dash: 'dash' },
                hoverinfo: 'skip',
            };

            var layout = {
                margin: { t: 2, r: 40, b: 18, l: 30 },
                autosize: true,
                showlegend: false,
                height: 85,
                yaxis: { zeroline: false, gridcolor: '#f1f5f9', rangemode: 'tozero', tickfont: { size: 8 } },
                xaxis: { tickfont: { size: 8 }, title: '' },
            };

            Plotly.newPlot(chartDiv, [barTrace, avgLine], layout, CHART_CONFIG);
        });
    }

    // ============================================================
    // RENDER ALL
    // ============================================================

    function renderAll() {
        var filtered = filterCube();
        var userData = aggregateByUser(filtered);
        var userHourMap = aggregateByUserHour(filtered);

        // Show content
        document.getElementById('skeleton-loading').classList.add('hidden');
        var widgets = document.getElementById('pbu-widgets');
        widgets.classList.remove('hidden');

        requestAnimationFrame(function() {
            renderUnitsByUser(userData);
            renderSmallMultiples(userHourMap, userData);
        });
    }

    // ============================================================
    // DATA FETCHING
    // ============================================================

    function showSkeleton() {
        document.getElementById('skeleton-loading').classList.remove('hidden');
        document.getElementById('pbu-widgets').classList.add('hidden');
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

                // Build user list from cube
                var users = [];
                var seen = {};
                CUBE.forEach(function(r) {
                    if (r.u && !seen[r.u]) { seen[r.u] = true; users.push(r.u); }
                });
                users.sort();
                LMS.populateDropdown('filter-user', users, getFilterVal('filter-user'));

                // On first load, default Process to PUTAWAY
                if (FIRST_LOAD) {
                    FIRST_LOAD = false;
                    var pEl = document.getElementById('filter-process');
                    if (pEl) {
                        pEl.value = 'PUTAWAY';
                        // Fallback to All if PUTAWAY not in list
                        if (pEl.value !== 'PUTAWAY') pEl.value = 'All';
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

    // Client-side filter changes re-render (no fetch needed)
    ['filter-process', 'filter-flow', 'filter-shift', 'filter-date', 'filter-user'].forEach(function(id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('change', function() {
            if (DATA) renderAll();
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
        if (DATA) renderAll();
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
        var userData = aggregateByUser(filtered);

        var rows = [['User', 'Total Units']];
        userData.forEach(function(u) {
            rows.push([u.user, u.units]);
        });

        // Sheet 2: detail by user+hour
        var detailRows = [['User', 'Hour', 'Units']];
        var userHourMap = aggregateByUserHour(filtered);
        userData.forEach(function(ud) {
            var hourData = userHourMap[ud.user] || {};
            Object.keys(hourData).sort(function(a, b) { return +a - +b; }).forEach(function(h) {
                detailRows.push([ud.user, +h, hourData[h]]);
            });
        });

        var dateFrom = document.getElementById('filter-date-from').value;
        var dateTo = document.getElementById('filter-date-to').value;
        var filename = 'HxH_PerfByUser_' + dateFrom + '_to_' + dateTo + '.xlsx';

        LMS.exportXLSX([
            { name: 'Units by User', rows: rows },
            { name: 'By User & Hour', rows: detailRows },
        ], filename);
    });

    // ============================================================
    // INIT
    // ============================================================

    (function init() {
        loadData();
    })();

})();
