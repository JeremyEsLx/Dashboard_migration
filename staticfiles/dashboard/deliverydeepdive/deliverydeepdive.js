/* ============================================================
   DELIVERY DEEP DIVE — Search-First
   User enters a Delivery or Packing Object, clicks Search.
   No auto-load, no cache, no timer.
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

function showLoading() {
    var banner = document.getElementById('active-filters-banner');
    var bannerIcon = document.getElementById('banner-icon');
    var bannerDate = document.getElementById('banner-date-range');
    if (banner) banner.classList.add('is-loading');
    if (bannerIcon) bannerIcon.innerHTML = '<div class="inline-spinner"></div>';
    if (bannerDate) bannerDate.innerHTML = 'Searching\u2026';
}

function hideLoading() {
    var banner = document.getElementById('active-filters-banner');
    var bannerIcon = document.getElementById('banner-icon');
    if (banner) banner.classList.remove('is-loading');
    if (bannerIcon) bannerIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"/><path d="M11 11l3.5 3.5"/></svg>';
}

// ================================================================
// SEARCH (server-side query)
// ================================================================

function doSearch() {
    var delivery = document.getElementById('filter-delivery').value.trim();
    var po = document.getElementById('filter-packing-object').value.trim();

    if (!delivery && !po) {
        alert('Please enter a Delivery or Packing Object to search.');
        return;
    }

    showLoading();
    document.getElementById('dd-empty-state').style.display = 'none';
    document.getElementById('dd-results').classList.add('visible');
    document.getElementById('picking-tbody').innerHTML = '';
    document.getElementById('packing-tbody').innerHTML = '';
    document.getElementById('picking-count').textContent = '';
    document.getElementById('packing-count').textContent = '';

    var params = new URLSearchParams();
    if (delivery) params.set('delivery', delivery);
    if (po) params.set('packing_object', po);

    fetch('/api/deliverydeepdive/?' + params.toString())
        .then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function(data) {
            if (data.error) console.error('[DeliveryDD] Server error:', data.error);

            var picking = (typeof data.picking_json === 'string') ? JSON.parse(data.picking_json) : (data.picking_json || []);
            var packing = (typeof data.packing_json === 'string') ? JSON.parse(data.packing_json) : (data.packing_json || []);
            window._pickingData = picking;
            window._packingData = packing;

            renderTable('picking-tbody', picking, PICKING_COLS, 'picking-count');
            renderTable('packing-tbody', packing, PACKING_COLS, 'packing-count');

            var bannerDate = document.getElementById('banner-date-range');
            var chips = [];
            if (delivery) chips.push('<strong>Delivery:</strong> ' + delivery);
            if (po) chips.push('<strong>Packing Object:</strong> ' + po);
            bannerDate.innerHTML = chips.join(' &nbsp;|&nbsp; ') +
                ' &nbsp;\u2014&nbsp; Picking: ' + picking.length + ' | Packing: ' + packing.length;
            hideLoading();
        })
        .catch(function(err) {
            console.error('[DeliveryDD] Fetch error:', err);
            hideLoading();
            document.getElementById('banner-date-range').innerHTML = '<span style="color:#dc2626;">Error loading data. Try again.</span>';
        });
}

// ================================================================
// EVENT HANDLERS
// ================================================================

document.getElementById('btn-search').addEventListener('click', doSearch);

['filter-delivery', 'filter-packing-object'].forEach(function(id) {
    document.getElementById(id).addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doSearch();
    });
});

document.getElementById('btn-reset').addEventListener('click', function() {
    document.getElementById('filter-delivery').value = '';
    document.getElementById('filter-packing-object').value = '';
    document.getElementById('picking-tbody').innerHTML = '';
    document.getElementById('packing-tbody').innerHTML = '';
    document.getElementById('picking-count').textContent = '';
    document.getElementById('packing-count').textContent = '';
    window._pickingData = [];
    window._packingData = [];
    document.getElementById('dd-results').classList.remove('visible');
    document.getElementById('dd-empty-state').style.display = '';
    var bannerDate = document.getElementById('banner-date-range');
    bannerDate.innerHTML = 'Enter a <strong>Delivery</strong> or <strong>Packing Object</strong> and click Search';
});

document.getElementById('btn-export').addEventListener('click', function() {
    if ((!window._pickingData || !window._pickingData.length) && (!window._packingData || !window._packingData.length)) {
        alert('No data to export. Run a search first.');
        return;
    }
    var pickRows = [PICKING_COLS.map(function(c) { return c.label; })];
    (window._pickingData || []).forEach(function(r) {
        pickRows.push(PICKING_COLS.map(function(c) {
            var v = r[c.key]; if (c.key === 'd') v = fmtDate(v);
            return (v !== null && v !== undefined) ? v : '';
        }));
    });
    var packRows = [PACKING_COLS.map(function(c) { return c.label; })];
    (window._packingData || []).forEach(function(r) {
        packRows.push(PACKING_COLS.map(function(c) {
            var v = r[c.key]; if (c.key === 'd') v = fmtDate(v);
            return (v !== null && v !== undefined) ? v : '';
        }));
    });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pickRows), 'Picking');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(packRows), 'Packing');
    var delivery = document.getElementById('filter-delivery').value.trim();
    var po = document.getElementById('filter-packing-object').value.trim();
    var filename = 'LMS_DeliveryDeepDive';
    if (delivery) filename += '_' + delivery;
    if (po) filename += '_' + po;
    filename += '.xlsx';
    XLSX.writeFile(wb, filename);
});

// NO AUTO-LOAD — search-first page
