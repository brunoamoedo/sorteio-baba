from django.db import models


class AuditLog(models.Model):
    """
    Log de auditoria append-only: nunca é atualizado nem apagado (a API só
    expõe list/retrieve). Cada mutação relevante do sistema grava um registro
    aqui via `apps.audit.services.log_action`.
    """

    class Action(models.TextChoices):
        DRAW_CREATED = "draw_created", "Sorteio realizado"
        PLAYER_MOVED = "player_moved", "Jogador movido entre times"
        # Edição manual do resultado. `player_moved` já existia e cobre a troca
        # de time; estas três cobrem o que antes não tinha registro nenhum.
        PLAYER_POSITION_CHANGED = "player_position_changed", "Posição do jogador alterada"
        PLAYERS_SWAPPED = "players_swapped", "Jogadores trocados entre si"
        FORMATION_CHANGED = "formation_changed", "Formação do time alterada"
        CONFIRMATION_CHANGED = "confirmation_changed", "Confirmação alterada"
        WAITLIST_ADDED = "waitlist_added", "Entrou na lista de espera"
        WAITLIST_PROMOTED = "waitlist_promoted", "Promovido da lista de espera"
        # -- Ciclo de vida da partida --
        MATCH_CREATED = "match_created", "Partida criada"
        MATCH_UPDATED = "match_updated", "Partida alterada"
        MATCH_CANCELED = "match_canceled", "Partida cancelada"
        # -- Acesso e senha --
        #
        # Nenhuma destas grava senha, hash ou tamanho: a trilha registra que um
        # acesso foi criado ou redefinido, nunca qual é a credencial.
        LOGIN_GENERATED = "login_generated", "Login gerado"
        LOGINS_BULK_GENERATED = "logins_bulk_generated", "Logins gerados em massa"
        PASSWORD_RESET = "password_reset", "Senha redefinida pelo gestor"
        PASSWORD_CHANGED = "password_changed", "Senha alterada pelo próprio usuário"
        # -- Organização e acesso --
        ORGANIZATION_CREATED = "organization_created", "Organização criada"
        ORGANIZATION_UPDATED = "organization_updated", "Organização alterada"
        MEMBERSHIP_CHANGED = "membership_changed", "Perfil de usuário alterado"
        # -- Financeiro --
        CHARGE_CREATED = "charge_created", "Mensalidade lançada"
        CHARGE_CANCELED = "charge_canceled", "Mensalidade cancelada"
        CHARGE_UPDATED = "charge_updated", "Mensalidade alterada"
        CHARGES_GENERATED = "charges_generated", "Competência gerada"
        PAYMENT_REGISTERED = "payment_registered", "Baixa de pagamento"
        PAYMENT_CANCELED = "payment_canceled", "Baixa cancelada"
        FEE_CHANGED = "fee_changed", "Valor da mensalidade alterado"
        FEE_BULK_CHANGED = "fee_bulk_changed", "Valor da mensalidade alterado em massa"
        # Aplicar o valor vigente às cobranças **em aberto** de uma competência
        # já lançada. Distinto de `fee_changed`, que muda o contrato: aqui o
        # contrato já mudou e as cobranças é que estavam para trás.
        CHARGES_RESYNCED = "charges_resynced", "Mensalidades em aberto atualizadas"
        # Valor base, dia do vencimento e multa moram no mesmo plano. Uma ação
        # por campo fragmentaria a trilha de um único `UPDATE` — o `before`/
        # `after` já diz o que mudou.
        FEE_PLAN_CHANGED = "fee_plan_changed", "Plano de mensalidade alterado"
        # -- Operações em massa --
        #
        # Cada uma registra também o evento individual (`payment_registered`,
        # `charge_updated`): o do lote é resumo, não substituto. É o que permite
        # responder "o que aquela operação de 20 mensalistas fez, exatamente".
        PAYMENT_BULK_REGISTERED = "payment_bulk_registered", "Baixa em massa"
        CHARGES_DUE_DATE_CHANGED = "charges_due_date_changed", "Vencimento alterado em massa"
        EXPENSE_CREATED = "expense_created", "Despesa lançada"
        EXPENSE_UPDATED = "expense_updated", "Despesa alterada"
        EXPENSE_CANCELED = "expense_canceled", "Despesa cancelada"
        EXPENSES_GENERATED = "expenses_generated", "Custos fixos gerados"

    organization = models.ForeignKey(
        "accounts.Organization", on_delete=models.CASCADE, related_name="audit_logs"
    )
    match = models.ForeignKey(
        "matches.Match", on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    draw = models.ForeignKey(
        "draws.Draw", on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    user = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    action = models.CharField(max_length=30, choices=Action.choices)
    player = models.ForeignKey(
        "players.Player", on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs"
    )
    team_from = models.ForeignKey(
        "draws.Team", on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs_from"
    )
    team_to = models.ForeignKey(
        "draws.Team", on_delete=models.SET_NULL, null=True, blank=True, related_name="audit_logs_to"
    )
    # Alvo genérico da ação, para o que não tem (nem deve ter) FK própria aqui.
    #
    # `match`, `draw`, `player` e os times continuam como FK porque a trilha os
    # exibe por nome e filtra por eles. Já o financeiro cresce em entidades
    # (cobrança, pagamento, valor de mensalidade) e criar uma FK por tabela
    # deixaria o `AuditLog` com uma coluna nula para cada módulo novo. O par
    # `entity` + `entity_id` responde "sobre o que foi esta ação" sem acoplar a
    # auditoria ao esquema de quem a gera — e é o que permite reconstruir a
    # linha do tempo de uma competência.
    entity = models.CharField(
        max_length=50, blank=True, help_text="Tipo do alvo: charge, payment, player_monthly_fee…"
    )
    entity_id = models.PositiveIntegerField(null=True, blank=True)

    before = models.JSONField(default=dict, blank=True)
    after = models.JSONField(default=dict, blank=True)
    reason = models.TextField(blank=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["organization", "-created_at"]),
            # A linha do tempo de uma cobrança lê por (entity, entity_id).
            models.Index(fields=["organization", "entity", "entity_id"]),
        ]

    def __str__(self):
        return f"{self.get_action_display()} — {self.created_at:%d/%m/%Y %H:%M}"
