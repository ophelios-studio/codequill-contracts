// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title CodeQuillDelegation
 * @notice Context-scoped delegation: owner -> relayer, with (scopes bitmask + expiry) bound to a contextId.
 *
 * Why contextId?
 * - Gives cryptographic guarantees that a delegation is valid only for a specific "workspace", without needing an
 *   on-chain workspace registry.
 *
 * Authorization rule:
 *  - delegation exists for (owner, relayer, contextId) if expiry != 0 and >= now
 *  - and (storedScopes & requiredScope) != 0
 *  - SCOPE_ALL authorizes any scope
 */
contract CodeQuillDelegation is Ownable, EIP712 {
    using ECDSA for bytes32;

    // ---- Scopes (bitmask) ----
    uint256 public constant SCOPE_CLAIM = 1 << 0;
    uint256 public constant SCOPE_SNAPSHOT = 1 << 1;
    uint256 public constant SCOPE_ATTEST = 1 << 2;
    uint256 public constant SCOPE_BACKUP = 1 << 3;
    uint256 public constant SCOPE_RELEASE = 1 << 4;
    uint256 public constant SCOPE_ALL = type(uint256).max;

    // bytes32(0) can be treated as invalid context (recommended)
    error ZeroContext();
    error SigExpired();
    error BadExpiry();
    error ZeroAddr();
    error BadSigner();

    // ---- Storage ----
    // owner -> relayer -> contextId -> scopes bitmask
    mapping(address => mapping(address => mapping(bytes32 => uint256))) public scopesOf;

    // owner -> relayer -> contextId -> unix expiry seconds
    mapping(address => mapping(address => mapping(bytes32 => uint64))) public expiryOf;

    // EIP-712 nonce per owner (global across contexts; simple & safe)
    mapping(address => uint256) public nonces;

    // ---- EIP-712 typehashes ----
    // Delegate(owner,relayer,contextId,scopes,nonce,expiry,deadline)
    bytes32 private constant DELEGATE_TYPEHASH =
    keccak256(
        "Delegate(address owner,address relayer,bytes32 contextId,uint256 scopes,uint256 nonce,uint256 expiry,uint256 deadline)"
    );

    // Revoke(owner,relayer,contextId,nonce,deadline)
    bytes32 private constant REVOKE_TYPEHASH =
    keccak256(
        "Revoke(address owner,address relayer,bytes32 contextId,uint256 nonce,uint256 deadline)"
    );

    // ---- Events ----
    event Delegated(
        address indexed owner,
        address indexed relayer,
        bytes32 indexed contextId,
        uint256 scopes,
        uint64 expiry
    );

    event Revoked(
        address indexed owner,
        address indexed relayer,
        bytes32 indexed contextId
    );

    constructor(address initialOwner)
    Ownable(initialOwner)
    EIP712("CodeQuillDelegation", "3") // bump version because typed data changed
    {}

    // ---- Views ----

    function isAuthorized(
        address owner_,
        address relayer_,
        uint256 scope,
        bytes32 contextId
    ) public view returns (bool) {
        if (contextId == bytes32(0)) return false;

        uint64 exp = expiryOf[owner_][relayer_][contextId];
        if (exp == 0 || exp < block.timestamp) return false;

        uint256 scopes = scopesOf[owner_][relayer_][contextId];
        if (scopes == SCOPE_ALL) return true;

        return (scopes & scope) != 0;
    }

    // ---- Writes ----

    /**
     * @notice Register or update a delegation using an EIP-712 signature from `owner_`.
     *
     * @dev Signature is over:
     *  Delegate(owner, relayer, contextId, scopes, nonce, expiry, deadline)
     */
    function registerDelegationWithSig(
        address owner_,
        address relayer_,
        bytes32 contextId,
        uint256 scopes,
        uint256 expiry,   // unix seconds
        uint256 deadline, // unix seconds
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp > deadline) revert SigExpired();
        if (expiry <= block.timestamp) revert BadExpiry();
        if (owner_ == address(0) || relayer_ == address(0)) revert ZeroAddr();
        if (contextId == bytes32(0)) revert ZeroContext();

        uint256 nonce = nonces[owner_];

        bytes32 structHash = keccak256(
            abi.encode(
                DELEGATE_TYPEHASH,
                owner_,
                relayer_,
                contextId,
                scopes,
                nonce,
                expiry,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        if (signer != owner_) revert BadSigner();

        nonces[owner_] = nonce + 1;

        scopesOf[owner_][relayer_][contextId] = scopes;
        expiryOf[owner_][relayer_][contextId] = uint64(expiry);

        emit Delegated(owner_, relayer_, contextId, scopes, uint64(expiry));
    }

    /**
     * @notice Revoke delegation for msg.sender -> relayer_ in a given contextId.
     */
    function revoke(address relayer_, bytes32 contextId) external {
        if (relayer_ == address(0)) revert ZeroAddr();
        if (contextId == bytes32(0)) revert ZeroContext();

        scopesOf[msg.sender][relayer_][contextId] = 0;
        expiryOf[msg.sender][relayer_][contextId] = 0;

        emit Revoked(msg.sender, relayer_, contextId);
    }

    /**
     * @notice Revoke delegation using an EIP-712 signature from `owner_`.
     *
     * @dev Signature is over:
     *  Revoke(owner, relayer, contextId, nonce, deadline)
     */
    function revokeWithSig(
        address owner_,
        address relayer_,
        bytes32 contextId,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (block.timestamp > deadline) revert SigExpired();
        if (owner_ == address(0) || relayer_ == address(0)) revert ZeroAddr();
        if (contextId == bytes32(0)) revert ZeroContext();

        uint256 nonce = nonces[owner_];

        bytes32 structHash = keccak256(
            abi.encode(
                REVOKE_TYPEHASH,
                owner_,
                relayer_,
                contextId,
                nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        if (signer != owner_) revert BadSigner();

        nonces[owner_] = nonce + 1;

        scopesOf[owner_][relayer_][contextId] = 0;
        expiryOf[owner_][relayer_][contextId] = 0;

        emit Revoked(owner_, relayer_, contextId);
    }
}