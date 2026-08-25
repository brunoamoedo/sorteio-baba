import pytest
from rest_framework.test import APIClient

from .factories import UserFactory


@pytest.mark.django_db
def test_obtain_token_and_fetch_me():
    user = UserFactory(username="joao")
    client = APIClient()

    token_response = client.post(
        "/api/auth/token/",
        {"username": "joao", "password": "senha-forte-123"},
        format="json",
    )
    assert token_response.status_code == 200
    access_token = token_response.json()["access"]

    client.credentials(HTTP_AUTHORIZATION=f"Bearer {access_token}")
    me_response = client.get("/api/auth/me/")

    assert me_response.status_code == 200
    assert me_response.json()["email"] == user.email


@pytest.mark.django_db
def test_wrong_password_is_rejected():
    UserFactory(username="maria")
    client = APIClient()

    response = client.post(
        "/api/auth/token/",
        {"username": "maria", "password": "senha-errada"},
        format="json",
    )

    assert response.status_code == 401
