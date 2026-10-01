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

        // --- Build carrier list for detail viewer ---
        CARRIER_LIST = Object.keys(carrierAging).sort();
        var sel = document.getElementById('carrier-select');
        if (sel) {
            sel.innerHTML = CARRIER_LIST.map(function (c) {
                return '<option value="' + c + '">' + c + '</option>';
            }).join('');
        }

        // --- Charts ---
        renderAgingChart(todayRows);
        renderCarrierSidebar(todayRows);
        renderCarrierDetail(todayRows, CARRIER_LIST[0] || '');
        renderOnTimeChart(todayRows);
        renderHeatmap(todayRows);
    }

    // --------------------------------------------------------
    // CHART 1: Aging Distribution (stacked bars by carrier + trend line)
    // --------------------------------------------------------
    function renderAgingChart(todayRows) {
        var carriers = {};
        todayRows.forEach(function (r) {
            if (r.a > 0 && r.a <= 7) {
                if (!carriers[r.c]) carriers[r.c] = {};
                carriers[r.c][r.a] = (carriers[r.c][r.a] || 0) + r.n;
            }
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
                marker: { color: COLORS[i % COLORS.length] },
                hovertemplate: c + '<br>Aging %{x} days<br>Count: %{y:,}<extra></extra>'
            });
        });

        // Trend line (totals)
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
            mode: 'lines+markers+text',
            text: totals.map(function (v) { return v.toLocaleString(); }),
            textposition: 'top center',
            textfont: { size: 11, color: '#1e293b' },
            line: { color: '#1e293b', width: 2.5, dash: 'dot' },
            marker: { size: 6, color: '#1e293b' },
            hovertemplate: 'Total<br>Aging %{x} days<br>Count: %{y:,}<extra></extra>'
        });

        var layout = {
            barmode: 'stack',
            xaxis: { title: 'Aging (Days)', tickmode: 'array', tickvals: agingBuckets, ticktext: agingBuckets.map(String) },
            yaxis: { title: 'Count' },
            margin: { t: 30, r: 20, b: 60, l: 60 },
            legend: { orientation: 'h', y: -0.3, x: 0.5, xanchor: 'center' },
            font: { family: 'Inter, Noto Sans, sans-serif', size: 12 },
            height: 420,
            bargap: 0.2
        };

        Plotly.newPlot('chart-aging', traces, layout, P_CFG);
    }

    // --------------------------------------------------------
    // CHART 2: Carrier Breakdown (HTML ranked list)
    // --------------------------------------------------------
    function renderCarrierSidebar(todayRows) {
        var carriers = {};
        var total = 0;
        todayRows.forEach(function (r) {
            if (r.a > 0) {
                carriers[r.c] = (carriers[r.c] || 0) + r.n;
                total += r.n;
            }
        });

        var sorted = Object.keys(carriers).sort(function (a, b) { return carriers[b] - carriers[a]; });
        var maxCount = sorted.length > 0 ? carriers[sorted[0]] : 1;

        var html = '';
        sorted.forEach(function (c, i) {
            var count = carriers[c];
            var pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
            var barW = (count / maxCount * 100).toFixed(1);
            html += '<div class="carrier-item">' +
                '<div class="carrier-header">' +
                    '<span class="carrier-rank">' + (i + 1) + '</span>' +
                    '<span class="carrier-name">' + c + '</span>' +
                    '<span class="carrier-count">' + count.toLocaleString() + '</span>' +
                '</div>' +
                '<div class="carrier-bar-bg"><div class="carrier-bar-fill" style="width:' + barW + '%"></div></div>' +
                '<span class="carrier-pct">' + pct + '% of total</span>' +
            '</div>';
        });

        document.getElementById('carrier-list').innerHTML = html;
    }

    // --------------------------------------------------------
    // CARRIER DETAIL: Individual carrier aging viewer
    // --------------------------------------------------------
    var CARRIER_LIST = [];
    var CARRIER_IDX = 0;

    function renderCarrierDetail(todayRows, carrierName) {
        if (!carrierName) return;
        var agingBuckets = [1, 2, 3, 4, 5, 6, 7];
        var counts = {};
        var total = 0;
        todayRows.forEach(function (r) {
            if (r.c === carrierName && r.a > 0 && r.a <= 7) {
                counts[r.a] = (counts[r.a] || 0) + r.n;
                total += r.n;
            }
        });

        var y = agingBuckets.map(function (a) { return counts[a] || 0; });
        var barColors = agingBuckets.map(function (a) {
            if (a <= 2) return '#3b82f6';
            if (a <= 4) return '#f59e0b';
            return '#ef4444';
        });

        var traces = [{
            x: agingBuckets,
            y: y,
            type: 'bar',
            marker: { color: barColors, line: { color: '#fff', width: 1 } },
            text: y.map(function (v) { return v > 0 ? v.toLocaleString() : ''; }),
            textposition: 'outside',
            textfont: { size: 12, color: '#334155' },
            hovertemplate: carrierName + '<br>Aging %{x} days<br>Count: %{y:,}<extra></extra>'
        }];

        var layout = {
            xaxis: { title: 'Aging (Days)', tickmode: 'array', tickvals: agingBuckets },
            yaxis: { title: 'Count' },
            margin: { t: 30, r: 20, b: 50, l: 60 },
            font: { family: 'Inter, Noto Sans, sans-serif', size: 12 },
            height: 300,
            bargap: 0.25,
            showlegend: false,
            annotations: [{
                x: 0.5, y: 1.08, xref: 'paper', yref: 'paper',
                text: '<b>' + carrierName + '</b>  \u2014  ' + total.toLocaleString() + ' aging items',
                showarrow: false,
                font: { size: 14, color: '#1e293b', family: 'Inter, sans-serif' }
            }]
        };

        Plotly.newPlot('chart-carrier-detail', traces, layout, P_CFG);
    }

    function setCarrier(idx) {
        if (CARRIER_LIST.length === 0) return;
        CARRIER_IDX = ((idx % CARRIER_LIST.length) + CARRIER_LIST.length) % CARRIER_LIST.length;
        var sel = document.getElementById('carrier-select');
        if (sel) sel.value = CARRIER_LIST[CARRIER_IDX];
        var todayRows = DATA.cube.filter(function (r) { return r.ud === DATA.latest_date; });
        renderCarrierDetail(todayRows, CARRIER_LIST[CARRIER_IDX]);
    }

    // --------------------------------------------------------
    // CHART 3: On-Time Rate by Carrier (horizontal bar)
    // --------------------------------------------------------
    function renderOnTimeChart(todayRows) {
        var carriers = {};
        todayRows.forEach(function (r) {
            if (!carriers[r.c]) carriers[r.c] = { y: 0, total: 0 };
            carriers[r.c].total += r.n;
            if (r.ot === 'Y') carriers[r.c].y += r.n;
        });

        var sorted = Object.keys(carriers).sort(function (a, b) {
            var pA = carriers[a].total > 0 ? carriers[a].y / carriers[a].total : 0;
            var pB = carriers[b].total > 0 ? carriers[b].y / carriers[b].total : 0;
            return pA - pB;
        });

        var names = sorted;
        var rates = sorted.map(function (c) {
            return carriers[c].total > 0 ? Math.round((carriers[c].y / carriers[c].total) * 1000) / 10 : 0;
        });
        var barColors = rates.map(function (r) {
            if (r >= 80) return '#10b981';
            if (r >= 60) return '#f59e0b';
            return '#ef4444';
        });

        var traces = [{
            x: rates,
            y: names,
            type: 'bar',
            orientation: 'h',
            marker: { color: barColors, line: { color: '#fff', width: 1 } },
            text: rates.map(function (r) { return r + '%'; }),
            textposition: 'auto',
            textfont: { size: 11, color: '#fff', family: 'Inter, sans-serif' },
            hovertemplate: '%{y}<br>On-Time: %{x}%<extra></extra>'
        }];

        var layout = {
            xaxis: { title: 'On-Time Rate (%)', range: [0, 105] },
            yaxis: { automargin: true },
            margin: { t: 10, r: 20, b: 50, l: 110 },
            font: { family: 'Inter, Noto Sans, sans-serif', size: 12 },
            height: 350,
            bargap: 0.2,
            showlegend: false,
            shapes: [{
                type: 'line', x0: 80, x1: 80, y0: -0.5, y1: names.length - 0.5,
                line: { color: '#94a3b8', width: 1.5, dash: 'dash' }
            }],
            annotations: [{
                x: 80, y: names.length - 0.3, text: '80% target',
                showarrow: false, font: { size: 10, color: '#94a3b8' }, xanchor: 'left'
            }]
        };

        Plotly.newPlot('chart-ontime', traces, layout, P_CFG);
    }

    // --------------------------------------------------------
    // CHART 4: Carrier x Aging Heatmap
    // --------------------------------------------------------
    function renderHeatmap(todayRows) {
        var grid = {};
        todayRows.forEach(function (r) {
            if (r.a > 0 && r.a <= 7) {
                if (!grid[r.c]) grid[r.c] = {};
                grid[r.c][r.a] = (grid[r.c][r.a] || 0) + r.n;
            }
        });

        var carrierNames = Object.keys(grid).sort();
        var agingDays = [1, 2, 3, 4, 5, 6, 7];

        var z = carrierNames.map(function (c) {
            return agingDays.map(function (a) { return grid[c][a] || 0; });
        });

        var annotations = [];
        var maxVal = 0;
        carrierNames.forEach(function (c, i) {
            agingDays.forEach(function (a, j) {
                var val = z[i][j];
                if (val > maxVal) maxVal = val;
            });
        });
        carrierNames.forEach(function (c, i) {
            agingDays.forEach(function (a, j) {
                var val = z[i][j];
                annotations.push({
                    x: a, y: c,
                    text: val > 0 ? val.toLocaleString() : '',
                    showarrow: false,
                    font: { size: 11, color: val > maxVal * 0.5 ? '#fff' : '#1e293b', family: 'Inter, sans-serif' }
                });
            });
        });

        var traces = [{
            x: agingDays,
            y: carrierNames,
            z: z,
            type: 'heatmap',
            colorscale: [[0,'#f0f9ff'],[0.15,'#bae6fd'],[0.35,'#7dd3fc'],[0.55,'#38bdf8'],[0.75,'#0284c7'],[1,'#1e3a5f']],
            showscale: true,
            colorbar: { title: 'Count', thickness: 12, len: 0.9 },
            hovertemplate: '%{y}<br>Aging: %{x} days<br>Count: %{z:,}<extra></extra>'
        }];

        var layout = {
            xaxis: { title: 'Aging (Days)', tickmode: 'array', tickvals: agingDays, ticktext: agingDays.map(String) },
            yaxis: { automargin: true },
            margin: { t: 10, r: 80, b: 50, l: 110 },
            font: { family: 'Inter, Noto Sans, sans-serif', size: 12 },
            height: 350,
            annotations: annotations
        };

        Plotly.newPlot('chart-heatmap', traces, layout, P_CFG);
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

        // Carrier detail navigation
        document.getElementById('btn-carrier-prev').addEventListener('click', function () {
            setCarrier(CARRIER_IDX - 1);
        });
        document.getElementById('btn-carrier-next').addEventListener('click', function () {
            setCarrier(CARRIER_IDX + 1);
        });
        document.getElementById('carrier-select').addEventListener('change', function () {
            var idx = CARRIER_LIST.indexOf(this.value);
            if (idx >= 0) setCarrier(idx);
        });
    }

    init();
})();
