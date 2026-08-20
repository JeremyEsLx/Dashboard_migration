"""Delivery Deep Dive — service layer.

Two cubes:
  1. Picking: Process='PICKING', Cart Type NOT IN ('NTRF','ST01')
  2. Packing: Process='PACKING'

Both filtered to DIRECT users only (Activity Type='DIRECT').
"""
import json
import time
from datetime import date, timedelta
from concurrent.futures import ThreadPoolExecutor

from .services import (
    get_direct_users, _base_subquery, run_query, format_name,
)


def _default_date_range():
    """26th of last month to today."""
    today = date.today()
    if today.month == 1:
        date_from = date(today.year - 1, 12, 26)
    else:
        date_from = date(today.year, today.month - 1, 26)
    return date_from.strftime('%Y-%m-%d'), today.strftime('%Y-%m-%d')


def _build_picking_cube(date_from, date_to, delivery=None, user_name=None):
    """Picking cube: detail rows where Process='PICKING' and Cart Type NOT IN ('NTRF','ST01')."""
    print(f"[LMS] --- Loading Picking Cube ---")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    where = """
    WHERE [Activity Type] = 'DIRECT'
      AND [Process] = 'PICKING'
      AND ISNULL([Cart Type], '') NOT IN ('NTRF', 'ST01')
"""
    params = []
    if date_from and date_to:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        where += "  AND CAST([Date] AS DATE) <= ?\n"
        params.extend([date_from, date_to])
    elif date_from:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        params.append(date_from)

    where += f"  AND [User Name] IN ({users_str})\n"

    if delivery and delivery != 'All':
        where += "  AND [Delivery] = ?\n"
        try:
            params.append(int(delivery))
        except (ValueError, TypeError):
            params.append(delivery)
    if user_name and user_name != 'All':
        where += "  AND [User Name] = ?\n"
        params.append(user_name)

    query = f"""
        SELECT TOP 10000
            ISNULL([Process], '') AS [process],
            ISNULL([Movement], '') AS [movement],
            ISNULL([Flow_Type_Map], '') AS [flow_type],
            ISNULL(CAST([Delivery] AS VARCHAR(50)), '') AS [delivery],
            CONVERT(VARCHAR(10), CAST([Date] AS DATE), 23) AS [date],
            ISNULL([Cart Type], '') AS [cart_type],
            [User Name] AS [user_name],
            ISNULL(CAST([Source Storage Bin] AS VARCHAR(50)), '') AS [source_bin],
            ISNULL(CAST([Material] AS VARCHAR(100)), '') AS [material],
            ISNULL([Grid Value], '') AS [grid_value],
            ISNULL(TRY_CAST([Quantity] AS INT), 0) AS [quantity],
            ISNULL([Stock Category], '') AS [stock_category]
        FROM ({_base_subquery()}) AS LMS
        {where}
        ORDER BY CAST([Date] AS DATE) DESC, [User Name]
    """

    df = run_query(query, tuple(params))
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   x No picking data ({elapsed:.2f}s)")
        return []

    cube = []
    for _, row in df.iterrows():
        cube.append({
            'pr': row['process'] or '',
            'mv': row['movement'] or '',
            'ft': row['flow_type'] or '',
            'dl': row['delivery'] or '',
            'd': row['date'] or '',
            'ct': row['cart_type'] or '',
            'u': row['user_name'] or '',
            'sb': row['source_bin'] or '',
            'mt': row['material'] or '',
            'gv': row['grid_value'] or '',
            'qty': int(row['quantity'] or 0),
            'sc': row['stock_category'] or '',
        })

    print(f"[LMS]   Picking: {len(cube)} rows ({elapsed:.2f}s)")
    return cube


