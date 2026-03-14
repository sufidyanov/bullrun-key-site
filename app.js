const ALCHEMY_API_KEY = "GI1mqa4OtQHFVj00nNs9o";
const REWARD_CONTRACT = "0xb522609cF7f2e8aF1d55Af1B685Cc9f6A159BC4D";
const NFT_CONTRACT = "0x367ac60FB4B2bb8851a46ab7A7FD13654eF70419";
const TREASURY_WALLET = "0x942587ffad5d0bc3e8ed72817ff27ff358e5486d";
const TREASURY_TARGET_ETH = 1;
const OPENSEA_URL = "https://opensea.io/collection/bullrunkey";
const ETHERSCAN_API_KEY = "RAZNXPY4FWGKFQM82I3VYREWRPCUKYMNZP";

const rewardAbi = [
  "function claim(uint256[] calldata tokenIds)",
  "function claimable(uint256[] calldata tokenIds) view returns (uint256)",
  "function totalDeposited() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function totalRounds() view returns (uint256)",
  "function roundInfo(uint256 roundId) view returns (uint256 amountDeposited, uint256 rewardPerToken, uint256 startTime, uint256 expiryTime, uint256 claimedAmount, uint256 remainingAmount, bool reclaimed, bool expired)",
  "event RewardsClaimed(address indexed user, uint256 amount, uint256[] tokenIds)"
];

let currentAccount = "";
let currentTokenIds = [];
let lastTreasuryDepositHash = "";

function formatEth(value) {
  const eth = Number(ethers.formatEther(value));
  return eth.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function shortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}

function setMessage(text, type = "") {
  const el = document.getElementById("message");
  if (!el) return;
  el.className = type ? `notice ${type}` : "";
  el.textContent = text || "";
}

function setWalletStatus(text) {
  const el = document.getElementById("walletStatus");
  if (el) el.textContent = text;
}

function setNftCount(count) {
  const el = document.getElementById("nftCount");
  if (el) el.textContent = String(count);
}

function setClaimButtonState(enabled, text = "Claim Rewards") {
  const btn = document.getElementById("claimBtn");
  if (!btn) return;
  btn.disabled = !enabled;
  btn.textContent = text;
}

function showLiveClaimToast(text) {
  const toast = document.getElementById("liveClaimToast");
  const toastText = document.getElementById("liveClaimToastText");

  if (!toast || !toastText) return;

  toastText.textContent = text;
  toast.style.display = "block";
  toast.style.opacity = "1";
  toast.style.transform = "translateY(0)";

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-6px)";
  }, 3200);

  setTimeout(() => {
    toast.style.display = "none";
  }, 3600);
}

function formatDateFromTimestamp(timestamp) {
  const ms = Number(timestamp) * 1000;
  return new Date(ms).toLocaleDateString();
}

function dedupeTokenIds(tokenIds) {
  return [...new Set(tokenIds)]
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= 333)
    .sort((a, b) => a - b);
}

async function fetchTokenIdsFromAlchemy(ownerAddress) {
  const url =
    `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}/getNFTsForOwner` +
    `?owner=${encodeURIComponent(ownerAddress)}` +
    `&contractAddresses[]=${NFT_CONTRACT}` +
    `&withMetadata=false`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Alchemy request failed.");
  }

  const data = await response.json();
  const nfts = Array.isArray(data.ownedNfts) ? data.ownedNfts : [];

  const tokenIds = nfts
    .map((nft) => {
      const raw = nft.tokenId || nft.id?.tokenId || nft.token_id;
      if (!raw) return null;
      if (typeof raw === "string" && raw.startsWith("0x")) {
        return parseInt(raw, 16);
      }
      const num = Number(raw);
      return Number.isInteger(num) ? num : null;
    })
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= 333);

  return dedupeTokenIds(tokenIds);
}

