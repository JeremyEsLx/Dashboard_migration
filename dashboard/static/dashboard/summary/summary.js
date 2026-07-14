/**
 * Summary Dashboard — Client-side Logic
 *
 * Architecture: "Hybrid Cube"
 *   - Server sends a pre-aggregated cube (Movement × Supervisor × Shift)
 *   - Supervisor/Shift filtering is instant (JavaScript, no server call)
 *   - Date/Week changes trigger a server reload (new dataset)
 *
 * Sections:
 *   1. Cube Filtering & KPI Computation
 *   2. Plotly Render Functions (Gauge, Charts)
 *   3. Master Render
 *   4. Filter Event Handlers
 *   5. Auto-Refresh Timer (15 min, sessionStorage-persisted)
 *   6. Reset & Refresh Buttons
 */

// ================================================================
// CONSTANTS
// ================================================================
const COLOR_GREEN = '#10b981';
const COLOR_YELLOW = '#f59e0b';
const COLOR_PINK = '#f87171';
const GRID_COLOR = '#f3f4f6';
const REFRESH_INTERVAL = 15 * 60; // seconds


// ================================================================
// 1. CUBE FILTERING & KPI COMPUTATION
// ================================================================

function filterCube(supervisor, shift) {
    var rows = CUBE;
    if (supervisor && supervisor !== 'All') {
        rows = rows.filter(r => r.s === supervisor);
    }
    if (shift && shift !== 'All') {
        rows = rows.filter(r => r.sh === shift);
    }
    return rows;
}

function computeAll(filtered) {
    // Totals
    var totalQty = 0, totalLd = 0, totalTt = 0;
    for (var i = 0; i < filtered.length; i++) {
        totalQty += filtered[i].q;
        totalLd += filtered[i].ld;
        totalTt += filtered[i].tt;
    }

    // KPIs
    var uph = totalLd > 0 ? Math.round(totalQty / (totalLd / 60)) : 0;
    var targetUph = totalTt > 0 ? Math.round(totalQty / totalTt) : 0;
    var uphPct = targetUph > 0 ? Math.round((uph / targetUph) * 100) : 0;
    var actualTime = Math.round(totalLd / 60 * 100) / 100;
    var standardTime = Math.round(totalTt * 100) / 100;
    var productivity = standardTime > 0 ? Math.round((actualTime / standardTime - 1) * 100) : 0;

    // Group by movement
    var byMovement = {};
    for (var i = 0; i < filtered.length; i++) {
        var r = filtered[i];
        if (!byMovement[r.m]) byMovement[r.m] = {q: 0, ld: 0, tt: 0};
        byMovement[r.m].q += r.q;
        byMovement[r.m].ld += r.ld;
        byMovement[r.m].tt += r.tt;
    }

    // Quantity by Process (sorted DESC)
    var qtyEntries = Object.entries(byMovement).map(([m, v]) => [m, Math.round(v.q)]);
    qtyEntries.sort((a, b) => b[1] - a[1]);

    // Target% by Process (sorted DESC)
    var targetEntries = Object.entries(byMovement).map(([m, v]) => {
        var pct = v.ld > 0 ? Math.round(v.tt * 60 / v.ld * 100) : 0;
        return [m, pct];
    });
    targetEntries.sort((a, b) => b[1] - a[1]);

    // Productivity by Process (sorted ASC)
    var prodEntries = Object.entries(byMovement).map(([m, v]) => {
        var p = v.tt > 0 ? Math.round(((v.ld / 60) / v.tt - 1) * 100) : 0;
        return [m, p];
    });
    prodEntries.sort((a, b) => a[1] - b[1]);

    return {
        uph: uph, targetUph: targetUph, uphPct: uphPct,
        actualTime: actualTime, standardTime: standardTime,
        productivity: productivity,
        qtyByProcess: qtyEntries, targetByProcess: targetEntries,
        prodByProcess: prodEntries
    };
}


// ================================================================
// 2. PLOTLY RENDER FUNCTIONS
// ================================================================

