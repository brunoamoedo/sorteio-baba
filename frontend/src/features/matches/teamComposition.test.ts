import { describe, expect, it } from "vitest";

import type { Team, TeamPlayer } from "../../core/types/draw";
import { formatDrawResultMessage } from "./shareFormat";
import {
  applyPlayerMove,
  applyPositionChange,
  applySwap,
  computeTeamMetrics,
  describeManualMove,
  formatAverage,
  formationReport,
  skillSpread,
  teamSkillTotals,
  weakestSplitReport,
} from "./teamComposition";

const POSITION = { id: 1, code: "ATA", name: "Atacante", sort_order: 3, is_active: true };

function player(id: number, name: string, skill: number, overrides: Partial<TeamPlayer> = {}): TeamPlayer {
  return {
    id,
    player_id: 100 + id,
    player_name: name,
    player_nickname: "",
    player_photo: null,
    player_type: "mensalista",
    position_snapshot: POSITION,
    skill_snapshot: skill,
    used_secondary_position: false,
    line_index: null,
    slot_index: null,
    ...overrides,
  };
}

function team(id: number, players: TeamPlayer[], formation = ""): Team {
  return {
    id,
    name: `Time ${id}`,
    color: "",
    order_index: id - 1,
    formation,
    total_skill: players.reduce((sum, entry) => sum + entry.skill_snapshot, 0),
    team_players: players,
    result: null,
  };
}

/** O exemplo do enunciado da regra: João sai do Time 1 para o Time 2. */
function twoTeams(): Team[] {
  return [
    team(1, [player(1, "João", 1), player(2, "Pedro", 3), player(3, "Carlos", 4)]),
    team(2, [player(4, "Bruno", 1), player(5, "Rafael", 4), player(6, "Diego", 5)]),
  ];
}

describe("applyPlayerMove", () => {
  it("tira o jogador do time de origem e o coloca no time de destino", () => {
    const result = applyPlayerMove(twoTeams(), 1, 2);

    expect(result).not.toBeNull();
    const [first, second] = result!.teams;
    expect(first.team_players.map((entry) => entry.player_name)).toEqual(["Pedro", "Carlos"]);
    expect(second.team_players.map((entry) => entry.player_name)).toEqual([
      "Bruno",
      "Rafael",
      "Diego",
      "João",
    ]);
  });

  it("preserva id, nome, nível, posição e tipo do jogador movido", () => {
    const original = twoTeams();
    const guest = player(1, "João", 1, { player_type: "convidado", player_nickname: "Joãozinho" });
    original[0].team_players[0] = guest;

    const moved = applyPlayerMove(original, 1, 2)!.teams[1].team_players.at(-1)!;

    expect(moved).toEqual(guest);
  });

  it("não altera os times originais (o resultado substitui o estado)", () => {
    const original = twoTeams();

    applyPlayerMove(original, 1, 2);

    expect(original[0].team_players).toHaveLength(3);
    expect(original[1].team_players).toHaveLength(3);
  });

  it("descreve a movimentação com os rótulos dos dois times", () => {
    const { move } = applyPlayerMove(twoTeams(), 1, 2)!;

    expect(move.playerName).toBe("João");
    expect(move.playerId).toBe(101);
    expect(move.fromTeamId).toBe(1);
    expect(move.toTeamId).toBe(2);
    expect(describeManualMove(move)).toBe(
      "João foi movido manualmente do Time 1 🔵 para o Time 2 🔴.",
    );
  });

  it("devolve null quando o jogador é solto no time em que já estava", () => {
    expect(applyPlayerMove(twoTeams(), 1, 1)).toBeNull();
  });

  it("devolve null para jogador ou time desconhecido", () => {
    expect(applyPlayerMove(twoTeams(), 999, 2)).toBeNull();
    expect(applyPlayerMove(twoTeams(), 1, 999)).toBeNull();
  });

  it("acumula várias movimentações, inclusive a volta do mesmo jogador", () => {
    const first = applyPlayerMove(twoTeams(), 1, 2)!;
    const second = applyPlayerMove(first.teams, 5, 1)!;
    // João já está no Time 2 depois da primeira movimentação.
    const soltoNoMesmoTime = applyPlayerMove(second.teams, 1, 2);
    const deVolta = applyPlayerMove(second.teams, 1, 1)!.teams;

    expect(second.teams[0].team_players.map((entry) => entry.player_name)).toEqual([
      "Pedro",
      "Carlos",
      "Rafael",
    ]);
    expect(second.teams[1].team_players.map((entry) => entry.player_name)).toEqual([
      "Bruno",
      "Diego",
      "João",
    ]);
    // Soltar no mesmo time continua sendo "nada aconteceu"...
    expect(soltoNoMesmoTime).toBeNull();
    // ...e mover de volta devolve o jogador ao time de origem.
    expect(deVolta[0].team_players.map((entry) => entry.player_name)).toEqual([
      "Pedro",
      "Carlos",
      "Rafael",
      "João",
    ]);
    expect(deVolta[1].team_players.map((entry) => entry.player_name)).toEqual(["Bruno", "Diego"]);
  });
});

