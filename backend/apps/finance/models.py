"""Módulo financeiro da organização.

Separação deliberada em quatro entidades, para o financeiro crescer sem
reescrita:

- `MembershipFeePlan` — **quanto e quando** a organização cobra (o contrato
  padrão: valor base, periodicidade, dia de vencimento).
- `PlayerMonthlyFee` — **quanto um mensalista específico paga a partir de qual
  competência**. É configuração *e* histórico: cada alteração é uma linha nova,
  nunca um `UPDATE` sobre a anterior.
- `Charge` — **uma cobrança concreta** de um jogador numa competência, com o
  valor **congelado** no momento da geração.
- `Payment` — **um recebimento** lançado contra uma cobrança.

Três regras de ouro sustentam esse desenho:

1. **Competência ≠ data de pagamento.** `Charge.reference` é a competência; o
   `Payment.paid_at` é quando o dinheiro entrou. Uma mensalidade de abril paga
   em maio continua sendo de abril.
2. **Valor histórico é imutável.** O valor vai para a `Charge` na geração;
   mudar a mensalidade do jogador depois não reescreve competência nenhuma.
3. **Nada é destruído.** Cancelar uma baixa não apaga o `Payment` — ele muda de
   estado, guarda quem cancelou, quando e por quê.
"""

from datetime import date
from decimal import Decimal

from django.db import models
from django.utils import timezone

from common.models import OrganizationOwnedModel


