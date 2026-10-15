import json

import pytest

from app.config import ConfigError, load_config, public_config

from .conftest import make_config, raw_config


def test_repo_config_loads():
    cfg = load_config()
    assert cfg.min_bet_units == 100
    assert cfg.max_bet_units == 100_000
    assert cfg.max_multiplier_hundredths == 1_000_000
    assert cfg.contractVersion


@pytest.mark.parametrize(
    "overrides, fragment",
    [
        ({"minBet": 500, "maxBet": 10}, "must not be greater than maxBet"),
        ({"defaultLanguage": "de"}, "defaultLanguage 'de'"),
        ({"tickIntervalMs": 0}, "tickIntervalMs"),
        ({"targetRtp": 1.5}, "targetRtp"),
        ({"multiplierDecimals": 3}, "only 2 is supported"),
        ({"quickBetChips": [5000]}, "outside minBet..maxBet"),
        ({"maxBett": 10}, "unknown key"),
    ],
)
def test_invalid_values_give_readable_errors(overrides, fragment):
    with pytest.raises(ConfigError) as exc:
        make_config(**overrides)
    assert fragment in str(exc.value)


def test_missing_key_is_reported():
    raw = raw_config()
    del raw["growthRate"]
    from app.config import parse_config

    with pytest.raises(ConfigError, match="growthRate: required key is missing"):
        parse_config(raw)


def test_missing_file_and_bad_json(tmp_path):
    with pytest.raises(ConfigError, match="not found"):
        load_config(tmp_path / "nope.json")
    bad = tmp_path / "bad.json"
    bad.write_text("{ not json", encoding="utf-8")
    with pytest.raises(ConfigError, match="not valid JSON"):
        load_config(bad)


def test_public_config_hides_server_settings():
    pub = public_config(make_config())
    assert "server" not in pub
    assert pub["minBet"] == "1.00"
    assert pub["quickBetChips"] == ["10.00", "50.00", "100.00", "250.00"]
    json.dumps(pub)  # serialisable


def test_config_endpoint(client):
    body = client.get("/api/v1/config").json()
    assert body["contractVersion"] == make_config().contractVersion
    assert "server" not in body
