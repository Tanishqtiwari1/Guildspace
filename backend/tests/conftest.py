import os
import sys
import tempfile
import pytest

# Isolated database and no AI key, so tests exercise the rule-based fallbacks deterministically.
_tmp = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = f"sqlite:///{os.path.join(_tmp, 'test.db')}"
os.environ["SECRET_KEY"] = "test-secret"
os.environ.pop("ANTHROPIC_API_KEY", None)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi.testclient import TestClient  # noqa: E402
import main, models, database  # noqa: E402


@pytest.fixture()
def client():
    models.Base.metadata.drop_all(bind=database.engine)
    models.Base.metadata.create_all(bind=database.engine)
    with TestClient(main.app) as c:
        yield c


def register(client, name, email, **extra):
    r = client.post("/api/auth/register", json={"name": name, "email": email, "password": "password123", **extra})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}, r.json()["user"]
