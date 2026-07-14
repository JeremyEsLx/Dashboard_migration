"""Data service layer — queries SQL Server for LMS data.

For now, returns SAMPLE data matching the Power BI Summary page.
Once ready, replace with actual pyodbc queries to your SQL Server.
"""
import pandas as pd


def get_summary_data(supervisor='All', week='All', shift='All', date=None):
    """
    Returns a dict with all data needed for the Summary dashboard.
    Replace the sample data below with actual SQL Server queries.
    """
    # --- SAMPLE DATA (matches Power BI screenshot) ---
    data = {
        'total_uph': 233,
        'uph_target': 189,
        'uph_percent': 124,
        'actual_time': 352.94,
        'standard_time': 436.19,
        'productivity': -19,
        'quantity_by_process': {
            'PICKING': 27000,
            'PUTAWAY': 25000,
            'REPLENISHMENT': 17000,
            'RECEIVING': 9000,
            'PACKING': 4000,
        },
        'uph_vs_target_by_process': {
            'REPLENISHMENT': 254,
            'PUTAWAY': 123,
            'PICKING': 118,
            'PACKING': 89,
            'RECEIVING': 81,
        },
        'productivity_by_process': {
            'REPLENISHMENT': -61,
            'PUTAWAY': -19,
            'PICKING': -16,
            'PACKING': 13,
            'RECEIVING': 24,
        },
        'filters': {
            'supervisors': ['All', 'Supervisor A', 'Supervisor B'],
            'weeks': ['All', 'Week 28', 'Week 27', 'Week 26'],
            'shifts': ['All', '1st', '2nd', '3rd'],
        },
    }
    return data


def load_csv_data(filename: str) -> pd.DataFrame:
    """
    Load a CSV file from the /data directory.
    Place your Power BI exported CSVs there.
    """
    from django.conf import settings
    filepath = settings.DATA_DIR / filename
    if filepath.exists():
        return pd.read_csv(filepath)
    return pd.DataFrame()
