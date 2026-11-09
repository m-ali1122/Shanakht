import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import perturb as P  # noqa: E402
from generate import title_for, to_urdu  # noqa: E402


def rng(s=1):
    return random.Random(s)


def test_apply_variant_every_row():
    for canon, variants in P.VARIANTS.items():
        seen = {P.apply_variant(f"{canon} Khan", rng(i)) for i in range(200)}
        assert seen == {f"{v} Khan" for v in variants}, canon


def test_apply_variant_noop_when_absent():
    assert P.apply_variant("Bilal Khan", rng()) == "Bilal Khan"


def test_drop_and_add_title():
    assert P.drop_title("Raja Imran Akram") == "Imran Akram"
    assert P.drop_title("Ch. Zulfiqar Awan") == "Zulfiqar Awan"
    assert P.drop_title("Imran Akram") == "Imran Akram"
    added = P.add_title("Imran Akram", rng())
    assert added.endswith("Imran Akram") and added != "Imran Akram"
    assert P.add_title("Syed Ali", rng()) == "Syed Ali"


def test_patronymic():
    assert P.drop_patronymic("Mohd Ali s/o Rehmat") == "Mohd Ali"
    assert P.drop_patronymic("Sana Awan d/o Ghulam Rasool") == "Sana Awan"
    assert P.add_patronymic("Muhammad Ali", "Rehmat") == "Muhammad Ali s/o Rehmat"
    assert P.add_patronymic("Ali s/o X", "Rehmat") == "Ali s/o X"


def test_swap_tokens_keeps_title_and_patronymic():
    assert P.swap_tokens("Raja Imran Akram s/o Akram", rng()) == "Raja Akram Imran s/o Akram"
    assert P.swap_tokens("Ali", rng()) == "Ali"


def test_typo_one_char_changes_exactly_one_token():
    for s in range(50):
        out = P.typo_one_char("Ayesha Siddiqui", rng(s))
        a, b = "Ayesha Siddiqui".split(), out.split()
        assert len(b) == 2 and sum(x != y for x, y in zip(a, b)) == 1
        assert out[0] == "A"  # first char preserved


def test_change_case_and_collapse():
    assert P.change_case("Ayesha Siddiqui", rng()).lower() == "ayesha siddiqui"
    assert P.collapse_spaces("Abdul Rehman Khan") == "Abdulrehman Khan"
    assert P.collapse_spaces("Bilal Khan") == "Bilal Khan"


def test_perturb_deterministic():
    assert P.perturb("Muhammad Hussain Qureshi", rng(5)) == P.perturb("Muhammad Hussain Qureshi", rng(5))


def test_bank_title_quirks():
    assert title_for("MRGL", "Raja Imran Akram") == "IMRAN AKRAM"
    assert title_for("RAVI", "Abd-ul-Rehman Ch. Awan") == "ABDULREHMAN CH AWAN"
    assert title_for("CHNB", "Raja Imran Akram") == "RAJA IMRAN AKRAM"
    assert title_for("INDS", "Muhammad Ali") == "M. Ali"
    assert len(title_for("INDS", "Abdul Rehman Zulfiqar Chaudhary")) <= 24
    assert title_for("MRGL", "Mohd Ali s/o Rehmat") == "MOHD ALI"


def test_urdu_mapping():
    assert to_urdu("Raja Imran Akram") == "راجہ عمران اکرم"
    assert to_urdu("Muhammad Ali") == "محمد علی"
    assert to_urdu("Abdul Rehman Khan") == "عبدالرحمان خان"
    assert "ݨ" in to_urdu("Imran Akram", shahmukhi=True)
