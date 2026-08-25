"""Bloqueio do primeiro acesso.

Enquanto a senha for a temporária, a conta **autentica mas não usa** o sistema.

## Por que middleware, e não uma permissão do DRF

A tentação era registrar uma permissão em `DEFAULT_PERMISSION_CLASSES`. Não
funciona: no DRF, uma view que declara `permission_classes` (ou sobrescreve
`get_permissions`) **substitui a lista inteira**, e este projeto faz isso em 26
lugares — cada `ViewSet` financeiro, `MatchViewSet`, `PlayerViewSet`,
`AuditViewSet`. O bloqueio valeria só onde ninguém tivesse pensado em
permissões, ou seja, quase em lugar nenhum.

O middleware roda **antes** da view, não importa o que ela declare. É a
diferença entre uma regra que vale e uma que parece valer.

## O que fica de fora, e por quê

- **`token/`** — a pessoa precisa autenticar para então trocar a senha.
  Bloquear aqui a deixaria sem caminho de volta.
- **`token/refresh/`** — sem ele a sessão morre no meio da troca.
- **`change-password/`** — é o caminho para sair do estado.
- **`me/`** — a tela precisa saber quem está trocando a senha.

Tudo o mais responde `403` com `code: "must_change_password"`, que é o que o
frontend usa para redirecionar. Comparar a mensagem seria frágil.
"""

from django.http import JsonResponse

#: Sufixos liberados. `endswith` para não depender do prefixo (`/api/`) nem de
#: o roteador mudar de lugar.
EXEMPT_SUFFIXES = (
    "/auth/change-password/",
    "/auth/me/",
    "/auth/token/",
    "/auth/token/refresh/",
)

#: Fora da API o bloqueio não se aplica: o admin do Django tem o próprio fluxo
#: de senha, e arquivos estáticos não são sessão de ninguém.
API_PREFIX = "/api/"


class MustChangePasswordMiddleware:
    """Recusa requisições de quem ainda não trocou a senha temporária."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if self._blocked(request):
            return JsonResponse(
                {
                    "detail": "Você precisa definir uma nova senha antes de usar o sistema.",
                    "code": "must_change_password",
                },
                status=403,
            )
        return self.get_response(request)

    def _blocked(self, request) -> bool:
        if not request.path.startswith(API_PREFIX):
            return False
        if request.path.endswith(EXEMPT_SUFFIXES):
            return False

        # A autenticação do DRF (JWT) acontece **na view**, não no middleware:
        # aqui `request.user` ainda é anônimo numa requisição com Bearer token.
        # Resolver o token na mão é o preço de o bloqueio ser inescapável.
        user = self._user_from_token(request)
        return user is not None and user.must_change_password

    def _user_from_token(self, request):
        cabecalho = request.headers.get("Authorization", "")
        if not cabecalho.startswith("Bearer "):
            # Sessão do Django (admin) já vem resolvida pelo AuthenticationMiddleware.
            usuario = getattr(request, "user", None)
            return usuario if usuario is not None and usuario.is_authenticated else None

        from rest_framework_simplejwt.authentication import JWTAuthentication
        from rest_framework_simplejwt.exceptions import InvalidToken, TokenError

        try:
            autenticacao = JWTAuthentication()
            token = autenticacao.get_validated_token(cabecalho.removeprefix("Bearer ").strip())
            return autenticacao.get_user(token)
        except (InvalidToken, TokenError, Exception):  # noqa: BLE001
            # Token inválido/expirado não é problema deste middleware — a view
            # devolve 401 logo em seguida, com a mensagem certa.
            return None
