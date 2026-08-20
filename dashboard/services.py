"""Data service layer — page-specific queries for Summary, Performance, Process,
Strong Start, Strong Finish, and No Activity pages.

Shared utilities (pool, run_query, get_direct_users, etc.) live in services_base.py.
This file imports them and defines page-specific cube/data functions.
"""
import json
from datetime import date, timedelta
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
import time

# Shared utilities (re-exported for backward compatibility)
from .services_base import (
    run_query, get_connection, _return_connection,
    get_direct_users, format_name, DIRECT_ROLES,
    _base_subquery, BASE_FILTERS,
    _build_date_where, _build_date_range_where,
    get_filter_options,
)











@lru_cache(maxsize=1)
def get_direct_users() -> set:
    """Fetch DIRECT employee usernames from BI Roster (cached)."""
    print("[LMS] ─── Loading DIRECT users from Headcount ───")
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
        FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    """


def _build_date_where(date_filter=None, week=None):
    """WHERE clause builder for single-date or week filtering (Summary).

    Returns:
        (where_clause_str, params_tuple)
    """
    where = BASE_FILTERS
    params = []
    if date_filter:
        where += "  AND CAST([Date] AS DATE) = ?\n"
        params.append(date_filter)
    elif week and week != 'All':
        where += "  AND [Fiscal Week] = ?\n"
        params.append(week)
    return where, tuple(params)


def _build_date_range_where(date_from=None, date_to=None, week=None):
    """WHERE clause builder for date-range or week filtering (Performance).

    Returns:
        (where_clause_str, params_tuple)
    """
    where = BASE_FILTERS
    params = []
    if date_from and date_to:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        where += "  AND CAST([Date] AS DATE) <= ?\n"
        params.extend([date_from, date_to])
    elif date_from:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        params.append(date_from)
    elif date_to:
        where += "  AND CAST([Date] AS DATE) <= ?\n"
        params.append(date_to)
    elif week and week != 'All':
        where += "  AND [Fiscal Week] = ?\n"
        params.append(week)
    return where, tuple(params)


# ============================================================
# FILTER OPTIONS (populate dropdowns — TTL cached 1 hour)
# ============================================================

_filter_cache = {'data': None, 'timestamp': 0}
_FILTER_CACHE_TTL = 3600  # 1 hour


def get_filter_options():
    """Fetch distinct Supervisor, Week, and Process values (cached 1 hour).
    Runs 3 sequential queries (simple, no nested threading)."""
    now = time.time()
    if _filter_cache['data'] and (now - _filter_cache['timestamp']) < _FILTER_CACHE_TTL:
        return _filter_cache['data']

    print("[LMS] ─── Loading filter options (sequential) ───")
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
        print(f"[LMS]   ✗ Supervisor query failed: {e}")

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
        print(f"[LMS]   ✗ Week query failed: {e}")

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
        print(f"[LMS]   ✗ Process query failed: {e}")

    result = {'supervisors': supervisors, 'weeks': weeks, 'processes': processes}
    if len(supervisors) > 1 or len(weeks) > 1 or len(processes) > 1:
        _filter_cache['data'] = result
        _filter_cache['timestamp'] = time.time()

    elapsed = time.time() - start
    print(f"[LMS]   ✓ {len(supervisors)-1} supervisors, {len(weeks)-1} weeks, "
          f"{len(processes)-1} processes ({elapsed:.2f}s)")
    return result


# ============================================================
# DAY CUBE — one query, all the data for the selected date/week
# ============================================================

def get_day_cube(date_filter=None, week=None):
    """One SQL query that returns all aggregated data for the date OR week."""
    print(f"[LMS] ─── Loading Day Cube ───")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    where, params = _build_date_where(date_filter, week)
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

    df = run_query(query, params)
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

    # Run filter options and cube query in PARALLEL
    filter_options = {'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All']}
    cube = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        future_filters = executor.submit(get_filter_options)
        future_cube = executor.submit(get_day_cube, date_filter, effective_week)
        try:
            filter_options = future_filters.result(timeout=30)
        except Exception as e:
            print(f"[LMS]   ✗ SQL Server error (Filters): {e}")
        try:
            cube = future_cube.result(timeout=30)
        except Exception as e:
            print(f"[LMS]   ✗ SQL Server error (Cube): {e}")

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

def get_performance_cube(date_from=None, date_to=None, week=None):
    """Query grouped by Process, Flow_Type_Map, Cart_Type, Supervisor, Shift."""
    print(f"[LMS] ─── Loading Performance Cube ───")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    where, params = _build_date_range_where(date_from, date_to, week)
    where += f"  AND [User Name] IN ({users_str})\n"

    if date_from and date_to:
        print(f"[LMS]   Mode: DATE RANGE = {date_from} → {date_to}")
    elif date_from:
        print(f"[LMS]   Mode: DATE FROM = {date_from}")
    elif week and week != 'All':
        print(f"[LMS]   Mode: WEEK = {week}")
    else:
        print(f"[LMS]   Mode: NO DATE FILTER")

    query = f"""
        SELECT
            ISNULL([Process], '') AS [process],
            ISNULL([Flow_Type_Map], '') AS [flow_type],
            ISNULL([Cart Type], '') AS [cart_type],
            [Supervisor Full Name] AS supervisor,
            [SHIFT2] AS shift,
            SUM(CAST([Quantity] AS FLOAT)) AS sum_qty,
            SUM(CAST([Line Day Activity] AS FLOAT)) AS sum_line_day,
            SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)) AS sum_target_time
        FROM ({_base_subquery()}) AS LMS
        {where}
        GROUP BY [Process], [Flow_Type_Map], [Cart Type],
                 [Supervisor Full Name], [SHIFT2]
    """

    df = run_query(query, params)
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
            's': row['supervisor'] or '',
            'sh': row['shift'] or '',
            'q': round(float(row['sum_qty'] or 0), 2),
            'ld': round(float(row['sum_line_day'] or 0), 4),
            'tt': round(float(row['sum_target_time'] or 0), 4),
        })

    print(f"[LMS]   ✓ {len(cube)} rows in performance cube ({elapsed:.2f}s)")
    return cube


# ============================================================
# PERFORMANCE BY USER — User-level cube
# ============================================================

def get_user_cube(date_from=None, date_to=None, week=None):
    """
    Query grouped by User Name + Process (for Process filter support).
    Also includes Supervisor, Shift for client-side filtering.
    """
    print(f"[LMS] ─── Loading User Cube ───")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    where, params = _build_date_range_where(date_from, date_to, week)
    where += f"  AND [User Name] IN ({users_str})\n"

    query = f"""
        SELECT
            [User Name] AS [user_name],
            ISNULL([Process], '') AS [process],
            [Supervisor Full Name] AS supervisor,
            [SHIFT2] AS shift,
            SUM(CAST([Quantity] AS FLOAT)) AS sum_qty,
            SUM(CAST([Line Day Activity] AS FLOAT)) AS sum_line_day,
            SUM(CAST([Quantity] AS FLOAT) / NULLIF(CAST([Target] AS FLOAT), 0)) AS sum_target_time
        FROM ({_base_subquery()}) AS LMS
        {where}
        GROUP BY [User Name], [Process], [Supervisor Full Name], [SHIFT2]
    """

    df = run_query(query, params)
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   ✗ No user data returned ({elapsed:.2f}s)")
        return []

    cube = []
    for _, row in df.iterrows():
        cube.append({
            'u': row['user_name'] or '',
            'p': row['process'] or '',
            's': row['supervisor'] or '',
            'sh': row['shift'] or '',
            'q': round(float(row['sum_qty'] or 0), 2),
            'ld': round(float(row['sum_line_day'] or 0), 4),
            'tt': round(float(row['sum_target_time'] or 0), 4),
        })

    print(f"[LMS]   ✓ {len(cube)} rows in user cube ({elapsed:.2f}s)")
    return cube


# ============================================================
# PERFORMANCE PAGE — Main data function
# ============================================================

def get_performance_data(supervisor='All', week='All', process='All',
                         shift='All', date_from=None, date_to=None):
    """Returns all data for the Performance by User page."""
    if date_from or date_to:
        effective_week = 'All'
        if not date_to:
            date_to = date.today().strftime('%Y-%m-%d')
        if not date_from:
            date_from = date_to
    elif week and week != 'All':
        effective_week = week
        date_from = None
        date_to = None
    else:
        # Default: current week (Monday → today)
        today = date.today()
        monday = today - timedelta(days=today.weekday())  # weekday(): Mon=0
        date_from = monday.strftime('%Y-%m-%d')
        date_to = today.strftime('%Y-%m-%d')
        effective_week = 'All'

    print(f"\n{'='*60}")
    print(f"[LMS] PERFORMANCE REQUEST")
    print(f"[LMS]   Date Range: {date_from or '(none)'} → {date_to or '(none)'} | "
          f"Week: {effective_week} | Supervisor: {supervisor} | "
          f"Process: {process} | Shift: {shift}")
    print(f"{'='*60}")

    # Run ALL 3 queries in PARALLEL (filters + process cube + user cube)
    filter_options = {'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All']}
    cube = []
    user_cube = []
    with ThreadPoolExecutor(max_workers=3) as executor:
        future_filters = executor.submit(get_filter_options)
        future_cube = executor.submit(get_performance_cube, date_from, date_to, effective_week)
        future_users = executor.submit(get_user_cube, date_from, date_to, effective_week)
        try:
            filter_options = future_filters.result(timeout=45)
        except Exception as e:
            print(f"[LMS]   ✗ SQL Server error (Filters): {e}")
        try:
            cube = future_cube.result(timeout=45)
        except Exception as e:
            print(f"[LMS]   ✗ SQL Server error (Performance Cube): {e}")
        try:
            user_cube = future_users.result(timeout=45)
        except Exception as e:
            print(f"[LMS]   ✗ SQL Server error (User Cube): {e}")

    print(f"{'='*60}\n")

    return {
        'cube_json': json.dumps(cube),
        'user_cube_json': json.dumps(user_cube),
        'filters': {
            'supervisors': filter_options['supervisors'],
            'weeks': filter_options['weeks'],
            'processes': filter_options['processes'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'supervisor': supervisor,
            'week': effective_week,
            'process': process,
            'shift': shift,
            'date_from': date_from or '',
            'date_to': date_to or '',
        },
    }


# ============================================================
# PERFORMANCE BY PROCESS PAGE — Main data function
# ============================================================

def get_process_data(week='All', process='All', shift='All',
                     date_from=None, date_to=None):
    """Returns process cube data for the Performance by Process page.
    Same cube as Performance by User but skips the user cube query (faster).
    """
    if date_from or date_to:
        effective_week = 'All'
        if not date_to:
            date_to = date.today().strftime('%Y-%m-%d')
        if not date_from:
            date_from = date_to
    elif week and week != 'All':
        effective_week = week
        date_from = None
        date_to = None
    else:
        # Default: current week (Monday -> today)
        today = date.today()
        monday = today - timedelta(days=today.weekday())
        date_from = monday.strftime('%Y-%m-%d')
        date_to = today.strftime('%Y-%m-%d')
        effective_week = 'All'

    print(f"\n{'='*60}")
    print(f"[LMS] PROCESS PERFORMANCE REQUEST")
    print(f"[LMS]   Date Range: {date_from or '(none)'} -> {date_to or '(none)'} | "
          f"Week: {effective_week} | Process: {process} | Shift: {shift}")
    print(f"{'='*60}")

    # Run filter options and cube in PARALLEL
    filter_options = {'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All']}
    cube = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        future_filters = executor.submit(get_filter_options)
        future_cube = executor.submit(get_performance_cube, date_from, date_to, effective_week)
        try:
            filter_options = future_filters.result(timeout=30)
        except Exception as e:
            print(f"[LMS]   x SQL Server error (Filters): {e}")
        try:
            cube = future_cube.result(timeout=30)
        except Exception as e:
            print(f"[LMS]   x SQL Server error (Process Cube): {e}")

    print(f"{'='*60}\n")

    return {
        'cube_json': json.dumps(cube),
        'filters': {
            'weeks': filter_options['weeks'],
            'processes': filter_options['processes'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'week': effective_week,
            'process': process,
            'shift': shift,
            'date_from': date_from or '',
            'date_to': date_to or '',
        },
    }


# ============================================================
# STRONG START PAGE — Detail-level cube (Date, User, Process, Shift, Supervisor)
# ============================================================

def get_strongstart_cube(date_from=None, date_to=None, week=None):
    """Query at user/date/process granularity for Strong Start page.
    
    Power BI filters for this page:
      - Activity Type = 'DIRECT'
      - Employee Type = DIRECT (via roster join)
      - Previous Process = 'CLOCK IN' (first activity after clock-in)
      - Process NOT IN ('CLOCK IN', 'CLOCK OUT')
    
    NOTE: Does NOT use BASE_FILTERS (no Movement exclusion needed here).
    """
    print(f"[LMS] ─── Loading Strong Start Cube ───")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    # Custom WHERE clause matching Power BI's Strong Start filters
    where = """
    WHERE [Activity Type] = 'DIRECT'
      AND [Previous Process] = 'CLOCK IN'
      AND [Process] NOT IN ('CLOCK IN', 'CLOCK OUT')
