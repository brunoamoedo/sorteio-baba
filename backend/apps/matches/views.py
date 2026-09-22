from datetime import timedelta

from django.db.models import Q
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.audit.models import AuditLog
from apps.audit.services import log_action
from apps.players.models import Player
from apps.players.serializers import PlayerSerializer
from common.exceptions import DomainError
from common.mixins import OrganizationScopedViewSetMixin, ReadForMembersWriteForStaffMixin
from common.permissions import (
    IsOrganizationMember,
    IsOrganizationOrganizerOrAdmin,
    IsOrganizationParticipant,
)

from .models import Confirmation, Match, RecurringGame
from .serializers import (
    ConfirmedPlayerSerializer,
    MatchSerializer,
    QuickConfirmNamesSerializer,
    ReassignConfirmationSerializer,
    RecurringGameSerializer,
    SelfConfirmationSerializer,
    SetAllConfirmationsSerializer,
    SetConfirmationSerializer,
    WaitlistEntrySerializer,
    WaitlistMoveSerializer,
    WaitlistPlayerSerializer,
)
from .services import (
    cancel_match,
    confirmed_confirmations,
    count_confirmed,
    ensure_next_match,
    get_match_capacity,
    move_waitlist_entry,
    promote_from_waitlist,
    quick_confirm_names,
    reactivate_match,
    reassign_confirmation,
    remove_from_waitlist,
    set_all_confirmations,
    set_confirmation,
    waitlist_entries,
)


class RecurringGameViewSet(
    ReadForMembersWriteForStaffMixin, OrganizationScopedViewSetMixin, viewsets.ModelViewSet
):
    serializer_class = RecurringGameSerializer
    queryset = RecurringGame.objects.all()
    filterset_fields = ["is_active", "weekday"]
    ordering_fields = ["weekday", "match_time"]

    def perform_create(self, serializer):
        """Cria o jogo recorrente **e já gera a próxima partida**.

        Antes a geração dependia exclusivamente da task periódica, que roda de
        hora em hora: o organizador cadastrava a pelada e não via partida
        nenhuma. Para um jogo cujo dia da semana é hoje, isso significava perder
        a janela de confirmação do próprio jogo."""
        super().perform_create(serializer)
        ensure_next_match(serializer.instance)

    def perform_update(self, serializer):
        was_active = serializer.instance.is_active
        super().perform_update(serializer)
        # O realinhamento das partidas futuras **não** é feito aqui: mora no
        # sinal `post_save` de `RecurringGame` (apps/matches/signals.py), para
        # valer também no admin, no shell e nos scripts — não só nesta rota.
        # Reativar um jogo recorrente também precisa repor a próxima partida.
        if serializer.instance.is_active and not was_active:
            ensure_next_match(serializer.instance)

    @action(detail=True, methods=["post"], url_path="generate-match")
    def generate_match(self, request, pk=None):
        """Gera a próxima partida sob demanda.

        É a saída explícita para os dois casos em que a geração automática não
        age de propósito: a ocorrência foi removida pelo organizador, ou ainda
        está fora da janela de antecedência configurada.

        Quando a próxima ocorrência já existe, ela é **realinhada** com a
        configuração atual antes de voltar — nunca devolve a versão anterior à
        última edição."""
        recurring_game = self.get_object()
        match = ensure_next_match(recurring_game, force=True)
        if match is None:
            raise DomainError(
                "Não foi possível gerar a partida. Verifique se o jogo recorrente está ativo."
            )
        return Response(MatchSerializer(match, context={"request": request}).data)


