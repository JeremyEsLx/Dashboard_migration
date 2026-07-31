"""Shared service utilities for all LMS dashboard pages.

This module contains the foundational infrastructure used by ALL service files:
- Connection pooling (pyodbc)
- run_query() — execute SQL and return DataFrame
- get_direct_users() — cached DIRECT employee list
- format_name() — normalize names from SQL
- _base_subquery() — base SELECT with SHIFT2 computed column
- BASE_FILTERS — standard WHERE clause for most pages
- Date range builders
- get_filter_options() — cached dropdown values

Other service files should import from here:
    from .services_base import run_query, get_direct_users, ...
"""
import pyodbc
import pandas as pd
from django.conf import settings
from datetime import date, timedelta
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import threading


# ============================================================
# DATABASE CONNECTION POOL
# ============================================================

_pool_lock = threading.Lock()
_connection_pool = []
_POOL_MAX_SIZE = 4


def _build_conn_str():
    return (
        f"DRIVER={settings.SQL_DRIVER};"
        f"SERVER={settings.SQL_SERVER};"
        f"DATABASE={settings.SQL_DATABASE};"
        f"UID={settings.SQL_USERNAME};"
        f"PWD={settings.SQL_PASSWORD};"
        f"TrustServerCertificate=yes;"
    )


def get_connection():
    """Get a connection from the pool (or create one if pool is empty)."""
    with _pool_lock:
        if _connection_pool:
            conn = _connection_pool.pop()
            try:
                conn.execute('SELECT 1')
                return conn
            except Exception:
                try:
                    conn.close()
                except Exception:
                    pass
    return pyodbc.connect(_build_conn_str())


def _return_connection(conn):
    """Return a connection to the pool for reuse."""
    with _pool_lock:
        if len(_connection_pool) < _POOL_MAX_SIZE:
            _connection_pool.append(conn)
        else:
            try:
                conn.close()
            except Exception:
                pass


def run_query(query: str) -> pd.DataFrame:
    """Execute a SQL query and return results as a DataFrame (pooled connection)."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        _return_connection(conn)
        return pd.DataFrame.from_records(rows, columns=columns)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
        raise


# ============================================================
# NAME FORMATTING HELPER
# ============================================================

def format_name(name):
    """Format Full Name: remove comma, Title Case.

    'ADELA, MANUEL PARRA' -> 'Adela Manuel Parra'
    """
    if not name:
        return name
    return name.replace(',', '').title()


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
    print("[LMS] --- Loading DIRECT users from Headcount ---")
    start = time.time()

    roles_str = ", ".join(f"'{r}'" for r in DIRECT_ROLES)
    query = f"""
        SELECT ISNULL([Alias_SAP], CAST([EE_ID] AS VARCHAR(50))) AS [User]
        FROM [Business_Intelligence].[dbo].[MX03_Roster] WITH (NOLOCK)
        WHERE CAST([Active_YN] AS VARCHAR(MAX)) = 'SI'
          AND [Estacion_de_Trabajo] IN ({roles_str})
    """
    df = run_query(query)
    users = set(df['User'].dropna().str.strip().tolist())

    elapsed = time.time() - start
    print(f"[LMS]   Found {len(users)} DIRECT users ({elapsed:.2f}s)")
    print(f"[LMS]   (cached - won't query again until server restart)")
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
        FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    """


def _build_date_where(date_filter=None, week=None):
    """WHERE clause builder for single-date or week filtering (Summary)."""
    where = BASE_FILTERS
    if date_filter:
        where += f"  AND CAST([Date] AS DATE) = '{date_filter}'\n"
    elif week and week != 'All':
        where += f"  AND [Fiscal Week] = '{week}'\n"
    return where


def _build_date_range_where(date_from=None, date_to=None, week=None):
    """WHERE clause builder for date-range or week filtering (Performance)."""
    where = BASE_FILTERS
    if date_from and date_to:
        where += f"  AND CAST([Date] AS DATE) >= '{date_from}'\n"
        where += f"  AND CAST([Date] AS DATE) <= '{date_to}'\n"
    elif date_from:
        where += f"  AND CAST([Date] AS DATE) >= '{date_from}'\n"
    elif date_to:
        where += f"  AND CAST([Date] AS DATE) <= '{date_to}'\n"
    elif week and week != 'All':
        where += f"  AND [Fiscal Week] = '{week}'\n"
    return where


def default_date_range(days=21):
    """Default date range: today minus N days to today."""
    today = date.today()
    date_from = today - timedelta(days=days)
    return str(date_from), str(today)


# ============================================================
# FILTER OPTIONS (populate dropdowns - TTL cached 1 hour)
# ============================================================

_filter_cache = {'data': None, 'timestamp': 0}
_FILTER_CACHE_TTL = 3600  # 1 hour


def get_filter_options():
    """Fetch distinct Supervisor, Week, and Process values (cached 1 hour)."""
    now = time.time()
    if _filter_cache['data'] and (now - _filter_cache['timestamp']) < _FILTER_CACHE_TTL:
        return _filter_cache['data']

    print("[LMS] --- Loading filter options (sequential) ---")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    supervisors = ['All']
    weeks = ['All']
    processes = ['All']

    try:
        df_sup = run_query(f"""
            SELECT DISTINCT [Supervisor Full Name]
            FROM ({_base_subquery()}) AS LMS
            {BASE_FILTERS}
              AND [User Name] IN ({users_str})
              AND [Supervisor Full Name] IS NOT NULL
              AND [Supervisor Full Name] != ''
            ORDER BY [Supervisor Full Name]
        """)
        supervisors = ['All'] + df_sup['Supervisor Full Name'].tolist()
    except Exception as e:
        print(f"[LMS]   Supervisor query failed: {e}")

    try:
        df_week = run_query(f"""
            SELECT DISTINCT [Fiscal Week]
            FROM ({_base_subquery()}) AS LMS
            {BASE_FILTERS}
              AND [User Name] IN ({users_str})
              AND [Fiscal Week] IS NOT NULL
              AND [Fiscal Week] != ''
            ORDER BY [Fiscal Week] DESC
        """)
        weeks = ['All'] + df_week['Fiscal Week'].tolist()
    except Exception as e:
        print(f"[LMS]   Week query failed: {e}")

    try:
        df_proc = run_query(f"""
            SELECT DISTINCT [Process]
            FROM ({_base_subquery()}) AS LMS
            {BASE_FILTERS}
              AND [User Name] IN ({users_str})
              AND [Process] IS NOT NULL
              AND [Process] != ''
            ORDER BY [Process]
        """)
        processes = ['All'] + df_proc['Process'].tolist()
    except Exception as e:
        print(f"[LMS]   Process query failed: {e}")

    result = {'supervisors': supervisors, 'weeks': weeks, 'processes': processes}
    if len(supervisors) > 1 or len(weeks) > 1 or len(processes) > 1:
        _filter_cache['data'] = result
        _filter_cache['timestamp'] = time.time()

    elapsed = time.time() - start
    print(f"[LMS]   {len(supervisors)-1} supervisors, {len(weeks)-1} weeks, "
          f"{len(processes)-1} processes ({elapsed:.2f}s)")
    return result
