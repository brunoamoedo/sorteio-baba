from pathlib import Path

from .base import *  # noqa: F401,F403
from .base import env

DEBUG = False

# PostgreSQL, o mesmo banco de todos os ambientes.
#
# A suíte rodava em SQLite em memória, e essa diferença escondia problemas
# reais: constraints parciais (`UniqueConstraint` com `condition`), tipos e
# comportamento transacional não são iguais nos dois bancos. Foi exatamente por
# aí que a migration da lista de espera passou verde nos testes e quebrou o
# dashboard no Postgres do Docker.
#
# O banco de teste (`test_pelada`) é criado e destruído pelo pytest-django; a
# base apontada aqui nunca é tocada.
DATABASES = {
    "default": env.db(
        "TEST_DATABASE_URL",
        default="postgres://pelada:pelada@localhost:5435/pelada",
    )
}

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]

MEDIA_ROOT = str(Path(env("TMPDIR", default="/tmp")) / "pelada-test-media")
