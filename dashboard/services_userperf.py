"""User Performance service — search-first raw detail explorer.

Queries the same LMS table but returns individual transaction rows (no GROUP BY).
All filters are applied SERVER-SIDE to keep result sets manageable.
The page does NOT auto-load — user must click Search after selecting filters.

Base filter: [Process] NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')
Date default: 26th of last month to today.
Safety cap: TOP 10000 rows per request.
"""
import json
import time
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor

from .services import (
    get_direct_users, get_filter_options,
    _base_subquery, run_query,
)


# ============================================================
# USER PERFORMANCE CUBE (server-side filtered)
# ============================================================

_MAX_ROWS = 10000  # Safety cap per request

# Caches for dropdown options (1 hour TTL)
_fullname_cache = {'data': None, 'timestamp': 0}
_movement_cache = {'data': None, 'timestamp': 0}
_DROPDOWN_CACHE_TTL = 3600  # 1 hour


def _get_full_names():
    """Cached: distinct Full Names for DIRECT users (last 30 days of LMS data)."""
    now = time.time()
    if _fullname_cache['data'] and (now - _fullname_cache['timestamp']) < _DROPDOWN_CACHE_TTL:
        return _fullname_cache['data']

    print("[LMS]   Loading Full Names...")
    start = time.time()
    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    df_fn = run_query(f"""
        SELECT DISTINCT ISNULL([Full Name], [User Name]) AS [full_name]
        FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
        WHERE [User Name] IN ({users_str})
          AND [Full Name] IS NOT NULL
          AND [Full Name] != ''
          AND [Date] >= DATEADD(DAY, -30, GETDATE())
        ORDER BY [full_name]
    """)

    result = ['All'] + df_fn['full_name'].tolist()
    _fullname_cache['data'] = result
    _fullname_cache['timestamp'] = time.time()
    elapsed = time.time() - start
    print(f"[LMS]   Full Names loaded: {len(result) - 1} entries ({elapsed:.2f}s, cached 1h)")
    return result


def _get_movements():
    """Cached: distinct Movements for DIRECT users (last 30 days)."""
    now = time.time()
    if _movement_cache['data'] and (now - _movement_cache['timestamp']) < _DROPDOWN_CACHE_TTL:
        return _movement_cache['data']

    print("[LMS]   Loading Movements...")
    start = time.time()
    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    df_mv = run_query(f"""
        SELECT DISTINCT [Movement]
        FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
        WHERE [User Name] IN ({users_str})
          AND [Movement] IS NOT NULL
          AND [Movement] != ''
          AND [Date] >= DATEADD(DAY, -30, GETDATE())
        ORDER BY [Movement]
    """)

    result = ['All'] + df_mv['Movement'].tolist()
    _movement_cache['data'] = result
    _movement_cache['timestamp'] = time.time()
    elapsed = time.time() - start
    print(f"[LMS]   Movements loaded: {len(result) - 1} entries ({elapsed:.2f}s, cached 1h)")
    return result


def _default_date_range():
    """26th of last month to today."""
    today = date.today()
    if today.month == 1:
        date_from = date(today.year - 1, 12, 26)
    else:
        date_from = date(today.year, today.month - 1, 26)
    return date_from.strftime('%Y-%m-%d'), today.strftime('%Y-%m-%d')


