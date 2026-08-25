"""Geração de acesso para os mensalistas.

Gerar um login **não é criar um usuário**. São três coisas, e faltar qualquer
uma entrega uma conta que não faz nada:

    Player sem user
        ↓
    1. User      — identidade global, `username` = dígitos do telefone
    2. Membership — papel `jogador` **nesta** organização
    3. Player.user — o vínculo que faz a confirmação de presença funcionar
        ↓
    Entra com o telefone e é obrigado a trocar a senha

Sem a `Membership`, a pessoa autentica e não enxerga nada. Sem o vínculo em
`Player.user`, ela enxerga a pelada mas não consegue confirmar presença — a
tela já avisa isso hoje ("seu login ainda não está vinculado a uma ficha").

A senha inicial é a mesma para todos, por decisão do produto. Isso abre uma
janela em que quem souber o telefone de alguém entra na conta dessa pessoa
antes dela — e é `must_change_password` que a fecha, no primeiro acesso. Por
isso a troca obrigatória não é um extra: é parte do mesmo mecanismo.
"""

import structlog
from django.db import transaction
from django.utils import timezone

from apps.audit.models import AuditLog
from apps.audit.services import log_action
from apps.players.models import Player
from common.exceptions import DomainError
from common.permissions import ROLE_JOGADOR

from .models import Membership, User

logger = structlog.get_logger(__name__)

#: Senha inicial de todo login gerado. Vive numa constante só — espalhá-la
#: pelo código faria a próxima mudança esquecer uma das cópias.
#:
#: Verificada contra os validadores do projeto: passa. (O telefone como senha
#: seria recusado — numérico e parecido com o usuário.)
SENHA_TEMPORARIA_PADRAO = "novasenha123"

ENTITY_USER = "user"


def _skip(player: Player, motivo: str) -> dict:
    return {"player_id": player.id, "player_name": player.name, "reason": motivo}


def eligible_players(organization):
    """Quem pode receber login: mensalista ativo e não temporário.

    A mesma função que o financeiro usa para saber quem tem mensalidade
    (`mensalistas_of`) — repetir o critério aqui abriria espaço para as duas
    listas divergirem."""
    from apps.finance.services import mensalistas_of

    return mensalistas_of(organization)


def login_status(organization) -> list[dict]:
    """A lista da aba "Gerar Logins".

    Devolve **só** o que uma tela de acesso precisa: nome, telefone e situação.
    Nível técnico, posição e observações ficam de fora de propósito — isto não
    é o cadastro de jogadores.
    """
    players = eligible_players(organization).select_related("user")
    # Um telefone que aparece em duas fichas não pode gerar login para nenhuma
    # das duas: não há como saber de quem é a conta. Contado uma vez só.
    repetidos = _duplicated_phones(players)

    linhas = []
    for player in players:
        linhas.append(
            {
                "player_id": player.id,
                "player_name": player.name,
                "player_nickname": player.nickname,
                "phone": player.phone,
                "phone_digits": player.phone_digits,
                "has_login": player.user_id is not None,
                "username": player.user.username if player.user_id else None,
                "must_change_password": (
                    player.user.must_change_password if player.user_id else None
                ),
                "blocked_reason": _blocked_reason(player, repetidos),
            }
        )
    return linhas


def _duplicated_phones(players) -> set[str]:
    vistos, repetidos = set(), set()
    for player in players:
        if not player.phone_digits:
            continue
        if player.phone_digits in vistos:
            repetidos.add(player.phone_digits)
        vistos.add(player.phone_digits)
    return repetidos


def _blocked_reason(player: Player, repetidos: set[str]) -> str | None:
    """Por que esta ficha **não** pode receber login — `None` quando pode."""
    if player.user_id is not None:
        return "já possui login"
    if not player.phone_digits:
        return "sem telefone cadastrado"
    if player.phone_digits in repetidos:
        return "telefone repetido com outra ficha"
    return None


@transaction.atomic
def generate_login(*, organization, player: Player, performed_by=None) -> dict:
    """Cria o acesso de **um** jogador. Atômica: ou os três passos, ou nenhum.

    Reaproveita o `User` quando já existe alguém com aquele `username` **e**
    aquele login já pertence à mesma pessoa em outra organização. Se o telefone
    já é de outra pessoa, recusa: escolher um dos dois entregaria a conta
    errada, e um sufixo automático (`11928241409-2`) criaria um login que
    ninguém adivinha e cujo dono nem saberia existir.
    """
    if player.organization_id != organization.id:
        raise DomainError("Este jogador não pertence a esta organização.")
    if player.user_id is not None:
        raise DomainError(f"{player.name} já possui login.")
    if not player.phone_digits:
        raise DomainError(f"{player.name} não tem telefone cadastrado.")

    username = player.phone_digits
    outro_dono = Player.objects.filter(phone_digits=username).exclude(pk=player.pk).first()
    if outro_dono is not None and outro_dono.organization_id == organization.id:
        raise DomainError(
            f"O telefone de {player.name} é o mesmo de {outro_dono.name}. "
            "Corrija o cadastro antes de gerar o login."
        )

    user = User.objects.filter(username=username).first()
    criado = user is None
    if criado:
        user = User.objects.create_user(
            username=username,
            password=SENHA_TEMPORARIA_PADRAO,
            first_name=player.name[:150],
        )
        # O e-mail precisa ficar **`NULL`**, e passar `email=None` para
        # `create_user` não basta: `BaseUserManager.normalize_email` faz
        # `email or ""` e grava string vazia. Vazio **colide** no índice único
        # a partir do segundo login gerado — o erro apareceria só no jogador
        # nº 2, no meio de uma geração em massa.
        user.email = None
        user.must_change_password = True
        user.save(update_fields=["email", "must_change_password"])
    elif Player.objects.filter(user=user, organization=organization).exists():
        raise DomainError(f"O telefone de {player.name} já está em uso por outro login.")

    membership, membership_criada = Membership.objects.get_or_create(
        organization=organization, user=user, defaults={"role": ROLE_JOGADOR}
    )
    player.user = user
    player.save(update_fields=["user"])

    log_action(
        organization=organization,
        action=AuditLog.Action.LOGIN_GENERATED,
        player=player,
        user=performed_by,
        entity=ENTITY_USER,
        entity_id=user.id,
        # Nenhum dado de senha entra aqui — nem o valor, nem o hash, nem o
        # tamanho. A trilha registra que um acesso foi criado, não qual é.
        after={
            "username": user.username,
            "user_created": criado,
            "membership_created": membership_criada,
            "role": membership.role,
            "must_change_password": True,
        },
    )

    return {
        "player_id": player.id,
        "player_name": player.name,
        "username": user.username,
        "user_created": criado,
    }


