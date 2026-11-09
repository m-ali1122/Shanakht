"""Name perturbation functions (spec 4.4). Each one is pure given an rng, so
they can be unit-tested in isolation. Names are plain Roman-script strings."""
import random
import re

VARIANTS = {
    "Muhammad": ["Mohammad", "Muhammed", "Mohd", "Muhd", "M.", "Mohammed"],
    "Ahmad": ["Ahmed"],
    "Hussain": ["Hussein", "Husain", "Hussan"],
    "Abdul Rehman": ["Abdur Rahman", "Abd-ul-Rehman", "A. Rehman", "Abdulrehman"],
    "Zulfiqar": ["Zulfikar", "Zulfiquar"],
    "Chaudhry": ["Ch.", "Chaudhary", "Choudhry", "Chaudri"],
    "Qureshi": ["Quraishi", "Qureishi"],
    "Ayesha": ["Aisha", "Aysha", "Ayisha"],
    "Fatima": ["Fatma", "Fatimah"],
    "Mehmood": ["Mahmood", "Mehmud"],
    "Yousaf": ["Yousuf", "Yusuf"],
}

TITLES = ["Raja", "Ch.", "Syed", "Rana", "Hafiz", "Mian", "Malik", "Sheikh"]
TITLE_RE = re.compile(r"^(raja|ch\.?|chaudhry|chaudhary|choudhry|chaudri|syed|rana|hafiz|mian|malik|sheikh|dr\.|engr\.)\s+", re.I)
REL_RE = re.compile(r"\s+(s/o|d/o|w/o|son of|daughter of|wife of|bin|bint)\s+.*$", re.I)


def apply_variant(name: str, rng: random.Random, canonical: str | None = None) -> str:
    """Replace one canonical form present in the name with a random variant."""
    present = [c for c in sorted(VARIANTS) if re.search(rf"\b{re.escape(c)}\b", name)]
    if canonical is not None:
        present = [c for c in present if c == canonical]
    if not present:
        return name
    c = rng.choice(present)
    v = rng.choice(VARIANTS[c])
    return re.sub(rf"\b{re.escape(c)}\b", v, name, count=1)


def drop_title(name: str, rng: random.Random | None = None) -> str:
    return TITLE_RE.sub("", name, count=1)


def add_title(name: str, rng: random.Random) -> str:
    if TITLE_RE.match(name):
        return name
    return f"{rng.choice(TITLES)} {name}"


def drop_patronymic(name: str, rng: random.Random | None = None) -> str:
    return REL_RE.sub("", name)


def add_patronymic(name: str, father: str, relation: str = "s/o") -> str:
    if REL_RE.search(name) or not father:
        return name
    return f"{name} {relation} {father}"


def swap_tokens(name: str, rng: random.Random) -> str:
    """Swap the first two name tokens (titles and patronymic left alone)."""
    m = REL_RE.search(name)
    tail = name[m.start():] if m else ""
    core = name[:m.start()] if m else name
    tm = TITLE_RE.match(core)
    head = core[:tm.end()] if tm else ""
    body = core[tm.end():] if tm else core
    toks = body.split()
    if len(toks) < 2:
        return name
    toks[0], toks[1] = toks[1], toks[0]
    return f"{head}{' '.join(toks)}{tail}"


def typo_one_char(name: str, rng: random.Random) -> str:
    """One-character typo: substitute, delete or transpose inside a token of len>=4."""
    toks = name.split(" ")
    idx = [i for i, t in enumerate(toks) if len(t) >= 4 and t.isalpha()]
    if not idx:
        return name
    i = rng.choice(idx)
    orig = toks[i]
    t = orig
    for _ in range(20):  # retry: substitution with same char / swapping "dd" are no-ops
        j = rng.randrange(1, len(orig) - 1)
        op = rng.choice(["sub", "del", "swap"])
        if op == "sub":
            c = rng.choice("aeiouhnrst")
            t = orig[:j] + (c if orig[j].islower() else c.upper()) + orig[j + 1:]
        elif op == "del":
            t = orig[:j] + orig[j + 1:]
        else:
            t = orig[:j] + orig[j + 1] + orig[j] + orig[j + 2:]
        if t != orig:
            break
    toks[i] = t
    return " ".join(toks)


def change_case(name: str, rng: random.Random) -> str:
    return rng.choice([str.upper, str.lower, str.title])(name)


def collapse_spaces(name: str, rng: random.Random | None = None) -> str:
    """Collapse a known two-token given name ('Abdul Rehman' -> 'Abdulrehman')."""
    for a, b in (("Abdul", "Rehman"), ("Ghulam", "Rasool"), ("Abdur", "Rahman")):
        pat = re.compile(rf"\b{a}\s+{b}\b", re.I)
        if pat.search(name):
            return pat.sub(lambda m: m.group(0).split()[0] + m.group(0).split()[-1].lower(), name, count=1)
    return name


PERTURBATIONS = [apply_variant, drop_title, add_title, drop_patronymic,
                 swap_tokens, change_case, collapse_spaces]


def perturb(name: str, rng: random.Random, n_max: int = 3, typo_rate: float = 0.05,
            allow=("variant", "drop_title", "add_title", "drop_patronymic", "swap", "case", "collapse")) -> tuple[str, list]:
    """Apply 0..n_max perturbations; returns (name, applied_list)."""
    table = {"variant": apply_variant, "drop_title": drop_title, "add_title": add_title,
             "drop_patronymic": drop_patronymic, "swap": swap_tokens,
             "case": change_case, "collapse": collapse_spaces}
    applied = []
    # variant-heavy weighting: realistic records mostly differ in spelling
    weights = {"variant": 5, "drop_title": 2, "add_title": 1, "drop_patronymic": 2,
               "swap": 0.5, "case": 1, "collapse": 1}
    keys = [k for k in allow if k in table]
    for _ in range(rng.randint(0, n_max)):
        k = rng.choices(keys, weights=[weights[x] for x in keys])[0]
        new = table[k](name, rng)
        if new != name:
            applied.append(k)
            name = new
    if rng.random() < typo_rate:
        new = typo_one_char(name, rng)
        if new != name:
            applied.append("typo")
            name = new
    return re.sub(r"\s+", " ", name).strip(), applied
