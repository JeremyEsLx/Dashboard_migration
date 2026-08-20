# LMS Dashboard Migration — Technical Documentation

**Project Name:** Dashboard_migration  
**Version:** 1.0  
**Author:** Jeremy Samonte (MX03 Distribution Center — EssilorLuxottica)  
**Last Updated:** August 2026  
**Deployment URL:** http://10.110.202.84:9824/  

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Data Sources and Databases](#4-data-sources-and-databases)
5. [Application Structure](#5-application-structure)
6. [Page Inventory](#6-page-inventory)
7. [Data Flow and API Design](#7-data-flow-and-api-design)
8. [Security Measures](#8-security-measures)
9. [Deployment Configuration](#9-deployment-configuration)
10. [Network Topology](#10-network-topology)
11. [Performance Optimizations](#11-performance-optimizations)
12. [Dependencies](#12-dependencies)

---

## 1. Project Overview

### What Is This Project?

The **LMS Dashboard Migration** is a web-based analytics platform that replaces legacy Power BI reports for the MX03 Distribution Center. It provides real-time operational visibility into warehouse productivity metrics including:

- **Unit throughput** (picking, putaway, receiving)
- **Employee performance** tracking against shift targets
- **Process efficiency** breakdowns (by supervisor, shift, process type)
- **SPAC packing productivity** (units per hour)
- **Hour-by-Hour (HxH) analysis** for intra-day performance monitoring

### Why Was It Built?

Power BI had performance and refresh-rate limitations for real-time warehouse operations. This application provides:

- Sub-second page loads via shell rendering + async data hydration
- Direct SQL Server connectivity (no intermediary data model refresh delays)
- Custom visualizations tailored to warehouse KPI needs
- Single-page interactivity without Power BI licensing constraints

### Who Uses It?

Warehouse supervisors, operations managers, and industrial engineers at the MX03 EssilorLuxottica distribution center in Tijuana, Mexico.

---

## 2. System Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            CORPORATE NETWORK (Intranet)                          │
│                                                                                 │
│  ┌──────────────────┐         HTTP (Port 9824)         ┌──────────────────────┐ │
│  │                  │ ──────────────────────────────▶   │                      │ │
│  │   User Browser   │                                  │   Application Server │ │
│  │   (Any device    │ ◀──────────────────────────────   │   10.110.202.84:9824 │ │
│  │    on network)   │      HTML + JSON responses       │                      │ │
│  │                  │                                  │   Django + Waitress  │ │
│  └──────────────────┘                                  │   (Windows Server)   │ │
│                                                        └──────────┬───────────┘ │
│                                                                   │             │
│                                                          pyodbc   │  TDS        │
│                                                        (Port 1433)│             │
│                                                                   ▼             │
│                                                        ┌──────────────────────┐ │
│                                                        │                      │ │
│                                                        │   SQL Server         │ │
│                                                        │   10.80.192.78       │ │
│                                                        │                      │ │
│                                                        │  ┌────────────────┐  │ │
│                                                        │  │ LMS_Database   │  │ │
│                                                        │  │ (Operational)  │  │ │
│                                                        │  └────────────────┘  │ │
│                                                        │  ┌────────────────┐  │ │
│                                                        │  │ Business_      │  │ │
│                                                        │  │ Intelligence   │  │ │
│                                                        │  │ (Roster/SPAC)  │  │ │
│                                                        │  └────────────────┘  │ │
│                                                        └──────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Request Lifecycle Diagram

```
┌──────────┐       ┌──────────────┐       ┌──────────────┐       ┌────────────┐
│  Browser │       │   Waitress   │       │    Django     │       │ SQL Server │
│  Client  │       │  (WSGI srv)  │       │   App Logic   │       │  Database  │
└────┬─────┘       └──────┬───────┘       └──────┬───────┘       └─────┬──────┘
     │                    │                      │                     │
     │  1. GET /page/     │                      │                     │
     │───────────────────▶│                      │                     │
     │                    │  2. Route to view    │                     │
     │                    │─────────────────────▶│                     │
     │                    │                      │                     │
     │                    │  3. Render HTML shell │                     │
     │                    │     (0 SQL queries)  │                     │
     │  4. HTML response  │◀─────────────────────│                     │
     │◀───────────────────│                      │                     │
     │                    │                      │                     │
     │  5. JS requests    │                      │                     │
     │     GET /api/page/ │                      │                     │
     │───────────────────▶│                      │                     │
     │                    │  6. Route to API view│                     │
     │                    │─────────────────────▶│                     │
     │                    │                      │  7. SQL Query       │
     │                    │                      │  (WITH NOLOCK)      │
     │                    │                      │────────────────────▶│
     │                    │                      │                     │
     │                    │                      │  8. Result rows     │
     │                    │                      │◀────────────────────│
     │                    │                      │                     │
     │                    │  9. JSON response    │                     │
     │  10. JSON data     │◀─────────────────────│                     │
     │◀───────────────────│                      │                     │
     │                    │                      │                     │
     │  11. Client-side   │                      │                     │
     │      rendering     │                      │                     │
     │      (Plotly.js)   │                      │                     │
     └────────────────────┴──────────────────────┴─────────────────────┘
```

### Shell + API Pattern (Core Design)

```
┌─────────────────────────────────────────────────────────────┐
│                    PAGE LOAD SEQUENCE                        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PHASE 1: Shell Render (< 50ms)                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ● Django view returns HTML template immediately      │  │
│  │  ● Zero SQL queries executed                          │  │
│  │  ● Skeleton shimmer animations displayed              │  │
│  │  ● Dropdowns initialized with "All" placeholder       │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  PHASE 2: Data Hydration (async, ~1-3s)                     │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ● JavaScript calls /api/<page>/                      │  │
│  │  ● Checks sessionStorage cache (15-min TTL)           │  │
│  │  ● If cache valid → render immediately (stale-while)  │  │
│  │  ● Fetches fresh data in background                   │  │
│  │  ● Populates dropdowns from response.filters          │  │
│  │  ● Renders charts via Plotly.js                       │  │
│  └───────────────────────────────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  PHASE 3: Interactive (ongoing)                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  ● Filter changes trigger new /api/ calls             │  │
│  │  ● Client-side cube slicing for instant response      │  │
│  │  ● Export to XLSX available on demand                  │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|----------|
| Web Framework | Django | 5.0.14 | URL routing, template rendering, middleware |
| WSGI Server | Waitress | 3.0.2 | Production-grade HTTP server (Windows-compatible) |
| Database Driver | pyodbc | 5.3.0 | SQL Server connectivity via ODBC |
| Data Processing | Pandas | 3.0.5 | DataFrame operations, aggregation |
| Visualization | Plotly.js | (CDN) | Interactive charts rendered client-side |
| Static Files | WhiteNoise | 6.12.0 | Compressed static file serving |
| Environment | python-dotenv | 1.2.2 | Secure credential management |
| Excel Export | openpyxl | 3.1.5 | XLSX file generation |
| Compression | Django GZip | Built-in | Response compression middleware |

### Why These Choices?

- **Waitress** over Gunicorn: Waitress is the only production-grade pure-Python WSGI server that runs natively on Windows (no WSL required)
- **pyodbc** over Django ORM: Direct SQL execution gives full control over complex warehouse queries (GROUP BY, CASE, window functions) without ORM overhead
- **Plotly.js** client-side: Offloads chart rendering to the browser; server only sends aggregated JSON data
- **No Django database**: The application is stateless — it reads from SQL Server but does not write. No migrations, no admin panel, no user sessions stored

---

## 4. Data Sources and Databases

### Database Connection Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    SQL Server: 10.80.192.78                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  DATABASE: LMS_Database                                   │  │
│  │  ─────────────────────────────────────────────────────    │  │
│  │                                                           │  │
│  │  Primary operational data source for warehouse            │  │
│  │  productivity metrics: employee activity, throughput,     │  │
│  │  shift data, process tracking, and material movements.    │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  DATABASE: Business_Intelligence                          │  │
│  │  ─────────────────────────────────────────────────────    │  │
│  │                                                           │  │
│  │  Secondary data source for employee roster/headcount      │  │
│  │  classification and SPAC packing productivity metrics.    │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Data Relationship

```
LMS_Database  ─────────────────────┐
                                   │  JOIN (via Python set lookup)
Business_Intelligence  ────────────┘

The application filters LMS operational data to only include DIRECT
employees by cross-referencing against active roster entries in the
Business Intelligence database with specific job roles
(Almacenista, Picking, Put away, Recibos, etc.)
```

### Base Data Filter (Applied to All Queries)

All queries against `LMS_Database` include a mandatory filter that ensures only productive warehouse activity is measured — excluding system movements, clock events, and housekeeping operations.

---

## 5. Application Structure

### File System Layout

```
Dashboard_migration/
├── manage.py                      # Django management commands
├── run_server.py                  # Waitress production server entry point
├── requirements.txt               # Python dependencies
├── .env                           # Environment variables (NOT in git)
├── .env.example                   # Template for .env configuration
├── .gitignore                     # Git exclusion rules
│
├── lms_dashboard/                 # Django project settings
│   ├── __init__.py
│   ├── settings.py                # All configuration (DB, middleware, static)
│   ├── urls.py                    # Root URL router
│   └── wsgi.py                    # WSGI application entry point
│
├── dashboard/                     # Main Django app
│   ├── __init__.py
│   ├── apps.py                    # App configuration
│   ├── urls.py                    # URL patterns (pages + APIs)
│   ├── views.py                   # Shell views + API views
│   │
│   ├── services_base.py           # Connection pool, run_query, shared utilities
│   ├── services.py                # Summary, Performance, Process, Strong Start/Finish
│   ├── services_userperf.py       # User Performance page logic
│   ├── services_delivery.py       # Delivery Deep Dive logic
│   ├── services_material.py       # Detail by Material logic
│   ├── services_usersummary.py    # User Summary logic
│   ├── services_spac.py           # SPAC packing productivity (4 pages)
│   ├── services_hxh.py            # Hour-by-Hour analysis (2 pages)
│   │
│   ├── templates/dashboard/       # HTML templates
│   │   ├── base.html              # Base template (navigation, CDN links)
│   │   ├── _partials/             # Reusable template fragments
│   │   │   ├── _banner.html
│   │   │   ├── _filter_actions.html
│   │   │   ├── _date_range_filters.html
│   │   │   └── _table_skeleton.html
│   │   ├── summary.html
│   │   ├── performance.html
│   │   ├── process.html
│   │   └── ... (one per page)
│   │
│   └── static/dashboard/          # Static assets (CSS + JS per page)
│       ├── base.css               # Global styles
│       ├── shared/                # Shared JS library
│       │   └── lms-core.js        # Cache, Timer, populateDropdown, renderTable, exportXLSX
│       ├── summary/
│       │   ├── summary.css
│       │   └── summary.js
│       ├── performance/
│       │   ├── performance.css
│       │   └── performance.js
│       └── ... (one folder per page)
│
└── staticfiles/                   # Collected static files (production)
```

### Service Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    views.py                              │
│  ┌─────────────────┐    ┌──────────────────────────┐    │
│  │  Shell Views    │    │      API Views           │    │
│  │  (render HTML)  │    │  (return JsonResponse)   │    │
│  │  0 SQL queries  │    │  calls service function  │    │
│  └─────────────────┘    └────────────┬─────────────┘    │
└──────────────────────────────────────┼──────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────┐
│              Service Layer (per-page modules)            │
│  ┌──────────────┐ ┌──────────────┐ ┌────────────────┐   │
│  │ services.py  │ │services_hxh  │ │ services_spac  │   │
│  │ (6 pages)    │ │ (2 pages)    │ │ (4 pages)      │   │
│  └──────┬───────┘ └──────┬───────┘ └──────┬─────────┘   │
│         │                │                │             │
│  ┌──────┴────────────────┴────────────────┴─────────┐   │
│  │            services_base.py                       │   │
│  │  ● Connection Pool (max 4 connections)            │   │
│  │  ● run_query(sql) → DataFrame                    │   │
│  │  ● get_direct_users() → set (cached)             │   │
│  │  ● BASE_FILTERS, date range builders             │   │
│  │  ● get_filter_options() (cached 1 hour)           │   │
│  └──────────────────────┬───────────────────────────┘   │
└─────────────────────────┼───────────────────────────────┘
                          │
                          ▼
                   ┌──────────────┐
                   │  SQL Server  │
                   │  (pyodbc)    │
                   └──────────────┘
```

---

## 6. Page Inventory

### Active Dashboard Pages (17 total)

| # | Page | URL Path | API Endpoint | Data Source | Category |
|---|------|----------|--------------|-------------|----------|
| 1 | Summary | `/` | `/api/summary/` | LMS_Database | Hybrid Cube |
| 2 | Performance | `/performance/` | `/api/performance/` | LMS_Database | Hybrid Cube |
| 3 | Process | `/process/` | `/api/process/` | LMS_Database | Hybrid Cube |
| 4 | Strong Start | `/strongstart/` | `/api/strongstart/` | LMS_Database | Hybrid Cube |
| 5 | Strong Finish | `/strongfinish/` | `/api/strongfinish/` | LMS_Database | Hybrid Cube |
| 6 | No Activity | `/noactivity/` | `/api/noactivity/` | LMS_Database | Hybrid Cube |
| 7 | User Performance | `/userperformance/` | `/api/userperformance/` | LMS_Database | Search-First |
| 8 | Delivery Deep Dive | `/deliverydeepdive/` | `/api/deliverydeepdive/` | LMS_Database | Search-First |
| 9 | Detail by Material | `/detailbymaterial/` | `/api/detailbymaterial/` | LMS_Database | Hybrid Cube |
| 10 | User Summary | `/usersummary/` | `/api/usersummary/` | LMS_Database | Search-First |
| 11 | SPAC UPH | `/spacuph/` | `/api/spacuph/` | Business_Intelligence | Hybrid Cube |
| 12 | SPAC Performance | `/spacperformance/` | `/api/spacuph/` (shared) | Business_Intelligence | Hybrid Cube |
| 13 | SPAC Perf by User | `/spacperfbyuser/` | `/api/spacuph/` (shared) | Business_Intelligence | Hybrid Cube |
| 14 | SPAC Details | `/spacdetails/` | `/api/spacdetails/` | Business_Intelligence | Hybrid Cube |
| 15 | HxH Overall | `/hxh/` | `/api/hxh/` | LMS_Database | Hybrid Cube |
| 16 | HxH Perf by User | `/hxhuser/` | `/api/hxh/` (shared) | LMS_Database | Hybrid Cube |
| 17 | HxH Data | `/hxhdata/` | `/api/hxh/` (shared) | LMS_Database | Tabular |

### Page Categories Explained

- **Hybrid Cube**: Pre-aggregated data cube sent to browser; client-side slicing for filter changes (instant response)
- **Search-First**: Page loads empty; user must select filters before data is fetched (protects against large unfiltered queries)

---

## 7. Data Flow and API Design

### API Response Format

All API endpoints return JSON with a consistent structure:

```
{
  "cube_json": "[...]",        // Aggregated data as JSON string (for charts)
  "filters": {                  // Available dropdown values
    "supervisors": ["All", ...],
    "weeks": ["All", ...],
    "processes": ["All", ...]
  },
  "selected": {                 // Current filter selections echoed back
    "supervisor": "All",
    "week": "All"
  },
  "kpis": {                     // Summary KPI values (page-specific)
    "total_units": 12345,
    "avg_uph": 67.8
  }
}
```

### Client-Side Caching Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│               Stale-While-Revalidate Pattern                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. Page loads → Check sessionStorage for cache key             │
│     Cache key format: lms_<page>_cache                          │
│                                                                 │
│  2. If cache exists AND age < 15 minutes:                       │
│     ├── Render immediately from cache (instant UX)              │
│     └── Fetch fresh data in background (silent update)          │
│                                                                 │
│  3. If cache missing OR expired:                                │
│     ├── Show skeleton loading animation                         │
│     └── Fetch data, render, store in cache                      │
│                                                                 │
│  Timer key: lms_timer_<page>                                    │
│  Timer module: LMS.Timer (tracks data freshness)                │
│                                                                 │
│  NOTE: Search-first pages have NO cache                         │
│        (data is user-specific, not reusable)                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. Security Measures

### 8.1 Network-Level Security

| Measure | Implementation |
|---------|----------------|
| **Internal-only access** | Application bound to internal IP (10.110.202.84); not exposed to internet |
| **Port restriction** | Single port (9824) opened on the server firewall; all other ports blocked |
| **Same-network requirement** | Users must be connected to the corporate network to access the dashboard |
| **No public DNS** | No domain name resolves externally; IP-only access within intranet |

### 8.2 Application-Level Security

| Measure | Implementation |
|---------|----------------|
| **Environment variables** | All credentials stored in `.env` file (never committed to git) |
| **`.gitignore` enforcement** | `.env`, `__pycache__`, `.pyc` files excluded from version control |
| **No user authentication stored** | App is stateless — no user accounts, no sessions, no cookies with sensitive data |
| **Django Security Middleware** | `SecurityMiddleware` enabled (HSTS headers, XSS protection) |
| **Clickjacking protection** | `XFrameOptionsMiddleware` prevents iframe embedding |
| **GZip Middleware** | Compression applied at the response level (not a security feature but reduces data exposure surface) |
| **SECRET_KEY externalized** | Django secret key loaded from environment, not hardcoded |
| **ALLOWED_HOSTS** | Configurable host whitelist (should be restricted in production) |

### 8.3 Database Security

| Measure | Implementation |
|---------|----------------|
| **Read-only access pattern** | All queries use `WITH (NOLOCK)` — SELECT only, no INSERT/UPDATE/DELETE |
| **No Django ORM database** | `DATABASES = {}` in settings — Django has zero write capability |
| **Connection pooling** | Max 4 concurrent connections; prevents connection flood |
| **Connection validation** | Pool tests connections with `SELECT 1` before reuse; stale connections discarded |
| **TrustServerCertificate** | TLS encrypted connection to SQL Server |
| **Dedicated service account** | SQL credentials are for a read-only service account (not a personal account) |

### 8.4 Data Protection

| Measure | Implementation |
|---------|----------------|
| **No PII storage** | Application does not persist any data; all data flows through and is discarded |
| **No file uploads** | No file upload endpoints exist; no user input written to disk |
| **No admin interface** | Django admin is not installed; no `/admin/` endpoint exists |
| **Error handling** | API errors return generic messages; stack traces not exposed to client |
| **No raw SQL in URLs** | All query logic is server-side; users cannot inject SQL through URL parameters |

### 8.5 Security Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     SECURITY LAYERS                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Layer 1: NETWORK                                               │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ● Corporate firewall (only port 9824 open)               │  │
│  │  ● Internal IP only (10.x.x.x range)                      │  │
│  │  ● VPN required for remote access                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Layer 2: APPLICATION                                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ● Django Security + Clickjacking middleware              │  │
│  │  ● Waitress (no raw socket exposure, thread-safe)         │  │
│  │  ● No admin panel, no session storage, no file uploads    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Layer 3: DATA ACCESS                                           │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ● Read-only service account (SELECT + NOLOCK only)       │  │
│  │  ● Pooled connections (max 4, validated before use)       │  │
│  │  ● Credentials in .env (not in source code)               │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Layer 4: VERSION CONTROL                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  ● .gitignore excludes .env, secrets, compiled files      │  │
│  │  ● GitHub repository (private)                            │  │
│  │  ● No credentials in commit history                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. Deployment Configuration

### Current Deployment

| Parameter | Value |
|-----------|-------|
| **Server IP** | 10.110.202.84 |
| **Port** | 9824 |
| **Full URL** | http://10.110.202.84:9824/ |
| **Host Machine** | Windows Server (Juan's server) |
| **Python** | 3.x with virtual environment |
| **WSGI Server** | Waitress (8 threads, 120s channel timeout) |
| **Process Manager** | Windows Service |
| **Auto-restart** | Yes (auto-start on reboot) |

### Waitress Server Configuration

```
Host:              0.0.0.0 (all interfaces)
Port:              9824
Threads:           8 (concurrent request handling)
Channel Timeout:   120 seconds (long query tolerance)
Cleanup Interval:  30 seconds
URL Scheme:        http
```

### Static File Serving

In production (`DJANGO_DEBUG=False`):
- WhiteNoise serves static files with Brotli/GZip compression
- Files are collected to `staticfiles/` directory via `python manage.py collectstatic`
- Cache headers applied for browser caching

---

## 10. Network Topology

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EssilorLuxottica MX03 Network                         │
│                                                                             │
│   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐                  │
│   │ Supervisor  │     │  Engineer   │     │  Manager    │                  │
│   │  Workstation│     │  Laptop     │     │  Laptop     │                  │
│   └──────┬──────┘     └──────┬──────┘     └──────┬──────┘                  │
│          │                   │                   │                          │
│          └───────────────────┼───────────────────┘                          │
│                              │                                              │
│                    ┌─────────┴─────────┐                                    │
│                    │  Corporate Switch  │                                    │
│                    │  / Network         │                                    │
│                    └─────────┬─────────┘                                    │
│                              │                                              │
│              ┌───────────────┼───────────────┐                              │
│              │                               │                              │
│              ▼                               ▼                              │
│   ┌──────────────────┐            ┌──────────────────┐                      │
│   │  App Server       │            │  Database Server │                      │
│   │  10.110.202.84    │◀──────────▶│  10.80.192.78    │                      │
│   │  Port 9824        │  pyodbc    │  Port 1433       │                      │
│   │                   │  (TDS)     │                  │                      │
│   │  Windows Server   │            │  SQL Server      │                      │
│   │  Python + Django  │            │  2008 R2+        │                      │
│   │  + Waitress       │            │                  │                      │
│   └──────────────────┘            └──────────────────┘                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Performance Optimizations

### Server-Side

| Optimization | Description |
|-------------|-------------|
| **Connection Pool** | Reuses up to 4 database connections (avoids connection setup overhead per request) |
| **`WITH (NOLOCK)`** | All queries use dirty reads — eliminates blocking from concurrent warehouse writes |
| **`lru_cache` for roster** | Employee list loaded once and cached in memory until server restart |
| **Filter cache (1 hour)** | Dropdown options (supervisors, weeks, processes) cached server-side |
| **Pre-aggregated cubes** | SQL does GROUP BY server-side; only aggregated rows sent to client |
| **GZip compression** | Response bodies compressed before transmission |
| **WhiteNoise** | Static files served with compression + aggressive cache headers |

### Client-Side

| Optimization | Description |
|-------------|-------------|
| **Shell rendering** | HTML loads in <50ms with skeleton animations (perceived instant load) |
| **sessionStorage cache** | 15-minute TTL avoids redundant API calls on page navigation |
| **Stale-while-revalidate** | Shows cached data immediately while fetching fresh data in background |
| **Client-side cube slicing** | Filter changes slice in-memory data; no round-trip to server |
| **Plotly.js client rendering** | Charts rendered in browser; server sends only data points |
| **TOP 10000 safety cap** | Search-first pages limit rows to prevent browser memory issues |

---

## 12. Dependencies

### Python Packages (requirements.txt)

```
Django==5.0.14
et_xmlfile==2.0.0
narwhals==2.24.0
numpy==2.5.1
openpyxl==3.1.5
packaging==26.2
pandas==3.0.5
plotly==6.9.0
pyodbc==5.3.0
python-dateutil==2.9.0.post0
python-dotenv==1.2.2
six==1.17.0
sqlparse==0.5.5
tzdata==2026.3
waitress==3.0.2
whitenoise==6.12.0
```

### System Requirements

| Requirement | Details |
|-------------|----------|
| Python | 3.10+ |
| ODBC Driver | Microsoft ODBC Driver 17 for SQL Server |
| OS | Windows Server (for Waitress) |
| Network | Access to SQL Server on 10.80.192.78:1433 |
| RAM | Minimal (~200MB under load) |
| Disk | ~50MB (application + static files) |

### External CDN Dependencies (Client-Side)

- **Plotly.js** — Interactive charting library
- **Font**: Noto Sans / Inter (Google Fonts or self-hosted)

---

*End of document.*