def get_userperformance_cube(date_from=None, date_to=None, supervisor=None,
                             user_name=None, process=None, movement=None,
                             shift=None, hour=None, week=None, full_name=None):
    """Query raw LMS rows with server-side filters.

    All filters narrow the SQL WHERE clause so only relevant rows are returned.
    Returns at most _MAX_ROWS rows.
    """
    print(f"[LMS] --- Loading User Performance Cube ---")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    where = "    WHERE [Process] NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')\n"

    if date_from and date_to:
        where += f"      AND CAST([Date] AS DATE) >= '{date_from}'\n"
        where += f"      AND CAST([Date] AS DATE) <= '{date_to}'\n"
        print(f"[LMS]   Date: {date_from} -> {date_to}")
    elif date_from:
        where += f"      AND CAST([Date] AS DATE) >= '{date_from}'\n"
    elif date_to:
        where += f"      AND CAST([Date] AS DATE) <= '{date_to}'\n"

    where += f"      AND [User Name] IN ({users_str})\n"

    # Server-side filters
    if supervisor and supervisor != 'All':
        where += f"      AND [Supervisor Full Name] = '{supervisor.replace(chr(39), chr(39)+chr(39))}'\n"
        print(f"[LMS]   Supervisor: {supervisor}")
    if user_name:
        where += f"      AND [User Name] LIKE '%{user_name.replace(chr(39), chr(39)+chr(39))}%'\n"
        print(f"[LMS]   User Name: {user_name}")
    if process and process != 'All':
        where += f"      AND [Process] = '{process.replace(chr(39), chr(39)+chr(39))}'\n"
        print(f"[LMS]   Process: {process}")
    if movement and movement != 'All':
        where += f"      AND [Movement] = '{movement.replace(chr(39), chr(39)+chr(39))}'\n"
        print(f"[LMS]   Movement: {movement}")
    if shift and shift != 'All':
        shift_map = {
            'A': ("'Turno A - Produccion'", "'Lunes-Jueves 06:00 a 18:00'", "'Lunes-Viernes 08:00 a 17:30'"),
            'B': ("'Turno B - Produccion'",),
            'C': ("'Turno C - Produccion'",),
            'D': ("'Turno D - Produccion'",),
        }
        if shift in shift_map:
            vals = ", ".join(shift_map[shift])
            where += f"      AND [Shift] IN ({vals})\n"
            print(f"[LMS]   Shift: {shift}")
    if hour is not None and hour != '' and hour != 'All':
        where += f"      AND DATEPART(HOUR, [Time]) = {int(hour)}\n"
        print(f"[LMS]   Hour: {hour}")
    if week and week != 'All':
        where += f"      AND [Fiscal Week] = '{week.replace(chr(39), chr(39)+chr(39))}'\n"
        print(f"[LMS]   Week: {week}")
    if full_name and full_name != 'All':
        where += f"      AND [Full Name] = '{full_name.replace(chr(39), chr(39)+chr(39))}'\n"
        print(f"[LMS]   Full Name: {full_name}")

    query = f"""
        SELECT TOP {_MAX_ROWS}
            CONVERT(VARCHAR(10), CAST([Date] AS DATE), 23) AS [date],
            ISNULL([Fiscal Week], '') AS [fiscal_week],
            CASE
                WHEN [Shift] IN ('Turno A - Produccion', 'Lunes-Jueves 06:00 a 18:00', 'Lunes-Viernes 08:00 a 17:30') THEN 'A'
                WHEN [Shift] = 'Turno B - Produccion' THEN 'B'
                WHEN [Shift] = 'Turno C - Produccion' THEN 'C'
                WHEN [Shift] = 'Turno D - Produccion' THEN 'D'
                ELSE 'OTHER'
            END AS [shift],
            [User Name] AS [user_name],
            ISNULL([Full Name], [User Name]) AS [full_name],
            [Supervisor Full Name] AS [supervisor],
            ISNULL([Activity Type], '') AS [activity_type],
            ISNULL([Process], '') AS [process],
            ISNULL([Movement], '') AS [movement],
            ISNULL(CAST([Delivery] AS VARCHAR(50)), '') AS [delivery],
            ISNULL([VAS Type], '') AS [vas_type],
            ISNULL(CAST([Packing Object] AS VARCHAR(50)), '') AS [packing_object],
            ISNULL(CAST([Transfer Order Number] AS VARCHAR(50)), '') AS [transfer_order],
            ISNULL([Source Storage Type], '') AS [src_st_type],
            ISNULL(CAST([Source Storage Bin] AS VARCHAR(50)), '') AS [src_st_bin],
            ISNULL([Destination Storage Type], '') AS [dst_st_type],
            ISNULL(CAST([Destination Storage Bin] AS VARCHAR(50)), '') AS [dst_st_bin],
            ISNULL([Process_Map], '') AS [process_map],
            ISNULL([Flow Type], '') AS [flow_type],
            ISNULL([Flow_Type_Map], '') AS [flow_type_map],
            ISNULL([Cart Type], '') AS [cart_type],
            CASE
                WHEN ISNULL(TRY_CAST([Target] AS FLOAT), 0) = 0 THEN 0.0000001
                ELSE ISNULL(TRY_CAST([Quantity] AS FLOAT), 0) / TRY_CAST([Target] AS FLOAT)
            END AS [target_time],
            ISNULL(TRY_CAST([Line Day Activity] AS FLOAT), 0) AS [line_day],
            ISNULL(TRY_CAST([Idle Time Day] AS FLOAT), 0) AS [idle_time],
            DATEPART(HOUR, [Time]) AS [hour]
        FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
        {where}
        ORDER BY CAST([Date] AS DATE) DESC, [User Name]
    """

    df = run_query(query)
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   x No data returned ({elapsed:.2f}s)")
        return [], 0

    cube = []
    for _, row in df.iterrows():
        cube.append({
            'd': row['date'] or '',
            'wk': row['fiscal_week'] or '',
            'sh': row['shift'] or '',
            'u': row['user_name'] or '',
            'fn': row['full_name'] or '',
            's': row['supervisor'] or '',
            'at': row['activity_type'] or '',
            'pr': row['process'] or '',
            'mv': row['movement'] or '',
            'dl': row['delivery'] or '',
            'vt': row['vas_type'] or '',
            'po': row['packing_object'] or '',
            'to': row['transfer_order'] or '',
            'sst': row['src_st_type'] or '',
            'ssb': row['src_st_bin'] or '',
            'dst': row['dst_st_type'] or '',
            'dsb': row['dst_st_bin'] or '',
            'pm': row['process_map'] or '',
            'ft': row['flow_type'] or '',
            'fm': row['flow_type_map'] or '',
            'ct': row['cart_type'] or '',
            'tt': round(float(row['target_time'] or 0), 7),
            'ld': round(float(row['line_day'] or 0), 4),
            'it': round(float(row['idle_time'] or 0), 4),
            'hr': int(row['hour']) if row['hour'] is not None else 0,
        })

    total = len(cube)
    capped = total >= _MAX_ROWS
    print(f"[LMS]   Done {total} rows ({elapsed:.2f}s){' [CAPPED]' if capped else ''}")
    return cube, total


