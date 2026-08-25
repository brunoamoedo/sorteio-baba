"""Login por usuário, **telefone** ou **e-mail**.

O `username` é uma invenção do sistema: o jogador não o escolheu e não lembra
dele. O telefone e o e-mail, sim — são dados que ele reconhece como seus. Aqui
o mesmo campo aceita os três, e a senha continua obrigatória: o identificador
muda, a prova de identidade não.

## Onde cada coisa mora

O e-mail está em `User`, é global e `unique=True` — sempre leva a um login só.

O telefone está em `Player.phone`, que é **por organização** e não tem nenhuma
restrição de unicidade: a mesma pessoa pode ter ficha em duas peladas (as duas
apontando para o mesmo login, o que é inofensivo), mas duas pessoas diferentes
também podem acabar com o mesmo número gravado. Aí não há como saber quem está
entrando, e a tentativa é recusada.
"""

import structlog
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.players.models import Player, normalize_phone

from .models import User

logger = structlog.get_logger(__name__)

#: Menos que isso não é telefone — é um `username` curto que por acaso só tem
#: dígitos. Evita varrer a base por causa de um login digitado errado.
MIN_PHONE_DIGITS = 10


def resolve_username_from_phone(value: str) -> str | None:
    """Traduz um telefone no `username` do dono, quando isso é inequívoco.

    Devolve `None` quando o valor não parece telefone, quando nenhuma ficha
    tem aquele número, quando a ficha não está vinculada a um login, ou quando
    o número leva a mais de um login. Em todos esses casos o valor original
    segue para a autenticação normal — e falha lá, com a mesma mensagem
    genérica de credencial inválida.

    Essa uniformidade é proposital: responder de forma diferente para "telefone
    não existe" e "telefone existe mas a senha está errada" transformaria o
    login num verificador de quem está cadastrado na pelada.
    """
    digits = normalize_phone(value)
    if len(digits) < MIN_PHONE_DIGITS:
        return None

    usernames = set(
        Player.all_objects.filter(phone_digits=digits, user__isnull=False)
        .exclude(is_deleted=True)
        .values_list("user__username", flat=True)
    )

    if len(usernames) == 1:
        return usernames.pop()

    if len(usernames) > 1:
        # Duas pessoas diferentes com o mesmo número: escolher uma seria
        # entregar a conta errada. A trilha registra para o organizador poder
        # corrigir o cadastro.
        logger.warning("login_phone_ambiguous", phone_digits=digits, matches=len(usernames))

    return None


def resolve_username_from_email(value: str) -> str | None:
    """Traduz um e-mail no `username` do dono.

    `User.email` é `unique=True`, então aqui não existe a ambiguidade que o
    telefone tem: um endereço leva a no máximo um login. Quando não leva a
    nenhum, o valor segue para a autenticação normal e falha lá, com a mesma
    mensagem genérica de credencial inválida.
    """
    if "@" not in value:
        return None

    return (
        User.objects.filter(email__iexact=value.strip())
        .values_list("username", flat=True)
        .first()
    )


def resolve_username(value: str) -> str:
    """O `username` correspondente ao que a pessoa digitou.

    Tenta e-mail e telefone, nessa ordem, e devolve o valor original quando
    nenhum dos dois resolve — deixando o SimpleJWT tratá-lo como `username`,
    que é o comportamento de sempre.
    """
    return resolve_username_from_email(value) or resolve_username_from_phone(value) or value


class UsernameOrPhoneTokenSerializer(TokenObtainPairSerializer):
    """`TokenObtainPairSerializer` que aceita usuário, e-mail ou telefone.

    A tradução acontece **antes** da validação do SimpleJWT, então todo o resto
    do fluxo (senha, usuário inativo, throttling, claims do token) continua
    exatamente como era.
    """

    def validate(self, attrs):
        informado = attrs.get(self.username_field)

        if informado:
            attrs[self.username_field] = resolve_username(informado)

        return super().validate(attrs)
