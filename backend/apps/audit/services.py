from .middleware import get_current_request
from .models import AuditLog


def _client_ip(request) -> str | None:
    forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")


def log_action(
    *,
    organization,
    action: str,
    match=None,
    draw=None,
    user=None,
    player=None,
    team_from=None,
    team_to=None,
    entity: str = "",
    entity_id: int | None = None,
    before: dict | None = None,
    after: dict | None = None,
    reason: str = "",
) -> AuditLog:
    """
    Registra uma entrada de auditoria. `user`/IP/user-agent são inferidos do
    request corrente (via CurrentRequestMiddleware) quando não informados
    explicitamente — permite chamar esta função de dentro de services sem
    precisar repassar o objeto `request` por toda a cadeia de chamadas.
    Nunca falha por conta própria: auditoria não deve derrubar a operação
    principal que a originou.
    """
    request = get_current_request()
    ip_address = None
    user_agent = ""

    if request is not None:
        ip_address = _client_ip(request)
        user_agent = request.META.get("HTTP_USER_AGENT", "")[:500]
        if user is None and getattr(request, "user", None) and request.user.is_authenticated:
            user = request.user

    return AuditLog.objects.create(
        organization=organization,
        action=action,
        match=match,
        draw=draw,
        user=user,
        player=player,
        team_from=team_from,
        team_to=team_to,
        entity=entity,
        entity_id=entity_id,
        before=before or {},
        after=after or {},
        reason=reason,
        ip_address=ip_address,
        user_agent=user_agent,
    )
