from django.contrib.auth.models import AbstractUser
from django.db import IntegrityError, models, transaction
from django.utils.text import slugify

from common.models import BaseModel
from common.permissions import ROLE_CHOICES

_SLUG_MAX_ATTEMPTS = 5


class User(AbstractUser):
    """
    Usuário global do sistema. Pode pertencer a mais de uma Organization
    (via Membership) — mesmo modelo do Slack/GitHub.

    É a **identidade única** da pessoa: o mesmo João tem um login só e uma
    `Membership` + um `Player` por organização, cada um com o papel e o perfil
    esportivo daquela pelada (ver `players.Player.user`).
    """

    # Único, mas **opcional**: o jogador que recebe login gerado a partir do
    # telefone não tem e-mail, e `Player` nem guarda esse dado. A alternativa
    # seria inventar um endereço (`11928241409@pelada.local`) — um dado falso
    # que o sistema trataria como verdadeiro, apareceria na lista de membros e
    # viraria fantasma no dia em que a pessoa informasse o e-mail real.
    #
    # No Postgres vários `NULL` convivem sob índice único, então "sem e-mail"
    # não colide. **Vazio (`""`) colidiria** a partir do segundo — por isso o
    # provisionamento grava `None`, nunca string vazia.
    email = models.EmailField(unique=True, null=True, blank=True)
    #: A senha atual é temporária e precisa ser trocada antes de usar o sistema.
    #: Marcado ao gerar o login e ao resetar a senha; limpo na troca.
    must_change_password = models.BooleanField(
        default=False,
        help_text="Exige troca de senha no próximo acesso (senha temporária).",
    )
    #: Quando a pessoa trocou a senha pela última vez. Responde "esta conta já
    #: saiu da senha temporária?" sem guardar nada sobre a senha em si.
    password_changed_at = models.DateTimeField(null=True, blank=True)
    is_superadmin = models.BooleanField(
        default=False,
        help_text=(
            "Super Administrador: administra o sistema inteiro e acessa qualquer "
            "organização sem precisar de vínculo. Diferente de `is_superuser`, que "
            "é só do Django admin."
        ),
    )

    USERNAME_FIELD = "username"
    REQUIRED_FIELDS = ["email"]

    def __str__(self):
        return self.email or self.username


class Plan(models.Model):
    """
    Stub para o módulo futuro de cobrança/mensalidades. Sem lógica de billing
    nesta fase — apenas o schema pronto para não exigir migração disruptiva depois.
    """

    code = models.SlugField(unique=True)
    name = models.CharField(max_length=100)
    max_players = models.PositiveIntegerField(null=True, blank=True)
    max_matches_per_month = models.PositiveIntegerField(null=True, blank=True)
    features = models.JSONField(default=dict, blank=True)

    def __str__(self):
        return self.name


class Organization(BaseModel):
    name = models.CharField(max_length=150)
    slug = models.SlugField(unique=True, blank=True)
    plan = models.ForeignKey(Plan, on_delete=models.SET_NULL, null=True, blank=True, related_name="organizations")
    is_active = models.BooleanField(default=True)

    def save(self, *args, **kwargs):
        if self.slug:
            return super().save(*args, **kwargs)

        # Duas organizações com o mesmo nome criadas ao mesmo tempo passavam as
        # duas pelo SELECT e colidiam no INSERT. A retentativa fecha a corrida:
        # o vencedor grava, o perdedor recalcula o sufixo e tenta de novo.
        base_slug = slugify(self.name) or "organizacao"
        for attempt in range(_SLUG_MAX_ATTEMPTS):
            self.slug = self._next_available_slug(base_slug)
            try:
                with transaction.atomic():
                    return super().save(*args, **kwargs)
            except IntegrityError:
                if attempt == _SLUG_MAX_ATTEMPTS - 1:
                    raise
                # `save()` pode ter atribuído um pk antes de falhar; sem zerar,
                # a retentativa viraria um UPDATE de uma linha inexistente.
                if kwargs.get("force_insert") or self._state.adding:
                    self.pk = None
        return None

    def _next_available_slug(self, base_slug: str) -> str:
        taken = set(
            Organization.all_objects.filter(slug__startswith=base_slug)
            .exclude(pk=self.pk)
            .values_list("slug", flat=True)
        )
        if base_slug not in taken:
            return base_slug
        suffix = 2
        while f"{base_slug}-{suffix}" in taken:
            suffix += 1
        return f"{base_slug}-{suffix}"

    def __str__(self):
        return self.name


class Membership(BaseModel):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="memberships")
    organization = models.ForeignKey(Organization, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=20, choices=ROLE_CHOICES)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["user", "organization"], name="unique_user_organization"),
        ]
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} @ {self.organization} ({self.role})"
