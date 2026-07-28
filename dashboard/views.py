from django.shortcuts import render
from django.http import JsonResponse
from .services import get_summary_data, get_performance_data, get_process_data, get_strongstart_data, get_strongfinish_data, get_noactivity_data
from .services_userperf import get_userperformance_data


# ============================================================
# SHELL VIEWS — ZERO SQL queries. Page renders in <50ms.
# Only passes URL params for selected state. Dropdowns start with
# just "All"; JS populates full options from the API response.
# ============================================================

def summary(request):
    """Render Summary shell (instant, no SQL) — JS hydrates via /api/summary/."""
    data = {
        'selected': {
            'supervisor': request.GET.get('supervisor', 'All'),
            'week': request.GET.get('week', 'All'),
            'shift': request.GET.get('shift', 'All'),
            'date': request.GET.get('date', ''),
        },
    }
    return render(request, 'dashboard/summary.html', {'data': data})


def performance(request):
    """Render Performance shell (instant, no SQL) — JS hydrates via /api/performance/."""
    data = {
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


def process_performance(request):
    """Render Performance by Process shell (instant, no SQL) — JS hydrates via /api/process/."""
    data = {
        'selected': {
            'week': request.GET.get('week', 'All'),
            'process': request.GET.get('process', 'All'),
            'shift': request.GET.get('shift', 'All'),
            'date_from': request.GET.get('date_from', ''),
            'date_to': request.GET.get('date_to', ''),
        },
    }
    return render(request, 'dashboard/process.html', {'data': data})


def process_performance_data(request):
    """API: returns process cube as JSON (no user cube — faster)."""
    try:
        data = get_process_data(
            week=request.GET.get('week', 'All'),
            process=request.GET.get('process', 'All'),
            shift=request.GET.get('shift', 'All'),
            date_from=request.GET.get('date_from'),
            date_to=request.GET.get('date_to'),
        )
        return JsonResponse(data)
    except Exception as e:
        return JsonResponse({'error': str(e), 'cube_json': '[]'}, status=200)


def strongstart(request):
    """Render Strong Start shell (instant, no SQL) — JS hydrates via /api/strongstart/."""
    data = {
        'selected': {
            'supervisor': request.GET.get('supervisor', 'All'),
            'shift': request.GET.get('shift', 'All'),
            'date_from': request.GET.get('date_from', ''),
            'date_to': request.GET.get('date_to', ''),
        },
    }
    return render(request, 'dashboard/strongstart.html', {'data': data})


def strongstart_data(request):
    """API: returns strong start cube as JSON."""
    try:
        data = get_strongstart_data(
            supervisor=request.GET.get('supervisor', 'All'),
            shift=request.GET.get('shift', 'All'),
            date_from=request.GET.get('date_from'),
            date_to=request.GET.get('date_to'),
        )
        return JsonResponse(data)
    except Exception as e:
        return JsonResponse({'error': str(e), 'cube_json': '[]'}, status=200)


def strongfinish(request):
    """Render Strong Finish shell (instant, no SQL) — JS hydrates via /api/strongfinish/."""
    data = {
        'selected': {
            'supervisor': request.GET.get('supervisor', 'All'),
            'shift': request.GET.get('shift', 'All'),
            'date_from': request.GET.get('date_from', ''),
            'date_to': request.GET.get('date_to', ''),
        },
    }
    return render(request, 'dashboard/strongfinish.html', {'data': data})


def strongfinish_data(request):
    """API: returns strong finish cube as JSON."""
    try:
        data = get_strongfinish_data(
            supervisor=request.GET.get('supervisor', 'All'),
            shift=request.GET.get('shift', 'All'),
            date_from=request.GET.get('date_from'),
            date_to=request.GET.get('date_to'),
        )
        return JsonResponse(data)
    except Exception as e:
        return JsonResponse({'error': str(e), 'cube_json': '[]'}, status=200)


def noactivity(request):
    """Render No Activity Between shell (instant, no SQL) — JS hydrates via /api/noactivity/."""
    data = {
        'selected': {
            'supervisor': request.GET.get('supervisor', 'All'),
            'shift': request.GET.get('shift', 'All'),
            'date_from': request.GET.get('date_from', ''),
            'date_to': request.GET.get('date_to', ''),
        },
    }
    return render(request, 'dashboard/noactivity.html', {'data': data})


def noactivity_data(request):
    """API: returns no activity between cube as JSON."""
    try:
        data = get_noactivity_data(
            supervisor=request.GET.get('supervisor', 'All'),
            shift=request.GET.get('shift', 'All'),
            date_from=request.GET.get('date_from'),
            date_to=request.GET.get('date_to'),
        )
        return JsonResponse(data)
    except Exception as e:
        return JsonResponse({'error': str(e), 'cube_json': '[]'}, status=200)


def userperformance(request):
    """Render User Performance shell (instant, no SQL) — JS hydrates via /api/userperformance/."""
    data = {
        'selected': {
            'date_from': request.GET.get('date_from', ''),
            'date_to': request.GET.get('date_to', ''),
        },
    }
    return render(request, 'dashboard/userperformance.html', {'data': data})


def userperformance_data(request):
    """API: returns user performance data as JSON (search-first, server-side filters)."""
    try:
        data = get_userperformance_data(
            date_from=request.GET.get('date_from'),
            date_to=request.GET.get('date_to'),
            supervisor=request.GET.get('supervisor'),
            user_name=request.GET.get('user_name'),
            process=request.GET.get('process'),
            movement=request.GET.get('movement'),
            shift=request.GET.get('shift'),
            hour=request.GET.get('hour'),
            week=request.GET.get('week'),
            full_name=request.GET.get('full_name'),
        )
        return JsonResponse(data)
    except Exception as e:
        return JsonResponse({'error': str(e), 'cube_json': '[]', 'total': 0}, status=200)
