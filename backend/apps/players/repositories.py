from .models import Position

DEFAULT_POSITIONS = [
    ("GOL", "Goleiro", 1),
    ("ZAG", "Zagueiro", 2),
    ("ME", "Meio-Campo", 3),
    ("AT", "Atacante", 4),
]


class PositionRepository:
    @staticmethod
    def bulk_create_defaults(organization) -> list[Position]:
        return Position.objects.bulk_create(
            [
                Position(organization=organization, code=code, name=name, sort_order=order)
                for code, name, order in DEFAULT_POSITIONS
            ]
        )
