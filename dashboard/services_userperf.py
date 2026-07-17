"""User Performance service — raw detail-level data explorer.

Queries the same LMS table but returns individual transaction rows (no GROUP BY)
with all columns needed for the Power BI 'User Performance' page.

Filter: [Process] NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')
Date default: 26th of last month to today.
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
# USER PERFORMANCE CUBE (raw rows, many columns)
# ============================================================

def _default_date_range():
    """26th of last month to today."""
    today = date.today()
    if today.month == 1:
        date_from = date(today.year - 1, 12, 26)
    else:
        date_from = date(today.year, today.month - 1, 26)
    return date_from.strftime('%Y-%m-%d'), today.strftime('%Y-%m-%d')


def get_userperformance_cube(date_from=None, date_to=None):
    """Query raw LMS rows for User Performance page.

    WHERE: Process NOT IN (CLOCK IN, CLOCK OUT, TEMP EXIT)
    All other filters (Activity Type, Movement, etc.) are client-side.
    Returns ALL rows — GZip middleware compresses the large payload.
    """
    print(f"[LMS] --- Loading User Performance Cube ---")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    where = """
    WHERE [Process] NOT IN ('CLOCK IN', 'CLOCK OUT', 'TEMP EXIT')
"""
    if date_from and date_to:
        where += f"  AND CAST([Date] AS DATE) >= '{date_from}'\n"
        where += f"  AND CAST([Date] AS DATE) <= '{date_to}'\n"
        print(f"[LMS]   Mode: DATE RANGE = {date_from} -> {date_to}")
    elif date_from:
        where += f"  AND CAST([Date] AS DATE) >= '{date_from}'\n"
    elif date_to:
        where += f"  AND CAST([Date] AS DATE) <= '{date_to}'\n"
    else:
        print(f"[LMS]   Mode: NO DATE FILTER")

    where += f"  AND [User Name] IN ({users_str})\n"

    query = f"""
        SELECT
            CONVERT(VARCHAR(10), CAST([Date] AS DATE), 23) AS [date],
            ISNULL([Fiscal Week], '') AS [fiscal_week],
            [SHIFT2] AS [shift],
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
        FROM ({_base_subquery()}) AS LMS
        {where}
        ORDER BY CAST([Date] AS DATE) DESC, [User Name]
    """

    df = run_query(query)
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   x No data returned ({elapsed:.2f}s)")
        return []

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

    print(f"[LMS]   Done {len(cube)} rows in user performance cube ({elapsed:.2f}s)")
    return cube


def get_userperformance_data(date_from=None, date_to=None):
    """Returns data for the User Performance page."""
    if not date_from and not date_to:
        date_from, date_to = _default_date_range()
    else:
        if not date_to:
            date_to = date.today().strftime('%Y-%m-%d')
        if not date_from:
            date_from = date_to

    print(f"\n{'='*60}")
    print(f"[LMS] USER PERFORMANCE REQUEST")
    print(f"[LMS]   Date Range: {date_from} -> {date_to}")
    print(f"{'='*60}")

    filter_options = {'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All']}
    cube = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        future_filters = executor.submit(get_filter_options)
        future_cube = executor.submit(get_userperformance_cube, date_from, date_to)
        try:
            filter_options = future_filters.result(timeout=60)
        except Exception as e:
            print(f"[LMS]   x Filters error: {e}")
        try:
            cube = future_cube.result(timeout=180)
        except Exception as e:
            print(f"[LMS]   x User Performance Cube error: {type(e).__name__}: {e}")

    print(f"{'='*60}\n")

    return {
        'cube_json': json.dumps(cube),
        'filters': {
            'supervisors': filter_options['supervisors'],
            'weeks': filter_options['weeks'],
            'processes': filter_options['processes'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'date_from': date_from or '',
            'date_to': date_to or '',
        },
    }
