"""SKY SDP / In Transit - service layer.

Queries [Business_Intelligence].[dbo].[SKY_SDP] for the In Transit dashboard.
Supports date selection: returns all available Update Dates and fetches the
cube for a single selected date.
"""
import json
import pyodbc
import pandas as pd
from django.conf import settings


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


def get_skysdp_data(target_date=None):
    """Fetch In Transit cube for a single Update Date.

    Args:
        target_date: YYYY-MM-DD string.  If None, uses the latest available.

    Returns dict with cube_json, latest_date, available_dates[], selected{}.
    """

    dates_query = """
        SELECT DISTINCT
            CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23) AS [ud]
        FROM [Business_Intelligence].[dbo].[SKY_SDP] WITH (NOLOCK)
        WHERE TRY_CONVERT(DATE, [Update Date], 110) IS NOT NULL
        ORDER BY [ud] DESC
    """

    cube_query = """
        SELECT
            CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23) AS [ud],
            ISNULL(LTRIM(RTRIM([Carrier Name])), 'Unknown') AS [c],
            ISNULL(TRY_CAST([Aging] AS INT), 0) AS [a],
            ISNULL(LTRIM(RTRIM([On Time(Y/N)])), '') AS [ot],
            COUNT(*) AS [n]
        FROM [Business_Intelligence].[dbo].[SKY_SDP] WITH (NOLOCK)
        WHERE CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23) = ?
        GROUP BY
            CONVERT(VARCHAR(10), TRY_CONVERT(DATE, [Update Date], 110), 23),
            LTRIM(RTRIM([Carrier Name])),
            TRY_CAST([Aging] AS INT),
            LTRIM(RTRIM([On Time(Y/N)]))
        ORDER BY [ud], [c], [a]
    """

    dates_df = _bi_query(dates_query)
    available_dates = [
        str(row['ud']) for _, row in dates_df.iterrows() if row['ud']
    ]

    if target_date and target_date in available_dates:
        selected_date = target_date
    elif available_dates:
        selected_date = available_dates[0]
    else:
        selected_date = ''

    cube_data = []
    if selected_date:
        cube_df = _bi_query(cube_query, (selected_date,))
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
        'latest_date': selected_date,
        'available_dates': available_dates,
        'selected': {
            'week_from': available_dates[-1] if available_dates else '',
            'week_to':   available_dates[0]  if available_dates else '',
        },
    }
