"""Contract §4: provably fair crash points (rng.ProvablyFairCrashPointProvider, fairness.Sha256Fairness)."""

import hashlib
import hmac
import math
import secrets

from app.fairness import Sha256Fairness
from app.rng import ProvablyFairCrashPointProvider, crash_point

RTP = 0.97
CAP = 10_000  # 100.00x


def reference_crash(seed: str, round_id: str, rtp: float = RTP, cap: int = CAP) -> int:
    """The §4.2 formula written out step by step, as a player would check it."""
    h = hmac.new(seed.encode(), round_id.encode(), hashlib.sha256).hexdigest()
    u = int(h[:13], 16) / 2**52
    raw = rtp / (1 - u)
    return min(cap, max(100, math.floor(raw * 100)))


def test_crash_point_is_deterministic_and_matches_the_formula():
    for _ in range(2000):
        seed, rid = secrets.token_hex(32), f"r_{secrets.randbelow(10**6)}"
        got = crash_point(seed, rid, RTP, CAP)
        assert got == crash_point(seed, rid, RTP, CAP)
        # Float rounding can differ by one hundredth at an exact boundary; exact maths is the reference.
        assert abs(got - reference_crash(seed, rid)) <= 1
        assert 100 <= got <= CAP


def test_provider_uses_a_fresh_seed_every_round():
    p = ProvablyFairCrashPointProvider(RTP, CAP)
    seeds = {p.new_round(f"r_{i}").server_seed for i in range(200)}
    assert len(seeds) == 200
    assert all(len(s) == 64 and int(s, 16) >= 0 for s in seeds)


def test_rtp_holds_for_any_cash_out_target():
    """WORKFLOW Step 2: P(crash >= m) = RTP / m, so every target returns RTP on average."""
    n = 200_000
    seed = hashlib.sha256(b"ascent rtp simulation").hexdigest()  # fixed, so the test is deterministic
    crashes = [crash_point(seed, f"r_{i}", RTP, CAP) for i in range(n)]
    instant = sum(c == 100 for c in crashes) / n
    assert abs(instant - (1 - RTP / 1.01)) < 0.003  # P(crash < 1.01x): about 4% bust at 1.00x
    for target in (150, 200, 500, 1000):
        m = target / 100
        p = RTP / m
        tolerance = 4 * m * math.sqrt(p * (1 - p) / n)  # four standard errors
        rtp = sum(c >= target for c in crashes) / n * m
        assert abs(rtp - RTP) < tolerance, (target, rtp, tolerance)


def test_cap_applies():
    seeds = (secrets.token_hex(32) for _ in range(20_000))
    assert max(crash_point(s, "r_1", RTP, 300) for s in seeds) == 300


def test_commitment_is_sha256_of_seed_and_verify_checks_everything():
    fair = Sha256Fairness(RTP, CAP)
    seed = secrets.token_hex(32)
    commitment = fair.commit(seed)
    assert commitment == hashlib.sha256(seed.encode()).hexdigest()

    crash = crash_point(seed, "r_7", RTP, CAP)
    ok = fair.verify("r_7", seed, commitment, crash)
    assert ok.valid
    assert ok.hmac == hmac.new(seed.encode(), b"r_7", hashlib.sha256).hexdigest()

    assert not fair.verify("r_7", seed, commitment, crash + 1).valid  # tampered crash point
    assert not fair.verify("r_7", secrets.token_hex(32), commitment, crash).valid  # swapped seed


def test_live_app_rounds_verify(config):
    from fastapi.testclient import TestClient

    from app.clock import ManualClock
    from app.main import create_app

    from .conftest import auth

    clock = ManualClock()
    client = TestClient(create_app(config, clock=clock, autostart=False))
    eng = client.app.state.services.engine
    eng.open_betting()
    clock.advance(config.bettingWindowMs)
    eng.launch()
    clock.advance(10**9)
    assert eng.tick()
    v = client.get(f"/api/v1/rounds/{eng.round.round_id}/verify", headers=auth()).json()
    assert v["valid"] is True
    assert v["commitment"] == hashlib.sha256(v["serverSeed"].encode()).hexdigest()
