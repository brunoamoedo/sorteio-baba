from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from common.permissions import ROLE_CHOICES

from .models import Membership, Organization, User


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        # `is_superadmin` vai para o cliente porque o menu de administração do
        # sistema só existe para ele. A checagem de verdade continua no
        # servidor (`IsSuperAdmin`) — isto aqui só evita mostrar um item que
        # levaria a um 403.
        fields = [
            "id",
            "email",
            "username",
            "first_name",
            "last_name",
            "is_active",
            "is_superadmin",
            # A tela precisa saber que está no primeiro acesso para redirecionar
            # — o bloqueio de verdade é do middleware, isto só evita mostrar
            # uma tela que responderia 403 em tudo.
            "must_change_password",
        ]
        read_only_fields = fields


class ChangePasswordSerializer(serializers.Serializer):
    """Troca da própria senha.

    A senha atual é exigida mesmo quando é a temporária: sem isso, um token
    vazado viraria troca de senha direta. A validação de força mora no serviço
    (`change_own_password`), junto das outras regras — validar aqui e lá
    duplicaria a decisão."""

    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True)


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = ["id", "name", "slug", "is_active", "created_at"]
        read_only_fields = fields


class MyMembershipSerializer(serializers.ModelSerializer):
    organization = OrganizationSerializer()

    class Meta:
        model = Membership
        fields = ["organization", "role", "is_active"]


# ---------------------------------------------------------------------------
# Administração do sistema (Super Admin)
# ---------------------------------------------------------------------------


class AdminOrganizationSerializer(serializers.ModelSerializer):
    members_count = serializers.IntegerField(read_only=True)
    players_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Organization
        fields = ["id", "name", "slug", "is_active", "members_count", "players_count", "created_at"]
        read_only_fields = ["slug", "members_count", "players_count", "created_at"]


class AdminMembershipSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source="user.username", read_only=True)
    user_email = serializers.EmailField(source="user.email", read_only=True)
    organization_name = serializers.CharField(source="organization.name", read_only=True)

    class Meta:
        model = Membership
        fields = [
            "id",
            "user",
            "user_name",
            "user_email",
            "organization",
            "organization_name",
            "role",
            "is_active",
        ]


class AdminUserMembershipSerializer(serializers.ModelSerializer):
    """Vínculos exibidos dentro do usuário — é o que mostra, numa olhada, que a
    mesma pessoa é Gerente numa pelada e Jogador em outra."""

    organization_name = serializers.CharField(source="organization.name", read_only=True)

    class Meta:
        model = Membership
        fields = ["id", "organization", "organization_name", "role", "is_active"]
        read_only_fields = fields


class AdminUserSerializer(serializers.ModelSerializer):
    memberships = AdminUserMembershipSerializer(many=True, read_only=True)
    password = serializers.CharField(
        write_only=True, required=False, validators=[validate_password]
    )

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "is_active",
            "is_superadmin",
            "password",
            "memberships",
        ]

    def create(self, validated_data):
        # `create_user` para a senha ser gravada com hash — `objects.create()`
        # gravaria o texto puro.
        password = validated_data.pop("password", None)
        user = User.objects.create_user(**validated_data, password=password)
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        user = super().update(instance, validated_data)
        if password:
            user.set_password(password)
            user.save(update_fields=["password"])
        return user


# ---------------------------------------------------------------------------
# Membros da organização (gestão pelo Gerente)
# ---------------------------------------------------------------------------


class OrganizationMemberSerializer(serializers.ModelSerializer):
    """Leitura. Nunca expõe `is_superadmin`: quem administra a organização não
    precisa (nem deve) enxergar o poder que alguém tem fora dela."""

    username = serializers.CharField(source="user.username", read_only=True)
    email = serializers.EmailField(source="user.email", read_only=True)
    linked_player_name = serializers.SerializerMethodField()

    class Meta:
        model = Membership
        fields = ["id", "user", "username", "email", "role", "is_active", "linked_player_name"]
        read_only_fields = fields

    def get_linked_player_name(self, membership) -> str | None:
        """A ficha de jogador vinculada a este login **nesta** organização.

        É o que mostra, na mesma tela, quem já consegue confirmar a própria
        presença e quem ainda está sem ficha."""
        from apps.players.models import Player

        player = Player.objects.filter(
            organization=membership.organization, user=membership.user
        ).first()
        return player.name if player else None


class OrganizationMemberWriteSerializer(serializers.ModelSerializer):
    """Escrita. O e-mail é a chave da pessoa — se já existir usuário com ele, o
    vínculo aponta para esse login; senão, um acesso novo é criado."""

    email = serializers.EmailField(write_only=True, required=False)
    username = serializers.CharField(write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(
        write_only=True, required=False, allow_blank=True, validators=[validate_password]
    )

    class Meta:
        model = Membership
        fields = ["id", "email", "username", "password", "role", "is_active"]

    def validate_role(self, value):
        # Defesa em profundidade: `ROLE_CHOICES` já restringe, mas deixar
        # explícito evita que um papel futuro "de sistema" entre aqui por
        # descuido.
        if value not in dict(ROLE_CHOICES):
            raise serializers.ValidationError("Perfil inválido.")
        return value

    def validate(self, attrs):
        if self.instance is None and not attrs.get("email"):
            raise serializers.ValidationError({"email": "Informe o e-mail da pessoa."})
        return attrs
