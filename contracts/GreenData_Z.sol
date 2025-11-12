pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract EncryptedDataProcessor is ZamaEthereumConfig {
    
    struct EncryptedEntry {
        string identifier;
        euint32 encryptedReading;
        uint256 publicParameter1;
        uint256 publicParameter2;
        string metadata;
        address submitter;
        uint256 submissionTime;
        uint32 decryptedValue;
        bool verificationStatus;
    }
    
    mapping(string => EncryptedEntry) public encryptedEntries;
    string[] public entryIdentifiers;
    
    event EntryCreated(string indexed identifier, address indexed submitter);
    event DecryptionVerified(string indexed identifier, uint32 decryptedValue);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createEncryptedEntry(
        string calldata identifier,
        string calldata name,
        externalEuint32 encryptedReading,
        bytes calldata inputProof,
        uint256 publicParameter1,
        uint256 publicParameter2,
        string calldata metadata
    ) external {
        require(bytes(encryptedEntries[identifier].identifier).length == 0, "Entry already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedReading, inputProof)), "Invalid encrypted input");
        
        encryptedEntries[identifier] = EncryptedEntry({
            identifier: identifier,
            encryptedReading: FHE.fromExternal(encryptedReading, inputProof),
            publicParameter1: publicParameter1,
            publicParameter2: publicParameter2,
            metadata: metadata,
            submitter: msg.sender,
            submissionTime: block.timestamp,
            decryptedValue: 0,
            verificationStatus: false
        });
        
        FHE.allowThis(encryptedEntries[identifier].encryptedReading);
        FHE.makePubliclyDecryptable(encryptedEntries[identifier].encryptedReading);
        
        entryIdentifiers.push(identifier);
        emit EntryCreated(identifier, msg.sender);
    }
    
    function verifyDecryption(
        string calldata identifier, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(encryptedEntries[identifier].identifier).length > 0, "Entry does not exist");
        require(!encryptedEntries[identifier].verificationStatus, "Data already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedEntries[identifier].encryptedReading);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        encryptedEntries[identifier].decryptedValue = decodedValue;
        encryptedEntries[identifier].verificationStatus = true;
        
        emit DecryptionVerified(identifier, decodedValue);
    }
    
    function getEncryptedReading(string calldata identifier) external view returns (euint32) {
        require(bytes(encryptedEntries[identifier].identifier).length > 0, "Entry does not exist");
        return encryptedEntries[identifier].encryptedReading;
    }
    
    function getEntryDetails(string calldata identifier) external view returns (
        string memory name,
        uint256 publicParameter1,
        uint256 publicParameter2,
        string memory metadata,
        address submitter,
        uint256 submissionTime,
        bool verificationStatus,
        uint32 decryptedValue
    ) {
        require(bytes(encryptedEntries[identifier].identifier).length > 0, "Entry does not exist");
        EncryptedEntry storage entry = encryptedEntries[identifier];
        
        return (
            entry.identifier,
            entry.publicParameter1,
            entry.publicParameter2,
            entry.metadata,
            entry.submitter,
            entry.submissionTime,
            entry.verificationStatus,
            entry.decryptedValue
        );
    }
    
    function getAllEntryIdentifiers() external view returns (string[] memory) {
        return entryIdentifiers;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