async function fetchHolderCount() {
  const url =
    `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}/getOwnersForContract` +
    `?contractAddress=${NFT_CONTRACT}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Alchemy holder request failed.");
  }

  const data = await response.json();
  const owners = Array.isArray(data.owners) ? data.owners : [];
  return owners.length;
}

async function loadTreasuryData() {
  try {
    const provider = new ethers.JsonRpcProvider(
      `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
    );

    const balanceWei = await provider.getBalance(TREASURY_WALLET);
    const balanceEth = Number(ethers.formatEther(balanceWei));
    const progress = Math.min((balanceEth / TREASURY_TARGET_ETH) * 100, 100);

    const treasuryBalanceEl = document.getElementById("treasuryBalance");
    const treasuryAddressEl = document.getElementById("treasuryAddress");
    const treasuryTargetEl = document.getElementById("treasuryTarget");
    const treasuryProgressTextEl = document.getElementById("treasuryProgressText");
    const treasuryProgressFillEl = document.getElementById("treasuryProgressFill");

    if (treasuryBalanceEl) {
      treasuryBalanceEl.textContent =
        balanceEth.toLocaleString(undefined, { maximumFractionDigits: 4 }) + " ETH";
    }

    if (treasuryAddressEl) {
      treasuryAddressEl.textContent = shortAddress(TREASURY_WALLET);
    }

    if (treasuryTargetEl) {
      treasuryTargetEl.textContent = TREASURY_TARGET_ETH + " ETH";
    }

    if (treasuryProgressTextEl) {
      treasuryProgressTextEl.textContent =
        balanceEth.toLocaleString(undefined, { maximumFractionDigits: 4 }) +
        " / " +
        TREASURY_TARGET_ETH +
        " ETH";
    }

    if (treasuryProgressFillEl) {
      treasuryProgressFillEl.style.width = `${progress}%`;
    }
  } catch (err) {
    console.error("Treasury load failed", err);
    const treasuryBalanceEl = document.getElementById("treasuryBalance");
    if (treasuryBalanceEl) treasuryBalanceEl.textContent = "Unavailable";
  }
}

