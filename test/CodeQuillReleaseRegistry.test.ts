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

describe("CodeQuillReleaseRegistry", function () {
  let ethers: any;
  let time: any;
  let workspace: any;
  let repository: any;
  let snapshotRegistry: any;
  let delegation: any;
  let releaseRegistry: any;
  let deployer: any;
  let author: any;
  let governance: any;
  let repoOwner1: any;
  let repoOwner2: any;
  let relayer: any;
  let other: any;
  let daoExecutor: any;
  let domain: any;
  let workspaceDomain: any;

  const contextId = "0x1111111111111111111111111111111111111111111111111111111111111111";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    deployer = env.deployer;
    workspace = env.workspace;
    repository = env.repository;
    snapshotRegistry = env.snapshot;
    delegation = env.delegation;
    releaseRegistry = env.release;

    author = env.alice;
    governance = env.bob;
    repoOwner1 = env.alice;
    repoOwner2 = env.charlie;
    relayer = env.charlie;
    other = env.deployer;
    daoExecutor = env.daoExecutor;

    domain = await getEip712Domain(
      ethers,
      "CodeQuillDelegation",
      "3",
      await delegation.getAddress(),
    );

    workspaceDomain = await getWorkspaceEip712Domain(ethers, workspace);
    await workspace.connect(deployer).initAuthority(contextId, deployer.address);

    const now = asBigInt(await time.latest());
    const membershipDeadline = now + 3600n;

    for (const signer of [author, governance, repoOwner1, repoOwner2, relayer]) {
      await setWorkspaceMemberWithSig({
        ethers,
        workspace,
        authoritySigner: deployer,
        relayerSigner: deployer,
        domain: workspaceDomain,
        contextId,
        member: signer.address,
        memberStatus: true,
        deadline: membershipDeadline,
      });
    }
  });

  async function delegate(scope: bigint, ownerSigner: any, relayerSigner: any) {
    const now = asBigInt(await time.latest());
    const expiry = now + 3600n;
    const deadline = now + 7200n;
    const nonce = await delegation.nonces(ownerSigner.address);

    const value = {
      owner: ownerSigner.address,
      relayer: relayerSigner.address,
      contextId,
      scopes: scope,
      nonce,
      expiry,
      deadline,
    };

    const signature = await ownerSigner.signTypedData(domain, delegationTypes, value);
    const { v, r, s } = ethers.Signature.from(signature);

    await delegation.registerDelegationWithSig(
      ownerSigner.address,
      relayerSigner.address,
      contextId,
      scope,
      expiry,
      deadline,
      v,
      r,
      s,
    );
  }

  async function setupTwoReposAndSnapshots() {
    const repo1Id = ethers.encodeBytes32String("repo1");
    const repo2Id = ethers.encodeBytes32String("repo2");
    const root1 = ethers.id("root1");
    const root2 = ethers.id("root2");

    await repository
      .connect(repoOwner1)
      .claimRepo(repo1Id, contextId, "meta1", repoOwner1.address);
    await repository
      .connect(repoOwner2)
      .claimRepo(repo2Id, contextId, "meta2", repoOwner2.address);

    await snapshotRegistry
      .connect(repoOwner1)
      .createSnapshot(repo1Id, contextId, ethers.id("c1"), root1, "cid1", repoOwner1.address);
    await snapshotRegistry
      .connect(repoOwner2)
      .createSnapshot(repo2Id, contextId, ethers.id("c2"), root2, "cid2", repoOwner2.address);

    return { repo1Id, repo2Id, root1, root2 };
  }

  describe("anchorRelease", function () {
    it("anchors a release when called by the author", async function () {
      const { repo1Id, root1 } = await setupTwoReposAndSnapshots();

      const projectId = ethers.id("project1");
      const releaseId = ethers.id("release1");

      await expect(
        releaseRegistry
          .connect(author)
          .anchorRelease(
            projectId,
            releaseId,
            contextId,
            "QmRelease123",
            "v1.0.0",
            author.address,
            governance.address,
            [repo1Id],
            [root1],
          ),
      )
        .to.emit(releaseRegistry, "ReleaseAnchored")
        .withArgs(
          projectId,
          releaseId,
          contextId,
          author.address,
          governance.address,
          "QmRelease123",
          "v1.0.0",
          anyValue,
        );

      const r = await releaseRegistry.getReleaseById(releaseId);
      expect(r.author).to.equal(author.address);
      expect(r.governanceAuthority).to.equal(governance.address);
      expect(r.status).to.equal(0n);
    });

    it("allows a delegated relayer to anchor on behalf of the author", async function () {
      const { repo1Id, repo2Id, root1, root2 } = await setupTwoReposAndSnapshots();
      await delegate(await delegation.SCOPE_RELEASE(), author, relayer);

      const projectId = ethers.id("project2");
      const releaseId = ethers.id("release-relayed");

      await expect(
        releaseRegistry
          .connect(relayer)
          .anchorRelease(
            projectId,
            releaseId,
            contextId,
            "cid",
            "v1",
            author.address,
            governance.address,
            [repo1Id, repo2Id],
            [root1, root2],
          ),
      ).to.emit(releaseRegistry, "ReleaseAnchored");
    });

    it("reverts when called by a non-authorized relayer", async function () {
      const { repo1Id, root1 } = await setupTwoReposAndSnapshots();

      await expect(
        releaseRegistry
          .connect(other)
          .anchorRelease(
            ethers.id("p"),
            ethers.id("r"),
            contextId,
            "cid",
            "v1",
            author.address,
            governance.address,
            [repo1Id],
            [root1],
          ),
      ).to.be.revertedWith("not authorized");
    });

    it("reverts if governanceAuthority is not a workspace member", async function () {
      const { repo1Id, root1 } = await setupTwoReposAndSnapshots();

      await expect(
        releaseRegistry
          .connect(author)
          .anchorRelease(
            ethers.id("p"),
            ethers.id("r"),
            contextId,
            "cid",
            "v1",
            author.address,
            daoExecutor.address,
            [repo1Id],
            [root1],
          ),
      ).to.be.revertedWith("governance not member");
    });

    it("reverts if snapshot does not exist", async function () {
      const repo1Id = ethers.encodeBytes32String("repo1");
      await repository
        .connect(repoOwner1)
        .claimRepo(repo1Id, contextId, "meta", repoOwner1.address);

      await expect(
        releaseRegistry
          .connect(author)
          .anchorRelease(
            ethers.id("p"),
            ethers.id("r"),
            contextId,
            "cid",
            "v1",
            author.address,
            governance.address,
            [repo1Id],
            [ethers.id("missing")],
          ),
      ).to.be.revertedWith("snapshot not found");
    });
  });

  describe("governance actions", function () {
    async function anchorOneRelease() {
      const { repo1Id, root1 } = await setupTwoReposAndSnapshots();
      const projectId = ethers.id("project-g");
      const releaseId = ethers.id("release-g");

      await releaseRegistry
        .connect(author)
        .anchorRelease(
          projectId,
          releaseId,
          contextId,
          "cid",
          "v1",
          author.address,
          governance.address,
          [repo1Id],
          [root1],
        );

      return { projectId, releaseId };
    }

    it("allows governanceAuthority to accept and reject pending releases", async function () {
      const { releaseId } = await anchorOneRelease();

      await expect(releaseRegistry.connect(governance).accept(releaseId))
        .to.emit(releaseRegistry, "GouvernanceStatusChanged")
        .withArgs(releaseId, 1, governance.address, anyValue);

      await expect(releaseRegistry.connect(governance).reject(releaseId)).to.be.revertedWith(
        "not in pending status",
      );
    });

    it("allows delegated governance relayer", async function () {
      const { releaseId } = await anchorOneRelease();
      await delegate(await delegation.SCOPE_RELEASE(), governance, relayer);

      await expect(releaseRegistry.connect(relayer).accept(releaseId))
        .to.emit(releaseRegistry, "GouvernanceStatusChanged")
        .withArgs(releaseId, 1, relayer.address, anyValue);
    });

    it("allows daoExecutor when set by a workspace member", async function () {
      const { releaseId } = await anchorOneRelease();
      await releaseRegistry.connect(author).setDaoExecutor(contextId, author.address, daoExecutor.address);

      await expect(releaseRegistry.connect(daoExecutor).reject(releaseId))
        .to.emit(releaseRegistry, "GouvernanceStatusChanged")
        .withArgs(releaseId, 2, daoExecutor.address, anyValue);
    });

    it("allows delegated relayer to set daoExecutor", async function () {
      await delegate(await delegation.SCOPE_RELEASE(), author, relayer);
      await expect(releaseRegistry.connect(relayer).setDaoExecutor(contextId, author.address, daoExecutor.address))
        .to.emit(releaseRegistry, "DaoExecutorSet")
        .withArgs(contextId, daoExecutor.address);
    });

    it("reverts when setting daoExecutor by non-member", async function () {
      const signers = await ethers.getSigners();
      const nonMember = signers[5];
      await expect(releaseRegistry.connect(nonMember).setDaoExecutor(contextId, nonMember.address, daoExecutor.address))
        .to.be.revertedWith("author not member");
    });

    it("reverts for non-governance callers", async function () {
      const { releaseId } = await anchorOneRelease();
      await expect(releaseRegistry.connect(other).accept(releaseId)).to.be.revertedWith(
        "not governance",
      );
    });
  });

  describe("revoke + supersede", function () {
    it("revokes and supersedes releases (author or delegated relayer)", async function () {
      const { repo1Id, root1, root2 } = await (async () => {
        const repo1Id = ethers.encodeBytes32String("repo-sr");
        const root1 = ethers.id("root-sr1");
        const root2 = ethers.id("root-sr2");

        await repository
          .connect(repoOwner1)
          .claimRepo(repo1Id, contextId, "meta", repoOwner1.address);
        await snapshotRegistry
          .connect(repoOwner1)
          .createSnapshot(repo1Id, contextId, ethers.id("c1"), root1, "cid", repoOwner1.address);
        await snapshotRegistry
          .connect(repoOwner1)
          .createSnapshot(repo1Id, contextId, ethers.id("c2"), root2, "cid", repoOwner1.address);

        return { repo1Id, root1, root2 };
      })();

      const projectId = ethers.id("project-sr");
      const release1Id = ethers.id("r1");
      const release2Id = ethers.id("r2");

      await releaseRegistry
        .connect(author)
        .anchorRelease(
          projectId,
          release1Id,
          contextId,
          "cid",
          "v1",
          author.address,
          governance.address,
          [repo1Id],
          [root1],
        );
      await releaseRegistry
        .connect(author)
        .anchorRelease(
          projectId,
          release2Id,
          contextId,
          "cid",
          "v2",
          author.address,
          governance.address,
          [repo1Id],
          [root2],
        );

      await expect(
        releaseRegistry.connect(author).supersedeRelease(projectId, release1Id, release2Id, author.address),
      ).to.be.revertedWith("old release must be revoked");

      await expect(releaseRegistry.connect(author).revokeRelease(projectId, release1Id, author.address))
        .to.emit(releaseRegistry, "ReleaseRevoked")
        .withArgs(projectId, release1Id, author.address, anyValue);

      await expect(
        releaseRegistry.connect(author).supersedeRelease(projectId, release1Id, release2Id, author.address),
      )
        .to.emit(releaseRegistry, "ReleaseSuperseded")
        .withArgs(projectId, release1Id, release2Id, author.address, anyValue);

      const r = await releaseRegistry.getReleaseById(release1Id);
      expect(r.supersededBy).to.equal(release2Id);

      // delegated revoke
      await delegate(await delegation.SCOPE_RELEASE(), author, relayer);
      await expect(releaseRegistry.connect(relayer).revokeRelease(projectId, release2Id, author.address))
        .to.emit(releaseRegistry, "ReleaseRevoked")
        .withArgs(projectId, release2Id, author.address, anyValue);
    });
  });

  describe("views", function () {
    it("supports list and get by id", async function () {
      const { repo1Id, root1 } = await setupTwoReposAndSnapshots();
      const projectId = ethers.id("project-views");
      const releaseId = ethers.id("release-view");

      await releaseRegistry
        .connect(author)
        .anchorRelease(
          projectId,
          releaseId,
          contextId,
          "cid",
          "v1",
          author.address,
          governance.address,
          [repo1Id],
          [root1],
        );

      expect(await releaseRegistry.getReleasesCount(projectId)).to.equal(1);
      const byIndex = await releaseRegistry.getReleaseByIndex(projectId, 0);
      expect(byIndex.id).to.equal(releaseId);
      expect(byIndex.name).to.equal("v1");

      const byId = await releaseRegistry.getReleaseById(releaseId);
      expect(byId.projectId).to.equal(projectId);
      expect(byId.status).to.equal(0n);

      await expect(releaseRegistry.getReleaseByIndex(projectId, 10)).to.be.revertedWith(
        "invalid index",
      );
      await expect(releaseRegistry.getReleaseById(ethers.id("ghost"))).to.be.revertedWith(
        "not found",
      );
      await expect(releaseRegistry.getGouvernanceStatus(ethers.id("ghost"))).to.be.revertedWith(
        "release not found",
      );
    });
  });
});