"""
    params = []
    if date_from and date_to:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        where += "  AND CAST([Date] AS DATE) <= ?\n"
        params.extend([date_from, date_to])
        print(f"[LMS]   Mode: DATE RANGE = {date_from} -> {date_to}")
    elif date_from:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        params.append(date_from)
        print(f"[LMS]   Mode: DATE FROM = {date_from}")
    elif date_to:
        where += "  AND CAST([Date] AS DATE) <= ?\n"
        params.append(date_to)
        print(f"[LMS]   Mode: DATE TO = {date_to}")
    else:
        print(f"[LMS]   Mode: NO DATE FILTER")

    where += f"  AND [User Name] IN ({users_str})\n"

    print(f"[LMS]   Query version: v4 — DATEPART extraction, no CONVERT")

    query = f"""
        SELECT
            CONVERT(VARCHAR(10), CAST([Date] AS DATE), 23) AS [date],
            [User Name] AS [user_name],
            ISNULL([Full Name], [User Name]) AS [full_name],
            [Supervisor Full Name] AS [supervisor],
            ISNULL([Process], '') AS [process],
            [SHIFT2] AS [shift],
            CASE [SHIFT2]
                WHEN 'A' THEN '6:00:00 AM'
                WHEN 'B' THEN '6:00:00 PM'
                WHEN 'C' THEN '10:00:00 PM'
                WHEN 'D' THEN '2:00:00 AM'
                ELSE ''
            END AS [clock_in_time],
            SUM(CAST([Line Day Activity] AS FLOAT)) AS sum_line_day,
            CONVERT(VARCHAR(8), MIN(CAST([Time] AS TIME)), 108) AS [first_scan_time]
        FROM ({_base_subquery()}) AS LMS
        {where}
        GROUP BY CAST([Date] AS DATE), CONVERT(VARCHAR(10), CAST([Date] AS DATE), 23),
                 [User Name], [Full Name], [Supervisor Full Name], [Process], [SHIFT2]
        ORDER BY CAST([Date] AS DATE) DESC, [User Name]
    """

    df = run_query(query, tuple(params))
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   x No data returned ({elapsed:.2f}s)")
        return []

    def _to_12h(val):
        """Convert 24-hour time string (e.g. '18:07:14') to '6:07:14 PM'."""
        if not val or str(val).strip() == '':
            return ''
        s = str(val).strip()
        if 'AM' in s.upper() or 'PM' in s.upper():
            return s
        try:
            parts = s.split(':')
            h = int(parts[0])
            m = int(parts[1]) if len(parts) > 1 else 0
            sec = int(parts[2].split('.')[0]) if len(parts) > 2 else 0
            period = 'AM' if h < 12 else 'PM'
            h12 = h % 12 or 12
            return f'{h12}:{m:02d}:{sec:02d} {period}'
        except Exception:
            return s

    cube = []
    for _, row in df.iterrows():
        cube.append({
            'd': row['date'] or '',
            'u': row['user_name'] or '',
            'fn': format_name(row['full_name'] or ''),
            's': row['supervisor'] or '',
            'p': row['process'] or '',
            'cit': row['clock_in_time'] or '',
            'fst': _to_12h(row['first_scan_time']),
            'sh': row['shift'] or '',
            'ld': round(float(row['sum_line_day'] or 0), 4),
        })

    print(f"[LMS]   Done {len(cube)} rows in strong start cube ({elapsed:.2f}s)")
    return cube


def get_strongstart_data(supervisor='All', shift='All',
                         date_from=None, date_to=None):
    """Returns data for the Strong Start page."""
    if date_from or date_to:
        if not date_to:
            date_to = date.today().strftime('%Y-%m-%d')
        if not date_from:
            date_from = date_to
    else:
        # Default: yesterday back 6 days (7-day window ending yesterday)
        yesterday = date.today() - timedelta(days=1)
        date_from = (yesterday - timedelta(days=6)).strftime('%Y-%m-%d')
        date_to = yesterday.strftime('%Y-%m-%d')

    print(f"\n{'='*60}")
    print(f"[LMS] STRONG START REQUEST")
    print(f"[LMS]   Date Range: {date_from or '(none)'} -> {date_to or '(none)'} | "
          f"Supervisor: {supervisor} | Shift: {shift}")
    print(f"{'='*60}")

    # Run filter options and cube in PARALLEL
    filter_options = {'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All']}
    cube = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        future_filters = executor.submit(get_filter_options)
        future_cube = executor.submit(get_strongstart_cube, date_from, date_to)
        try:
            filter_options = future_filters.result(timeout=30)
        except Exception as e:
            print(f"[LMS]   x SQL Server error (Filters): {e}")
        try:
            cube = future_cube.result(timeout=30)
        except Exception as e:
            print(f"[LMS]   x SQL Server error (Strong Start Cube): {type(e).__name__}: {e}")

    print(f"{'='*60}\n")

    return {
        'cube_json': json.dumps(cube),
        'filters': {
            'supervisors': filter_options['supervisors'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'supervisor': supervisor,
            'shift': shift,
            'date_from': date_from or '',
            'date_to': date_to or '',
        },
    }


# ============================================================
# STRONG FINISH CUBE
# ============================================================

def get_strongfinish_cube(date_from=None, date_to=None, week=None):
    """Query Strong Finish detail rows (no aggregation — matches Power BI detail table).

    Power BI filters:
      - Previous Process NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')
      - Process = 'CLOCK OUT'
      - Employee Type = DIRECT (via roster join → User Name IN)

    Columns from LMS table:
      [Previous Scan Day] → "Previous Scan time" (datetime of last productive scan)
      [Time] → "Time" (datetime of actual clock-out)
      Duration = [Line Day Activity] / 60
    """
    print(f"[LMS] ─── Loading Strong Finish Cube ───")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"\'{u}\'" for u in direct_users)

    where = """
    WHERE [Previous Process] NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')
      AND [Process] = 'CLOCK OUT'
