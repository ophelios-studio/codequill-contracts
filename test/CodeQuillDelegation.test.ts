import { expect } from "chai";
import {
  asBigInt,
  delegationTypes,
  getEip712Domain,
  revokeDelegationTypes,
  setupCodeQuill,
} from "./utils";

describe("CodeQuillDelegation", function () {
  let ethers: any;
  let time: any;
  let delegation: any;
  let deployer: any;
  let owner: any;
  let relayer: any;
  let other: any;
  let domain: any;

  const contextIdLabel = "ctx-1";

  beforeEach(async function () {
    const env = await setupCodeQuill();
    ethers = env.ethers;
    time = env.time;
    deployer = env.deployer;
    owner = env.alice;
    relayer = env.bob;
    other = env.charlie;
    delegation = env.delegation;

    domain = await getEip712Domain(
      ethers,
      "CodeQuillDelegation",
      "1",
      await delegation.getAddress(),
    );
  });

  describe("registerDelegationWithSig", function () {
    it("registers a delegation and authorizes scoped calls within a contextId", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;

      const scopes =
        (await delegation.SCOPE_CLAIM()) | (await delegation.SCOPE_SNAPSHOT());
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          v,
          r,
          s,
        ),
      )
        .to.emit(delegation, "Delegated")
        .withArgs(owner.address, relayer.address, contextId, scopes, expiry);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(true);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_ATTEST(),
          contextId,
        ),
      ).to.equal(false);
    });

    it("reverts on bad signer", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await other.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          v,
          r,
          s,
        ),
      ).to.be.revertedWith("BadSigner");
    });

    it("reverts when signature deadline is passed", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now - 1n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          v,
          r,
          s,
        ),
      ).to.be.revertedWith("SigExpired");
    });

    it("reverts when expiry is not in the future", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now; // invalid
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          v,
          r,
          s,
        ),
      ).to.be.revertedWith("BadExpiry");
    });

    it("reverts on zero context", async function () {
      const contextId = ethers.ZeroHash;
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          relayer.address,
          contextId,
          scopes,
          expiry,
          deadline,
          v,
          r,
          s,
        ),
      ).to.be.revertedWith("ZeroContext");
    });

    it("reverts on zero relayer address", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: ethers.ZeroAddress,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.registerDelegationWithSig(
          owner.address,
          ethers.ZeroAddress,
          contextId,
          scopes,
          expiry,
          deadline,
          v,
          r,
          s,
        ),
      ).to.be.revertedWith("ZeroAddr");
    });
  });

  describe("isAuthorized", function () {
    it("returns false for zero context", async function () {
      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          ethers.ZeroHash,
        ),
      ).to.equal(false);
    });

    it("returns false once delegation expires", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 100n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_SNAPSHOT();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await delegation.registerDelegationWithSig(
        owner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline,
        v,
        r,
        s,
      );

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_SNAPSHOT(),
          contextId,
        ),
      ).to.equal(true);

      await time.increase(200);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_SNAPSHOT(),
          contextId,
        ),
      ).to.equal(false);
    });

    it("treats SCOPE_ALL as authorizing any scope", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_ALL();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await delegation.registerDelegationWithSig(
        owner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline,
        v,
        r,
        s,
      );

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(true);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_RELEASE(),
          contextId,
        ),
      ).to.equal(true);
    });
  });

  describe("revocation", function () {
    it("allows owner to revoke directly", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await delegation.registerDelegationWithSig(
        owner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline,
        v,
        r,
        s,
      );

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(true);

      await expect(delegation.connect(owner).revoke(relayer.address, contextId))
        .to.emit(delegation, "Revoked")
        .withArgs(owner.address, relayer.address, contextId);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(false);
    });

    it("reverts when revoking with zero address or zero context", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      await expect(
        delegation.connect(owner).revoke(ethers.ZeroAddress, contextId),
      ).to.be.revertedWith("ZeroAddr");

      await expect(
        delegation.connect(owner).revoke(relayer.address, ethers.ZeroHash),
      ).to.be.revertedWith("ZeroContext");
    });

    it("allows revocation with signature", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const expiry = now + 3600n;
      const deadline = now + 7200n;
      const scopes = await delegation.SCOPE_CLAIM();
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        scopes,
        nonce,
        expiry,
        deadline,
      };

      const signature = await owner.signTypedData(domain, delegationTypes, value);
      const { v, r, s } = ethers.Signature.from(signature);
      await delegation.registerDelegationWithSig(
        owner.address,
        relayer.address,
        contextId,
        scopes,
        expiry,
        deadline,
        v,
        r,
        s,
      );

      const revokeNonce = await delegation.nonces(owner.address);
      const revokeDeadline = now + 9000n;
      const revokeValue = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        nonce: revokeNonce,
        deadline: revokeDeadline,
      };

      const revokeSig = await owner.signTypedData(
        domain,
        revokeDelegationTypes,
        revokeValue,
      );
      const { v: vR, r: rR, s: sR } = ethers.Signature.from(revokeSig);

      await expect(
        delegation
          .connect(deployer)
          .revokeWithSig(owner.address, relayer.address, contextId, revokeDeadline, vR, rR, sR),
      )
        .to.emit(delegation, "Revoked")
        .withArgs(owner.address, relayer.address, contextId);

      expect(
        await delegation.isAuthorized(
          owner.address,
          relayer.address,
          await delegation.SCOPE_CLAIM(),
          contextId,
        ),
      ).to.equal(false);
    });

    it("reverts on revokeWithSig with bad signer", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const deadline = now + 7200n;
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        nonce,
        deadline,
      };

      const signature = await other.signTypedData(
        domain,
        revokeDelegationTypes,
        value,
      );
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.revokeWithSig(
          owner.address,
          relayer.address,
          contextId,
          deadline,
          v,
          r,
          s,
        ),
      ).to.be.revertedWith("BadSigner");
    });

    it("reverts on revokeWithSig with expired deadline", async function () {
      const contextId = ethers.encodeBytes32String(contextIdLabel);
      const now = asBigInt(await time.latest());
      const deadline = now - 1n;
      const nonce = await delegation.nonces(owner.address);

      const value = {
        owner: owner.address,
        relayer: relayer.address,
        contextId,
        nonce,
        deadline,
      };

      const signature = await owner.signTypedData(
        domain,
        revokeDelegationTypes,
        value,
      );
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegation.revokeWithSig(
          owner.address,
          relayer.address,
          contextId,
          deadline,
          v,
          r,
          s,
        ),
      ).to.be.revertedWith("SigExpired");
    });
  });
});
