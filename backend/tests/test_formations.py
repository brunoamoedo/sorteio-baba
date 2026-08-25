"""Formações — módulo puro, testável sem banco.

O foco destes testes é a promessa feita ao produto: as formações que o pedido
lista para 5, 6 e 7 jogadores **existem** no catálogo, e o mapeamento de linhas
para posições funciona mesmo quando a formação tem mais linhas do que a
organização tem posições cadastradas.
"""

import pytest

from apps.draws.domain.formations import (
    AssignablePlayer,
    Formation,
    assign_players_to_slots,
    assignment_cost,
    build_slots,
    default_formation,
    format_formation,
    generate_formations,
    is_valid_formation,
    map_lines_to_positions,
    parse_formation,
)


class TestParse:
    def test_le_a_notacao_do_usuario(self):
        formation = parse_formation("2-2-2")
        assert formation.lines == (2, 2, 2)
        assert formation.key == "2-2-2"
        assert formation.line_players == 6
        assert formation.line_count == 3

    def test_ida_e_volta(self):
        assert format_formation(parse_formation("3-1-2-1").lines) == "3-1-2-1"

    @pytest.mark.parametrize("invalida", ["", "abc", "2", "2-x", "2-0-2", "0-2"])
    def test_recusa_notacao_invalida(self, invalida):
        with pytest.raises(ValueError):
            parse_formation(invalida)


class TestCatalogo:
    """As formações que o produto prometeu precisam estar na lista."""

    @pytest.mark.parametrize(
        "line_players,esperadas",
        [
            (5, ["2-1-2", "1-2-2", "2-2-1", "1-3-1"]),
            (6, ["2-2-2", "3-1-2", "2-3-1", "3-2-1", "1-3-2"]),
            (7, ["3-2-1-1", "2-3-1-1", "3-1-2-1", "2-2-2-1"]),
        ],
    )
    def test_cobre_os_exemplos_do_pedido(self, line_players, esperadas):
        geradas = {formation.key for formation in generate_formations(line_players)}
        faltando = [key for key in esperadas if key not in geradas]
        assert not faltando, f"faltam no catálogo de {line_players}: {faltando}"

    @pytest.mark.parametrize("line_players", range(2, 13))
    def test_toda_formacao_distribui_exatamente_o_elenco(self, line_players):
        for formation in generate_formations(line_players):
            assert formation.line_players == line_players

    @pytest.mark.parametrize("line_players", range(2, 13))
    def test_nenhuma_linha_vazia_nem_superlotada(self, line_players):
        for formation in generate_formations(line_players):
            assert all(size >= 1 for size in formation.lines)
            assert all(size <= 4 for size in formation.lines), formation.key

    def test_quatro_linhas_so_a_partir_de_sete_jogadores(self):
        # Com 6 ou menos, uma quarta faixa deixaria linhas de um jogador só
        # espalhadas pelo campo — deixa de descrever futebol.
        assert all(f.line_count <= 3 for f in generate_formations(6))
        assert any(f.line_count == 4 for f in generate_formations(7))

    def test_a_mais_equilibrada_vem_primeiro(self):
        assert generate_formations(6)[0].key == "2-2-2"
        assert generate_formations(8)[0].key == "2-2-2-2"
        assert default_formation(6).key == "2-2-2"

    def test_no_empate_de_equilibrio_vence_quem_tem_meio_campo(self):
        # `3-3` e `2-2-2` têm a mesma variância (zero) — mas `3-3` é um time
        # sem meio-campo. O desempate por número de linhas existe para isso.
        opcoes = [f.key for f in generate_formations(6)]
        assert opcoes.index("2-2-2") < opcoes.index("3-3")

    def test_elenco_pequeno_demais_nao_tem_formacao(self):
        assert generate_formations(1) == []
        assert default_formation(1) is None

    def test_catalogo_e_estavel_entre_chamadas(self):
        # A tela guarda a escolha do organizador pela chave; se a ordem ou o
        # conteúdo mudasse entre chamadas, a seleção "pularia".
        assert [f.key for f in generate_formations(7)] == [f.key for f in generate_formations(7)]


class TestValidacao:
    def test_aceita_formacao_que_distribui_o_elenco(self):
        assert is_valid_formation(parse_formation("2-2-2"), 6)

    def test_recusa_formacao_que_nao_fecha_a_conta(self):
        assert not is_valid_formation(parse_formation("2-2-2"), 7)

    def test_aceita_arranjo_fora_do_catalogo_que_seja_possivel(self):
        # O organizador pode querer algo que o catálogo não sugere. Se a conta
        # fecha, é fisicamente possível — não cabe ao sistema recusar.
        assert is_valid_formation(parse_formation("1-1-1-1-2"), 6)


