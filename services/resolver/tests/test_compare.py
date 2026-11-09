from compare import compare


def test_s2_close_match():
    r = compare("Mohd Ali s/o Rehmat", "MUHAMMAD ALI")
    assert r["band"] == "CLOSE"
    assert 0.85 <= r["score"] < 0.95
    assert "PATRONYMIC_DROPPED" in r["reasons"]
    assert {"INITIAL_EXPANDED", "VARIANT_SPELLING"} & set(r["reasons"])
    rels = {a["typed_token"]: a["relation"] for a in r["alignment"] if a["typed_token"]}
    assert rels["Rehmat"] == "dropped" and rels["Ali"] == "exact"


def test_s4_urdu_anchor():
    r = compare("Imraan Akram", "RAJA IMRAN AKRAM", "راجہ عمران اکرم")
    assert r["band"] == "CLOSE"
    assert {"SCRIPT_CONVERTED", "VARIANT_SPELLING", "TITLE_DROPPED"} <= set(r["reasons"])
    tr = [a for a in r["alignment"] if a["relation"] == "transliterated"]
    assert tr and tr[0]["urdu_token"] == "عمران"


def test_s3_different_person():
    r = compare("Zainab Bibi", "TARIQ MEHMOOD")
    assert r["band"] == "NO_MATCH" and "DIFFERENT_PERSON" in r["reasons"]


def test_s1_match():
    r = compare("Ayesha Siddiqui", "AYESHA SIDDIQUI")
    assert r["band"] == "MATCH" and r["reasons"] == []


def test_roman_vs_urdu_title():
    r = compare("Imran Akram", "راجہ عمران اکرم")
    assert r["band"] in ("CLOSE", "MATCH") and "SCRIPT_CONVERTED" in r["reasons"]


def test_chaudhry_zulfikar():
    r = compare("Ch. Zulfikar", "Chaudhry Zulfiqar")
    assert r["band"] in ("CLOSE", "MATCH") and "VARIANT_SPELLING" in r["reasons"]


def test_abdulrehman():
    r = compare("Abdulrehman", "Abdur Rahman")
    assert r["band"] in ("CLOSE", "MATCH")


def test_m_usman_not_close_by_name_alone():
    r = compare("M. Usman", "Usman Ghani")
    assert r["band"] == "NO_MATCH" and r["score"] < 0.75


def test_reasons_deterministic():
    a = compare("Mohd Ali s/o Rehmat", "MUHAMMAD ALI")
    b = compare("Mohd Ali s/o Rehmat", "MUHAMMAD ALI")
    assert a["reasons"] == b["reasons"] and a["score"] == b["score"]


def test_s2_with_urdu_supplied_not_script_converted():
    r = compare("Mohd Ali s/o Rehmat", "MUHAMMAD ALI", "محمد علی")
    assert r["band"] == "CLOSE" and 0.88 <= r["score"] <= 0.93
    assert "SCRIPT_CONVERTED" not in r["reasons"]
    assert "PATRONYMIC_DROPPED" in r["reasons"]


def test_s4_score_and_compounding():
    r = compare("Imraan Akram", "RAJA IMRAN AKRAM", "راجہ عمران اکرم")
    assert r["band"] == "CLOSE" and 0.85 <= r["score"] <= 0.90
    r2 = compare("Imraan Akram", "RAJA IMRAN AKRAM")
    assert r2["band"] == "CLOSE" and r2["score"] < 0.95
    assert "SCRIPT_CONVERTED" not in r2["reasons"]
