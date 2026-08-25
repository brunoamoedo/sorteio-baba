from rest_framework import serializers


class PlayerStatisticsSerializer(serializers.Serializer):
    player_id = serializers.IntegerField()
    name = serializers.CharField()
    nickname = serializers.CharField()
    player_type = serializers.CharField()
    matches_played = serializers.IntegerField()
    wins = serializers.IntegerField()
    losses = serializers.IntegerField()
    draws = serializers.IntegerField()
    win_rate = serializers.FloatField(allow_null=True)
    presences = serializers.IntegerField()
    absences = serializers.IntegerField()
    avg_team_skill = serializers.FloatField(allow_null=True)
    last_match_date = serializers.DateField(allow_null=True)
    days_since_last_match = serializers.IntegerField(allow_null=True)
    longest_win_streak = serializers.IntegerField()
    longest_loss_streak = serializers.IntegerField()
    current_streak_type = serializers.CharField(allow_null=True)
    current_streak_length = serializers.IntegerField()
