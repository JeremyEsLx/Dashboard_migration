from django.apps import AppConfig
import threading


class DashboardConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'dashboard'

    def ready(self):
        """Pre-warm caches in a background thread so the first user
        doesn't eat the 20+ second cold-start penalty."""
        def _warm_caches():
            try:
                from .services import get_direct_users, get_filter_options
                from .services_userperf import _get_full_names, _get_movements
                print("[LMS] Pre-warming caches (background thread)...")
                get_direct_users()
                get_filter_options()
                _get_full_names()
                _get_movements()
                print("[LMS] All caches warmed successfully.")
            except Exception as e:
                print(f"[LMS] Cache pre-warm failed (non-fatal): {e}")

        # Run in background thread so server startup isn't blocked
        threading.Thread(target=_warm_caches, daemon=True).start()
