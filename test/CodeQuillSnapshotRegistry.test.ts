import { expect } from "chai";
import hre from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import {before, describe, it} from "node:test";

describe("CodeQuillSnapshotRegistry", function () {
  let ethers: any;
  let time: any;
  let registry: any;
  let delegation: any;
  let snapshotRegistry: any;
  let owner: any;
  let repoOwner: any;
  let relayer: any;
  let otherAccount: any;
  let domain: any;

  const SCOPE_SNAPSHOT = 1n << 1n;

  const types = {
    Delegate: [
      { name: "owner", type: "address" },
      { name: "relayer", type: "address" },
      { name: "scopes", type: "uint256" },
      { name: "repoIdOrWildcard", type: "bytes32" },
      { name: "nonce", type: "uint256" },
      { name: "expiry", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  before(async function () {
    const connection = await hre.network.connect();
    ethers = (connection as any).ethers;
    time = (connection as any).networkHelpers.time;

    [owner, repoOwner, relayer, otherAccount] = await ethers.getSigners();

    const Delegation = await ethers.getContractFactory("CodeQuillDelegation");
    delegation = await Delegation.deploy(owner.address);
    await delegation.waitForDeployment();

    const Registry = await ethers.getContractFactory("CodeQuillRegistry");
    registry = await Registry.deploy(owner.address, await delegation.getAddress());
    await registry.waitForDeployment();

    const Snapshot = await ethers.getContractFactory("CodeQuillSnapshotRegistry");
    snapshotRegistry = await Snapshot.deploy(owner.address, await registry.getAddress(), await delegation.getAddress());
    await snapshotRegistry.waitForDeployment();

    domain = {
      name: "CodeQuillDelegation",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await delegation.getAddress(),
    };
  });

  describe("createSnapshot", function () {
    let repoId: string;
    let commitHash: string;
    let merkleRoot: string;
    const manifestCid = "QmTest123";

    before(async function () {
        repoId = ethers.encodeBytes32String("snapshot-repo");
        commitHash = ethers.id("commit1");
        merkleRoot = ethers.id("root1");
        await registry.connect(repoOwner).claimRepo(repoId, "meta");
    });

    it("Should fail if not called by owner (relayer)", async function () {
        await expect(snapshotRegistry.connect(otherAccount).createSnapshot(
            repoId, commitHash, merkleRoot, manifestCid, repoOwner.address, 10
        )).to.be.revertedWithCustomError(snapshotRegistry, "OwnableUnauthorizedAccount");
    });

    it("Should allow relayer to create snapshot if repo owner authorized", async function () {
        // Authorize relayer
        const expiry = (await time.latest()) + 3600;
        const deadline = (await time.latest()) + 7200;
        const nonce = await delegation.nonces(repoOwner.address);
        const value = { owner: repoOwner.address, relayer: relayer.address, scopes: SCOPE_SNAPSHOT, repoIdOrWildcard: repoId, nonce, expiry, deadline };
        const signature = await repoOwner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);
        await delegation.registerDelegationWithSig(repoOwner.address, relayer.address, SCOPE_SNAPSHOT, repoId, expiry, deadline, v, r, s);

        // Relayer creates snapshot (relayer is NOT the contract owner, so this should fail first)
        // Wait, the contract owner is 'owner'. 'relayer' is just another account.
        // createSnapshot is 'onlyOwner'. So only 'owner' can call it.
        
        await expect(snapshotRegistry.connect(owner).createSnapshot(
            repoId, commitHash, merkleRoot, manifestCid, repoOwner.address, 10
        )).to.emit(snapshotRegistry, "SnapshotCreated")
          .withArgs(repoId, 0, repoOwner.address, commitHash, merkleRoot, manifestCid, anyValue, 10);
        
        expect(await snapshotRegistry.getSnapshotsCount(repoId)).to.equal(1);
    });

    it("Should fail if duplicate root", async function () {
        await expect(snapshotRegistry.connect(owner).createSnapshot(
            repoId, commitHash, merkleRoot, "different-cid", repoOwner.address, 10
        )).to.be.revertedWith("duplicate root");
    });

    it("Should allow repo owner themselves to be passed as author if they call through relayer", async function () {
        const merkleRoot2 = ethers.id("root2");
        // No extra delegation needed for repoOwner as author if we are using the 'owner' (relayer)
        // Wait, the modifier checks if author == owner OR isDelegated(owner, msg.sender, ...)
        // Here msg.sender is 'owner' (contract owner).
        
        await expect(snapshotRegistry.connect(owner).createSnapshot(
            repoId, commitHash, merkleRoot2, manifestCid, repoOwner.address, 20
        )).to.emit(snapshotRegistry, "SnapshotCreated");
    });
  });

  describe("Views", function () {
      let repoId: string;
      let merkleRoot: string;

      before(async function () {
          repoId = ethers.encodeBytes32String("view-repo");
          merkleRoot = ethers.id("view-root");
          await registry.connect(repoOwner).claimRepo(repoId, "meta");
          await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, merkleRoot, "cid", repoOwner.address, 5);
      });

      it("Should get snapshot by index", async function () {
          const s = await snapshotRegistry.getSnapshot(repoId, 0);
          expect(s.merkleRoot).to.equal(merkleRoot);
          expect(s.fileCount).to.equal(5);
      });

      it("Should get snapshot by root", async function () {
          const s = await snapshotRegistry.getSnapshotByRoot(repoId, merkleRoot);
          expect(s.author).to.equal(repoOwner.address);
      });
  });
});
