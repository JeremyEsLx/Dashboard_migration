from django.urls import path
from . import views

urlpatterns = [
    path('', views.summary, name='summary'),
    path('api/summary/', views.summary_data, name='summary_data'),
    path('performance/', views.performance, name='performance'),
    path('api/performance/', views.performance_data, name='performance_data'),
    path('process/', views.process_performance, name='process_performance'),
    path('api/process/', views.process_performance_data, name='process_performance_data'),
    path('strongstart/', views.strongstart, name='strongstart'),
    path('api/strongstart/', views.strongstart_data, name='strongstart_data'),
    path('strongfinish/', views.strongfinish, name='strongfinish'),
    path('api/strongfinish/', views.strongfinish_data, name='strongfinish_data'),
    path('noactivity/', views.noactivity, name='noactivity'),
    path('api/noactivity/', views.noactivity_data, name='noactivity_data'),
    path('userperformance/', views.userperformance, name='userperformance'),
    path('api/userperformance/', views.userperformance_data, name='userperformance_data'),
    path('deliverydeepdive/', views.deliverydeepdive, name='deliverydeepdive'),
    path('api/deliverydeepdive/', views.deliverydeepdive_data, name='deliverydeepdive_data'),
    path('detailbymaterial/', views.detailbymaterial, name='detailbymaterial'),
    path('api/detailbymaterial/', views.detailbymaterial_data, name='detailbymaterial_data'),
    path('api/detailbymaterial/export/', views.detailbymaterial_export, name='detailbymaterial_export'),
    path('usersummary/', views.usersummary, name='usersummary'),
    path('api/usersummary/', views.usersummary_data, name='usersummary_data'),
    path('api/usersummary/filters/', views.usersummary_filters, name='usersummary_filters'),

    # MX03 SPAC Performance
    path('spacuph/', views.spac_uph, name='spac_uph'),
    path('api/spacuph/', views.spac_uph_data, name='spac_uph_data'),
    path('spacperformance/', views.spac_performance, name='spac_performance'),
    path('spacperfbyuser/', views.spac_perf_by_user, name='spac_perf_by_user'),
    path('spacdetails/', views.spac_details, name='spac_details'),
    path('api/spacdetails/', views.spac_details_data, name='spac_details_data'),

    # Placeholder dashboards (WIP)
    path('frames/', views.placeholder_dashboard, {'dashboard_key': 'frames'}, name='frames'),
    path('wearables/', views.placeholder_dashboard, {'dashboard_key': 'wearables'}, name='wearables'),
    path('c2s/', views.placeholder_dashboard, {'dashboard_key': 'c2s'}, name='c2s'),
    path('c2b/', views.placeholder_dashboard, {'dashboard_key': 'c2b'}, name='c2b'),
    path('merge/', views.placeholder_dashboard, {'dashboard_key': 'merge'}, name='merge'),
    path('volume/', views.placeholder_dashboard, {'dashboard_key': 'volume'}, name='volume'),
    path('cyclecount/', views.placeholder_dashboard, {'dashboard_key': 'cyclecount'}, name='cyclecount'),
    path('allocation/', views.placeholder_dashboard, {'dashboard_key': 'allocation'}, name='allocation'),
    path('hr/', views.placeholder_dashboard, {'dashboard_key': 'hr'}, name='hr'),
]
