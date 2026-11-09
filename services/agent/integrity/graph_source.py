"""Graph access behind an interface so the integrity logic is testable without Neo4j."""
from __future__ import annotations

from typing import Protocol

from .leaves import KEY_PROPS, Element, node_id, rel_id

TAMPER_PROPS = ("raw_name", "title_raw", "amount_pkr", "canonical_name", "name")


class GraphSource(Protocol):
    def snapshot(self) -> list[Element]: ...
    def fetch(self, element_ids: list[str]) -> dict[str, Element]: ...
    def tamper(self, element_id: str) -> dict: ...


def _tampered(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v + 1
    return f"{v} (edited)" if v is not None else "edited"


class InMemoryGraphSource:
    def __init__(self, elements: list[Element] | None = None):
        self.elements = {e.id: e for e in (elements or [])}

    def snapshot(self):
        return list(self.elements.values())

    def fetch(self, element_ids):
        return {i: self.elements[i] for i in element_ids if i in self.elements}

    def tamper(self, element_id):
        el = self.elements[element_id]
        key = next((k for k in TAMPER_PROPS if k in el.properties), "tampered")
        el.properties[key] = _tampered(el.properties.get(key))
        return {"element_id": element_id, "property": key}


def _where(alias: str, node_eid: str, pfx: str) -> tuple[str, dict]:
    """WHERE clause matching a node by its stable id ("Label:key" or "Fingerprint:BANK:fp")."""
    label, _, key = node_eid.partition(":")
    if label == "Fingerprint" and key.count(":") == 1:
        bank, _, fp = key.partition(":")
        return (f"{alias}:Fingerprint AND {alias}.bank=${pfx}_bank AND {alias}.fp=${pfx}_key",
                {f"{pfx}_bank": bank, f"{pfx}_key": fp})
    prop = KEY_PROPS.get(label, "id")
    return f"{alias}:`{label}` AND toString({alias}.`{prop}`)=${pfx}_key", {f"{pfx}_key": key}


class Neo4jGraphSource:
    """Reads the whole graph in two queries for commits; targeted queries for proofs."""

    def __init__(self, driver):
        self.driver = driver

    def snapshot(self):
        out = []
        with self.driver.session() as s:
            for r in s.run("MATCH (n) RETURN labels(n)[0] AS label, properties(n) AS props"):
                eid, kv = node_id(r["label"], r["props"])
                out.append(Element("node", eid, r["label"], dict(r["props"]),
                                   signer=r["props"].get("signer"), key_value=kv))
            for r in s.run("MATCH (a)-[r]->(b) RETURN type(r) AS t, labels(a)[0] AS la, properties(a) AS pa, "
                           "labels(b)[0] AS lb, properties(b) AS pb, properties(r) AS pr"):
                sa, _ = node_id(r["la"], r["pa"])
                sb, _ = node_id(r["lb"], r["pb"])
                out.append(Element("rel", rel_id(r["t"], sa, sb), r["t"], dict(r["pr"])))
        return out

    def fetch(self, element_ids):
        """Current state of specific elements (by stable id)."""
        out = {}
        with self.driver.session() as s:
            for eid in set(element_ids):
                if ">" in eid:
                    rtype, _, rest = eid.partition(":")
                    a, _, b = rest.partition(">")
                    wa, pa = _where("a", a, "a")
                    wb, pb = _where("b", b, "b")
                    rec = s.run(f"MATCH (a)-[r:`{rtype}`]->(b) WHERE {wa} AND {wb} "
                                "RETURN properties(r) AS pr LIMIT 1", **pa, **pb).single()
                    if rec is not None:
                        out[eid] = Element("rel", eid, rtype, dict(rec["pr"]))
                else:
                    w, p = _where("n", eid, "n")
                    rec = s.run(f"MATCH (n) WHERE {w} RETURN labels(n)[0] AS label, properties(n) AS props "
                                "LIMIT 1", **p).single()
                    if rec is not None:
                        nid, kv = node_id(rec["label"], rec["props"])
                        out[eid] = Element("node", nid, rec["label"], dict(rec["props"]),
                                           signer=rec["props"].get("signer"), key_value=kv)
        return out

    def tamper(self, element_id):
        """Insider edit: change one property directly in Neo4j; the leaf table is NOT touched."""
        if ">" in element_id:
            raise ValueError("tamper supports nodes only")
        w, p = _where("n", element_id, "n")
        with self.driver.session() as s:
            rec = s.run(f"MATCH (n) WHERE {w} RETURN properties(n) AS p LIMIT 1", **p).single()
            if rec is None:
                raise KeyError(element_id)
            props = rec["p"]
            target = next((k for k in TAMPER_PROPS if k in props), "tampered")
            s.run(f"MATCH (n) WHERE {w} SET n.`{target}`=$v, n.tampered=true",
                  v=_tampered(props.get(target)), **p)
        return {"element_id": element_id, "property": target}


def neo4j_source():
    from neo4j import GraphDatabase

    import config
    return Neo4jGraphSource(GraphDatabase.driver(config.NEO4J_URI, auth=(config.NEO4J_USER, config.NEO4J_PASSWORD)))
