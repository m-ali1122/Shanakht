"""Sorted-pair Merkle tree, compatible with OpenZeppelin MerkleProof.verify.

Leaves: SHA-256 over the canonical JSON of an element (see leaves.py).
Internal nodes: keccak256(sort(a, b)) by default — exactly what OZ's
MerkleProof.verify / processProof computes, so GraphRootLog.verifyLeaf can
check our proofs on-chain. Set MERKLE_NODE_HASH=sha256 for a pure SHA-256 tree
(then on-chain verification needs OZ's custom-hasher overload).
An odd node at any level is promoted unchanged (proof simply skips that level).
"""
from __future__ import annotations

import hashlib
import os


def _keccak():
    try:  # pycryptodome is the fastest pure call path here
        from Crypto.Hash import keccak as _k
        new = _k.new

        def keccak(b: bytes) -> bytes:
            return new(digest_bits=256, data=b).digest()
        return keccak
    except Exception:
        pass
    try:
        from eth_hash.auto import keccak
        return keccak
    except Exception:
        return None


_KECCAK = _keccak()
NODE_HASH = os.getenv("MERKLE_NODE_HASH", "keccak" if _KECCAK else "sha256")


def _sha(b: bytes) -> bytes:
    return hashlib.sha256(b).digest()


_h = _KECCAK if NODE_HASH == "keccak" else _sha


def hash_pair(a: bytes, b: bytes) -> bytes:
    return _h(a + b) if a < b else _h(b + a)


def _b(x) -> bytes:
    if isinstance(x, bytes):
        return x
    return bytes.fromhex(x[2:] if x.startswith("0x") else x)


def _x(b: bytes) -> str:
    return "0x" + b.hex()


class MerkleTree:
    def __init__(self, leaves: list):
        """`leaves` in a fixed order (callers sort by element id)."""
        self.leaves = [l if isinstance(l, bytes) else bytes.fromhex(l[2:] if l.startswith("0x") else l)
                       for l in leaves]
        self.layers = [self.leaves]
        cur = self.leaves
        h = _h
        while len(cur) > 1:
            nxt = [h(a + b) if a < b else h(b + a) for a, b in zip(cur[0::2], cur[1::2])]
            if len(cur) % 2:
                nxt.append(cur[-1])
            self.layers.append(nxt)
            cur = nxt

    @property
    def root(self) -> str:
        if not self.leaves:
            return "0x" + "00" * 32
        return _x(self.layers[-1][0])

    def proof(self, index: int) -> list[str]:
        out = []
        for layer in self.layers[:-1]:
            sib = index ^ 1
            if sib < len(layer):
                out.append(_x(layer[sib]))
            index //= 2
        return out


def verify(proof: list, root, leaf) -> bool:
    cur = _b(leaf)
    for p in proof:
        cur = hash_pair(cur, _b(p))
    return cur == _b(root)
