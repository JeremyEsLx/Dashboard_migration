"""Data service layer — queries SQL Server for LMS data.

Connects to SQL Server via pyodbc and translates Power BI DAX measures to SQL.
LMS Table: [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03]
Headcount Table: [Business_Intelligence].[dbo].[MX03_Roster] (same server, cross-DB query)

Power BI relationship: LMS[User Name] → Headcount[User]
Employee Type filter: Headcount[Estacion_de_Trabajo] IN (DIRECT roles)
"""
import pyodbc
import pandas as pd
from django.conf import settings
from datetime import date
from functools import lru_cache
import time


# ============================================================
# DATABASE CONNECTION (single connection — both DBs on same server)
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
    """
    Fetch DIRECT employee usernames from BI Roster (cached).
    Cross-database query to [Business_Intelligence].[dbo].[MX03_Roster].
    """
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


def _build_where_clause(date_filter=None, supervisor=None, shift=None, direct_users=None):
    """Build WHERE clause with all Power BI filters."""
    where = BASE_FILTERS

    if date_filter:
        where += f"  AND CAST([Date] AS DATE) = '{date_filter}'\n"

    if direct_users:
        users_str = ", ".join(f"'{u}'" for u in direct_users)
        where += f"  AND [User Name] IN ({users_str})\n"

    if supervisor and supervisor != 'All':
        where += f"  AND [Supervisor Full Name] = '{supervisor}'\n"
    if shift and shift != 'All':
        where += f"  AND [SHIFT2] = '{shift}'\n"

    return where


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
# TOTAL UPH (Gauge widget)
# ============================================================

def get_total_uph(date_filter=None, supervisor=None, shift=None):
    """Returns dict with 'uph' and 'target_uph'."""
    print(f"[LMS] ─── Gauge: Total UPH ───")
    print(f"[LMS]   Filters: date={date_filter}, supervisor={supervisor}, shift={shift}")
    start = time.time()

    direct_users = get_direct_users()
    where = _build_where_clause(date_filter, supervisor, shift, direct_users)

    query = f"""
        SELECT
            CASE
                WHEN SUM([Line Day Activity]) = 0 THEN 0
                ELSE ROUND(
                    SUM(CAST([Quantity] AS FLOAT)) / SUM(CAST([Line Day Activity] AS FLOAT)) * 60,
                    0
                )
            END AS uph,
            CASE
                WHEN SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)) = 0 THEN 0
                ELSE ROUND(
                    SUM(CAST([Quantity] AS FLOAT)) / SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)),
                    0
                )
            END AS target_uph
        FROM ({_base_subquery()}) AS LMS
        {where}
    """

    df = run_query(query)
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   ✗ No data returned ({elapsed:.2f}s)")
        return {'uph': 0, 'target_uph': 0}

    result = {
        'uph': int(df['uph'].iloc[0] or 0),
        'target_uph': int(df['target_uph'].iloc[0] or 0),
    }
    print(f"[LMS]   ✓ UPH={result['uph']}, Target={result['target_uph']} ({elapsed:.2f}s)")
    return result


# ============================================================
# KPI CARDS (UPH %, Actual Time, Standard Time, Productivity)
# ============================================================

def get_kpi_data(date_filter=None, supervisor=None, shift=None):
    """
    Returns dict with uph_percent, actual_time, standard_time, productivity.
    """
    print(f"[LMS] ─── KPI Cards ───")
    print(f"[LMS]   Filters: date={date_filter}, supervisor={supervisor}, shift={shift}")
    start = time.time()

    direct_users = get_direct_users()
    where = _build_where_clause(date_filter, supervisor, shift, direct_users)

    query = f"""
        SELECT
            CASE
                WHEN SUM(CAST([Line Day Activity] AS FLOAT)) = 0 THEN 0
                WHEN SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)) = 0 THEN 0
                ELSE
                    (SUM(CAST([Quantity] AS FLOAT)) / (SUM(CAST([Line Day Activity] AS FLOAT)) / 60.0))
                    /
                    (SUM(CAST([Quantity] AS FLOAT)) / SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)))
            END AS uph_percent,
            ROUND(SUM(CAST([Line Day Activity] AS FLOAT)) / 60.0, 2) AS actual_time,
            ROUND(SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)), 2) AS standard_time
        FROM ({_base_subquery()}) AS LMS
        {where}
    """

    df = run_query(query)
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   ✗ No data returned ({elapsed:.2f}s)")
        return {'uph_percent': 0, 'actual_time': 0, 'standard_time': 0, 'productivity': 0}

    uph_percent = round((df['uph_percent'].iloc[0] or 0) * 100)
    actual_time = round(float(df['actual_time'].iloc[0] or 0), 2)
    standard_time = round(float(df['standard_time'].iloc[0] or 0), 2)

    if standard_time > 0:
        productivity = round((actual_time / standard_time - 1) * 100)
    else:
        productivity = 0

    print(f"[LMS]   ✓ UPH%={uph_percent}%, Actual={actual_time}h, Standard={standard_time}h, Productivity={productivity}% ({elapsed:.2f}s)")
    return {
        'uph_percent': uph_percent,
        'actual_time': actual_time,
        'standard_time': standard_time,
        'productivity': productivity,
    }


