import { expect } from "chai";
import hre from "hardhat";

describe("CodeQuillDelegation", function () {
  let ethers: any;
  let time: any;
  let delegationContract: any;
  let owner: any;
  let repoOwner: any;
  let relayer: any;
  let otherAccount: any;
  let domain: any;

  const SCOPE_CLAIM = 1n << 0n;
  const SCOPE_SNAPSHOT = 1n << 1n;
  const SCOPE_ATTEST = 1n << 2n;
  const SCOPE_ALL = (1n << 256n) - 1n;

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

  const revokeTypes = {
    Revoke: [
      { name: "owner", type: "address" },
      { name: "relayer", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };

  before(async function () {
    const connection = await hre.network.connect();
    ethers = (connection as any).ethers;
    time = (connection as any).networkHelpers.time;

    [owner, repoOwner, relayer, otherAccount] = await ethers.getSigners();

    const Delegation = await ethers.getContractFactory("CodeQuillDelegation");
    delegationContract = await Delegation.deploy(owner.address);
    await delegationContract.waitForDeployment();

    domain = {
      name: "CodeQuillDelegation",
      version: "1",
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: await delegationContract.getAddress(),
    };
  });

  describe("registerDelegationWithSig", function () {
    it("Should register a delegation with a valid signature", async function () {
      const expiry = (await time.latest()) + 3600;
      const deadline = (await time.latest()) + 7200;
      const scopes = SCOPE_CLAIM | SCOPE_SNAPSHOT;
      const repoIdOrWildcard = ethers.encodeBytes32String("repo1");
      const nonce = await delegationContract.nonces(repoOwner.address);

      const value = {
        owner: repoOwner.address,
        relayer: relayer.address,
        scopes,
        repoIdOrWildcard,
        nonce,
        expiry,
        deadline,
      };

      const signature = await repoOwner.signTypedData(domain, types, value);
      const { v, r, s } = ethers.Signature.from(signature);

      await expect(
        delegationContract.registerDelegationWithSig(
          repoOwner.address,
          relayer.address,
          scopes,
          repoIdOrWildcard,
          expiry,
          deadline,
          v, r, s
        )
      ).to.emit(delegationContract, "Delegated")
        .withArgs(repoOwner.address, relayer.address, scopes, repoIdOrWildcard, expiry);

      expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_CLAIM, repoIdOrWildcard)).to.be.true;
      expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_SNAPSHOT, repoIdOrWildcard)).to.be.true;
      expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_ATTEST, repoIdOrWildcard)).to.be.false;
    });

    it("Should fail with invalid signer", async function () {
        const expiry = (await time.latest()) + 3600;
        const deadline = (await time.latest()) + 7200;
        const scopes = SCOPE_CLAIM;
        const repoIdOrWildcard = ethers.encodeBytes32String("repo1");
        const nonce = await delegationContract.nonces(repoOwner.address);
  
        const value = {
          owner: repoOwner.address,
          relayer: relayer.address,
          scopes,
          repoIdOrWildcard,
          nonce,
          expiry,
          deadline,
        };
  
        const signature = await otherAccount.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);
  
        await expect(
          delegationContract.registerDelegationWithSig(
            repoOwner.address,
            relayer.address,
            scopes,
            repoIdOrWildcard,
            expiry,
            deadline,
            v, r, s
          )
        ).to.be.revertedWith("bad signer");
    });

    it("Should fail if deadline passed", async function () {
        const expiry = (await time.latest()) + 3600;
        const deadline = (await time.latest()) - 100;
        const scopes = SCOPE_CLAIM;
        const repoIdOrWildcard = ethers.encodeBytes32String("repo1");
        const nonce = await delegationContract.nonces(repoOwner.address);
  
        const value = {
          owner: repoOwner.address,
          relayer: relayer.address,
          scopes,
          repoIdOrWildcard,
          nonce,
          expiry,
          deadline,
        };
  
        const signature = await repoOwner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);
  
        await expect(
          delegationContract.registerDelegationWithSig(
            repoOwner.address,
            relayer.address,
            scopes,
            repoIdOrWildcard,
            expiry,
            deadline,
            v, r, s
          )
        ).to.be.revertedWith("sig expired");
    });
  });

  describe("isAuthorized", function () {
    it("Should handle wildcard repoId", async function () {
        const expiry = (await time.latest()) + 3600;
        const deadline = (await time.latest()) + 7200;
        const scopes = SCOPE_SNAPSHOT;
        const repoIdOrWildcard = ethers.ZeroHash; // Wildcard
        const nonce = await delegationContract.nonces(repoOwner.address);
  
        const value = {
          owner: repoOwner.address,
          relayer: relayer.address,
          scopes,
          repoIdOrWildcard,
          nonce,
          expiry,
          deadline,
        };
  
        const signature = await repoOwner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);

        await delegationContract.registerDelegationWithSig(
          repoOwner.address,
          relayer.address,
          scopes,
          repoIdOrWildcard,
          expiry,
          deadline,
          v, r, s
        );
  
        expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_SNAPSHOT, ethers.encodeBytes32String("any-repo"))).to.be.true;
        expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_SNAPSHOT, ethers.encodeBytes32String("another-repo"))).to.be.true;
        expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_CLAIM, ethers.encodeBytes32String("any-repo"))).to.be.false;
    });

    it("Should return false if expired", async function () {
        const expiry = (await time.latest()) + 100;
        const deadline = (await time.latest()) + 7200;
        const scopes = SCOPE_SNAPSHOT;
        const repoIdOrWildcard = ethers.encodeBytes32String("repo-exp");
        const nonce = await delegationContract.nonces(repoOwner.address);
  
        const value = {
          owner: repoOwner.address,
          relayer: relayer.address,
          scopes,
          repoIdOrWildcard,
          nonce,
          expiry,
          deadline,
        };
  
        const signature = await repoOwner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);
        await delegationContract.registerDelegationWithSig(repoOwner.address, relayer.address, scopes, repoIdOrWildcard, expiry, deadline, v, r, s);
  
        expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_SNAPSHOT, repoIdOrWildcard)).to.be.true;
        
        await time.increase(200);
        
        expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_SNAPSHOT, repoIdOrWildcard)).to.be.false;
    });

    it("Should handle SCOPE_ALL", async function () {
        const expiry = (await time.latest()) + 3600;
        const deadline = (await time.latest()) + 7200;
        const scopes = SCOPE_ALL;
        const repoIdOrWildcard = ethers.ZeroHash;
        const nonce = await delegationContract.nonces(repoOwner.address);

        const value = {
          owner: repoOwner.address,
          relayer: relayer.address,
          scopes,
          repoIdOrWildcard,
          nonce,
          expiry,
          deadline,
        };

        const signature = await repoOwner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);
        await delegationContract.registerDelegationWithSig(repoOwner.address, relayer.address, scopes, repoIdOrWildcard, expiry, deadline, v, r, s);

        expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_CLAIM, ethers.encodeBytes32String("anything"))).to.be.true;
        expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_ATTEST, ethers.encodeBytes32String("anything"))).to.be.true;
    });
  });

  describe("Revocation", function () {
    it("Should allow repo owner to revoke delegation manually", async function () {
        const expiry = (await time.latest()) + 3600;
        const deadline = (await time.latest()) + 7200;
        const scopes = SCOPE_CLAIM;
        const repoIdOrWildcard = ethers.encodeBytes32String("repo-rev");
        const nonce = await delegationContract.nonces(repoOwner.address);
  
        const value = { owner: repoOwner.address, relayer: relayer.address, scopes, repoIdOrWildcard, nonce, expiry, deadline };
        const signature = await repoOwner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);
        await delegationContract.registerDelegationWithSig(repoOwner.address, relayer.address, scopes, repoIdOrWildcard, expiry, deadline, v, r, s);
  
        expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_CLAIM, repoIdOrWildcard)).to.be.true;
  
        await expect(delegationContract.connect(repoOwner).revoke(relayer.address))
            .to.emit(delegationContract, "Revoked")
            .withArgs(repoOwner.address, relayer.address);
  
        expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_CLAIM, repoIdOrWildcard)).to.be.false;
    });

    it("Should allow revocation with signature", async function () {
        const expiry = (await time.latest()) + 3600;
        const deadline = (await time.latest()) + 7200;
        const scopes = SCOPE_CLAIM;
        const repoIdOrWildcard = ethers.encodeBytes32String("repo-rev-sig");
        const nonce = await delegationContract.nonces(repoOwner.address);
  
        const value = { owner: repoOwner.address, relayer: relayer.address, scopes, repoIdOrWildcard, nonce, expiry, deadline };
        const signature = await repoOwner.signTypedData(domain, types, value);
        const { v, r, s } = ethers.Signature.from(signature);
        await delegationContract.registerDelegationWithSig(repoOwner.address, relayer.address, scopes, repoIdOrWildcard, expiry, deadline, v, r, s);
  
        // Revocation signature
        const revokeNonce = await delegationContract.nonces(repoOwner.address);
        const revokeDeadline = (await time.latest()) + 7200;
        const revokeValue = { 
            owner: repoOwner.address, 
            relayer: relayer.address, 
            nonce: revokeNonce, 
            deadline: revokeDeadline 
        };
        const revokeSignature = await repoOwner.signTypedData(domain, revokeTypes, revokeValue);
        const { v: vR, r: rR, s: sR } = ethers.Signature.from(revokeSignature);
  
        await expect(delegationContract.revokeWithSig(repoOwner.address, relayer.address, revokeDeadline, vR, rR, sR))
            .to.emit(delegationContract, "Revoked")
            .withArgs(repoOwner.address, relayer.address);
  
        expect(await delegationContract.isAuthorized(repoOwner.address, relayer.address, SCOPE_CLAIM, repoIdOrWildcard)).to.be.false;
    });
  });
});
