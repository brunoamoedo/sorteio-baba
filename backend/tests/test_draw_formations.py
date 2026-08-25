"""Formação no sorteio e edição manual do resultado.

Dois compromissos são verificados aqui:

1. **Sem formação, nada muda.** O sorteio continua sendo exatamente o de antes
   desta funcionalidade — é a garantia de não-regressão mais importante do
   projeto.
2. As três operações de edição pós-sorteio (mover, trocar posição, trocar dois
   jogadores) fazem o que dizem, e **auditam**.
"""

import pytest
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.audit.models import AuditLog
from apps.draws.models import Draw, TeamPlayer
from apps.draws.services import (
    change_player_position,
    execute_draw,
    set_team_formation,
    swap_players,
)
from apps.matches.models import Confirmation
from apps.matches.services import set_confirmation
from common.exceptions import DomainError
from common.permissions import ROLE_ORGANIZADOR, ROLE_VISUALIZADOR

from .factories import (
    MatchFactory,
    MembershipFactory,
    OrganizationFactory,
    PlayerFactory,
    PositionFactory,
)


def authenticated_client(user, organization=None):
    client = APIClient()
    access = str(RefreshToken.for_user(user).access_token)
    headers = {"HTTP_AUTHORIZATION": f"Bearer {access}"}
    if organization is not None:
        headers["HTTP_X_ORGANIZATION_ID"] = str(organization.id)
    client.credentials(**headers)
    return client


def confirm_players(match, players):
    for player in players:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)


@pytest.fixture
def org_com_posicoes():
    """Organização com as quatro posições padrão, como `register_organization`
    cria."""
    org = OrganizationFactory()
    positions = {
        code: PositionFactory(organization=org, code=code, name=name, sort_order=order)
        for code, name, order in [
            ("GOL", "Goleiro", 1),
            ("ZAG", "Zagueiro", 2),
            ("ME", "Meio-Campo", 3),
            ("AT", "Atacante", 4),
        ]
    }
    return org, positions


def montar_partida(org, positions, *, teams=2, por_time=6):
    """Partida com `teams × por_time` confirmados, distribuídos entre as
    posições de linha."""
    total = teams * por_time
    match = MatchFactory(
        organization=org, teams_count=teams, min_players=total, max_players=total
    )
    ordem = ["ZAG", "ZAG", "ME", "ME", "AT", "AT"]
    players = [
        PlayerFactory(
            organization=org,
            primary_position=positions[ordem[i % len(ordem)]],
            skill_level=(i % 5) + 1,
        )
        for i in range(total)
    ]
    confirm_players(match, players)
    return match, players


# ---------------------------------------------------------------------------
# Não-regressão: sem formação, o sorteio é o de sempre
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_sorteio_sem_formacao_nao_grava_vaga_nenhuma(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions)

    draw = execute_draw(match=match)

    assert draw.formation == ""
    assert all(team.formation == "" for team in draw.teams.all())
    # `line_index` nulo é o que faz o campo cair no desenho por `sort_order` —
    # exatamente como antes desta funcionalidade existir.
    assert TeamPlayer.objects.filter(team__draw=draw, line_index__isnull=False).count() == 0


@pytest.mark.django_db
def test_sorteio_sem_formacao_preserva_a_posicao_cadastrada(org_com_posicoes):
    org, positions = org_com_posicoes
    match, players = montar_partida(org, positions)

    draw = execute_draw(match=match)

    for team_player in TeamPlayer.objects.filter(team__draw=draw).select_related("player"):
        assert team_player.position_snapshot_id in (
            team_player.player.primary_position_id,
            team_player.player.secondary_position_id,
        )


# ---------------------------------------------------------------------------
# Formação aplicada
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_sorteio_com_formacao_grava_linha_e_vaga(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)

    draw = execute_draw(match=match, formation="2-2-2")

    assert draw.formation == "2-2-2"
    for team in draw.teams.all():
        assert team.formation == "2-2-2"
        linhas = sorted(
            tp.line_index for tp in team.team_players.all() if tp.line_index is not None
        )
        assert linhas == [0, 0, 1, 1, 2, 2]


@pytest.mark.django_db
def test_formacao_nao_muda_quem_joga_com_quem(org_com_posicoes):
    """A formação é camada de apresentação: ela reposiciona no desenho, nunca
    remaneja entre times."""
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)

    draw = execute_draw(match=match, formation="3-2-1")

    for team in draw.teams.all():
        assert team.team_players.count() == 6


@pytest.mark.django_db
def test_formacao_por_time(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)

    draw = execute_draw(
        match=match, formation="2-2-2", formations_by_team={0: "3-2-1", 1: "2-2-2"}
    )

    teams = list(draw.teams.order_by("order_index"))
    assert teams[0].formation == "3-2-1"
    assert teams[1].formation == "2-2-2"


