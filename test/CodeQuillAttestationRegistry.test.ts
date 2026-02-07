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

describe("CodeQuillAttestationRegistry", function () {
  let ethers: any;
  let time: any;
  let workspace: any;
  let repository: any;
  let snapshotRegistry: any;
  let releaseRegistry: any;
  let delegation: any;
  let attestationRegistry: any;
  let author: any;
  let governance: any;
  let relayer: any;
  let other: any;
  let domain: any;
  let workspaceDomain: any;

  const contextId = "0x1111111111111111111111111111111111111111111111111111111111111111";
  const repoId = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    workspace = env.workspace;
    repository = env.repository;
    snapshotRegistry = env.snapshot;
    releaseRegistry = env.release;
    delegation = env.delegation;
    attestationRegistry = env.attestation;
    author = env.alice;
    governance = env.bob;
    relayer = env.charlie;
    other = env.deployer;

    domain = await getEip712Domain(
      ethers,
      "CodeQuillDelegation",
      "1",
      await delegation.getAddress(),
    );

    workspaceDomain = await getWorkspaceEip712Domain(ethers, workspace);
    await workspace.connect(other).initAuthority(contextId, other.address);

    const now = asBigInt(await time.latest());
    const membershipDeadline = now + 3600n;
    for (const signer of [author, governance, relayer]) {
      await setWorkspaceMemberWithSig({
        ethers,
        workspace,
        authoritySigner: other,
        relayerSigner: other,
        domain: workspaceDomain,
        contextId,
        member: signer.address,
        memberStatus: true,
        deadline: membershipDeadline,
      });
    }
  });

  async function setupAcceptedRelease(releaseId: string) {
    const projectId = ethers.id("project-1");
    const manifestCid = "manifest";
    const name = "v1";
    const root = ethers.id("root-1");
    const commitHash = ethers.id("commit-1");

    await repository
      .connect(author)
      .claimRepo(repoId, contextId, "meta", author.address);
    await snapshotRegistry
      .connect(author)
      .createSnapshot(
        repoId,
        contextId,
        commitHash,
        root,
        "snapshot-cid",
        author.address
      );

    await releaseRegistry
      .connect(author)
      .anchorRelease(
        projectId,
        releaseId,
        contextId,
        manifestCid,
        name,
        author.address,
        governance.address,
        [repoId],
        [root],
      );

    await releaseRegistry.connect(governance).accept(releaseId);

    return { projectId, root };
  }

  async function delegateAttest(ownerSigner: any, relayerSigner: any) {
    const now = asBigInt(await time.latest());
    const expiry = now + 3600n;
    const deadline = now + 7200n;
    const scopes = await delegation.SCOPE_ATTEST();
    const nonce = await delegation.nonces(ownerSigner.address);

    const value = {
      owner: ownerSigner.address,
      relayer: relayerSigner.address,
      contextId,
      scopes,
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
      scopes,
      expiry,
      deadline,
      v,
      r,
      s,
    );
  }

  describe("createAttestation", function () {
    it("creates an attestation when release is accepted and caller is author", async function () {
      const releaseId = ethers.id("release-1");
      await setupAcceptedRelease(releaseId);

      const artifactDigest = ethers.id("artifact-1");
      const attestationCid = "QmAttest123";

      await expect(
        attestationRegistry
          .connect(author)
          .createAttestation(releaseId, artifactDigest, attestationCid, author.address),
      )
        .to.emit(attestationRegistry, "AttestationCreated")
        .withArgs(0, author.address, releaseId, artifactDigest, attestationCid, anyValue);

      expect(await attestationRegistry.getAttestationsCount(releaseId)).to.equal(1);
      expect(await attestationRegistry.isRevoked(releaseId, artifactDigest)).to.equal(false);
    });

    it("allows a delegated relayer to create attestation", async function () {
      const releaseId = ethers.id("release-2");
      await setupAcceptedRelease(releaseId);
      await delegateAttest(author, relayer);

      await expect(
        attestationRegistry
          .connect(relayer)
          .createAttestation(releaseId, ethers.id("artifact-2"), "cid", author.address),
      ).to.emit(attestationRegistry, "AttestationCreated");
    });

    it("reverts if release is not accepted", async function () {
      const releaseId = ethers.id("release-pending");

      // create a pending release (not accepted)
      const projectId = ethers.id("project-pending");
      const root = ethers.id("root-pending");
      await repository
        .connect(author)
        .claimRepo(repoId, contextId, "meta", author.address);
      await snapshotRegistry
        .connect(author)
        .createSnapshot(
          repoId,
          contextId,
          ethers.id("commit"),
          root,
          "snapshot-cid",
          author.address
        );
      await releaseRegistry
        .connect(author)
        .anchorRelease(
          projectId,
          releaseId,
          contextId,
          "manifest",
          "v1",
          author.address,
          governance.address,
          [repoId],
          [root],
        );

      await expect(
        attestationRegistry
          .connect(author)
          .createAttestation(releaseId, ethers.id("a"), "cid", author.address),
      ).to.be.revertedWith("release not accepted");
    });

    it("reverts if release does not exist", async function () {
      await expect(
        attestationRegistry
          .connect(author)
          .createAttestation(ethers.id("missing"), ethers.id("a"), "cid", author.address),
      ).to.be.revertedWith("not found");
    });

    it("reverts on duplicate attestation", async function () {
      const releaseId = ethers.id("release-dup");
      await setupAcceptedRelease(releaseId);

      const artifactDigest = ethers.id("artifact-dup");
      await attestationRegistry
        .connect(author)
        .createAttestation(releaseId, artifactDigest, "cid", author.address);

      await expect(
        attestationRegistry
          .connect(author)
          .createAttestation(releaseId, artifactDigest, "cid2", author.address),
      ).to.be.revertedWith("duplicate attestation");
    });

    it("reverts on empty cid / zero digest / zero release", async function () {
      const releaseId = ethers.id("release-errs");
      await setupAcceptedRelease(releaseId);

      await expect(
        attestationRegistry
          .connect(author)
          .createAttestation(releaseId, ethers.ZeroHash, "cid", author.address),
      ).to.be.revertedWith("zero digest");

      await expect(
        attestationRegistry
          .connect(author)
          .createAttestation(releaseId, ethers.id("a"), "", author.address),
      ).to.be.revertedWith("empty CID");

      await expect(
        attestationRegistry
          .connect(author)
          .createAttestation(ethers.ZeroHash, ethers.id("a"), "cid", author.address),
      ).to.be.revertedWith("zero releaseId");
    });

    it("reverts when caller is not authorized", async function () {
      const releaseId = ethers.id("release-authz");
      await setupAcceptedRelease(releaseId);

      await expect(
        attestationRegistry
          .connect(other)
          .createAttestation(releaseId, ethers.id("a"), "cid", author.address),
      ).to.be.revertedWith("not authorized");
    });
  });

  describe("revokeAttestation", function () {
    it("revokes an existing attestation (author direct)", async function () {
      const releaseId = ethers.id("release-revoke");
      await setupAcceptedRelease(releaseId);

      const digest = ethers.id("digest-revoke");
      await attestationRegistry
        .connect(author)
        .createAttestation(releaseId, digest, "cid", author.address);

      await expect(
        attestationRegistry.connect(author).revokeAttestation(releaseId, digest, author.address),
      )
        .to.emit(attestationRegistry, "AttestationRevoked")
        .withArgs(releaseId, digest, author.address, anyValue);

      expect(await attestationRegistry.isRevoked(releaseId, digest)).to.equal(true);
    });

    it("allows delegated relayer to revoke", async function () {
      const releaseId = ethers.id("release-revoke-relayed");
      await setupAcceptedRelease(releaseId);

      const digest = ethers.id("digest-1");
      await attestationRegistry
        .connect(author)
        .createAttestation(releaseId, digest, "cid", author.address);

      await delegateAttest(author, relayer);
      await expect(
        attestationRegistry.connect(relayer).revokeAttestation(releaseId, digest, author.address),
      ).to.emit(attestationRegistry, "AttestationRevoked");
    });

    it("reverts when attestation not found", async function () {
      const releaseId = ethers.id("release-rnf");
      await setupAcceptedRelease(releaseId);

      await expect(
        attestationRegistry
          .connect(author)
          .revokeAttestation(releaseId, ethers.id("missing"), author.address),
      ).to.be.revertedWith("not found");
    });

    it("reverts when already revoked", async function () {
      const releaseId = ethers.id("release-rar");
      await setupAcceptedRelease(releaseId);

      const digest = ethers.id("digest");
      await attestationRegistry
        .connect(author)
        .createAttestation(releaseId, digest, "cid", author.address);
      await attestationRegistry.connect(author).revokeAttestation(releaseId, digest, author.address);

      await expect(
        attestationRegistry.connect(author).revokeAttestation(releaseId, digest, author.address),
      ).to.be.revertedWith("already revoked");
    });
  });

  describe("views", function () {
    it("getAttestation / getAttestationByDigest work and revert on invalid index / not found", async function () {
      const releaseId = ethers.id("release-views");
      await setupAcceptedRelease(releaseId);

      await expect(attestationRegistry.getAttestation(releaseId, 0)).to.be.revertedWith(
        "invalid index",
      );
      await expect(
        attestationRegistry.getAttestationByDigest(releaseId, ethers.id("missing")),
      ).to.be.revertedWith("not found");

      const digest = ethers.id("digest-view");
      await attestationRegistry
        .connect(author)
        .createAttestation(releaseId, digest, "cid-attest", author.address);

      const a0 = await attestationRegistry.getAttestation(releaseId, 0);
      expect(a0.artifactDigest).to.equal(digest);
      expect(a0.attestationCid).to.equal("cid-attest");
      expect(a0.author).to.equal(author.address);
      expect(a0.revoked).to.equal(false);

      const byDigest = await attestationRegistry.getAttestationByDigest(releaseId, digest);
      expect(byDigest.attestationCid).to.equal("cid-attest");
      expect(byDigest.author).to.equal(author.address);
      expect(byDigest.index).to.equal(0);
      expect(byDigest.revoked).to.equal(false);
    });
  });
});
