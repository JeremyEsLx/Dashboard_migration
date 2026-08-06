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
    """Fetch SPAC UPH data for the dashboard.

    Returns:
        dict with total_units, uph, target, last_update, hour_json, filters, selected
    """
    if not date_from or not date_to:
        date_from, date_to = _current_week_range()

    # Build WHERE clause
    clauses = [
        f"[Date] >= '{date_from}'",
        f"[Date] <= '{date_to}'",
    ]
    if user and user != 'All':
        clauses.append(f"[User] = '{user}'")

    where_sql = ' AND '.join(clauses)

    # Query 1: KPIs (Total Units + UPH + LastUpdate)
    kpi_query = f"""
        SELECT
            ISNULL(SUM(TRY_CAST([Count] AS BIGINT)), 0) AS total_units,
            ISNULL(SUM(TRY_CAST([Duration] AS FLOAT)), 0) AS total_duration,
            MIN([LastUpdate]) AS last_update
        FROM [Business_Intelligence].[dbo].[mx03_spac_uph] WITH (NOLOCK)
        WHERE {where_sql}
    """

    # Query 2: Units by Day & Hour
    hour_query = f"""
        SELECT
            CONVERT(VARCHAR(10), [Date], 23) AS [day],
            DATEPART(HOUR, [Min_DateTime]) AS [hour],
            SUM(TRY_CAST([Count] AS BIGINT)) AS [units]
        FROM [Business_Intelligence].[dbo].[mx03_spac_uph] WITH (NOLOCK)
        WHERE {where_sql}
          AND [Min_DateTime] IS NOT NULL
        GROUP BY CONVERT(VARCHAR(10), [Date], 23), DATEPART(HOUR, [Min_DateTime])
        ORDER BY [day], [hour]
    """

    # Query 3: Filter options (distinct users)
    filter_query = f"""
        SELECT DISTINCT [User]
        FROM [Business_Intelligence].[dbo].[mx03_spac_uph] WITH (NOLOCK)
        WHERE [Date] >= '{date_from}' AND [Date] <= '{date_to}'
          AND [User] IS NOT NULL AND [User] != ''
        ORDER BY [User]
    """

    # Query 4: Distinct dates in range (for single-date dropdown)
    dates_query = f"""
        SELECT DISTINCT CONVERT(VARCHAR(10), [Date], 23) AS [d]
        FROM [Business_Intelligence].[dbo].[mx03_spac_uph] WITH (NOLOCK)
        WHERE [Date] >= '{date_from}' AND [Date] <= '{date_to}'
        ORDER BY [d]
    """

    # Run in parallel
    with ThreadPoolExecutor(max_workers=4) as executor:
        f_kpi = executor.submit(_bi_query, kpi_query)
        f_hour = executor.submit(_bi_query, hour_query)
        f_filter = executor.submit(_bi_query, filter_query)
        f_dates = executor.submit(_bi_query, dates_query)
        kpi_df = f_kpi.result(timeout=30)
        hour_df = f_hour.result(timeout=30)
        filter_df = f_filter.result(timeout=30)
        dates_df = f_dates.result(timeout=30)

    # KPIs
    total_units = int(kpi_df.iloc[0]['total_units']) if not kpi_df.empty else 0
    total_duration = float(kpi_df.iloc[0]['total_duration']) if not kpi_df.empty else 0
    uph = round((total_units / total_duration) * 60, 1) if total_duration > 0 else 0
    last_update = str(kpi_df.iloc[0]['last_update']) if not kpi_df.empty and kpi_df.iloc[0]['last_update'] else ''

    # Hour chart data
    hour_data = []
    for _, row in hour_df.iterrows():
        hour_data.append({
            'day': str(row['day']),
            'hour': int(row['hour']),
            'units': int(row['units']),
        })

    # Filters
    users = ['All'] + filter_df['User'].tolist()
    dates = ['All'] + dates_df['d'].tolist() if not dates_df.empty else ['All']

    return {
        'total_units': total_units,
        'uph': uph,
        'target': 120,
        'gauge_max': 150,
        'last_update': last_update,
        'hour_json': json.dumps(hour_data),
        'filters': {
            'users': users,
            'dates': dates,
        },
        'selected': {
            'date_from': date_from,
            'date_to': date_to,
            'user': user or 'All',
        },
    }
