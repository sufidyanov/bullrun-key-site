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
  "function totalRounds() view returns (uint256)"
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

async function connectWallet() {
  try {
    if (!window.ethereum) {
      setMessage("MetaMask or Rabby is not installed.", "error");
      return;
    }

    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (parseInt(chainId, 16) !== 1) {
      setMessage("Please switch wallet to Ethereum Mainnet.", "error");
      return;
    }

    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    currentAccount = accounts[0] || "";

    const connectBtn = document.getElementById("connectBtn");
    if (connectBtn && currentAccount) {
      connectBtn.textContent = shortAddress(currentAccount);
    }

    await loadAllData();
  } catch (err) {
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

async function loadAllData() {
  try {
    if (!currentAccount) return;

    setMessage("Loading rewards data...");

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

    setMessage("Scanning your BullRun Keys...");
    const found = await fetchTokenIdsFromAlchemy(currentAccount);
    currentTokenIds = found;

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
    const amount = await rewardContract.claimable(found);

    if (claimableValue) {
      claimableValue.textContent = formatEth(amount) + " ETH";
    }

    setMessage("Wallet connected successfully.", "success");
  } catch (err) {
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

  if (window.ethereum) {
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });

      if (accounts && accounts.length > 0) {
        currentAccount = accounts[0];

        if (connectBtn) {
          connectBtn.textContent = shortAddress(currentAccount);
        }

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

        if (currentAccount) {
          await loadAllData();
        }
      });

      window.ethereum.on("chainChanged", function () {
        window.location.reload();
      });
    } catch (err) {
      setMessage(err.message || "Failed to initialize wallet.", "error");
    }
  }
});
