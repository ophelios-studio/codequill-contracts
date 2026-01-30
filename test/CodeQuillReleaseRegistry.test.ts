import { expect } from "chai";
import hre from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";

describe("CodeQuillReleaseRegistry", function () {
  let ethers: any;
  let time: any;
  let registry: any;
  let delegation: any;
  let snapshotRegistry: any;
  let releaseRegistry: any;
  let owner: any;
  let author: any;
  let repo2Owner: any;
  let relayer: any;
  let otherAccount: any;
  let domain: any;

  const SCOPE_RELEASE = 1n << 4n;
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

    [owner, author, repo2Owner, relayer, otherAccount] = await ethers.getSigners();

    const Delegation = await ethers.getContractFactory("CodeQuillDelegation");
    delegation = await Delegation.deploy(owner.address);
    await delegation.waitForDeployment();

    const Registry = await ethers.getContractFactory("CodeQuillRegistry");
    registry = await Registry.deploy(owner.address, await delegation.getAddress());
    await registry.waitForDeployment();

    const Snapshot = await ethers.getContractFactory("CodeQuillSnapshotRegistry");
    snapshotRegistry = await Snapshot.deploy(owner.address, await registry.getAddress(), await delegation.getAddress());
    await snapshotRegistry.waitForDeployment();

    const ReleaseRegistry = await ethers.getContractFactory("CodeQuillReleaseRegistry");
    releaseRegistry = await ReleaseRegistry.deploy(
        owner.address, 
        await registry.getAddress(), 
        await delegation.getAddress(),
        await snapshotRegistry.getAddress()
    );
    await releaseRegistry.waitForDeployment();

    domain = {
      name: "CodeQuillDelegation",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await delegation.getAddress(),
    };
  });

  async function delegate(granter: any, grantee: any, scope: bigint, repoId: string) {
    const expiry = (await time.latest()) + 3600;
    const deadline = (await time.latest()) + 7200;
    const nonce = await delegation.nonces(granter.address);
    const value = { owner: granter.address, relayer: grantee.address, scopes: scope, repoIdOrWildcard: repoId, nonce, expiry, deadline };
    const signature = await granter.signTypedData(domain, types, value);
    const { v, r, s } = ethers.Signature.from(signature);
    await delegation.registerDelegationWithSig(granter.address, grantee.address, scope, repoId, expiry, deadline, v, r, s);
  }

  describe("anchorRelease", function () {
    let projectId: string;
    let repo1Id: string;
    let repo2Id: string;
    let root1: string;
    let root2: string;
    const manifestCid = "QmRelease123";
    const name = "v1.0.0";

    before(async function () {
      projectId = ethers.id("project1");
      repo1Id = ethers.id("repo1");
      repo2Id = ethers.id("repo2");
      root1 = ethers.id("root1");
      root2 = ethers.id("root2");

      // Setup repos and snapshots
      await registry.connect(author).claimRepo(repo1Id, "repo1");
      await registry.connect(repo2Owner).claimRepo(repo2Id, "repo2");

      await snapshotRegistry.connect(owner).createSnapshot(repo1Id, ethers.ZeroHash, root1, "cid1", author.address, 10);
      await snapshotRegistry.connect(owner).createSnapshot(repo2Id, ethers.ZeroHash, root2, "cid2", repo2Owner.address, 20);
    });

    it("Should succeed if relayer (owner) anchors release even if not authorized by author", async function () {
      const releaseId = ethers.id("success-no-relayer-auth");
      // No delegation from author to owner needed anymore
      await expect(releaseRegistry.connect(owner).anchorRelease(projectId, releaseId, manifestCid, name, author.address, [repo1Id], [root1]))
        .to.emit(releaseRegistry, "ReleaseAnchored");
    });

    it("Should fail if author not authorized for one of the repos", async function () {
      const releaseId = ethers.id("fail2");

      // author owns repo1, but not repo2 and no delegation yet for repo2
      await expect(releaseRegistry.connect(owner).anchorRelease(projectId, releaseId, manifestCid, name, author.address, [repo1Id, repo2Id], [root1, root2]))
        .to.be.revertedWith("author not authorized for repo");
    });

    it("Should succeed if author owns one and is delegated for another", async function () {
      const releaseId = ethers.id("success1");
      await delegate(repo2Owner, author, SCOPE_RELEASE, repo2Id);

      await expect(releaseRegistry.connect(owner).anchorRelease(projectId, releaseId, manifestCid, name, author.address, [repo1Id, repo2Id], [root1, root2]))
        .to.emit(releaseRegistry, "ReleaseAnchored")
        .withArgs(projectId, releaseId, author.address, manifestCid, name, anyValue);

      const r = await releaseRegistry.getReleaseById(releaseId);
      expect(r.author).to.equal(author.address);
    });

    it("Should succeed if author owns none of the repos but is delegated for all", async function () {
        const otherProjectId = ethers.id("project-other");
        const releaseId = ethers.id("success-no-own");
        
        // otherAccount will be the author
        // author (repoOwner of repo1) delegates to otherAccount
        await delegate(author, otherAccount, SCOPE_RELEASE, repo1Id);

        // otherAccount is authorized for repo1, and now it should work even if they don't own any repos.
        await expect(releaseRegistry.connect(owner).anchorRelease(otherProjectId, releaseId, manifestCid, name, otherAccount.address, [repo1Id], [root1]))
            .to.emit(releaseRegistry, "ReleaseAnchored");
    });

    it("Should fail if snapshot does not exist", async function () {
        const releaseId = ethers.id("fail4");
        const badRoot = ethers.id("badroot");
        await expect(releaseRegistry.connect(owner).anchorRelease(projectId, releaseId, manifestCid, name, author.address, [repo1Id], [badRoot]))
            .to.be.revertedWith("snapshot not found");
    });
  });

  describe("supersede and revoke", function () {
    let projectId: string;
    let release1Id: string;
    let release2Id: string;

    before(async function () {
      projectId = ethers.id("project-sr");
      release1Id = ethers.id("r1");
      release2Id = ethers.id("r2");
      const repo1Id = ethers.id("repo-sr");
      const root1 = ethers.id("root-sr1");
      const root2 = ethers.id("root-sr2");

      await registry.connect(author).claimRepo(repo1Id, "repo-sr");
      await snapshotRegistry.connect(owner).createSnapshot(repo1Id, ethers.ZeroHash, root1, "c", author.address, 1);
      await snapshotRegistry.connect(owner).createSnapshot(repo1Id, ethers.ZeroHash, root2, "c", author.address, 1);

      await releaseRegistry.connect(owner).anchorRelease(projectId, release1Id, "c", "v1", author.address, [repo1Id], [root1]);
      await releaseRegistry.connect(owner).anchorRelease(projectId, release2Id, "c", "v2", author.address, [repo1Id], [root2]);
    });

    it("Should fail to supersede if not revoked", async function () {
      await expect(releaseRegistry.connect(owner).supersedeRelease(projectId, release1Id, release2Id, author.address))
        .to.be.revertedWith("old release must be revoked");
    });

    it("Should supersede release", async function () {
      // Must be revoked first
      await releaseRegistry.connect(owner).revokeRelease(projectId, release1Id, author.address);

      await expect(releaseRegistry.connect(owner).supersedeRelease(projectId, release1Id, release2Id, author.address))
        .to.emit(releaseRegistry, "ReleaseSuperseded")
        .withArgs(projectId, release1Id, release2Id, author.address, anyValue);
      
      const r = await releaseRegistry.getReleaseById(release1Id);
      expect(r.supersededBy).to.equal(release2Id);
    });

    it("Should revoke release", async function () {
      await expect(releaseRegistry.connect(owner).revokeRelease(projectId, release2Id, author.address))
        .to.emit(releaseRegistry, "ReleaseRevoked")
        .withArgs(projectId, release2Id, author.address, anyValue);
      
      const r = await releaseRegistry.getReleaseById(release2Id);
      expect(r.revoked).to.be.true;
    });
  });

  describe("Views", function () {
    let projectId: string;
    let releaseId: string;
    let repo1Id: string;
    let root1: string;

    before(async function () {
        projectId = ethers.id("project-views");
        releaseId = ethers.id("release-view");
        repo1Id = ethers.id("repo-view");
        root1 = ethers.id("root-view");

        await registry.connect(author).claimRepo(repo1Id, "repo-view");
        await snapshotRegistry.connect(owner).createSnapshot(repo1Id, ethers.ZeroHash, root1, "c", author.address, 1);

        await releaseRegistry.connect(owner).anchorRelease(projectId, releaseId, "c", "v1", author.address, [repo1Id], [root1]);
    });

    it("Should get releases count", async function () {
        expect(await releaseRegistry.getReleasesCount(projectId)).to.equal(1);
    });

    it("Should get release by index", async function () {
        const r = await releaseRegistry.getReleaseByIndex(projectId, 0);
        expect(r.id).to.equal(releaseId);
        expect(r.name).to.equal("v1");
    });

    it("Should get release by ID", async function () {
        const r = await releaseRegistry.getReleaseById(releaseId);
        expect(r.projectId).to.equal(projectId);
        expect(r.status).to.equal(0n); // PENDING
    });

    it("Should fail for invalid index in getReleaseByIndex", async function () {
        await expect(releaseRegistry.getReleaseByIndex(projectId, 10))
            .to.be.revertedWith("invalid index");
    });

    it("Should fail for non-existent releaseId", async function () {
        await expect(releaseRegistry.getReleaseById(ethers.id("ghost")))
            .to.be.revertedWith("not found");
    });
  });

  describe("Status Management", function () {
    let projectId: string;
    let releaseId: string;
    let releaseCounter = 0;

    before(async function () {
        const repo1Id = ethers.id("repo-status-setup");
        await registry.connect(author).claimRepo(repo1Id, "repo-status-setup");
    });

    beforeEach(async function () {
        releaseCounter++;
        projectId = ethers.id("project-status");
        releaseId = ethers.id("release-status-" + releaseCounter);
        const repo1Id = ethers.id("repo-status-setup");
        const root1 = ethers.id("root-status-" + releaseCounter);

        await snapshotRegistry.connect(owner).createSnapshot(repo1Id, ethers.ZeroHash, root1, "c", author.address, 1);
        await releaseRegistry.connect(owner).anchorRelease(projectId, releaseId, "c", "v1", author.address, [repo1Id], [root1]);
    });

    it("Should accept a pending release", async function () {
        await expect(releaseRegistry.connect(owner).accept(releaseId))
            .to.emit(releaseRegistry, "GouvernanceStatusChanged")
            .withArgs(releaseId, 1, owner.address, anyValue); // 1 = ACCEPTED

        const r = await releaseRegistry.getReleaseById(releaseId);
        expect(r.status).to.equal(1n);
        expect(r.statusAuthor).to.equal(owner.address);
    });

    it("Should reject a pending release", async function () {
        await expect(releaseRegistry.connect(owner).reject(releaseId))
            .to.emit(releaseRegistry, "GouvernanceStatusChanged")
            .withArgs(releaseId, 2, owner.address, anyValue); // 2 = REJECTED

        const r = await releaseRegistry.getReleaseById(releaseId);
        expect(r.status).to.equal(2n);
    });

    it("Should fail to accept if not owner", async function () {
        await expect(releaseRegistry.connect(otherAccount).accept(releaseId))
            .to.be.revertedWithCustomError(releaseRegistry, "OwnableUnauthorizedAccount")
            .withArgs(otherAccount.address);
    });

    it("Should fail to reject if not owner", async function () {
        await expect(releaseRegistry.connect(otherAccount).reject(releaseId))
            .to.be.revertedWithCustomError(releaseRegistry, "OwnableUnauthorizedAccount")
            .withArgs(otherAccount.address);
    });

    it("Should fail to accept if already accepted", async function () {
        await releaseRegistry.connect(owner).accept(releaseId);
        await expect(releaseRegistry.connect(owner).accept(releaseId))
            .to.be.revertedWith("not in pending status");
    });

    it("Should fail to reject if already rejected", async function () {
        await releaseRegistry.connect(owner).reject(releaseId);
        await expect(releaseRegistry.connect(owner).reject(releaseId))
            .to.be.revertedWith("not in pending status");
    });
  });
});
