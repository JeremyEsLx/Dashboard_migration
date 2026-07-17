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
]
