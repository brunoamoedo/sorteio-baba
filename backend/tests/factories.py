import datetime

import factory
from django.utils import timezone

from apps.accounts.models import Membership, Organization, User
from apps.matches.models import Match, RecurringGame
from apps.players.models import Player, Position
from common.permissions import ROLE_ADMIN


def match_time_still_ahead() -> datetime.time:
    """Um horário de jogo que ainda **não passou** hoje.

    Vários testes marcam a ocorrência para hoje e esperam que ela seja gerada.
    Com um horário fixo (21:00), eles passavam de manhã e falhavam à noite — e
    a regra de negócio está certa: uma partida cujo horário já passou não é "a
    próxima" (`REGRAS_DE_NEGOCIO.md` §4). Não era o código que quebrava, era a
    suíte dependendo da hora em que rodava.
    """
    agora = timezone.localtime()
    alvo = agora + datetime.timedelta(minutes=30)
    if alvo.date() != agora.date():
        # Perto da meia-noite, o último horário ainda possível hoje.
        return datetime.time(23, 59)
    return alvo.time().replace(second=0, microsecond=0)


class UserFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = User
        django_get_or_create = ("username",)
        skip_postgeneration_save = True

    username = factory.Sequence(lambda n: f"user{n}")
    email = factory.LazyAttribute(lambda o: f"{o.username}@example.com")

    @factory.post_generation
    def set_default_password(obj, create, extracted, **kwargs):
        if not create:
            return
        obj.set_password(extracted or "senha-forte-123")
        obj.save(update_fields=["password"])


class OrganizationFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Organization

    name = factory.Sequence(lambda n: f"Pelada {n}")


class MembershipFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Membership

    user = factory.SubFactory(UserFactory)
    organization = factory.SubFactory(OrganizationFactory)
    role = ROLE_ADMIN


class PositionFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Position

    organization = factory.SubFactory(OrganizationFactory)
    code = factory.Sequence(lambda n: f"POS{n}")
    name = factory.Sequence(lambda n: f"Posição {n}")


class PlayerFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Player

    organization = factory.SubFactory(OrganizationFactory)
    name = factory.Sequence(lambda n: f"Jogador {n}")
    primary_position = factory.SubFactory(PositionFactory)


class RecurringGameFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = RecurringGame

    organization = factory.SubFactory(OrganizationFactory)
    name = factory.Sequence(lambda n: f"Pelada Recorrente {n}")
    weekday = 1
    match_time = datetime.time(21, 0)
    draw_time = datetime.time(20, 30)
    teams_count = 2
    min_players_per_team_line = 4
    max_players_per_team_line = 9


class MatchFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Match

    organization = factory.SubFactory(OrganizationFactory)
    scheduled_date = factory.LazyFunction(lambda: datetime.date.today())
    scheduled_time = datetime.time(21, 0)
    teams_count = 2
    min_players = 10
    max_players = 20
