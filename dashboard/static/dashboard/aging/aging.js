/* ============================================================
   Aging Dashboard — Missing Pickup Date
   Hybrid cube: fetch once, render from cache, 15-min auto-refresh.
   ============================================================ */
(function () {
    'use strict';

    var API_URL   = '/api/aging/';
    var CACHE_KEY = 'lms_aging_cache';
    var TIMER_KEY = 'lms_timer_aging';
    var DATA      = null;
    var fp        = null;   // Flatpickr instance

    // Cache + Timer instances (LMS.Cache/Timer are constructors)
    var cache = new LMS.Cache(CACHE_KEY, 15);
    var timer = null;

    // Plotly shared config
    var P_CFG = { responsive: true, displayModeBar: false };
    var COLORS = [
        '#2563eb', '#dc2626', '#059669', '#d97706',
        '#7c3aed', '#db2777', '#0891b2', '#ea580c',
        '#65a30d', '#0d9488', '#e11d48', '#9333ea'
    ];

    // Shared Plotly axis styling (professional grid)
    var AXIS_STYLE = {
        gridcolor: '#eef2f7',
        gridwidth: 1,
        linecolor: '#d8dee6',
        linewidth: 1,
        zerolinecolor: '#d8dee6',
        zerolinewidth: 1,
        tickfont: { size: 11, color: '#475569' },
        titlefont: { size: 12, color: '#334155', family: 'Inter, Noto Sans, sans-serif' }
    };
    var PLOT_BG = '#fff';
    var PAPER_BG = '#fff';

    function showContent() {
        document.getElementById('skeleton-loading').style.display = 'none';
        document.getElementById('sky-widgets').classList.remove('hidden');
    }

    // --------------------------------------------------------
    // FETCH  (optional targetDate -> /api/aging/?date=YYYY-MM-DD)
    // --------------------------------------------------------
    function doFetch(showSkeleton, targetDate) {
        if (showSkeleton) {
            document.getElementById('skeleton-loading').style.display = '';
            document.getElementById('sky-widgets').classList.add('hidden');
        } else {
            LMS.showLoading();
        }

        var url = API_URL;
        if (targetDate) url += '?date=' + encodeURIComponent(targetDate);

        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (data) {
                DATA = data;
                DATA.cube = JSON.parse(data.cube_json || '[]');
                cache.set(data);
                showContent();
                renderDashboard();
                if (!showSkeleton) LMS.hideLoading(DATA.selected.week_from, DATA.selected.week_to);
            })
            .catch(function (err) {
                console.error('[AGING] fetch error:', err);
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
            '<strong>Available:</strong> ' + LMS.fmtDate(DATA.selected.week_from) + ' \u2014 ' + LMS.fmtDate(DATA.selected.week_to);

        // --- Date picker (Flatpickr) ---
        initDatePicker(DATA.available_dates || [], latestDate);

        // --- Build carrier list for detail viewer ---
        CARRIER_LIST = Object.keys(carrierAging).sort();
        CARRIER_PAGE = 0;

        // --- Charts ---
        renderAgingChart(todayRows);
        renderCarrierSidebar(todayRows);
        renderCarrierPage(todayRows);
        renderSeverityChart(todayRows);
        renderHeatmap(todayRows);
        injectTooltips();
    }

    // --------------------------------------------------------
    // INFO TOOLTIPS (? icon on each chart/KPI)
    // --------------------------------------------------------
    var TIPS_DONE = false;
    var TIP_SVG = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="7"/><path d="M6.5 6a1.5 1.5 0 013 0c0 1-1.5 1.5-1.5 2.5"/><circle cx="8" cy="12" r="0.5" fill="currentColor" stroke="none"/></svg>';

    var CHART_TIPS = {
        'Aging Distribution': 'Shipments with no Pickup Date. Stacked bars by aging days (1\u20137) per carrier. Dotted line = total.',
        'Aging by Carrier': 'Shipments with no Pickup Date. Ranked by total aging items. Bar = share of total.',
        'Carrier Detail': 'Per-carrier aging bars. Blue = 1\u20132 days, Yellow = 3\u20134, Red = 5+. Navigate with arrows.',
        'Aging Severity by Carrier': 'Each bar shows how a carrier\u2019s aging shipments break down by severity. Blue = 1\u20132 days (Low), Amber = 3\u20134 days (Medium), Red = 5+ days (High). Wider red = worse. Sorted by % critical.',
        'Carrier \u00d7 Aging Heatmap': 'Shipment count per carrier per aging day (no Pickup Date). Darker = higher volume.'
    };

    var KPI_TIPS = {
        'Total Aging Items': 'Shipments with no Pickup Date and aging > 0 on the selected date.',
        'Avg Aging Days': 'Weighted average: sum(aging \u00d7 count) / total aging items.',
        'On-Time %': 'Shipments marked Y / ALL shipments (blanks count toward total).',
        'Worst Carrier': 'Carrier with the highest weighted-average aging days.',
        'Critical (5+ Days)': 'Count of shipments aging 5 or more days.'
    };

    function injectTooltips() {
        if (TIPS_DONE) return;
        TIPS_DONE = true;

        document.querySelectorAll('#sky-widgets .card-title').forEach(function (el) {
            var text = el.childNodes[0] ? el.childNodes[0].textContent.trim() : '';
            var tip = CHART_TIPS[text];
            if (tip && !el.querySelector('.info-tip')) {
                var s = document.createElement('span');
                s.className = 'info-tip';
                s.setAttribute('data-tip', tip);
                s.innerHTML = TIP_SVG;
                el.appendChild(s);
            }
        });

        document.querySelectorAll('#sky-widgets .kpi-label').forEach(function (el) {
            var text = el.textContent.trim();
            var tip = KPI_TIPS[text];
            if (tip && !el.querySelector('.info-tip')) {
                var s = document.createElement('span');
                s.className = 'info-tip';
                s.setAttribute('data-tip', tip);
                s.innerHTML = TIP_SVG;
                el.appendChild(s);
            }
        });
    }

    // --------------------------------------------------------
    // DATE PICKER (Flatpickr — only available dates clickable)
    // --------------------------------------------------------
    function initDatePicker(dates, selectedDate) {
        var el = document.getElementById('date-picker');
        if (!el || !dates.length) return;

        if (fp) { fp.destroy(); fp = null; }

        fp = flatpickr(el, {
            dateFormat: 'Y-m-d',
            altInput: true,
            altFormat: 'm/d/Y',
            enable: dates,
            defaultDate: selectedDate,
            disableMobile: true,
            onChange: function (sel, dateStr) {
                if (dateStr && dateStr !== DATA.latest_date) {
                    cache.clear();
                    doFetch(false, dateStr);
                }
            }
        });
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
            xaxis: Object.assign({}, AXIS_STYLE, { title: 'Aging (Days)', tickmode: 'array', tickvals: agingBuckets, ticktext: agingBuckets.map(String), showgrid: false }),
            yaxis: Object.assign({}, AXIS_STYLE, { title: 'Count' }),
            margin: { t: 20, r: 20, b: 60, l: 60 },
            legend: { orientation: 'h', y: -0.3, x: 0.5, xanchor: 'center', font: { size: 11, color: '#475569' } },
            font: { family: 'Inter, Noto Sans, sans-serif', size: 11 },
            plot_bgcolor: PLOT_BG,
            paper_bgcolor: PAPER_BG,
            height: 420,
            bargap: 0.18
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
    var CARRIER_PAGE = 0;
    var PAGE_SIZE = 3;

    function renderCarrierPage(todayRows) {
        var start = CARRIER_PAGE * PAGE_SIZE;
        var pageCarriers = CARRIER_LIST.slice(start, start + PAGE_SIZE);

        // Update page indicator
        var info = document.getElementById('carrier-page-info');
        if (info) {
            info.textContent = (start + 1) + '\u2013' + Math.min(start + PAGE_SIZE, CARRIER_LIST.length) + ' of ' + CARRIER_LIST.length;
        }

        // Render each slot (3 per page)
        for (var s = 0; s < PAGE_SIZE; s++) {
            var slotId = 'carrier-slot-' + s;
            var el = document.getElementById(slotId);
            if (!el) continue;

            if (s >= pageCarriers.length) {
                el.innerHTML = '<div style="height:280px;display:flex;align-items:center;justify-content:center;color:#94a3b8;">\u2014</div>';
                continue;
            }
            renderSingleCarrier(slotId, todayRows, pageCarriers[s]);
        }
    }

    function renderSingleCarrier(containerId, todayRows, carrierName) {
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
            textfont: { size: 11, color: '#334155' },
            hovertemplate: carrierName + '<br>Aging %{x} days<br>Count: %{y:,}<extra></extra>'
        }];

        var layout = {
            title: { text: '<b>' + carrierName + '</b> \u2014 ' + total.toLocaleString() + ' items', font: { size: 12, color: '#1e293b' }, x: 0.5 },
            xaxis: Object.assign({}, AXIS_STYLE, { title: 'Aging (Days)', tickmode: 'array', tickvals: agingBuckets, ticktext: agingBuckets.map(String), range: [0.4, 7.6], showgrid: false }),
            yaxis: Object.assign({}, AXIS_STYLE, { title: '', automargin: true }),
            margin: { t: 40, r: 8, b: 38, l: 30 },
            font: { family: 'Inter, Noto Sans, sans-serif', size: 11 },
            plot_bgcolor: PLOT_BG,
            paper_bgcolor: PAPER_BG,
            height: 260,
            bargap: 0.35,
            showlegend: false
        };

        Plotly.newPlot(containerId, traces, layout, P_CFG);
    }

    function setCarrierPage(page) {
        var totalPages = Math.ceil(CARRIER_LIST.length / PAGE_SIZE);
        if (totalPages === 0) return;
        CARRIER_PAGE = ((page % totalPages) + totalPages) % totalPages;
        var todayRows = DATA.cube.filter(function (r) { return r.ud === DATA.latest_date; });
        renderCarrierPage(todayRows);
    }

    // --------------------------------------------------------
    // CHART 3: Aging Severity by Carrier (100% stacked horizontal bar)
    // --------------------------------------------------------
    function renderSeverityChart(todayRows) {
        var carriers = {};
        todayRows.forEach(function (r) {
            if (r.a <= 0) return; // skip non-aging rows
            if (!carriers[r.c]) carriers[r.c] = { low: 0, med: 0, high: 0, total: 0 };
            carriers[r.c].total += r.n;
            if (r.a <= 2)      carriers[r.c].low  += r.n;
            else if (r.a <= 4) carriers[r.c].med  += r.n;
            else               carriers[r.c].high += r.n;
        });

        // Sort by % high (critical) — worst at top in Plotly (last = top)
        var sorted = Object.keys(carriers).sort(function (a, b) {
            var pA = carriers[a].total > 0 ? carriers[a].high / carriers[a].total : 0;
            var pB = carriers[b].total > 0 ? carriers[b].high / carriers[b].total : 0;
            return pA - pB;
        });

        var names = sorted;
        function pct(c, bucket) {
            return carriers[c].total > 0 ? Math.round((carriers[c][bucket] / carriers[c].total) * 1000) / 10 : 0;
        }

        var lowPcts  = names.map(function (c) { return pct(c, 'low'); });
        var medPcts  = names.map(function (c) { return pct(c, 'med'); });
        var highPcts = names.map(function (c) { return pct(c, 'high'); });

        function makeTrace(label, vals, color, rawCounts, bucket) {
            return {
                x: vals, y: names, type: 'bar', orientation: 'h', name: label,
                marker: { color: color, line: { color: '#fff', width: 1 } },
                text: vals.map(function (v, i) { return v >= 8 ? rawCounts[i] + ' (' + v + '%)' : ''; }),
                textposition: 'inside',
                textfont: { size: 10, color: '#fff', family: 'Inter, sans-serif' },
                hovertemplate: '%{y}<br>' + label + ': ' + bucket + '<br>%{x}% (' + '%{text})<extra></extra>',
                customdata: rawCounts
            };
        }

        var lowCounts  = names.map(function (c) { return carriers[c].low; });
        var medCounts  = names.map(function (c) { return carriers[c].med; });
        var highCounts = names.map(function (c) { return carriers[c].high; });

        var traces = [
            makeTrace('Low (1-2d)',     lowPcts,  '#3b82f6', lowCounts,  '1\u20132 days'),
            makeTrace('Medium (3-4d)',  medPcts,  '#f59e0b', medCounts,  '3\u20134 days'),
            makeTrace('High (5+d)',     highPcts, '#ef4444', highCounts, '5+ days')
        ];

        var layout = {
            xaxis: Object.assign({}, AXIS_STYLE, { title: 'Severity Mix (%)', range: [0, 105], ticksuffix: '%' }),
            yaxis: Object.assign({}, AXIS_STYLE, { automargin: true }),
            margin: { t: 10, r: 20, b: 50, l: 110 },
            font: { family: 'Inter, Noto Sans, sans-serif', size: 11 },
            plot_bgcolor: PLOT_BG,
            paper_bgcolor: PAPER_BG,
            height: 350,
            bargap: 0.18,
            barmode: 'stack',
            showlegend: true,
            legend: { orientation: 'h', x: 0.5, xanchor: 'center', y: 1.06, font: { size: 10 } }
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
            colorscale: [[0,'#f8fafc'],[0.15,'#e2e8f0'],[0.35,'#94a3b8'],[0.55,'#64748b'],[0.75,'#334155'],[1,'#0f172a']],
            showscale: true,
            colorbar: { title: 'Count', thickness: 12, len: 0.9 },
            hovertemplate: '%{y}<br>Aging: %{x} days<br>Count: %{z:,}<extra></extra>'
        }];

        var layout = {
            xaxis: Object.assign({}, AXIS_STYLE, { title: 'Aging (Days)', tickmode: 'array', tickvals: agingDays, ticktext: agingDays.map(String), showgrid: false }),
            yaxis: Object.assign({}, AXIS_STYLE, { automargin: true, showgrid: false }),
            margin: { t: 10, r: 80, b: 50, l: 110 },
            font: { family: 'Inter, Noto Sans, sans-serif', size: 11 },
            plot_bgcolor: PLOT_BG,
            paper_bgcolor: PAPER_BG,
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
        LMS.exportXLSX([{name: 'Aging Dashboard', rows: aoa}], 'AGING_' + DATA.latest_date + '.xlsx');
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
            showContent();
            renderDashboard();
        } else {
            doFetch(true);
        }

        // 15-minute auto-refresh timer
        timer = new LMS.Timer(TIMER_KEY, 15, function () { doFetch(false); });

        // Refresh button (respects selected date)
        var btnRefresh = document.getElementById('btn-refresh');
        if (btnRefresh) btnRefresh.addEventListener('click', function () {
            cache.clear();
            timer.reset();
            var cur = fp ? fp.selectedDates[0] : null;
            var dateStr = cur ? flatpickr.formatDate(cur, 'Y-m-d') : null;
            doFetch(true, dateStr);
        });

        // Export button
        var btnExport = document.getElementById('btn-export');
        if (btnExport) btnExport.addEventListener('click', exportData);

        // Carrier detail navigation (pages of 3)
        var btnPrev = document.getElementById('btn-carrier-prev');
        if (btnPrev) btnPrev.addEventListener('click', function () {
            setCarrierPage(CARRIER_PAGE - 1);
        });
        var btnNext = document.getElementById('btn-carrier-next');
        if (btnNext) btnNext.addEventListener('click', function () {
            setCarrierPage(CARRIER_PAGE + 1);
        });
    }

    init();
})();