class MembershipFeePlan(OrganizationOwnedModel):
    """Contrato de mensalidade de uma organização."""

    class Period(models.TextChoices):
        MONTHLY = "monthly", "Mensal"
        WEEKLY = "weekly", "Semanal"

    name = models.CharField(max_length=100)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    period = models.CharField(max_length=20, choices=Period.choices, default=Period.MONTHLY)
    due_day = models.PositiveSmallIntegerField(
        default=10, help_text="Dia do mês em que a mensalidade vence."
    )
    #: Acréscimo cobrado de quem paga **depois** do vencimento. Valor fixo, não
    #: percentual: é como a pelada combina ("passou do dia 8, são mais R$ 10").
    #: `0` (o padrão) significa "sem multa" — o comportamento de sempre.
    late_fee_amount = models.DecimalField(
        max_digits=10,
        decimal_places=2,
        default=Decimal("0"),
        help_text="Multa fixa por atraso. Zero desativa a cobrança de multa.",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return f"{self.name} (R$ {self.amount})"


class PlayerMonthlyFee(OrganizationOwnedModel):
    """Valor da mensalidade de **um** jogador a partir de **uma** competência.

    É a mesma tabela para "valor atual" e "histórico de valores", e isso é
    proposital: o valor vigente é simplesmente a última vigência que já começou.
    Guardar o valor atual numa coluna de `Player` e o histórico em outra tabela
    criaria duas fontes da verdade que divergem no primeiro `UPDATE` esquecido.

    Alterar a mensalidade **nunca** é um `UPDATE` — é uma linha nova com outra
    `effective_from`. Por isso as competências já geradas não são tocadas: elas
    carregam o valor congelado na própria `Charge`.

        João: 100,00 desde 2026-01
              120,00 desde 2026-05   ← alteração
        Competências: jan..abr = 100,00 (intactas), mai em diante = 120,00

    `batch` liga as linhas criadas por uma mesma alteração em massa — é o
    identificador que a auditoria usa para reconstruir "aquela operação que
    mexeu em 87 mensalistas".
    """

    player = models.ForeignKey(
        "players.Player", on_delete=models.CASCADE, related_name="monthly_fees"
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    effective_from = models.CharField(
        max_length=7, help_text="Competência inicial de vigência, no formato AAAA-MM."
    )
    reason = models.TextField(blank=True)
    batch = models.UUIDField(
        null=True,
        blank=True,
        db_index=True,
        help_text="Identificador da alteração em massa que criou esta vigência.",
    )
    created_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="monthly_fees_defined",
    )

    class Meta:
        ordering = ["-effective_from", "-created_at"]
        constraints = [
            # Duas vigências do mesmo jogador começando na mesma competência
            # seriam ambíguas ("qual vale?"). Alterar duas vezes a mesma
            # competência substitui a vigência (ver `set_player_fee`).
            models.UniqueConstraint(
                fields=["player", "effective_from"],
                condition=models.Q(is_deleted=False),
                name="unique_player_fee_per_reference",
            ),
        ]
        indexes = [models.Index(fields=["organization", "player", "effective_from"])]

    def __str__(self):
        return f"{self.player} — R$ {self.amount} desde {self.effective_from}"


class Charge(OrganizationOwnedModel):
    """Uma mensalidade de um jogador.

    `reference` é a competência ("2026-08"), não a data de vencimento: é ela
    que impede cobrar duas vezes o mesmo mês do mesmo jogador."""

    class Status(models.TextChoices):
        PENDING = "pending", "Pendente"
        PAID = "paid", "Pago"
        CANCELED = "canceled", "Cancelado"

    player = models.ForeignKey("players.Player", on_delete=models.CASCADE, related_name="charges")
    plan = models.ForeignKey(
        MembershipFeePlan, on_delete=models.SET_NULL, null=True, blank=True, related_name="charges"
    )
    reference = models.CharField(max_length=7, help_text="Competência no formato AAAA-MM.")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    #: A multa que vale **para esta competência**, congelada na geração — pelo
    #: mesmo motivo que `amount` é: reajustar a multa do plano em setembro não
    #: pode criar uma dívida retroativa em agosto. Ler `plan.late_fee_amount` na
    #: hora de cobrar faria exatamente isso, porque o plano é mutável.
    late_fee_amount = models.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0")
    )
    due_date = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-due_date", "player__name"]
        constraints = [
            models.UniqueConstraint(
                fields=["player", "reference"],
                condition=models.Q(is_deleted=False),
                name="unique_charge_per_player_reference",
            ),
        ]
        indexes = [models.Index(fields=["organization", "status", "due_date"])]

    # -- Estado derivado ----------------------------------------------------
    #
    # "Atrasado" **nunca** é gravado: seria um estado que envelhece sozinho e
    # precisaria de uma rotina para virar. É calculado a partir de vencimento +
    # pagamentos, do mesmo jeito que vitória/derrota é derivada dos gols.

    @property
    def paid_amount(self) -> Decimal:
        """Soma apenas das baixas **ativas**.

        Uma baixa cancelada continua existindo (o histórico não se apaga), mas
        não é dinheiro: contá-la deixaria a cobrança quitada para sempre depois
        de um estorno."""
        return sum(
            (
                payment.amount
                for payment in self.payments.all()
                if payment.status == Payment.Status.REGISTERED
            ),
            Decimal("0"),
        )

    @property
    def _late_fee_reference_date(self) -> date:
        """A data que decide se a multa incide.

        **Com baixa lançada, é a data do último recebimento**, não hoje: a
        multa pune o atraso de quem pagou, não a demora do organizador em
        lançar. Alguém que pagou no dia 08 e teve a baixa registrada no dia 12
        pagou em dia — e ler o relógio em vez do `paid_at` cobraria multa dele.

        Sem baixa nenhuma, é hoje: é quanto a pessoa pagaria se pagasse agora.

        O **último** recebimento, e não o primeiro, porque numa baixa parcial o
        que ficou em aberto continuou em aberto: quem pagou metade em dia e a
        outra metade com uma semana de atraso atrasou.
        """
        datas = [
            payment.paid_at
            for payment in self.payments.all()
            if payment.status == Payment.Status.REGISTERED
        ]
        return max(datas) if datas else timezone.localdate()

    @property
    def late_fee_due(self) -> Decimal:
        """A multa que incide sobre esta cobrança — `0` quando não incide.

        **Nunca é gravada**, pela mesma razão que `overdue` não é: um valor
        derivado não pode ser aplicado duas vezes. Não existe estado "multa já
        cobrada" para sair de sincronia com a realidade.
        """
        if self.status == self.Status.CANCELED or not self.late_fee_amount:
            return Decimal("0")
        return (
            self.late_fee_amount
            if self._late_fee_reference_date > self.due_date
            else Decimal("0")
        )

    @property
    def total_due(self) -> Decimal:
        """Valor + multa. É o que precisa entrar para a cobrança quitar.

        Fica **separado** de `amount` de propósito: a tela mostra
        "R$ 100,00 + R$ 10,00 de multa", nunca um R$ 110,00 sem explicação."""
        return self.amount + self.late_fee_due

    @property
    def outstanding(self) -> Decimal:
        """Quanto ainda falta receber. Nunca negativo — um pagamento a maior
        não vira crédito automático (isso é decisão do organizador)."""
        return max(Decimal("0"), self.total_due - self.paid_amount)

    @property
    def is_overdue(self) -> bool:
        return self.status == self.Status.PENDING and self.due_date < timezone.localdate()

    @property
    def effective_status(self) -> str:
        """`pending` / `paid` / `canceled` / **`overdue`** — o que a tela mostra."""
        if self.status == self.Status.PENDING and self.is_overdue:
            return "overdue"
        return self.status

    def __str__(self):
        return f"{self.player} — {self.reference} (R$ {self.amount})"


class RecurringExpense(OrganizationOwnedModel):
    """Um **custo fixo mensal** da pelada: quadra, arbitragem, colete, água.

    É o cadastro, não o gasto: a despesa concreta de cada competência é uma
    `Expense` gerada a partir daqui — mesmo desenho de `MembershipFeePlan` →
    `Charge`, e pelo mesmo motivo. O valor da despesa fica **congelado** na
    competência, então reajustar o aluguel da quadra em maio não reescreve o
    que se pagou em março.

    Desativar (em vez de apagar) preserva as despesas já geradas: elas
    continuam apontando para o cadastro que as originou."""

    description = models.CharField(max_length=150)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    due_day = models.PositiveSmallIntegerField(
        default=10, help_text="Dia do mês em que o custo costuma ser pago."
    )
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["description"]

    def __str__(self):
        return f"{self.description} (R$ {self.amount}/mês)"


