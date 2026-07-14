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
    roles_str = ", ".join(f"'{r}'" for r in DIRECT_ROLES)

    query = f"""
        SELECT ISNULL([Alias_SAP], CAST([EE_ID] AS VARCHAR(50))) AS [User]
        FROM [Business_Intelligence].[dbo].[MX03_Roster]
        WHERE CAST([Active_YN] AS VARCHAR(MAX)) = 'SI'
          AND [Estacion_de_Trabajo] IN ({roles_str})
    """

    df = run_query(query)
    return set(df['User'].dropna().str.strip().tolist())


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
# DAX: UPH = SUM(Quantity) / SUM([Line Day Activity]) * 60
# DAX: Target_UPH = SUM(Quantity) / SUM(Quantity / Target)
# ============================================================

def get_total_uph(date_filter=None, supervisor=None, shift=None):
    """Returns dict with 'uph' and 'target_uph'."""
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
    if df.empty:
        return {'uph': 0, 'target_uph': 0}

    return {
        'uph': int(df['uph'].iloc[0] or 0),
        'target_uph': int(df['target_uph'].iloc[0] or 0),
    }


# ============================================================
# KPI CARDS (UPH %, Actual Time, Standard Time, Productivity)
# ============================================================
# UPH % (Avg %):
#   = UPH / Target_UPH for the selected date
#   Note: DAX uses ALL(lms[Date]) but slicer filters on Date3,
#   so ALL(Date) doesn't actually remove the filter. Result = UPH/Target.
#
# Actual Time (Duration):
#   = SUM([Line Day Activity]) / 60   (hours)
#
# Standard Time (Target_Time):
#   = SUM(Quantity / Target)           (hours)
#
# Productivity:
#   = Actual Time / Standard Time - 1
# ============================================================

def get_kpi_data(date_filter=None, supervisor=None, shift=None):
    """
    Returns dict with uph_percent, actual_time, standard_time, productivity.
    All KPIs use the same date filter (matching Power BI behavior).
    """
    direct_users = get_direct_users()

    # All KPIs use the same WHERE (including date filter)
    where = _build_where_clause(date_filter, supervisor, shift, direct_users)

    # Single query for all KPI values
    query = f"""
        SELECT
            -- UPH % = UPH / Target_UPH
            CASE
                WHEN SUM(CAST([Line Day Activity] AS FLOAT)) = 0 THEN 0
                WHEN SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)) = 0 THEN 0
                ELSE
                    (SUM(CAST([Quantity] AS FLOAT)) / (SUM(CAST([Line Day Activity] AS FLOAT)) / 60.0))
                    /
                    (SUM(CAST([Quantity] AS FLOAT)) / SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)))
            END AS uph_percent,
            -- Actual Time = SUM(Line Day Activity) / 60
            ROUND(SUM(CAST([Line Day Activity] AS FLOAT)) / 60.0, 2) AS actual_time,
            -- Standard Time = SUM(Quantity / Target)
            ROUND(SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)), 2) AS standard_time
        FROM ({_base_subquery()}) AS LMS
        {where}
    """

    df = run_query(query)

    if df.empty:
        return {'uph_percent': 0, 'actual_time': 0, 'standard_time': 0, 'productivity': 0}

    # Parse results
    uph_percent = round((df['uph_percent'].iloc[0] or 0) * 100)
    actual_time = round(float(df['actual_time'].iloc[0] or 0), 2)
    standard_time = round(float(df['standard_time'].iloc[0] or 0), 2)

    # Productivity = Actual / Standard - 1
    if standard_time > 0:
        productivity = round((actual_time / standard_time - 1) * 100)
    else:
        productivity = 0

    return {
        'uph_percent': uph_percent,
        'actual_time': actual_time,
        'standard_time': standard_time,
        'productivity': productivity,
    }


# ============================================================
# MAIN SUMMARY (aggregates all widgets)
# ============================================================

def get_summary_data(supervisor='All', week='All', shift='All', date_filter=None):
    """
    Returns a dict with all data needed for the Summary dashboard.
    Total UPH + KPI cards are live; charts remain sample data.
    """
    if not date_filter:
        date_filter = date.today().strftime('%Y-%m-%d')

    # --- LIVE DATA: Total UPH ---
    try:
        uph_data = get_total_uph(date_filter, supervisor, shift)
        total_uph = uph_data['uph']
        uph_target = uph_data['target_uph']
    except Exception as e:
        print(f"[LMS] SQL Server error (UPH): {e}")
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
        print(f"[LMS] SQL Server error (KPI): {e}")
        uph_percent = 0
        actual_time = 0
        standard_time = 0
        productivity = 0

    # --- SAMPLE DATA (charts — will replace next) ---
    data = {
        'total_uph': total_uph,
        'uph_target': uph_target,
        'uph_percent': uph_percent,
        'actual_time': actual_time,
        'standard_time': standard_time,
        'productivity': productivity,
        'quantity_by_process': {
            'PICKING': 27000,
            'PUTAWAY': 25000,
            'REPLENISHMENT': 17000,
            'RECEIVING': 9000,
            'PACKING': 4000,
        },
        'uph_vs_target_by_process': {
            'REPLENISHMENT': 254,
            'PUTAWAY': 123,
            'PICKING': 118,
            'PACKING': 89,
            'RECEIVING': 81,
        },
        'productivity_by_process': {
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
