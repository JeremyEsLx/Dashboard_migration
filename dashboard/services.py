"""Data service layer — queries SQL Server for LMS data.

Connects to SQL Server via pyodbc and translates Power BI DAX measures to SQL.
LMS Table: [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03]
Headcount Table: [Business_Intelligence].[dbo].[MX03_Roster] (same server, cross-DB query)

Power BI relationship: LMS[User Name] → Headcount[User]
Employee Type filter: Headcount[Estacion_de_Trabajo] IN (DIRECT roles)

Architecture: "Hybrid Cube" — one SQL query per date loads a small aggregated
cube (~200 rows). Supervisor/Shift filtering happens client-side in JavaScript
for instant responsiveness. Only Date/Week changes trigger a server round-trip.

Date vs Week: MUTUALLY EXCLUSIVE.
  - If Date is provided → filter by that single day (ignore Week)
  - If Week is provided (no Date) → filter by that fiscal week (all days)
  - If neither → default to today's date
"""
import json
import pyodbc
import pandas as pd
from django.conf import settings
from datetime import date
from functools import lru_cache
import time


# ============================================================
# DATABASE CONNECTION
# ============================================================

def get_connection():
    """Connect to SQL Server (cross-database queries work on same instance)."""
    conn_str = (
        f"DRIVER={settings.SQL_DRIVER};"
        f"SERVER={settings.SQL_SERVER};"
        f"DATABASE={settings.SQL_DATABASE};"
        f"UID={settings.SQL_USERNAME};"
        f"PWD={settings.SQL_PASSWORD};"
        f"TrustServerCertificate=yes;"
    )
    return pyodbc.connect(conn_str)


def run_query(query: str) -> pd.DataFrame:
    """Execute a SQL query and return results as a DataFrame."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        return pd.DataFrame.from_records(rows, columns=columns)
    finally:
        conn.close()


# ============================================================
# HEADCOUNT / EMPLOYEE TYPE FILTER
# ============================================================

DIRECT_ROLES = (
    'Operador en Entrenamiento',
    'Almacenista',
    'Automation clerk I',
    'DC clerk 1',
    'Packing / VAS',
    'Picking',
    'Put away',
    'Recibos',
)


@lru_cache(maxsize=1)
def get_direct_users() -> set:
    """Fetch DIRECT employee usernames from BI Roster (cached)."""
    print("[LMS] ─── Loading DIRECT users from Headcount ───")
    start = time.time()

    roles_str = ", ".join(f"'{r}'" for r in DIRECT_ROLES)
    query = f"""
        SELECT ISNULL([Alias_SAP], CAST([EE_ID] AS VARCHAR(50))) AS [User]
        FROM [Business_Intelligence].[dbo].[MX03_Roster]
        WHERE CAST([Active_YN] AS VARCHAR(MAX)) = 'SI'
          AND [Estacion_de_Trabajo] IN ({roles_str})
    """
    df = run_query(query)
    users = set(df['User'].dropna().str.strip().tolist())

    elapsed = time.time() - start
    print(f"[LMS]   ✓ Found {len(users)} DIRECT users ({elapsed:.2f}s)")
    print(f"[LMS]   (cached — won't query again until server restart)")
    return users


# ============================================================
# BASE QUERY HELPERS
# ============================================================

BASE_FILTERS = """
    WHERE [Activity Type] = 'DIRECT'
      AND [Movement] NOT IN ('BIN2BIN', 'LOST&FOUND', 'RECASE', 'HOUSEKEEPING')
      AND [Process] NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')