"""
    params = []
    if date_from and date_to:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        where += "  AND CAST([Date] AS DATE) <= ?\n"
        params.extend([date_from, date_to])
        print(f"[LMS]   Mode: DATE RANGE = {date_from} -> {date_to}")
    elif date_from:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        params.append(date_from)
        print(f"[LMS]   Mode: DATE FROM = {date_from}")
    elif date_to:
        where += "  AND CAST([Date] AS DATE) <= ?\n"
        params.append(date_to)
        print(f"[LMS]   Mode: DATE TO = {date_to}")
    else:
        print(f"[LMS]   Mode: NO DATE FILTER")

    where += f"  AND [User Name] IN ({users_str})\n"

    print(f"[LMS]   Query version: v4 — DATEPART extraction, no CONVERT")

    query = f"""
        SELECT
            CONVERT(VARCHAR(10), CAST([Date] AS DATE), 23) AS [date],
            [User Name] AS [user_name],
            ISNULL([Full Name], [User Name]) AS [full_name],
            [Supervisor Full Name] AS [supervisor],
            ISNULL([Previous Process], '') AS [previous_process],
            [SHIFT2] AS [shift],
            ISNULL([Process], '') AS [process],
            CAST(DATEPART(HOUR, [Previous Scan Day]) AS VARCHAR) + ':' +
                RIGHT('0' + CAST(DATEPART(MINUTE, [Previous Scan Day]) AS VARCHAR), 2) + ':' +
                RIGHT('0' + CAST(DATEPART(SECOND, [Previous Scan Day]) AS VARCHAR), 2) AS [scan_time],
            CAST(DATEPART(HOUR, [Time]) AS VARCHAR) + ':' +
                RIGHT('0' + CAST(DATEPART(MINUTE, [Time]) AS VARCHAR), 2) + ':' +
                RIGHT('0' + CAST(DATEPART(SECOND, [Time]) AS VARCHAR), 2) AS [clock_out_time],
            CAST([Line Day Activity] AS FLOAT) AS [line_day]
        FROM ({_base_subquery()}) AS LMS
        {where}
        ORDER BY CAST([Date] AS DATE) DESC, [User Name]
    """

    df = run_query(query, tuple(params))
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   x No data returned ({elapsed:.2f}s)")
        return []

    def _fmt_time_12h(val):
        """Convert raw time/datetime value to 'h:mm:ss AM/PM' format."""
        if not val or str(val).strip() == '':
            return ''
        s = str(val).strip()
        # If it contains a date portion (e.g. 'Jul 13 2026  5:48PM' or '2026-07-13 17:48:02')
        # Extract time part
        if len(s) > 12:
            # Try common SQL Server default format: 'Mon dd yyyy hh:mmAM' or 'Mon dd yyyy  h:mm:ssPM'
            # or ISO format: '2026-07-13 17:48:02.000'
            if '-' in s[:10]:
                # ISO format: take after the space
                parts = s.split(' ')
                if len(parts) >= 2:
                    s = ' '.join(parts[1:])
            else:
                # SQL Server default: 'Jul 13 2026  5:48PM' — time is after year
                # Find the time portion (after the year and spaces)
                import re as _re
                m = _re.search(r'(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*[AP]M)', s, _re.IGNORECASE)
                if m:
                    return m.group(1).strip()
                # Try: everything after last double-space or after 4-digit year
                m2 = _re.search(r'\d{4}\s+(.*)', s)
                if m2:
                    s = m2.group(1).strip()
        # Remove fractional seconds
        if '.' in s:
            s = s.split('.')[0]
        # If already has AM/PM, return as-is
        if 'AM' in s.upper() or 'PM' in s.upper():
            return s.strip()
        # Parse HH:MM:SS (24-hour) and convert to 12-hour
        try:
            parts = s.split(':')
            h = int(parts[0])
            m = int(parts[1]) if len(parts) > 1 else 0
            sec = int(parts[2]) if len(parts) > 2 else 0
            period = 'AM' if h < 12 else 'PM'
            h12 = h % 12 or 12
            return f'{h12}:{m:02d}:{sec:02d} {period}'
        except Exception:
            return s

    cube = []
    for _, row in df.iterrows():
        cube.append({
            'd': row['date'] or '',
            'u': row['user_name'] or '',
            'fn': format_name(row['full_name'] or ''),
            's': row['supervisor'] or '',
            'pp': row['previous_process'] or '',
            'sh': row['shift'] or '',
            'pr': row['process'] or '',
            'st': _fmt_time_12h(row['scan_time']),
            'cot': _fmt_time_12h(row['clock_out_time']),
            'ld': round(float(row['line_day'] or 0), 4),
        })

    print(f"[LMS]   ✓ {len(cube)} rows in strong finish cube ({elapsed:.2f}s)")
    return cube


# ============================================================
# STRONG FINISH DATA (page-level orchestrator)
# ============================================================

def get_strongfinish_data(supervisor='All', shift='All',
                          date_from=None, date_to=None):
    """Returns data for the Strong Finish page."""  # noqa: E501
    if date_from or date_to:
        if not date_to:
            date_to = date.today().strftime('%Y-%m-%d')
        if not date_from:
            date_from = date_to
    else:
        # Default: yesterday back 6 days (7-day window ending yesterday)
        yesterday = date.today() - timedelta(days=1)
        date_from = (yesterday - timedelta(days=6)).strftime('%Y-%m-%d')
        date_to = yesterday.strftime('%Y-%m-%d')

    print(f"\n{'='*60}")
    print(f"[LMS] STRONG FINISH REQUEST")
    print(f"[LMS]   Date Range: {date_from or '(none)'} -> {date_to or '(none)'} | "
          f"Supervisor: {supervisor} | Shift: {shift}")
    print(f"{'='*60}")

    # Run filter options and cube in PARALLEL
    filter_options = {'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All']}
    cube = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        future_filters = executor.submit(get_filter_options)
        future_cube = executor.submit(get_strongfinish_cube, date_from, date_to)
        try:
            filter_options = future_filters.result(timeout=30)
        except Exception as e:
            print(f"[LMS]   x SQL Server error (Filters): {e}")
        try:
            cube = future_cube.result(timeout=30)
        except Exception as e:
            print(f"[LMS]   x SQL Server error (Strong Finish Cube): {type(e).__name__}: {e}")

    print(f"{'='*60}\n")

    return {
        'cube_json': json.dumps(cube),
        'filters': {
            'supervisors': filter_options['supervisors'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'supervisor': supervisor,
            'shift': shift,
            'date_from': date_from or '',
            'date_to': date_to or '',
        },
    }


# ============================================================
# NO ACTIVITY BETWEEN - Detail-level cube
# ============================================================

_NOACTIVITY_EXCLUDED_SUPERVISORS = ('Galan Knoell, Luis Enrique',)


def get_noactivity_cube(date_from=None, date_to=None):
    """Query No Activity Between detail rows.

    Power BI filters:
      - Employee Type = DIRECT (via roster join)
      - Previous Process = 'CLOCK IN'
      - Process = 'CLOCK OUT'
      - Supervisor Full Name is NOT 'Galan Knoell, Luis Enrique'

    Columns:
      [Previous Scan Day] -> Clock In time
      [Time] -> Clock Out time
      Duration = [Line Day Activity] / 60
    """
    print(f"[LMS] --- Loading No Activity Between Cube ---")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    excl_sup = ", ".join(f"'{s}'" for s in _NOACTIVITY_EXCLUDED_SUPERVISORS)

    where = f"""
    WHERE [Previous Process] = 'CLOCK IN'
      AND [Process] = 'CLOCK OUT'
      AND [Supervisor Full Name] NOT IN ({excl_sup})