describe("indicadores de equilíbrio", () => {
  it("conta jogadores, soma estrelas e calcula a média do time", () => {
    const [first] = twoTeams();

    expect(computeTeamMetrics(first)).toEqual({
      playerCount: 3,
      totalSkill: 8,
      averageSkill: 8 / 3,
    });
  });

  it("reflete a composição depois da movimentação manual", () => {
    const teams = applyPlayerMove(twoTeams(), 1, 2)!.teams;

    expect(computeTeamMetrics(teams[0])).toMatchObject({ playerCount: 2, totalSkill: 7 });
    expect(computeTeamMetrics(teams[1])).toMatchObject({ playerCount: 4, totalSkill: 11 });
  });

  it("não divide por zero em time vazio", () => {
    expect(computeTeamMetrics(team(9, []))).toEqual({
      playerCount: 0,
      totalSkill: 0,
      averageSkill: 0,
    });
  });

  it("formata a média no padrão brasileiro", () => {
    expect(formatAverage(3)).toBe("3,0");
    expect(formatAverage(16 / 5)).toBe("3,2");
  });
});

describe("equilíbrio entre os times", () => {
  it("mede a distância entre o time mais forte e o mais fraco", () => {
    expect(skillSpread(teamSkillTotals(twoTeams()))).toBe(2);
  });

  it("mostra a piora causada por uma troca de um 2⭐ por um 5⭐", () => {
    // O caso real relatado: o algoritmo entregou 19/18/18 e duas trocas
    // manuais abriram 7 estrelas entre o time mais forte e o mais fraco.
    const teams = [
      team(1, [player(1, "Sergio", 2), player(2, "Barba", 4), player(3, "Emanuel", 3)]),
      team(2, [player(4, "João Busquets", 5), player(5, "Astro", 1), player(6, "Digs", 4)]),
    ];
    const antes = teamSkillTotals(teams);

    const passo1 = applyPlayerMove(teams, 1, 2)!.teams; // Sergio 2⭐ → time 2
    const depois = teamSkillTotals(applyPlayerMove(passo1, 4, 1)!.teams); // Busquets 5⭐ → time 1

    expect(antes).toEqual([9, 10]);
    expect(depois).toEqual([12, 7]);
    expect(skillSpread(depois)).toBeGreaterThan(skillSpread(antes));
  });
});

describe("weakestSplitReport", () => {
  it("aponta a regra dos piores como respeitada quando eles estão separados", () => {
    const teams = [
      team(1, [player(1, "João", 1), player(2, "Pedro", 4)]),
      team(2, [player(3, "Bruno", 1), player(4, "Rafael", 4)]),
    ];

    expect(weakestSplitReport(teams)).toMatchObject({
      weakestLevel: 1,
      weakestCount: 2,
      maxInSameTeam: 1,
      satisfied: true,
    });
  });

  it("acusa a quebra da regra quando o organizador junta dois dos piores", () => {
    const teams = twoTeams();
    const afterMove = applyPlayerMove(teams, 1, 2)!.teams;

    expect(weakestSplitReport(teams)?.satisfied).toBe(true);
    expect(weakestSplitReport(afterMove)).toMatchObject({ maxInSameTeam: 2, satisfied: false });
  });

  it("aceita a concentração inevitável (mais piores que times)", () => {
    const teams = [
      team(1, [player(1, "João", 1), player(2, "Pedro", 1)]),
      team(2, [player(3, "Bruno", 1), player(4, "Rafael", 1)]),
    ];

    expect(weakestSplitReport(teams)).toMatchObject({ allowedPerTeam: 2, satisfied: true });
  });
});

