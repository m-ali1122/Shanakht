import express from "express";
import cors from "cors";
import { ethers } from "ethers";
import fs from "node:fs";

const deployment = JSON.parse(fs.readFileSync("deployments/localhost.json", "utf8"));
const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const contracts = [
  { type: "Committed", contract: new ethers.Contract(deployment.GraphRootLog.address, deployment.GraphRootLog.abi, provider) },
  { type: "Anchored", contract: new ethers.Contract(deployment.DecisionLog.address, deployment.DecisionLog.abi, provider) },
  { type: "Published", contract: new ethers.Contract(deployment.MuleRegistry.address, deployment.MuleRegistry.abi, provider) }
];

const app = express();
app.use(cors());
app.get("/blocks", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 20), 1), 200);
    const latest = await provider.getBlockNumber();
    const rows: any[] = [];
    for (const item of contracts) {
      const logs = await item.contract.queryFilter(item.contract.filters[item.type](), 0, latest);
      for (const log of logs) {
        const block = await log.getBlock();
        rows.push({ type: item.type, blockNumber: log.blockNumber, txHash: log.transactionHash, args: log.args, timestamp: block?.timestamp ?? 0 });
      }
    }
    rows.sort((a, b) => b.blockNumber - a.blockNumber || b.timestamp - a.timestamp);
    res.type("json").send(JSON.stringify(rows.slice(0, limit), (_k, v) => typeof v === "bigint" ? v.toString() : v));
  } catch (error) { res.status(500).json({ error: String(error) }); }
});
app.listen(8104, () => console.log("chain explorer listening on http://127.0.0.1:8104"));
