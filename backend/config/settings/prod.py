from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False

STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=[])

DATABASES = {
    "default": env.db("DATABASE_URL"),
}

CORS_ALLOWED_ORIGINS = env.list("CORS_ALLOWED_ORIGINS")

# Quem termina o TLS é o proxy (Apache), não o gunicorn: o container recebe
# HTTP puro. Sem esta linha, `request.is_secure()` é sempre falso e o
# `SECURE_SSL_REDIRECT` abaixo devolve um 301 para https em **toda** requisição
# — inclusive nas que já vieram por https — fechando um loop de redirecionamento
# que derruba o site inteiro. O proxy precisa enviar o cabeçalho correspondente
# (`RequestHeader set X-Forwarded-Proto "https"` no VirtualHost).
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# O Django recusa POST no admin quando a origem https não está declarada — o
# `Referer` chega como https e ele compara com o host, que vem do proxy. Sem
# isto, entrar no `/admin/` em produção dá "CSRF verification failed".
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[])

SECURE_SSL_REDIRECT = env.bool("DJANGO_SECURE_SSL_REDIRECT", default=True)

# O healthcheck do container fica de fora do redirecionamento para https.
#
# Ele chama `http://localhost:8000/api/health/` **por dentro**, direto no
# gunicorn, sem passar pelo Apache — logo sem o `X-Forwarded-Proto`. Sem esta
# isencao o Django responde 301 para `https://localhost:8000/...`, o cliente
# segue o redirecionamento, e o gunicorn (que nao fala TLS) devolve
# `SSL: WRONG_VERSION_NUMBER`. O healthcheck nunca fica verde, o container
# aparece como `unhealthy` e o worker e o beat do Celery se recusam a subir,
# porque dependem dele estar saudavel.
#
# A regex casa contra `request.path` sem a barra inicial.
SECURE_REDIRECT_EXEMPT = [r"^api/health/$"]
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 60 * 60 * 24 * 7
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