def _build_packing_cube(date_from, date_to, delivery=None,
                        packing_object=None, user_name=None):
    """Packing cube: detail rows where Process='PACKING'."""
    print(f"[LMS] --- Loading Packing Cube ---")
    start = time.time()

    direct_users = get_direct_users()
    users_str = ", ".join(f"'{u}'" for u in direct_users)

    where = """
    WHERE [Activity Type] = 'DIRECT'
      AND [Process] = 'PACKING'
      AND ISNULL([Flow_Type_Map], '') NOT IN (
          'AUDIT', 'DECASING', 'LAB', 'LABELLING',
          'MATERIALS HANDLER', 'PACKING EXCEPTIONS', 'VAS EXCEPTIONS')
      AND ISNULL(TRY_CAST([Quantity] AS INT), 0) != 0
      AND [User Name] NOT IN ('756777', 'CONTROLM', 'RFCDWP', 'WSDLWCS3')
"""
    params = []
    if date_from and date_to:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        where += "  AND CAST([Date] AS DATE) <= ?\n"
        params.extend([date_from, date_to])
    elif date_from:
        where += "  AND CAST([Date] AS DATE) >= ?\n"
        params.append(date_from)

    where += f"  AND [User Name] IN ({users_str})\n"

    if delivery and delivery != 'All':
        where += "  AND [Delivery] = ?\n"
        try:
            params.append(int(delivery))
        except (ValueError, TypeError):
            params.append(delivery)
    if packing_object and packing_object != 'All':
        where += "  AND [Packing Object] = ?\n"
        params.append(packing_object)
    if user_name and user_name != 'All':
        where += "  AND [User Name] = ?\n"
        params.append(user_name)

    query = f"""
        SELECT TOP 10000
            ISNULL([Process], '') AS [process],
            ISNULL([Movement], '') AS [movement],
            ISNULL([Flow_Type_Map], '') AS [flow_type],
            ISNULL(CAST([Packing Object] AS VARCHAR(50)), '') AS [packing_object],
            ISNULL([VAS Type], '') AS [vas_type],
            ISNULL(CAST([Delivery] AS VARCHAR(50)), '') AS [delivery],
            CONVERT(VARCHAR(10), CAST([Date] AS DATE), 23) AS [date],
            ISNULL([Cart Type], '') AS [cart_type],
            [User Name] AS [user_name],
            ISNULL(TRY_CAST([Quantity] AS INT), 0) AS [quantity]
        FROM ({_base_subquery()}) AS LMS
        {where}
        ORDER BY CAST([Date] AS DATE) DESC, [User Name]
    """

    df = run_query(query, tuple(params))
    elapsed = time.time() - start

    if df.empty:
        print(f"[LMS]   x No packing data ({elapsed:.2f}s)")
        return []

    cube = []
    for _, row in df.iterrows():
        cube.append({
            'pr': row['process'] or '',
            'mv': row['movement'] or '',
            'ft': row['flow_type'] or '',
            'po': row['packing_object'] or '',
            'vt': row['vas_type'] or '',
            'dl': row['delivery'] or '',
            'd': row['date'] or '',
            'ct': row['cart_type'] or '',
            'u': row['user_name'] or '',
            'qty': int(row['quantity'] or 0),
        })

    print(f"[LMS]   Packing: {len(cube)} rows ({elapsed:.2f}s)")
    return cube


def get_delivery_data(date_from=None, date_to=None, delivery=None,
                     packing_object=None, user_name=None):
    """Main entry point for Delivery Deep Dive page.

    Runs Picking and Packing cubes in parallel.
    Returns both cubes + filter dropdown values.
    """
    if not date_from and not date_to:
        date_from, date_to = _default_date_range()
    else:
        if not date_to:
            date_to = date_from
        if not date_from:
            date_from = date_to

    print(f"\n{'='*60}")
    print(f"[LMS] DELIVERY DEEP DIVE REQUEST")
    print(f"[LMS]   Date: {date_from} -> {date_to}")
    print(f"[LMS]   Delivery: {delivery or 'All'} | Packing Obj: {packing_object or 'All'}")
    print(f"{'='*60}")

    picking = []
    packing = []

    with ThreadPoolExecutor(max_workers=2) as executor:
        f_picking = executor.submit(
            _build_picking_cube, date_from, date_to, delivery, user_name)
        f_packing = executor.submit(
            _build_packing_cube, date_from, date_to, delivery, packing_object, user_name)

        try:
            picking = f_picking.result(timeout=60)
        except Exception as e:
            print(f"[LMS]   x Picking error: {e}")
        try:
            packing = f_packing.result(timeout=60)
        except Exception as e:
            print(f"[LMS]   x Packing error: {e}")

    print(f"{'='*60}\n")

    return {
        'picking_json': json.dumps(picking),
        'packing_json': json.dumps(packing),
        'picking_total': len(picking),
        'packing_total': len(packing),
        'selected': {
            'date_from': date_from or '',
            'date_to': date_to or '',
        },
    }
