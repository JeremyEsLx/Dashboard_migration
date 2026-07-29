/* ============================================================
   DELIVERY DEEP DIVE — JavaScript
   Auto-loads with default date range. Two tables: Picking + Packing.
   ============================================================ */

// Columns for each table
var PICKING_COLS = [
    {key: 'pr', label: 'Process'},
    {key: 'mv', label: 'Movement'},
    {key: 'ft', label: 'Flow Type'},
    {key: 'dl', label: 'Delivery'},
    {key: 'd',  label: 'Date'},
    {key: 'ct', label: 'Cart Type'},
    {key: 'u',  label: 'User Name'},
    {key: 'sb', label: 'Source Storage Bin'},
    {key: 'mt', label: 'Material'},
    {key: 'gv', label: 'Grid Value'},
    {key: 'qty', label: 'Quantity', numeric: true},
    {key: 'sc', label: 'Stock Category'},
];

var PACKING_COLS = [
    {key: 'pr', label: 'Process'},
    {key: 'mv', label: 'Movement'},
    {key: 'ft', label: 'Flow Type'},
    {key: 'po', label: 'Packing Object'},
    {key: 'vt', label: 'VAS Type'},
    {key: 'dl', label: 'Delivery'},
    {key: 'd',  label: 'Date'},
    {key: 'ct', label: 'Cart Type'},
    {key: 'u',  label: 'User Name'},
    {key: 'qty', label: 'Quantity', numeric: true},
];

// ================================================================
// HELPERS
// ================================================================

function fmtDate(isoStr) {
    if (!isoStr) return '';
    var parts = isoStr.split('-');
    return parts[1] + '/' + parts[2] + '/' + parts[0];
}

function renderTable(tbodyId, data, cols, countId) {
    var tbody = document.getElementById(tbodyId);
    var countEl = document.getElementById(countId);
    countEl.textContent = data.length.toLocaleString() + ' rows';

    if (!data.length) {
        tbody.innerHTML = '<tr><td colspan="' + cols.length + '" class="dd-loading">No data found</td></tr>';
        return;
    }

    var html = '';
    data.forEach(function(row) {
        html += '<tr>';
        cols.forEach(function(c) {
            var val = row[c.key];
            if (c.key === 'd') val = fmtDate(val);
            var cls = c.numeric ? ' class="col-num"' : '';
            html += '<td' + cls + '>' + (val !== null && val !== undefined ? val : '') + '</td>';
        });
        html += '</tr>';
    });
    tbody.innerHTML = html;
}

function updateBanner(df, dt) {
    var banner = document.getElementById('banner-date-range');
    if (df && dt && df === dt) {
        banner.innerHTML = '<strong>Showing:</strong> ' + fmtDate(df);
    } else if (df && dt) {
        banner.innerHTML = '<strong>Showing:</strong> ' + fmtDate(df) + ' \u2014 ' + fmtDate(dt);
    } else {
        banner.innerHTML = '<strong>Showing:</strong> Loading\u2026';
    }
}

// ================================================================
// FETCH DATA
// ================================================================

function loadData() {
    var df = document.getElementById('filter-date-from').value;
    var dt = document.getElementById('filter-date-to').value;
    var delivery = document.getElementById('filter-delivery').value.trim();
    var po = document.getElementById('filter-packing-object').value.trim();
    var user = document.getElementById('filter-username').value.trim();

    var params = new URLSearchParams();
    if (df) params.set('date_from', df);
    if (dt) params.set('date_to', dt);
    if (delivery) params.set('delivery', delivery);
    if (po) params.set('packing_object', po);
    if (user) params.set('user_name', user);

    // Show loading state
    document.getElementById('picking-tbody').innerHTML = '<tr><td colspan="12" class="dd-loading">Loading\u2026</td></tr>';
    document.getElementById('packing-tbody').innerHTML = '<tr><td colspan="10" class="dd-loading">Loading\u2026</td></tr>';
    document.getElementById('picking-count').textContent = '';
    document.getElementById('packing-count').textContent = '';

    fetch('/api/deliverydeepdive/?' + params.toString())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.error) {
                console.error('[DeliveryDD] Server error:', data.error);
            }

            var picking = JSON.parse(data.picking_json);
            var packing = JSON.parse(data.packing_json);
            window._pickingData = picking;
            window._packingData = packing;

            renderTable('picking-tbody', picking, PICKING_COLS, 'picking-count');
            renderTable('packing-tbody', packing, PACKING_COLS, 'packing-count');

            // Update dates from server response
            var sel = data.selected || {};
            if (sel.date_from) document.getElementById('filter-date-from').value = sel.date_from;
            if (sel.date_to) document.getElementById('filter-date-to').value = sel.date_to;
            updateBanner(sel.date_from, sel.date_to);
        })
        .catch(function(err) {
            console.error('[DeliveryDD] Fetch error:', err);
            document.getElementById('picking-tbody').innerHTML = '<tr><td colspan="12" class="dd-loading">Error loading data</td></tr>';
            document.getElementById('packing-tbody').innerHTML = '<tr><td colspan="10" class="dd-loading">Error loading data</td></tr>';
        });
}

// ================================================================
// EVENT HANDLERS
// ================================================================

// Filters auto-trigger reload (like Strong Start/Finish)
document.getElementById('filter-date-from').addEventListener('change', loadData);
document.getElementById('filter-date-to').addEventListener('change', loadData);

document.getElementById('btn-reset').addEventListener('click', function() {
    document.getElementById('filter-date-from').value = '';
    document.getElementById('filter-date-to').value = '';
    document.getElementById('filter-delivery').value = '';
    document.getElementById('filter-packing-object').value = '';
    document.getElementById('filter-username').value = '';
    loadData();
});

// Enter key on text inputs triggers search
['filter-delivery', 'filter-packing-object', 'filter-username'].forEach(function(id) {
    document.getElementById(id).addEventListener('keydown', function(e) {
        if (e.key === 'Enter') loadData();
    });
});

// ================================================================
// INIT — auto-load with default date range
// ================================================================
loadData();
