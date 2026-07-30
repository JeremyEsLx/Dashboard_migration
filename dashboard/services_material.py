"""Detail by Material - service layer.

Queries LMS table for material-level detail with filters.
Returns:
  - units_chart: Quantity aggregated by Process (for bar chart)
  - detail_rows: raw rows for the Details table (TOP 10000)
  - filter_options: distinct values for each dropdown filter
"""
import json
from datetime import date, timedelta
from .services import run_query, get_direct_users


def _default_date_range():
    """Default: today minus 21 days to today."""
    today = date.today()
    date_from = today - timedelta(days=21)
    return str(date_from), str(today)


def _build_where(date_from, date_to, process=None, movement=None,
                 material=None, grid=None, stock_cat=None,
                 dest_bin=None, source_bin=None):
    """Shared WHERE clauses for both queries."""
    users = get_direct_users()
    users_str = ','.join(f"'{u}'" for u in users)

    clauses = [
        "[Activity Type] = 'DIRECT'",
        f"[User Name] IN ({users_str})",
        f"CAST([Date] AS DATE) >= '{date_from}'",
        f"CAST([Date] AS DATE) <= '{date_to}'",
    ]

    if process:
        clauses.append(f"[Process] = '{process}'")
    if movement:
        clauses.append(f"[Movement] = '{movement}'")
    if material:
        clauses.append(f"[Material] = '{material}'")
    if grid:
        clauses.append(f"[Grid Value] = '{grid}'")
    if stock_cat:
        clauses.append(f"[Stock Category] = '{stock_cat}'")
    if dest_bin:
        clauses.append(f"[Destination Storage Bin] = '{dest_bin}'")
    if source_bin:
        clauses.append(f"[Source Storage Bin] = '{source_bin}'")

    return ' AND '.join(clauses)


def _build_units_query(where_sql):
    """Aggregate Quantity by Process for the Units chart."""
    return f"""
    SELECT
        [Process],
        SUM(ISNULL(TRY_CAST([Quantity] AS INT), 0)) AS Quantity
    FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    WHERE {where_sql}
    GROUP BY [Process]
    ORDER BY Quantity DESC
    """


def _build_totals_query(where_sql):
    """Fast aggregate: total row count + total quantity."""
    return f"""
    SELECT
        COUNT(*) AS total_rows,
        SUM(ISNULL(TRY_CAST([Quantity] AS INT), 0)) AS total_qty
    FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    WHERE {where_sql}
    """


def _build_detail_query(where_sql):
    """Detail rows for the table (TOP 10000 for performance)."""
    return f"""
    SELECT TOP 10000
        FORMAT(CAST([Date] AS DATE), 'MM/dd/yyyy') AS [Date],
        FORMAT(CAST([Date] AS DATETIME), 'hh:mm:ss tt') AS [Time],
        [Process],
        [Movement],
        [User Name],
        ISNULL([Source Storage Type], '') AS [Source Storage Type],
        ISNULL([Source Storage Bin], '') AS [Source Storage Bin],
        ISNULL([Destination Storage Type], '') AS [Destination Storage Type],
        ISNULL([Destination Storage Bin], '') AS [Destination Storage Bin],
        ISNULL([Material], '') AS [Material],
        ISNULL([Grid Value], '') AS [Grid Value],
        ISNULL([Stock Category], '') AS [Stock Category],
        ISNULL(TRY_CAST([Quantity] AS INT), 0) AS [Quantity]
    FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    WHERE {where_sql}
    ORDER BY CAST([Date] AS DATETIME) ASC
    """


def _build_export_query(where_sql):
    """All detail rows (no TOP cap) for server-side export."""
    return f"""
    SELECT
        FORMAT(CAST([Date] AS DATE), 'MM/dd/yyyy') AS [Date],
        FORMAT(CAST([Date] AS DATETIME), 'hh:mm:ss tt') AS [Time],
        [Process],
        [Movement],
        [User Name],
        ISNULL([Source Storage Type], '') AS [Source Storage Type],
        ISNULL([Source Storage Bin], '') AS [Source Storage Bin],
        ISNULL([Destination Storage Type], '') AS [Destination Storage Type],
        ISNULL([Destination Storage Bin], '') AS [Destination Storage Bin],
        ISNULL([Material], '') AS [Material],
        ISNULL([Grid Value], '') AS [Grid Value],
        ISNULL([Stock Category], '') AS [Stock Category],
        ISNULL(TRY_CAST([Quantity] AS INT), 0) AS [Quantity]
    FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    WHERE {where_sql}
    ORDER BY CAST([Date] AS DATETIME) ASC
    """


def get_material_export(date_from=None, date_to=None, process=None,
                        movement=None, material=None, grid=None,
                        stock_cat=None, dest_bin=None, source_bin=None):
    """Server-side export: returns units_df + full detail_df (no row cap)."""
    if not date_from or not date_to:
        date_from, date_to = _default_date_range()

    where_sql = _build_where(
        date_from, date_to, process, movement,
        material, grid, stock_cat, dest_bin, source_bin
    )

    units_df = run_query(_build_units_query(where_sql))
    detail_df = run_query(_build_export_query(where_sql))
    return units_df, detail_df


def get_material_data(date_from=None, date_to=None, process=None,
                      movement=None, material=None, grid=None,
                      stock_cat=None, dest_bin=None, source_bin=None):
    """Main entry point - returns Units chart + Detail rows + filters."""
    if not date_from or not date_to:
        date_from, date_to = _default_date_range()

    where_sql = _build_where(
        date_from, date_to, process, movement,
        material, grid, stock_cat, dest_bin, source_bin
    )

    # 1. Units chart (Quantity by Process)
    units_df = run_query(_build_units_query(where_sql))
    units_data = []
    for _, row in units_df.iterrows():
        units_data.append({
            'process': row['Process'],
            'qty': int(row['Quantity']),
        })

    # 2. Totals (fast aggregate - 1 row)
    totals_df = run_query(_build_totals_query(where_sql))
    total_rows = int(totals_df.iloc[0]['total_rows']) if not totals_df.empty else 0
    total_qty = int(totals_df.iloc[0]['total_qty']) if not totals_df.empty else 0

    # 3. Detail rows (TOP 10000 for browser performance)
    detail_df = run_query(_build_detail_query(where_sql))
    detail_data = detail_df.to_dict(orient='records')

    # 4. Filter options
    filter_opts = {
        'processes': sorted(units_df['Process'].dropna().unique().tolist()),
        'movements': sorted(detail_df['Movement'].dropna().unique().tolist()) if not detail_df.empty else [],
    }

    return {
        'units_json': json.dumps(units_data),
        'detail_json': json.dumps(detail_data, default=str),
        'detail_total': len(detail_data),
        'total_rows': total_rows,
        'total_qty': total_qty,
        'filters': filter_opts,
        'selected': {
            'date_from': date_from,
            'date_to': date_to,
        },
    }
