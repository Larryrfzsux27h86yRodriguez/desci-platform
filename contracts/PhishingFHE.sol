// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Phishing FHE Exchange
/// @author Generated
/// @notice Contract source generated — comments are written in English.
contract PhishingFHEExchange is SepoliaConfig {
    // NOTE: keep internal identifiers stable
    uint256 public sampleCount;

    // NOTE: storage layout for encrypted samples
    struct EncryptedSample {
        uint256 id;
        euint32 encryptedUrl;       // placeholder encrypted URL feature
        euint32 encryptedHeaders;   // placeholder encrypted header feature
        uint256 timestamp;
        address submitter;
    }

    // NOTE: storage layout for decrypted samples
    struct DecryptedSample {
        string url;
        string headers;
        bool revealed;
    }

    // NOTE: model aggregation structure (encrypted)
    struct EncryptedModel {
        bool initialized;
        euint32 aggregatedWeight; // simplified single-weight representation
        uint256 lastUpdated;
    }

    // NOTE: state variables
    mapping(uint256 => EncryptedSample) public encryptedSamples;
    mapping(uint256 => DecryptedSample) public decryptedSamples;
    EncryptedModel public globalModel;

    // NOTE: mapping for decryption request linkage
    mapping(uint256 => uint256) private requestToSample;
    mapping(uint256 => bytes32) private requestToContext;

    // NOTE: events
    event SampleSubmitted(uint256 indexed id, address indexed submitter, uint256 timestamp);
    event SampleDecryptionRequested(uint256 indexed id, uint256 requestId);
    event SampleDecrypted(uint256 indexed id);
    event ModelUpdateSubmitted(address indexed submitter);
    event ModelAggregationRequested(uint256 requestId);
    event ModelWeightsDecrypted(uint256 requestId);

    // NOTE: access modifier placeholder
    modifier onlySubmitter(uint256 sampleId) {
        _;
    }

    // NOTE: submit an encrypted phishing sample
    function submitEncryptedSample(euint32 encryptedUrl, euint32 encryptedHeaders) external {
        sampleCount += 1;
        uint256 newId = sampleCount;

        encryptedSamples[newId] = EncryptedSample({
            id: newId,
            encryptedUrl: encryptedUrl,
            encryptedHeaders: encryptedHeaders,
            timestamp: block.timestamp,
            submitter: msg.sender
        });

        decryptedSamples[newId] = DecryptedSample({
            url: "",
            headers: "",
            revealed: false
        });

        emit SampleSubmitted(newId, msg.sender, block.timestamp);
    }

    // NOTE: request decryption for a specific sample
    function requestSampleDecryption(uint256 sampleId) external onlySubmitter(sampleId) {
        EncryptedSample storage s = encryptedSamples[sampleId];
        DecryptedSample storage d = decryptedSamples[sampleId];
        require(!d.revealed, "Already revealed");

        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(s.encryptedUrl);
        ciphertexts[1] = FHE.toBytes32(s.encryptedHeaders);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptSample.selector);
        requestToSample[reqId] = sampleId;

        emit SampleDecryptionRequested(sampleId, reqId);
    }

    // NOTE: callback invoked after decryption oracle returns cleartexts
    function decryptSample(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        uint256 sampleId = requestToSample[requestId];
        require(sampleId != 0, "Invalid request mapping");

        // NOTE: verify provided proof and signatures
        FHE.checkSignatures(requestId, cleartexts, proof);

        // NOTE: decode decrypted strings
        string[] memory parts = abi.decode(cleartexts, (string[]));
        require(parts.length == 2, "Malformed cleartexts");

        DecryptedSample storage d = decryptedSamples[sampleId];
        d.url = parts[0];
        d.headers = parts[1];
        d.revealed = true;

        emit SampleDecrypted(sampleId);
    }

    // NOTE: submit an encrypted model update (simplified single-weight)
    function submitEncryptedModelUpdate(euint32 encryptedWeight) external {
        // NOTE: on first submission initialize model
        if (!globalModel.initialized) {
            globalModel.initialized = true;
            globalModel.aggregatedWeight = FHE.asEuint32(0);
            globalModel.lastUpdated = block.timestamp;
        }

        // NOTE: aggregate by homomorphic addition
        globalModel.aggregatedWeight = FHE.add(globalModel.aggregatedWeight, encryptedWeight);
        globalModel.lastUpdated = block.timestamp;

        emit ModelUpdateSubmitted(msg.sender);
    }

    // NOTE: request decryption of aggregated model weight
    function requestModelAggregationDecryption() external {
        require(globalModel.initialized, "Model not initialized");

        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(globalModel.aggregatedWeight);

        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptModelWeights.selector);
        // store context for this request
        requestToContext[reqId] = keccak256(abi.encodePacked(block.timestamp, msg.sender));

        emit ModelAggregationRequested(reqId);
    }

    // NOTE: callback for decrypted model weights
    function decryptModelWeights(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        // NOTE: verify proof
        FHE.checkSignatures(requestId, cleartexts, proof);

        // NOTE: decoded weight (uint32) from cleartexts
        uint32 weight = abi.decode(cleartexts, (uint32));

        // NOTE: simple handling — reset aggregated weight to zero after reveal
        if (globalModel.initialized) {
            globalModel.aggregatedWeight = FHE.asEuint32(0);
            globalModel.lastUpdated = block.timestamp;
        }

        emit ModelWeightsDecrypted(requestId);
    }

    // NOTE: helper to read decrypted sample
    function getDecryptedSample(uint256 sampleId) external view returns (string memory url, string memory headers, bool revealed) {
        DecryptedSample storage d = decryptedSamples[sampleId];
        return (d.url, d.headers, d.revealed);
    }

    // NOTE: helper to read encrypted sample metadata
    function getEncryptedSampleMeta(uint256 sampleId) external view returns (uint256 id, uint256 timestamp, address submitter, bool isInitialized) {
        EncryptedSample storage s = encryptedSamples[sampleId];
        return (s.id, s.timestamp, s.submitter, FHE.isInitialized(s.encryptedUrl));
    }
}
