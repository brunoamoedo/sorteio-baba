from rest_framework import serializers


def validate_match_config(*, teams_count: int, min_players: int, max_players: int) -> None:
    errors = {}
    if teams_count < 2:
        errors["teams_count"] = "É necessário pelo menos 2 times."
    if min_players > max_players:
        errors["min_players"] = "O mínimo de jogadores não pode ser maior que o máximo."
    if min_players < teams_count:
        errors["min_players"] = "O mínimo de jogadores deve ser ao menos igual ao número de times."
    if errors:
        raise serializers.ValidationError(errors)


def validate_recurring_game_config(
    *,
    teams_count: int,
    min_players_per_team_line: int,
    max_players_per_team_line: int,
    goalkeepers_per_team: int = 1,
) -> None:
    errors = {}
    if teams_count < 2:
        errors["teams_count"] = "É necessário pelo menos 2 times."
    if min_players_per_team_line < 1:
        errors["min_players_per_team_line"] = "É necessário pelo menos 1 jogador de linha por time."
    # 0 é válido e é justamente o caso da pelada de goleiro fixo, que não é
    # sorteado. O teto evita configuração absurda (time só de goleiro).
    if goalkeepers_per_team < 0 or goalkeepers_per_team > max_players_per_team_line:
        errors["goalkeepers_per_team"] = (
            "Informe de 0 até o máximo de jogadores de linha por time. "
            "Use 0 quando o goleiro é fixo e não entra no sorteio."
        )
    if min_players_per_team_line > max_players_per_team_line:
        errors["min_players_per_team_line"] = (
            "O mínimo de jogadores de linha não pode ser maior que o máximo."
        )
    if errors:
        raise serializers.ValidationError(errors)
