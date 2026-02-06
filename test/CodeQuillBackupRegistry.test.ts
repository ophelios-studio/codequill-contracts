import { expect } from "chai";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";
import {
  asBigInt,
  delegationTypes,
  getEip712Domain,
  setupCodeQuill,
} from "./utils";

describe("CodeQuillBackupRegistry", function () {
  let ethers: any;
  let time: any;
  let workspace: any;
  let repository: any;
  let delegation: any;
  let snapshotRegistry: any;
  let backupRegistry: any;
  let repoOwner: any;
  let relayer: any;
  let other: any;
  let domain: any;

  const contextId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const repoIdLabel = "backup-repo";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    workspace = env.workspace;
    repository = env.repository;
    delegation = env.delegation;
    snapshotRegistry = env.snapshot;
    backupRegistry = env.backup;
    repoOwner = env.alice;
    relayer = env.bob;
    other = env.charlie;

    domain = await getEip712Domain(
      ethers,
      "CodeQuillDelegation",
      "3",
      await delegation.getAddress(),
    );

    await workspace.connect(repoOwner).join(contextId);

    const repoId = ethers.encodeBytes32String(repoIdLabel);
    await repository
      .connect(repoOwner)
      .claimRepo(repoId, contextId, "meta", repoOwner.address);

    await snapshotRegistry
      .connect(repoOwner)
      .createSnapshot(
        repoId,
        contextId,
        ethers.id("commit"),
        ethers.id("root"),
        "cid",
        repoOwner.address,
        10,
      );
  });

  describe("anchorBackup", function () {
    it("allows repo owner to anchor a backup directly", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const merkleRoot = ethers.id("root");
      const archiveSha256 = ethers.id("archive1");
      const metadataSha256 = ethers.id("metadata1");
      const backupCid = "QmBackup123";

      await expect(
        backupRegistry
          .connect(repoOwner)
          .anchorBackup(
            repoId,
            contextId,
            merkleRoot,
            archiveSha256,
            metadataSha256,
            backupCid,
            repoOwner.address,
          ),
      )
        .to.emit(backupRegistry, "BackupAnchored")
        .withArgs(
          repoId,
          merkleRoot,
          archiveSha256,
          contextId,
          repoOwner.address,
          metadataSha256,
          backupCid,
          anyValue,
        );

      expect(await backupRegistry.hasBackup(repoId, merkleRoot)).to.equal(true);
    });

    it("allows delegated relayer to anchor a backup", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const merkleRoot = ethers.id("root");
      const archiveSha256 = ethers.id("archive-relayed");
      const metadataSha256 = ethers.ZeroHash;
      const backupCid = "";

      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_BACKUP();
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
        backupRegistry
          .connect(relayer)
          .anchorBackup(
            repoId,
            contextId,
            merkleRoot,
            archiveSha256,
            metadataSha256,
            backupCid,
            repoOwner.address,
          ),
      )
        .to.emit(backupRegistry, "BackupAnchored")
        .withArgs(
          repoId,
          merkleRoot,
          archiveSha256,
          contextId,
          repoOwner.address,
          metadataSha256,
          backupCid,
          anyValue,
        );
    });

    it("reverts if snapshot does not exist", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const fakeRoot = ethers.id("fake");
      await expect(
        backupRegistry
          .connect(repoOwner)
          .anchorBackup(
            repoId,
            contextId,
            fakeRoot,
            ethers.id("archive"),
            ethers.id("metadata"),
            "cid",
            repoOwner.address,
          ),
      ).to.be.revertedWith("snapshot not found");
    });

    it("allows overwriting backup for the same repo and snapshot", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const merkleRoot = ethers.id("root");

      await backupRegistry
        .connect(repoOwner)
        .anchorBackup(
          repoId,
          contextId,
          merkleRoot,
          ethers.id("archive-old"),
          ethers.id("metadata"),
          "cid-old",
          repoOwner.address,
        );

      const newArchiveSha = ethers.id("archive-new");
      const newCid = "QmNewBackup456";
      await backupRegistry
        .connect(repoOwner)
        .anchorBackup(
          repoId,
          contextId,
          merkleRoot,
          newArchiveSha,
          ethers.id("metadata"),
          newCid,
          repoOwner.address,
        );

      const b = await backupRegistry.getBackup(repoId, merkleRoot);
      expect(b.archiveSha256).to.equal(newArchiveSha);
      expect(b.backupCid).to.equal(newCid);
    });

    it("reverts if caller is not authorized", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      await expect(
        backupRegistry
          .connect(other)
          .anchorBackup(
            repoId,
            contextId,
            ethers.id("root"),
            ethers.id("archive"),
            ethers.ZeroHash,
            "",
            repoOwner.address,
          ),
      ).to.be.revertedWith("not authorized");
    });

    it("reverts when repo is not claimed", async function () {
      const unclaimedRepo = ethers.id("unclaimed");
      await expect(
        backupRegistry
          .connect(repoOwner)
          .anchorBackup(
            unclaimedRepo,
            contextId,
            ethers.id("root"),
            ethers.id("archive"),
            ethers.ZeroHash,
            "",
            repoOwner.address,
          ),
      ).to.be.revertedWith("repo not claimed");
    });
  });

  describe("views", function () {
    it("hasBackup / getBackup return expected values and revert when missing", async function () {
      const repoId = ethers.encodeBytes32String(repoIdLabel);
      const merkleRoot = ethers.id("root");
      const archiveSha256 = ethers.id("archive-view");
      const metadataSha256 = ethers.id("metadata-view");
      const backupCid = "cid-view";

      await backupRegistry
        .connect(repoOwner)
        .anchorBackup(
          repoId,
          contextId,
          merkleRoot,
          archiveSha256,
          metadataSha256,
          backupCid,
          repoOwner.address,
        );

      expect(await backupRegistry.hasBackup(repoId, merkleRoot)).to.equal(true);
      expect(await backupRegistry.hasBackup(repoId, ethers.id("other"))).to.equal(false);

      const b = await backupRegistry.getBackup(repoId, merkleRoot);
      expect(b.archiveSha256).to.equal(archiveSha256);
      expect(b.metadataSha256).to.equal(metadataSha256);
      expect(b.backupCid).to.equal(backupCid);
      expect(b.author).to.equal(repoOwner.address);
      expect(b.timestamp).to.be.gt(0);

      await expect(backupRegistry.getBackup(repoId, ethers.id("missing"))).to.be.revertedWith(
        "backup not found",
      );
    });
  });
});