@pytest.mark.django_db
def test_nenhuma_vaga_e_ocupada_duas_vezes(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=3, por_time=6)

    draw = execute_draw(match=match, formation="2-2-2")

    for team in draw.teams.all():
        vagas = [
            (tp.line_index, tp.slot_index)
            for tp in team.team_players.all()
            if tp.line_index is not None
        ]
        assert len(vagas) == len(set(vagas))


@pytest.mark.django_db
def test_formacao_invalida_recusa_o_sorteio_inteiro(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)

    # 7 de linha numa partida de 6 por time: a conta não fecha.
    with pytest.raises(DomainError):
        execute_draw(match=match, formation="3-2-2")

    # E o sorteio não foi criado pela metade.
    assert Draw.objects.filter(match=match).count() == 0


@pytest.mark.django_db
def test_notacao_sem_sentido_e_recusada(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)

    with pytest.raises(ValueError):
        execute_draw(match=match, formation="abacaxi")


@pytest.mark.django_db
def test_formacao_com_mais_linhas_que_posicoes_cadastradas(org_com_posicoes):
    """`2-2-2-1` são 4 linhas para 3 posições de linha (ZAG/ME/AT).

    O campo precisa desenhar 4 faixas mesmo assim — é por isso que a linha é
    guardada separada da posição."""
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=7)

    draw = execute_draw(match=match, formation="2-2-2-1")

    for team in draw.teams.all():
        linhas = {tp.line_index for tp in team.team_players.all() if tp.line_index is not None}
        assert linhas == {0, 1, 2, 3}