# ============================================================
# CHART: Quantity by Process
# ============================================================
# Power BI: Axis = [Movement], Values = SUM(Quantity)
# Same base filters apply (Activity Type, Movement exclusions,
# Process exclusions, Employee Type, Date)
# ============================================================

def get_quantity_by_process(date_filter=None, supervisor=None, shift=None):
    """
    Returns dict of {movement_name: total_quantity} sorted by quantity DESC.
    """
    print(f"[LMS] ─── Chart: Quantity by Process ───")
    start = time.time()

    direct_users = get_direct_users()
    where = _build_where_clause(date_filter, supervisor, shift, direct_users)

    query = f"""
        SELECT
            [Movement],
            SUM(CAST([Quantity] AS INT)) AS total_quantity
        FROM ({_base_subquery()}) AS LMS
        {where}
        GROUP BY [Movement]
        ORDER BY total_quantity DESC
    """

    df = run_query(query)
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   ✗ No data returned ({elapsed:.2f}s)")
        return {}

    result = dict(zip(df['Movement'], df['total_quantity']))
    print(f"[LMS]   ✓ {len(result)} movements: {result} ({elapsed:.2f}s)")
    return result


# ============================================================
# MAIN SUMMARY (aggregates all widgets)
# ============================================================

def get_summary_data(supervisor='All', week='All', shift='All', date_filter=None):
    """
    Returns a dict with all data needed for the Summary dashboard.
    """
    if not date_filter:
        date_filter = date.today().strftime('%Y-%m-%d')

    print(f"\n{'='*60}")
    print(f"[LMS] DASHBOARD REQUEST — Date: {date_filter}")
    print(f"[LMS]   Supervisor: {supervisor} | Shift: {shift} | Week: {week}")
    print(f"{'='*60}")

    # --- LIVE DATA: Total UPH ---
    try:
        uph_data = get_total_uph(date_filter, supervisor, shift)
        total_uph = uph_data['uph']
        uph_target = uph_data['target_uph']
    except Exception as e:
        print(f"[LMS]   ✗ SQL Server error (UPH): {e}")
        total_uph = 0
        uph_target = 0

    # --- LIVE DATA: KPI Cards ---
    try:
        kpi = get_kpi_data(date_filter, supervisor, shift)
        uph_percent = kpi['uph_percent']
        actual_time = kpi['actual_time']
        standard_time = kpi['standard_time']
        productivity = kpi['productivity']
    except Exception as e:
        print(f"[LMS]   ✗ SQL Server error (KPI): {e}")
        uph_percent = 0
        actual_time = 0
        standard_time = 0
        productivity = 0

    # --- LIVE DATA: Quantity by Process chart ---
    try:
        quantity_by_process = get_quantity_by_process(date_filter, supervisor, shift)
    except Exception as e:
        print(f"[LMS]   ✗ SQL Server error (Qty by Process): {e}")
        quantity_by_process = {}

    print(f"[LMS] ─── Remaining charts: Using SAMPLE data ───")
    print(f"{'='*60}\n")

    data = {
        'total_uph': total_uph,
        'uph_target': uph_target,
        'uph_percent': uph_percent,
        'actual_time': actual_time,
        'standard_time': standard_time,
        'productivity': productivity,
        'quantity_by_process': quantity_by_process,
        'uph_vs_target_by_process': {  # TODO: wire up
            'REPLENISHMENT': 254,
            'PUTAWAY': 123,
            'PICKING': 118,
            'PACKING': 89,
            'RECEIVING': 81,
        },
        'productivity_by_process': {   # TODO: wire up
            'REPLENISHMENT': -61,
            'PUTAWAY': -19,
            'PICKING': -16,
            'PACKING': 13,
            'RECEIVING': 24,
        },
        'filters': {
            'supervisors': ['All'],  # TODO: populate from DB
            'weeks': ['All'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
    }
    return data
