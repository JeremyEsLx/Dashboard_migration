import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv('DJANGO_SECRET_KEY', 'change-me-in-production')

DEBUG = os.getenv('DJANGO_DEBUG', 'True').lower() == 'true'

ALLOWED_HOSTS = os.getenv('ALLOWED_HOSTS', '*').split(',')

INSTALLED_APPS = [
    'django.contrib.staticfiles',
    'dashboard',
]

MIDDLEWARE = [
    'django.middleware.gzip.GZipMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'lms_dashboard.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
            ],
        },
    },
]

WSGI_APPLICATION = 'lms_dashboard.wsgi.application'

# No Django database — this app is stateless, queries SQL Server directly
DATABASES = {}

# === SQL Server Connection (LMS data source) ===
SQL_SERVER = os.getenv('SQL_SERVER', '')
SQL_DATABASE = os.getenv('SQL_DATABASE', 'LMS_Database')
SQL_USERNAME = os.getenv('SQL_USERNAME', '')
SQL_PASSWORD = os.getenv('SQL_PASSWORD', '')
SQL_DRIVER = os.getenv('SQL_DRIVER', '{ODBC Driver 17 for SQL Server}')

# === SQL Server Connection (Business Intelligence - Headcount/Roster) ===
BI_SERVER = os.getenv('BI_SERVER', '')
BI_DATABASE = os.getenv('BI_DATABASE', 'Business_Intelligence')
BI_USERNAME = os.getenv('BI_USERNAME', '')
BI_PASSWORD = os.getenv('BI_PASSWORD', '')

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'America/Tijuana'
USE_I18N = True
USE_TZ = True

# === Static Files ===
STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# In DEBUG mode: Django's dev server serves static files directly from app dirs.
# In production: WhiteNoise serves pre-collected files with compression + caching.
if DEBUG:
    STATICFILES_STORAGE = 'django.contrib.staticfiles.storage.StaticFilesStorage'
else:
    STATICFILES_STORAGE = 'whitenoise.storage.CompressedStaticFilesStorage'

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
