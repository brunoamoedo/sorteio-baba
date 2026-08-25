"""A formação é validada contra o time **real**, não contra a capacidade.

Cenário relatado: partida configurada para 4 times com 8 de linha (teto 32),
mas **24 confirmados**. Cada time fica com 6 — e a formação `3-3`, que é
exatamente a certa, era recusada com "distribui 6 jogadores de linha, mas este
time tem 8". O organizador via um erro sobre um time que não existia.

A validação antiga usava `capacity.line_players_per_team`, que é o teto
configurado. Só coincide com a realidade quando a partida enche.
"""

import datetime

import pytest

from apps.draws.models import Draw
from apps.draws.services import execute_draw
from apps.matches.models import Confirmation
from apps.matches.services import set_confirmation
from common.exceptions import DomainError

from .factories import MatchFactory, MembershipFactory, PlayerFactory, PositionFactory


def _posicoes(org):
    """Posições de linha ordenadas + goleiro, como `seed_default_positions`."""
    return [
        PositionFactory(organization=org, code=code, name=nome, sort_order=ordem)
        for ordem, (code, nome) in enumerate(
            [("ZAG", "Zagueiro"), ("MEI", "Meia"), ("ATA", "Atacante")], start=1
        )
    ]


@pytest.fixture
def partida_com_folga(db):
    """4 times, teto de 8 de linha por time (32), mas só 24 confirmados."""
    org = MembershipFactory().organization
    posicoes = _posicoes(org)
    match = MatchFactory(
        organization=org,
        teams_count=4,
        goalkeepers_per_team=0,
        min_players=8,
        max_players=32,
        scheduled_date=datetime.date.today() + datetime.timedelta(days=1),
    )
    for i in range(24):
        player = PlayerFactory(
            organization=org,
            name=f"Jogador {i:02d}",
            primary_position=posicoes[i % len(posicoes)],
            skill_level=(i % 5) + 1,
        )
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)
    return match


@pytest.mark.django_db
def test_sorteia_com_a_formacao_do_time_real(partida_com_folga):
    """O caso relatado: 24 em 4 times = 6 por time, formação `3-3`."""
    draw = execute_draw(match=partida_com_folga, formation="3-3")

    assert draw.teams.count() == 4
    for team in draw.teams.all():
        assert team.team_players.count() == 6
        assert team.formation == "3-3"


@pytest.mark.django_db
def test_formacao_da_capacidade_e_recusada_quando_o_time_e_menor(partida_com_folga):
    """O outro lado da mesma regra: `3-3-2` (8) não cabe num time de 6, e
    dizer isso é correto — antes era o único caso que passava."""
    with pytest.raises(DomainError, match="mas este time tem 6"):
        execute_draw(match=partida_com_folga, formation="3-3-2")


@pytest.mark.django_db
def test_partida_cheia_continua_validando_pela_capacidade(db):
    """Quando a partida enche, capacidade e realidade coincidem — o
    comportamento de antes não mudou."""
    org = MembershipFactory().organization
    posicoes = _posicoes(org)
    match = MatchFactory(
        organization=org,
        teams_count=2,
        goalkeepers_per_team=0,
        min_players=4,
        max_players=12,
        scheduled_date=datetime.date.today() + datetime.timedelta(days=1),
    )
    for i in range(12):
        player = PlayerFactory(
            organization=org, name=f"J{i}", primary_position=posicoes[i % len(posicoes)]
        )
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    draw = execute_draw(match=match, formation="3-3")

    for team in draw.teams.all():
        assert team.team_players.count() == 6


@pytest.mark.django_db
def test_times_de_tamanhos_diferentes(db):
    """22 em 4 times: dois com 6, dois com 5. Uma formação de 6 vale num e não
    no outro — por isso a validação é **por time**."""
    org = MembershipFactory().organization
    posicoes = _posicoes(org)
    match = MatchFactory(
        organization=org,
        teams_count=4,
        goalkeepers_per_team=0,
        min_players=8,
        max_players=32,
        scheduled_date=datetime.date.today() + datetime.timedelta(days=1),
    )
    for i in range(22):
        player = PlayerFactory(
            organization=org, name=f"J{i:02d}", primary_position=posicoes[i % len(posicoes)]
        )
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)

    with pytest.raises(DomainError, match="mas este time tem 5"):
        execute_draw(match=match, formation="3-3")


@pytest.mark.django_db
def test_sem_formacao_continua_sorteando(partida_com_folga):
    """O padrão (sem formação) nunca passou por validação nenhuma."""
    draw = execute_draw(match=partida_com_folga)

    assert draw.formation == ""
    assert Draw.objects.filter(match=partida_com_folga, is_current=True).count() == 1
