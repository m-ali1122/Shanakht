import pytest

from pk_names import VARIANTS, canonical_token, detect_script, parse

VARIANT_TABLE = {  # spec section 4.4
    "muhammad": ["Mohammad", "Muhammed", "Mohd", "Muhd", "Mohammed"],
    "ahmad": ["Ahmed"],
    "hussain": ["Hussein", "Husain", "Hussan"],
    "zulfiqar": ["Zulfikar", "Zulfiquar"],
    "qureshi": ["Quraishi", "Qureishi"],
    "ayesha": ["Aisha", "Aysha", "Ayisha"],
    "fatima": ["Fatma", "Fatimah"],
    "mehmood": ["Mahmood", "Mehmud"],
    "yousaf": ["Yousuf", "Yusuf"],
}


@pytest.mark.parametrize("canon,variant",
                         [(c, v) for c, vs in VARIANT_TABLE.items() for v in vs])
def test_variant_table(canon, variant):
    assert parse(variant).tokens_canonical == [canon]


@pytest.mark.parametrize("v", ["Abdur Rahman", "Abd-ul-Rehman", "A. Rehman", "Abdulrehman",
                               "Abdul Rehman"])
def test_abdul_rehman_compound(v):
    assert parse(v).tokens_canonical == ["abdulrehman"]


@pytest.mark.parametrize("v", ["Ch.", "Chaudhary", "Choudhry", "Chaudri", "Chaudhry"])
def test_chaudhry_title_variants(v):
    assert parse(f"{v} Zulfiqar").titles == ["chaudhry"]


def test_patronymic_and_initial():
    p = parse("Mohd Ali s/o Rehmat")
    assert p.tokens_canonical == ["muhammad", "ali"]
    assert p.patronymic["relation"] == "s/o" and p.patronymic["tokens"] == ["rehmat"]
    assert any(t.startswith("initial_expanded") for t in p.transformations)


@pytest.mark.parametrize("marker,rel", [("S/O", "s/o"), ("d/o", "d/o"), ("w/o", "w/o"),
                                        ("son of", "s/o"), ("bint", "d/o"), ("bin", "s/o")])
def test_relation_markers(marker, rel):
    p = parse(f"Fatima {marker} Aslam")
    assert p.patronymic["relation"] == rel and p.patronymic["tokens"] == ["aslam"]


def test_urdu_relation_marker():
    p = parse("محمد علی ولد رحمت")
    assert p.tokens_canonical == ["muhammad", "ali"]
    assert p.patronymic["tokens"] == ["rehmat"]


def test_urdu_script_with_title():
    p = parse("راجہ عمران اکرم")
    assert p.script == "urdu"
    assert p.titles == ["raja"] and p.tokens_canonical == ["imran", "akram"]


def test_shahmukhi_detected():
    assert detect_script("رحمݨ") == "shahmukhi"
    assert detect_script("Rehmat") == "roman"


def test_titles_stripped():
    p = parse("Syed Hassan Qureshi")
    assert p.titles == ["syed"] and p.family == ["qureshi"]


def test_title_only_name_is_not_stripped():
    assert parse("Malik").tokens_canonical == ["malik"]


def test_case_and_punctuation():
    assert parse("  MUHAMMAD   ali, ").tokens_canonical == ["muhammad", "ali"]
    assert canonical_token("Mohd") == "muhammad"