# ---------------------------------------------------------------------------
# Edição manual: mover, trocar posição, trocar jogadores
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_alterar_posicao_do_jogador(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    team_player = draw.teams.first().team_players.first()
    antes = team_player.position_snapshot_id

    atualizado = change_player_position(
        draw=draw,
        team_player_id=team_player.id,
        position_id=positions["AT"].id,
        reason="ajuste do organizador",
    )

    assert atualizado.position_snapshot_id == positions["AT"].id
    assert atualizado.position_snapshot_id != antes or antes == positions["AT"].id

    log = AuditLog.objects.get(action=AuditLog.Action.PLAYER_POSITION_CHANGED)
    assert log.before["position_id"] == antes
    assert log.after["position_id"] == positions["AT"].id
    assert log.reason == "ajuste do organizador"


@pytest.mark.django_db
def test_alterar_posicao_libera_a_vaga_de_quem_estava_nela(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    team = draw.teams.first()
    ocupante = team.team_players.filter(line_index=2, slot_index=0).first()
    outro = team.team_players.exclude(id=ocupante.id).first()

    change_player_position(draw=draw, team_player_id=outro.id, line_index=2, slot_index=0)

    ocupante.refresh_from_db()
    # Perdeu a vaga, mas **continua no time** — trocar dois de lugar é a
    # operação `swap_players`, explícita.
    assert ocupante.line_index is None
    assert ocupante.team_id == team.id


@pytest.mark.django_db
def test_trocar_dois_jogadores_entre_times(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    teams = list(draw.teams.order_by("order_index"))
    a = teams[0].team_players.first()
    b = teams[1].team_players.first()
    time_a, time_b = a.team_id, b.team_id

    novo_a, novo_b = swap_players(draw=draw, team_player_a_id=a.id, team_player_b_id=b.id)

    assert novo_a.team_id == time_b
    assert novo_b.team_id == time_a
    # A troca preserva o tamanho dos times — que é justamente o que "mover" não
    # faz.
    assert teams[0].team_players.count() == 6
    assert teams[1].team_players.count() == 6


@pytest.mark.django_db
def test_trocar_jogadores_dentro_do_mesmo_time(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    team = draw.teams.first()
    a = team.team_players.filter(line_index=0).first()
    b = team.team_players.filter(line_index=2).first()
    vaga_a = (a.line_index, a.slot_index)
    vaga_b = (b.line_index, b.slot_index)

    novo_a, novo_b = swap_players(draw=draw, team_player_a_id=a.id, team_player_b_id=b.id)

    assert (novo_a.line_index, novo_a.slot_index) == vaga_b
    assert (novo_b.line_index, novo_b.slot_index) == vaga_a


@pytest.mark.django_db
def test_troca_gera_um_registro_so_de_auditoria(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    teams = list(draw.teams.order_by("order_index"))
    a = teams[0].team_players.first()
    b = teams[1].team_players.first()

    swap_players(draw=draw, team_player_a_id=a.id, team_player_b_id=b.id, reason="pedido do time")

    logs = AuditLog.objects.filter(action=AuditLog.Action.PLAYERS_SWAPPED)
    assert logs.count() == 1
    # Dois registros de "movido" contariam uma história que não aconteceu: duas
    # movimentações independentes.
    assert not AuditLog.objects.filter(action=AuditLog.Action.PLAYER_MOVED).exists()

    log = logs.first()
    assert set(log.before) == {"a", "b"}
    assert log.before["a"]["team_id"] != log.after["a"]["team_id"]
    assert log.reason == "pedido do time"


@pytest.mark.django_db
def test_nao_troca_jogador_com_ele_mesmo(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match)

    team_player = draw.teams.first().team_players.first()
    with pytest.raises(DomainError):
        swap_players(draw=draw, team_player_a_id=team_player.id, team_player_b_id=team_player.id)


@pytest.mark.django_db
def test_troca_e_atomica(org_com_posicoes, monkeypatch):
    """Se a segunda gravação falhar, **nada** muda.

    É o motivo de a troca ser um endpoint só: com duas chamadas de "mover", uma
    falha no meio deixaria um jogador movido e o outro não."""
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    teams = list(draw.teams.order_by("order_index"))
    a = teams[0].team_players.first()
    b = teams[1].team_players.first()
    time_a_antes, time_b_antes = a.team_id, b.team_id

    original_save = TeamPlayer.save
    chamadas = {"n": 0}

    def save_que_falha_na_segunda(self, *args, **kwargs):
        chamadas["n"] += 1
        if chamadas["n"] == 2:
            raise RuntimeError("falha simulada no meio da troca")
        return original_save(self, *args, **kwargs)

    monkeypatch.setattr(TeamPlayer, "save", save_que_falha_na_segunda)

    with pytest.raises(RuntimeError):
        swap_players(draw=draw, team_player_a_id=a.id, team_player_b_id=b.id)

    monkeypatch.setattr(TeamPlayer, "save", original_save)
    a.refresh_from_db()
    b.refresh_from_db()

    assert a.team_id == time_a_antes
    assert b.team_id == time_b_antes
    assert not AuditLog.objects.filter(action=AuditLog.Action.PLAYERS_SWAPPED).exists()


@pytest.mark.django_db
def test_trocar_a_formacao_do_time_depois_do_sorteio(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    team = draw.teams.first()
    atualizado = set_team_formation(draw=draw, team_id=team.id, formation="3-2-1")

    assert atualizado.formation == "3-2-1"
    linhas = sorted(
        tp.line_index for tp in atualizado.team_players.all() if tp.line_index is not None
    )
    assert linhas == [0, 0, 0, 1, 1, 2]
    # Ninguém saiu do time.
    assert atualizado.team_players.count() == 6

    log = AuditLog.objects.get(action=AuditLog.Action.FORMATION_CHANGED)
    assert log.before["formation"] == "2-2-2"
    assert log.after["formation"] == "3-2-1"


@pytest.mark.django_db
def test_limpar_a_formacao_devolve_o_desenho_por_posicao(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    team = draw.teams.first()
    set_team_formation(draw=draw, team_id=team.id, formation="")

    team.refresh_from_db()
    assert team.formation == ""
    assert all(tp.line_index is None for tp in team.team_players.all())


# ---------------------------------------------------------------------------
# Trava do histórico
# ---------------------------------------------------------------------------


@pytest.mark.django_db
@pytest.mark.parametrize("operacao", ["posicao", "troca", "formacao"])
def test_sorteio_historico_nao_aceita_edicao(org_com_posicoes, operacao):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    antigo = execute_draw(match=match, formation="2-2-2")
    execute_draw(match=match, formation="2-2-2")  # o antigo deixa de ser vigente

    antigo.refresh_from_db()
    assert not antigo.is_current

    team = antigo.teams.first()
    jogadores = list(team.team_players.all()[:2])

    with pytest.raises(DomainError):
        if operacao == "posicao":
            change_player_position(
                draw=antigo, team_player_id=jogadores[0].id, position_id=positions["AT"].id
            )
        elif operacao == "troca":
            swap_players(
                draw=antigo, team_player_a_id=jogadores[0].id, team_player_b_id=jogadores[1].id
            )
        else:
            set_team_formation(draw=antigo, team_id=team.id, formation="3-2-1")


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_endpoint_de_formacoes(org_com_posicoes):
    org, _ = org_com_posicoes
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, org)

    response = client.get("/api/draws/formations/?line_players=6")

    assert response.status_code == 200
    chaves = [item["key"] for item in response.json()]
    assert "2-2-2" in chaves
    assert "3-1-2" in chaves
    assert response.json()[0]["balanced"] is True


@pytest.mark.django_db
def test_sortear_pela_api_com_formacao(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, org)

    response = client.post(f"/api/matches/{match.id}/draw/", {"formation": "2-2-2"}, format="json")

    assert response.status_code == 201
    assert response.json()["formation"] == "2-2-2"
    assert all(team["formation"] == "2-2-2" for team in response.json()["teams"])


@pytest.mark.django_db
def test_sortear_pela_api_sem_corpo_continua_funcionando(org_com_posicoes):
    """Retrocompatibilidade: clientes antigos não mandam corpo nenhum."""
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, org)

    response = client.post(f"/api/matches/{match.id}/draw/")

    assert response.status_code == 201
    assert response.json()["formation"] == ""


@pytest.mark.django_db
@pytest.mark.parametrize(
    "url_path,payload_factory",
    [
        ("set-position", lambda tp, outro, team: {"team_player_id": tp.id, "position_id": None}),
        ("swap-players", lambda tp, outro, team: {"team_player_a": tp.id, "team_player_b": outro.id}),
        ("set-formation", lambda tp, outro, team: {"team_id": team.id, "formation": "3-2-1"}),
    ],
)
def test_visualizador_nao_edita_o_resultado(org_com_posicoes, url_path, payload_factory):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    membership = MembershipFactory(organization=org, role=ROLE_VISUALIZADOR)
    client = authenticated_client(membership.user, org)

    team = draw.teams.first()
    jogadores = list(team.team_players.all()[:2])
    payload = payload_factory(jogadores[0], jogadores[1], team)

    response = client.post(f"/api/draws/{draw.id}/{url_path}/", payload, format="json")

    assert response.status_code == 403


@pytest.mark.django_db
def test_nao_edita_sorteio_de_outra_organizacao(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    outra = OrganizationFactory()
    membership = MembershipFactory(organization=outra, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, outra)

    team_player = draw.teams.first().team_players.first()
    response = client.post(
        f"/api/draws/{draw.id}/set-position/",
        {"team_player_id": team_player.id, "position_id": positions["AT"].id},
        format="json",
    )

    assert response.status_code == 404


@pytest.mark.django_db
def test_trocar_posicao_pela_api(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, org)

    team_player = draw.teams.first().team_players.first()
    response = client.post(
        f"/api/draws/{draw.id}/set-position/",
        {"team_player_id": team_player.id, "position_id": positions["AT"].id},
        format="json",
    )

    assert response.status_code == 200
    assert response.json()["position_snapshot"]["code"] == "AT"


@pytest.mark.django_db
def test_api_recusa_jogador_de_outro_sorteio(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    antigo = execute_draw(match=match, formation="2-2-2")
    atual = execute_draw(match=match, formation="2-2-2")

    membership = MembershipFactory(organization=org, role=ROLE_ORGANIZADOR)
    client = authenticated_client(membership.user, org)

    forasteiro = antigo.teams.first().team_players.first()
    response = client.post(
        f"/api/draws/{atual.id}/set-position/",
        {"team_player_id": forasteiro.id, "position_id": positions["AT"].id},
        format="json",
    )

    assert response.status_code == 400


@pytest.mark.django_db
def test_posicao_de_outra_organizacao_e_recusada(org_com_posicoes):
    org, positions = org_com_posicoes
    match, _ = montar_partida(org, positions, teams=2, por_time=6)
    draw = execute_draw(match=match, formation="2-2-2")

    intrusa = PositionFactory(organization=OrganizationFactory(), code="XX")
    team_player = draw.teams.first().team_players.first()

    with pytest.raises(DomainError):
        change_player_position(
            draw=draw, team_player_id=team_player.id, position_id=intrusa.id
        )


# ---------------------------------------------------------------------------
# Regras de equilíbrio preservadas
# ---------------------------------------------------------------------------


@pytest.mark.django_db
def test_formacao_nao_afeta_a_separacao_dos_piores(org_com_posicoes):
    """A restrição dos piores é do algoritmo e continua valendo com formação —
    a formação só reposiciona dentro do time que o algoritmo montou."""
    org, positions = org_com_posicoes
    match = MatchFactory(organization=org, teams_count=3, min_players=9, max_players=9)

    # Três jogadores de 1 estrela: com 3 times, cada um vai para um time.
    piores = [
        PlayerFactory(organization=org, primary_position=positions["ZAG"], skill_level=1)
        for _ in range(3)
    ]
    outros = [
        PlayerFactory(organization=org, primary_position=positions["ME"], skill_level=4)
        for _ in range(6)
    ]
    confirm_players(match, piores + outros)

    draw = execute_draw(match=match, formation="1-1-1")

    ids_piores = {p.id for p in piores}
    por_time = [
        sum(1 for tp in team.team_players.all() if tp.player_id in ids_piores)
        for team in draw.teams.all()
    ]
    assert sorted(por_time) == [1, 1, 1]
