/* ============================================================
   LMS CORE - Shared utilities for all LMS dashboard pages
   Load via base.html BEFORE page-specific scripts.

   Usage in page scripts:
     LMS.fmtDate('2026-07-09')       -> '07/09/2026'
     LMS.showLoading()                -> banner spinner + text
     LMS.hideLoading(df, dt)          -> banner shows date range
     var cache = new LMS.Cache('lms_mypage_cache', 30)
     var timer = new LMS.Timer('lms_timer_mypage', 15, onRefresh)
     LMS.populateDropdown('filter-id', ['A','B'], currentVal)
     LMS.renderTable('tbody-id', data, cols, {totalRow: true, totalCol: 'Qty', totalVal: 500})
     LMS.exportXLSX([{name:'Sheet1', rows:[[...]]}, ...], 'filename.xlsx')
   ============================================================ */

var LMS = (function() {
    'use strict';

    // ============================================================
    // CONSTANTS
    // ============================================================

    var CALENDAR_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="12" height="11" rx="1.5"/><path d="M2 6.5h12"/><path d="M5.5 1.5v3"/><path d="M10.5 1.5v3"/></svg>';

    // ============================================================
    // DATE FORMATTING
    // ============================================================

    function fmtDate(iso) {
        if (!iso) return '';
        var p = iso.split('-');
        return p[1] + '/' + p[2] + '/' + p[0];
    }

    // ============================================================
    // LOADING BANNER
    // ============================================================

    function showLoading() {
        var banner = document.getElementById('active-filters-banner');
        var icon = document.getElementById('banner-icon');
        var dateEl = document.getElementById('banner-date-range');
        if (banner) banner.classList.add('is-loading');
        if (icon) icon.innerHTML = '<div class="inline-spinner"></div>';
        if (dateEl) dateEl.innerHTML = 'Loading new data\u2026';
    }

    function hideLoading(df, dt) {
        var banner = document.getElementById('active-filters-banner');
        var icon = document.getElementById('banner-icon');
        var dateEl = document.getElementById('banner-date-range');
        if (banner) banner.classList.remove('is-loading');
        if (icon) icon.innerHTML = CALENDAR_SVG;
        if (dateEl && df && dt) {
            dateEl.innerHTML = '<strong>Showing:</strong> ' + fmtDate(df) + ' \u2014 ' + fmtDate(dt);
        }
    }

    // ============================================================
    // SESSION CACHE (Stale-While-Revalidate)
    // ============================================================

    function Cache(key, maxAgeMinutes) {
        this.key = key;
        this.maxAge = (maxAgeMinutes || 30) * 60 * 1000;
    }

    Cache.prototype.get = function() {
        try {
            var raw = sessionStorage.getItem(this.key);
            if (!raw) return null;
            var data = JSON.parse(raw);
            if (Date.now() - data._timestamp > this.maxAge) return null;
            return data;
        } catch(e) { return null; }
    };

    Cache.prototype.set = function(data) {
        try {
            data._timestamp = Date.now();
            sessionStorage.setItem(this.key, JSON.stringify(data));
        } catch(e) {}
    };

    Cache.prototype.clear = function() {
        try { sessionStorage.removeItem(this.key); } catch(e) {}
    };

    // ============================================================
    // AUTO-REFRESH TIMER (countdown + reload)
    // ============================================================

    function Timer(key, intervalMinutes, onExpire) {
        this.key = key;
        this.interval = (intervalMinutes || 15) * 60;
        this.onExpire = onExpire || function() { window.location.reload(); };
        this.el = document.getElementById('refresh-timer');
        this._init();
    }

    Timer.prototype._init = function() {
        var self = this;
        try {
            var stored = sessionStorage.getItem(this.key);
            if (stored) {
                var ts = parseInt(stored, 10);
                var elapsed = Math.floor((Date.now() - ts) / 1000);
                if (elapsed >= this.interval) {
                    sessionStorage.setItem(this.key, String(Date.now()));
                    this.onExpire();
                    return;
                }
                this.start = ts;
            } else {
                this.start = Date.now();
                sessionStorage.setItem(this.key, String(this.start));
            }
        } catch(e) {
            this.start = Date.now();
        }
        this._tick();
        setInterval(function() { self._tick(); }, 1000);
    };

    Timer.prototype._tick = function() {
        var left = Math.max(0, this.interval - Math.floor((Date.now() - this.start) / 1000));
        if (left <= 0) {
            try {
                sessionStorage.setItem(this.key, String(Date.now()));
            } catch(e) {}
            this.onExpire();
            return;
        }
        if (this.el) {
            var m = Math.floor(left / 60);
            var s = left % 60;
            this.el.textContent = m + ':' + (s < 10 ? '0' : '') + s;
        }
    };

    Timer.prototype.reset = function() {
        try { sessionStorage.removeItem(this.key); } catch(e) {}
    };

    // ============================================================
    // DROPDOWN POPULATION
    // ============================================================

    function populateDropdown(selectId, options, currentValue) {
        var sel = document.getElementById(selectId);
        if (!sel) return;
        var cur = currentValue || sel.value;
        sel.innerHTML = '<option value="All">All</option>';
        (options || []).forEach(function(opt) {
            sel.innerHTML += '<option value="' + opt + '">' + opt + '</option>';
        });
        sel.value = cur;
    }

    // ============================================================
    // TABLE RENDERING
    // ============================================================

    /**
     * Render rows into a tbody element.
     * @param {string} tbodyId - ID of the <tbody> element
     * @param {Array} data - Array of row objects
     * @param {Array} cols - Column keys to display
     * @param {Object} opts - Optional: { totalRow: bool, totalCol: 'colName', totalVal: number, emptyMsg: string }
     */
    function renderTable(tbodyId, data, cols, opts) {
        var tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        opts = opts || {};

        if (!data || !data.length) {
            tbody.innerHTML = '<tr><td colspan="' + cols.length + '" style="text-align:center; color:#6b7280; padding:20px;">' +
                (opts.emptyMsg || 'No data') + '</td></tr>';
            return;
        }

        var html = '';
        data.forEach(function(row) {
            html += '<tr>';
            cols.forEach(function(col) {
                html += '<td>' + (row[col] != null ? row[col] : '') + '</td>';
            });
            html += '</tr>';
        });

        // Optional total row
        if (opts.totalRow && opts.totalCol) {
            var colIdx = cols.indexOf(opts.totalCol);
            html += '<tr class="total-row">';
            if (colIdx > 0) {
                html += '<td colspan="' + colIdx + '"><strong>Total</strong></td>';
                html += '<td><strong>' + (opts.totalVal != null ? opts.totalVal.toLocaleString() : '') + '</strong></td>';
                var remaining = cols.length - colIdx - 1;
                if (remaining > 0) html += '<td colspan="' + remaining + '"></td>';
            } else {
                html += '<td colspan="' + cols.length + '"><strong>Total: ' + (opts.totalVal || '') + '</strong></td>';
            }
            html += '</tr>';
        }

        tbody.innerHTML = html;
    }

    // ============================================================
    // EXCEL EXPORT (SheetJS wrapper)
    // ============================================================

    /**
     * Export data to XLSX with multiple sheets.
     * @param {Array} sheets - [{name: 'Sheet1', rows: [['H1','H2'], ['v1','v2'], ...]}, ...]
     * @param {string} filename - Output filename
     */
    function exportXLSX(sheets, filename) {
        if (typeof XLSX === 'undefined') {
            alert('Export library not loaded.');
            return;
        }
        var wb = XLSX.utils.book_new();
        sheets.forEach(function(sheet) {
            XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
        });
        XLSX.writeFile(wb, filename);
    }

    // ============================================================
    // PUBLIC API
    // ============================================================

    return {
        CALENDAR_SVG: CALENDAR_SVG,
        fmtDate: fmtDate,
        showLoading: showLoading,
        hideLoading: hideLoading,
        Cache: Cache,
        Timer: Timer,
        populateDropdown: populateDropdown,
        renderTable: renderTable,
        exportXLSX: exportXLSX,
    };
})();
