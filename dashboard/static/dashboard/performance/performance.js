/**
 * Performance by User — Client-side Logic
 *
 * Renders a hierarchical table: Process → Flow_Type_Map → Cart Type
 * with expand/collapse and computed KPIs per row.
 *
 * Cube rows: { p: process, f: flow_type, c: cart_type, s: supervisor, sh: shift,
 *              q: qty, ld: lineDay, tt: targetTime }
 *
 * Filters:
 *   - Supervisor, Process, Shift → client-side (instant)
 *   - Date Range, Week → server-side reload
 */

// ================================================================
// COLOR HELPERS
// ================================================================

function getProductivityClass(pct) {
    if (pct <= 0)   return 'cell-green';
    if (pct <= 15)  return 'cell-lime';
    if (pct <= 30)  return 'cell-amber';
    if (pct <= 50)  return 'cell-orange';
    return 'cell-red';
}

function getUphPctClass(pct) {
    if (pct >= 100) return 'cell-green';
    if (pct >= 80)  return 'cell-amber';
    if (pct >= 60)  return 'cell-orange';
    return 'cell-red';
}


// ================================================================
// CUBE FILTERING (client-side — Supervisor, Process, Shift)
// ================================================================

function filterCube() {
    var supervisor = document.getElementById('filter-supervisor').value;
    var process = document.getElementById('filter-process').value;
    var shift = document.getElementById('filter-shift').value;

    var rows = CUBE;
    if (supervisor && supervisor !== 'All') {
        rows = rows.filter(function(r) { return r.s === supervisor; });
    }
    if (process && process !== 'All') {
        rows = rows.filter(function(r) { return r.p === process; });
    }
    if (shift && shift !== 'All') {
        rows = rows.filter(function(r) { return r.sh === shift; });
    }
    return rows;
}


// ================================================================
// HIERARCHY BUILDER
// Aggregates cube data into a 3-level tree:
//   Level 0: Process
//   Level 1: Flow_Type_Map
//   Level 2: Cart Type
// ================================================================

function buildHierarchy(filteredCube) {
    var tree = {}; // { process: { flow: { cart: {q, ld, tt} } } }
    for (var i = 0; i < filteredCube.length; i++) {
        var r = filteredCube[i];
        var p = r.p || '(blank)';
        var f = r.f || '(blank)';
        var c = r.c || '(blank)';

        if (!tree[p]) tree[p] = {};
        if (!tree[p][f]) tree[p][f] = {};
        if (!tree[p][f][c]) tree[p][f][c] = {q: 0, ld: 0, tt: 0};

        tree[p][f][c].q += r.q;
        tree[p][f][c].ld += r.ld;
        tree[p][f][c].tt += r.tt;
    }
    return tree;
}

function computeMetrics(q, ld, tt) {
    var actualTime = ld / 60;
    var standardTime = tt;
    var uph = actualTime > 0 ? Math.round(q / actualTime) : 0;
    var targetUph = standardTime > 0 ? Math.round(q / standardTime) : 0;
    var uphPct = targetUph > 0 ? Math.round((uph / targetUph) * 100) : 0;
    var productivity = standardTime > 0 ? Math.round((actualTime / standardTime - 1) * 100) : 0;

    return {
        qty: Math.round(q),
        actualTime: Math.round(actualTime * 100) / 100,
        standardTime: Math.round(standardTime * 100) / 100,
        productivity: productivity,
        uph: uph,
        targetUph: targetUph,
        uphPct: uphPct
    };
}


// ================================================================
// TABLE RENDERING
// ================================================================

function renderTable() {
    var filtered = filterCube();
    var tree = buildHierarchy(filtered);
    var tbody = document.getElementById('perf-tbody');
    var html = '';

    // Grand totals
    var grandQ = 0, grandLd = 0, grandTt = 0;

    // Sort processes alphabetically
    var processes = Object.keys(tree).sort();

    for (var pi = 0; pi < processes.length; pi++) {
        var p = processes[pi];
        var flows = tree[p];

        // Process-level aggregates
        var pQ = 0, pLd = 0, pTt = 0;
        var flowKeys = Object.keys(flows).sort();

        for (var fi = 0; fi < flowKeys.length; fi++) {
            var f = flowKeys[fi];
            var carts = flows[f];
            var cartKeys = Object.keys(carts);
            for (var ci = 0; ci < cartKeys.length; ci++) {
                pQ += carts[cartKeys[ci]].q;
                pLd += carts[cartKeys[ci]].ld;
                pTt += carts[cartKeys[ci]].tt;
            }
        }
        grandQ += pQ; grandLd += pLd; grandTt += pTt;

        var pMetrics = computeMetrics(pQ, pLd, pTt);
        var pId = 'p-' + pi;

        // Process row (Level 0)
        html += '<tr class="row-level-0 row-toggle" data-target="' + pId + '">';
        html += '<td><span class="toggle-icon">&#9654;</span> ' + p + '</td>';
        html += numCells(pMetrics);
        html += '</tr>';

        // Flow Type rows (Level 1)
        for (var fi = 0; fi < flowKeys.length; fi++) {
            var f = flowKeys[fi];
            var carts = flows[f];
            var cartKeys = Object.keys(carts).sort();

            var fQ = 0, fLd = 0, fTt = 0;
            for (var ci = 0; ci < cartKeys.length; ci++) {
                fQ += carts[cartKeys[ci]].q;
                fLd += carts[cartKeys[ci]].ld;
                fTt += carts[cartKeys[ci]].tt;
            }
            var fMetrics = computeMetrics(fQ, fLd, fTt);
            var fId = pId + '-f-' + fi;

            html += '<tr class="row-level-1 row-hidden row-toggle ' + pId + '" data-target="' + fId + '">';
            html += '<td><span class="toggle-icon">&#9654;</span> ' + f + '</td>';
            html += numCells(fMetrics);
            html += '</tr>';

            // Cart Type rows (Level 2)
            for (var ci = 0; ci < cartKeys.length; ci++) {
                var c = cartKeys[ci];
                var cData = carts[c];
                var cMetrics = computeMetrics(cData.q, cData.ld, cData.tt);

                html += '<tr class="row-level-2 row-hidden ' + fId + '">';
                html += '<td>' + c + '</td>';
                html += numCells(cMetrics);
                html += '</tr>';
            }
        }
    }

    // Grand total row
    var grandMetrics = computeMetrics(grandQ, grandLd, grandTt);
    html += '<tr class="row-total">';
    html += '<td>TOTAL</td>';
    html += numCells(grandMetrics);
    html += '</tr>';

    tbody.innerHTML = html;
    attachToggleListeners();
}

