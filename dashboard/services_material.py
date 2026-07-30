"""Detail by Material — service layer.

Queries LMS table for material-level detail with filters.
Returns:
  - units_chart: Quantity aggregated by Process (for bar chart)
  - filter_options: distinct values for each dropdown filter
"""
import json
from datetime import date, timedelta
from .services import run_query, get_direct_users


def _default_date_range():
    """Default: 26th of last month to today."""
    today = date.today()
    if today.day >= 26:
        date_from = today.replace(day=26) - timedelta(days=today.day)
    else:
        first_this = today.replace(day=1)
        last_month = first_this - timedelta(days=1)
        date_from = last_month.replace(day=26)
    return str(date_from), str(today)


def _build_units_query(date_from, date_to, process=None, movement=None,
                       material=None, grid=None, stock_cat=None,
                       dest_bin=None, source_bin=None):
    """Aggregate Quantity by Process for the Units chart."""
    users = get_direct_users()
    users_str = ','.join(f"'{u}'" for u in users)

    where_clauses = [
        "[Activity Type] = 'DIRECT'",
        f"[User Name] IN ({users_str})",
        f"CAST([Date] AS DATE) >= '{date_from}'",
        f"CAST([Date] AS DATE) <= '{date_to}'",
    ]

    if process:
        where_clauses.append(f"[Process] = '{process}'")
    if movement:
        where_clauses.append(f"[Movement] = '{movement}'")
    if material:
        where_clauses.append(f"[Material] = '{material}'")
    if grid:
        where_clauses.append(f"[Grid Value] = '{grid}'")
    if stock_cat:
        where_clauses.append(f"[Stock Category] = '{stock_cat}'")
    if dest_bin:
        where_clauses.append(f"[Destination Storage Bin] = '{dest_bin}'")
    if source_bin:
        where_clauses.append(f"[Source Storage Bin] = '{source_bin}'")

    where_sql = ' AND '.join(where_clauses)

    return f"""
    SELECT
        [Process],
        SUM(ISNULL(TRY_CAST([Quantity] AS INT), 0)) AS Quantity
    FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    WHERE {where_sql}
    GROUP BY [Process]
    ORDER BY Quantity DESC
    """


def _build_filter_options_query(date_from, date_to):
    """Get distinct filter values within the date range."""
    users = get_direct_users()
    users_str = ','.join(f"'{u}'" for u in users)

    return f"""
    SELECT DISTINCT
        ISNULL([Process], '') AS [Process],
        ISNULL([Movement], '') AS [Movement]
    FROM [LMS_Database].[dbo].[LMS_PBI_Dashboard_MX03] WITH (NOLOCK)
    WHERE [Activity Type] = 'DIRECT'
      AND [User Name] IN ({users_str})
      AND CAST([Date] AS DATE) >= '{date_from}'
      AND CAST([Date] AS DATE) <= '{date_to}'
    """


def get_material_data(date_from=None, date_to=None, process=None,
                      movement=None, material=None, grid=None,
                      stock_cat=None, dest_bin=None, source_bin=None):
    """Main entry point — returns Units chart data + filter options."""
    if not date_from or not date_to:
        date_from, date_to = _default_date_range()

    # 1. Units chart (Quantity by Process)
    units_query = _build_units_query(
        date_from, date_to, process, movement,
        material, grid, stock_cat, dest_bin, source_bin
    )
    units_df = run_query(units_query)

    units_data = []
    for _, row in units_df.iterrows():
        units_data.append({
            'process': row['Process'],
            'qty': int(row['Quantity']),
        })

    # 2. Filter options from the units result (quick)
    filter_opts = {
        'processes': sorted(units_df['Process'].dropna().unique().tolist()),
    }

    return {
        'units_json': json.dumps(units_data),
        'filters': filter_opts,
        'selected': {
            'date_from': date_from,
            'date_to': date_to,
        },
    }
