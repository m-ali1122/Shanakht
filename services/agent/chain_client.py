"""Thin web3.py client for GraphRootLog, DecisionLog and MuleRegistry.

Reads addresses/ABIs from chain/deployments/localhost.json. Every method raises
ChainUnavailable if the node or deployment file is missing, so callers can
degrade gracefully (the integrity service falls back to a local root store).
"""
from __future__ import annotations

import json

import config


class ChainUnavailable(RuntimeError):
    pass


def _b32(x) -> bytes:
    if isinstance(x, bytes):
        return x.rjust(32, b"\0")
    s = x[2:] if x.startswith("0x") else x
    return bytes.fromhex(s.rjust(64, "0"))


def _hex(b) -> str:
    return "0x" + bytes(b).hex()


class ChainClient:
    def __init__(self, rpc: str = config.CHAIN_RPC, deployments=config.DEPLOYMENTS_FILE):
        self.rpc = rpc
        self.deployments = deployments
        self._w3 = None
        self._c = {}

    # ------------------------------------------------------------ plumbing
    def _connect(self):
        if self._w3 is not None:
            return
        try:
            from web3 import Web3
        except ImportError as e:
            raise ChainUnavailable(f"web3 not installed: {e}")
        if not self.deployments.exists():
            raise ChainUnavailable(f"no deployment file at {self.deployments}")
        w3 = Web3(Web3.HTTPProvider(self.rpc, request_kwargs={"timeout": 5}))
        try:
            ok = w3.is_connected()
        except Exception:
            ok = False
        if not ok:
            raise ChainUnavailable(f"chain node not reachable at {self.rpc}")
        dep = json.loads(self.deployments.read_text(encoding="utf-8"))
        for name in ("GraphRootLog", "DecisionLog", "MuleRegistry"):
            if name in dep:
                self._c[name] = w3.eth.contract(address=dep[name]["address"], abi=dep[name]["abi"])
        self._w3 = w3

    def reset_connection(self):
        """Call after a redeploy so addresses are re-read."""
        self._w3, self._c = None, {}

    def available(self) -> bool:
        try:
            self._connect()
            return True
        except ChainUnavailable:
            return False

    def _account(self, index: int = 0):
        return self._w3.eth.accounts[index]

    def _send(self, fn, sender_index: int = 0) -> dict:
        tx = fn.transact({"from": self._account(sender_index)})
        rcpt = self._w3.eth.wait_for_transaction_receipt(tx, timeout=20)
        if rcpt.status != 1:
            raise RuntimeError(f"transaction reverted: {tx.hex()}")
        return {"tx": "0x" + tx.hex().removeprefix("0x"), "block": rcpt.blockNumber}

    def _contract(self, name):
        self._connect()
        if name not in self._c:
            raise ChainUnavailable(f"{name} not in deployment file")
        return self._c[name]

    # ------------------------------------------------------------ GraphRootLog
    def commit_root(self, epoch: int, root: str, node_count: int, edge_count: int) -> dict:
        c = self._contract("GraphRootLog")
        return self._send(c.functions.commit(epoch, _b32(root), node_count, edge_count))

    def latest_root(self) -> tuple[int, str]:
        epoch, root = self._contract("GraphRootLog").functions.latest().call()
        return int(epoch), _hex(root)

    def root_of(self, epoch: int) -> str:
        return _hex(self._contract("GraphRootLog").functions.rootOf(epoch).call())

    def verify_leaf(self, epoch: int, leaf: str, proof: list[str]) -> bool:
        return bool(self._contract("GraphRootLog").functions.verifyLeaf(
            epoch, _b32(leaf), [_b32(p) for p in proof]).call())

    # ------------------------------------------------------------ DecisionLog
    def anchor(self, decision_hash: str, model_version: str, graph_root: str, epoch: int,
               band: int, action: int, approver_hash: str) -> dict:
        c = self._contract("DecisionLog")
        fn = c.functions.anchor(_b32(decision_hash), _b32(model_version), _b32(graph_root),
                                epoch, band, action, _b32(approver_hash))
        decision_id = fn.call({"from": self._account(0)})
        out = self._send(fn)
        out["id"] = int(decision_id)
        return out

    # ------------------------------------------------------------ MuleRegistry
    def publish(self, fp: str, kind: int, bank_id: int) -> dict:
        c = self._contract("MuleRegistry")
        return self._send(c.functions.publish(_b32(fp), kind, bank_id))

    def is_flagged(self, fp: str) -> dict:
        flagged, bank, ts = self._contract("MuleRegistry").functions.isFlagged(_b32(fp)).call()
        return {"flagged": bool(flagged), "publisher_bank": int(bank), "ts": int(ts)}

    # ------------------------------------------------------------ demo reset
    def snapshot(self) -> str:
        self._connect()
        return self._w3.provider.make_request("evm_snapshot", [])["result"]

    def revert(self, snap_id: str) -> bool:
        self._connect()
        return bool(self._w3.provider.make_request("evm_revert", [snap_id])["result"])


_client: ChainClient | None = None


def get_chain() -> ChainClient:
    global _client
    if _client is None:
        _client = ChainClient()
    return _client
