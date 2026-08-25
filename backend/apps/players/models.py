import re

import structlog
from django.db import models

from common.models import OrganizationOwnedModel

logger = structlog.get_logger(__name__)

#: Lado máximo da miniatura do avatar, em pixels. 96 cobre o maior uso na
#: interface (44px em telas de alta densidade) com folga.
THUMBNAIL_SIZE = 96


def normalize_phone(value: str | None) -> str:
    """Só os dígitos de um telefone.

    É o que torna comparável o que a pessoa digita ("11914344257", "(11)
    91434-4257", "+55 11 91434-4257") com o que está gravado na ficha. O
    prefixo internacional do Brasil é descartado quando vem junto de um número
    completo, senão o mesmo telefone teria duas formas normalizadas.
    """
    digits = re.sub(r"\D", "", value or "")
    if len(digits) > 11 and digits.startswith("55"):
        digits = digits[2:]
    return digits


#: Um celular brasileiro: DDD (2) + o 9 + 8 dígitos.
PHONE_DIGITS_EXPECTED = 11


def phone_error(value: str | None) -> str | None:
    """`None` quando o telefone está no formato aceito; a mensagem quando não.

    Fixo não passa. Aqui o telefone não é contato qualquer: os dígitos viram o
    **usuário do login** (`login_provisioning.generate_login`), e um número de
    10 dígitos gerava um acesso que a pessoa digitava errado na primeira
    tentativa — ela informa o próprio celular, com o 9.

    Vazio passa: nem toda ficha tem telefone (convidado avulso, quem não passou
    o número), e exigir um impediria de cadastrar quem joga. A regra é "se
    preencheu, preencheu certo".
    """
    digits = normalize_phone(value)
    if not digits:
        return None
    if len(digits) != PHONE_DIGITS_EXPECTED:
        return (
            f"O telefone precisa ter {PHONE_DIGITS_EXPECTED} dígitos: DDD + 9 + o número."
        )
    if digits[2] != "9":
        return "Depois do DDD, o número precisa começar com 9 (celular)."
    return None


class Position(OrganizationOwnedModel):
    code = models.CharField(max_length=10)
    name = models.CharField(max_length=50)
    sort_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["organization", "code"], name="unique_position_code_per_org"),
        ]
        ordering = ["sort_order", "name"]

    def __str__(self):
        return self.name


class Player(OrganizationOwnedModel):
    # O histórico de sorteios precisa conseguir ler o jogador **mesmo depois de
    # ele ser removido**: `TeamPlayer` guarda a posição e as estrelas da época,
    # mas o nome sai daqui. Sem isto, o manager padrão (que esconde
    # `is_deleted=True`) faria o jogador sumir do resultado já divulgado —
    # justamente o oposto da promessa de histórico imutável.
    class Meta(OrganizationOwnedModel.Meta):
        base_manager_name = "all_objects"
        ordering = ["name"]

    class PlayerType(models.TextChoices):
        MENSALISTA = "mensalista", "Mensalista"
        CONVIDADO = "convidado", "Convidado"

    class Status(models.TextChoices):
        ATIVO = "ativo", "Ativo"
        INATIVO = "inativo", "Inativo"

    user = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="player_profiles"
    )
    name = models.CharField(max_length=150)
    nickname = models.CharField(max_length=50, blank=True)
    photo = models.ImageField(upload_to="players/photos/", null=True, blank=True)
    # Miniatura gerada no upload. A lista de jogadores baixava a foto original
    # de cada um — uma foto tirada no celular tem alguns megabytes, e trinta
    # delas de uma vez, no 4G, atrasavam a tela inteira.
    photo_thumb = models.ImageField(upload_to="players/thumbs/", null=True, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    # Só os dígitos do telefone, para poder **procurar** por ele.
    #
    # O campo `phone` é digitado com máscara ("(11) 91434-4257"), e quem entra
    # no sistema digita do jeito que lembra — com ou sem parênteses, traço ou
    # espaço. Comparar as duas coisas exigiria normalizar em SQL (que não é
    # portável entre Postgres e SQLite) ou varrer as fichas em Python.
    # Guardar normalizado permite uma busca exata e indexada.
    phone_digits = models.CharField(max_length=20, blank=True, db_index=True, editable=False)
    notes = models.TextField(blank=True)
    player_type = models.CharField(max_length=20, choices=PlayerType.choices, default=PlayerType.MENSALISTA)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ATIVO)
    skill_level = models.PositiveSmallIntegerField(
        choices=[(i, "⭐" * i) for i in range(1, 6)], default=3
    )
    primary_position = models.ForeignKey(
        Position, on_delete=models.PROTECT, related_name="players_as_primary"
    )
    secondary_position = models.ForeignKey(
        Position, on_delete=models.SET_NULL, null=True, blank=True, related_name="players_as_secondary"
    )
    is_temporary = models.BooleanField(
        default=False,
        help_text=(
            "Convidado criado só para uma partida (lista de nomes colada). Não aparece no "
            "cadastro de Jogadores e é removido quando a partida é concluída."
        ),
    )

    def save(self, *args, **kwargs):
        """Gera a miniatura quando a foto muda.

        Feito no `save` (e não numa task) porque é barato — uma imagem de 96px
        — e porque a alternativa é a lista aparecer sem avatar até o worker
        rodar. Se a geração falhar, o cadastro **não** falha junto: a foto
        original continua valendo, e é melhor um avatar pesado que um erro ao
        salvar um jogador.
        """
        self.phone_digits = normalize_phone(self.phone)

        photo_changed = True
        if self.pk:
            anterior = Player.all_objects.filter(pk=self.pk).values_list("photo", flat=True).first()
            photo_changed = anterior != (self.photo.name if self.photo else None)

        if photo_changed:
            self._rebuild_thumbnail()

        super().save(*args, **kwargs)

    def _rebuild_thumbnail(self) -> None:
        if not self.photo:
            self.photo_thumb = None
            return

        try:
            from io import BytesIO

            from django.core.files.base import ContentFile
            from PIL import Image

            self.photo.open()
            image = Image.open(self.photo)
            image = image.convert("RGB")
            image.thumbnail((THUMBNAIL_SIZE, THUMBNAIL_SIZE))

            buffer = BytesIO()
            image.save(buffer, format="JPEG", quality=82, optimize=True)

            base = self.photo.name.rsplit("/", 1)[-1].rsplit(".", 1)[0]
            self.photo_thumb.save(f"{base}.jpg", ContentFile(buffer.getvalue()), save=False)
        except Exception:  # noqa: BLE001 — a miniatura é conveniência, não requisito
            logger.warning("player_thumbnail_failed", player=self.pk, exc_info=True)
            self.photo_thumb = None

    def __str__(self):
        return self.nickname or self.name
