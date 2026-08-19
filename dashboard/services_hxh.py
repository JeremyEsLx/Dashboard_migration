"""MX03 Performance HxH - service layer.

Queries [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] for the Hour-by-Hour
Performance dashboard.

Pages:
  - Overall Performance: Units/Users/Avg by Hour timeline with UPH by Shift
"""
import json
import pandas as pd
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor
from .services_base import run_query


# ============================================================
# DATE HELPERS
# ============================================================

def _default_date_range():
    """Last 5 days including today."""
    today = date.today()
    date_from = today - timedelta(days=4)
    return str(date_from), str(today)


# ============================================================
# OVERALL PERFORMANCE
# ============================================================

def get_hxh_overall_data(date_from=None, date_to=None):
    """Fetch HxH Overall Performance cube.

    Returns all data for the date range grouped by Date/Hour/Process/Flow/
    CartType/User/CountryOfOrigin.  Client-side JS handles filtering by
    Process, Flow, Cart Type, Shift, and individual Date.
    """
    if not date_from or not date_to:
        date_from, date_to = _default_date_range()

    where_sql = (
        f"[Process] IN ('PICKING', 'PUTAWAY', 'RECEIVING') "
        f"AND [Flow_Type_Map] IS NOT NULL "
        f"AND LTRIM(RTRIM([Flow_Type_Map])) <> '' "
        f"AND [Date] >= '{date_from}' AND [Date] <= '{date_to}'"
    )

    cube_query = f"""
        SELECT
            CONVERT(VARCHAR(10), [Date], 23) AS [day],
            ISNULL(DATEPART(HOUR, [Time]), 0) AS [hour],
            [Process] AS [process],
            [Flow_Type_Map] AS [flow],
            [Cart Type] AS [cart_type],
            [User Name] AS [user],
            [Country of Origin] AS [country],
            ISNULL(SUM(TRY_CAST([Quantity] AS BIGINT)), 0) AS [units]
        FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
        WHERE {where_sql}
        GROUP BY
            CONVERT(VARCHAR(10), [Date], 23),
            ISNULL(DATEPART(HOUR, [Time]), 0),
            [Process],
            [Flow_Type_Map],
            [Cart Type],
            [User Name],
            [Country of Origin]
        ORDER BY [day], [hour]
    """

    cube_df = run_query(cube_query)

    # Build cube JSON
    cube_data = []
    for _, row in cube_df.iterrows():
        cube_data.append({
            'd': str(row['day']),
            'h': int(row['hour']),
            'p': str(row['process']) if row['process'] else '',
            'f': str(row['flow']) if row['flow'] else '',
            'ct': str(row['cart_type']) if row['cart_type'] else '',
            'u': str(row['user']) if row['user'] else '',
            'co': str(row['country']) if row['country'] else '',
            'units': int(row['units']),
        })

    # Extract filter options from data
    processes = sorted(set(r['p'] for r in cube_data if r['p']))
    flows = sorted(set(r['f'] for r in cube_data if r['f']))
    cart_types = sorted(set(r['ct'] for r in cube_data if r['ct']))
    dates = sorted(set(r['d'] for r in cube_data))

    return {
        'cube_json': json.dumps(cube_data),
        'filters': {
            'processes': ['All'] + processes,
            'flows': ['All'] + flows,
            'cart_types': ['All'] + cart_types,
            'dates': ['All'] + dates,
            'shifts': ['All', 'Morning Shift', 'Night Shift'],
        },
        'selected': {
            'date_from': date_from,
            'date_to': date_to,
        },
    }
