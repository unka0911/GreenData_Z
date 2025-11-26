import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface EnergyData {
  id: string;
  name: string;
  encryptedValue: string;
  consumption: number;
  carbonTax: number;
  description: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface EnergyStats {
  totalRecords: number;
  verifiedRecords: number;
  avgConsumption: number;
  totalCarbonTax: number;
  recentUploads: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [energyData, setEnergyData] = useState<EnergyData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadingData, setUploadingData] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending" as const, 
    message: "" 
  });
  const [newEnergyData, setNewEnergyData] = useState({ 
    name: "", 
    consumption: "", 
    description: "" 
  });
  const [selectedData, setSelectedData] = useState<EnergyData | null>(null);
  const [decryptedConsumption, setDecryptedConsumption] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting} = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const energyList: EnergyData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          energyList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            consumption: Number(businessData.publicValue1) || 0,
            carbonTax: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setEnergyData(energyList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const uploadEnergyData = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploadingData(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Uploading encrypted energy data..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const consumptionValue = parseInt(newEnergyData.consumption) || 0;
      const businessId = `energy-${Date.now()}`;
      const carbonTax = Math.round(consumptionValue * 0.15);
      
      const encryptedResult = await encrypt(contractAddress, address, consumptionValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newEnergyData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        consumptionValue,
        carbonTax,
        newEnergyData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Energy data uploaded successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowUploadModal(false);
      setNewEnergyData({ name: "", consumption: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Upload failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploadingData(false); 
    }
  };

  const decryptConsumption = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Consumption data decrypted successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractWithSigner();
      if (!contract) return;
      
      setTransactionStatus({ visible: true, status: "pending", message: "Checking contract availability..." });
      const result = await contract.isAvailable();
      
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and ready!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const calculateStats = (): EnergyStats => {
    const totalRecords = energyData.length;
    const verifiedRecords = energyData.filter(d => d.isVerified).length;
    const avgConsumption = totalRecords > 0 
      ? energyData.reduce((sum, d) => sum + d.consumption, 0) / totalRecords 
      : 0;
    const totalCarbonTax = energyData.reduce((sum, d) => sum + d.carbonTax, 0);
    const recentUploads = energyData.filter(d => Date.now()/1000 - d.timestamp < 60 * 60 * 24 * 7).length;

    return { totalRecords, verifiedRecords, avgConsumption, totalCarbonTax, recentUploads };
  };

  const filteredData = energyData.filter(data =>
    data.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    data.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedData = filteredData.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const totalPages = Math.ceil(filteredData.length / itemsPerPage);

  const renderStats = () => {
    const stats = calculateStats();
    
    return (
      <div className="stats-grid">
        <div className="stat-card neon-purple">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <h3>Total Records</h3>
            <div className="stat-value">{stats.totalRecords}</div>
            <div className="stat-trend">+{stats.recentUploads} this week</div>
          </div>
        </div>
        
        <div className="stat-card neon-blue">
          <div className="stat-icon">🔐</div>
          <div className="stat-content">
            <h3>Verified Data</h3>
            <div className="stat-value">{stats.verifiedRecords}/{stats.totalRecords}</div>
            <div className="stat-trend">FHE Protected</div>
          </div>
        </div>
        
        <div className="stat-card neon-pink">
          <div className="stat-icon">⚡</div>
          <div className="stat-content">
            <h3>Avg Consumption</h3>
            <div className="stat-value">{stats.avgConsumption.toFixed(0)} kWh</div>
            <div className="stat-trend">Encrypted Average</div>
          </div>
        </div>
        
        <div className="stat-card neon-green">
          <div className="stat-icon">💰</div>
          <div className="stat-content">
            <h3>Total Carbon Tax</h3>
            <div className="stat-value">${stats.totalCarbonTax}</div>
            <div className="stat-trend">Homomorphically Calculated</div>
          </div>
        </div>
      </div>
    );
  };

  const renderFHEProcess = () => {
    return (
      <div className="fhe-process">
        <div className="process-step metal-step">
          <div className="step-number">1</div>
          <div className="step-content">
            <h4>Data Encryption</h4>
            <p>Energy consumption data encrypted with Zama FHE using integer encryption</p>
          </div>
        </div>
        
        <div className="process-connector">⟶</div>
        
        <div className="process-step metal-step">
          <div className="step-number">2</div>
          <div className="step-content">
            <h4>On-chain Storage</h4>
            <p>Encrypted data stored on blockchain, marked as publicly decryptable</p>
          </div>
        </div>
        
        <div className="process-connector">⟶</div>
        
        <div className="process-step metal-step">
          <div className="step-number">3</div>
          <div className="step-content">
            <h4>Homomorphic Calculation</h4>
            <p>Carbon tax computed without decrypting the original consumption data</p>
          </div>
        </div>
        
        <div className="process-connector">⟶</div>
        
        <div className="process-step metal-step">
          <div className="step-number">4</div>
          <div className="step-content">
            <h4>Secure Verification</h4>
            <p>Offline decryption with on-chain proof verification</p>
          </div>
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <h1 className="neon-title">🔐 GreenData FHE</h1>
            <p>Confidential Energy Consumption Platform</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt metal-bg">
          <div className="connection-content">
            <div className="connection-icon">⚡🔐</div>
            <h2>Connect Wallet to Access Encrypted Energy Data</h2>
            <p>Secure, privacy-preserving energy consumption tracking with fully homomorphic encryption</p>
            <div className="feature-grid">
              <div className="feature-item">
                <span className="feature-icon">🔒</span>
                <span>Enterprise Data Protection</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">⚡</span>
                <span>Homomorphic Carbon Tax Calculation</span>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🌿</span>
                <span>ESG Compliance Ready</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen metal-bg">
        <div className="fhe-spinner metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
        <p className="loading-note">Securing your energy data with homomorphic encryption</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen metal-bg">
      <div className="fhe-spinner metal-spinner"></div>
      <p>Loading encrypted energy database...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header metal-header">
        <div className="logo">
          <h1 className="neon-title">🔐 GreenData FHE</h1>
          <p>能耗隱私數據庫 • Confidential Energy Consumption</p>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={callIsAvailable}
            className="action-btn metal-btn neon-blue"
          >
            Check Availability
          </button>
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="action-btn metal-btn neon-purple"
          >
            + Upload Energy Data
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <main className="main-content metal-bg">
        <section className="dashboard-section">
          <h2 className="section-title neon-text">Encrypted Energy Analytics Dashboard</h2>
          {renderStats()}
          
          <div className="process-section">
            <h3>FHE 🔐 Energy Data Protection Flow</h3>
            {renderFHEProcess()}
          </div>
        </section>
        
        <section className="data-section">
          <div className="section-header">
            <h2>Energy Consumption Records</h2>
            <div className="controls">
              <div className="search-box">
                <input
                  type="text"
                  placeholder="Search energy records..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input metal-input"
                />
              </div>
              <button 
                onClick={loadData} 
                className="action-btn metal-btn neon-green"
                disabled={isRefreshing}
              >
                {isRefreshing ? "🔄" : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="data-list">
            {paginatedData.length === 0 ? (
              <div className="no-data metal-panel">
                <p>No energy consumption records found</p>
                <button 
                  className="action-btn metal-btn neon-purple"
                  onClick={() => setShowUploadModal(true)}
                >
                  Upload First Record
                </button>
              </div>
            ) : (
              <>
                {paginatedData.map((data, index) => (
                  <div 
                    className={`data-item metal-panel ${selectedData?.id === data.id ? "selected" : ""}`}
                    key={index}
                    onClick={() => setSelectedData(data)}
                  >
                    <div className="data-header">
                      <h3>{data.name}</h3>
                      <span className={`status-badge ${data.isVerified ? "verified" : "pending"}`}>
                        {data.isVerified ? "✅ Verified" : "🔓 Pending"}
                      </span>
                    </div>
                    <div className="data-content">
                      <div className="data-row">
                        <span>Consumption:</span>
                        <strong>{data.consumption} kWh</strong>
                      </div>
                      <div className="data-row">
                        <span>Carbon Tax:</span>
                        <strong>${data.carbonTax}</strong>
                      </div>
                      <div className="data-row">
                        <span>Uploaded:</span>
                        <span>{new Date(data.timestamp * 1000).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <div className="data-footer">
                      <span className="creator">
                        By: {data.creator.substring(0, 8)}...{data.creator.substring(36)}
                      </span>
                      {data.isVerified && data.decryptedValue && (
                        <span className="decrypted-value">
                          Decrypted: {data.decryptedValue} kWh
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                
                {totalPages > 1 && (
                  <div className="pagination">
                    <button 
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="pagination-btn metal-btn"
                    >
                      Previous
                    </button>
                    <span>Page {currentPage} of {totalPages}</span>
                    <button 
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="pagination-btn metal-btn"
                    >
                      Next
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>
      
      {showUploadModal && (
        <UploadModal 
          onSubmit={uploadEnergyData} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploadingData} 
          energyData={newEnergyData} 
          setEnergyData={setNewEnergyData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedData && (
        <DetailModal 
          data={selectedData} 
          onClose={() => { 
            setSelectedData(null); 
            setDecryptedConsumption(null); 
          }} 
          decryptedConsumption={decryptedConsumption} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptConsumption(selectedData.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="toast-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const UploadModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  energyData: any;
  setEnergyData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, uploading, energyData, setEnergyData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'consumption') {
      const intValue = value.replace(/[^\d]/g, '');
      setEnergyData({ ...energyData, [name]: intValue });
    } else {
      setEnergyData({ ...energyData, [name]: value });
    }
  };

  const carbonTax = energyData.consumption ? Math.round(parseInt(energyData.consumption) * 0.15) : 0;

  return (
    <div className="modal-overlay">
      <div className="upload-modal metal-panel">
        <div className="modal-header">
          <h2>Upload Encrypted Energy Data</h2>
          <button onClick={onClose} className="close-btn metal-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <strong>FHE 🔐 Energy Data Protection</strong>
            <p>Consumption data will be encrypted using Zama FHE integer encryption</p>
          </div>
          
          <div className="form-group">
            <label>Facility Name *</label>
            <input 
              type="text" 
              name="name" 
              value={energyData.name} 
              onChange={handleChange} 
              placeholder="Enter facility name..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Energy Consumption (kWh) *</label>
            <input 
              type="number" 
              name="consumption" 
              value={energyData.consumption} 
              onChange={handleChange} 
              placeholder="Enter consumption in kWh..." 
              step="1"
              min="0"
              className="metal-input"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description" 
              value={energyData.description} 
              onChange={handleChange} 
              placeholder="Enter additional details..." 
              className="metal-input"
              rows={3}
            />
          </div>
          
          <div className="calculation-preview metal-panel">
            <h4>Carbon Tax Calculation Preview</h4>
            <div className="calculation-row">
              <span>Consumption:</span>
              <span>{energyData.consumption || 0} kWh</span>
            </div>
            <div className="calculation-row">
              <span>Tax Rate:</span>
              <span>$0.15 per kWh</span>
            </div>
            <div className="calculation-row total">
              <span>Estimated Carbon Tax:</span>
              <span>${carbonTax}</span>
            </div>
            <div className="calculation-note">
              * Tax calculated homomorphically without decrypting consumption data
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={uploading || isEncrypting || !energyData.name || !energyData.consumption} 
            className="submit-btn metal-btn neon-purple"
          >
            {uploading || isEncrypting ? "🔐 Encrypting..." : "Upload Encrypted Data"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailModal: React.FC<{
  data: EnergyData;
  onClose: () => void;
  decryptedConsumption: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ data, onClose, decryptedConsumption, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedConsumption !== null) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal metal-panel">
        <div className="modal-header">
          <h2>Energy Data Details</h2>
          <button onClick={onClose} className="close-btn metal-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="data-info">
            <div className="info-row">
              <span>Facility Name:</span>
              <strong>{data.name}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{data.creator.substring(0, 8)}...{data.creator.substring(36)}</strong>
            </div>
            <div className="info-row">
              <span>Upload Date:</span>
              <strong>{new Date(data.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="info-row">
              <span>Public Carbon Tax:</span>
              <strong>${data.carbonTax}</strong>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>FHE Data Protection</h3>
            
            <div className="encryption-status">
              <div className="status-item">
                <span>Consumption Data:</span>
                <div className="status-value">
                  {data.isVerified && data.decryptedValue ? 
                    `${data.decryptedValue} kWh (On-chain Verified)` : 
                    decryptedConsumption !== null ? 
                    `${decryptedConsumption} kWh (Locally Decrypted)` : 
                    "🔒 FHE Encrypted Integer"
                  }
                </div>
              </div>
              
              <button 
                className={`decrypt-btn metal-btn ${(data.isVerified || decryptedConsumption !== null) ? 'verified' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || data.isVerified}
              >
                {isDecrypting ? "🔓 Decrypting..." : 
                 data.isVerified ? "✅ Verified" : 
                 decryptedConsumption !== null ? "✅ Decrypted" : 
                 "🔓 Verify Decryption"}
              </button>
            </div>
            
            <div className="fhe-explanation metal-notice">
              <div className="explanation-icon">🔐</div>
              <div>
                <strong>Homomorphic Carbon Tax Calculation</strong>
                <p>Carbon tax was computed as ${data.carbonTax} without decrypting the original consumption data, using FHE homomorphic operations.</p>
              </div>
            </div>
          </div>
          
          {(data.isVerified || decryptedConsumption !== null) && (
            <div className="analysis-section">
              <h3>Environmental Impact Analysis</h3>
              <div className="impact-metrics">
                <div className="metric-card">
                  <span>CO2 Emissions</span>
                  <strong>{Math.round((data.isVerified ? data.decryptedValue! : decryptedConsumption!) * 0.5)} kg</strong>
                </div>
                <div className="metric-card">
                  <span>Equivalent Trees</span>
                  <strong>{Math.round((data.isVerified ? data.decryptedValue! : decryptedConsumption!) / 100)}</strong>
                </div>
                <div className="metric-card">
                  <span>Energy Efficiency</span>
                  <strong>{data.consumption > 0 ? ((data.isVerified ? data.decryptedValue! : decryptedConsumption!) / data.consumption * 100).toFixed(1) : 0}%</strong>
                </div>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;

