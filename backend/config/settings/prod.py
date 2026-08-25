from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False

STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

DATABASES = {
    "default": env.db("DATABASE_URL"),
}

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS")

SECURE_SSL_REDIRECT = env.bool("DJANGO_SECURE_SSL_REDIRECT", default=True)
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 7
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
