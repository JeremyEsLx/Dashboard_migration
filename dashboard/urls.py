from django.urls import path
from . import views

urlpatterns = [
    path('', views.summary, name='summary'),
    path('api/summary-data/', views.summary_data, name='summary_data'),
]
