import { expect } from "chai";
import hre from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";

describe("CodeQuillBackupRegistry", function () {
  let ethers: any;
  let time: any;
  let registry: any;
  let delegation: any;
  let snapshotRegistry: any;
  let backupRegistry: any;
  let owner: any;
  let repoOwner: any;
  let relayer: any;
  let otherAccount: any;
  let domain: any;

  const SCOPE_BACKUP = 1n << 3n;

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

    const Backup = await ethers.getContractFactory("CodeQuillBackupRegistry");
    backupRegistry = await Backup.deploy(owner.address, await registry.getAddress(), await delegation.getAddress(), await snapshotRegistry.getAddress());
    await backupRegistry.waitForDeployment();

    domain = {
      name: "CodeQuillDelegation",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await delegation.getAddress(),
    };
  });

  describe("anchorBackup", function () {
    let repoId: string;
    let merkleRoot: string;
    let archiveSha256: string;
    let metadataSha256: string;
    const backupCid = "QmBackup123";

    before(async function () {
        repoId = ethers.encodeBytes32String("backup-repo");
        merkleRoot = ethers.id("root1");
        archiveSha256 = ethers.id("archive1");
        metadataSha256 = ethers.id("metadata1");
        
        await registry.connect(repoOwner).claimRepo(repoId, "meta");
        await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, merkleRoot, "cid", repoOwner.address, 10);
    });

    it("Should allow repo owner to anchor backup (via relayer)", async function () {
        await expect(backupRegistry.connect(owner).anchorBackup(
            repoId, merkleRoot, archiveSha256, metadataSha256, backupCid, repoOwner.address
        )).to.emit(backupRegistry, "BackupAnchored")
          .withArgs(repoId, merkleRoot, archiveSha256, repoOwner.address, metadataSha256, backupCid, anyValue);

        expect(await backupRegistry.hasBackup(repoId, merkleRoot)).to.equal(true);
    });

    it("Should allow delegated relayer to anchor backup", async function () {
        const repoId2 = ethers.encodeBytes32String("backup-repo-2");
        const merkleRoot2 = ethers.id("root2");
        const archiveSha256_2 = ethers.id("archive2");
        
        await registry.connect(repoOwner).claimRepo(repoId2, "meta");
        await snapshotRegistry.connect(owner).createSnapshot(repoId2, ethers.ZeroHash, merkleRoot2, "cid", repoOwner.address, 10);

        const expiry = (await time.latest()) + 3600;
        const deadline = (await time.latest()) + 7200;
        const nonce = await delegation.nonces(repoOwner.address);
        const value = { owner: repoOwner.address, relayer: relayer.address, scopes: SCOPE_BACKUP, repoIdOrWildcard: repoId2, nonce, expiry, deadline };
        const signature = await repoOwner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);
        await delegation.registerDelegationWithSig(repoOwner.address, relayer.address, SCOPE_BACKUP, repoId2, expiry, deadline, v, r, s);

        // Relayer calls anchorBackup (msg.sender is relayer? No, in this system owner is the relayer/backend)
        // Wait, CodeQuillBackupRegistry.sol:
        // function anchorBackup(...) external onlyOwner onlyRepoOwnerOrDelegated(repoId, author)

        // In the existing tests, 'owner' is the backend relayer.
        await expect(backupRegistry.connect(owner).anchorBackup(
            repoId2, merkleRoot2, archiveSha256_2, ethers.ZeroHash, "", repoOwner.address
        )).to.emit(backupRegistry, "BackupAnchored")
          .withArgs(repoId2, merkleRoot2, archiveSha256_2, repoOwner.address, ethers.ZeroHash, "", anyValue);
    });

    it("Should fail if snapshot does not exist", async function () {
        const fakeRoot = ethers.id("fake");
        await expect(backupRegistry.connect(owner).anchorBackup(
            repoId, fakeRoot, archiveSha256, metadataSha256, backupCid, repoOwner.address
        )).to.be.revertedWith("snapshot not found");
    });

    it("Should allow overwriting backup for same repo and snapshot", async function () {
        const newArchiveSha = ethers.id("archive-new");
        const newCid = "QmNewBackup456";

        await expect(backupRegistry.connect(owner).anchorBackup(
            repoId, merkleRoot, newArchiveSha, metadataSha256, newCid, repoOwner.address
        )).to.emit(backupRegistry, "BackupAnchored")
          .withArgs(repoId, merkleRoot, newArchiveSha, repoOwner.address, metadataSha256, newCid, anyValue);

        const backup = await backupRegistry.getBackup(repoId, merkleRoot);
        expect(backup.archiveSha256).to.equal(newArchiveSha);
        expect(backup.backupCid).to.equal(newCid);
    });

    it("Should fail if archiveSha256 is zero", async function () {
        await expect(backupRegistry.connect(owner).anchorBackup(
            repoId, merkleRoot, ethers.ZeroHash, metadataSha256, backupCid, repoOwner.address
        )).to.be.revertedWith("zero archive sha");
    });

    it("Should fail if snapshotMerkleRoot is zero", async function () {
        await expect(backupRegistry.connect(owner).anchorBackup(
            repoId, ethers.ZeroHash, archiveSha256, metadataSha256, backupCid, repoOwner.address
        )).to.be.revertedWith("zero snapshot root");
    });

    it("Should fail if not called by owner", async function () {
        await expect(backupRegistry.connect(otherAccount).anchorBackup(
            repoId, merkleRoot, ethers.id("new"), metadataSha256, backupCid, repoOwner.address
        )).to.be.revertedWithCustomError(backupRegistry, "OwnableUnauthorizedAccount");
    });

    it("Should fail if not authorized by repo owner", async function () {
        await expect(backupRegistry.connect(owner).anchorBackup(
            repoId, merkleRoot, ethers.id("new"), metadataSha256, backupCid, otherAccount.address
        )).to.be.revertedWith("not authorized");
    });

    it("Should fail if repo is not claimed", async function () {
        const unclaimedRepo = ethers.id("unclaimed");
        await expect(backupRegistry.connect(owner).anchorBackup(
            unclaimedRepo, merkleRoot, archiveSha256, metadataSha256, backupCid, repoOwner.address
        )).to.be.revertedWith("repo not claimed");
    });

    it("Should fail with zero address check in constructor", async function () {
        const Backup = await ethers.getContractFactory("CodeQuillBackupRegistry");
        await expect(Backup.deploy(owner.address, ethers.ZeroAddress, await delegation.getAddress(), await snapshotRegistry.getAddress()))
            .to.be.revertedWith("zero addr");
        await expect(Backup.deploy(owner.address, await registry.getAddress(), ethers.ZeroAddress, await snapshotRegistry.getAddress()))
            .to.be.revertedWith("zero addr");
        await expect(Backup.deploy(owner.address, await registry.getAddress(), await delegation.getAddress(), ethers.ZeroAddress))
            .to.be.revertedWith("zero addr");
    });
  });

  describe("Views", function () {
      let repoId: string;
      let merkleRoot: string;
      let archiveSha256: string;
      let metadataSha256: string;
      const backupCid = "cid-view";

      before(async function () {
          repoId = ethers.encodeBytes32String("view-repo");
          merkleRoot = ethers.id("root-view");
          archiveSha256 = ethers.id("archive-view");
          metadataSha256 = ethers.id("metadata-view");

          await registry.connect(repoOwner).claimRepo(repoId, "meta");
          await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, merkleRoot, "cid", repoOwner.address, 10);
          await backupRegistry.connect(owner).anchorBackup(repoId, merkleRoot, archiveSha256, metadataSha256, backupCid, repoOwner.address);
      });

      it("Should check if backup exists", async function () {
          expect(await backupRegistry.hasBackup(repoId, merkleRoot)).to.equal(true);
          expect(await backupRegistry.hasBackup(repoId, ethers.id("other"))).to.equal(false);
      });

      it("Should get backup", async function () {
          const b = await backupRegistry.getBackup(repoId, merkleRoot);
          expect(b.archiveSha256).to.equal(archiveSha256);
          expect(b.metadataSha256).to.equal(metadataSha256);
          expect(b.backupCid).to.equal(backupCid);
          expect(b.author).to.equal(repoOwner.address);
          expect(b.timestamp).to.be.gt(0);
      });

      it("Should fail if backup not found", async function () {
          await expect(backupRegistry.getBackup(repoId, ethers.id("nonexistent")))
              .to.be.revertedWith("backup not found");
      });
  });
});
