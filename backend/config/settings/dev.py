from .base import *  # noqa: F401,F403
from .base import env

DEBUG = True

ALLOWED_HOSTS = ["*"]

# PostgreSQL em todos os ambientes, sem exceção.
#
# Antes havia um fallback silencioso para SQLite quando `DATABASE_URL` não
# estava definida. Parecia conveniente, mas criava dois bancos diferentes para o
# mesmo código: o desenvolvimento local rodava em SQLite enquanto o Docker e a
# produção rodavam em Postgres. Diferenças reais entre os dois (constraints
# parciais, tipos, transações) só apareciam em runtime, no ambiente errado.
#
# O padrão aponta para a porta que o docker-compose publica no host; dentro do
# Compose, o `environment:` do serviço tem precedência e usa `postgres:5432`.
DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default="postgres://pelada:pelada@localhost:5435/pelada",
    )
}

CORS_ALLOW_ALL_ORIGINS = True
