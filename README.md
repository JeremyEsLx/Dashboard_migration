# LMS Dashboard Migration - Tijuana Warehouse

Django web application migrating Power BI LMS dashboards for EssilorLuxottica's Tijuana (MX03) warehouse operations.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Service Layer (Backend)](#service-layer-backend)
5. [Shared Component Library (Frontend)](#shared-component-library-frontend)
6. [Pages Reference](#pages-reference)
7. [SQL Data Sources](#sql-data-sources)
8. [Adding a New Dashboard Page](#adding-a-new-dashboard-page)
9. [Environment Variables](#environment-variables)
10. [Production Deployment](#production-deployment)
11. [UI Conventions](#ui-conventions)
12. [Known Issues and Solutions](#known-issues-and-solutions)

## Quick Start

```bash
# Clone
git clone https://github.com/JeremyEsLx/Dashboard_migration.git
cd Dashboard_migration

# Virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Mac/Linux

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your SQL Server credentials

# Development server (auto-reloads)
python manage.py runserver

# Production server (Waitress, multi-threaded)
python run_server.py
```

Open `http://127.0.0.1:8000/` in your browser.

## Architecture

### Pattern: Hybrid Cube + Client-Side Filtering

Most pages follow this pattern:
1. **Shell view** renders the HTML template instantly (zero SQL, <50ms)
2. **JavaScript** makes an async `fetch()` to the API endpoint
3. **API view** queries SQL Server, returns JSON (`cube_json` + filter options)
4. **Client-side JS** renders charts/tables and enables instant filter toggling

Exception: **User Performance** uses a **search-first** pattern (see below).

### Key Design Decisions
- **No Django ORM** — direct pyodbc connections to SQL Server with connection pooling
- **WITH (NOLOCK)** on all reads to avoid lock waits
- **GZip middleware** for JSON response compression (80-90% reduction)
- **Session storage caching** with stale-while-revalidate (30 min TTL)
- **Auto-refresh** every 15 minutes (background fetch)
- **Cache pre-warm** on Django startup (direct users + filter options)

---

## Project Structure

```
Dashboard_migration/
|-- lms_dashboard/
|   |-- settings.py              # Django settings, SQL creds, GZip middleware
|   |-- urls.py                  # Root URL config -> includes dashboard.urls
|   |-- wsgi.py                  # WSGI application
|
|-- dashboard/
|   |-- views.py                 # Shell views + API views (all pages)
|   |-- services_base.py         # [SHARED] Connection pool, run_query, base helpers
|   |-- services.py              # Summary, Performance, Process, Strong Start/Finish, No Activity
|   |-- services_userperf.py     # User Performance (search-first)
|   |-- services_delivery.py     # Delivery Deep Dive (search-first)
|   |-- services_material.py     # Detail by Material
|   |-- apps.py                  # Cache pre-warm on startup (background thread)
|   |-- urls.py                  # App-level routes
|   |
|   |-- static/dashboard/
|   |   |-- base.css                             # Global styles
|   |   |-- shared/
|   |   |   |-- components.css                   # [SHARED] Reusable UI component styles
|   |   |   |-- lms-core.js                      # [SHARED] LMS namespace utilities
|   |   |-- summary/summary.js
|   |   |-- performance/performance.js
|   |   |-- process/process.js
|   |   |-- strongstart/strongstart.js + .css
|   |   |-- strongfinish/strongfinish.js + .css
|   |   |-- noactivity/noactivity.js + .css
|   |   |-- userperformance/userperformance.js + .css
|   |   |-- deliverydeepdive/deliverydeepdive.js + .css
|   |   |-- detailbymaterial/detailbymaterial.js + .css
|   |
|   |-- templates/dashboard/
|       |-- base.html                            # Shared layout (nav, header, logo)
|       |-- _partials/                           # [SHARED] Reusable template fragments
|       |   |-- _banner.html                     # Active filters banner
|       |   |-- _filter_actions.html             # Export + Reset + Refresh buttons
|       |   |-- _date_range_filters.html         # Date From / Date To inputs
|       |   |-- _table_skeleton.html             # Loading skeleton rows
|       |-- summary.html
|       |-- performance.html
|       |-- (... one per page)
|
|-- run_server.py                # Waitress production entry point
|-- manage.py                    # Django management
|-- requirements.txt             # Python dependencies
|-- .env.example                 # Environment template
```

---

## Service Layer (Backend)

### Module Hierarchy

```
services_base.py          <-- Foundation (import from here)
    |-- services.py       <-- Summary, Performance, Process, Strong Start/Finish, No Activity
    |-- services_userperf.py    <-- User Performance
    |-- services_delivery.py    <-- Delivery Deep Dive
    |-- services_material.py    <-- Detail by Material
```

### services_base.py - Shared Utilities

All service files should import from `services_base`. It provides:

| Export | Type | Description |
| --- | --- | --- |
| `run_query(sql)` | Function | Execute SQL, return `pd.DataFrame` (pooled connection) |
| `get_connection()` | Function | Get a pooled pyodbc connection |
| `_return_connection(conn)` | Function | Return connection to pool |
| `get_direct_users()` | Function | Cached set of DIRECT employee usernames |
| `format_name(name)` | Function | 'LAST, FIRST MIDDLE' -> 'Last First Middle' |
| `DIRECT_ROLES` | Tuple | Role names that qualify as DIRECT employees |
| `BASE_FILTERS` | String | Standard WHERE clause for most pages |
| `_base_subquery()` | Function | Base SELECT with SHIFT2 computed column |
| `_build_date_where(date, week)` | Function | WHERE builder for single-date/week |
| `_build_date_range_where(from, to, week)` | Function | WHERE builder for date ranges |
| `get_filter_options()` | Function | Cached dropdown values (1-hour TTL) |

### Import Pattern

```python
# In a new service file:
from .services_base import run_query, get_direct_users, _base_subquery, BASE_FILTERS

# For backward compatibility, services.py re-exports everything:
from .services import get_direct_users, _base_subquery, run_query, format_name
```

### Connection Pool

- Max 4 connections (thread-safe with `threading.Lock`)
- Connections tested with `SELECT 1` before reuse
- Dead connections are discarded and recreated
- All queries use `WITH (NOLOCK)` to avoid lock waits

### Page Data Function Pattern

All page data functions follow this structure:

```python
def get_PAGE_data(supervisor='All', shift='All', date_from=None, date_to=None):
    # 1. Determine effective date range / defaults
    # 2. Run filter_options + cube queries in PARALLEL (ThreadPoolExecutor)
    # 3. Return dict: {'cube_json': ..., 'filters': ..., 'selected': ...}
```

---

## Shared Component Library (Frontend)

### lms-core.js - JavaScript Utilities

All utilities live under the global `LMS` namespace (IIFE pattern):

```javascript
// Date formatting
LMS.fmtDate('2025-01-15')  // -> '01/15/2025'

// Loading states
LMS.showLoading()                         // Show spinner banner
LMS.hideLoading('01/15/2025', '01/20/2025')  // Show date range in banner

// SessionStorage cache with TTL
var cache = new LMS.Cache('lms_mypage_cache', 30);  // 30 min TTL
cache.set({units: [...], detail: [...]});
var data = cache.get();  // null if expired
cache.clear();

// Auto-refresh timer with countdown
var timer = new LMS.Timer('lms_timer_mypage', 15, function() {
    cache.clear();
    window.location.reload();
});
timer.reset();  // Reset countdown after manual refresh

// Populate a <select> dropdown
LMS.populateDropdown('filter-supervisor', ['All', 'John', 'Jane'], 'All');

// Render a table body
LMS.renderTable('table-body-id', data, [
    {key: 'name', label: 'Name'},
    {key: 'qty', label: 'Quantity', align: 'right'},
], {totalRow: true, totalCol: 'name', totalVal: 'TOTAL', emptyMsg: 'No data'});

// Export to XLSX (requires SheetJS loaded)
LMS.exportXLSX([
    {name: 'Sheet1', rows: [{col1: 'A', col2: 'B'}, ...]},
    {name: 'Sheet2', rows: [...]}
], 'export_filename.xlsx');
```

### components.css - Shared UI Styles

| Class | Usage |
| --- | --- |
| `.filters-bar` | Container for all filter controls |
| `.filter-group` | Individual filter (label + input/select) |
| `.filter-actions` | Export / Reset / Refresh button group |
| `.btn-filter` / `.btn-reset` / `.btn-refresh` | Action buttons |
| `.chart-card` / `.chart-container` | Card wrapper for charts |
| `.table-card` / `.table-scroll` / `.data-table` | Table components |
| `.total-row` | Bold total/summary row |
| `.pagination` | Page navigation controls |
| `.export-toast` | Success notification (slides up) |

### Template Partials

Reusable Django template fragments in `_partials/`:

```django
{% include "dashboard/_partials/_banner.html" %}
{% include "dashboard/_partials/_filter_actions.html" %}
{% include "dashboard/_partials/_filter_actions.html" with show_export=False %}
{% include "dashboard/_partials/_date_range_filters.html" with date_from=data.selected.date_from date_to=data.selected.date_to %}
{% include "dashboard/_partials/_table_skeleton.html" with colspan=13 %}
```

---

## Pages Reference

| Page | URL | API | Service | Pattern |
| --- | --- | --- | --- | --- |
| Summary | `/` | `/api/summary/` | `services.get_summary_data()` | Hybrid cube |
| Performance by User | `/performance/` | `/api/performance/` | `services.get_performance_data()` | Hybrid cube |
| Performance by Process | `/process/` | `/api/process/` | `services.get_process_data()` | Hybrid cube |
| Strong Start | `/strongstart/` | `/api/strongstart/` | `services.get_strongstart_data()` | Hybrid cube |
| Strong Finish | `/strongfinish/` | `/api/strongfinish/` | `services.get_strongfinish_data()` | Hybrid cube |
| No Activity | `/noactivity/` | `/api/noactivity/` | `services.get_noactivity_data()` | Hybrid cube |
| User Performance | `/userperformance/` | `/api/userperformance/` | `services_userperf.get_userperf_data()` | Search-first |
| Delivery Deep Dive | `/deliverydeepdive/` | `/api/deliverydeepdive/` | `services_delivery.get_delivery_data()` | Search-first |
| Detail by Material | `/detailbymaterial/` | `/api/detailbymaterial/` | `services_material.get_material_data()` | Hybrid (10K cap) |
| User Summary | `/usersummary/` | `/api/usersummary/` | `services_usersummary.get_usersummary_data()` | Search-first |
| SPAC UPH | `/spacuph/` | `/api/spacuph/` | `services_spac.get_spac_data()` | Hybrid cube |
| SPAC Performance | `/spacperformance/` | (reuses `/api/spacuph/`) | `services_spac.get_spac_data()` | Hybrid cube |
| SPAC Perf by User | `/spacperfbyuser/` | (reuses `/api/spacuph/`) | `services_spac.get_spac_data()` | Hybrid cube |

### Date Defaults

| Page | Default |
| --- | --- |
| Summary | Today (single date) |
| Performance / Process | Monday to today (current week) |
| Strong Start / Strong Finish | Yesterday back 6 days |
| No Activity | Today minus 21 days |
| User Performance / Delivery | 26th of previous month to today |
| Detail by Material | Today minus 21 days |

### Search-First Pattern (User Performance, Delivery Deep Dive)

1. Page loads **empty** (only filter dropdowns populated)
2. User must select at least one filter
3. Click **Search** -> query runs with filters in SQL WHERE clause
4. Results capped at **10,000 rows** (safety limit)
5. Client-side **pagination** (100 rows per page)
6. **Export** downloads all filtered rows

---

## SQL Data Sources

| Server | Database | Table | Purpose |
| --- | --- | --- | --- |
| 10.80.192.78 | LMS_Database | `[dbo].[LMS_PBI_Dashboard_MX03]` | Main LMS transactions |
| 10.80.192.78 | Business_Intelligence | `[dbo].[MX03_Roster]` | Employee headcount/roster |

### Employee Type Filter

Only DIRECT employees are included. `[Estacion_de_Trabajo]` must be one of:
Operador en Entrenamiento, Almacenista, Automation clerk I, DC clerk 1,
Packing / VAS, Picking, Put away, Recibos.

### Base SQL Filters

```sql
WHERE [Activity Type] = 'DIRECT'
  AND [Movement] NOT IN ('BIN2BIN', 'LOST&FOUND', 'RECASE', 'HOUSEKEEPING')
  AND [Process] NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')
```

### Shift Mapping (SHIFT2 computed column)

| Code | Raw Values |
| --- | --- |
| A | Turno A - Produccion, Lunes-Jueves 06:00 a 18:00, Lunes-Viernes 08:00 a 17:30 |
| B | Turno B - Produccion |
| C | Turno C - Produccion |
| D | Turno D - Produccion |

---

## Adding a New Dashboard Page

### 1. Create the Service Function

```python
# dashboard/services_newpage.py
from .services_base import run_query, get_direct_users, _base_subquery, BASE_FILTERS
from concurrent.futures import ThreadPoolExecutor
import json, time
from datetime import date, timedelta

def get_newpage_data(supervisor='All', shift='All', date_from=None, date_to=None):
    if not date_from:
        date_from = (date.today() - timedelta(days=7)).strftime('%Y-%m-%d')
    if not date_to:
        date_to = date.today().strftime('%Y-%m-%d')

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)
    # ... build query, run_query(), transform results ...
    return {'cube_json': json.dumps(cube), 'filters': {...}, 'selected': {...}}
```

### 2. Add Views (views.py)

```python
from .services_newpage import get_newpage_data

def newpage(request):
    return render(request, 'dashboard/newpage.html')

def newpage_data(request):
    data = get_newpage_data(
        supervisor=request.GET.get('supervisor', 'All'),
        date_from=request.GET.get('date_from'),
        date_to=request.GET.get('date_to'),
    )
    return JsonResponse(data)
```

### 3. Add URL Routes (urls.py)

```python
path('newpage/', views.newpage),
path('api/newpage/', views.newpage_data),
```

### 4. Create Template (extending base.html)

```django
{% extends "dashboard/base.html" %}
{% load static %}
{% block title %}New Page{% endblock %}
{% block styles %}<link rel="stylesheet" href="{% static 'dashboard/newpage/newpage.css' %}?v=1">{% endblock %}
{% block content %}
  <div class="filters-bar">
    {% include "dashboard/_partials/_date_range_filters.html" with date_from='' date_to='' %}
    {% include "dashboard/_partials/_filter_actions.html" %}
  </div>
  {% include "dashboard/_partials/_banner.html" %}
  <!-- Page content -->
{% endblock %}
{% block scripts %}<script src="{% static 'dashboard/newpage/newpage.js' %}?v=1"></script>{% endblock %}
```

### 5. Create JavaScript (using LMS utilities)

```javascript
(function() {
    'use strict';
    var cache = new LMS.Cache('lms_newpage_cache', 30);
    var timer = new LMS.Timer('lms_timer_newpage', 15, function() {
        cache.clear(); window.location.reload();
    });
    function loadData() {
        var cached = cache.get();
        if (cached) { render(cached); return; }
        LMS.showLoading();
        fetch('/api/newpage/?date_from=...&date_to=...')
            .then(function(r) { return r.json(); })
            .then(function(data) { cache.set(data); render(data); });
    }
    function render(data) {
        var cube = JSON.parse(data.cube_json);
        LMS.populateDropdown('filter-supervisor', data.filters.supervisors);
        LMS.renderTable('table-body', cube, [{key:'name',label:'Name'}]);
    }
    loadData();
})();
```

### 6. Add Navigation Link in base.html sidebar

---

## Environment Variables (.env)

```env
DJANGO_SECRET_KEY=your-secret-key
DJANGO_DEBUG=True
SQL_SERVER=10.80.192.78
SQL_DATABASE=LMS_Database
SQL_USERNAME=your-username
SQL_PASSWORD=your-password
SQL_DRIVER={ODBC Driver 17 for SQL Server}
HOST=0.0.0.0
PORT=8000
THREADS=8
```

Both databases are on the same server; cross-database queries handle the roster join.

---

## Production Deployment

### Waitress Server

```bash
python run_server.py
```

Configured via `.env`: HOST (default 0.0.0.0), PORT (8000), THREADS (8).

### Windows Service (auto-start on reboot)

Using [NSSM](https://nssm.cc/download):

```cmd
nssm install LMS_Dashboard "C:\path\to\venv\Scripts\python.exe" "C:\path\to\run_server.py"
nssm set LMS_Dashboard AppDirectory "C:\path\to\Dashboard_migration"
nssm start LMS_Dashboard
```

### Static Files

WhiteNoise serves static files directly (no nginx needed).

```bash
python manage.py collectstatic --noinput
```

Run after any CSS/JS changes, then restart the server.

---

## UI Conventions

- No emojis in UI - SVG icons only
- Colors match Power BI reference dashboards
- Header: dark slate `#1e293b`
- Fonts: 'Noto Sans' / 'Inter'
- Dates displayed as mm/dd/yyyy (values stay ISO yyyy-mm-dd)
- Auto-refresh: 15 minutes (all pages except search-first)
- Session storage keys: `lms_<page>_cache`, timers: `lms_timer_<page>`

---

## Known Issues and Solutions

| Issue | Cause | Fix |
| --- | --- | --- |
| `Error converting varchar to float` | Non-numeric text in Target/Quantity | Use `TRY_CAST` instead of `CAST` |
| Browser crash on large datasets | >30K DOM elements | Search-first + pagination |
| Slow JSON transfer | Large uncompressed payloads | GZip middleware (enabled) |
| `FORMAT()` not supported | SQL Server 2008 R2 compat | Use `CONVERT()` with style codes |
| Connection pool exhaustion | All 4 in use | Auto-creates new; tune `_POOL_MAX_SIZE` |

---

## Requirements

```
Django>=4.2,<5.1
waitress>=3.0.0
plotly>=5.18.0
pandas>=2.0.0
pyodbc>=5.1.0
python-dotenv>=1.0.0
whitenoise>=6.5.0
openpyxl>=3.1.0
```

Python 3.10+ required.
