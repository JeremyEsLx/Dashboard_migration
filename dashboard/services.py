"""Data service layer — connects to Databricks SQL or reads from CSV/local DB.

This module is where you'll plug in your actual data source.
For now it returns SAMPLE data matching your Power BI Summary page.
Replace with real queries once your data is loaded into Delta tables.
"""
import pandas as pd
from django.conf import settings


def get_summary_data(supervisor='All', week='All', shift='All', date=None):
    """
    Returns a dict with all data needed for the Summary dashboard.
    Replace the sample data below with actual Databricks SQL queries.
    """
    # --- SAMPLE DATA (replace with real queries) ---
    data = {
        'total_uph': 207,
        'uph_target': 200,
        'uph_percent': 104,
        'actual_time': 185.14,
        'standard_time': 192.11,
        'productivity': -4,
        'quantity_by_process': {
            'PUTAWAY': 13000,
            'REPLENISHMENT': 13000,
            'PICKING': 11000,
            'PACKING': 1000,
        },
        'uph_vs_target_by_process': {
            'REPLENISHMENT': 234,
            'PUTAWAY': 133,
            'RECEIVING': 100,
            'PICKING': 95,
            'PACKING': 28,
        },
        'productivity_by_process': {
            'REPLENISHMENT': -57,
            'PUTAWAY': -25,
            'RECEIVING': 0,
            'PICKING': 5,
            'PACKING': 261,
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
    filepath = settings.DATA_DIR / filename
    if filepath.exists():
        return pd.read_csv(filepath)
    return pd.DataFrame()
