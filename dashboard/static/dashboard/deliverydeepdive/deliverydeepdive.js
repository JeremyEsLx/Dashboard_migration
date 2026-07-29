/* ============================================================
   DELIVERY DEEP DIVE — Search-First (like User Performance)
   User enters a Delivery or Packing Object, clicks Search.
   No auto-load, no cache, no timer.
   ============================================================ */

// THIS FILE REPLACES THE PREVIOUS AUTO-LOAD VERSION
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

    // Validate: at least one filter required
    if (!delivery && !po) {
        alert('Please enter a Delivery or Packing Object to search.');
        return;
    }

    showLoading();
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
            if (data.error) {
                console.error('[DeliveryDD] Server error:', data.error);
            }

            var picking = (typeof data.picking_json === 'string') ? JSON.parse(data.picking_json) : (data.picking_json || []);
            var packing = (typeof data.packing_json === 'string') ? JSON.parse(data.packing_json) : (data.packing_json || []);
            window._pickingData = picking;
            window._packingData = packing;

            renderTable('picking-tbody', picking, PICKING_COLS, 'picking-count');
            renderTable('packing-tbody', packing, PACKING_COLS, 'packing-count');

            // Update banner with search info
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
            var bannerDate = document.getElementById('banner-date-range');
            bannerDate.innerHTML = '<span style="color:#dc2626;">Error loading data. Try again.</span>';
        });
}

// ================================================================
// EVENT HANDLERS
// ================================================================

// Search button
document.getElementById('btn-search').addEventListener('click', doSearch);

// Enter key on text inputs triggers search
['filter-delivery', 'filter-packing-object'].forEach(function(id) {
    document.getElementById(id).addEventListener('keydown', function(e) {
        if (e.key === 'Enter') doSearch();
    });
});

// Reset: clear filters, reset page to initial state
document.getElementById('btn-reset').addEventListener('click', function() {
    document.getElementById('filter-delivery').value = '';
    document.getElementById('filter-packing-object').value = '';
    document.getElementById('picking-tbody').innerHTML = '';
    document.getElementById('packing-tbody').innerHTML = '';
    document.getElementById('picking-count').textContent = '';
    document.getElementById('packing-count').textContent = '';
    window._pickingData = [];
    window._packingData = [];
    var bannerDate = document.getElementById('banner-date-range');
    bannerDate.innerHTML = 'Enter a <strong>Delivery</strong> or <strong>Packing Object</strong> and click Search';
});