def generate_logins(*, organization, players: list[Player] | None = None, performed_by=None) -> dict:
    """Gera acesso para vários mensalistas.

    `players=None` significa **todos os mensalistas ativos**, resolvido aqui e
    não no navegador. Cada jogador é tratado por si: quem já tem login, quem
    não tem telefone e quem compartilha número com outra ficha são **pulados
    com motivo**, não derrubam os demais.
    """
    alvos = list(players) if players is not None else list(eligible_players(organization))
    if not alvos:
        raise DomainError("Nenhum mensalista selecionado.")

    for player in alvos:
        if player.organization_id != organization.id:
            raise DomainError("A seleção contém jogador de outra organização.")

    repetidos = _duplicated_phones(eligible_players(organization))

    criados, pulados = [], []
    for player in alvos:
        motivo = _blocked_reason(player, repetidos)
        if motivo is not None:
            pulados.append(_skip(player, motivo))
            continue
        try:
            criados.append(generate_login(
                organization=organization, player=player, performed_by=performed_by
            ))
        except DomainError as erro:
            pulados.append(_skip(player, str(erro)))

    if criados:
        log_action(
            organization=organization,
            action=AuditLog.Action.LOGINS_BULK_GENERATED,
            user=performed_by,
            entity=ENTITY_USER,
            after={
                "created": len(criados),
                "skipped": len(pulados),
                "usernames": [linha["username"] for linha in criados],
            },
        )

    return {
        "processed": criados,
        "skipped": pulados,
        "processed_count": len(criados),
        "skipped_count": len(pulados),
        "total": len(criados) + len(pulados),
    }


@transaction.atomic
def reset_password(*, organization, player: Player, performed_by=None) -> dict:
    """Devolve o acesso de um jogador com uma senha temporária.

    Quem reseta **não vê** a senha atual: ela é substituída, não revelada. O
    hash antigo é sobrescrito, então a senha anterior deixa de funcionar na
    hora.

    O escopo vem de `request.organization`, e a ficha precisa ser de lá — é o
    que impede um Gerente de resetar a senha de quem joga em outra pelada.
    """
    if player.organization_id != organization.id:
        raise DomainError("Este jogador não pertence a esta organização.")
    if player.user_id is None:
        raise DomainError(f"{player.name} ainda não tem login. Gere o acesso primeiro.")

    user = player.user
    # Esta rota é para **jogadores**. Quem administra a organização tem gestão
    # própria em `/api/auth/members/`, e resetar a senha de um Gerente por aqui
    # seria um caminho lateral para tomar a conta de quem administra.
    if Membership.objects.filter(
        organization=organization, user=user, role__in=("admin", "organizador")
    ).exists():
        raise DomainError(
            f"{player.name} administra esta organização. "
            "Use a gestão de membros para alterar o acesso dele."
        )

    user.set_password(SENHA_TEMPORARIA_PADRAO)
    user.must_change_password = True
    user.password_changed_at = None
    user.save(update_fields=["password", "must_change_password", "password_changed_at"])

    log_action(
        organization=organization,
        action=AuditLog.Action.PASSWORD_RESET,
        player=player,
        user=performed_by,
        entity=ENTITY_USER,
        entity_id=user.id,
        after={"username": user.username, "must_change_password": True},
    )
    return {"player_id": player.id, "player_name": player.name, "username": user.username}


def change_own_password(*, user: User, current_password: str, new_password: str) -> bool:
    """Troca a própria senha — o caminho para sair do primeiro acesso.

    A senha atual é exigida mesmo quando é a temporária: sem isso, um token
    vazado viraria troca de senha direta. E a nova não pode ser a temporária,
    senão a marca de "precisa trocar" seria limpa sem nada ter mudado.
    """
    from django.contrib.auth.password_validation import validate_password
    from django.core.exceptions import ValidationError

    if not user.check_password(current_password):
        raise DomainError("A senha atual está incorreta.")
    if new_password == SENHA_TEMPORARIA_PADRAO:
        raise DomainError("Escolha uma senha diferente da temporária.")
    if new_password == current_password:
        raise DomainError("A nova senha precisa ser diferente da atual.")

    try:
        validate_password(new_password, user=user)
    except ValidationError as erro:
        raise DomainError(" ".join(erro.messages)) from None

    primeiro_acesso = user.must_change_password
    user.set_password(new_password)
    user.must_change_password = False
    user.password_changed_at = timezone.now()
    user.save(update_fields=["password", "must_change_password", "password_changed_at"])

    # A senha é da **identidade global**, não de uma pelada, e `AuditLog` exige
    # organização. Quem audita é a view, que conhece o contexto da requisição —
    # daí este retorno dizer se foi o primeiro acesso.
    logger.info("password_changed", user_id=user.id, first_access=primeiro_acesso)
    return primeiro_acesso
