/* ============================================================
   Lab Picking Performance
   Hardcoded filters: Process=PICKING, CartType=NTRF, Date=today+yesterday
   Layout: UPH by Flow | 3 center charts (grouped by date+hour) | 3 KPIs
   ============================================================ */
(function() {
    'use strict';

    var cache = new LMS.Cache('lms_lappicking_cache', 30);
    var timer = new LMS.Timer('lms_timer_lappicking', 15, function() {
        cache.clear();
        doFetch(true);
    });

    var CUBE = [];
    var DATA = null;
    var CHART_CONFIG = { displayModeBar: false, responsive: true };

    // Gray palette for flows (matching Power BI dark theme)
    var FLOW_COLORS = ['#1e293b', '#475569', '#94a3b8', '#cbd5e1', '#64748b'];

    // ============================================================
    // HELPERS
    // ============================================================

    function fmtK(v) {
        if (v >= 1000) return (v / 1000).toFixed(1) + 'K';
        return v.toString();
    }

    function fmtNumber(n) { return n.toLocaleString(); }

    // ============================================================
    // FILTERING
    // ============================================================

    function getFilteredCube() {
        var dateVal = document.getElementById('filter-date').value;
        if (dateVal === 'All') return CUBE;

        // Determine which date string to match
        var dates = [];
        var seen = {};
        CUBE.forEach(function(r) { if (!seen[r.d]) { seen[r.d] = true; dates.push(r.d); } });
        dates.sort();

        var targetDate = '';
        if (dateVal === 'today' && dates.length >= 1) targetDate = dates[dates.length - 1];
        if (dateVal === 'yesterday' && dates.length >= 2) targetDate = dates[dates.length - 2];
        if (!targetDate) return CUBE;

        return CUBE.filter(function(r) { return r.d === targetDate; });
    }

    // ============================================================
    // AGGREGATION
    // ============================================================

    function aggregate(cube) {
        // Aggregate by (date, hour) slots — each slot has units, distinct users
        var slotMap = {};
        var allUsers = {};
        var totalUnits = 0;

        cube.forEach(function(r) {
            var key = r.d + '|' + r.h;
            if (!slotMap[key]) slotMap[key] = { d: r.d, h: r.h, units: 0, users: {} };
            slotMap[key].units += r.units;
            slotMap[key].users[r.u] = true;
            allUsers[r.u] = true;
            totalUnits += r.units;
        });

        var slots = Object.keys(slotMap).map(function(k) {
            var s = slotMap[k];
            var userCount = Object.keys(s.users).length;
            return { d: s.d, h: s.h, units: s.units, users: userCount, avg: userCount ? Math.round(s.units / userCount) : 0 };
        });
        slots.sort(function(a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : a.h - b.h; });

        var totalUsers = Object.keys(allUsers).length;
        var totalUserHourPairs = slots.reduce(function(sum, s) { return sum + s.users; }, 0);
        var avgUnitsPerHour = totalUserHourPairs ? Math.round(totalUnits / totalUserHourPairs) : 0;

        return { slots: slots, totalUnits: totalUnits, totalUsers: totalUsers, avgUnitsPerHour: avgUnitsPerHour };
    }

    // ============================================================
    // CHARTS
    // ============================================================

    function renderUPHbyFlow(cube) {
        var container = document.getElementById('chart-uph-flow');
        if (!container) return;

        // Exclude ST01 for this visual
        var filtered = cube.filter(function(r) { return r.f !== 'ST01'; });

        // Group by date -> total_units / user_hour_pairs
        var dateMap = {};
        filtered.forEach(function(r) {
            if (!dateMap[r.d]) dateMap[r.d] = { units: 0, userHours: {} };
            dateMap[r.d].units += r.units;
            var uhKey = r.u + '|' + r.h;
            dateMap[r.d].userHours[uhKey] = true;
        });

        var dates = Object.keys(dateMap).sort();
        var maxUph = 0;
        var uphValues = dates.map(function(d) {
            var pairs = Object.keys(dateMap[d].userHours).length;
            var uph = pairs ? Math.round(dateMap[d].units / pairs) : 0;
            if (uph > maxUph) maxUph = uph;
            return uph;
        });

        // Render as HTML bars (matches Power BI layout)
        var html = '';
        dates.forEach(function(d, i) {
            var uph = uphValues[i];
            var pct = maxUph ? Math.max((uph / maxUph) * 75, 10) : 10;
            html += '<div class="uph-section">';
            html += '<div class="uph-date">' + LMS.fmtDate(d) + '</div>';
            html += '<div class="uph-bar-row">';
            html += '<span class="uph-label">NTRF</span>';
            html += '<div class="uph-bar" style="width:' + pct + '%">';
            html += '<span class="uph-value">' + uph + '</span>';
            html += '</div>';
            html += '</div>';
            if (i < dates.length - 1) html += '<div class="uph-divider"></div>';
            html += '</div>';
        });
        container.innerHTML = html;
    }

    function renderCenterCharts(agg) {
        var slots = agg.slots;
        if (!slots.length) return;

        // Build x-axis labels: "hour\ndate" for date boundaries
        var xLabels = [];
        var prevDate = '';
        slots.forEach(function(s) {
            if (s.d !== prevDate) {
                xLabels.push(s.h + '<br>' + LMS.fmtDate(s.d));
                prevDate = s.d;
            } else {
                xLabels.push(String(s.h));
            }
        });

        var unitsVals = slots.map(function(s) { return s.units; });
        var usersVals = slots.map(function(s) { return s.users; });
        var avgVals = slots.map(function(s) { return s.avg; });

        // Average lines
        var avgUnitsLine = unitsVals.reduce(function(a, b) { return a + b; }, 0) / unitsVals.length;
        var avgUsersLine = usersVals.reduce(function(a, b) { return a + b; }, 0) / usersVals.length;
        var avgAvgLine = avgVals.reduce(function(a, b) { return a + b; }, 0) / avgVals.length;

        function makeAvgTrace(yVal, len) {
            return {
                x: Array.from({length: len}, function(_, i) { return i; }),
                y: Array(len).fill(yVal),
                type: 'scatter', mode: 'lines',
                line: { color: '#eab308', width: 2, dash: 'dash' },
                hoverinfo: 'skip',
            };
        }

        // Assign colors per date
        var dates = [];
        var seenDates = {};
        slots.forEach(function(s) {
            if (!seenDates[s.d]) { seenDates[s.d] = true; dates.push(s.d); }
        });
        var barColors = slots.map(function(s) {
            var idx = dates.indexOf(s.d);
            return FLOW_COLORS[idx % FLOW_COLORS.length];
        });

        function renderChart(containerId, values, avgLine, label) {
            var el = document.getElementById(containerId);
            if (!el) return;

            var trace = {
                x: xLabels.map(function(_, i) { return i; }),
                y: values,
                type: 'bar',
                marker: { color: barColors, line: { width: 0 } },
                text: values.map(fmtK),
                textposition: 'outside',
                textfont: { size: 8 },
                hovertemplate: '%{text}<extra></extra>',
            };

            var layout = {
                margin: { t: 4, r: 10, b: 30, l: 36 },
                height: el.clientHeight || 200,
                showlegend: false,
                xaxis: {
                    tickvals: xLabels.map(function(_, i) { return i; }),
                    ticktext: xLabels,
                    tickfont: { size: 8 },
                    zeroline: false,
                },
                yaxis: { zeroline: false, gridcolor: '#f1f5f9', tickfont: { size: 8 }, rangemode: 'tozero' },
                bargap: 0.2,
            };

            Plotly.newPlot(el, [trace, makeAvgTrace(avgLine, xLabels.length)], layout, CHART_CONFIG);
        }

        renderChart('chart-units', unitsVals, avgUnitsLine, 'Units');
        renderChart('chart-users', usersVals, avgUsersLine, 'Users');
        renderChart('chart-avg', avgVals, avgAvgLine, 'Avg');
    }

    function renderKPIs(agg) {
        document.getElementById('kpi-total-units').textContent = fmtK(agg.totalUnits);
        document.getElementById('kpi-active-users').textContent = fmtNumber(agg.totalUsers);
        document.getElementById('kpi-avg-units').textContent = fmtNumber(agg.avgUnitsPerHour);
    }

    // ============================================================
    // RENDER ALL
    // ============================================================

    function renderAll() {
        document.getElementById('skeleton-loading').classList.add('hidden');
        var widgets = document.getElementById('lp-widgets');
        widgets.classList.remove('hidden');

        requestAnimationFrame(function() {
            var filtered = getFilteredCube();
            var agg = aggregate(filtered);
            renderUPHbyFlow(filtered);
            renderCenterCharts(agg);
            renderKPIs(agg);
        });
    }

    // ============================================================
    // DATA FETCHING
    // ============================================================

    function showSkeleton() {
        document.getElementById('skeleton-loading').classList.remove('hidden');
        document.getElementById('lp-widgets').classList.add('hidden');
    }

    function doFetch(showSkel) {
        if (showSkel) showSkeleton();
        LMS.showLoading();

        fetch('/api/lappicking/')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                DATA = data;
                CUBE = JSON.parse(data.cube_json || '[]');
                cache.set(data);
                LMS.hideLoading(data.selected.date_from, data.selected.date_to);
                renderAll();
                timer.reset();
            })
            .catch(function(err) {
                console.error('[LabPicking] Fetch error:', err);
                LMS.hideLoading('', '');
            });
    }

    function loadData() {
        var cached = cache.get();
        if (cached) {
            DATA = cached;
            CUBE = JSON.parse(cached.cube_json || '[]');
            LMS.hideLoading(cached.selected.date_from, cached.selected.date_to);
            renderAll();
        }
        doFetch(!cached);
    }

    // ============================================================
    // EVENT LISTENERS
    // ============================================================

    document.getElementById('filter-date').addEventListener('change', function() {
        if (DATA) renderAll();
    });

    // ============================================================
    // INIT
    // ============================================================

    loadData();

})();
