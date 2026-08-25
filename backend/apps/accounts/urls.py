from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .login_serializers import UsernameOrPhoneTokenSerializer
from .membership_views import OrganizationMemberViewSet
from .views import ChangePasswordView, MeView, MyOrganizationsView

router = DefaultRouter()
# Membros da organização corrente — gestão do Gerente. Distinto de
# `/api/admin/memberships/`, que é do Super Admin e cruza organizações.
router.register("members", OrganizationMemberViewSet, basename="organization-member")


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """Login com throttle próprio (`login`, por minuto).

    O throttle anônimo global é diário: com `100/day` por IP, uma rede com NAT
    compartilhado (o clube, o escritório) consumia a cota e **todo mundo ficava
    24h sem conseguir entrar** — e o 429 chegava na tela indistinguível de senha
    errada. O escopo dedicado protege contra força bruta sem punir o dia inteiro.

    Aceita **usuário ou telefone** no mesmo campo: o jogador conhece o próprio
    número, não o `username` que o sistema inventou para ele."""

    throttle_scope = "login"
    serializer_class = UsernameOrPhoneTokenSerializer


class ThrottledTokenRefreshView(TokenRefreshView):
    throttle_scope = "login"


urlpatterns = [
    path("token/", ThrottledTokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("token/refresh/", ThrottledTokenRefreshView.as_view(), name="token_refresh"),
    path("me/", MeView.as_view(), name="me"),
    # Fora do bloqueio do primeiro acesso: é a saída de quem está com a senha
    # temporária (ver `apps.accounts.middleware`).
    path("change-password/", ChangePasswordView.as_view(), name="change-password"),
    path("organizations/mine/", MyOrganizationsView.as_view(), name="my-organizations"),
    path("", include(router.urls)),
]
