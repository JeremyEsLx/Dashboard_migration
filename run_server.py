"""Production server entry point using Waitress.

Usage:
    python run_server.py

Configuration (via .env file or environment variables):
    HOST         - Bind address (default: 0.0.0.0 = all interfaces)
    PORT         - Port number (default: 8000)
    THREADS      - Worker threads (default: 8)
    DJANGO_DEBUG - Must be 'False' for production

To install as a Windows Service (auto-start on reboot):
    1. Download nssm: https://nssm.cc/download
    2. nssm install LMS_Dashboard "C:\path\to\venv\Scripts\python.exe" "C:\path\to\run_server.py"
    3. nssm set LMS_Dashboard AppDirectory "C:\path\to\Dashboard_migration"
    4. nssm start LMS_Dashboard
"""
import os
import sys
from pathlib import Path

# Ensure project root is on sys.path
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

# Load .env before Django setup
from dotenv import load_dotenv
load_dotenv(BASE_DIR / '.env')

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'lms_dashboard.settings')

import django
django.setup()

from waitress import serve
from lms_dashboard.wsgi import application

if __name__ == '__main__':
    host = os.getenv('HOST', '0.0.0.0')
    port = int(os.getenv('PORT', '8000'))
    threads = int(os.getenv('THREADS', '8'))

    print(f'\n{"=" * 60}')
    print(f'  LMS Dashboard — Production Server (Waitress)')
    print(f'  Listening on http://{host}:{port}/')
    print(f'  Threads: {threads}')
    print(f'  Debug: {os.getenv("DJANGO_DEBUG", "True")}')
    print(f'{"=" * 60}\n')

    serve(
        application,
        host=host,
        port=port,
        threads=threads,
        url_scheme='http',
        channel_timeout=120,
        cleanup_interval=30,
    )
