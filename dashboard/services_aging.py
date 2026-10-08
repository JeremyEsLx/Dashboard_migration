"""Aging Dashboard - service layer.

Queries [Business_Intelligence].[dbo].[SKY_SDP] filtered to rows where
[Pickup Date] is NULL or empty (shipments missing a pickup date).
Same cube structure as services_skysdp.py.
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


def _current_week_range():
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    return str(monday), str(today)


def get_aging_data():
    """Fetch aging cube data — only rows where Pickup Date is NULL or empty."""
    monday_str, today_str = _current_week_range()

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
          AND ([Pickup Date] IS NULL OR LTRIM(RTRIM([Pickup Date])) = '')
        GROUP BY
            CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23),
            LTRIM(RTRIM([Carrier Name])),
            TRY_CAST([Aging] AS INT),
            LTRIM(RTRIM([On Time(Y/N)]))
        ORDER BY [ud], [c], [a]
    """

    meta_query = """
        SELECT
            CONVERT(VARCHAR(10), MAX(TRY_CONVERT(DATE, [Update Date], 110)), 23) AS latest_date
        FROM [Business_Intelligence].[dbo].[SKY_SDP] WITH (NOLOCK)
        WHERE TRY_CONVERT(DATE, [Update Date], 110) >= ?
          AND TRY_CONVERT(DATE, [Update Date], 110) <= ?
          AND ([Pickup Date] IS NULL OR LTRIM(RTRIM([Pickup Date])) = '')
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
