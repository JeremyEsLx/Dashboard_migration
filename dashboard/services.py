"""Data service layer — queries SQL Server for LMS data.

Connects to SQL Server via pyodbc and translates Power BI DAX measures to SQL.
LMS Table: [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03]
Headcount Table: [Business_Intelligence].[dbo].[MX03_Roster] (same server, cross-DB query)

Power BI relationship: LMS[User Name] → Headcount[User]
Employee Type filter: Headcount[Estacion_de_Trabajo] IN (DIRECT roles)

Architecture: "Hybrid Cube" — one SQL query per date loads a small aggregated
cube (~200 rows). Supervisor/Shift filtering happens client-side in JavaScript
for instant responsiveness. Only Date/Week changes trigger a server round-trip.
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
# DAY CUBE — one query, all the data for the selected date
# ============================================================
# Returns rows grouped by (Movement, Supervisor, Shift) with
# three aggregate columns that are enough to compute every KPI:
#   sum_qty, sum_line_day, sum_target_time
#
# From these 3 values you can derive:
#   UPH = sum_qty / (sum_line_day / 60)
#   Target_UPH = sum_qty / sum_target_time
#   UPH% = UPH / Target_UPH
#   Actual Time = sum_line_day / 60
#   Standard Time = sum_target_time
#   Productivity = Actual / Standard - 1
#   Quantity by Movement = SUM(sum_qty) per movement
#   Target% by Movement = group-level calculation
# ============================================================

def get_day_cube(date_filter=None, week=None):
    """
    One SQL query that returns all aggregated data for the date/week.
    Returns a list of dicts, each with:
      movement, supervisor, shift, sum_qty, sum_line_day, sum_target_time
    """
    print(f"[LMS] ─── Loading Day Cube ───")
    print(f"[LMS]   date={date_filter}, week={week}")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    # Build WHERE
    where = BASE_FILTERS
    if date_filter:
        where += f"  AND CAST([Date] AS DATE) = '{date_filter}'\n"
    if week and week != 'All':
        where += f"  AND [Fiscal Week] = '{week}'\n"
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

    # Convert to list of dicts for JSON serialization
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
    """
    Filter the cube and compute all KPIs + chart data.
    Same logic as the JavaScript will do client-side.
    """
    # Filter
    filtered = cube
    if supervisor and supervisor != 'All':
        filtered = [r for r in filtered if r['s'] == supervisor]
    if shift and shift != 'All':
        filtered = [r for r in filtered if r['sh'] == shift]

    # Totals
    total_qty = sum(r['q'] for r in filtered)
    total_ld = sum(r['ld'] for r in filtered)
    total_tt = sum(r['tt'] for r in filtered)

    # KPIs
    uph = round(total_qty / (total_ld / 60)) if total_ld > 0 else 0
    target_uph = round(total_qty / total_tt) if total_tt > 0 else 0
    uph_percent = round((uph / target_uph) * 100) if target_uph > 0 else 0
    actual_time = round(total_ld / 60, 2)
    standard_time = round(total_tt, 2)
    productivity = round((actual_time / standard_time - 1) * 100) if standard_time > 0 else 0

    # Charts — group by movement
    by_movement = {}
    for r in filtered:
        m = r['m']
        if m not in by_movement:
            by_movement[m] = {'q': 0, 'ld': 0, 'tt': 0}
        by_movement[m]['q'] += r['q']
        by_movement[m]['ld'] += r['ld']
        by_movement[m]['tt'] += r['tt']

    # Quantity by Process (sorted DESC)
    qty_by_process = dict(sorted(
        {m: int(v['q']) for m, v in by_movement.items()}.items(),
        key=lambda x: x[1], reverse=True
    ))

    # UPH vs Target by Process (Target% = sum_tt * 60 / sum_ld * 100)
    uph_vs_target = {}
    for m, v in by_movement.items():
        if v['ld'] > 0:
            uph_vs_target[m] = round(v['tt'] * 60 / v['ld'] * 100)
        else:
            uph_vs_target[m] = 0
    uph_vs_target = dict(sorted(uph_vs_target.items(), key=lambda x: x[1], reverse=True))

    # Productivity by Process
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
    """
    Returns all data for the Summary dashboard.
    Includes the cube JSON so the frontend can re-filter instantly.
    """
    if not date_filter:
        date_filter = date.today().strftime('%Y-%m-%d')

    print(f"\n{'='*60}")
    print(f"[LMS] DASHBOARD REQUEST — Date: {date_filter}")
    print(f"[LMS]   Supervisor: {supervisor} | Shift: {shift} | Week: {week}")
    print(f"{'='*60}")

    # Filter options (cached)
    try:
        filter_options = get_filter_options()
    except Exception as e:
        print(f"[LMS]   ✗ SQL Server error (Filters): {e}")
        filter_options = {'supervisors': ['All'], 'weeks': ['All']}

    # Day cube (ONE query for all data)
    try:
        cube = get_day_cube(date_filter, week)
    except Exception as e:
        print(f"[LMS]   ✗ SQL Server error (Cube): {e}")
        cube = []

    # Compute KPIs from cube for initial server-side render
    computed = compute_from_cube(cube, supervisor, shift)

    print(f"[LMS]   ✓ UPH={computed['total_uph']}, Target={computed['uph_target']}, "
          f"UPH%={computed['uph_percent']}%, Productivity={computed['productivity']}%")
    print(f"{'='*60}\n")

    data = {
        **computed,
        'cube_json': json.dumps(cube),  # For client-side JS filtering
        'filters': {
            'supervisors': filter_options['supervisors'],
            'weeks': filter_options['weeks'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'supervisor': supervisor,
            'week': week,
            'shift': shift,
            'date': date_filter,
        },
    }
    return data