// Export: Excel with two sheets (Picking + Packing)
document.getElementById('btn-export').addEventListener('click', function() {
    if ((!window._pickingData || !window._pickingData.length) && (!window._packingData || !window._packingData.length)) {
        alert('No data to export. Run a search first.');
        return;
    }

    var pickRows = [PICKING_COLS.map(function(c) { return c.label; })];
    (window._pickingData || []).forEach(function(r) {
        pickRows.push(PICKING_COLS.map(function(c) {
            var v = r[c.key];
            if (c.key === 'd') v = fmtDate(v);
            return (v !== null && v !== undefined) ? v : '';
        }));
    });

    var packRows = [PACKING_COLS.map(function(c) { return c.label; })];
    (window._packingData || []).forEach(function(r) {
        packRows.push(PACKING_COLS.map(function(c) {
            var v = r[c.key];
            if (c.key === 'd') v = fmtDate(v);
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
// CACHE + GLOBALS (Stale-While-Revalidate like Strong Start)
// ================================================================

var CACHE_KEY = 'lms_deliverydeepdive_cache';
var TIMER_KEY = 'lms_timer_deliverydeepdive';
var CACHE_MAX_AGE = 30 * 60 * 1000; // 30 min
var REFRESH_INTERVAL = 15 * 60;     // 15 min auto-refresh

var PICKING_RAW = [];
var PACKING_RAW = [];
var SELECTED_STATE = {};

var CALENDAR_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12"/><path d="M5.5 1.5v3"/><path d="M10.5 1.5v3"/></svg>';

function showLoading() {
    var banner = document.getElementById('active-filters-banner');
    var bannerIcon = document.getElementById('banner-icon');
    var bannerDate = document.getElementById('banner-date-range');
    if (banner) banner.classList.add('is-loading');
    if (bannerIcon) bannerIcon.innerHTML = '<div class="inline-spinner"></div>';
    if (bannerDate) bannerDate.innerHTML = 'Loading new data\u2026';
}

function hideLoading() {
    var banner = document.getElementById('active-filters-banner');
    var bannerIcon = document.getElementById('banner-icon');
    if (banner) banner.classList.remove('is-loading');
    if (bannerIcon) bannerIcon.innerHTML = CALENDAR_SVG;
}

function getCachedData() {
    try {
        var r = sessionStorage.getItem(CACHE_KEY);
        if (!r) return null;
        var c = JSON.parse(r);
        if (Date.now() - c.timestamp > CACHE_MAX_AGE) return null;
        return c;
    } catch(e) { return null; }
}

// ================================================================
// CLIENT-SIDE FILTER (instant, no server round-trip)
// ================================================================

function filterData(data) {
    var delivery = document.getElementById('filter-delivery').value.trim().toUpperCase();
    var po = document.getElementById('filter-packing-object').value.trim().toUpperCase();
    var user = document.getElementById('filter-username').value.trim().toUpperCase();
    if (!delivery && !po && !user) return data;
    return data.filter(function(row) {
        if (delivery && String(row.dl || '').toUpperCase().indexOf(delivery) === -1) return false;
        if (po && String(row.po || '').toUpperCase().indexOf(po) === -1) return false;
        if (user && String(row.u || '').toUpperCase().indexOf(user) === -1) return false;
        return true;
    });
}

function renderAll() {
    var pickFiltered = filterData(PICKING_RAW);
    var packFiltered = filterData(PACKING_RAW);
    window._pickingData = pickFiltered;
    window._packingData = packFiltered;
    renderTable('picking-tbody', pickFiltered, PICKING_COLS, 'picking-count');
    renderTable('packing-tbody', packFiltered, PACKING_COLS, 'packing-count');
}

// ================================================================
// FETCH DATA (server — only on date change or initial load)
// ================================================================

function loadData(skipCache) {
    // 1. Try cache first (instant render)
    if (!skipCache) {
        var cached = getCachedData();
        if (cached) {
            PICKING_RAW = cached.picking || [];
            PACKING_RAW = cached.packing || [];
            SELECTED_STATE = cached.selected || {};
            if (SELECTED_STATE.date_from) document.getElementById('filter-date-from').value = SELECTED_STATE.date_from;
            if (SELECTED_STATE.date_to) document.getElementById('filter-date-to').value = SELECTED_STATE.date_to;
            updateBanner(SELECTED_STATE.date_from, SELECTED_STATE.date_to);
            renderAll();
        } else {
            showLoading();
        }
    } else {
        showLoading();
    }

    // 2. Always fetch fresh from server (revalidate)
    var df = document.getElementById('filter-date-from').value;
    var dt = document.getElementById('filter-date-to').value;

    // Only dates go to server — text filters are client-side
    var params = new URLSearchParams();
    if (df) params.set('date_from', df);
    if (dt) params.set('date_to', dt);

    // Show loading only if no cached data rendered above
    if (!PICKING_RAW.length && !PACKING_RAW.length) {
        document.getElementById('picking-tbody').innerHTML = '<tr><td colspan="12" class="dd-loading">Loading\u2026</td></tr>';
        document.getElementById('packing-tbody').innerHTML = '<tr><td colspan="10" class="dd-loading">Loading\u2026</td></tr>';
        document.getElementById('picking-count').textContent = '';
        document.getElementById('packing-count').textContent = '';
    }

    fetch('/api/deliverydeepdive/?' + params.toString())
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.error) {
                console.error('[DeliveryDD] Server error:', data.error);
            }

            // Parse response
            var picking = (typeof data.picking_json === 'string') ? JSON.parse(data.picking_json) : (data.picking_json || []);
            var packing = (typeof data.packing_json === 'string') ? JSON.parse(data.packing_json) : (data.packing_json || []);

            // Write to sessionStorage (stale-while-revalidate)
            try {
                sessionStorage.setItem(CACHE_KEY, JSON.stringify({
                    picking: picking,
                    packing: packing,
                    selected: data.selected || {},
                    timestamp: Date.now()
                }));
                console.log('[DeliveryDD] Cache stored:', picking.length, 'pick +', packing.length, 'pack rows');
            } catch(e) {
                console.warn('[DeliveryDD] Cache write failed (quota?):', e.message);
            }

            // Update globals
            PICKING_RAW = picking;
            PACKING_RAW = packing;
            SELECTED_STATE = data.selected || {};
            if (SELECTED_STATE.date_from) document.getElementById('filter-date-from').value = SELECTED_STATE.date_from;
            if (SELECTED_STATE.date_to) document.getElementById('filter-date-to').value = SELECTED_STATE.date_to;
            updateBanner(SELECTED_STATE.date_from, SELECTED_STATE.date_to);
            hideLoading();
            renderAll();
        })
        .catch(function(err) {
            console.error('[DeliveryDD] Fetch error:', err);
            hideLoading();
            if (!PICKING_RAW.length && !PACKING_RAW.length) {
                document.getElementById('picking-tbody').innerHTML = '<tr><td colspan="12" class="dd-loading">Error loading data. Try refreshing.</td></tr>';
                document.getElementById('packing-tbody').innerHTML = '<tr><td colspan="10" class="dd-loading">Error loading data. Try refreshing.</td></tr>';
            }
        });
}

// ================================================================
// EVENT HANDLERS
// ================================================================

// Date changes: skip cache, re-fetch from server
document.getElementById('filter-date-from').addEventListener('change', function() { loadData(true); });
document.getElementById('filter-date-to').addEventListener('change', function() { loadData(true); });

// Text inputs: CLIENT-SIDE filter with 300ms debounce (like Strong Start employee)
var _filterTimeout = null;
function filterWithDebounce() {
    clearTimeout(_filterTimeout);
    _filterTimeout = setTimeout(renderAll, 300);
}
['filter-delivery', 'filter-packing-object', 'filter-username'].forEach(function(id) {
    document.getElementById(id).addEventListener('input', filterWithDebounce);
});

// Reset: clear all, navigate back to clean state
document.getElementById('btn-reset').addEventListener('click', function() {
    showLoading();
    try { sessionStorage.removeItem(CACHE_KEY); } catch(e) {}
    window.location.href = '/deliverydeepdive/';
});

// Refresh: clear cache + timer, full reload
document.getElementById('btn-refresh').addEventListener('click', function() {
    showLoading();
    try {
        sessionStorage.removeItem(CACHE_KEY);
        sessionStorage.removeItem(TIMER_KEY);
    } catch(e) {}
    window.location.reload();
});

// Export: Excel with two sheets (Picking + Packing)
document.getElementById('btn-export').addEventListener('click', function() {
    // Build Picking sheet
    var pickRows = [PICKING_COLS.map(function(c) { return c.label; })];
    (window._pickingData || []).forEach(function(r) {
        pickRows.push(PICKING_COLS.map(function(c) {
            var v = r[c.key];
            if (c.key === 'd') v = fmtDate(v);
            return (v !== null && v !== undefined) ? v : '';
        }));
    });

    // Build Packing sheet
    var packRows = [PACKING_COLS.map(function(c) { return c.label; })];
    (window._packingData || []).forEach(function(r) {
        packRows.push(PACKING_COLS.map(function(c) {
            var v = r[c.key];
            if (c.key === 'd') v = fmtDate(v);
            return (v !== null && v !== undefined) ? v : '';
        }));
    });

    // Create workbook with two sheets
    var wb = XLSX.utils.book_new();
    var wsPick = XLSX.utils.aoa_to_sheet(pickRows);
    var wsPack = XLSX.utils.aoa_to_sheet(packRows);
    XLSX.utils.book_append_sheet(wb, wsPick, 'Picking');
    XLSX.utils.book_append_sheet(wb, wsPack, 'Packing');

    // Filename with date range
    var df = SELECTED_STATE.date_from || '';
    var dt = SELECTED_STATE.date_to || '';
    var filename = 'LMS_DeliveryDeepDive';
    if (df && dt) filename += '_' + df + '_to_' + dt;
    filename += '.xlsx';

    XLSX.writeFile(wb, filename);
});

// ================================================================
// AUTO-REFRESH TIMER (15 min)
// ================================================================

var timerEl = document.getElementById('refresh-timer');

function getTimerStart() {
    try {
        var stored = sessionStorage.getItem(TIMER_KEY);
        if (stored) {
            var ts = parseInt(stored, 10);
            var elapsed = Math.floor((Date.now() - ts) / 1000);
            if (elapsed >= REFRESH_INTERVAL) {
                sessionStorage.setItem(TIMER_KEY, String(Date.now()));
                try { sessionStorage.removeItem(CACHE_KEY); } catch(e) {}
                window.location.reload();
                return Date.now();
            }
            return ts;
        }
    } catch(e) {}
    var now = Date.now();
    try { sessionStorage.setItem(TIMER_KEY, String(now)); } catch(e) {}
    return now;
}

var timerStart = getTimerStart();
function updateTimer() {
    var left = Math.max(0, REFRESH_INTERVAL - Math.floor((Date.now() - timerStart) / 1000));
    if (left <= 0) {
        try { sessionStorage.setItem(TIMER_KEY, String(Date.now())); sessionStorage.removeItem(CACHE_KEY); } catch(e) {}
        window.location.reload();
        return;
    }
    var mins = Math.floor(left / 60);
    var secs = left % 60;
    if (timerEl) timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
}
updateTimer();
setInterval(updateTimer, 1000);

// ================================================================
// INIT — Stale-While-Revalidate
// ================================================================
loadData(false);
