"""SKY SDP - service layer.

Queries [Business_Intelligence].[dbo].[SKY_SDP] for the SKY SDP Aging dashboard.
Uses snapshot-based approach: each Update Date is a daily photo of the pipeline.

Charts:
  1. Today's Aging by Carrier (grouped bar - latest Update Date snapshot)
  2. Weekly Trend (line chart - total aging items per Update Date)
KPIs (from latest snapshot):
  Total Aging | Avg Aging Days | On-Time % | Worst Carrier | Critical (5+)
"""
import json
import pyodbc
import pandas as pd
from datetime import date, timedelta
from django.conf import settings
from concurrent.futures import ThreadPoolExecutor


# ============================================================
# BI DATABASE CONNECTION (same pattern as services_spac.py)
# ============================================================

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
    """Execute a query against the Business_Intelligence database."""
    conn = pyodbc.connect(_bi_conn_str())
    try:
        cursor = conn.cursor()
        cursor.execute(query, params) if params else cursor.execute(query)
        columns = [desc[0] for desc in cursor.description]
        rows = cursor.fetchall()
        return pd.DataFrame.from_records(rows, columns=columns)
    finally:
        conn.close()


# ============================================================
# DATE HELPERS
# ============================================================

def _current_week_range():
    """Monday of current week to today."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    return str(monday), str(today)


# ============================================================
# MAIN DATA FUNCTION
# ============================================================

def get_skysdp_data():
    """Fetch SKY SDP cube data for the dashboard.

    Returns cube (Update Date x Carrier x Aging x On-Time -> count)
    plus metadata. Client-side JS splits into today/trend charts + KPIs.

    Date handling: [Update Date] is varchar in MM-DD-YYYY format.
    TRY_CONVERT(DATE, ..., 110) parses it; CONVERT(..., 23) outputs YYYY-MM-DD.
    """
    monday_str, today_str = _current_week_range()

    # Cube: all rows this week, grouped by Update Date + Carrier + Aging + On-Time
    cube_query = """
        SELECT
            CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23) AS [ud],
            ISNULL(LTRIM(RTRIM([Carrier Name])), 'Unknown') AS [c],
            ISNULL(TRY_CAST([Aging] AS INT), 0) AS [a],
            ISNULL(LTRIM(RTRIM([On Time(Y/N)])), '') AS [ot],
            COUNT(*) AS [n]
        FROM [Business_Intelligence].[dbo].[SKY_SDP] WITH (NOLOCK)
        WHERE TRY_CONVERT(DATE, [Update Date], 110) >= ?
          AND TRY_CONVERT(DATE, [Update Date], 110) <= ?
        GROUP BY
            CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23),
            LTRIM(RTRIM([Carrier Name])),
            TRY_CAST([Aging] AS INT),
            LTRIM(RTRIM([On Time(Y/N)]))
        ORDER BY [ud], [c], [a]
    """

    # Latest Update Date this week (for identifying "today's" snapshot)
    meta_query = """
        SELECT
            CONVERT(VARCHAR(10), MAX(TRY_CONVERT(DATE, [Update Date], 110)), 23) AS latest_date
        FROM [Business_Intelligence].[dbo].[SKY_SDP] WITH (NOLOCK)
        WHERE TRY_CONVERT(DATE, [Update Date], 110) >= ?
          AND TRY_CONVERT(DATE, [Update Date], 110) <= ?
    """

    params = (monday_str, today_str)

    with ThreadPoolExecutor(max_workers=2) as executor:
        f_cube = executor.submit(_bi_query, cube_query, params)
        f_meta = executor.submit(_bi_query, meta_query, params)
        cube_df = f_cube.result(timeout=30)
        meta_df = f_meta.result(timeout=30)

    latest_date = ''
    if not meta_df.empty and meta_df.iloc[0]['latest_date']:
        latest_date = str(meta_df.iloc[0]['latest_date'])

    # Build cube JSON (compact keys: ud=update_date, c=carrier, a=aging, ot=on_time, n=count)
    cube_data = []
    for _, row in cube_df.iterrows():
        cube_data.append({
            'ud': str(row['ud']) if row['ud'] else '',
            'c':  str(row['c']),
            'a':  int(row['a']) if row['a'] is not None else 0,
            'ot': str(row['ot']),
            'n':  int(row['n']),
        })

    return {
        'cube_json': json.dumps(cube_data),
        'latest_date': latest_date,
        'selected': {
            'week_from': monday_str,
            'week_to': today_str,
        },
    }
