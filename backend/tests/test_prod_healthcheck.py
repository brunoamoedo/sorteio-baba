"""O caminho que o healthcheck do container percorre, com as settings de prod.

Duas vezes o deploy parou em `Container ... is unhealthy` com o worker e o beat
do Celery se recusando a subir, e as duas causas moram nas settings de
**produção**: `ALLOWED_HOSTS` sem `localhost` (400 DisallowedHost) e o
`SECURE_SSL_REDIRECT` mandando o healthcheck para https, num gunicorn que não
fala TLS.

O `tests/test_health.py` passava nas duas ocasiões — ele roda com
`config.settings.test`, onde nem o redirect nem o `ALLOWED_HOSTS` restrito
existem. Testar o endpoint não era o mesmo que testar o healthcheck.
"""
import importlib

import pytest
from django.test import Client, override_settings

#: Um `.env.prod` plausível — com o domínio sozinho em `DJANGO_ALLOWED_HOSTS`,
#: que é como ele fica num servidor instalado antes da correção.
ENV_PROD = {
    "DJANGO_SECRET_KEY": "chave-so-deste-teste",
    "DATABASE_URL": "postgres://u:p@postgres:5432/db",
    "CORS_ALLOWED_ORIGINS": "https://exemplo.com.br",
    "DJANGO_ALLOWED_HOSTS": "exemplo.com.br",
}


@pytest.fixture
def prod(monkeypatch):
    """As settings de produção de verdade, importadas com um env realista."""
    for chave, valor in ENV_PROD.items():
        monkeypatch.setenv(chave, valor)
    monkeypatch.delenv("DJANGO_SECURE_SSL_REDIRECT", raising=False)
    return importlib.reload(importlib.import_module("config.settings.prod"))


def _resposta(prod, caminho):
    """Requisição como a do healthcheck: http puro, `Host: localhost`."""
    with override_settings(
        ALLOWED_HOSTS=prod.ALLOWED_HOSTS,
        SECURE_SSL_REDIRECT=prod.SECURE_SSL_REDIRECT,
        SECURE_REDIRECT_EXEMPT=prod.SECURE_REDIRECT_EXEMPT,
    ):
        return Client().get(caminho, secure=False, HTTP_HOST="localhost")


def test_localhost_e_aceito_mesmo_fora_do_env(prod):
    assert "localhost" in prod.ALLOWED_HOSTS
    assert "127.0.0.1" in prod.ALLOWED_HOSTS
    assert "exemplo.com.br" in prod.ALLOWED_HOSTS


def test_redirect_para_https_vem_ligado_por_padrao(prod):
    """Se este virar False sozinho, os dois testes abaixo param de provar algo."""
    assert prod.SECURE_SSL_REDIRECT is True


def test_healthcheck_responde_200(prod):
    resposta = _resposta(prod, "/api/health/")

    assert resposta.status_code == 200
    assert resposta.json() == {"status": "ok"}


def test_o_resto_da_api_continua_indo_para_https(prod):
    """A isenção vale só para o healthcheck — não é um buraco no redirect."""
    resposta = _resposta(prod, "/api/players/")

    assert resposta.status_code == 301
    assert resposta["Location"].startswith("https://")
