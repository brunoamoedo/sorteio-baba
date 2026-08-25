import structlog
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

logger = structlog.get_logger(__name__)


class DomainError(Exception):
    """Erro de regra de negócio levantado pela camada de services/domain."""


class InsufficientPlayersError(DomainError):
    pass


class MatchFullError(DomainError):
    """A partida já atingiu a capacidade configurada (`max_players`)."""


def custom_exception_handler(exc, context):
    """Mantém **intacto** o corpo de erro nativo do DRF.

    Antes, toda resposta era re-embrulhada em `{"detail": <corpo>}`, o que
    transformava um erro de campo (`{"teams_count": ["..."]}`) em
    `{"detail": {"teams_count": ["..."]}}` e um 401 em `{"detail": {"detail": ...}}`.
    O frontend não tinha como extrair a mensagem real e todas as telas caíam em
    textos genéricos ("Não foi possível salvar"). O contrato agora é o padrão do
    DRF: erros de campo vêm por campo, erros gerais vêm em `detail`.
    """
    if isinstance(exc, DomainError):
        logger.warning(
            "domain_error",
            detail=str(exc),
            view=context.get("view").__class__.__name__ if context.get("view") else None,
        )
        return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    response = drf_exception_handler(exc, context)

    if response is not None:
        logger.warning(
            "api_exception",
            status_code=response.status_code,
            detail=response.data,
            view=context.get("view").__class__.__name__ if context.get("view") else None,
        )

    return response
