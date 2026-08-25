from rest_framework import serializers

from .models import AuditLog


class AuditLogSerializer(serializers.ModelSerializer):
    action_display = serializers.CharField(source="get_action_display", read_only=True)
    user_username = serializers.CharField(source="user.username", read_only=True, default=None)
    player_name = serializers.CharField(source="player.name", read_only=True, default=None)
    team_from_name = serializers.CharField(source="team_from.name", read_only=True, default=None)
    team_to_name = serializers.CharField(source="team_to.name", read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = [
            "id",
            "action",
            "action_display",
            "match",
            "draw",
            "user_username",
            "player_name",
            "team_from_name",
            "team_to_name",
            "entity",
            "entity_id",
            "before",
            "after",
            "reason",
            "ip_address",
            "created_at",
        ]
        read_only_fields = fields
