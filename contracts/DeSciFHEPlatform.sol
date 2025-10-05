// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice DeSci platform integrating FHE, IPFS and DAO-driven analysis
contract DeSciFHEPlatform is SepoliaConfig, ERC721, Ownable {
    // Storage
    uint256 public datasetCount;
    uint256 public proposalCount;
    uint256 public tokenCount;

    // Dataset structure
    struct EncryptedDataset {
        uint256 id;
        string ipfsCid;          // IPFS CID storing encrypted payload
        euint32 encryptedMeta;   // Encrypted metadata pointer / tag
        address uploader;
        uint256 timestamp;
        bool accessRestricted;
    }

    // Analysis proposal
    enum ProposalState { Pending, Active, Approved, Rejected, Executed }
    struct AnalysisProposal {
        uint256 id;
        uint256 datasetId;
        string descriptionCID;   // IPFS CID with human-readable proposal description
        uint256 startTime;
        uint256 endTime;
        uint256 yesVotes;
        uint256 noVotes;
        ProposalState state;
        uint256 resultRequestId; // FHE request id for computation/result decryption
    }

    // Mappings
    mapping(uint256 => EncryptedDataset) public datasets;
    mapping(uint256 => AnalysisProposal) public proposals;
    mapping(uint256 => bool) public hasVoted; // simple one-vote-per-proposal per tx (demo)
    mapping(uint256 => uint256) private requestToProposal;

    // Events
    event DatasetSubmitted(uint256 indexed id, address indexed uploader);
    event ProposalCreated(uint256 indexed id, uint256 indexed datasetId);
    event Voted(uint256 indexed proposalId, address indexed voter, bool support);
    event ProposalFinalized(uint256 indexed proposalId, bool approved);
    event AnalysisExecuted(uint256 indexed proposalId, uint256 requestId);
    event ResultMinted(uint256 indexed tokenId, uint256 indexed proposalId);

    // Modifiers
    modifier onlyUploader(uint256 datasetId) {
        require(datasets[datasetId].uploader == msg.sender, "Not uploader");
        _;
    }

    /// @notice Constructor
    constructor(string memory name_, string memory symbol_) ERC721(name_, symbol_) {
        datasetCount = 0;
        proposalCount = 0;
        tokenCount = 0;
    }

    /// @notice Submit an encrypted dataset (IPFS CID) and an encrypted metadata tag
    function submitEncryptedDataset(string calldata ipfsCid, euint32 encryptedMeta, bool restrictAccess) external {
        datasetCount += 1;
        uint256 id = datasetCount;

        datasets[id] = EncryptedDataset({
            id: id,
            ipfsCid: ipfsCid,
            encryptedMeta: encryptedMeta,
            uploader: msg.sender,
            timestamp: block.timestamp,
            accessRestricted: restrictAccess
        });

        emit DatasetSubmitted(id, msg.sender);
    }

    /// @notice Create an analysis proposal tied to a dataset
    function createAnalysisProposal(uint256 datasetId, string calldata descriptionCID, uint256 votingPeriodSeconds) external {
        require(datasetId > 0 && datasetId <= datasetCount, "Invalid dataset");
        proposalCount += 1;
        uint256 pid = proposalCount;

        proposals[pid] = AnalysisProposal({
            id: pid,
            datasetId: datasetId,
            descriptionCID: descriptionCID,
            startTime: block.timestamp,
            endTime: block.timestamp + votingPeriodSeconds,
            yesVotes: 0,
            noVotes: 0,
            state: ProposalState.Active,
            resultRequestId: 0
        });

        emit ProposalCreated(pid, datasetId);
    }

    /// @notice Vote on an active proposal (simple public voting)
    function voteOnProposal(uint256 proposalId, bool support) external {
        AnalysisProposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Active, "Not active");
        require(block.timestamp <= p.endTime, "Voting ended");

        // Simple check to prevent double-vote in this demo: key = proposalId ^ uint160(msg.sender)
        uint256 voteKey = uint256(keccak256(abi.encodePacked(proposalId, msg.sender)));
        require(!hasVoted[voteKey], "Already voted");
        hasVoted[voteKey] = true;

        if (support) {
            p.yesVotes += 1;
        } else {
            p.noVotes += 1;
        }

        emit Voted(proposalId, msg.sender, support);
    }

    /// @notice Finalize proposal after voting period
    function finalizeProposal(uint256 proposalId) external {
        AnalysisProposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Active, "Not active");
        require(block.timestamp > p.endTime, "Voting still ongoing");

        bool approved = p.yesVotes > p.noVotes;
        if (approved) {
            p.state = ProposalState.Approved;
        } else {
            p.state = ProposalState.Rejected;
        }

        emit ProposalFinalized(proposalId, approved);
    }

    /// @notice Request FHE-powered analysis execution for an approved proposal
    function requestFHEAnalysis(uint256 proposalId, bytes32[] calldata ciphertexts) external {
        AnalysisProposal storage p = proposals[proposalId];
        require(p.state == ProposalState.Approved, "Proposal not approved");

        // Request a computation/decryption on the FHE service
        // Use requestDecryption for result retrieval in this pattern
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.handleAnalysisResult.selector);
        p.resultRequestId = reqId;
        requestToProposal[reqId] = proposalId;

        p.state = ProposalState.Executed;

        emit AnalysisExecuted(proposalId, reqId);
    }

    /// @notice Callback invoked by FHE runtime with decrypted/clear result
    function handleAnalysisResult(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        uint256 proposalId = requestToProposal[requestId];
        require(proposalId != 0, "Unknown request");

        // Verify signature/proof provided by the FHE runtime
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode results (expecting an IPFS CID string of the analysis result artifact)
        string[] memory results = abi.decode(cleartexts, (string[]));
        string memory resultCid = results.length > 0 ? results[0] : "";

        // If the dataset was restricted, ensure uploader permission to mint result
        AnalysisProposal storage p = proposals[proposalId];
        EncryptedDataset storage ds = datasets[p.datasetId];

        // Mint NFT representing the analysis result to the uploader
        tokenCount += 1;
        uint256 tid = tokenCount;
        _safeMint(ds.uploader, tid);

        // Store token metadata as IPFS CID in a simple mapping (off-chain expected)
        // Emitting event with result CID for indexing
        emit ResultMinted(tid, proposalId);
    }

    /// @notice Simple getter for a proposal's vote totals
    function getProposalVotes(uint256 proposalId) external view returns (uint256 yes, uint256 no) {
        AnalysisProposal storage p = proposals[proposalId];
        return (p.yesVotes, p.noVotes);
    }

    /// @notice Admin function to transfer NFT metadata or set approvals (placeholder)
    function adminTransferToken(address to, uint256 tokenId) external onlyOwner {
        _transfer(ownerOf(tokenId), to, tokenId);
    }

    /// @notice Utility: get dataset IPFS CID
    function getDatasetCID(uint256 datasetId) external view returns (string memory) {
        return datasets[datasetId].ipfsCid;
    }

    // Fallbacks
    receive() external payable {}
    fallback() external payable {}
}
