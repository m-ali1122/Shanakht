"""Neo4j access for the agent: a read-only executor with timeout and JSON-safe rows."""
from __future__ import annotations

import threading

import config
from cypher_guard import guard

_driver = None
_lock = threading.Lock()


class GraphUnavailable(RuntimeError):
    pass


def driver():
    global _driver
    with _lock:
        if _driver is None:
            from neo4j import GraphDatabase
            _driver = GraphDatabase.driver(config.NEO4J_URI, auth=(config.NEO4J_USER, config.NEO4J_PASSWORD),
                                           connection_timeout=3)
        return _driver


def available() -> bool:
    try:
        driver().verify_connectivity()
        return True
    except Exception:
        return False


def to_json(v):
    """Make neo4j values JSON-safe; temporal values become ISO-8601 strings (never epoch ms)."""
    if hasattr(v, "iso_format"):
        return v.iso_format()
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if hasattr(v, "labels") and hasattr(v, "items"):          # Node
        return {**{k: to_json(x) for k, x in dict(v).items()}, "_labels": sorted(v.labels)}
    if hasattr(v, "type") and hasattr(v, "items") and hasattr(v, "nodes"):  # Relationship/path-ish
        return {k: to_json(x) for k, x in dict(v).items()}
    if isinstance(v, dict):
        return {k: to_json(x) for k, x in v.items()}
    if isinstance(v, (list, tuple, set)):
        return [to_json(x) for x in v]
    return v


def run_read(query: str, params: dict | None = None, timeout: float = 3.0) -> list[dict]:
    """Execute guarded, read-only Cypher. Raises UnsafeCypher or a driver error (message is the real one)."""
    from neo4j import READ_ACCESS, Query
    q = guard(query)
    try:
        with driver().session(default_access_mode=READ_ACCESS) as s:
            res = s.run(Query(q, timeout=timeout), parameters=params or {})
            return [{k: to_json(v) for k, v in r.items()} for r in res]
    except Exception as e:
        from neo4j.exceptions import ServiceUnavailable
        if isinstance(e, (ServiceUnavailable, OSError)):
            raise GraphUnavailable(str(e)) from e
        raise


def run_write(query: str, params: dict | None = None) -> list[dict]:
    """Internal writes only (Decision nodes, demo reset). Never reachable from model text."""
    try:
        with driver().session() as s:
            return [{k: to_json(v) for k, v in r.items()} for r in s.run(query, parameters=params or {})]
    except Exception as e:
        from neo4j.exceptions import ServiceUnavailable
        if isinstance(e, (ServiceUnavailable, OSError)):
            raise GraphUnavailable(str(e)) from e
        raise
