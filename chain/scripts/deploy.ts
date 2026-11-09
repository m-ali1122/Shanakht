import { artifacts, ethers } from "hardhat";
import fs from "node:fs";
import path from "node:path";

async function main() {
  const signers = await ethers.getSigners();
  const graph = await (await ethers.getContractFactory("GraphRootLog")).deploy(signers[0].address);
  await graph.waitForDeployment();
  const mule = await (await ethers.getContractFactory("MuleRegistry")).deploy(signers[0].address, signers.slice(1, 5).map(s => s.address), [1, 2, 3, 4]);
  await mule.waitForDeployment();
  const decision = await (await ethers.getContractFactory("DecisionLog")).deploy(await graph.getAddress());
  await decision.waitForDeployment();
  const result: Record<string, unknown> = {};
  for (const [name, contract] of [["GraphRootLog", graph], ["DecisionLog", decision], ["MuleRegistry", mule]] as const) {
    const abi = (await artifacts.readArtifact(name)).abi;
    result[name] = { address: await contract.getAddress(), abi };
  }
  const out = path.join(process.cwd(), "deployments", "localhost.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
