"""User Summary - service layer.

Search-first page: requires Supervisor or User Name.
Widgets:
  1. Performance: IN TASK vs OFF TASK total hours
  2. By Hour: hours breakdown by hour of day + Idle Time Day
  3. Detail table: raw transaction rows
"""
import json
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor
from .services_base import run_query, get_filter_options, get_direct_users

DEBUG = True  # Set to False once working

# System users excluded from all queries (page-level filter)
_EXCLUDED_USERS = ("'756777'", "'Bast_TIJ'", "'CONTROLM'", "'RFCDWP'", "'WSDLWCS3'")
_EXCLUDED_USERS_SQL = ','.join(_EXCLUDED_USERS)


def get_usersummary_filters():
    """Return supervisor list + supervisor-to-user mapping for cascading dropdowns."""
    filter_opts = get_filter_options()

    # Get distinct (Supervisor Full Name, User Name) pairs for cascading
    try:
        df = run_query(f"""
            SELECT DISTINCT
                ISNULL([Supervisor Full Name], '') AS [Supervisor],
                [User Name]
            FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
            WHERE [User Name] NOT IN ({_EXCLUDED_USERS_SQL})
              AND [User Name] IS NOT NULL AND [User Name] != ''
              AND [Supervisor Full Name] IS NOT NULL AND [Supervisor Full Name] != ''
            ORDER BY 1, 2
        """)
        user_map = []
        for _, row in df.iterrows():
            user_map.append({
                'supervisor': row['Supervisor'],
                'user': row['User Name'],
            })
    except Exception as e:
        print(f"[UserSummary] user mapping query failed: {e}")
        user_map = []

    return {
        'supervisors': filter_opts.get('supervisors', ['All']),
        'weeks': filter_opts.get('weeks', ['All']),
        'user_map': user_map,
    }


def _build_where(date_filter=None, week=None, supervisor=None, user_name=None):
    """Build WHERE clause for user summary queries."""
    clauses = [
        f"[User Name] NOT IN ({_EXCLUDED_USERS_SQL})",
    ]

    if user_name:
        clauses.append(f"[User Name] = '{user_name}'")
    if supervisor:
        clauses.append(f"[Supervisor Full Name] = '{supervisor}'")

    # Date filtering
    if week:
        clauses.append(f"[Fiscal Week] = '{week}'")
    elif date_filter:
        clauses.append(f"CAST([Date] AS DATE) = '{date_filter}'")
    else:
        # Default: today
        clauses.append(f"CAST([Date] AS DATE) = '{date.today()}'")

    return ' AND '.join(clauses)


def _build_performance_query(where_sql):
    """Widget 1: Total Hours by Idle Time Day (IN TASK / OFF TASK only)."""
    return f"""
    SELECT
        [Idle Time Day],
        SUM(ISNULL(TRY_CAST([Line Day Activity] AS FLOAT), 0)) / 60.0 AS TotalHours
    FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    WHERE {where_sql}
      AND [Idle Time Day] IN ('IN TASK', 'OFF TASK')
    GROUP BY [Idle Time Day]
    """


def _build_byhour_query(where_sql):
    """Widget 2: Total Hours by Hour + Idle Time Day."""
    return f"""
    SELECT
        DATEPART(HOUR, CAST([Date] AS DATETIME)) AS [Hour],
        [Idle Time Day],
        SUM(ISNULL(TRY_CAST([Line Day Activity] AS FLOAT), 0)) / 60.0 AS TotalHours
    FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    WHERE {where_sql}
      AND [Idle Time Day] IN ('IN TASK', 'OFF TASK')
    GROUP BY DATEPART(HOUR, CAST([Date] AS DATETIME)), [Idle Time Day]
    ORDER BY [Hour] ASC
    """


def _build_detail_query(where_sql):
    """Widget 3: Detail table (TOP 10000)."""
    return f"""
    SELECT TOP 10000
        CONVERT(VARCHAR(10), CAST([Date] AS DATE), 101) AS [Date],
        CONVERT(VARCHAR(8), CAST([Date] AS DATETIME), 108) AS [Time],
        [Process],
        ISNULL([Flow Type], '') AS [Flow Type],
        ISNULL(TRY_CAST([Quantity] AS INT), 0) AS [Quantity],
        ISNULL([Source Storage Type], '') AS [Source Storage Type],
        ISNULL([Source Storage Bin], '') AS [Source Storage Bin],
        ISNULL([Destination Storage Type], '') AS [Destination Storage Type],
        ISNULL([Destination Storage Bin], '') AS [Destination Storage Bin],
        ISNULL(TRY_CAST([Line Day Activity] AS FLOAT), 0) AS [Line Day Activity],
        ISNULL(TRY_CAST([Working Gap Minutes] AS FLOAT), 0) AS [Working Gap Minutes]
    FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    WHERE {where_sql}
    ORDER BY CAST([Date] AS DATETIME) ASC
    """


def get_usersummary_data(date_filter=None, week=None, supervisor=None, user_name=None):
    """Main entry point - returns performance + by-hour + detail + filters."""
    where_sql = _build_where(date_filter, week, supervisor, user_name)

    # Run all 3 queries in parallel
    with ThreadPoolExecutor(max_workers=3) as executor:
        f_perf = executor.submit(run_query, _build_performance_query(where_sql))
        f_hour = executor.submit(run_query, _build_byhour_query(where_sql))
        f_detail = executor.submit(run_query, _build_detail_query(where_sql))
        perf_df = f_perf.result(timeout=30)
        hour_df = f_hour.result(timeout=30)
        detail_df = f_detail.result(timeout=30)

    # Widget 1: Performance (IN TASK / OFF TASK)
    perf_data = []
    for _, row in perf_df.iterrows():
        perf_data.append({
            'category': row['Idle Time Day'],
            'hours': round(float(row['TotalHours']), 2),
        })

    # Widget 2: By Hour
    hour_data = []
    for _, row in hour_df.iterrows():
        hour_data.append({
            'hour': int(row['Hour']),
            'category': row['Idle Time Day'],
            'hours': round(float(row['TotalHours']), 2),
        })

    # Widget 3: Detail
    detail_data = detail_df.to_dict(orient='records')

    # Filter options from shared cache
    filter_opts = get_filter_options()

    return {
        'perf_json': json.dumps(perf_data),
        'hour_json': json.dumps(hour_data),
        'detail_json': json.dumps(detail_data, default=str),
        'detail_count': len(detail_data),
        'filters': {
            'supervisors': filter_opts.get('supervisors', []),
            'weeks': filter_opts.get('weeks', []),
        },
        'selected': {
            'date_filter': date_filter or str(date.today()),
            'week': week or '',
            'supervisor': supervisor or '',
            'user_name': user_name or '',
        },
    }
