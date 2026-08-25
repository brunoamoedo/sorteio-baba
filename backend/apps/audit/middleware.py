import contextvars

_current_request = contextvars.ContextVar("current_request", default=None)


def get_current_request():
    """Usado pelo AuditService (Fase 5) para capturar IP/user-agent/usuário
    sem precisar repassar o `request` por todas as camadas de service."""
    return _current_request.get()


class CurrentRequestMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        token = _current_request.set(request)
        try:
            return self.get_response(request)
        finally:
            _current_request.reset(token)
