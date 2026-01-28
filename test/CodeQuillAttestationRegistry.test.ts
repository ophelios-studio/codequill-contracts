import { expect } from "chai";
import hre from "hardhat";
import { anyValue } from "@nomicfoundation/hardhat-ethers-chai-matchers/withArgs";

describe("CodeQuillAttestationRegistry", function () {
  let ethers: any;
  let time: any;
  let registry: any;
  let delegation: any;
  let snapshotRegistry: any;
  let releaseRegistry: any;
  let attestationRegistry: any;
  let owner: any;
  let repoOwner: any;
  let relayer: any;
  let otherAccount: any;
  let domain: any;

  const SCOPE_ATTEST = 1n << 2n;
  const SCOPE_RELEASE = 1n << 4n;

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

    const ReleaseRegistry = await ethers.getContractFactory("CodeQuillReleaseRegistry");
    releaseRegistry = await ReleaseRegistry.deploy(
        owner.address, 
        await registry.getAddress(), 
        await delegation.getAddress(),
        await snapshotRegistry.getAddress()
    );
    await releaseRegistry.waitForDeployment();

    const Attestation = await ethers.getContractFactory("CodeQuillAttestationRegistry");
    attestationRegistry = await Attestation.deploy(owner.address, await registry.getAddress(), await delegation.getAddress(), await releaseRegistry.getAddress());
    await attestationRegistry.waitForDeployment();

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

  describe("createAttestation", function () {
    let projectId: string;
    let releaseId: string;
    let repoId: string;
    let merkleRoot: string;
    let artifactDigest: string;
    const attestationCid = "QmAttest123";

    before(async function () {
        projectId = ethers.id("project1");
        releaseId = ethers.id("release1");
        repoId = ethers.id("repo1");
        merkleRoot = ethers.id("root1");
        artifactDigest = ethers.id("artifact1");
        
        await registry.connect(repoOwner).claimRepo(repoId, "meta");
        await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, merkleRoot, "cid", repoOwner.address, 10);
        
        // anchor release
        await releaseRegistry.connect(owner).anchorRelease(projectId, releaseId, "manifest", "v1", repoOwner.address, [repoId], [merkleRoot]);
    });

    it("Should fail if release is not accepted", async function () {
        const unacceptedReleaseId = ethers.id("unaccepted");
        const root2 = ethers.id("root2");
        await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, root2, "cid", repoOwner.address, 10);
        await releaseRegistry.connect(owner).anchorRelease(projectId, unacceptedReleaseId, "manifest", "v1", repoOwner.address, [repoId], [root2]);

        await expect(attestationRegistry.connect(owner).createAttestation(
            unacceptedReleaseId, artifactDigest, 1, attestationCid, repoOwner.address
        )).to.be.revertedWith("release not accepted");
    });

    it("Should allow relayer (contract owner) to create attestation if author is authorized and release accepted", async function () {
        // Accept the release first
        await releaseRegistry.connect(owner).accept(releaseId, "accepted for test");

        await expect(attestationRegistry.connect(owner).createAttestation(
            releaseId, artifactDigest, 1, attestationCid, repoOwner.address
        )).to.emit(attestationRegistry, "AttestationCreated")
          .withArgs(0, repoOwner.address, releaseId, artifactDigest, 1, attestationCid, anyValue);
        
        expect(await attestationRegistry.getAttestationsCount(releaseId)).to.equal(1);
    });

    it("Should allow relayer to create attestation if author has delegation", async function () {
        const releaseId2 = ethers.id("release2");
        const artifactDigest2 = ethers.id("artifact2");
        
        const root3 = ethers.id("root3");
        await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, root3, "cid", repoOwner.address, 10);
        await releaseRegistry.connect(owner).anchorRelease(projectId, releaseId2, "manifest", "v2", repoOwner.address, [repoId], [root3]);
        await releaseRegistry.connect(owner).accept(releaseId2, "accepted");

        await delegate(repoOwner, otherAccount, SCOPE_ATTEST, releaseId2);

        await expect(attestationRegistry.connect(owner).createAttestation(
            releaseId2, artifactDigest2, 1, attestationCid, otherAccount.address
        )).to.emit(attestationRegistry, "AttestationCreated");
    });

    it("Should fail if release does not exist", async function () {
        const fakeRelease = ethers.id("fake");
        await expect(attestationRegistry.connect(owner).createAttestation(
            fakeRelease, artifactDigest, 3, attestationCid, repoOwner.address
        )).to.be.revertedWith("not found");
    });

    it("Should fail if duplicate attestation", async function () {
        await expect(attestationRegistry.connect(owner).createAttestation(
            releaseId, artifactDigest, 1, "another-cid", repoOwner.address
        )).to.be.revertedWith("duplicate attestation");
    });
  });

  describe("revokeAttestation", function () {
    let projectId: string;
    let releaseId: string;
    let repoId: string;
    let artifactDigest: string;

    before(async function () {
        projectId = ethers.id("project-revoke");
        releaseId = ethers.id("release-revoke");
        repoId = ethers.id("repo-revoke");
        artifactDigest = ethers.id("digest-revoke");
        const root = ethers.id("root-revoke");
        
        await registry.connect(repoOwner).claimRepo(repoId, "meta");
        await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, root, "cid", repoOwner.address, 10);
        await releaseRegistry.connect(owner).anchorRelease(projectId, releaseId, "m", "v", repoOwner.address, [repoId], [root]);
        await releaseRegistry.connect(owner).accept(releaseId, "accepted");
        
        await attestationRegistry.connect(owner).createAttestation(releaseId, artifactDigest, 5, "cid", repoOwner.address);
    });

    it("Should allow relayer to revoke attestation", async function () {
        await expect(attestationRegistry.connect(owner).revokeAttestation(
            releaseId, artifactDigest, "revocation-note", repoOwner.address
        )).to.emit(attestationRegistry, "AttestationRevoked")
          .withArgs(releaseId, artifactDigest, repoOwner.address, "revocation-note", anyValue);
        
        expect(await attestationRegistry.isRevoked(releaseId, artifactDigest)).to.be.true;
    });

    it("Should fail if not authorized for revocation", async function () {
        const artifactDigest2 = ethers.id("digest2");
        await attestationRegistry.connect(owner).createAttestation(releaseId, artifactDigest2, 5, "cid", repoOwner.address);

        await expect(attestationRegistry.connect(owner).revokeAttestation(
            releaseId, artifactDigest2, "note", otherAccount.address
        )).to.be.revertedWith("not authorized");
    });
  });

  describe("Views", function () {
      let projectId: string;
      let releaseId: string;
      let artifactDigest: string;

      before(async function () {
          projectId = ethers.id("project-view");
          releaseId = ethers.id("release-view");
          const repoId = ethers.id("repo-view");
          const root = ethers.id("root-view");
          artifactDigest = ethers.id("digest-view");
          
          await registry.connect(repoOwner).claimRepo(repoId, "meta");
          await snapshotRegistry.connect(owner).createSnapshot(repoId, ethers.ZeroHash, root, "cid", repoOwner.address, 10);
          await releaseRegistry.connect(owner).anchorRelease(projectId, releaseId, "m", "v", repoOwner.address, [repoId], [root]);
          await releaseRegistry.connect(owner).accept(releaseId, "accepted");
          
          await attestationRegistry.connect(owner).createAttestation(releaseId, artifactDigest, 10, "cid-attest", repoOwner.address);
      });

      it("Should get attestation by index", async function () {
          const a = await attestationRegistry.getAttestation(releaseId, 0);
          expect(a.artifactDigest).to.equal(artifactDigest);
          expect(a.artifactType).to.equal(10n);
      });

      it("Should get attestation by digest including revocation info", async function () {
          const a = await attestationRegistry.getAttestationByDigest(releaseId, artifactDigest);
          expect(a.attestationCid).to.equal("cid-attest");
          expect(a.revoked).to.be.false;
      });
  });
});
