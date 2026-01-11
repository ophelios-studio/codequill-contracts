// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

contract CodeQuillDelegation is Ownable, EIP712 {
    using ECDSA for bytes32;

    // ---- Scopes (bitmask) ----
    uint256 public constant SCOPE_CLAIM = 1 << 0;
    uint256 public constant SCOPE_SNAPSHOT = 1 << 1;
    uint256 public constant SCOPE_ATTEST = 1 << 2;
    uint256 public constant SCOPE_BACKUP = 1 << 3;
    uint256 public constant SCOPE_ALL = type(uint256).max;

    // ---- Storage ----
    mapping(address => mapping(address => uint256)) public scopesOf;   // owner -> relayer -> bitmask
    mapping(address => mapping(address => uint64))  public expiryOf;   // owner -> relayer -> unix
    mapping(bytes32 => bool) public repoAllowed; // keccak256(owner, relayer, repoId) => allowed
    mapping(address => uint256) public nonces;    // EIP-712 nonce per owner

    // ---- EIP-712 typehashes ----
    // Delegate(owner,relayer,scopes,repoIdOrWildcard,nonce,expiry,deadline)
    bytes32 private constant DELEGATE_TYPEHASH =
    keccak256("Delegate(address owner,address relayer,uint256 scopes,bytes32 repoIdOrWildcard,uint256 nonce,uint256 expiry,uint256 deadline)");
    // Revoke(owner,relayer,nonce,deadline)
    bytes32 private constant REVOKE_TYPEHASH =
    keccak256("Revoke(address owner,address relayer,uint256 nonce,uint256 deadline)");

    // ---- Events ----
    event Delegated(address indexed owner, address indexed relayer, uint256 scopes, bytes32 repoIdOrWildcard, uint64 expiry);
    event Revoked(address indexed owner, address indexed relayer);

    constructor(address initialOwner)
    Ownable(initialOwner)
    EIP712("CodeQuillDelegation", "1")
    {}

    // ---- Views ----
    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 repoId
    ) public view returns (bool) {
        uint64 exp = expiryOf[owner_][relayer_];
        if (exp == 0 || exp < block.timestamp) return false;

        uint256 scopes = scopesOf[owner_][relayer_];
        if ((scopes & scope) == 0) return false;

        if (scopes == SCOPE_ALL) return true;

        // wildcard (repoId == 0) OR specific repo
        bytes32 wildKey = keccak256(abi.encode(owner_, relayer_, bytes32(0)));
        if (repoAllowed[wildKey]) return true;

        bytes32 specificKey = keccak256(abi.encode(owner_, relayer_, repoId));
        return repoAllowed[specificKey];
    }

    // ---- Writes ----
    function registerDelegationWithSig(
        address owner_,
        address relayer_,
        uint256 scopes,
        bytes32 repoIdOrWildcard, // bytes32(0) = ANY repo
        uint256 expiry,           // unix seconds
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        require(block.timestamp <= deadline, "sig expired");
        require(expiry > block.timestamp, "bad expiry");
        require(owner_ != address(0) && relayer_ != address(0), "zero addr");

        uint256 nonce = nonces[owner_];
        bytes32 structHash = keccak256(
            abi.encode(
                DELEGATE_TYPEHASH,
                owner_,
                relayer_,
                scopes,
                repoIdOrWildcard,
                nonce,
                expiry,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == owner_, "bad signer");

        nonces[owner_] = nonce + 1;

        scopesOf[owner_][relayer_] = scopes;
        expiryOf[owner_][relayer_] = uint64(expiry);

        // allow wildcard or a specific repo (no helper func; hash inline)
        bytes32 allowKey = keccak256(abi.encode(owner_, relayer_, repoIdOrWildcard));
        repoAllowed[allowKey] = true;

        emit Delegated(owner_, relayer_, scopes, repoIdOrWildcard, uint64(expiry));
    }

    function revoke(address relayer_) external {
        scopesOf[msg.sender][relayer_] = 0;
        expiryOf[msg.sender][relayer_] = 0;
        emit Revoked(msg.sender, relayer_);
    }

    function revokeWithSig(
        address owner_,
        address relayer_,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
    ) external {
        require(block.timestamp <= deadline, "sig expired");
        uint256 nonce = nonces[owner_];

        bytes32 structHash = keccak256(
            abi.encode(
                REVOKE_TYPEHASH,
                owner_,
                relayer_,
                nonce,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == owner_, "bad signer");

        nonces[owner_] = nonce + 1;

        scopesOf[owner_][relayer_] = 0;
        expiryOf[owner_][relayer_] = 0;
        emit Revoked(owner_, relayer_);
    }
}