function renderGauge(uph, target) {
    Plotly.react('gauge-container', [{
        type: 'indicator',
        mode: 'gauge+number',
        value: uph,
        number: { font: { size: 38, color: '#1e293b' } },
        gauge: {
            axis: { range: [0, 300], tickwidth: 1, tickcolor: '#e2e8f0', dtick: 100 },
            bar: { color: '#1e293b', thickness: 0.12 },
            bgcolor: '#f8fafc',
            borderwidth: 0,
            steps: [
                { range: [0, target], color: '#dcfce7' },
                { range: [target, 300], color: '#4ade80' }
            ],
            threshold: { line: { color: '#1d4ed8', width: 4 }, thickness: 0.85, value: target }
        }
    }], {
        margin: { t: 10, b: 5, l: 30, r: 30 },
        height: 150,
        paper_bgcolor: 'transparent',
        annotations: [{
            x: 0.82, y: 0.45,
            text: '<b style="color:#1d4ed8">' + target + '</b>',
            showarrow: false,
            font: { size: 14, color: '#1d4ed8' }
        }]
    }, { responsive: true, displayModeBar: false });
}

function renderKPIs(data) {
    document.getElementById('kpi-uph-pct').textContent = data.uphPct + '%';
    document.getElementById('kpi-actual').textContent = data.actualTime;
    document.getElementById('kpi-standard').textContent = data.standardTime;
    document.getElementById('kpi-productivity').textContent = data.productivity + '%';
}

function renderQtyChart(entries) {
    var labels = entries.map(e => e[0]).reverse();
    var values = entries.map(e => e[1]).reverse();
    Plotly.react('chart-quantity', [{
        type: 'bar', y: labels, x: values, orientation: 'h',
        text: values.map(v => v >= 1000 ? (v / 1000).toFixed(0) + 'K' : v),
        textposition: 'outside',
        marker: {
            color: labels.map(p => p === 'REPLENISHMENT' ? COLOR_GREEN : COLOR_PINK),
            line: { width: 0 }
        },
        hovertemplate: '%{y}: %{x:,.0f}<extra></extra>'
    }], {
        margin: { t: 5, b: 30, l: 110, r: 50 },
        xaxis: { title: '', gridcolor: GRID_COLOR },
        yaxis: { automargin: true },
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
    }, { responsive: true, displayModeBar: false });
}

function renderTargetChart(entries) {
    var labels = entries.map(e => e[0]).reverse();
    var values = entries.map(e => e[1]).reverse();
    Plotly.react('chart-uph-target', [{
        type: 'bar', y: labels, x: values, orientation: 'h',
        text: values.map(v => v + '%'),
        textposition: 'outside',
        marker: {
            color: values.map(v => {
                if (v >= 100) return COLOR_GREEN;
                if (v >= 80) return COLOR_YELLOW;
                return COLOR_PINK;
            }),
            line: { width: 0 }
        },
        hovertemplate: '%{y}: %{x}%<extra></extra>'
    }], {
        margin: { t: 5, b: 30, l: 120, r: 55 },
        xaxis: { title: '', range: [0, Math.max(...values, 0) * 1.15], gridcolor: GRID_COLOR },
        yaxis: { automargin: true },
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
    }, { responsive: true, displayModeBar: false });
}

function renderProdChart(entries) {
    var labels = entries.map(e => e[0]).reverse();
    var values = entries.map(e => e[1]).reverse();
    var mn = Math.min(...values, 0);
    var mx = Math.max(...values, 0);
    Plotly.react('chart-productivity', [{
        type: 'bar', y: labels, x: values, orientation: 'h',
        text: values.map(v => v + '%'),
        textposition: 'auto',
        marker: {
            color: values.map(v => {
                if (v < 0) return COLOR_GREEN;
                if (v <= 20) return COLOR_YELLOW;
                return COLOR_PINK;
            }),
            line: { width: 0 }
        },
        hovertemplate: '%{y}: %{x}%<extra></extra>'
    }], {
        margin: { t: 5, b: 30, l: 120, r: 55 },
        yaxis: { automargin: true },
        xaxis: { range: [mn * 1.15, mx * 1.15], gridcolor: GRID_COLOR, zeroline: true, zerolinecolor: '#94a3b8' },
        paper_bgcolor: 'transparent', plot_bgcolor: 'transparent'
    }, { responsive: true, displayModeBar: false });
}


