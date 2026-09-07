from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = spec_from_file_location(
    "score_scan_identification",
    ROOT / "scripts" / "score_scan_identification.py",
)
mod = module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)


def test_phase1_fails_without_25_pokemon_units():
    report = mod.score_rows(
        [
            {
                "unitId": "u1",
                "category": "pokemon",
                "displayName": "Charizard",
                "externalSources": ["tcgdex"],
                "candidateCount": 1,
                "candidatesWithRequiredId": 1,
                "holdingWritten": False,
                "confirmedCorrect": True,
            }
        ]
    )
    assert report["pokemon"]["units"] == 1
    assert report["pokemon"]["passed"] is False
    assert any("need 25" in b for b in report["pokemon"]["blockers"])
