from dataclasses import dataclass


@dataclass(frozen=True)
class Player:
    """Representação pura (sem ORM) de um jogador confirmado, usada pelo
    motor de sorteio. Mantém o algoritmo testável e independente do Django."""

    id: int
    skill_level: int
    primary_position_id: int
    secondary_position_id: int | None
    #: Convidado (não mensalista). Entra no equilíbrio geral para que os
    #: convidados não se concentrem todos no mesmo time.
    is_guest: bool = False