function numCells(m) {
    return '<td class="col-num">' + m.qty.toLocaleString() + '</td>'
         + '<td class="col-num">' + m.actualTime + '</td>'
         + '<td class="col-num">' + m.standardTime + '</td>'
         + '<td class="col-num ' + getProductivityClass(m.productivity) + '">' + m.productivity + '%</td>'
         + '<td class="col-num">' + m.uph + '</td>'
         + '<td class="col-num">' + m.targetUph + '</td>'
         + '<td class="col-num ' + getUphPctClass(m.uphPct) + '">' + m.uphPct + '%</td>';
}


// ================================================================
// EXPAND / COLLAPSE
// ================================================================

function attachToggleListeners() {
    var toggles = document.querySelectorAll('.row-toggle');
    for (var i = 0; i < toggles.length; i++) {
        toggles[i].addEventListener('click', function() {
            var target = this.getAttribute('data-target');
            var children = document.querySelectorAll('.' + target);
            var isExpanded = this.classList.contains('expanded');

            if (isExpanded) {
                this.classList.remove('expanded');
                collapseRecursive(target);
            } else {
                this.classList.add('expanded');
                for (var j = 0; j < children.length; j++) {
                    children[j].classList.remove('row-hidden');
                }
            }
        });
    }
}

function collapseRecursive(parentClass) {
    var children = document.querySelectorAll('.' + parentClass);
    for (var i = 0; i < children.length; i++) {
        children[i].classList.add('row-hidden');
        children[i].classList.remove('expanded');
        var subTarget = children[i].getAttribute('data-target');
        if (subTarget) {
            collapseRecursive(subTarget);
        }
    }
}


// ================================================================
// FILTER HANDLERS
// ================================================================

// Supervisor, Process, Shift = CLIENT-SIDE instant re-render
document.getElementById('filter-supervisor').addEventListener('change', renderTable);
document.getElementById('filter-process').addEventListener('change', renderTable);
document.getElementById('filter-shift').addEventListener('change', renderTable);

// Date Range & Week = SERVER reload
function buildServerUrl() {
    var params = new URLSearchParams();
    var sup = document.getElementById('filter-supervisor').value;
    var proc = document.getElementById('filter-process').value;
    var shift = document.getElementById('filter-shift').value;
    var week = document.getElementById('filter-week').value;
    var dateFrom = document.getElementById('filter-date-from').value;
    var dateTo = document.getElementById('filter-date-to').value;

    if (sup !== 'All') params.set('supervisor', sup);
    if (proc !== 'All') params.set('process', proc);
    if (shift !== 'All') params.set('shift', shift);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (!dateFrom && !dateTo && week !== 'All') params.set('week', week);

    return '/performance/' + (params.toString() ? '?' + params.toString() : '');
}

function reloadForDate() {
    window.location.href = buildServerUrl();
}

function reloadForWeek() {
    // Clear date inputs when selecting week (mutually exclusive)
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    window.location.href = buildServerUrl();
}

document.getElementById('filter-date-from').addEventListener('change', reloadForDate);
document.getElementById('filter-date-to').addEventListener('change', reloadForDate);
document.getElementById('filter-week').addEventListener('change', reloadForWeek);


// ================================================================
// RESET & REFRESH
// ================================================================

document.getElementById('btn-reset').addEventListener('click', function() {
    window.location.href = '/performance/';
});

document.getElementById('btn-refresh').addEventListener('click', function() {
    window.location.reload();
});


// ================================================================
// AUTO-REFRESH (15 min)
// ================================================================
var REFRESH_INTERVAL = 15 * 60;
var timerEl = document.getElementById('refresh-timer');
var timerStart = Date.now();

function updateTimer() {
    var left = Math.max(0, REFRESH_INTERVAL - Math.floor((Date.now() - timerStart) / 1000));
    if (left <= 0) { window.location.reload(); return; }
    var mins = Math.floor(left / 60);
    var secs = left % 60;
    timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
}
updateTimer();
setInterval(updateTimer, 1000);


// ================================================================
// INIT
// ================================================================
renderTable();