class MatchViewSet(OrganizationScopedViewSetMixin, viewsets.ModelViewSet):
    serializer_class = MatchSerializer
    queryset = (
        Match.objects.select_related("recurring_game")
        .prefetch_related("confirmations", "waitlist_entries__player")
        .all()
    )
    filterset_fields = ["status", "recurring_game"]
    ordering_fields = ["scheduled_date", "scheduled_time"]

    READ_ACTIONS = ("list", "retrieve", "roster", "waitlist")
    #: Rotas de **auto-serviço**: o jogador entra, mas o resultado é sempre
    #: recortado pelo login dele (ver `_my_player`). Nunca colocar aqui uma
    #: rota que aceite o id de outro jogador vindo do cliente.
    SELF_SERVICE_ACTIONS = ("mine", "confirm_me", "confirmed")

    def get_permissions(self):
        if self.action in self.SELF_SERVICE_ACTIONS:
            return [IsOrganizationParticipant()]
        if self.action in self.READ_ACTIONS:
            return [IsOrganizationMember()]
        return [IsOrganizationOrganizerOrAdmin()]

    # -- Auto-serviço do jogador --------------------------------------------

    def _my_player(self):
        """A ficha do usuário logado **nesta** organização.

        A identidade global é o `User`; a ficha esportiva é por organização
        (`Player.user`). O mesmo login pode ter uma ficha em cada pelada, com
        nível e posição próprios — é daqui que sai a certa."""
        return Player.objects.filter(
            organization=self.request.organization, user=self.request.user
        ).first()

    @action(detail=False, methods=["get"])
    def mine(self, request):
        """As partidas desta organização do ponto de vista de quem está logado.

        Traz a própria situação de presença junto, que é a única coisa que o
        jogador precisa saber para agir."""
        player = self._my_player()
        matches = self.get_queryset().filter(
            scheduled_date__gte=timezone.localdate() - timedelta(days=7)
        ).order_by("scheduled_date", "scheduled_time")

        minhas_confirmacoes = {}
        if player is not None:
            minhas_confirmacoes = {
                confirmation.match_id: confirmation.status
                for confirmation in Confirmation.objects.filter(player=player, match__in=matches)
            }

        payload = []
        for match in matches:
            item = self.get_serializer(match).data
            item["my_confirmation_status"] = minhas_confirmacoes.get(match.id, "pending")
            item["my_player_id"] = player.id if player else None
            payload.append(item)
        return Response(payload)

    @action(detail=True, methods=["get"])
    def confirmed(self, request, pk=None):
        """Quem confirmou presença nesta partida.

        Entra em `SELF_SERVICE_ACTIONS` embora **não** seja recorte por
        usuário — e a exceção precisa estar dita, porque a regra ali é "nunca
        colocar aqui uma rota que aceite o id de outro jogador vindo do
        cliente". Esta não aceita id nenhum: devolve a lista de confirmados da
        partida, que é informação **coletiva** da pelada. Quem vai jogar sabe
        quem mais vai — é o que se combina no grupo do WhatsApp de qualquer
        jeito.

        O que ela não faz é abrir o cadastro: o payload traz nome, apelido e
        quando confirmou. Telefone, nível técnico e observações continuam
        restritos ao `roster`, que exige papel de gestão.
        """
        match = self.get_object()
        capacity = get_match_capacity(match)
        confirmados = [
            {
                "id": confirmation.player_id,
                "name": confirmation.player.name,
                "nickname": confirmation.player.nickname,
                "confirmed_at": confirmation.confirmed_at,
            }
            # Mesma fonte do contador e do sorteio: se a tela lesse de outro
            # lugar, um dia mostraria oito nomes com o contador dizendo nove.
            for confirmation in confirmed_confirmations(match)
        ]
        return Response(
            {
                "confirmed": ConfirmedPlayerSerializer(confirmados, many=True).data,
                "confirmed_count": len(confirmados),
                "max_players": capacity.max_players,
                "min_players": capacity.min_players,
            }
        )

    @action(detail=True, methods=["post"], url_path="confirm-me")
    def confirm_me(self, request, pk=None):
        """Confirma ou cancela a **própria** presença.

        O jogador nunca informa quem é: a ficha vem de `request.user`. Um
        `player` no corpo da requisição é ignorado de propósito — aceitar o id
        do cliente aqui transformaria a rota de auto-serviço numa porta para
        confirmar presença de terceiros."""
        match = self.get_object()
        player = self._my_player()
        if player is None:
            raise DomainError(
                "Seu login ainda não está vinculado a um jogador nesta organização. "
                "Peça ao gerente para fazer a vinculação."
            )

        serializer = SelfConfirmationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        outcome = set_confirmation(
            match=match, player=player, status=serializer.validated_data["status"]
        )
        self._catch_up_automatic_draw(match)
        return Response(
            {
                "match": match.id,
                "player": player.id,
                "status": outcome.status,
                "waitlisted": outcome.waitlisted,
                "waitlist_position": outcome.waitlist_position,
                "confirmed_count": count_confirmed(match),
            }
        )

    #: O que a auditoria guarda de uma partida. Gravar o objeto inteiro faria a
    #: trilha virar ruído; estes são os campos por onde uma partida "muda de
    #: identidade" para quem confirmou presença.
    AUDITED_FIELDS = (
        "name",
        "scheduled_date",
        "scheduled_time",
        "draw_time",
        "location",
        "teams_count",
        "goalkeepers_per_team",
        "min_players",
        "max_players",
        "status",
    )

    def _snapshot(self, match) -> dict:
        return {field: str(getattr(match, field)) for field in self.AUDITED_FIELDS}

    # -- Sorteio automático: gatilhos de recuperação --------------------------
    #
    # O beat do Celery é o disparo pontual, mas a regra é da **configuração
    # atual** da partida — então os pontos de contato dela também avaliam se há
    # sorteio vencido (ver `run_due_automatic_draw`). É o que faz uma partida
    # avulsa editada para ganhar horário de sorteio ser tratada como automática
    # na hora, mesmo com o horário já passado ou o worker fora do ar.

    def _catch_up_automatic_draw(self, match) -> None:
        from apps.draws.services import run_due_automatic_draw

        if run_due_automatic_draw(match=match) is not None:
            # A resposta desta própria requisição deve sair com status
            # `Sorteada` — sem o refresh, o PATCH/GET devolveria o estado de
            # antes do sorteio e a tela mostraria informação velha.
            match.refresh_from_db()

    def perform_create(self, serializer):
        super().perform_create(serializer)
        log_action(
            organization=self.request.organization,
            action=AuditLog.Action.MATCH_CREATED,
            match=serializer.instance,
            after=self._snapshot(serializer.instance),
        )
        self._catch_up_automatic_draw(serializer.instance)

    def perform_update(self, serializer):
        before = self._snapshot(serializer.instance)
        super().perform_update(serializer)
        after = self._snapshot(serializer.instance)
        # Só registra o que **mudou**: um PATCH de local não deve encher a
        # trilha com dez campos idênticos.
        alterados = {campo for campo in after if before[campo] != after[campo]}
        if alterados:
            log_action(
                organization=self.request.organization,
                action=AuditLog.Action.MATCH_UPDATED,
                match=serializer.instance,
                before={campo: before[campo] for campo in alterados},
                after={campo: after[campo] for campo in alterados},
            )
        self._catch_up_automatic_draw(serializer.instance)

    def retrieve(self, request, *args, **kwargs):
        match = self.get_object()
        self._catch_up_automatic_draw(match)
        return Response(self.get_serializer(match).data)

    # -- Presença -----------------------------------------------------------

    @action(detail=True, methods=["get"])
    def roster(self, request, pk=None):
        match = self.get_object()
        # Cadastro da organização **mais** os convidados temporários desta
        # partida: eles não estão no cadastro de propósito (existem só para o
        # sorteio desta partida), mas precisam aparecer aqui para o organizador
        # conferir e desmarcar presença.
        players = (
            Player.objects.filter(organization=request.organization, status=Player.Status.ATIVO)
            .filter(Q(is_temporary=False) | Q(confirmations__match=match))
            .distinct()
            .select_related("primary_position", "secondary_position")
        )
        confirmations = {c.player_id: c for c in match.confirmations.all()}
        waitlist = {entry.player_id: entry for entry in waitlist_entries(match)}

        serialized = PlayerSerializer(players, many=True, context={"request": request}).data
        data = []
        for player, player_data in zip(players, serialized, strict=True):
            confirmation = confirmations.get(player.id)
            entry = waitlist.get(player.id)
            data.append(
                {
                    "player": player_data,
                    "confirmation_status": confirmation.status if confirmation else "pending",
                    "waitlist_position": entry.position if entry else None,
                }
            )
        return Response(data)

    @action(detail=True, methods=["post"], url_path="set-confirmation")
    def set_confirmation_action(self, request, pk=None):
        match = self.get_object()
        serializer = SetConfirmationSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        outcome = set_confirmation(
            match=match,
            player=serializer.validated_data["player"],
            status=serializer.validated_data["status"],
        )
        # Confirmar presença é justamente o que destrava um sorteio automático
        # vencido que estava parado por falta de gente — então a retentativa
        # acontece aqui, no momento em que o mínimo pode ter sido atingido, e
        # não só quando alguém recarrega a tela.
        self._catch_up_automatic_draw(match)
        return Response(
            {
                "player": outcome.player.id,
                "status": outcome.status,
                "waitlisted": outcome.waitlisted,
                "waitlist_position": outcome.waitlist_position,
                "promoted": [
                    {"id": player.id, "name": player.name} for player in outcome.promoted
                ],
                "confirmed_count": count_confirmed(match),
                "match_status": match.status,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=True, methods=["post"], url_path="set-all-confirmations")
    def set_all_confirmations_action(self, request, pk=None):
        match = self.get_object()
        serializer = SetAllConfirmationsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        result = set_all_confirmations(match=match, status=serializer.validated_data["status"])
        self._catch_up_automatic_draw(match)
        return Response(
            {
                "status": serializer.validated_data["status"],
                "confirmed": result.confirmed,
                "waitlisted": result.waitlisted,
                "declined": result.declined,
                # Mantido por compatibilidade com o contrato anterior.
                "updated": result.confirmed + result.waitlisted + result.declined,
            }
        )

    @action(detail=True, methods=["post"], url_path="quick-confirm")
    def quick_confirm(self, request, pk=None):
        match = self.get_object()
        serializer = QuickConfirmNamesSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        results = quick_confirm_names(
            match=match,
            raw_names=serializer.validated_data["names"],
            pasted_list=serializer.validated_data["pasted_list"],
        )
        self._catch_up_automatic_draw(match)
        return Response(results, status=status.HTTP_200_OK)

    @action(detail=True, methods=["post"], url_path="reassign-confirmation")
    def reassign_confirmation_action(self, request, pk=None):
        match = self.get_object()
        serializer = ReassignConfirmationSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        confirmation = reassign_confirmation(
            match=match,
            wrong_player=serializer.validated_data["wrong_player"],
            correct_player=serializer.validated_data["correct_player"],
        )
        return Response(
            {
                "player_id": confirmation.player_id,
                "player_name": confirmation.player.name,
                "status": confirmation.status,
            }
        )

    # -- Lista de espera ----------------------------------------------------

    def _waitlist_response(self, match):
        return Response(WaitlistEntrySerializer(waitlist_entries(match), many=True).data)

    @action(detail=True, methods=["get"])
    def waitlist(self, request, pk=None):
        return self._waitlist_response(self.get_object())

    @action(detail=True, methods=["post"], url_path="waitlist/promote")
    def waitlist_promote(self, request, pk=None):
        match = self.get_object()
        serializer = WaitlistPlayerSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        promote_from_waitlist(match=match, player=serializer.validated_data["player"])
        return self._waitlist_response(match)

    @action(detail=True, methods=["post"], url_path="waitlist/move")
    def waitlist_move(self, request, pk=None):
        match = self.get_object()
        serializer = WaitlistMoveSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        move_waitlist_entry(
            match=match,
            player=serializer.validated_data["player"],
            position=serializer.validated_data["position"],
        )
        return self._waitlist_response(match)

    @action(detail=True, methods=["post"], url_path="waitlist/remove")
    def waitlist_remove(self, request, pk=None):
        match = self.get_object()
        serializer = WaitlistPlayerSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        remove_from_waitlist(match=match, player=serializer.validated_data["player"])
        return self._waitlist_response(match)

    # -- Ciclo de vida ------------------------------------------------------

    @action(detail=True, methods=["post"])
    def cancel(self, request, pk=None):
        match = self.get_object()
        before = self._snapshot(match)
        match = cancel_match(match=match)
        log_action(
            organization=request.organization,
            action=AuditLog.Action.MATCH_CANCELED,
            match=match,
            before={"status": before["status"]},
            after={"status": match.status},
            reason=request.data.get("reason", ""),
        )
        return Response(self.get_serializer(match).data)

    @action(detail=True, methods=["post"])
    def reactivate(self, request, pk=None):
        match = reactivate_match(match=self.get_object())
        return Response(self.get_serializer(match).data)

    # -- Sorteio e placar ---------------------------------------------------

    @action(detail=True, methods=["post"])
    def draw(self, request, pk=None):
        """Sorteia os times desta partida.

        O corpo é **opcional** e retrocompatível: sem ele, o sorteio é
        exatamente o de sempre. Com `formation` (e opcionalmente
        `formations_by_team`, indexado pela ordem do time), os jogadores são
        encaixados no desenho escolhido **depois** de o algoritmo distribuí-los
        — a formação não é critério do sorteio.
        """
        from apps.draws.serializers import DrawSerializer
        from apps.draws.services import execute_draw

        match = self.get_object()

        formation = request.data.get("formation") or None
        raw_by_team = request.data.get("formations_by_team") or {}
        formations_by_team = (
            {int(key): value for key, value in raw_by_team.items()}
            if isinstance(raw_by_team, dict)
            else {}
        )

        draw = execute_draw(
            match=match,
            executed_by=request.user,
            formation=formation,
            formations_by_team=formations_by_team,
        )
        return Response(DrawSerializer(draw).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=["post"], url_path="set-results")
    def set_results(self, request, pk=None):
        from apps.draws.serializers import SetMatchResultsSerializer, TeamSerializer
        from apps.draws.services import set_match_results

        match = self.get_object()
        serializer = SetMatchResultsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        team_results = set_match_results(match=match, results=serializer.validated_data["results"])
        teams = [team_result.team for team_result in team_results]
        return Response(TeamSerializer(teams, many=True).data)
