from django.shortcuts import render
from django.http import JsonResponse, HttpResponse
from .services import get_summary_data, get_performance_data, get_process_data, get_strongstart_data, get_strongfinish_data, get_noactivity_data
from .services_userperf import get_userperformance_data
from .services_delivery import get_delivery_data
from .services_material import get_material_data, get_material_export


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
        import traceback
        traceback.print_exc()
        return JsonResponse({
            'error': str(e),
            'cube_json': '[]',
            'total': 0,
            'filters': {
                'supervisors': ['All'], 'weeks': ['All'], 'processes': ['All'],
                'shifts': ['All', 'A', 'B', 'C', 'D'], 'full_names': [],
                'movements': ['All'], 'hours': ['All'],
            },
            'selected': {'date_from': '', 'date_to': ''},
            'has_filter': False,
        }, status=200)


# ============================================================
# DELIVERY DEEP DIVE
# ============================================================

def deliverydeepdive(request):
    """Render Delivery Deep Dive shell."""
    return render(request, 'dashboard/deliverydeepdive.html', {'data': {'selected': {}}})


def deliverydeepdive_data(request):
    """API: returns Picking + Packing cubes as JSON."""
    try:
        data = get_delivery_data(
            date_from=request.GET.get('date_from'),
            date_to=request.GET.get('date_to'),
            delivery=request.GET.get('delivery'),
            packing_object=request.GET.get('packing_object'),
            user_name=request.GET.get('user_name'),
        )
        return JsonResponse(data)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({
            'error': str(e),
            'picking_json': '[]',
            'packing_json': '[]',
            'picking_total': 0,
            'packing_total': 0,
            'selected': {'date_from': '', 'date_to': ''},
        }, status=200)


# ============================================================
# DETAIL BY MATERIAL
# ============================================================

def detailbymaterial(request):
    """Render Detail by Material shell (instant, no SQL)."""
    data = {
        'selected': {
            'date_from': request.GET.get('date_from', ''),
            'date_to': request.GET.get('date_to', ''),
        },
    }
    return render(request, 'dashboard/detailbymaterial.html', {'data': data})


def detailbymaterial_data(request):
    """API: returns Units chart data as JSON."""
    try:
        data = get_material_data(
            date_from=request.GET.get('date_from'),
            date_to=request.GET.get('date_to'),
            process=request.GET.get('process'),
            movement=request.GET.get('movement'),
            material=request.GET.get('material'),
            grid=request.GET.get('grid'),
            stock_cat=request.GET.get('stock_cat'),
            dest_bin=request.GET.get('dest_bin'),
            source_bin=request.GET.get('source_bin'),
        )
        return JsonResponse(data)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JsonResponse({
            'error': str(e),
            'units_json': '[]',
            'filters': {},
            'selected': {'date_from': '', 'date_to': ''},
        }, status=200)


def detailbymaterial_export(request):
    """Server-side XLSX export: 2 sheets (Units + Details). Uses pandas for speed."""
    import io
    try:
        units_df, detail_df = get_material_export(
            date_from=request.GET.get('date_from'),
            date_to=request.GET.get('date_to'),
            process=request.GET.get('process'),
            movement=request.GET.get('movement'),
            material=request.GET.get('material'),
            grid=request.GET.get('grid'),
            stock_cat=request.GET.get('stock_cat'),
            dest_bin=request.GET.get('dest_bin'),
            source_bin=request.GET.get('source_bin'),
        )

        df_from = request.GET.get('date_from', '')
        df_to = request.GET.get('date_to', '')
        fname = f'LMS_DetailByMaterial_{df_from}_to_{df_to}.xlsx'

        # Build Excel in memory with 2 sheets using pandas (C-optimized)
        buffer = io.BytesIO()
        with __import__('pandas').ExcelWriter(buffer, engine='openpyxl') as writer:
            # Sheet 1: Units by Process
            units_df.to_excel(writer, sheet_name='Units by Process', index=False)
            # Sheet 2: Details (pandas to_excel is 20x faster than row-by-row)
            detail_df.to_excel(writer, sheet_name='Details', index=False)
        buffer.seek(0)

        response = HttpResponse(
            buffer.getvalue(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        response['Content-Disposition'] = f'attachment; filename="{fname}"'
        return response
    except Exception as e:
        import traceback
        traceback.print_exc()
        return HttpResponse(f'Export error: {e}', status=500)


# ============================================================
# PLACEHOLDER VIEWS — WIP dashboards (page not found -> WIP page)
# ============================================================

_PLACEHOLDER_DASHBOARDS = {
    'frames': 'Frames Hourly WIP',
    'wearables': 'Wearables Hourly WIP',
    'c2s': 'C2S',
    'c2b': 'C2B',
    'merge': 'Merge',
    'volume': 'Volume',
    'cyclecount': 'Cycle Count',
    'allocation': 'Allocation',
    'hr': 'HR',
}


def placeholder_dashboard(request, dashboard_key):
    """Generic placeholder view for dashboards under development."""
    from django.template import Template, Context
    from django.template.loader import get_template

    name = _PLACEHOLDER_DASHBOARDS.get(dashboard_key, dashboard_key.title())
    url = f'/{dashboard_key}/'

    # Render inline because editAsset can't write Django templates with {{ }}
    tpl_str = '''{%% extends "dashboard/base.html" %%}
{%% load static %%}
{%% block title %%}%s - MX03 Warehouse{%% endblock %%}
{%% block sidebar %%}
<div class="sidebar-section">%s</div>
<a href="%s" class="active">
    <span class="sidebar-icon">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="12" height="12" rx="2"/><path d="M5 8h6"/></svg>
    </span>
    Dashboard
</a>
{%% endblock %%}
{%% block content %%}
<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:60vh;text-align:center;color:#64748b;">
    <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5" style="margin-bottom:24px;"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 12h6"/><path d="M12 9v6"/></svg>
    <h2 style="font-size:24px;font-weight:600;color:#334155;margin-bottom:8px;">%s</h2>
    <p style="font-size:15px;max-width:400px;line-height:1.6;">This dashboard is under development.<br>Check back soon for updates.</p>
</div>
{%% endblock %%}''' % (name, name, url, name)

    template = Template(tpl_str)
    html = template.render(Context({'request': request}))
    return HttpResponse(html)