class Expense(OrganizationOwnedModel):
    """Uma despesa da pelada numa competência.

    `kind` separa o que o organizador precisa enxergar separado:

    - **fixo** (`fixed`): repete todo mês e vem de um `RecurringExpense` — é o
      custo previsível da pelada.
    - **extra** (`extra`): aconteceu uma vez (bola nova, churrasco, multa).
      Comparar um mês com outro sem essa separação esconde por que um mês custou
      mais que o outro.

    A competência é a mesma ideia do lado da receita: `reference` diz a que mês
    a despesa **pertence**, e `incurred_on` diz quando ela foi paga. A quadra de
    abril paga em maio continua sendo despesa de abril.

    Cancelar não apaga, pelo mesmo motivo do pagamento: a evidência de que a
    despesa foi lançada é parte da prestação de contas."""

    class Kind(models.TextChoices):
        FIXED = "fixed", "Custo fixo mensal"
        EXTRA = "extra", "Custo extra"

    class Status(models.TextChoices):
        REGISTERED = "registered", "Registrada"
        CANCELED = "canceled", "Cancelada"

    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.EXTRA)
    recurring = models.ForeignKey(
        RecurringExpense,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses",
        help_text="Cadastro de custo fixo que originou esta despesa, quando houver.",
    )
    description = models.CharField(max_length=150)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    reference = models.CharField(max_length=7, help_text="Competência no formato AAAA-MM.")
    #: Quando a despesa **vencia**. Informativo: a despesa entra no custo do mês
    #: pelo lançamento, não pelo vencimento (ver §14.7 das regras). Existe para
    #: o organizador saber o que está para vencer, não para mudar o saldo.
    due_date = models.DateField(
        null=True, blank=True, help_text="Data de vencimento da despesa, quando houver."
    )
    incurred_on = models.DateField(help_text="Data em que a despesa foi paga/realizada.")
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REGISTERED)
    registered_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses_registered",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="expenses_cancelled",
    )
    cancellation_reason = models.TextField(blank=True)

    class Meta:
        ordering = ["-reference", "-incurred_on", "description"]
        constraints = [
            # Idempotência da geração: o mesmo custo fixo não entra duas vezes
            # na mesma competência, nem que a rotina rode de novo.
            models.UniqueConstraint(
                fields=["recurring", "reference"],
                condition=models.Q(is_deleted=False, recurring__isnull=False),
                name="unique_fixed_expense_per_reference",
            ),
        ]
        indexes = [models.Index(fields=["organization", "reference", "kind"])]

    @property
    def is_active(self) -> bool:
        return self.status == self.Status.REGISTERED

    def __str__(self):
        return f"{self.description} — {self.reference} (R$ {self.amount})"


class Payment(OrganizationOwnedModel):
    """Um recebimento lançado contra uma cobrança.

    Vários por cobrança são permitidos de propósito (pagamento em partes). A
    baixa manual de hoje é `method=cash`; um gateway futuro só acrescenta um
    valor a `Method` e cria o `Payment` por webhook.

    **Cancelar uma baixa não apaga a linha.** `DELETE FROM payments` destruiria
    justamente a evidência de que a baixa existiu — quem lançou, quando e de
    quanto. O pagamento muda de estado e passa a registrar quem cancelou,
    quando e por quê; o motivo é obrigatório."""

    class Method(models.TextChoices):
        CASH = "cash", "Dinheiro"
        PIX = "pix", "Pix"
        TRANSFER = "transfer", "Transferência"
        CARD = "card", "Cartão"
        OTHER = "other", "Outro"

    class Status(models.TextChoices):
        REGISTERED = "registered", "Registrado"
        CANCELED = "canceled", "Cancelado"

    charge = models.ForeignKey(Charge, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    #: Data em que o dinheiro entrou — **não** determina a competência, que é a
    #: da cobrança. Pagar a mensalidade de abril em 15/05 continua sendo abril.
    paid_at = models.DateField()
    method = models.CharField(max_length=20, choices=Method.choices, default=Method.CASH)
    notes = models.TextField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.REGISTERED)
    registered_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payments_registered",
    )
    cancelled_at = models.DateTimeField(null=True, blank=True)
    cancelled_by = models.ForeignKey(
        "accounts.User",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="payments_cancelled",
    )
    cancellation_reason = models.TextField(blank=True)

    class Meta:
        ordering = ["-paid_at", "-created_at"]
        indexes = [models.Index(fields=["organization", "status", "paid_at"])]

    @property
    def is_active(self) -> bool:
        return self.status == self.Status.REGISTERED

    def __str__(self):
        situacao = "" if self.is_active else " (cancelada)"
        return f"R$ {self.amount} em {self.paid_at} ({self.get_method_display()}){situacao}"