async function loadRewardHistory(rewardContract, totalRoundsValue) {
  const list = document.getElementById("rewardHistoryList");
  if (!list) return;

  list.innerHTML = "";

  const roundsCount = Number(totalRoundsValue);
  if (!roundsCount || roundsCount <= 0) {
    list.innerHTML = '<div class="small">No reward rounds yet.</div>';
    return;
  }

  const maxToShow = 5;
  const start = Math.max(0, roundsCount - maxToShow);

  for (let i = roundsCount - 1; i >= start; i--) {
    try {
      const round = await rewardContract.roundInfo(i);

      const amountDeposited = formatEth(round.amountDeposited) + " ETH";
      const startDate = formatDateFromTimestamp(round.startTime);
      const status = round.expired ? "Expired" : "Active";

      const item = document.createElement("div");
      item.className = "history-round-card";
item.style.marginBottom = "12px";

item.innerHTML = `
  <div class="history-round-title">Round #${i + 1}</div>
  <div class="history-round-amount">${amountDeposited}</div>
  <div class="history-round-meta">Started: ${startDate}</div>
  <div class="history-round-meta">Status: ${status}</div>
  <div class="history-round-meta">Claim window: 365 days</div>
`;

      list.appendChild(item);
    } catch (e) {
      // ignore broken round reads
    }
  }
}
function timeAgo(timestampMs) {
  const seconds = Math.floor((Date.now() - timestampMs) / 1000);

  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
async function loadRecentClaims(provider) {
  try {
    const list = document.getElementById("recentClaimsList");
    const countLabel = document.getElementById("recentClaimsCount");
    const footer = document.getElementById("recentClaimsFooter");

    if (!list) return;

    const rewardContract = new ethers.Contract(REWARD_CONTRACT, rewardAbi, provider);
    const filter = rewardContract.filters.RewardsClaimed();

    let events = await rewardContract.queryFilter(filter, -50000);

    // сортируем от новых к старым
    events = events.sort((a, b) => b.blockNumber - a.blockNumber);

    // берём только последние 5
    events = events.slice(0, 5);

    list.innerHTML = "";

    if (!events.length) {
      if (countLabel) countLabel.textContent = "No recent activity";
      if (footer) footer.textContent = "No claims yet. Rewards activity will appear here.";
      list.innerHTML = '<div class="small">No claims yet.</div>';
      return;
    }

    if (countLabel) {
      countLabel.textContent = `${events.length} recent claims`;
    }

    let totalClaimed = 0;

    for (let index = 0; index < events.length; index++) {
      const e = events[index];
      const wallet = e.args.user;
      const amountRaw = e.args.amount;
      const amount = Number(ethers.formatEther(amountRaw)).toFixed(6);
      const amountNumber = Number(amount);
      const short = wallet.slice(0, 6) + "..." + wallet.slice(-4);

      totalClaimed += amountNumber;

      let claimTime = "";
      try {
        const block = await provider.getBlock(e.blockNumber);
        if (block && block.timestamp) {
          claimTime = timeAgo(block.timestamp * 1000);
        }
      } catch (blockErr) {
        console.warn("Failed to load block time for claim", blockErr);
      }

      const item = document.createElement("div");
      item.className = "recent-claim-item";
      item.style.display = "flex";
      item.style.flexWrap = "wrap";
      item.style.alignItems = "center";
      item.style.gap = "8px";
      item.style.padding = "10px 0";
      item.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

      item.innerHTML = `
        <a href="https://etherscan.io/address/${wallet}" target="_blank" rel="noopener noreferrer">${short}</a>
        <span class="recent-claim-meta">claimed</span>
        <strong>${amount} ETH</strong>
        ${claimTime ? `<span class="recent-claim-meta">• ${claimTime}</span>` : ""}
      `;

      list.appendChild(item);

      if (index === 0) {
        setTimeout(() => {
          showLiveClaimToast(`🔥 ${short} claimed ${amount} ETH`);
        }, 800);
      }
    }

    if (footer) {
      footer.textContent = `Total shown claimed: ${totalClaimed.toFixed(6)} ETH`;
    }
 } catch (err) {
  console.error("Claims load failed", err);

  const list = document.getElementById("recentClaimsList");
  if (list) {
    list.innerHTML = `<div class="small" style="color:#ff8a8a">Failed to load recent claims</div>`;
  }
}
}
async function loadRecentTreasuryDeposits() {
  try {
    const url =
      `https://api.etherscan.io/api?module=account&action=txlist` +
      `&address=${TREASURY_WALLET}` +
      `&startblock=0&endblock=99999999&page=1&offset=10&sort=desc` +
      `&apikey=${ETHERSCAN_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) return;

    const data = await response.json();
    if (!data.result || !Array.isArray(data.result)) return;

    const incomingEthTxs = data.result.filter((tx) => {
      return (
        tx.to &&
        tx.to.toLowerCase() === TREASURY_WALLET.toLowerCase() &&
        tx.value &&
        BigInt(tx.value) > 0n
      );
    });

    if (!incomingEthTxs.length) return;

    const latest = incomingEthTxs[0];

    if (!lastTreasuryDepositHash) {
      lastTreasuryDepositHash = latest.hash;
      return;
    }

    if (latest.hash !== lastTreasuryDepositHash) {
      lastTreasuryDepositHash = latest.hash;

      const from = latest.from;
      const short = from.slice(0, 6) + "..." + from.slice(-4);
      const amount = Number(ethers.formatEther(latest.value)).toLocaleString(undefined, {
        maximumFractionDigits: 4
      });

      showLiveClaimToast(`💰 ${short} deposited ${amount} ETH into BullRun Treasury`);

      await loadTreasuryData();
    }
  } catch (err) {
    console.error("Treasury deposits load failed", err);
  }
}
async function connectWallet() {
  try {
    if (!window.ethereum) {
      setMessage("MetaMask or Rabby is not installed.", "error");
      return;
    }

    setWalletStatus("Connecting...");
   setClaimButtonState(false, "Checking rewards...");

    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (parseInt(chainId, 16) !== 1) {
      setWalletStatus("Wrong network");
      setMessage("Please switch wallet to Ethereum Mainnet.", "error");
      return;
    }

    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    currentAccount = accounts[0] || "";

   const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectWallet");

if (connectBtn && currentAccount) {
  connectBtn.textContent = shortAddress(currentAccount);
}

if (disconnectBtn && currentAccount) {
  disconnectBtn.style.display = "inline-block";
}

    setWalletStatus("Connected");
    await loadAllData();
  } catch (err) {
  setWalletStatus("Connected");
  setMessage(err.reason || err.shortMessage || err.message || "Claim failed.", "error");
  await loadAllData();
}
}

async function loadAllData() {
  try {
    if (!currentAccount) return;

    setMessage("Loading rewards data...");
    setWalletStatus("Loading");
    setClaimButtonState(false, "Loading...");

    const provider = new ethers.BrowserProvider(window.ethereum);
    await loadRecentClaims(provider);
    const rewardContract = new ethers.Contract(REWARD_CONTRACT, rewardAbi, provider);

    const [deposited, claimed, rounds, holders] = await Promise.all([
      rewardContract.totalDeposited(),
      rewardContract.totalClaimed(),
      rewardContract.totalRounds(),
      fetchHolderCount()
    ]);

    
    const totalDepositedEl = document.getElementById("totalDeposited");
    const totalClaimedEl = document.getElementById("totalClaimed");
    const totalRoundsEl = document.getElementById("totalRounds");

    if (totalDepositedEl) totalDepositedEl.textContent = formatEth(deposited) + " ETH";
    if (totalClaimedEl) totalClaimedEl.textContent = formatEth(claimed) + " ETH";
    if (totalRoundsEl) totalRoundsEl.textContent = rounds.toString();

    const heroDeposited = document.getElementById("heroDeposited");
    const heroClaimed = document.getElementById("heroClaimed");
    const heroRounds = document.getElementById("heroRounds");
    const heroHolders = document.getElementById("heroHolders");

    if (heroDeposited) heroDeposited.textContent = formatEth(deposited) + " ETH";
    if (heroClaimed) heroClaimed.textContent = formatEth(claimed) + " ETH";
    if (heroRounds) heroRounds.textContent = rounds.toString();
    if (heroHolders) heroHolders.textContent = String(holders);
    const heroSocialProof = document.getElementById("heroSocialProof");
if (heroSocialProof) {
  heroSocialProof.textContent = `${holders} collectors already hold a piece of the cycle.`;
}

    await loadRewardHistory(rewardContract, rounds);

    setMessage("Scanning your BullRun Keys...");
    setWalletStatus("Scanning NFTs");

    const found = await fetchTokenIdsFromAlchemy(currentAccount);
    const uniqueTokenIds = dedupeTokenIds(found);
    currentTokenIds = uniqueTokenIds;
    setNftCount(uniqueTokenIds.length);

    const badges = document.getElementById("tokenBadges");
    const claimableValue = document.getElementById("claimableValue");

    if (badges) badges.innerHTML = "";

    if (uniqueTokenIds.length === 0) {
      if (badges) {
        badges.innerHTML = '<div class="small">No BullRun Key NFTs found on this wallet.</div>';
      }
      if (claimableValue) {
        claimableValue.textContent = "0 ETH";
      }
      setWalletStatus("Connected");
      setClaimButtonState(false, "No BullRun Keys");
      setMessage("Wallet connected, but no BullRun Key NFTs were found.");
      return;
    }

    if (badges) {
      uniqueTokenIds.forEach((id) => {
        const span = document.createElement("span");
        span.className = "badge";
        span.textContent = "#" + id;
        badges.appendChild(span);
      });
    }

    setMessage("Calculating rewards...");
    setWalletStatus("Calculating");

    const amount = await rewardContract.claimable(uniqueTokenIds);

    if (claimableValue) {
      claimableValue.textContent = formatEth(amount) + " ETH";
    }
    if (amount > 0n) {
  setClaimButtonState(true, "Claim " + formatEth(amount) + " ETH");
} else {
  setClaimButtonState(false, "No rewards available");
}

  
    setWalletStatus("Connected");
    setMessage("Wallet connected successfully.", "success");
  } catch (err) {
    setWalletStatus("Error");
    setClaimButtonState(false, "No BullRun Keys");
    setMessage(err.message || "Failed to load data.", "error");
  }
}

async function claimRewards() {
  try {
    if (!window.ethereum) {
      setMessage("MetaMask or Rabby is not installed.", "error");
      return;
    }

    if (!currentAccount) {
      setMessage("Connect wallet first.", "error");
      return;
    }

    const uniqueTokenIds = dedupeTokenIds(currentTokenIds);

    if (uniqueTokenIds.length === 0) {
      setMessage("No BullRun Key NFTs found on this wallet.", "error");
      return;
    }

    setClaimButtonState(false, "Claiming...");
    setWalletStatus("Claiming");
    setMessage("Sending claim transaction... Confirm it in your wallet.");

    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const rewardContract = new ethers.Contract(REWARD_CONTRACT, rewardAbi, signer);

    const tx = await rewardContract.claim(uniqueTokenIds);
    setMessage("Transaction sent. Waiting for confirmation...");

    await tx.wait();

    setMessage("Rewards claimed successfully.", "success");
    setClaimButtonState(false, "Rewards claimed");
    await loadAllData();
  } catch (err) {
    setWalletStatus("Connected");
    await loadAllData();
    setMessage(err.reason || err.shortMessage || err.message || "Claim failed.", "error");
  }
}

window.addEventListener("load", async function () {
  const connectBtn = document.getElementById("connectBtn");
  const claimBtn = document.getElementById("claimBtn");

  if (connectBtn) connectBtn.addEventListener("click", connectWallet);
  if (claimBtn) claimBtn.addEventListener("click", claimRewards);
  const disconnectBtn = document.getElementById("disconnectWallet");
if (disconnectBtn) disconnectBtn.addEventListener("click", disconnectWallet);

  setWalletStatus("Not connected");
  setNftCount(0);
  setClaimButtonState(false, "Connect wallet to check rewards");

  await loadTreasuryData();
  await loadRecentTreasuryDeposits();

setInterval(async () => {
  await loadRecentTreasuryDeposits();
}, 30000);

  if (window.ethereum) {
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });

    if (accounts && accounts.length > 0) {
  currentAccount = accounts[0];

  if (connectBtn) {
    connectBtn.textContent = shortAddress(currentAccount);
  }

  const disconnectBtn = document.getElementById("disconnectWallet");
  if (disconnectBtn) {
    disconnectBtn.style.display = "inline-block";
  }

  setWalletStatus("Connected");
  await loadAllData();
}

      window.ethereum.on("accountsChanged", async function (accountsChanged) {
        currentAccount = accountsChanged[0] || "";
        currentTokenIds = [];

        const tokenBadges = document.getElementById("tokenBadges");
        const claimableValue = document.getElementById("claimableValue");

        if (connectBtn) {
          connectBtn.textContent = currentAccount ? shortAddress(currentAccount) : "Connect Wallet";
        }

        if (tokenBadges) tokenBadges.innerHTML = "";
        if (claimableValue) claimableValue.textContent = "0 ETH";

        setNftCount(0);

        if (currentAccount) {
          setWalletStatus("Connected");
          await loadAllData();
        } else {
          setWalletStatus("Not connected");
          setClaimButtonState(false, "Connect wallet to check rewards");
        }
      });

      window.ethereum.on("chainChanged", function () {
        window.location.reload();
      });
    } catch (err) {
      setWalletStatus("Error");
      setMessage(err.message || "Failed to initialize wallet.", "error");
    }
  }
});
function disconnectWallet() {
  currentAccount = null;
  currentTokenIds = [];

  setWalletStatus("Disconnected");
  setClaimButtonState(false, "Connect wallet to check rewards");
  setNftCount(0);

  const badges = document.getElementById("tokenBadges");
  if (badges) badges.innerHTML = "";

  const claimableValue = document.getElementById("claimableValue");
  if (claimableValue) claimableValue.textContent = "0 ETH";

  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectWallet");

  if (connectBtn) {
    connectBtn.style.display = "inline-block";
    connectBtn.textContent = "Connect Wallet";
  }

  if (disconnectBtn) disconnectBtn.style.display = "none";

  setMessage("Wallet disconnected.");
}