describe("texto do WhatsApp", () => {
  it("passa a listar o jogador no time novo depois da movimentação", () => {
    const before = formatDrawResultMessage(twoTeams());
    const after = formatDrawResultMessage(applyPlayerMove(twoTeams(), 1, 2)!.teams);

    // A posição acompanha cada nome: quem lê no grupo precisa saber onde vai
    // jogar, e a mensagem antes trazia só o nome.
    expect(before).toContain("🏆 Time 1 🔵:\n👤 João (ATA)\n👤 Pedro (ATA)\n👤 Carlos (ATA)");
    expect(after).toContain("🏆 Time 1 🔵:\n👤 Pedro (ATA)\n👤 Carlos (ATA)");
    expect(after).toContain(
      "🏆 Time 2 🔴:\n👤 Bruno (ATA)\n👤 Rafael (ATA)\n👤 Diego (ATA)\n👤 João (ATA)",
    );
  });

  it("inclui a formação no cabeçalho de cada time", () => {
    const teams = [
      team(1, [player(1, "João", 3)], "2-2-2"),
      team(2, [player(2, "Bruno", 3)], "3-1-2"),
    ];

    const texto = formatDrawResultMessage(teams);

    expect(texto).toContain("🏆 Time 1 🔵 — 2-2-2:");
    expect(texto).toContain("🏆 Time 2 🔴 — 3-1-2:");
  });

  it("sem formação, o cabeçalho continua como sempre foi", () => {
    expect(formatDrawResultMessage(twoTeams())).toContain("🏆 Time 1 🔵:");
  });

  it("convidado continua marcado — a regra vale em todo lugar", () => {
    const teams = [team(1, [player(1, "Zé", 3, { player_type: "convidado" })])];
    expect(formatDrawResultMessage(teams)).toContain("👤 Zé (ATA) _(convidado)_");
  });
});

/* -------------------------------------------------------------------------
 * Operações que não existiam: alterar posição e trocar dois jogadores.
 * ---------------------------------------------------------------------- */

const ZAG = { id: 2, code: "ZAG", name: "Zagueiro", sort_order: 2, is_active: true };
const MEI = { id: 3, code: "ME", name: "Meio-Campo", sort_order: 3, is_active: true };

describe("applyPositionChange", () => {
  it("troca a posição sem mexer no time", () => {
    const teams = twoTeams();
    const resultado = applyPositionChange(teams, 1, ZAG)!;

    const jogador = resultado.teams[0].team_players.find((p) => p.id === 1)!;
    expect(jogador.position_snapshot.code).toBe("ZAG");
    expect(resultado.teams[0].team_players).toHaveLength(3);
    expect(resultado.teams[1].team_players).toHaveLength(3);
  });

  it("limpa a vaga no desenho — o servidor devolve a nova na revalidação", () => {
    const teams = [team(1, [player(1, "João", 3, { line_index: 2, slot_index: 1 })])];
    const resultado = applyPositionChange(teams, 1, ZAG)!;

    expect(resultado.teams[0].team_players[0].line_index).toBeNull();
    expect(resultado.teams[0].team_players[0].slot_index).toBeNull();
  });

  it("não faz nada quando a posição já é a atual", () => {
    const teams = [team(1, [player(1, "João", 3, { position_snapshot: ZAG })])];
    expect(applyPositionChange(teams, 1, ZAG)).toBeNull();
  });

  it("não faz nada com jogador desconhecido", () => {
    expect(applyPositionChange(twoTeams(), 999, ZAG)).toBeNull();
  });

  it("não muta a composição original", () => {
    const teams = twoTeams();
    applyPositionChange(teams, 1, ZAG);
    expect(teams[0].team_players[0].position_snapshot.code).toBe("ATA");
  });

  it("descreve a alteração em português", () => {
    const resultado = applyPositionChange(twoTeams(), 1, ZAG)!;
    expect(describeManualMove(resultado.move)).toBe(
      "João passou de ATA para ZAG no Time 1 🔵.",
    );
  });
});

