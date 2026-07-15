from django.urls import path
from . import views

urlpatterns = [
    path('', views.summary, name='summary'),
    path('api/summary/', views.summary_data, name='summary_data'),
    path('performance/', views.performance, name='performance'),
    path('api/performance/', views.performance_data, name='performance_data'),
]
