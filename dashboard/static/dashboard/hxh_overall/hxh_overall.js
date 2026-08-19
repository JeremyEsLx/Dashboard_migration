/**
 * HxH Overall Performance
 * Hybrid-cube pattern: fetches full cube, filters client-side.
 */
(function() {
    'use strict';

    // ---- State ----
    var DATA = null;  // raw API response
    var CUBE = [];    // parsed cube array

    var cache = new LMS.Cache('lms_hxh_overall_cache', 30);
    var timer = new LMS.Timer('lms_timer_hxh_overall', 15, function() {
        cache.clear();
        window.location.reload();
    });

    // ---- Shift Logic ----
    function getShift(hour) {
        return (hour >= 6 && hour <= 18) ? 'Morning Shift' : 'Night Shift';
    }

    // ---- Filter Helpers ----
    function getFilterVal(id) {
        var el = document.getElementById(id);
        return el ? el.value : 'All';
    }

    function filterCube() {
        var process = getFilterVal('filter-process');
        var flow = getFilterVal('filter-flow');
        var cartType = getFilterVal('filter-carttype');
        var shift = getFilterVal('filter-shift');
        var dateVal = getFilterVal('filter-date');

        return CUBE.filter(function(r) {
            if (process !== 'All' && r.p !== process) return false;
            if (flow !== 'All' && r.f !== flow) return false;
            if (cartType !== 'All' && r.ct !== cartType) return false;
            if (shift !== 'All' && getShift(r.h) !== shift) return false;
            if (dateVal !== 'All' && r.d !== dateVal) return false;
            return true;
        });
    }

    // ---- Aggregation ----
    function aggregate(filtered) {
        // Group by day+hour
        var hourMap = {};  // key: 'day|hour' -> {units, users set}
        var totalUnits = 0;
        var allUsers = {};

        filtered.forEach(function(r) {
            var key = r.d + '|' + r.h;
            if (!hourMap[key]) hourMap[key] = { d: r.d, h: r.h, units: 0, users: {} };
            hourMap[key].units += r.units;
            hourMap[key].users[r.u] = true;
            totalUnits += r.units;
            allUsers[r.u] = true;
        });

        // Convert to sorted array
        var hourArr = Object.keys(hourMap).map(function(k) { return hourMap[k]; });
        hourArr.sort(function(a, b) {
            if (a.d < b.d) return -1;
            if (a.d > b.d) return 1;
            return a.h - b.h;
        });

        var totalUsers = Object.keys(allUsers).length;

        // Compute per-slot metrics
        // Bar value = units_in_hour / users_in_THAT_hour (per-hour productivity)
        var slots = hourArr.map(function(slot) {
            var userCount = Object.keys(slot.users).length;
            return {
                d: slot.d,
                h: slot.h,
                units: slot.units,
                users: userCount,
                avg: userCount > 0 ? Math.round(slot.units / userCount) : 0,
            };
        });

        var totalSlots = slots.length;

        // KPI: weighted average = totalUnits / total user-hour pairs
        // (Power BI weights hours by how many users worked in them)
        var totalUserHourPairs = slots.reduce(function(a, s) { return a + s.users; }, 0);
        var avgUnitsPerHour = totalUserHourPairs > 0 ? Math.round(totalUnits / totalUserHourPairs) : 0;

        // UPH by shift = weighted avg per shift (shift_units / shift_user_hour_pairs)
        var morningSlots = slots.filter(function(s) { return getShift(s.h) === 'Morning Shift'; });
        var nightSlots = slots.filter(function(s) { return getShift(s.h) === 'Night Shift'; });
        var morningUnits = morningSlots.reduce(function(a, s) { return a + s.units; }, 0);
        var morningPairs = morningSlots.reduce(function(a, s) { return a + s.users; }, 0);
        var nightUnits = nightSlots.reduce(function(a, s) { return a + s.units; }, 0);
        var nightPairs = nightSlots.reduce(function(a, s) { return a + s.users; }, 0);
        var morningUPH = morningPairs > 0 ? Math.round(morningUnits / morningPairs) : 0;
        var nightUPH = nightPairs > 0 ? Math.round(nightUnits / nightPairs) : 0;

        return {
            slots: slots,
            totalUnits: totalUnits,
            totalUsers: totalUsers,
            avgUnitsPerHour: avgUnitsPerHour,
            morningUPH: morningUPH,
            nightUPH: nightUPH,
        };
    }

    // ---- Gray Gradient ----
    function valueToGray(val, maxVal) {
        // Higher value = darker (range: #d1d5db light to #1f2937 dark)
        if (maxVal === 0) return '#9ca3af';
        var ratio = Math.min(val / maxVal, 1);
        // Interpolate between 200 (light) and 50 (dark)
        var lightness = Math.round(200 - ratio * 150);
        return 'rgb(' + lightness + ',' + lightness + ',' + lightness + ')';
    }

    function buildBarColors(values) {
        var max = Math.max.apply(null, values.concat([1]));
        return values.map(function(v) { return valueToGray(v, max); });
    }

    // ---- Chart Rendering ----
    function buildXLabels(slots) {
        // Multi-level x-axis: hour on top, date below (grouped)
        return slots.map(function(s) {
            return s.h.toString();
        });
    }

    function buildTickText(slots) {
        // Show date label at the first hour of each day
        var labels = [];
        var lastDate = '';
        slots.forEach(function(s) {
            if (s.d !== lastDate) {
                var parts = s.d.split('-');
                labels.push(s.h + '<br>' + parts[1] + '/' + parts[2] + '/' + parts[0]);
                lastDate = s.d;
            } else {
                labels.push(s.h.toString());
            }
        });
        return labels;
    }

    var CHART_LAYOUT_BASE = {
        margin: { t: 4, r: 8, b: 32, l: 34 },
        paper_bgcolor: 'rgba(0,0,0,0)',
        plot_bgcolor: 'rgba(0,0,0,0)',
        font: { family: 'Inter, sans-serif', size: 10 },
        bargap: 0.15,
        showlegend: false,
        autosize: true,
    };

    var CHART_CONFIG = { displayModeBar: false, responsive: true };

    function renderUnitsChart(slots) {
        var container = document.getElementById('chart-units-hour');
        var values = slots.map(function(s) { return s.units; });
        var xLabels = buildTickText(slots);
        var colors = buildBarColors(values);
        var avg = values.length > 0 ? values.reduce(function(a, b) { return a + b; }, 0) / values.length : 0;

        var trace = {
            x: xLabels,
            y: values,
            type: 'bar',
            marker: { color: colors },
            text: values.map(function(v) { return v >= 1000 ? Math.round(v/1000) + 'K' : v.toString(); }),
            textposition: 'outside',
            textfont: { size: 9 },
            hovertemplate: '%{x}<br>Units: %{y:,}<extra></extra>',
        };

        var avgLine = {
            x: xLabels,
            y: xLabels.map(function() { return avg; }),
            type: 'scatter',
            mode: 'lines',
            line: { color: '#eab308', width: 2, dash: 'dash' },
            hoverinfo: 'skip',
        };

        var layout = Object.assign({}, CHART_LAYOUT_BASE, {
            yaxis: { gridcolor: '#f1f5f9', zeroline: false, rangemode: 'tozero' },
            xaxis: { tickangle: 0, tickfont: { size: 9 } },
        });

        Plotly.newPlot(container, [trace, avgLine], layout, CHART_CONFIG);
    }

    function renderUsersChart(slots) {
        var container = document.getElementById('chart-users-hour');
        var values = slots.map(function(s) { return s.users; });
        var xLabels = buildTickText(slots);
        var colors = buildBarColors(values);
        var avg = values.length > 0 ? values.reduce(function(a, b) { return a + b; }, 0) / values.length : 0;

        var trace = {
            x: xLabels,
            y: values,
            type: 'bar',
            marker: { color: colors },
            text: values.map(function(v) { return v.toString(); }),
            textposition: 'outside',
            textfont: { size: 9 },
            hovertemplate: '%{x}<br>Users: %{y}<extra></extra>',
        };

        var avgLine = {
            x: xLabels,
            y: xLabels.map(function() { return avg; }),
            type: 'scatter',
            mode: 'lines',
            line: { color: '#eab308', width: 2, dash: 'dash' },
            hoverinfo: 'skip',
        };

        var layout = Object.assign({}, CHART_LAYOUT_BASE, {
            yaxis: { gridcolor: '#f1f5f9', zeroline: false, rangemode: 'tozero' },
            xaxis: { tickangle: 0, tickfont: { size: 9 } },
        });

        Plotly.newPlot(container, [trace, avgLine], layout, CHART_CONFIG);
    }

    function renderAvgChart(slots) {
        var container = document.getElementById('chart-avg-hour');
        var values = slots.map(function(s) { return s.avg; });
        var xLabels = buildTickText(slots);
        var colors = buildBarColors(values);
        var avg = values.length > 0 ? values.reduce(function(a, b) { return a + b; }, 0) / values.length : 0;

        var trace = {
            x: xLabels,
            y: values,
            type: 'bar',
            marker: { color: colors },
            text: values.map(function(v) { return v.toString(); }),
            textposition: 'outside',
            textfont: { size: 9 },
            hovertemplate: '%{x}<br>Avg Units: %{y:,}<extra></extra>',
        };

        var avgLine = {
            x: xLabels,
            y: xLabels.map(function() { return avg; }),
            type: 'scatter',
            mode: 'lines',
            line: { color: '#eab308', width: 2, dash: 'dash' },
            hoverinfo: 'skip',
        };

        var layout = Object.assign({}, CHART_LAYOUT_BASE, {
            yaxis: { gridcolor: '#f1f5f9', zeroline: false, rangemode: 'tozero' },
            xaxis: { tickangle: 0, tickfont: { size: 9 } },
        });

        Plotly.newPlot(container, [trace, avgLine], layout, CHART_CONFIG);
    }

    function renderUPHShift(morningUPH, nightUPH) {
        var container = document.getElementById('chart-uph-shift');
        var maxVal = Math.max(morningUPH, nightUPH, 1);

        var trace = {
            y: ['Night Shift', 'Morning Shift'],
            x: [nightUPH, morningUPH],
            type: 'bar',
            orientation: 'h',
            marker: {
                color: [
                    valueToGray(nightUPH, maxVal),
                    valueToGray(morningUPH, maxVal),
                ],
            },
            text: [nightUPH.toString(), morningUPH.toString()],
            textposition: 'inside',
            insidetextanchor: 'middle',
            textfont: { size: 12, color: '#fff' },
            hovertemplate: '%{y}: %{x} UPH<extra></extra>',
        };

        var layout = Object.assign({}, CHART_LAYOUT_BASE, {
            margin: { t: 4, r: 8, b: 24, l: 4 },
            xaxis: { type: 'log', gridcolor: '#f1f5f9', zeroline: false, dtick: 1, tickfont: { size: 8 } },
            yaxis: { side: 'left', tickfont: { size: 9 }, automargin: true },
            bargap: 0.35,
            autosize: true,
        });

        Plotly.newPlot(container, [trace], layout, CHART_CONFIG);
    }

    // ---- KPIs ----
    function renderKPIs(agg) {
        var fmt = function(n) {
            if (n >= 1000) return Math.round(n / 1000) + 'K';
            return n.toString();
        };
        document.getElementById('kpi-total-units').textContent = fmt(agg.totalUnits);
        document.getElementById('kpi-active-users').textContent = agg.totalUsers.toString();
        document.getElementById('kpi-avg-units').textContent = agg.avgUnitsPerHour.toString();
    }

    // ---- Main Render ----
    function renderAll() {
        var filtered = filterCube();
        var agg = aggregate(filtered);

        // Render KPIs immediately (text only, no sizing issues)
        renderKPIs(agg);

        // Show container FIRST so Plotly can read proper dimensions
        document.getElementById('skeleton-loading').classList.add('hidden');
        document.getElementById('hxh-widgets').classList.remove('hidden');

        // Wait one frame for browser to compute layout, then render charts
        requestAnimationFrame(function() {
            renderUnitsChart(agg.slots);
            renderUsersChart(agg.slots);
            renderAvgChart(agg.slots);
            renderUPHShift(agg.morningUPH, agg.nightUPH);
            LMS.hideLoading(DATA.selected.date_from, DATA.selected.date_to);
        });
    }

    // ---- Data Loading ----
    function showSkeleton() {
        document.getElementById('skeleton-loading').classList.remove('hidden');
        document.getElementById('hxh-widgets').classList.add('hidden');
    }

    function buildApiUrl() {
        var dateFrom = document.getElementById('filter-date-from').value;
        var dateTo = document.getElementById('filter-date-to').value;
        var params = [];
        if (dateFrom) params.push('date_from=' + dateFrom);
        if (dateTo) params.push('date_to=' + dateTo);
        return '/api/hxh/' + (params.length ? '?' + params.join('&') : '');
    }

    function doFetch(showSkel) {
        if (showSkel) showSkeleton();
        LMS.showLoading();

        fetch(buildApiUrl())
            .then(function(r) { return r.json(); })
            .then(function(data) {
                DATA = data;
                CUBE = JSON.parse(data.cube_json);
                cache.set(data);

                // Populate filter dropdowns
                LMS.populateDropdown('filter-process', data.filters.processes, getFilterVal('filter-process'));
                LMS.populateDropdown('filter-flow', data.filters.flows, getFilterVal('filter-flow'));
                LMS.populateDropdown('filter-carttype', data.filters.cart_types, getFilterVal('filter-carttype'));
                LMS.populateDropdown('filter-date', data.filters.dates, getFilterVal('filter-date'));

                // Set date inputs if empty
                var dfEl = document.getElementById('filter-date-from');
                var dtEl = document.getElementById('filter-date-to');
                if (!dfEl.value) dfEl.value = data.selected.date_from;
                if (!dtEl.value) dtEl.value = data.selected.date_to;

                renderAll();
                timer.reset();
            })
            .catch(function(err) {
                console.error('[HxH] Fetch error:', err);
                LMS.hideLoading('', '');
            });
    }

    function loadData() {
        var cached = cache.get();
        if (cached) {
            DATA = cached;
            CUBE = JSON.parse(cached.cube_json);
            LMS.populateDropdown('filter-process', cached.filters.processes, 'All');
            LMS.populateDropdown('filter-flow', cached.filters.flows, 'All');
            LMS.populateDropdown('filter-carttype', cached.filters.cart_types, 'All');
            LMS.populateDropdown('filter-date', cached.filters.dates, 'All');
            var dfEl = document.getElementById('filter-date-from');
            var dtEl = document.getElementById('filter-date-to');
            if (!dfEl.value) dfEl.value = cached.selected.date_from;
            if (!dtEl.value) dtEl.value = cached.selected.date_to;
            renderAll();
            // Still fetch fresh in background
            doFetch(false);
        } else {
            doFetch(true);
        }
    }

    // ---- Event Listeners ----
    function onClientFilter() {
        if (!DATA) return;
        LMS.showLoading();
        requestAnimationFrame(function() {
            renderAll();
        });
    }

    document.getElementById('filter-process').addEventListener('change', onClientFilter);
    document.getElementById('filter-flow').addEventListener('change', onClientFilter);
    document.getElementById('filter-carttype').addEventListener('change', onClientFilter);
    document.getElementById('filter-shift').addEventListener('change', onClientFilter);
    document.getElementById('filter-date').addEventListener('change', onClientFilter);

    // Date range changes trigger fresh data fetch
    document.getElementById('filter-date-from').addEventListener('change', function() {
        cache.clear();
        doFetch(true);
    });
    document.getElementById('filter-date-to').addEventListener('change', function() {
        cache.clear();
        doFetch(true);
    });

    document.getElementById('btn-reset').addEventListener('click', function() {
        cache.clear();
        document.getElementById('filter-date-from').value = '';
        document.getElementById('filter-date-to').value = '';
        document.getElementById('filter-process').value = 'All';
        document.getElementById('filter-flow').value = 'All';
        document.getElementById('filter-carttype').value = 'All';
        document.getElementById('filter-shift').value = 'All';
        document.getElementById('filter-date').value = 'All';
        doFetch(true);
    });

    document.getElementById('btn-refresh').addEventListener('click', function() {
        cache.clear();
        doFetch(true);
    });

    // ---- Export ----
    document.getElementById('btn-export').addEventListener('click', function() {
        if (!DATA) return;
        var filtered = filterCube();
        var agg = aggregate(filtered);

        // Sheet 1: Summary by Hour
        var summaryRows = agg.slots.map(function(s) {
            return {
                Date: s.d,
                Hour: s.h,
                Shift: getShift(s.h),
                'Total Units': s.units,
                'Active Users': s.users,
                'Avg Units/User': s.avg,
            };
        });

        // Sheet 2: Detail (filtered cube)
        var detailRows = filtered.map(function(r) {
            return {
                Date: r.d,
                Hour: r.h,
                Shift: getShift(r.h),
                Process: r.p,
                Flow: r.f,
                'Cart Type': r.ct,
                User: r.u,
                'Country of Origin': r.co,
                Units: r.units,
            };
        });

        var dateFrom = document.getElementById('filter-date-from').value || DATA.selected.date_from;
        var dateTo = document.getElementById('filter-date-to').value || DATA.selected.date_to;
        var filename = 'HxH_OverallPerformance_' + dateFrom + '_to_' + dateTo + '.xlsx';

        LMS.exportXLSX([
            { name: 'Summary by Hour', rows: summaryRows },
            { name: 'Detail', rows: detailRows },
        ], filename);
    });

    // ---- Init ----
    loadData();
})();
