const ALCHEMY_API_KEY = "GI1mqa4OtQHFVj00nNs9o";
const REWARD_CONTRACT = "0xb522609cF7f2e8aF1d55Af1B685Cc9f6A159BC4D";
const NFT_CONTRACT = "0x367ac60FB4B2bb8851a46ab7A7FD13654eF70419";
const OPENSEA_URL = "https://opensea.io/collection/bullrunkey";
const ETHERSCAN_URL = "https://etherscan.io/address/" + REWARD_CONTRACT;

const rewardAbi = [
  "function claim(uint256[] calldata tokenIds)",
  "function claimable(uint256[] calldata tokenIds) view returns (uint256)",
  "function totalDeposited() view returns (uint256)",
  "function totalClaimed() view returns (uint256)",
  "function totalRounds() view returns (uint256)",
  "function roundInfo(uint256 roundId) view returns (uint256 amountDeposited, uint256 rewardPerToken, uint256 startTime, uint256 expiryTime, uint256 claimedAmount, uint256 remainingAmount, bool reclaimed, bool expired)"
];

let currentAccount = "";
let currentTokenIds = [];

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

async function connectWallet() {
  try {
    if (!window.ethereum) {
      setMessage("MetaMask or Rabby is not installed.", "error");
      return;
    }

    setWalletStatus("Connecting...");
    setClaimButtonState(false, "Claim Rewards");

    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (parseInt(chainId, 16) !== 1) {
      setWalletStatus("Wrong network");
      setMessage("Please switch wallet to Ethereum Mainnet.", "error");
      return;
    }

    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    currentAccount = accounts[0] || "";

    const connectBtn = document.getElementById("connectBtn");
    if (connectBtn && currentAccount) {
      connectBtn.textContent = shortAddress(currentAccount);
    }

    setWalletStatus("Connected");
    await loadAllData();
  } catch (err) {
    setWalletStatus("Connection failed");
    setMessage(err.message || "Wallet connection failed.", "error");
  }
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
    .filter((id) => Number.isInteger(id) && id >= 1 && id <= 333)
    .sort((a, b) => a - b);

  return [...new Set(tokenIds)];
}
function formatDateFromTimestamp(timestamp) {
  const ms = Number(timestamp) * 1000;
  return new Date(ms).toLocaleDateString();
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
      item.className = "stat";
      item.style.marginBottom = "12px";

      item.innerHTML = `
        <div class="stat-label">Round #${i + 1}</div>
        <div class="stat-value">${amountDeposited}</div>
        <div class="small" style="margin-top: 8px;">Started: ${startDate}</div>
        <div class="small">Status: ${status}</div>
        <div class="small">Claim window: 365 days</div>
      `;

      list.appendChild(item);
    } catch (e) {
      // ignore broken round reads
    }
  }
}

async function loadAllData() {
  try {
    if (!currentAccount) return;

    setMessage("Loading rewards data...");
    setWalletStatus("Loading");
    setClaimButtonState(false, "Loading...");

    const provider = new ethers.BrowserProvider(window.ethereum);
    const rewardContract = new ethers.Contract(REWARD_CONTRACT, rewardAbi, provider);

    const [deposited, claimed, rounds] = await Promise.all([
      rewardContract.totalDeposited(),
      rewardContract.totalClaimed(),
      rewardContract.totalRounds()
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

if (heroDeposited) heroDeposited.textContent = formatEth(deposited) + " ETH";
if (heroClaimed) heroClaimed.textContent = formatEth(claimed) + " ETH";
if (heroRounds) heroRounds.textContent = rounds.toString();
    
    await loadRewardHistory(rewardContract, rounds);

    setMessage("Scanning your BullRun Keys...");
    setWalletStatus("Scanning NFTs");

    const found = await fetchTokenIdsFromAlchemy(currentAccount);
    currentTokenIds = found;
    setNftCount(found.length);

    const badges = document.getElementById("tokenBadges");
    const claimableValue = document.getElementById("claimableValue");

    if (badges) badges.innerHTML = "";

    if (found.length === 0) {
      if (badges) {
        badges.innerHTML = '<div class="small">No BullRun Key NFTs found on this wallet.</div>';
      }
      if (claimableValue) {
        claimableValue.textContent = "0 ETH";
      }
      setWalletStatus("Connected");
      setClaimButtonState(false, "Claim Rewards");
      setMessage("Wallet connected, but no BullRun Key NFTs were found.");
      return;
    }

    if (badges) {
      found.forEach((id) => {
        const span = document.createElement("span");
        span.className = "badge";
        span.textContent = "#" + id;
        badges.appendChild(span);
      });
    }

    setMessage("Calculating rewards...");
    setWalletStatus("Calculating");

    const amount = await rewardContract.claimable(found);

    if (claimableValue) {
      claimableValue.textContent = formatEth(amount) + " ETH";
    }

    const canClaim = amount > 0n;
    setClaimButtonState(canClaim, "Claim Rewards");
    setWalletStatus("Connected");
    setMessage("Wallet connected successfully.", "success");
  } catch (err) {
    setWalletStatus("Error");
    setClaimButtonState(false, "Claim Rewards");
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

    if (currentTokenIds.length === 0) {
      setMessage("No BullRun Key NFTs found on this wallet.", "error");
      return;
    }

    setClaimButtonState(false, "Claiming...");
    setWalletStatus("Claiming");
    setMessage("Sending claim transaction... Confirm it in your wallet.");

    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const rewardContract = new ethers.Contract(REWARD_CONTRACT, rewardAbi, signer);

    const tx = await rewardContract.claim(currentTokenIds);
    setMessage("Transaction sent. Waiting for confirmation...");

    await tx.wait();

    setMessage("Rewards claimed successfully.", "success");
    await loadAllData();
  } catch (err) {
    setWalletStatus("Connected");
    setClaimButtonState(true, "Claim Rewards");
    setMessage(err.reason || err.shortMessage || err.message || "Claim failed.", "error");
  }
}

window.addEventListener("load", async function () {
  const openSeaLink = document.getElementById("openSeaLink");
  const openSeaLink2 = document.getElementById("openSeaLink2");
  const contractLink = document.getElementById("contractLink");
  const connectBtn = document.getElementById("connectBtn");
  const claimBtn = document.getElementById("claimBtn");

  if (openSeaLink) openSeaLink.href = OPENSEA_URL;
  if (openSeaLink2) openSeaLink2.href = OPENSEA_URL;
  if (contractLink) contractLink.href = ETHERSCAN_URL;

  if (connectBtn) {
    connectBtn.addEventListener("click", connectWallet);
  }

  if (claimBtn) {
    claimBtn.addEventListener("click", claimRewards);
  }

  setWalletStatus("Not connected");
  setNftCount(0);
  setClaimButtonState(false, "Claim Rewards");

  if (window.ethereum) {
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });

      if (accounts && accounts.length > 0) {
        currentAccount = accounts[0];

        if (connectBtn) {
          connectBtn.textContent = shortAddress(currentAccount);
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
          setClaimButtonState(false, "Claim Rewards");
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
