from abc import ABC, abstractmethod
from dataclasses import dataclass

from ..entities import Player
from ..scoring import ScoreBreakdown, ScoringWeights


@dataclass
class DrawSolution:
    team_of: list[int]
    use_secondary: list[bool]
    score: ScoreBreakdown
    iterations_run: int


class DrawStrategy(ABC):
    """Interface de estratégia de sorteio (Strategy Pattern). Permite plugar
    outros algoritmos (Genetic Algorithm, Hill Climbing) sem alterar o
    DrawService, que depende apenas desta interface."""

    @abstractmethod
    def solve(
        self,
        players: list[Player],
        teams_count: int,
        pair_history: dict[tuple[int, int], float],
        weights: ScoringWeights,
    ) -> DrawSolution: ...
