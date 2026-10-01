/* ============================================================
   SKY SDP - Aging Dashboard
   Hybrid cube: fetch once, render from cache, 15-min auto-refresh.
   ============================================================ */
(function () {
    'use strict';

    var API_URL   = '/api/skysdp/';
    var CACHE_KEY = 'lms_skysdp_cache';
    var TIMER_KEY = 'lms_timer_skysdp';
    var DATA      = null;

    // Cache + Timer instances (LMS.Cache/Timer are constructors)
    var cache = new LMS.Cache(CACHE_KEY, 15);
    var timer = null;

    // Plotly shared config
    var P_CFG = { responsive: true, displayModeBar: false };
    var COLORS = [
        '#3b82f6', '#ef4444', '#10b981', '#f59e0b',
        '#8b5cf6', '#ec4899', '#06b6d4', '#f97316',
        '#84cc16', '#14b8a6', '#f43f5e', '#a855f7'
    ];

    function showContent() {
        document.getElementById('skeleton-loading').style.display = 'none';
        document.getElementById('sky-widgets').classList.remove('hidden');
    }

    // --------------------------------------------------------
    // FETCH
    // --------------------------------------------------------
    function doFetch(showSkeleton) {
        if (showSkeleton) {
            document.getElementById('skeleton-loading').style.display = '';
            document.getElementById('sky-widgets').classList.add('hidden');
            // NO LMS.showLoading() when skeleton is active (size mismatch)
        } else {
            LMS.showLoading();
        }

        fetch(API_URL)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                DATA = data;
                DATA.cube = JSON.parse(data.cube_json || '[]');
                cache.set(data);
                renderDashboard();
                if (!showSkeleton) LMS.hideLoading(DATA.selected.week_from, DATA.selected.week_to);
                showContent();
            })
            .catch(function (err) {
                console.error('[SKY SDP] fetch error:', err);
                if (!showSkeleton) LMS.hideLoading();
                showContent();
            });
    }

    // --------------------------------------------------------
    // RENDER
    // --------------------------------------------------------
    function renderDashboard() {
        if (!DATA || !DATA.cube) return;

        var cube       = DATA.cube;
        var latestDate = DATA.latest_date;

        // --- Filter cube to latest snapshot ---
        var todayRows = cube.filter(function (r) { return r.ud === latestDate; });

        // --- Compute KPIs from latest snapshot ---
        var totalAging = 0, weightedAging = 0, totalAll = 0;
        var onTimeCount = 0, criticalCount = 0;
        var carrierAging = {};  // carrier -> {sum, cnt}

        todayRows.forEach(function (r) {
            totalAll += r.n;
            if (r.ot === 'Y') onTimeCount += r.n;
            if (r.a > 0) {
                totalAging   += r.n;
                weightedAging += r.a * r.n;
                if (r.a >= 5) criticalCount += r.n;
                if (!carrierAging[r.c]) carrierAging[r.c] = { sum: 0, cnt: 0 };
                carrierAging[r.c].sum += r.a * r.n;
                carrierAging[r.c].cnt += r.n;
            }
        });

        var avgAging   = totalAging > 0 ? (weightedAging / totalAging).toFixed(1) : '0';
        var onTimePct  = totalAll > 0 ? ((onTimeCount / totalAll) * 100).toFixed(1) : '0';

        // Worst carrier = highest weighted avg aging
        var worstCarrier = '--';
        var worstAvg = 0;
        Object.keys(carrierAging).forEach(function (c) {
            var avg = carrierAging[c].sum / carrierAging[c].cnt;
            if (avg > worstAvg) { worstAvg = avg; worstCarrier = c; }
        });

        // Populate KPI elements
        document.getElementById('kpi-total-aging').textContent   = totalAging.toLocaleString();
        document.getElementById('kpi-avg-aging').textContent     = avgAging;
        document.getElementById('kpi-ontime').textContent        = onTimePct + '%';
        document.getElementById('kpi-worst-carrier').textContent = worstCarrier;
        document.getElementById('kpi-critical').textContent      = criticalCount.toLocaleString();

        // --- Banner ---
        document.getElementById('banner-date-range').innerHTML =
            '<strong>Showing:</strong> ' + LMS.fmtDate(DATA.selected.week_from) + ' \u2014 ' + LMS.fmtDate(DATA.selected.week_to);
        document.getElementById('updated-on').textContent =
            'Data as of: ' + LMS.fmtDate(latestDate);

        // --- Charts ---
        renderTodayChart(todayRows);
        renderTrendChart(cube);
    }

    // --------------------------------------------------------
    // CHART 1: Today's Aging by Carrier (grouped bar)
    // X = Aging bucket (1-7), Y = Count, color = Carrier
    // --------------------------------------------------------
    function renderTodayChart(todayRows) {
        // Build carrier -> { agingBucket -> count }
        var carriers = {};
        todayRows.forEach(function (r) {
            if (r.a <= 0) return;
            if (!carriers[r.c]) carriers[r.c] = {};
            carriers[r.c][r.a] = (carriers[r.c][r.a] || 0) + r.n;
        });

        var agingBuckets = [1, 2, 3, 4, 5, 6, 7];
        var carrierNames = Object.keys(carriers).sort();
        var traces = [];

        carrierNames.forEach(function (c, i) {
            traces.push({
                x: agingBuckets,
                y: agingBuckets.map(function (a) { return carriers[c][a] || 0; }),
                name: c,
                type: 'bar',
                marker: { color: COLORS[i % COLORS.length] }
            });
        });

        // Add total trend line overlay
        var totals = agingBuckets.map(function (a) {
            var sum = 0;
            carrierNames.forEach(function (c) { sum += (carriers[c][a] || 0); });
            return sum;
        });
        traces.push({
            x: agingBuckets,
            y: totals,
            name: 'Total',
            type: 'scatter',
            mode: 'lines+markers',
            line: { color: '#1e293b', width: 2.5, dash: 'dot' },
            marker: { size: 6, color: '#1e293b' },
            yaxis: 'y'
        });

        var layout = {
            barmode: 'group',
            xaxis: {
                title: 'Aging (Days)',
                tickmode: 'array',
                tickvals: agingBuckets,
                ticktext: agingBuckets.map(String),
                dtick: 1
            },
            yaxis: { title: 'Count' },
            margin: { t: 10, r: 20, b: 50, l: 55 },
            legend: { orientation: 'h', y: -0.28, x: 0.5, xanchor: 'center' },
            font: { family: 'Inter, Noto Sans, sans-serif', size: 12 },
            height: 370,
            bargap: 0.15
        };

        Plotly.newPlot('chart-today', traces, layout, P_CFG);
    }

    // --------------------------------------------------------
    // CHART 2: Weekly Aging Trend (line chart)
    // X = Update Date, Y = Total aging items (per snapshot)
    // --------------------------------------------------------
    function renderTrendChart(cube) {
        // Group by Update Date -> total items with aging > 0
        var dateMap = {};
        cube.forEach(function (r) {
            if (r.a <= 0) return;
            if (!dateMap[r.ud]) dateMap[r.ud] = 0;
            dateMap[r.ud] += r.n;
        });

        var dates  = Object.keys(dateMap).sort();
        var counts = dates.map(function (d) { return dateMap[d]; });
        var labels = dates.map(LMS.fmtDate);

        var traces = [{
            x: labels,
            y: counts,
            type: 'scatter',
            mode: 'lines+markers+text',
            text: counts.map(function (v) { return v.toLocaleString(); }),
            textposition: 'top center',
            textfont: { size: 11, color: '#334155' },
            line: { shape: 'spline', color: '#3b82f6', width: 3 },
            marker: { size: 9, color: '#3b82f6' },
            name: 'Total Aging Items',
            fill: 'tozeroy',
            fillcolor: 'rgba(59,130,246,0.08)'
        }];

        var layout = {
            xaxis: { title: 'Upload Date', type: 'category' },
            yaxis: { title: 'Total Aging Items' },
            margin: { t: 10, r: 20, b: 50, l: 55 },
            font: { family: 'Inter, Noto Sans, sans-serif', size: 12 },
            height: 370,
            showlegend: false
        };

        Plotly.newPlot('chart-trend', traces, layout, P_CFG);
    }

    // --------------------------------------------------------
    // EXPORT
    // --------------------------------------------------------
    function exportData() {
        if (!DATA || !DATA.cube) return;
        var todayRows = DATA.cube.filter(function (r) {
            return r.ud === DATA.latest_date;
        });
        var aoa = [['Carrier', 'Aging (Days)', 'On Time', 'Count']];
        todayRows.forEach(function (r) {
            aoa.push([r.c, r.a, r.ot, r.n]);
        });
        LMS.exportXLSX(aoa, 'SKY_SDP_' + DATA.latest_date);
    }

    // --------------------------------------------------------
    // INIT
    // --------------------------------------------------------
    function init() {
        // Check sessionStorage cache
        var cached = cache.get();
        if (cached) {
            DATA = cached;
            DATA.cube = JSON.parse(cached.cube_json || '[]');
            renderDashboard();
            showContent();
        } else {
            doFetch(true);
        }

        // 15-minute auto-refresh timer
        timer = new LMS.Timer(TIMER_KEY, 15, function () { doFetch(false); });

        // Refresh button
        document.getElementById('btn-refresh').addEventListener('click', function () {
            cache.clear();
            timer.reset();
            doFetch(true);
        });

        // Export button
        document.getElementById('btn-export').addEventListener('click', exportData);
    }

    init();
})();