"""
    params = []
    if date_from and date_to:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        where += "  AND CAST([Date] AS DATE) <= ?\n"
        params.extend([date_from, date_to])
        print(f"[LMS]   Mode: DATE RANGE = {date_from} -> {date_to}")
    elif date_from:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        params.append(date_from)
        print(f"[LMS]   Mode: DATE FROM = {date_from}")
    elif date_to:
        where += "  AND CAST([Date] AS DATE) <= ?\n"
        params.append(date_to)
        print(f"[LMS]   Mode: DATE TO = {date_to}")
    else:
        print(f"[LMS]   Mode: NO DATE FILTER")

    where += f"  AND [User Name] IN ({users_str})\n"

    query = f"""
        SELECT
            CONVERT(VARCHAR(10), CAST([Date] AS DATE), 23) AS [date],
            [User Name] AS [user_name],
            ISNULL([Full Name], [User Name]) AS [full_name],
            [Supervisor Full Name] AS [supervisor],
            [SHIFT2] AS [shift],
            CAST(DATEPART(HOUR, [Previous Scan Day]) AS VARCHAR) + ':' +
                RIGHT('0' + CAST(DATEPART(MINUTE, [Previous Scan Day]) AS VARCHAR), 2) + ':' +
                RIGHT('0' + CAST(DATEPART(SECOND, [Previous Scan Day]) AS VARCHAR), 2) AS [clock_in_time],
            CAST(DATEPART(HOUR, [Time]) AS VARCHAR) + ':' +
                RIGHT('0' + CAST(DATEPART(MINUTE, [Time]) AS VARCHAR), 2) + ':' +
                RIGHT('0' + CAST(DATEPART(SECOND, [Time]) AS VARCHAR), 2) AS [clock_out_time],
            CAST([Line Day Activity] AS FLOAT) AS [line_day]
        FROM ({_base_subquery()}) AS LMS
        {where}
        ORDER BY CAST([Date] AS DATE) DESC, [User Name]
    """

    df = run_query(query, tuple(params))
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   x No data returned ({elapsed:.2f}s)")
        return []

    def _to_12h(val):
        if not val or str(val).strip() == '':
            return ''
        s = str(val).strip()
        if 'AM' in s.upper() or 'PM' in s.upper():
            return s
        try:
            parts = s.split(':')
            h = int(parts[0])
            m = int(parts[1]) if len(parts) > 1 else 0
            sec = int(parts[2].split('.')[0]) if len(parts) > 2 else 0
            period = 'AM' if h < 12 else 'PM'
            h12 = h % 12 or 12
            return f'{h12}:{m:02d}:{sec:02d} {period}'
        except Exception:
            return s

    cube = []
    for _, row in df.iterrows():
        cube.append({
            'd': row['date'] or '',
            'u': row['user_name'] or '',
            'fn': row['full_name'] or '',
            's': row['supervisor'] or '',
            'sh': row['shift'] or '',
            'cit': _to_12h(row['clock_in_time']),
            'cot': _to_12h(row['clock_out_time']),
            'ld': round(float(row['line_day'] or 0), 4),
        })

    print(f"[LMS]   Done {len(cube)} rows in no activity cube ({elapsed:.2f}s)")
    return cube


def get_noactivity_data(supervisor='All', shift='All',
                        date_from=None, date_to=None):
    """Returns data for the No Activity Between page."""
    if date_from or date_to:
        if not date_to:
            date_to = date.today().strftime('%Y-%m-%d')
        if not date_from:
            date_from = date_to
    else:
        today = date.today()
        date_from = (today - timedelta(days=21)).strftime('%Y-%m-%d')
        date_to = today.strftime('%Y-%m-%d')

    print(f"\n{'='*60}")
    print(f"[LMS] NO ACTIVITY BETWEEN REQUEST")
    print(f"[LMS]   Date Range: {date_from or '(none)'} -> {date_to or '(none)'} | "
          f"Supervisor: {supervisor} | Shift: {shift}")
    print(f"{'='*60}")

    filter_options = {'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All']}
    cube = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        future_filters = executor.submit(get_filter_options)
        future_cube = executor.submit(get_noactivity_cube, date_from, date_to)
        try:
            filter_options = future_filters.result(timeout=30)
        except Exception as e:
            print(f"[LMS]   x Filters error: {e}")
        try:
            cube = future_cube.result(timeout=30)
        except Exception as e:
            print(f"[LMS]   x No Activity Cube error: {type(e).__name__}: {e}")

    print(f"{'='*60}\n")

    return {
        'cube_json': json.dumps(cube),
        'filters': {
            'supervisors': filter_options['supervisors'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'supervisor': supervisor,
            'shift': shift,
            'date_from': date_from or '',
            'date_to': date_to or '',
        },
    }
