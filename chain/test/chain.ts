import { expect } from "chai";
import { ethers } from "hardhat";
import { keccak256, solidityPacked } from "ethers";

describe("Shanakht chain", function () {
  async function fixture() {
    const signers = await ethers.getSigners();
    const graph = await (await ethers.getContractFactory("GraphRootLog")).deploy(signers[0].address);
    await graph.waitForDeployment();
    const mule = await (await ethers.getContractFactory("MuleRegistry")).deploy(signers[0].address, signers.slice(1, 5).map(s => s.address), [1, 2, 3, 4]);
    await mule.waitForDeployment();
    const decision = await (await ethers.getContractFactory("DecisionLog")).deploy(await graph.getAddress());
    await decision.waitForDeployment();
    return { signers, graph, mule, decision };
  }

  it("publishes, revokes, and reports flags", async function () {
    const { signers, mule } = await fixture();
    const fp = keccak256(ethers.toUtf8Bytes("phone"));
    await mule.connect(signers[1]).publish(fp, 1, 1);
    const flagged = await mule.isFlagged(fp);
    expect(flagged[0]).to.equal(true);
    expect(flagged[1]).to.equal(1n);
    await mule.connect(signers[1]).revoke(fp);
    expect((await mule.isFlagged(fp))[0]).to.equal(false);
  });

  it("allows the operator to publish for a bank", async function () {
    const { mule } = await fixture();
    await mule.publish(ethers.ZeroHash, 3, 4);
    expect((await mule.isFlagged(ethers.ZeroHash))[1]).to.equal(3n);
  });

  it("anchors decisions only against the committed root", async function () {
    const { graph, decision } = await fixture();
    const root = keccak256(ethers.toUtf8Bytes("root"));
    await graph.commit(7, root, 2, 1);
    await expect(decision.anchor(ethers.ZeroHash, ethers.ZeroHash, ethers.ZeroHash, 7, 1, 0, ethers.ZeroHash)).to.be.revertedWith("DecisionLog: root mismatch");
    await decision.anchor(ethers.ZeroHash, ethers.ZeroHash, root, 7, 1, 0, ethers.ZeroHash);
    const saved = await decision.get(0);
    expect(saved.graphRoot).to.equal(root);
  });

  it("commits an increasing epoch and verifies a sorted-pair four-leaf tree", async function () {
    const { graph } = await fixture();
    const leaves = ["a", "b", "c", "d"].map(x => keccak256(ethers.toUtf8Bytes(x)));
    const pair = (a: string, b: string) => keccak256(solidityPacked(["bytes32", "bytes32"], a.toLowerCase() < b.toLowerCase() ? [a, b] : [b, a]));
    const p0 = pair(leaves[0], leaves[1]); const p1 = pair(leaves[2], leaves[3]); const root = pair(p0, p1);
    await graph.commit(1, root, 4, 3);
    expect(await graph.verifyLeaf(1, leaves[0], [leaves[1], p1])).to.equal(true);
    expect(await graph.verifyLeaf(1, leaves[0], [leaves[2], p1])).to.equal(false);
    await expect(graph.commit(1, root, 4, 3)).to.be.revertedWith("GraphRootLog: epoch not increasing");
  });
});
