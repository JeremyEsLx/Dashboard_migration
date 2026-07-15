from django.shortcuts import render
from django.http import JsonResponse
from .services import get_summary_data, get_performance_data, get_filter_options


# ============================================================
# SHELL VIEWS — Render page instantly with skeleton placeholders
# No SQL queries for cube data. Filters are @lru_cache (instant after 1st).
# JS fetches actual data via /api/ endpoints after page loads.
# ============================================================

def summary(request):
    """Render Summary shell (instant) — JS hydrates via /api/summary/."""
    try:
        filter_options = get_filter_options()
    except Exception:
        filter_options = {'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All']}

    data = {
        'filters': {
            'supervisors': filter_options['supervisors'],
            'weeks': filter_options['weeks'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'supervisor': request.GET.get('supervisor', 'All'),
            'week': request.GET.get('week', 'All'),
            'shift': request.GET.get('shift', 'All'),
            'date': request.GET.get('date', ''),
        },
    }
    return render(request, 'dashboard/summary.html', {'data': data})


def performance(request):
    """Render Performance shell (instant) — JS hydrates via /api/performance/."""
    try:
        filter_options = get_filter_options()
    except Exception:
        filter_options = {'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All']}

    data = {
        'filters': {
            'supervisors': filter_options['supervisors'],
            'weeks': filter_options['weeks'],
            'processes': filter_options['processes'],
            'shifts': ['All', 'A', 'B', 'C', 'D'],
        },
        'selected': {
            'supervisor': request.GET.get('supervisor', 'All'),
            'week': request.GET.get('week', 'All'),
            'process': request.GET.get('process', 'All'),
            'shift': request.GET.get('shift', 'All'),
            'date_from': request.GET.get('date_from', ''),
            'date_to': request.GET.get('date_to', ''),
        },
    }
    return render(request, 'dashboard/performance.html', {'data': data})


# ============================================================
# API VIEWS — Return JSON data (called by JS after page loads)
# ============================================================

def summary_data(request):
    """API: returns full summary data (cube + KPIs) as JSON."""
    try:
        data = get_summary_data(
            supervisor=request.GET.get('supervisor', 'All'),
            week=request.GET.get('week', 'All'),
            shift=request.GET.get('shift', 'All'),
            date_filter=request.GET.get('date'),
        )
        return JsonResponse(data)
    except Exception as e:
        return JsonResponse({'error': str(e), 'cube_json': '[]'}, status=200)


def performance_data(request):
    """API: returns performance cubes (process + user) as JSON."""
    try:
        data = get_performance_data(
            supervisor=request.GET.get('supervisor', 'All'),
            week=request.GET.get('week', 'All'),
            process=request.GET.get('process', 'All'),
            shift=request.GET.get('shift', 'All'),
            date_from=request.GET.get('date_from'),
            date_to=request.GET.get('date_to'),
        )
        return JsonResponse(data)
    except Exception as e:
        return JsonResponse({'error': str(e), 'cube_json': '[]', 'user_cube_json': '[]'}, status=200)