class TestMapeamentoDePosicoes:
    """O ponto delicado: a formação pode ter mais linhas do que a organização
    tem posições de linha cadastradas."""

    ZAG, ME, AT = 2, 3, 4

    def test_uma_posicao_por_linha_quando_a_conta_bate(self):
        assert map_lines_to_positions(3, [self.ZAG, self.ME, self.AT]) == [self.ZAG, self.ME, self.AT]

    def test_quatro_linhas_em_tres_posicoes_repete_a_do_meio(self):
        # `3-1-2-1` com ZAG/ME/AT: as duas faixas centrais são ambas de meio —
        # e o campo ainda desenha **quatro** linhas, porque a linha é guardada
        # separada da posição.
        assert map_lines_to_positions(4, [self.ZAG, self.ME, self.AT]) == [
            self.ZAG,
            self.ME,
            self.ME,
            self.AT,
        ]

    def test_duas_linhas_usam_os_extremos(self):
        assert map_lines_to_positions(2, [self.ZAG, self.ME, self.AT]) == [self.ZAG, self.AT]

    def test_organizacao_com_posicoes_extras(self):
        # Nada no algoritmo assume ZAG/ME/AT: uma organização com 5 posições de
        # linha é distribuída do mesmo jeito.
        assert map_lines_to_positions(3, [1, 2, 3, 4, 5]) == [1, 3, 5]

    def test_sem_posicoes_cadastradas_nao_quebra(self):
        assert map_lines_to_positions(3, []) == []


class TestSlots:
    def test_uma_vaga_por_jogador_da_formacao(self):
        slots = build_slots(parse_formation("2-2-2"), [2, 3, 4])
        assert len(slots) == 6
        assert [s.line_index for s in slots] == [0, 0, 1, 1, 2, 2]
        assert [s.slot_index for s in slots] == [0, 1, 0, 1, 0, 1]

    def test_a_posicao_da_vaga_vem_da_linha(self):
        slots = build_slots(parse_formation("3-1-2"), [2, 3, 4])
        assert [s.position_id for s in slots] == [2, 2, 2, 3, 4, 4]


class TestAtribuicao:
    """Encaixar os jogadores do time nas vagas, minimizando o fora-de-posição."""

    ORDER = {2: 2, 3: 3, 4: 4}  # ZAG, ME, AT

    def player(self, pid, primary, secondary=None):
        return AssignablePlayer(
            id=pid,
            primary_position_id=primary,
            secondary_position_id=secondary,
            primary_sort_order=self.ORDER[primary],
        )

    def test_custo_zero_na_posicao_principal(self):
        slots = build_slots(parse_formation("2-2-2"), [2, 3, 4])
        assert assignment_cost(self.player(1, 2), slots[0], self.ORDER) == 0

    def test_custo_um_na_secundaria(self):
        slots = build_slots(parse_formation("2-2-2"), [2, 3, 4])
        meio = next(s for s in slots if s.position_id == 3)
        assert assignment_cost(self.player(1, 2, secondary=3), meio, self.ORDER) == 1

    def test_custo_cresce_com_a_distancia_da_posicao(self):
        slots = build_slots(parse_formation("2-2-2"), [2, 3, 4])
        meio = next(s for s in slots if s.position_id == 3)
        ataque = next(s for s in slots if s.position_id == 4)
        zagueiro = self.player(1, 2)
        assert assignment_cost(zagueiro, ataque, self.ORDER) > assignment_cost(
            zagueiro, meio, self.ORDER
        )

    def test_cada_um_na_sua_posicao_quando_o_elenco_encaixa(self):
        slots = build_slots(parse_formation("2-2-2"), [2, 3, 4])
        players = [
            self.player(1, 2),
            self.player(2, 2),
            self.player(3, 3),
            self.player(4, 3),
            self.player(5, 4),
            self.player(6, 4),
        ]
        assignment = assign_players_to_slots(players, slots, self.ORDER)

        assert len(assignment) == 6
        total = sum(
            assignment_cost(p, assignment[p.id], self.ORDER) for p in players
        )
        assert total == 0

    def test_nenhuma_vaga_e_ocupada_duas_vezes(self):
        slots = build_slots(parse_formation("3-2-1"), [2, 3, 4])
        players = [self.player(i, 2) for i in range(1, 7)]
        assignment = assign_players_to_slots(players, slots, self.ORDER)

        ocupadas = [(s.line_index, s.slot_index) for s in assignment.values()]
        assert len(ocupadas) == len(set(ocupadas))

    def test_jogador_excedente_fica_sem_vaga_mas_nao_e_descartado(self):
        # Times de tamanhos diferentes são permitidos (regra §6.3). O sétimo
        # jogador simplesmente não tem vaga fixa no desenho.
        slots = build_slots(parse_formation("2-2-2"), [2, 3, 4])
        players = [self.player(i, 3) for i in range(1, 8)]
        assignment = assign_players_to_slots(players, slots, self.ORDER)

        assert len(assignment) == 6

    def test_a_troca_de_pares_conserta_o_guloso(self):
        # Um atacante e um zagueiro que ficariam melhor com as vagas trocadas.
        slots = build_slots(parse_formation("1-1", ), [2, 4]) if False else build_slots(
            parse_formation("1-1"), [2, 4]
        )
        players = [self.player(1, 4), self.player(2, 2)]
        assignment = assign_players_to_slots(players, slots, self.ORDER)

        total = sum(assignment_cost(p, assignment[p.id], self.ORDER) for p in players)
        assert total == 0

    def test_sem_vagas_ou_sem_jogadores_devolve_vazio(self):
        assert assign_players_to_slots([], build_slots(parse_formation("2-2"), [2, 4]), self.ORDER) == {}
        assert assign_players_to_slots([self.player(1, 2)], [], self.ORDER) == {}


class TestFormationDataclass:
    def test_equilibrio_penaliza_linhas_desiguais(self):
        assert Formation((2, 2, 2)).balance_score < Formation((1, 1, 4)).balance_score