"""


def _base_subquery():
    """Base SELECT with SHIFT2 computed column."""
    return """
        SELECT *,
            CASE
                WHEN [Shift] IN ('Turno A - Produccion', 'Lunes-Jueves 06:00 a 18:00', 'Lunes-Viernes 08:00 a 17:30') THEN 'A'
                WHEN [Shift] = 'Turno B - Produccion' THEN 'B'
                WHEN [Shift] = 'Turno C - Produccion' THEN 'C'
                WHEN [Shift] = 'Turno D - Produccion' THEN 'D'
                ELSE 'NO SHIFT MAPPED'
            END AS [SHIFT2]
        FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03]
    """


def _build_date_where(date_filter=None, week=None):
    """Shared WHERE clause builder for date/week filtering."""
    where = BASE_FILTERS
    if date_filter:
        where += f"  AND CAST([Date] AS DATE) = '{date_filter}'\n"
    elif week and week != 'All':
        where += f"  AND [Fiscal Week] = '{week}'\n"
    return where


# ============================================================
# FILTER OPTIONS (populate dropdowns — cached)
# ============================================================

@lru_cache(maxsize=1)
def get_filter_options():
    """Fetch distinct Supervisor and Week values for filter dropdowns."""
    print("[LMS] ─── Loading filter options ───")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    sup_query = f"""
        SELECT DISTINCT [Supervisor Full Name]
        FROM ({_base_subquery()}) AS LMS
        {BASE_FILTERS}
          AND [User Name] IN ({users_str})
          AND [Supervisor Full Name] IS NOT NULL
          AND [Supervisor Full Name] != ''
        ORDER BY [Supervisor Full Name]
    """
    week_query = f"""
        SELECT DISTINCT [Fiscal Week]
        FROM ({_base_subquery()}) AS LMS
        {BASE_FILTERS}
          AND [User Name] IN ({users_str})
          AND [Fiscal Week] IS NOT NULL
          AND [Fiscal Week] != ''
        ORDER BY [Fiscal Week] DESC
    """

    df_sup = run_query(sup_query)
    df_week = run_query(week_query)

    supervisors = ['All'] + df_sup['Supervisor Full Name'].tolist()
    weeks = ['All'] + df_week['Fiscal Week'].tolist()

    elapsed = time.time() - start
    print(f"[LMS]   ✓ {len(supervisors)-1} supervisors, {len(weeks)-1} weeks ({elapsed:.2f}s)")
    return {'supervisors': supervisors, 'weeks': weeks}


# ============================================================
# DAY CUBE — one query, all the data for the selected date/week
# ============================================================

def get_day_cube(date_filter=None, week=None):
    """
    One SQL query that returns all aggregated data for the date OR week.
    Date takes priority over Week (mutually exclusive).
    """
    print(f"[LMS] ─── Loading Day Cube ───")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    where = _build_date_where(date_filter, week)
    if date_filter:
        print(f"[LMS]   Mode: DATE = {date_filter}")
    elif week and week != 'All':
        print(f"[LMS]   Mode: WEEK = {week}")
    else:
        print(f"[LMS]   Mode: NO FILTER (all data)")
    where += f"  AND [User Name] IN ({users_str})\n"

    query = f"""
        SELECT
            [Movement],
            [Supervisor Full Name] AS supervisor,
            [SHIFT2] AS shift,
            SUM(CAST([Quantity] AS FLOAT)) AS sum_qty,
            SUM(CAST([Line Day Activity] AS FLOAT)) AS sum_line_day,
            SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)) AS sum_target_time
        FROM ({_base_subquery()}) AS LMS
        {where}
        GROUP BY [Movement], [Supervisor Full Name], [SHIFT2]
    """

    df = run_query(query)
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   ✗ No data returned ({elapsed:.2f}s)")
        return []

    cube = []
    for _, row in df.iterrows():
        cube.append({
            'm': row['Movement'] or '',
            's': row['supervisor'] or '',
            'sh': row['shift'] or '',
            'q': round(float(row['sum_qty'] or 0), 2),
            'ld': round(float(row['sum_line_day'] or 0), 4),
            'tt': round(float(row['sum_target_time'] or 0), 4),
        })

    print(f"[LMS]   ✓ {len(cube)} rows in cube ({elapsed:.2f}s)")
    return cube


# ============================================================
# COMPUTE KPIs FROM CUBE (Python — for initial server render)
# ============================================================

def compute_from_cube(cube, supervisor='All', shift='All'):
    """Filter the cube and compute all KPIs + chart data."""
    filtered = cube
    if supervisor and supervisor != 'All':
        filtered = [r for r in filtered if r['s'] == supervisor]
    if shift and shift != 'All':
        filtered = [r for r in filtered if r['sh'] == shift]

    total_qty = sum(r['q'] for r in filtered)
    total_ld = sum(r['ld'] for r in filtered)
    total_tt = sum(r['tt'] for r in filtered)

    uph = round(total_qty / (total_ld / 60)) if total_ld > 0 else 0
    target_uph = round(total_qty / total_tt) if total_tt > 0 else 0
    uph_percent = round((uph / target_uph) * 100) if target_uph > 0 else 0
    actual_time = round(total_ld / 60, 2)
    standard_time = round(total_tt, 2)
    productivity = round((actual_time / standard_time - 1) * 100) if standard_time > 0 else 0

    by_movement = {}
    for r in filtered:
        m = r['m']
        if m not in by_movement:
            by_movement[m] = {'q': 0, 'ld': 0, 'tt': 0}
        by_movement[m]['q'] += r['q']
        by_movement[m]['ld'] += r['ld']
        by_movement[m]['tt'] += r['tt']

    qty_by_process = dict(sorted(
        {m: int(v['q']) for m, v in by_movement.items()}.items(),
        key=lambda x: x[1], reverse=True
    ))

    uph_vs_target = {}
    for m, v in by_movement.items():
        if v['ld'] > 0:
            uph_vs_target[m] = round(v['tt'] * 60 / v['ld'] * 100)
        else:
            uph_vs_target[m] = 0
    uph_vs_target = dict(sorted(uph_vs_target.items(), key=lambda x: x[1], reverse=True))

    prod_by_process = {}
    for m, v in by_movement.items():
        if v['tt'] > 0:
            prod_by_process[m] = round(((v['ld'] / 60) / v['tt'] - 1) * 100)
        else:
            prod_by_process[m] = 0
    prod_by_process = dict(sorted(prod_by_process.items(), key=lambda x: x[1]))

    return {
        'total_uph': uph,
        'uph_target': target_uph,
        'uph_percent': uph_percent,
        'actual_time': actual_time,
        'standard_time': standard_time,
        'productivity': productivity,
        'quantity_by_process': qty_by_process,
        'uph_vs_target_by_process': uph_vs_target,
        'productivity_by_process': prod_by_process,
    }


# ============================================================
# MAIN SUMMARY
# ============================================================

def get_summary_data(supervisor='All', week='All', shift='All', date_filter=None):
    """Returns all data for the Summary dashboard."""
    if date_filter:
        effective_week = 'All'
    elif week and week != 'All':
        date_filter = None
        effective_week = week
    else:
        date_filter = date.today().strftime('%Y-%m-%d')
        effective_week = 'All'

    print(f"\n{'='*60}")
    print(f"[LMS] DASHBOARD REQUEST")
    print(f"[LMS]   Date: {date_filter or '(none)'} | Week: {effective_week} | "
          f"Supervisor: {supervisor} | Shift: {shift}")
    print(f"{'='*60}")

    try:
        filter_options = get_filter_options()
    except Exception as e:
        print(f"[LMS]   ✗ SQL Server error (Filters): {e}")
        filter_options = {'supervisors': ['All'], 'weeks': ['All']}

    try:
        cube = get_day_cube(date_filter, effective_week)
    except Exception as e:
        print(f"[LMS]   ✗ SQL Server error (Cube): {e}")
        cube = []

    computed = compute_from_cube(cube, supervisor, shift)

    print(f"[LMS]   ✓ UPH={computed['total_uph']}, Target={computed['uph_target']}, "
          f"UPH%={computed['uph_percent']}%, Productivity={computed['productivity']}%")
    print(f"{'='*60}\n")

    return {
        **computed,
        'cube_json': json.dumps(cube),
        'filters': {
            'supervisors': filter_options['supervisors'],
            'weeks': filter_options['weeks'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'supervisor': supervisor,
            'week': effective_week,
            'shift': shift,
            'date': date_filter or '',
        },
    }


# ============================================================
# PERFORMANCE BY USER — Process hierarchy cube
# ============================================================
# Groups by Process × Flow_Type_Map × Cart Type
# Same base measures: sum_qty, sum_line_day, sum_target_time
# JS computes KPIs and handles expand/collapse hierarchy
# ============================================================

def get_performance_cube(date_filter=None, week=None):
    """
    Query grouped by Process, Flow_Type_Map, Cart_Type.
    Returns list of dicts for hierarchical table rendering.
    """
    print(f"[LMS] ─── Loading Performance Cube ───")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    where = _build_date_where(date_filter, week)
    where += f"  AND [User Name] IN ({users_str})\n"

    query = f"""
        SELECT
            ISNULL([Process], '') AS [process],
            ISNULL([Flow_Type_Map], '') AS [flow_type],
            ISNULL([Cart Type], '') AS [cart_type],
            SUM(CAST([Quantity] AS FLOAT)) AS sum_qty,
            SUM(CAST([Line Day Activity] AS FLOAT)) AS sum_line_day,
            SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)) AS sum_target_time
        FROM ({_base_subquery()}) AS LMS
        {where}
        GROUP BY [Process], [Flow_Type_Map], [Cart Type]
    """

    df = run_query(query)
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   ✗ No data returned ({elapsed:.2f}s)")
        return []

    cube = []
    for _, row in df.iterrows():
        cube.append({
            'p': row['process'] or '',
            'f': row['flow_type'] or '',
            'c': row['cart_type'] or '',
            'q': round(float(row['sum_qty'] or 0), 2),
            'ld': round(float(row['sum_line_day'] or 0), 4),
            'tt': round(float(row['sum_target_time'] or 0), 4),
        })

    print(f"[LMS]   ✓ {len(cube)} rows in performance cube ({elapsed:.2f}s)")
    return cube


def get_performance_data(week='All', shift='All', date_filter=None):
    """
    Returns all data for the Performance by User page.
    Same date/week logic as Summary.
    """
    if date_filter:
        effective_week = 'All'
    elif week and week != 'All':
        date_filter = None
        effective_week = week
    else:
        date_filter = date.today().strftime('%Y-%m-%d')
        effective_week = 'All'

    print(f"\n{'='*60}")
    print(f"[LMS] PERFORMANCE REQUEST")
    print(f"[LMS]   Date: {date_filter or '(none)'} | Week: {effective_week} | Shift: {shift}")
    print(f"{'='*60}")

    try:
        filter_options = get_filter_options()
    except Exception as e:
        print(f"[LMS]   ✗ SQL Server error (Filters): {e}")
        filter_options = {'supervisors': ['All'], 'weeks': ['All']}

    try:
        cube = get_performance_cube(date_filter, effective_week)
    except Exception as e:
        print(f"[LMS]   ✗ SQL Server error (Performance Cube): {e}")
        cube = []

    print(f"{'='*60}\n")

    return {
        'cube_json': json.dumps(cube),
        'filters': {
            'weeks': filter_options['weeks'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'week': effective_week,
            'shift': shift,
            'date': date_filter or '',
        },
    }
