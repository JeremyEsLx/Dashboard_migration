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
    """Return supervisor list + supervisor-to-user mapping for cascading dropdowns.

    Sources supervisor-user pairs from the BI Roster table (MX03_Roster)
    since the LMS table's [Supervisor Full Name] column is no longer populated.
    """
    print("[UserSummary] ─── get_usersummary_filters() called ───")
    filter_opts = get_filter_options()
    print(f"[UserSummary] filter_opts keys: {list(filter_opts.keys())}")
    print(f"[UserSummary] filter_opts supervisors count: {len(filter_opts.get('supervisors', []))}")
    print(f"[UserSummary] filter_opts weeks count: {len(filter_opts.get('weeks', []))}")

    # Get distinct (Supervisor, User) pairs from roster for cascading dropdowns
    try:
        print("[UserSummary] Executing roster user_map query...")
        df = run_query("""
            SELECT DISTINCT
                ISNULL(CAST([Supervisor_Name] AS VARCHAR(200)), '') AS [Supervisor],
                ISNULL(CAST([Alias_SAP] AS VARCHAR(50)), CAST([EE_ID] AS VARCHAR(50))) AS [User]
            FROM [Business_Intelligence].[dbo].[MX03_Roster] WITH (NOLOCK)
            WHERE CAST([Active_YN] AS VARCHAR(MAX)) = 'SI'
              AND [Supervisor_Name] IS NOT NULL
              AND CAST([Supervisor_Name] AS VARCHAR(200)) != ''
              AND ([Alias_SAP] IS NOT NULL AND CAST([Alias_SAP] AS VARCHAR(50)) != '')
            ORDER BY 1, 2
        """)
        print(f"[UserSummary] Query returned {len(df)} rows")
        print(f"[UserSummary] DataFrame columns: {list(df.columns)}")
        if not df.empty:
            print(f"[UserSummary] First 5 rows:")
            for i, (_, row) in enumerate(df.head(5).iterrows()):
                print(f"[UserSummary]   {i}: Supervisor='{row['Supervisor']}' | User='{row['User']}'")
        else:
            print("[UserSummary] ⚠ DataFrame is EMPTY!")
            # Debug: try without the Alias_SAP filter to see if that's the issue
            print("[UserSummary] Trying broader query (no Alias_SAP filter)...")
            df_debug = run_query("""
                SELECT TOP 10
                    ISNULL([Supervisor_Name], '') AS [Supervisor],
                    [Alias_SAP],
                    [EE_ID],
                    [Employee_Name],
                    [Estacion_de_Trabajo]
                FROM [Business_Intelligence].[dbo].[MX03_Roster] WITH (NOLOCK)
                WHERE CAST([Active_YN] AS VARCHAR(MAX)) = 'SI'
                  AND [Supervisor_Name] IS NOT NULL AND [Supervisor_Name] != ''
            """)
            print(f"[UserSummary] Broader query returned {len(df_debug)} rows")
            if not df_debug.empty:
                for i, (_, r) in enumerate(df_debug.head(5).iterrows()):
                    print(f"[UserSummary]   {i}: Sup='{r['Supervisor']}' | Alias='{r['Alias_SAP']}' | EE_ID={r['EE_ID']} | Name='{r['Employee_Name']}' | Role='{r['Estacion_de_Trabajo']}'")

        user_map = []
        for _, row in df.iterrows():
            user_map.append({
                'supervisor': row['Supervisor'],
                'user': row['User'],
            })
        print(f"[UserSummary] Built user_map with {len(user_map)} entries")
    except Exception as e:
        import traceback
        print(f"[UserSummary] ✗ user mapping query FAILED: {type(e).__name__}: {e}")
        print(f"[UserSummary] Traceback: {traceback.format_exc()}")
        user_map = []

    # Extract unique supervisors from user_map
    supervisors = ['All']
    if user_map:
        unique_sups = sorted(set(entry['supervisor'] for entry in user_map))
        supervisors += unique_sups
        print(f"[UserSummary] Extracted {len(unique_sups)} unique supervisors")
    else:
        print("[UserSummary] ⚠ user_map is empty — no supervisors extracted")

    print(f"[UserSummary] RETURNING: {len(supervisors)} supervisors, {len(user_map)} user_map entries")
    return {
        'supervisors': supervisors,
        'weeks': filter_opts.get('weeks', ['All']),
        'user_map': user_map,
    }


def _build_where(date_filter=None, week=None, supervisor=None, user_name=None):
    """Build WHERE clause for user summary queries.

    Returns:
        (where_sql_str, params_tuple)
    """
    clauses = [
        f"[User Name] NOT IN ({_EXCLUDED_USERS_SQL})",
    ]
    params = []

    if user_name:
        clauses.append("[User Name] = ?")
        params.append(user_name)
    if supervisor:
        clauses.append("[Supervisor Full Name] = ?")
        params.append(supervisor)

    # Date filtering
    if week:
        clauses.append("[Fiscal Week] = ?")
        params.append(week)
    elif date_filter:
        clauses.append("CAST([Date] AS DATE) = ?")
        params.append(date_filter)
    else:
        # Default: today
        clauses.append("CAST([Date] AS DATE) = ?")
        params.append(str(date.today()))

    return ' AND '.join(clauses), tuple(params)


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
    where_sql, params = _build_where(date_filter, week, supervisor, user_name)

    # Run all 3 queries in parallel
    with ThreadPoolExecutor(max_workers=3) as executor:
        f_perf = executor.submit(run_query, _build_performance_query(where_sql), params)
        f_hour = executor.submit(run_query, _build_byhour_query(where_sql), params)
        f_detail = executor.submit(run_query, _build_detail_query(where_sql), params)
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
