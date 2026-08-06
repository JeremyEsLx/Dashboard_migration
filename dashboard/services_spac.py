"""SPAC UPH - service layer.

Queries [Business_Intelligence].[dbo].[mx03_spac_uph] for the SPAC Odometer dashboard.
Widgets:
  1. Total Units Packed (SUM of Count)
  2. Performance gauge (UPH = SUM(Count) / SUM(Duration) * 60, target = 120)
  3. Units by Day & Hour (Count grouped by Date + Hour)
  4. Updated On (earliest LastUpdate)
"""
import json
import time
import pyodbc
import pandas as pd
from datetime import date, timedelta
from django.conf import settings
from concurrent.futures import ThreadPoolExecutor


# ============================================================
# BI DATABASE CONNECTION (separate from LMS)
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


def _bi_query(query: str) -> pd.DataFrame:
    """Execute a query against the Business_Intelligence database."""
    conn = pyodbc.connect(_bi_conn_str())
    try:
        cursor = conn.cursor()
        cursor.execute(query)
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

def get_spac_data(date_from=None, date_to=None, user=None):
    """Fetch SPAC UPH cube data for the dashboard.

    Returns ALL data for the date range (no user filter server-side).
    Client-side JS handles User/Date filtering from the cube.
    """
    if not date_from or not date_to:
        date_from, date_to = _current_week_range()

    # WHERE clause: only date range (no user filter - client does that)
    where_sql = f"[Date] >= '{date_from}' AND [Date] <= '{date_to}'"

    # Query 1: LastUpdate only (KPIs computed client-side from cube)
    meta_query = f"""
        SELECT MIN([LastUpdate]) AS last_update
        FROM [Business_Intelligence].[dbo].[mx03_spac_uph] WITH (NOLOCK)
        WHERE {where_sql}
    """

    # Query 2: CUBE - grouped by Day + Hour + User (all combos for client filter)
    cube_query = f"""
        SELECT
            CONVERT(VARCHAR(10), [Date], 23) AS [day],
            DATEPART(HOUR, [Min_DateTime]) AS [hour],
            [User] AS [user],
            ISNULL(SUM(TRY_CAST([Count] AS BIGINT)), 0) AS [units],
            ISNULL(SUM(TRY_CAST([Duration] AS FLOAT)), 0) AS [duration]
        FROM [Business_Intelligence].[dbo].[mx03_spac_uph] WITH (NOLOCK)
        WHERE {where_sql}
          AND [Min_DateTime] IS NOT NULL
        GROUP BY CONVERT(VARCHAR(10), [Date], 23), DATEPART(HOUR, [Min_DateTime]), [User]
        ORDER BY [day], [hour], [User]
    """

    # Run cube + meta in parallel (only 2 queries now)
    with ThreadPoolExecutor(max_workers=2) as executor:
        f_meta = executor.submit(_bi_query, meta_query)
        f_cube = executor.submit(_bi_query, cube_query)
        meta_df = f_meta.result(timeout=30)
        cube_df = f_cube.result(timeout=30)

    # Last update timestamp
    last_update = str(meta_df.iloc[0]['last_update']) if not meta_df.empty and meta_df.iloc[0]['last_update'] else ''

    # Build cube JSON (all combos of day + hour + user)
    cube_data = []
    for _, row in cube_df.iterrows():
        cube_data.append({
            'day': str(row['day']),
            'hour': int(row['hour']),
            'user': str(row['user']) if row['user'] else '',
            'units': int(row['units']),
            'duration': float(row['duration']),
        })

    # Extract filter options from cube (distinct users + dates)
    users = ['All'] + sorted(set(r['user'] for r in cube_data if r['user']))
    dates = ['All'] + sorted(set(r['day'] for r in cube_data))

    return {
        'target': 120,
        'gauge_max': 150,
        'last_update': last_update,
        'cube_json': json.dumps(cube_data),
        'filters': {
            'users': users,
            'dates': dates,
        },
        'selected': {
            'date_from': date_from,
            'date_to': date_to,
        },
    }
