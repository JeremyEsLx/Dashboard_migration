from django.shortcuts import render
from django.http import JsonResponse
from .services import get_summary_data, get_performance_data


def summary(request):
    """Render the Summary dashboard page."""
    data = get_summary_data(
        supervisor=request.GET.get('supervisor', 'All'),
        week=request.GET.get('week', 'All'),
        shift=request.GET.get('shift', 'All'),
        date_filter=request.GET.get('date'),
    )
    return render(request, 'dashboard/summary.html', {'data': data})


def summary_data(request):
    """API endpoint for AJAX filter updates."""
    data = get_summary_data(
        supervisor=request.GET.get('supervisor', 'All'),
        week=request.GET.get('week', 'All'),
        shift=request.GET.get('shift', 'All'),
        date_filter=request.GET.get('date'),
    )
    return JsonResponse(data)


def performance(request):
    """Render the Performance by User dashboard page."""
    data = get_performance_data(
        supervisor=request.GET.get('supervisor', 'All'),
        week=request.GET.get('week', 'All'),
        process=request.GET.get('process', 'All'),
        shift=request.GET.get('shift', 'All'),
        date_from=request.GET.get('date_from'),
        date_to=request.GET.get('date_to'),
    )
    return render(request, 'dashboard/performance.html', {'data': data})
