from .repositories import PositionRepository


def seed_default_positions(organization):
    """Cria as posições padrão (GOL/ZAG/ME/AT) para uma organização recém-criada.
    A organização pode depois criar posições adicionais livremente."""
    return PositionRepository.bulk_create_defaults(organization)
