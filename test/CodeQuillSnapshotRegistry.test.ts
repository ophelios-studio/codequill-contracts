import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import {
  asBigInt,
  delegationTypes,
  getEip712Domain,
  getWorkspaceEip712Domain,
  setWorkspaceMemberWithSig,
  setupCodeQuill,
} from "./utils";

describe("CodeQuillSnapshotRegistry", function () {
  let ethers: any;
  let time: any;
  let workspace: any;
  let repository: any;
  let delegation: any;
  let snapshotRegistry: any;
  let deployer: any;
  let repoOwner: any;
  let relayer: any;
  let other: any;
  let domain: any;
  let workspaceDomain: any;

  const contextId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const repoIdLabel = "snapshot-repo";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    deployer = env.deployer;
    workspace = env.workspace;
    repository = env.repository;
    delegation = env.delegation;
    snapshotRegistry = env.snapshot;
    repoOwner = env.alice;
    relayer = env.bob;
    other = env.charlie;

    domain = await getEip712Domain(
      ethers,
      "CodeQuillDelegation",
      "1",
      await delegation.getAddress(),
    );

    workspaceDomain = await getWorkspaceEip712Domain(ethers, workspace);
    await workspace.connect(deployer).initAuthority(contextId, deployer.address);

    const now = asBigInt(await time.latest());
    const membershipDeadline = now + 3600n;
    await setWorkspaceMemberWithSig({
      ethers,
      workspace,
      authoritySigner: deployer,
      relayerSigner: deployer,
      domain: workspaceDomain,
      contextId,
      member: repoOwner.address,
      memberStatus: true,
      deadline: membershipDeadline,
    });

    const repoId = ethers.encodeBytes32String(repoIdLabel);
    await repository
      .connect(repoOwner)
      .claimRepo(repoId, contextId, "meta", repoOwner.address);
  });

  describe("createSnapshot", function () {
    it("allows repo owner to create a snapshot directly", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const commitHash = ethers.id("commit1");
      const merkleRoot = ethers.id("root1");
      const manifestCid = "QmTest123";

      await expect(
        snapshotRegistry
          .connect(repoOwner)
          .createSnapshot(
            repoId,
            contextId,
            commitHash,
            merkleRoot,
            manifestCid,
            repoOwner.address
          ),
      )
        .to.emit(snapshotRegistry, "SnapshotCreated")
        .withArgs(
          repoId,
          0,
          contextId,
          repoOwner.address,
          commitHash,
          merkleRoot,
          manifestCid,
          anyValue
        );

      expect(await snapshotRegistry.getSnapshotsCount(repoId)).to.equal(1);
    });

    it("allows delegated relayer to create a snapshot", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const commitHash = ethers.id("commit1");
      const merkleRoot = ethers.id("root-relayed");
      const manifestCid = "QmRelayed";

      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_SNAPSHOT();
      const nonce = await delegation.nonces(repoOwner.address);
      const value = {
        owner: repoOwner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await repoOwner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);
      await delegation.registerDelegationWithSig(
        repoOwner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline,
        v,
        r,
        s,
      );

      await expect(
        snapshotRegistry
          .connect(relayer)
          .createSnapshot(
            repoId,
            contextId,
            commitHash,
            merkleRoot,
            manifestCid,
            repoOwner.address
          ),
      )
        .to.emit(snapshotRegistry, "SnapshotCreated")
        .withArgs(
          repoId,
          0,
          contextId,
          repoOwner.address,
          commitHash,
          merkleRoot,
          manifestCid,
          anyValue
        );
    });

    it("reverts when caller is not authorized", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      await expect(
        snapshotRegistry
          .connect(other)
          .createSnapshot(
            repoId,
            contextId,
            ethers.id("commit"),
            ethers.id("root"),
            "cid",
            repoOwner.address
          ),
      ).to.be.revertedWith("not authorized");
    });

    it("reverts on duplicate root", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const merkleRoot = ethers.id("dup-root");

      await snapshotRegistry
        .connect(repoOwner)
        .createSnapshot(
          repoId,
          contextId,
          ethers.id("commit"),
          merkleRoot,
          "cid",
          repoOwner.address
        );

      await expect(
        snapshotRegistry
          .connect(repoOwner)
          .createSnapshot(
            repoId,
            contextId,
            ethers.id("commit2"),
            merkleRoot,
            "cid2",
            repoOwner.address
          ),
      ).to.be.revertedWith("duplicate root");
    });

    it("reverts when repo contextId does not match", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const wrongContext =
        "0x2222222222222222222222222222222222222222222222222222222222222222";
      await expect(
        snapshotRegistry
          .connect(repoOwner)
          .createSnapshot(
            repoId,
            wrongContext,
            ethers.id("commit"),
            ethers.id("root"),
            "cid",
            repoOwner.address
          ),
      ).to.be.revertedWith("repo wrong context");
    });
  });

  describe("views", function () {
    it("supports getSnapshot / getSnapshotByRoot and revert paths", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const commitHash = ethers.id("commit-v");
      const merkleRoot = ethers.id("root-v");
      const manifestCid = "cid-v";

      await expect(snapshotRegistry.getSnapshot(repoId, 0)).to.be.revertedWith(
        "invalid index",
      );
      await expect(
        snapshotRegistry.getSnapshotByRoot(repoId, merkleRoot),
      ).to.be.revertedWith("not found");

      await snapshotRegistry
        .connect(repoOwner)
        .createSnapshot(
          repoId,
          contextId,
          commitHash,
          merkleRoot,
          manifestCid,
          repoOwner.address
        );

      const byIndex = await snapshotRegistry.getSnapshot(repoId, 0);
      expect(byIndex.commitHash).to.equal(commitHash);
      expect(byIndex.merkleRoot).to.equal(merkleRoot);
      expect(byIndex.manifestCid).to.equal(manifestCid);
      expect(byIndex.author).to.equal(repoOwner.address);

      const byRoot = await snapshotRegistry.getSnapshotByRoot(repoId, merkleRoot);
      expect(byRoot.commitHash).to.equal(commitHash);
      expect(byRoot.manifestCid).to.equal(manifestCid);
      expect(byRoot.author).to.equal(repoOwner.address);
      expect(byRoot.index).to.equal(0);
    });
  });
});