describe("applySwap", () => {
  it("troca dois jogadores entre times preservando o tamanho de cada um", () => {
    const teams = twoTeams();
    const resultado = applySwap(teams, 1, 4)!;

    // Mover deixaria 2×4; a troca mantém 3×3 — é a diferença que motiva a
    // operação existir.
    expect(resultado.teams[0].team_players).toHaveLength(3);
    expect(resultado.teams[1].team_players).toHaveLength(3);
    expect(resultado.teams[0].team_players.map((p) => p.id)).toContain(4);
    expect(resultado.teams[1].team_players.map((p) => p.id)).toContain(1);
  });

  it("troca dentro do mesmo time trocando as vagas", () => {
    const teams = [
      team(1, [
        player(1, "João", 3, { line_index: 0, slot_index: 0, position_snapshot: ZAG }),
        player(2, "Pedro", 4, { line_index: 2, slot_index: 1, position_snapshot: MEI }),
      ]),
    ];

    const resultado = applySwap(teams, 1, 2)!;
    const joao = resultado.teams[0].team_players.find((p) => p.id === 1)!;
    const pedro = resultado.teams[0].team_players.find((p) => p.id === 2)!;

    expect(joao.line_index).toBe(2);
    expect(joao.position_snapshot.code).toBe("ME");
    expect(pedro.line_index).toBe(0);
    expect(pedro.position_snapshot.code).toBe("ZAG");
    expect(resultado.teams[0].team_players).toHaveLength(2);
  });

  it("não troca um jogador com ele mesmo", () => {
    expect(applySwap(twoTeams(), 1, 1)).toBeNull();
  });

  it("não faz nada quando um dos dois não existe", () => {
    expect(applySwap(twoTeams(), 1, 999)).toBeNull();
  });

  it("não muta a composição original", () => {
    const teams = twoTeams();
    applySwap(teams, 1, 4);
    expect(teams[0].team_players.map((p) => p.id)).toEqual([1, 2, 3]);
  });

  it("descreve a troca entre times", () => {
    const resultado = applySwap(twoTeams(), 1, 4)!;
    expect(describeManualMove(resultado.move)).toBe(
      "João e Bruno trocaram de time (Time 1 🔵 ↔ Time 2 🔴).",
    );
  });

  it("descreve a troca dentro do mesmo time", () => {
    const teams = [team(1, [player(1, "João", 3), player(2, "Pedro", 4)])];
    const resultado = applySwap(teams, 1, 2)!;
    expect(describeManualMove(resultado.move)).toBe(
      "João e Pedro trocaram de posição no Time 1 🔵.",
    );
  });
});

describe("formationReport", () => {
  it("é nulo quando o time não tem formação", () => {
    expect(formationReport(team(1, [player(1, "João", 3)]))).toBeNull();
  });

  it("acusa satisfeita quando todos têm vaga", () => {
    const t = team(
      1,
      [
        player(1, "João", 3, { line_index: 0, slot_index: 0 }),
        player(2, "Pedro", 3, { line_index: 1, slot_index: 0 }),
      ],
      "1-1",
    );
    expect(formationReport(t)).toMatchObject({ unplaced: 0, satisfied: true });
  });

  it("é nulo quando a notação da formação é inválida", () => {
    // Uma formação de linha única não descreve nada — o mínimo é 2.
    expect(formationReport(team(1, [player(1, "João", 3)], "2"))).toBeNull();
  });

  it("acusa quebra quando alguém ficou sem vaga", () => {
    const t = team(
      1,
      [
        player(1, "João", 3, { line_index: 0, slot_index: 0 }),
        player(2, "Pedro", 3, { line_index: null, slot_index: null }),
      ],
      "1-1",
    );
    expect(formationReport(t)).toMatchObject({ unplaced: 1, satisfied: false });
  });

  it("o goleiro não conta como jogador de linha", () => {
    // O goleiro fica sem `line_index` de propósito (tem faixa própria no
    // desenho) — e isso não pode ser lido como "formação quebrada".
    const GOL = { id: 1, code: "GOL", name: "Goleiro", sort_order: 1, is_active: true };
    const t = team(
      1,
      [
        player(1, "Zé", 3, { position_snapshot: GOL, line_index: null, slot_index: 0 }),
        player(2, "Pedro", 3, { line_index: 0, slot_index: 0 }),
        player(3, "Ana", 3, { line_index: 1, slot_index: 0 }),
      ],
      "1-1",
    );
    expect(formationReport(t)).toMatchObject({ linePlayers: 2, unplaced: 0, satisfied: true });
  });
});
