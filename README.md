# LMS Dashboard Migration — Tijuana Warehouse

Django web application migrating Power BI LMS dashboards for EssilorLuxottica's Tijuana (MX03) warehouse operations.

## Quick Start

```bash
# Clone
git clone https://github.com/JeremyEsLx/Dashboard_migration.git
cd Dashboard_migration

# Virtual environment
python -m venv venv
venv\\Scripts\\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Configure environment (.env file)
cp .env.example .env
# Edit .env with your SQL Server credentials

# Run
python manage.py runserver
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

## Pages

| Page | URL | API | Description |
| --- | --- | --- | --- |
| Summary | `/` | `/api/summary/` | Daily/weekly KPIs, supervisor breakdown |
| Performance by User | `/performance/` | `/api/performance/` | UPH by user for date range |
| User Performance | `/userperformance/` | `/api/userperformance/` | Raw detail rows (search-first) |
| Performance by Process | `/process/` | `/api/process/` | UPH by process for date range |
| Strong Start | `/strongstart/` | `/api/strongstart/` | First scan after clock-in metrics |
| Strong Finish | `/strongfinish/` | `/api/strongfinish/` | Last scan before clock-out metrics |
| No Activity | `/noactivity/` | `/api/noactivity/` | Clock-in to clock-out with no scans |
| Delivery Deep Dive | `/deliverydeepdive/` | `/api/deliverydeepdive/` | Picking/packing detail by delivery (search-first) |

## User Performance — Search-First Pattern

This page handles ~1M transaction rows and uses a different architecture:

1. Page loads **empty** (only filter dropdowns populated)
2. User must select at least one filter (Supervisor, Name, Process, Movement, or Shift)
3. Click **Search** → query runs with filters in SQL WHERE clause
4. Results capped at **10,000 rows** (safety limit)
5. Client-side **pagination** (100 rows per page)
6. **Export** downloads all filtered rows as CSV
7. Week and Hour are post-search client-side narrowing filters

## SQL Data Sources

| Database | Table | Purpose |
| --- | --- | --- |
| LMS_Database | `[dbo].[LMS_PBI_Dashboard_MX03]` | Main LMS transaction data |
| Business_Intelligence | `[dbo].[MX03_Roster]` | Employee headcount/roster |

### Employee Type Filter
Only **DIRECT** employees are included, determined by `[Estacion_de_Trabajo]`:
- Operador en Entrenamiento, Almacenista, Automation clerk I, DC clerk 1
- Packing / VAS, Picking, Put away, Recibos

### Base SQL Filters (Summary, Performance, Process)
```sql
WHERE [Activity Type] = 'DIRECT'
  AND [Movement] NOT IN ('BIN2BIN', 'LOST&FOUND', 'RECASE', 'HOUSEKEEPING')
  AND [Process] NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')
```

### Shift Mapping
| Code | Raw Values |
| --- | --- |
| A | Turno A - Produccion, Lunes-Jueves 06:00 a 18:00, Lunes-Viernes 08:00 a 17:30 |
| B | Turno B - Produccion |
| C | Turno C - Produccion |
| D | Turno D - Produccion |

## Project Structure

```
Dashboard_migration/
├── lms_dashboard/
│   ├── settings.py          # Django settings, SQL Server config, GZip middleware
│   ├── urls.py              # Root URL config
│   └── wsgi.py
├── dashboard/
│   ├── views.py             # Shell views + API views (7 pages)
│   ├── services.py          # SQL queries + computation (~1200 lines)
│   ├── services_userperf.py # User Performance service (search-first)
│   ├── apps.py              # Cache pre-warm on startup
│   ├── urls.py              # App-level routes
│   ├── static/dashboard/
│   │   ├── base.css
│   │   ├── summary/summary.js
│   │   ├── performance/performance.js
│   │   ├── process/process.js
│   │   ├── strongstart/strongstart.js + .css
│   │   ├── strongfinish/strongfinish.js + .css
│   │   ├── noactivity/noactivity.js + .css
│   │   └── userperformance/userperformance.js + .css
│   └── templates/dashboard/
│       ├── base.html         # Shared layout (nav, header, logo)
│       ├── summary.html
│       ├── performance.html
│       ├── process.html
│       ├── strongstart.html
│       ├── strongfinish.html
│       ├── noactivity.html
│       └── userperformance.html
├── manage.py
├── requirements.txt
└── .env                      # SQL Server credentials (not committed)
```

## Environment Variables (.env)

```env
DJANGO_SECRET_KEY=your-secret-key
DJANGO_DEBUG=True
SQL_SERVER=your-sql-server
SQL_DATABASE=LMS_Database
SQL_USERNAME=your-username
SQL_PASSWORD=your-password
SQL_DRIVER={ODBC Driver 17 for SQL Server}
BI_SERVER=your-bi-server
BI_DATABASE=Business_Intelligence
BI_USERNAME=your-username
BI_PASSWORD=your-password
```

## UI Conventions

- **No emojis** — SVG icons only
- **Colors** match the Power BI reference dashboards
- **Header**: dark slate `#1e293b`
- **Fonts**: 'Noto Sans' / 'Inter'
- **Date display**: mm/dd/yyyy (values stay ISO yyyy-mm-dd for filtering/sorting)
- **Auto-refresh**: 15 minutes (all pages except User Performance)

## Known Issues & Solutions

| Issue | Cause | Fix |
| --- | --- | --- |
| `Error converting varchar to float` | Non-numeric text in Target/Quantity columns | Use `TRY_CAST` instead of `CAST` |
| Browser crash on User Performance | ~1M DOM elements from rendering all rows | Search-first pattern + pagination |
| Slow JSON transfer | Large uncompressed JSON payloads | GZip middleware |
| Empty template after git checkout | File not properly restored | Verify and rewrite template content |
| Git auth failure in Databricks | Token expired | Update credential in Settings > Linked Accounts |

## Development

```bash
# Run dev server (auto-reloads on file changes)
python manage.py runserver

# Collect static files (for production/WhiteNoise)
python manage.py collectstatic
```

## Deployment

The app uses WhiteNoise for static file serving in production. Set `DJANGO_DEBUG=False` and ensure `ALLOWED_HOSTS` is configured.
