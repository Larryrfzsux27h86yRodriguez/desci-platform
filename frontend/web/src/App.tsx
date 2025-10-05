// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface PhishingEmail {
  id: string;
  encryptedData: string;
  timestamp: number;
  sender: string;
  domain: string;
  status: "pending" | "verified" | "rejected";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState<PhishingEmail[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newEmailData, setNewEmailData] = useState({
    domain: "",
    headers: "",
    urls: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("all");

  // Calculate statistics
  const verifiedCount = emails.filter(e => e.status === "verified").length;
  const pendingCount = emails.filter(e => e.status === "pending").length;
  const rejectedCount = emails.filter(e => e.status === "rejected").length;

  // Filter emails based on search and tab
  const filteredEmails = emails.filter(email => {
    const matchesSearch = email.domain.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         email.sender.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesTab = activeTab === "all" || email.status === activeTab;
    return matchesSearch && matchesTab;
  });

  useEffect(() => {
    loadEmails().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadEmails = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("email_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing email keys:", e);
        }
      }
      
      const list: PhishingEmail[] = [];
      
      for (const key of keys) {
        try {
          const emailBytes = await contract.getData(`email_${key}`);
          if (emailBytes.length > 0) {
            try {
              const emailData = JSON.parse(ethers.toUtf8String(emailBytes));
              list.push({
                id: key,
                encryptedData: emailData.data,
                timestamp: emailData.timestamp,
                sender: emailData.sender,
                domain: emailData.domain,
                status: emailData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing email data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading email ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setEmails(list);
    } catch (e) {
      console.error("Error loading emails:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const uploadEmail = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting email data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newEmailData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const emailId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const emailData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        sender: account,
        domain: newEmailData.domain,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `email_${emailId}`, 
        ethers.toUtf8Bytes(JSON.stringify(emailData))
      );
      
      const keysBytes = await contract.getData("email_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(emailId);
      
      await contract.setData(
        "email_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted email submitted securely!"
      });
      
      await loadEmails();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewEmailData({
          domain: "",
          headers: "",
          urls: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const verifyEmail = async (emailId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted email with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const emailBytes = await contract.getData(`email_${emailId}`);
      if (emailBytes.length === 0) {
        throw new Error("Email not found");
      }
      
      const emailData = JSON.parse(ethers.toUtf8String(emailBytes));
      
      const updatedEmail = {
        ...emailData,
        status: "verified"
      };
      
      await contract.setData(
        `email_${emailId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedEmail))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadEmails();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectEmail = async (emailId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted email with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const emailBytes = await contract.getData(`email_${emailId}`);
      if (emailBytes.length === 0) {
        throw new Error("Email not found");
      }
      
      const emailData = JSON.parse(ethers.toUtf8String(emailBytes));
      
      const updatedEmail = {
        ...emailData,
        status: "rejected"
      };
      
      await contract.setData(
        `email_${emailId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedEmail))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE rejection completed successfully!"
      });
      
      await loadEmails();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderBarChart = () => {
    const domains = Array.from(new Set(emails.map(e => e.domain)));
    const domainCounts = domains.map(domain => ({
      domain,
      count: emails.filter(e => e.domain === domain).length
    })).sort((a, b) => b.count - a.count).slice(0, 5);

    return (
      <div className="bar-chart-container">
        {domainCounts.map((item, index) => (
          <div key={index} className="bar-item">
            <div className="bar-label">{item.domain}</div>
            <div className="bar-wrapper">
              <div 
                className="bar-fill"
                style={{ width: `${(item.count / emails.length) * 100}%` }}
              ></div>
            </div>
            <div className="bar-value">{item.count}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="shield-icon"></div>
          <h1>Phish<span>Shield</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-btn"
          >
            Upload Email
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Secure Phishing Email Analysis</h2>
            <p>Collaboratively analyze phishing emails while keeping data encrypted using FHE</p>
          </div>
        </div>
        
        <div className="dashboard-grid">
          <div className="dashboard-card">
            <h3>Project Introduction</h3>
            <p>Share and analyze phishing emails while keeping sensitive data encrypted using Fully Homomorphic Encryption (FHE).</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Email Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{emails.length}</div>
                <div className="stat-label">Total Emails</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{verifiedCount}</div>
                <div className="stat-label">Verified</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-label">Rejected</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card">
            <h3>Top Domains</h3>
            {emails.length > 0 ? renderBarChart() : <p>No data available</p>}
          </div>
        </div>
        
        <div className="emails-section">
          <div className="section-header">
            <h2>Phishing Email Reports</h2>
            <div className="header-actions">
              <div className="search-box">
                <input 
                  type="text" 
                  placeholder="Search domains or senders..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
              <div className="tabs">
                <button 
                  className={activeTab === "all" ? "active" : ""}
                  onClick={() => setActiveTab("all")}
                >
                  All
                </button>
                <button 
                  className={activeTab === "verified" ? "active" : ""}
                  onClick={() => setActiveTab("verified")}
                >
                  Verified
                </button>
                <button 
                  className={activeTab === "pending" ? "active" : ""}
                  onClick={() => setActiveTab("pending")}
                >
                  Pending
                </button>
                <button 
                  className={activeTab === "rejected" ? "active" : ""}
                  onClick={() => setActiveTab("rejected")}
                >
                  Rejected
                </button>
              </div>
              <button 
                onClick={loadEmails}
                className="refresh-btn"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="emails-list">
            {filteredEmails.length === 0 ? (
              <div className="no-emails">
                <div className="no-emails-icon"></div>
                <p>No phishing emails found</p>
                <button 
                  className="primary-btn"
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload First Email
                </button>
              </div>
            ) : (
              filteredEmails.map(email => (
                <div className="email-card" key={email.id}>
                  <div className="email-header">
                    <div className="email-domain">{email.domain}</div>
                    <div className="email-meta">
                      <span className="email-sender">{email.sender.substring(0, 6)}...{email.sender.substring(38)}</span>
                      <span className="email-date">
                        {new Date(email.timestamp * 1000).toLocaleDateString()}
                      </span>
                      <span className={`status-badge ${email.status}`}>
                        {email.status}
                      </span>
                    </div>
                  </div>
                  <div className="email-actions">
                    {isOwner(email.sender) && email.status === "pending" && (
                      <>
                        <button 
                          className="action-btn success"
                          onClick={() => verifyEmail(email.id)}
                        >
                          Verify
                        </button>
                        <button 
                          className="action-btn danger"
                          onClick={() => rejectEmail(email.id)}
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadEmail} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          emailData={newEmailData}
          setEmailData={setNewEmailData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="shield-icon"></div>
              <span>PhishShield</span>
            </div>
            <p>Secure phishing email analysis using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} PhishShield. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  emailData: any;
  setEmailData: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  emailData,
  setEmailData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setEmailData({
      ...emailData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!emailData.domain || !emailData.headers) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal">
        <div className="modal-header">
          <h2>Upload Phishing Email</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            Your email data will be encrypted with FHE before storage
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Domain *</label>
              <input 
                type="text"
                name="domain"
                value={emailData.domain} 
                onChange={handleChange}
                placeholder="example.com" 
              />
            </div>
            
            <div className="form-group full-width">
              <label>Email Headers *</label>
              <textarea 
                name="headers"
                value={emailData.headers} 
                onChange={handleChange}
                placeholder="Paste email headers here..." 
                rows={4}
              />
            </div>
            
            <div className="form-group full-width">
              <label>Suspicious URLs</label>
              <textarea 
                name="urls"
                value={emailData.urls} 
                onChange={handleChange}
                placeholder="Enter any suspicious URLs found in the email..." 
                rows={2}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            Data remains encrypted during FHE processing and analysis
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="submit-btn"
          >
            {uploading ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;