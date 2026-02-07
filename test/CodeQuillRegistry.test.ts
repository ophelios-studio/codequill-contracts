import { expect } from "chai";
import {
  asBigInt,
  delegationTypes,
  getEip712Domain,
  getWorkspaceEip712Domain,
  setWorkspaceMemberWithSig,
  setupCodeQuill,
} from "./utils";

describe("CodeQuillRepositoryRegistry", function () {
  let ethers: any;
  let time: any;
  let workspace: any;
  let delegation: any;
  let repository: any;
  let deployer: any;
  let repoOwner: any;
  let relayer: any;
  let other: any;
  let domain: any;
  let workspaceDomain: any;

  const contextId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const otherContextId = "0x2222222222222222222222222222222222222222222222222222222222222222";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    deployer = env.deployer;
    repoOwner = env.alice;
    relayer = env.bob;
    other = env.charlie;
    workspace = env.workspace;
    delegation = env.delegation;
    repository = env.repository;

    domain = await getEip712Domain(
      ethers,
      "CodeQuillDelegation",
      "1",
      await delegation.getAddress(),
    );

    workspaceDomain = await getWorkspaceEip712Domain(ethers, workspace);

    // Bootstrap contexts and add required members via authority signature.
    await workspace.connect(deployer).initAuthority(contextId, deployer.address);
    await workspace.connect(deployer).initAuthority(otherContextId, deployer.address);

    const now = asBigInt(await time.latest());
    const deadline = now + 3600n;

    await setWorkspaceMemberWithSig({
      ethers,
      workspace,
      authoritySigner: deployer,
      relayerSigner: deployer,
      domain: workspaceDomain,
      contextId,
      member: repoOwner.address,
      memberStatus: true,
      deadline,
    });
    await setWorkspaceMemberWithSig({
      ethers,
      workspace,
      authoritySigner: deployer,
      relayerSigner: deployer,
      domain: workspaceDomain,
      contextId: otherContextId,
      member: other.address,
      memberStatus: true,
      deadline,
    });
  });

  describe("claimRepo", function () {
    it("allows direct claim by a workspace member", async function () {
      const repoId = ethers.encodeBytes32String("direct-repo");

      await expect(
        repository
          .connect(repoOwner)
          .claimRepo(repoId, contextId, "some-meta", repoOwner.address),
      )
        .to.emit(repository, "RepoClaimed")
        .withArgs(repoId, repoOwner.address, contextId, "some-meta");

      expect(await repository.repoOwner(repoId)).to.equal(repoOwner.address);
      expect(await repository.repoContextId(repoId)).to.equal(contextId);
      expect(await repository.isClaimed(repoId)).to.equal(true);
    });

    it("reverts if owner is not a member of the context", async function () {
      const repoId = ethers.encodeBytes32String("not-member");
      await expect(
        repository
          .connect(repoOwner)
          .claimRepo(repoId, otherContextId, "meta", repoOwner.address),
      ).to.be.revertedWith("owner not member");
    });

    it("reverts if already claimed", async function () {
      const repoId = ethers.encodeBytes32String("claimed-repo");
      await repository
        .connect(repoOwner)
        .claimRepo(repoId, contextId, "meta", repoOwner.address);

      await expect(
        repository.connect(other).claimRepo(repoId, contextId, "meta2", other.address),
      ).to.be.revertedWith("already claimed");
    });

    it("allows delegated relayer to claim", async function () {
      const repoId = ethers.encodeBytes32String("delegated-claim");
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
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
        repository
          .connect(relayer)
          .claimRepo(repoId, contextId, "delegated-meta", repoOwner.address),
      )
        .to.emit(repository, "RepoClaimed")
        .withArgs(repoId, repoOwner.address, contextId, "delegated-meta");
    });

    it("reverts if not authorized", async function () {
      const repoId = ethers.encodeBytes32String("fail-claim");
      await expect(
        repository.connect(other).claimRepo(repoId, contextId, "meta", repoOwner.address),
      ).to.be.revertedWith("not authorized");
    });
  });

  describe("transferRepo", function () {
    it("allows direct transfer by current owner", async function () {
      const repoId = ethers.encodeBytes32String("transfer-repo");
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;
      await setWorkspaceMemberWithSig({
        ethers,
        workspace,
        authoritySigner: deployer,
        relayerSigner: deployer,
        domain: workspaceDomain,
        contextId: otherContextId,
        member: relayer.address,
        memberStatus: true,
        deadline,
      });

      await repository
        .connect(repoOwner)
        .claimRepo(repoId, contextId, "meta", repoOwner.address);

      await expect(
        repository.connect(repoOwner).transferRepo(repoId, relayer.address, otherContextId),
      )
        .to.emit(repository, "RepoTransferred")
        .withArgs(repoId, repoOwner.address, relayer.address, contextId, otherContextId);

      expect(await repository.repoOwner(repoId)).to.equal(relayer.address);
      expect(await repository.repoContextId(repoId)).to.equal(otherContextId);
    });

    it("allows delegated relayer to transfer", async function () {
      const repoId = ethers.encodeBytes32String("transfer-delegated");
      const now = asBigInt(await time.latest());
      const deadline = now + 3600n;
      await setWorkspaceMemberWithSig({
        ethers,
        workspace,
        authoritySigner: deployer,
        relayerSigner: deployer,
        domain: workspaceDomain,
        contextId: otherContextId,
        member: relayer.address,
        memberStatus: true,
        deadline,
      });

      await repository
        .connect(repoOwner)
        .claimRepo(repoId, contextId, "meta", repoOwner.address);

      const now2 = asBigInt(await time.latest());
      const expiry = now2 + 3600n;
      const deadline2 = now2 + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(repoOwner.address);

      const value = {
        owner: repoOwner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline: deadline2,
      };

      const signature = await repoOwner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await delegation.registerDelegationWithSig(
        repoOwner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline2,
        v,
        r,
        s,
      );

      await expect(
        repository.connect(relayer).transferRepo(repoId, relayer.address, otherContextId),
      )
        .to.emit(repository, "RepoTransferred")
        .withArgs(repoId, repoOwner.address, relayer.address, contextId, otherContextId);
    });

    it("reverts if there is no change", async function () {
      const repoId = ethers.encodeBytes32String("no-change");
      await repository
        .connect(repoOwner)
        .claimRepo(repoId, contextId, "meta", repoOwner.address);

      await expect(
        repository.connect(repoOwner).transferRepo(repoId, repoOwner.address, contextId),
      ).to.be.revertedWith("no change");
    });
  });

  describe("views", function () {
    it("returns multiple owners", async function () {
      const repo1 = ethers.encodeBytes32String("repo1");
      const repo2 = ethers.encodeBytes32String("repo2");

      await repository
        .connect(repoOwner)
        .claimRepo(repo1, contextId, "m1", repoOwner.address);

      const owners = await repository.repoOwners([repo1, repo2]);
      expect(owners[0]).to.equal(repoOwner.address);
      expect(owners[1]).to.equal(ethers.ZeroAddress);
    });

    it("returns repos by owner", async function () {
      const repoX = ethers.encodeBytes32String("repoX");
      await repository
        .connect(repoOwner)
        .claimRepo(repoX, contextId, "mX", repoOwner.address);

      const repos = await repository.getReposByOwner(repoOwner.address);
      expect(repos).to.include(repoX);
    });
  });
});
