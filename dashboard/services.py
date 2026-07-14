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
# Power BI: Employee Type = SWITCH on Headcount[Estacion_de_Trabajo]
# Source: [Business_Intelligence].[dbo].[MX03_Roster]
# Join: LMS[User Name] = Headcount[User]
#   where User = ISNULL([Alias_SAP], CAST([EE_ID] AS VARCHAR(50)))
# Filter: Active_YN = 'SI' AND Estacion_de_Trabajo IN (DIRECT roles)
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
    Fetch the list of DIRECT employee usernames from the BI Roster table.
    Cached for the lifetime of the process (restart server to refresh).
    Uses cross-database query (same server).
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
# BASE QUERY WITH FILTERS (mirrors Power BI slicers)
# ============================================================
# Filters applied to Total UPH visual:
#   - Activity Type = 'DIRECT'
#   - Date3 (= [Date]) = selected date
#   - Employee Type = 'DIRECT' (via Headcount join on User Name)
#   - Movement NOT IN ('BIN2BIN', 'LOST&FOUND', 'RECASE', 'HOUSEKEEPING')
#   - Process NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')
# ============================================================

BASE_FILTERS = """
    WHERE [Activity Type] = 'DIRECT'
      AND [Movement] NOT IN ('BIN2BIN', 'LOST&FOUND', 'RECASE', 'HOUSEKEEPING')
      AND [Process] NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')
"""


def _build_where_clause(date_filter=None, supervisor=None, shift=None, direct_users=None):
    """Build the WHERE clause with base filters + optional slicer filters."""
    where = BASE_FILTERS

    # Date filter (Date3 = [Date] column)
    if date_filter:
        where += f"  AND CAST([Date] AS DATE) = '{date_filter}'\n"

    # Employee Type = DIRECT filter (via Headcount User lookup)
    if direct_users:
        users_str = ", ".join(f"'{u}'" for u in direct_users)
        where += f"  AND [User Name] IN ({users_str})\n"

    # Optional slicer filters
    if supervisor and supervisor != 'All':
        where += f"  AND [Supervisor Full Name] = '{supervisor}'\n"
    if shift and shift != 'All':
        where += f"  AND [SHIFT2] = '{shift}'\n"

    return where


def _base_subquery():
    """The base SELECT with the SHIFT2 computed column."""
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
#   - [Line Day Activity] is in MINUTES, *60 converts to per-hour
#
# DAX: Target_UPH = SUM(Quantity) / SUM(Target_Time)
#   - Target_Time = IF(Target=0, 0.0000001, Quantity / Target)
#   - So: Target_UPH = SUM(Quantity) / SUM(Quantity / Target)
# ============================================================

def get_total_uph(date_filter=None, supervisor=None, shift=None):
    """
    Returns dict with 'uph' (gauge value) and 'target_uph' (blue marker).
    """
    # Get DIRECT users from Headcount (cached after first call)
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
# MAIN SUMMARY (aggregates all widgets)
# ============================================================

def get_summary_data(supervisor='All', week='All', shift='All', date_filter=None):
    """
    Returns a dict with all data needed for the Summary dashboard.
    Currently only Total UPH is live; others remain sample data.
    """
    # Use today's date if none provided (ISO format for SQL Server)
    if not date_filter:
        date_filter = date.today().strftime('%Y-%m-%d')

    # --- LIVE DATA: Total UPH ---
    try:
        uph_data = get_total_uph(date_filter, supervisor, shift)
        total_uph = uph_data['uph']
        uph_target = uph_data['target_uph']
    except Exception as e:
        # Fallback to 0 if SQL Server is unreachable
        print(f"[LMS] SQL Server error: {e}")
        total_uph = 0
        uph_target = 0

    # --- SAMPLE DATA (remaining widgets — will replace one by one) ---
    data = {
        'total_uph': total_uph,
        'uph_target': uph_target,
        'uph_percent': 124,
        'actual_time': 352.94,
        'standard_time': 436.19,
        'productivity': -19,
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
