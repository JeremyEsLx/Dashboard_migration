"""Aging Dashboard - service layer.

Queries [Business_Intelligence].[dbo].[SKY_SDP] filtered to rows where
[Pickup Date] is NULL or empty (shipments missing a pickup date).

Supports date selection: returns all available Update Dates for the
dropdown picker, and fetches the cube for a single selected date.
"""
import json
import pyodbc
import pandas as pd
from datetime import date, timedelta
from django.conf import settings
from concurrent.futures import ThreadPoolExecutor


def _bi_conn_str():
    return (
        f"DRIVER={settings.SQL_DRIVER};"
        f"SERVER={settings.BI_SERVER};"
        f"DATABASE={settings.BI_DATABASE};"
        f"UID={settings.BI_USERNAME};"
        f"PWD={settings.BI_PASSWORD};"
        f"TrustServerCertificate=yes;"
    )


def _bi_query(query: str, params: tuple = ()) -> pd.DataFrame:
    conn = pyodbc.connect(_bi_conn_str())
    try:
        cursor = conn.cursor()
        cursor.execute(query, params) if params else cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        return pd.DataFrame.from_records(rows, columns=columns)
    finally:
        conn.close()


def get_aging_data(target_date=None, compare_date=None):
    """Fetch aging cube for a single Update Date.

    Args:
        target_date:  YYYY-MM-DD string.  If None, uses the latest available.
        compare_date: YYYY-MM-DD string.  If None, defaults to same weekday
                      last week (target_date - 7 days).  If that date has no
                      data, comparison is omitted.

    Returns dict with cube_json, latest_date, available_dates[], selected{},
    comparison_date, comparison_cube_json.
    """

    # 1. All distinct Update Dates with missing Pickup Date (newest first)
    dates_query = """
        SELECT DISTINCT
            CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23) AS [ud]
        FROM [Business_Intelligence].[dbo].[SKY_SDP] WITH (NOLOCK)
        WHERE ([Pickup Date] IS NULL OR LTRIM(RTRIM([Pickup Date])) = '')
          AND TRY_CONVERT(DATE, [Update Date], 110) IS NOT NULL
        ORDER BY [ud] DESC
    """

    # 2. Cube for a single date
    cube_query = """
        SELECT
            CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23) AS [ud],
            ISNULL(LTRIM(RTRIM([Carrier Name])), 'Unknown') AS [c],
            ISNULL(TRY_CAST([Aging] AS INT), 0) AS [a],
            ISNULL(LTRIM(RTRIM([On Time(Y/N)])), '') AS [ot],
            COUNT(*) AS [n]
        FROM [Business_Intelligence].[dbo].[SKY_SDP] WITH (NOLOCK)
        WHERE CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23) = ?
          AND ([Pickup Date] IS NULL OR LTRIM(RTRIM([Pickup Date])) = '')
        GROUP BY
            CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23),
            LTRIM(RTRIM([Carrier Name])),
            TRY_CAST([Aging] AS INT),
            LTRIM(RTRIM([On Time(Y/N)]))
        ORDER BY [ud], [c], [a]
    """

    # --- fetch available dates first ---
    dates_df = _bi_query(dates_query)
    available_dates = [
        str(row['ud']) for _, row in dates_df.iterrows() if row['ud']
    ]

    # --- resolve which date to show ---
    if target_date and target_date in available_dates:
        selected_date = target_date
    elif available_dates:
        selected_date = available_dates[0]          # latest
    else:
        selected_date = ''

    # --- fetch cube for selected date + comparison (last Friday) ---
    def _build_cube(df):
        data = []
        for _, row in df.iterrows():
            data.append({
                'ud': str(row['ud']) if row['ud'] else '',
                'c':  str(row['c']),
                'a':  int(row['a']) if row['a'] is not None else 0,
                'ot': str(row['ot']),
                'n':  int(row['n']),
            })
        return data

    # Resolve comparison date
    comparison_date = None
    if selected_date:
        if compare_date and compare_date in available_dates:
            # User explicitly chose a comparison date
            comparison_date = compare_date
        else:
            # Default: same weekday last week (7 days back)
            sel = date.fromisoformat(selected_date)
            default_comp = (sel - timedelta(days=7)).isoformat()
            if default_comp in available_dates:
                comparison_date = default_comp
            else:
                # Fallback: closest available date before selected (within 14 days)
                cutoff = (sel - timedelta(days=14)).isoformat()
                for d in available_dates:
                    if d < selected_date and d >= cutoff:
                        comparison_date = d
                        break  # available_dates is sorted DESC, first match is closest

    cube_data = []
    comparison_cube_data = []

    if selected_date:
        if comparison_date:
            # Parallel: fetch both cubes at once
            with ThreadPoolExecutor(max_workers=2) as pool:
                f_sel  = pool.submit(_bi_query, cube_query, (selected_date,))
                f_comp = pool.submit(_bi_query, cube_query, (comparison_date,))
                cube_data = _build_cube(f_sel.result())
                comparison_cube_data = _build_cube(f_comp.result())
        else:
            cube_df = _bi_query(cube_query, (selected_date,))
            cube_data = _build_cube(cube_df)

    return {
        'cube_json': json.dumps(cube_data),
        'latest_date': selected_date,
        'available_dates': available_dates,
        'comparison_date': comparison_date,
        'comparison_cube_json': json.dumps(comparison_cube_data) if comparison_date else None,
        'selected': {
            'week_from': available_dates[-1] if available_dates else '',
            'week_to':   available_dates[0]  if available_dates else '',
        },
    }