def get_userperformance_data(date_from=None, date_to=None, supervisor=None,
                             user_name=None, process=None, movement=None,
                             shift=None, hour=None, week=None, full_name=None):
    """Returns data for the User Performance page (search-first).

    If no filters beyond date are provided, returns only filter options
    (no cube data) so the page can populate dropdowns without querying 1M rows.
    """
    if not date_from and not date_to:
        date_from, date_to = _default_date_range()
    else:
        if not date_to:
            date_to = date_from  # Single-date search: same day
        if not date_from:
            date_from = date_to

    # Check if user provided at least one narrowing filter
    has_filter = any([
        supervisor and supervisor != 'All',
        user_name,
        process and process != 'All',
        movement and movement != 'All',
        shift and shift != 'All',
        hour is not None and hour != '' and hour != 'All',
        week and week != 'All',
        full_name and full_name != 'All',
    ])

    print(f"\n{'='*60}")
    print(f"[LMS] USER PERFORMANCE REQUEST")
    print(f"[LMS]   Date Range: {date_from} -> {date_to}")
    print(f"[LMS]   Has narrowing filter: {has_filter}")
    print(f"{'='*60}")

    # Always load filter options (lightweight)
    filter_options = {'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All']}
    try:
        filter_options = get_filter_options()
    except Exception as e:
        print(f"[LMS]   x Filters error: {e}")

    # Load Full Names dropdown (cached 1h, scoped to last 30 days)
    full_names_list = ['All']
    try:
        full_names_list = _get_full_names()
    except Exception as e:
        print(f"[LMS]   x Full Names error: {e}")

    # Load Movements dropdown (cached 1h, scoped to last 30 days)
    movements_list = ['All']
    try:
        movements_list = _get_movements()
    except Exception as e:
        print(f"[LMS]   x Movements error: {e}")

    # Only run the heavy cube query if user provided at least one filter
    cube = []
    total = 0
    capped = False
    if has_filter:
        try:
            cube, total = get_userperformance_cube(
                date_from=date_from, date_to=date_to,
                supervisor=supervisor, user_name=user_name,
                process=process, movement=movement,
                shift=shift, hour=hour,
                week=week, full_name=full_name,
            )
            capped = total >= _MAX_ROWS
        except Exception as e:
            print(f"[LMS]   x User Performance Cube error: {type(e).__name__}: {e}")
    else:
        print(f"[LMS]   Skipping cube query — no narrowing filter provided")

    print(f"{'='*60}\n")

    return {
        'cube_json': json.dumps(cube),
        'total': total,
        'capped': capped,
        'max_rows': _MAX_ROWS,
        'filters': {
            'supervisors': filter_options['supervisors'],
            'weeks': filter_options['weeks'],
            'processes': filter_options['processes'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
            'full_names': full_names_list,
        },
        'selected': {
            'date_from': date_from or '',
            'date_to': date_to or '',
        },
        'has_filter': has_filter,
    }
