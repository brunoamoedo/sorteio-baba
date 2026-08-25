from rest_framework import serializers

from apps.accounts.models import User

from .models import Player, Position


class PositionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Position
        fields = ["id", "code", "name", "sort_order", "is_active"]


class PlayerSerializer(serializers.ModelSerializer):
    """Ficha do jogador **nesta** organização.

    `user` é a ponte com a identidade global: a mesma pessoa tem um login só e
    uma ficha por pelada, cada uma com nível, posição e tipo próprios. É esse
    vínculo que faz "Minhas Partidas" e "Minhas Mensalidades" encontrarem o
    jogador certo — sem ele, o perfil Jogador não tem o que mostrar."""

    user_name = serializers.CharField(source="user.username", read_only=True, default=None)
    user_email = serializers.EmailField(source="user.email", read_only=True, default=None)

    class Meta:
        model = Player
        fields = [
            "id",
            "user",
            "user_name",
            "user_email",
            "name",
            "nickname",
            "photo",
            # Miniatura para as listagens — a foto original só é necessária no
            # formulário de edição.
            "photo_thumb",
            "phone",
            "notes",
            "player_type",
            "status",
            "skill_level",
            "primary_position",
            "secondary_position",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at", "photo_thumb"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        request = self.context.get("request")
        organization = getattr(request, "organization", None) if request is not None else None
        if organization is not None:
            org_positions = Position.objects.filter(organization=organization)
            self.fields["primary_position"].queryset = org_positions
            self.fields["secondary_position"].queryset = org_positions
            # Só dá para vincular a ficha a alguém que já é membro **desta**
            # organização. Sem essa restrição, informar um id qualquer daria
            # a um usuário de fora acesso de auto-serviço aqui dentro.
            self.fields["user"].queryset = User.objects.filter(
                memberships__organization=organization, memberships__is_active=True
            ).distinct()

    def validate_user(self, value):
        """Um login tem no máximo **uma** ficha por organização.

        Sem esta trava, duas fichas apontando para o mesmo usuário fariam
        `_my_player()` escolher uma delas por ordem de id — o jogador
        confirmaria presença como outra pessoa sem perceber."""
        if value is None:
            return value
        request = self.context.get("request")
        organization = getattr(request, "organization", None) if request is not None else None
        if organization is None:
            return value

        conflito = Player.objects.filter(organization=organization, user=value)
        if self.instance is not None:
            conflito = conflito.exclude(pk=self.instance.pk)
        if conflito.exists():
            raise serializers.ValidationError(
                f"O login {value.username} já está vinculado a {conflito.first().name} "
                "nesta organização."
            )
        return value

    def validate(self, attrs):
        secondary = attrs.get("secondary_position")
        primary = attrs.get("primary_position", getattr(self.instance, "primary_position", None))
        if secondary is not None and primary is not None and secondary.pk == primary.pk:
            raise serializers.ValidationError(
                {"secondary_position": "A posição secundária deve ser diferente da principal."}
            )
        return attrs


class BulkPlayerActionSerializer(serializers.Serializer):
    """Ação em lote na tela de Jogadores.

    `ativo`/`inativo` mudam o status; `delete` é soft-delete (o histórico de
    sorteios é preservado). Não existe ação que apague de verdade — a regra de
    exclusão lógica do sistema vale igual aqui."""

    ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False, max_length=500)
    action = serializers.ChoiceField(choices=["ativo", "inativo", "delete"])


class LinkableUserSerializer(serializers.ModelSerializer):
    """Usuário que pode receber uma ficha nesta organização."""

    role = serializers.CharField(read_only=True)
    linked_player_name = serializers.CharField(read_only=True, allow_null=True)

    class Meta:
        model = User
        fields = ["id", "username", "email", "role", "linked_player_name"]
        read_only_fields = fields
