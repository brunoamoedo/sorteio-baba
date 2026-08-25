"""
Script de seed para popular o ambiente local com dados completos de teste.
Executar com: .venv/Scripts/python.exe seed_demo.py
"""
import datetime
import os
import random

import django

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings.dev")
django.setup()

from apps.accounts.models import Membership, User  # noqa: E402
from apps.accounts.services import register_organization  # noqa: E402
from apps.draws.services import execute_draw, set_match_results  # noqa: E402
from apps.matches.models import Confirmation, Match, RecurringGame  # noqa: E402
from apps.matches.services import ensure_next_match, set_confirmation  # noqa: E402
from apps.players.models import Player, Position  # noqa: E402
from common.permissions import ROLE_ORGANIZADOR, ROLE_VISUALIZADOR  # noqa: E402

random.seed(42)

print("Criando organização e usuários...")
membership = register_organization(
    organization_name="Pelada dos Amigos",
    username="admin",
    email="admin@peladadosamigos.com",
    password="Admin@12345",
)
org = membership.organization

organizador_user = User.objects.create_user(
    username="organizador", email="organizador@peladadosamigos.com", password="Organizador@12345"
)
Membership.objects.create(user=organizador_user, organization=org, role=ROLE_ORGANIZADOR)

visualizador_user = User.objects.create_user(
    username="visualizador", email="visualizador@peladadosamigos.com", password="Visualizador@12345"
)
Membership.objects.create(user=visualizador_user, organization=org, role=ROLE_VISUALIZADOR)

print("Organização:", org.name, "(id", org.id, ")")

positions = {p.code: p for p in Position.objects.filter(organization=org)}
gol, zag, me, at = positions["GOL"], positions["ZAG"], positions["ME"], positions["AT"]

print("Criando jogadores...")
PLAYERS = [
    ("Aderval", None, zag, None, 4, "mensalista", "ativo"),
    ("Barba", None, gol, None, 3, "mensalista", "ativo"),
    ("Macedo", None, zag, None, 3, "mensalista", "ativo"),
    ("Dieguinho", None, me, None, 4, "mensalista", "ativo"),
    ("Almada", None, at, None, 5, "mensalista", "ativo"),
    ("Digs", None, me, None, 3, "mensalista", "ativo"),
    ("Astro", None, gol, None, 4, "mensalista", "ativo"),
    ("Felipe Santiago Firmino", None, at, None, 4, "mensalista", "ativo"),
    ("Isaac Rodrigues Marocas", None, zag, None, 3, "mensalista", "ativo"),
    ("Jonathan Baba", None, me, None, 3, "mensalista", "ativo"),
    ("Luis Centauro", None, at, None, 3, "mensalista", "ativo"),
    ("João Busquets", None, me, None, 4, "mensalista", "ativo"),
    ("Sacra Rifas Novo", None, zag, None, 2, "mensalista", "ativo"),
    ("Sergio Bahia Novo", None, at, None, 3, "mensalista", "ativo"),
    ("W.P Baba", None, me, None, 3, "mensalista", "ativo"),
    ("Freitas", None, zag, None, 4, "mensalista", "ativo"),
    ("Diego Ferreira", None, at, None, 5, "mensalista", "ativo"),
    ("Bruno barba", None, zag, None, 3, "mensalista", "ativo"),
    ("Irmão marocas", None, me, None, 2, "mensalista", "ativo"),
    ("João Macena", None, at, None, 4, "mensalista", "ativo"),
    ("Thiago Costa", "Tiaguinho", zag, None, 2, "convidado", "ativo"),
    ("Marcelo Barbosa", "Marcelinho", me, zag, 2, "convidado", "ativo"),
    ("Eduardo Santos", None, at, None, 3, "convidado", "ativo"),
    ("Renato Xavier", "Renatão", at, None, 1, "convidado", "ativo"),
]

players = []
for name, nickname, primary, secondary, skill, ptype, status in PLAYERS:
    player = Player.objects.create(
        organization=org,
        name=name,
        nickname=nickname or "",
        phone=f"(11) 9{random.randint(1000,9999)}-{random.randint(1000,9999)}",
        player_type=ptype,
        status=status,
        skill_level=skill,
        primary_position=primary,
        secondary_position=secondary,
    )
    players.append(player)

active_players = [p for p in players if p.status == "ativo"]
print(f"{len(players)} jogadores criados ({len(active_players)} ativos).")

print("Criando jogos recorrentes...")
recurring_terca = RecurringGame.objects.create(
    organization=org,
    name="Pelada da Terça",
    weekday=1,
    match_time=datetime.time(21, 0),
    draw_time=datetime.time(20, 30),
    teams_count=2,
    min_players_per_team_line=4,
    max_players_per_team_line=8,
    is_active=True,
)
recurring_quinta = RecurringGame.objects.create(
    organization=org,
    name="Pelada de Quinta (society)",
    weekday=3,
    match_time=datetime.time(20, 0),
    draw_time=datetime.time(19, 30),
    teams_count=3,
    min_players_per_team_line=3,
    max_players_per_team_line=5,
    is_active=True,
)

print("Criando histórico de partidas concluídas...")
today = datetime.date.today()


def play_match(scheduled_date, recurring_game, confirmed_players, teams_count, min_players, max_players, complete=True):
    match = Match.objects.create(
        organization=org,
        recurring_game=recurring_game,
        scheduled_date=scheduled_date,
        scheduled_time=datetime.time(21, 0),
        teams_count=teams_count,
        min_players=min_players,
        max_players=max_players,
        status=Match.Status.SCHEDULED,
    )
    for player in confirmed_players:
        set_confirmation(match=match, player=player, status=Confirmation.Status.CONFIRMED)
    draw = execute_draw(match=match)
    if complete:
        results = []
        for index, team in enumerate(draw.teams.all()):
            if teams_count == 2:
                outcome = "win" if index == 0 else "loss"
            else:
                outcome = ["win", "draw", "loss"][index % 3]
            results.append({"team_id": team.id, "result": outcome})
        set_match_results(match=match, results=results)
    return match, draw


# 3 partidas passadas concluídas (para popular Estatísticas)
play_match(today - datetime.timedelta(days=21), recurring_terca, active_players[:14], 2, 10, 18)
play_match(today - datetime.timedelta(days=14), recurring_terca, active_players[:12] + active_players[14:16], 2, 10, 18)
play_match(today - datetime.timedelta(days=7), recurring_terca, active_players[2:16], 2, 10, 18)

print("Gerando a próxima partida da Pelada da Terça e sorteando (sem concluir)...")
ensure_next_match(recurring_terca)
upcoming_match = Match.objects.filter(recurring_game=recurring_terca, status=Match.Status.SCHEDULED).order_by("-scheduled_date").first()
confirmed_for_upcoming = active_players[:16]
for player in confirmed_for_upcoming:
    set_confirmation(match=upcoming_match, player=player, status=Confirmation.Status.CONFIRMED)
# deixa 2 jogadores como pendente/recusado para realismo
set_confirmation(match=upcoming_match, player=active_players[16] if len(active_players) > 16 else active_players[0], status=Confirmation.Status.DECLINED)
# Com formação, para o ambiente de demonstração exercitar o campo em SVG
# desenhado por linhas (e não pela posição cadastrada de cada jogador).
execute_draw(match=upcoming_match, formation="2-3-1")

print("Gerando a próxima partida da Pelada de Quinta (sem confirmações ainda)...")
ensure_next_match(recurring_quinta)

print()
print("=" * 60)
print("SEED CONCLUÍDO")
print("=" * 60)