// ================================================================
// 3. MASTER RENDER
// ================================================================

function renderAll() {
    var supervisor = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;
    var filtered = filterCube(supervisor, shift);
    var data = computeAll(filtered);
    renderGauge(data.uph, data.targetUph);
    renderKPIs(data);
    renderQtyChart(data.qtyByProcess);
    renderTargetChart(data.targetByProcess);
    renderProdChart(data.prodByProcess);
}


// ================================================================
// 4. FILTER EVENT HANDLERS
// ================================================================

// Supervisor & Shift = CLIENT-SIDE instant (no server call)
document.getElementById('filter-supervisor').addEventListener('change', renderAll);
document.getElementById('filter-shift').addEventListener('change', renderAll);

// Date & Week = SERVER reload (mutually exclusive)
function reloadForDate() {
    var params = new URLSearchParams();
    var sup = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;
    var dateVal = document.getElementById('filter-date').value;
    if (sup !== 'All') params.set('supervisor', sup);
    if (shift !== 'All') params.set('shift', shift);
    if (dateVal) params.set('date', dateVal);
    preserveTimer();
    window.location.href = '/' + (params.toString() ? '?' + params.toString() : '');
}

function reloadForWeek() {
    var params = new URLSearchParams();
    var sup = document.getElementById('filter-supervisor').value;
    var shift = document.getElementById('filter-shift').value;
    var week = document.getElementById('filter-week').value;
    if (sup !== 'All') params.set('supervisor', sup);
    if (shift !== 'All') params.set('shift', shift);
    if (week !== 'All') params.set('week', week);
    preserveTimer();
    window.location.href = '/' + (params.toString() ? '?' + params.toString() : '');
}

document.getElementById('filter-date').addEventListener('change', reloadForDate);
document.getElementById('filter-week').addEventListener('change', reloadForWeek);


// ================================================================
// 5. AUTO-REFRESH TIMER (15 min)
//    Persists across filter/reset navigation via sessionStorage.
//    Only "Refresh" button resets it.
// ================================================================

var timerEl = document.getElementById('refresh-timer');
var timerStart;

function preserveTimer() {
    sessionStorage.setItem('lms_timer_start', timerStart.toString());
}

function initTimer() {
    var stored = sessionStorage.getItem('lms_timer_start');
    if (stored) {
        timerStart = parseInt(stored, 10);
        var elapsed = Math.floor((Date.now() - timerStart) / 1000);
        if (elapsed >= REFRESH_INTERVAL) {
            sessionStorage.removeItem('lms_timer_start');
            window.location.reload();
            return;
        }
    } else {
        timerStart = Date.now();
        sessionStorage.setItem('lms_timer_start', timerStart.toString());
    }
}

function getSecondsLeft() {
    var elapsed = Math.floor((Date.now() - timerStart) / 1000);
    return Math.max(0, REFRESH_INTERVAL - elapsed);
}

function updateTimerDisplay() {
    var left = getSecondsLeft();
    var mins = Math.floor(left / 60);
    var secs = left % 60;
    timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
}

function tickTimer() {
    if (getSecondsLeft() <= 0) {
        sessionStorage.removeItem('lms_timer_start');
        window.location.reload();
    } else {
        updateTimerDisplay();
    }
}

initTimer();
updateTimerDisplay();
setInterval(tickTimer, 1000);


// ================================================================
// 6. RESET & REFRESH BUTTONS
// ================================================================

document.getElementById('btn-reset').addEventListener('click', function() {
    // Reset filters but KEEP timer running
    preserveTimer();
    window.location.href = '/';
});

document.getElementById('btn-refresh').addEventListener('click', function() {
    // Refresh data + RESET timer
    sessionStorage.removeItem('lms_timer_start');
    window.location.reload();
});


// ================================================================
// INIT
// ================================================================
renderAll();
