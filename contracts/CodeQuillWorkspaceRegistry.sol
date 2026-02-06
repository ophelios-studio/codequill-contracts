// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title CodeQuillWorkspaceRegistry
/// @notice On-chain registry binding wallets to a workspace contextId (bytes32).
/// @dev Provides cryptographic "wallet is in workspace" guarantees without storing a full workspace object.
contract CodeQuillWorkspaceRegistry is Ownable, EIP712 {
    using ECDSA for bytes32;

    // contextId -> wallet -> isMember
    mapping(bytes32 => mapping(address => bool)) public isMember;

    // contextId -> authority wallet (optional; can be zero if unset)
    mapping(bytes32 => address) public authorityOf;

    // EIP-712 nonce per wallet signer
    mapping(address => uint256) public nonces;

    // Join(contextId,wallet,nonce,deadline)
    bytes32 private constant JOIN_TYPEHASH =
    keccak256("Join(bytes32 contextId,address wallet,uint256 nonce,uint256 deadline)");

    // Leave(contextId,wallet,nonce,deadline)
    bytes32 private constant LEAVE_TYPEHASH =
    keccak256("Leave(bytes32 contextId,address wallet,uint256 nonce,uint256 deadline)");

    event Joined(bytes32 indexed contextId, address indexed wallet);
    event Left(bytes32 indexed contextId, address indexed wallet);
    event AuthoritySet(bytes32 indexed contextId, address indexed authority);

    constructor(address initialOwner)
    Ownable(initialOwner)
    EIP712("CodeQuillWorkspaceRegistry", "1")
    {}

    function joinWithSig(
        bytes32 contextId,
        address wallet,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(contextId != bytes32(0), "zero context");
        require(wallet != address(0), "zero wallet");
        require(block.timestamp <= deadline, "sig expired");

        uint256 nonce = nonces[wallet];

        bytes32 structHash = keccak256(
            abi.encode(
                JOIN_TYPEHASH,
                contextId,
                wallet,
                nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == wallet, "bad signer");

        nonces[wallet] = nonce + 1;

        isMember[contextId][wallet] = true;
        emit Joined(contextId, wallet);
    }

    /// @notice Direct join (wallet pays gas)
    function join(bytes32 contextId) external {
        require(contextId != bytes32(0), "zero context");
        isMember[contextId][msg.sender] = true;
        emit Joined(contextId, msg.sender);
    }

    function leaveWithSig(
        bytes32 contextId,
        address wallet,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(contextId != bytes32(0), "zero context");
        require(wallet != address(0), "zero wallet");
        require(block.timestamp <= deadline, "sig expired");

        uint256 nonce = nonces[wallet];

        bytes32 structHash = keccak256(
            abi.encode(
                LEAVE_TYPEHASH,
                contextId,
                wallet,
                nonce,
                deadline
            )
        );

        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        require(signer == wallet, "bad signer");

        nonces[wallet] = nonce + 1;

        isMember[contextId][wallet] = false;

        // If they were authority, clear it
        if (authorityOf[contextId] == wallet) {
            authorityOf[contextId] = address(0);
            emit AuthoritySet(contextId, address(0));
        }

        emit Left(contextId, wallet);
    }

    /// @notice Direct leave (wallet pays gas)
    function leave(bytes32 contextId) external {
        require(contextId != bytes32(0), "zero context");
        isMember[contextId][msg.sender] = false;

        if (authorityOf[contextId] == msg.sender) {
            authorityOf[contextId] = address(0);
            emit AuthoritySet(contextId, address(0));
        }

        emit Left(contextId, msg.sender);
    }

    /// @notice Set workspace authority (main wallet).
    /// @dev Must be called by the authority wallet itself (or via its EOA).
    function setAuthority(bytes32 contextId) external {
        require(contextId != bytes32(0), "zero context");
        require(isMember[contextId][msg.sender], "not a member");

        authorityOf[contextId] = msg.sender;
        emit AuthoritySet(contextId, msg.sender);
    }
}