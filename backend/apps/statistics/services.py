from django.db.models import Sum
from django.utils import timezone

from apps.draws.models import Team, TeamPlayer, TeamResult
from apps.matches.models import Confirmation
from apps.players.models import Player


def _compute_streaks(sequence: list[str]) -> dict:
    """`sequence` é a lista cronológica de resultados ('win'/'loss'/'draw')
    de um jogador. Retorna a maior sequência de vitórias/derrotas e a
    sequência (ativa) mais recente."""
    longest_win = longest_loss = 0
    current_win = current_loss = 0

    for outcome in sequence:
        if outcome == TeamResult.Result.WIN:
            current_win += 1
            current_loss = 0
        elif outcome == TeamResult.Result.LOSS:
            current_loss += 1
            current_win = 0
        else:
            current_win = 0
            current_loss = 0
        longest_win = max(longest_win, current_win)
        longest_loss = max(longest_loss, current_loss)

    current_streak_type = None
    current_streak_length = 0
    if sequence and sequence[-1] in (TeamResult.Result.WIN, TeamResult.Result.LOSS):
        last = sequence[-1]
        current_streak_type = last
        for outcome in reversed(sequence):
            if outcome == last:
                current_streak_length += 1
            else:
                break

    return {
        "longest_win_streak": longest_win,
        "longest_loss_streak": longest_loss,
        "current_streak_type": current_streak_type,
        "current_streak_length": current_streak_length,
    }


def get_player_statistics(organization) -> list[dict]:
    """
    Agrega, por jogador da organização: vitórias/derrotas/empates,
    aproveitamento, sequências, presenças/ausências, média de estrelas dos
    times em que jogou e tempo desde o último jogo.
    """
    players = Player.objects.filter(organization=organization)

    team_players = (
        TeamPlayer.objects.filter(
            player__organization=organization,
            team__draw__is_current=True,
        )
        .select_related("team__draw__match")
        .order_by("team__draw__match__scheduled_date")
    )

    team_ids = {tp.team_id for tp in team_players}
    team_totals = dict(
        Team.objects.filter(id__in=team_ids)
        .annotate(total=Sum("team_players__skill_snapshot"))
        .values_list("id", "total")
    )
    team_results = dict(TeamResult.objects.filter(team_id__in=team_ids).values_list("team_id", "result"))

    by_player: dict[int, list[TeamPlayer]] = {}
    for tp in team_players:
        by_player.setdefault(tp.player_id, []).append(tp)

    confirmations = Confirmation.objects.filter(player__organization=organization).values(
        "player_id", "status"
    )
    presences_by_player: dict[int, int] = {}
    absences_by_player: dict[int, int] = {}
    for row in confirmations:
        if row["status"] == Confirmation.Status.CONFIRMED:
            presences_by_player[row["player_id"]] = presences_by_player.get(row["player_id"], 0) + 1
        elif row["status"] == Confirmation.Status.DECLINED:
            absences_by_player[row["player_id"]] = absences_by_player.get(row["player_id"], 0) + 1

    today = timezone.localdate()
    stats = []

    for player in players:
        player_team_players = by_player.get(player.id, [])
        matches_played = len(player_team_players)

        sequence = []
        for tp in player_team_players:
            result = team_results.get(tp.team_id)
            if result is not None:
                sequence.append(result)

        wins = sequence.count(TeamResult.Result.WIN)
        losses = sequence.count(TeamResult.Result.LOSS)
        draws = sequence.count(TeamResult.Result.DRAW)
        # Aproveitamento = vitórias sobre **todas as partidas com placar
        # lançado**, empates incluídos (decisão de produto confirmada). A
        # variável antes se chamava `decided`, o que sugeria o contrário.
        matches_with_result = wins + losses + draws
        win_rate = wins / matches_with_result if matches_with_result else None

        skills = [team_totals.get(tp.team_id) for tp in player_team_players if team_totals.get(tp.team_id)]
        avg_team_skill = sum(skills) / len(skills) if skills else None

        last_match_date = None
        if player_team_players:
            last_match_date = max(tp.team.draw.match.scheduled_date for tp in player_team_players)
        days_since_last_match = (today - last_match_date).days if last_match_date else None

        streaks = _compute_streaks(sequence)

        stats.append(
            {
                "player_id": player.id,
                "name": player.name,
                "nickname": player.nickname,
                "player_type": player.player_type,
                "matches_played": matches_played,
                "wins": wins,
                "losses": losses,
                "draws": draws,
                "win_rate": win_rate,
                "presences": presences_by_player.get(player.id, 0),
                "absences": absences_by_player.get(player.id, 0),
                "avg_team_skill": round(avg_team_skill, 1) if avg_team_skill is not None else None,
                "last_match_date": last_match_date,
                "days_since_last_match": days_since_last_match,
                **streaks,
            }
        )

    return stats
