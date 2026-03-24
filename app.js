const ALCHEMY_API_KEY = "GI1mqa4OtQHFVj00nNs9o";
const REWARD_CONTRACT = "0xb522609cF7f2e8aF1d55Af1B685Cc9f6A159BC4D";
const NFT_CONTRACT = "0x367ac60FB4B2bb8851a46ab7A7FD13654eF70419";
const TREASURY_WALLET = "0x942587ffad5d0bc3e8ed72817ff27ff358e5486d";
const TREASURY_TARGET_ETH = 1;
const OPENSEA_URL = "https://opensea.io/collection/bullrunkey";
const ETHERSCAN_API_KEY = "RAZNXPY4FWGKFQM82I3VYREWRPCUKYMNZP";
const TREASURY_VAULT_CONTRACTS = [
  "0x367ac60FB4B2bb8851a46ab7A7FD13654eF70419".toLowerCase(), // BullRun Key contract
  "0xbe9371326f91345777b04394448c23e2bfeaa826".toLowerCase()  // если хочешь ещё одну коллекцию
];
const ENS_PROVIDER = new ethers.JsonRpcProvider(
  `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`
);

const ENS_CACHE = new Map();

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
async function getEnsName(address) {
  try {
    const normalized = address.toLowerCase();

    if (ENS_CACHE.has(normalized)) {
      return ENS_CACHE.get(normalized);
    }

    const ensName = await ENS_PROVIDER.lookupAddress(address);

    ENS_CACHE.set(normalized, ensName || null);
    return ensName || null;
  } catch (err) {
    console.warn("ENS lookup failed for", address, err);
    return null;
  }
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
    const cycleStateTextEl = document.getElementById("cycleStateText");
const revealStateTextEl = document.getElementById("revealStateText");
const revealNoteEl = document.getElementById("revealNote");
const systemStateEl = document.getElementById("systemState");
    const nextRoundStatusEl = document.getElementById("nextRoundStatus");
const nextRoundTimingEl = document.getElementById("nextRoundTiming");
const roundIntroEl = document.getElementById("roundIntro");
const roundNoteEl = document.getElementById("roundNote");
    if (nextRoundStatusEl) {
  nextRoundStatusEl.classList.remove("is-forming", "is-building", "is-approaching", "is-ready");
}

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
    if (treasuryProgressFillEl) {
  treasuryProgressFillEl.classList.remove("is-warming", "is-hot", "is-triggered");
}

if (systemStateEl) {
  systemStateEl.classList.remove("is-hot", "is-triggered");
}

if (balanceEth >= 1) {
  if (cycleStateTextEl) {
    cycleStateTextEl.textContent = "Cycle: Threshold Reached";
  }
if (nextRoundStatusEl) {
  nextRoundStatusEl.classList.add("is-ready");
}
  if (revealStateTextEl) {
    revealStateTextEl.textContent = "Reveal: Trigger unlocked";
  }

  if (revealNoteEl) {
    revealNoteEl.innerHTML = `
      The first trigger has been reached.<br>
      The system is ready to transition.
    `;
  }

  if (treasuryProgressFillEl) {
    treasuryProgressFillEl.classList.add("is-triggered");
  }

  if (systemStateEl) {
    systemStateEl.classList.add("is-triggered");
  }
  if (nextRoundStatusEl) {
  nextRoundStatusEl.textContent = "Ready";
}

if (nextRoundTimingEl) {
  nextRoundTimingEl.textContent = "1 ETH";
}

if (roundIntroEl) {
  roundIntroEl.innerHTML = `
    Reward Round #1 is now unlocked by the first cycle threshold.<br>
    Treasury trigger: reached.
  `;
}

if (roundNoteEl) {
  roundNoteEl.textContent = "The first system-wide distribution is now ready to activate.";
}
} else if (balanceEth >= 0.8) {
  if (cycleStateTextEl) {
    cycleStateTextEl.textContent = "Cycle: Reveal Approaching";
  }
if (nextRoundStatusEl) {
  nextRoundStatusEl.classList.add("is-approaching");
}
  if (revealStateTextEl) {
    revealStateTextEl.textContent = "Reveal: Signal pressure increasing";
  }

  if (revealNoteEl) {
    revealNoteEl.innerHTML = `
      The first trigger is close.<br>
      System tension is rising.
    `;
  }

  if (treasuryProgressFillEl) {
    treasuryProgressFillEl.classList.add("is-hot");
  }

  if (systemStateEl) {
    systemStateEl.classList.add("is-hot");
  }
  if (nextRoundStatusEl) {
  nextRoundStatusEl.textContent = "Approaching";
}

if (nextRoundTimingEl) {
  nextRoundTimingEl.textContent = `${balanceEth.toLocaleString(undefined, { maximumFractionDigits: 4 })} / 1 ETH`;
}

if (roundIntroEl) {
  roundIntroEl.innerHTML = `
    Reward Round #1 is approaching activation.<br>
    The treasury is nearing its first trigger.
  `;
}

if (roundNoteEl) {
  roundNoteEl.textContent = "The first distribution layer is close to forming.";
}
} else if (balanceEth >= 0.5) {
  if (cycleStateTextEl) {
    cycleStateTextEl.textContent = "Cycle: Threshold Forming";
  }
if (nextRoundStatusEl) {
  nextRoundStatusEl.classList.add("is-building");
}
  if (revealStateTextEl) {
    revealStateTextEl.textContent = "Reveal: Locked, but drawing closer";
  }

  if (revealNoteEl) {
    revealNoteEl.innerHTML = `
      The first trigger is forming.<br>
      Positioning pressure is building.
    `;
  }

  if (treasuryProgressFillEl) {
    treasuryProgressFillEl.classList.add("is-warming");
  }
  if (nextRoundStatusEl) {
  nextRoundStatusEl.textContent = "Building";
}

if (nextRoundTimingEl) {
  nextRoundTimingEl.textContent = `${balanceEth.toLocaleString(undefined, { maximumFractionDigits: 4 })} / 1 ETH`;
}

if (roundIntroEl) {
  roundIntroEl.innerHTML = `
    Reward Round #1 is forming inside the treasury.<br>
    The first trigger is beginning to take shape.
  `;
}

if (roundNoteEl) {
  roundNoteEl.textContent = "Treasury pressure is building toward the first round.";
}
} else {
  if (cycleStateTextEl) {
    cycleStateTextEl.textContent = "Cycle: Accumulating Signals";
  }
if (nextRoundStatusEl) {
  nextRoundStatusEl.classList.add("is-forming");
}
  if (revealStateTextEl) {
    revealStateTextEl.textContent = "Reveal: Locked (1 ETH threshold)";
  }
  if (nextRoundStatusEl) {
  nextRoundStatusEl.textContent = "Forming";
}

if (nextRoundTimingEl) {
  nextRoundTimingEl.textContent = "Pending";
}

if (roundIntroEl) {
  roundIntroEl.innerHTML = `
    The first cycle threshold activates Reward Round #1.<br>
    Threshold: 1 ETH in treasury.
  `;
}

if (roundNoteEl) {
  roundNoteEl.textContent = "The first round is still forming inside the treasury.";
}

  if (revealNoteEl) {
    revealNoteEl.innerHTML = `
      1 ETH is not a goal.<br>
      It is the first trigger.
    `;
  }
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

let claimEvents = await rewardContract.queryFilter(filter, -50000);
claimEvents = claimEvents.sort((a, b) => b.blockNumber - a.blockNumber);

const activityItems = [];

// claims
for (const e of claimEvents.slice(0, 5)) {
  let claimTime = "";
  let timestampMs = 0;

  try {
    const block = await provider.getBlock(e.blockNumber);
    if (block && block.timestamp) {
      timestampMs = block.timestamp * 1000;
      claimTime = timeAgo(timestampMs);
    }
  } catch (blockErr) {
    console.warn("Failed to load block time for claim", blockErr);
  }

  const wallet = e.args.user;
  const amountRaw = e.args.amount;
  const tokenIds = e.args.tokenIds || [];

  let keyLabel = "Key";
  if (tokenIds.length === 1) {
    keyLabel = `Key #${tokenIds[0].toString()}`;
  } else if (tokenIds.length > 1) {
    keyLabel = `${tokenIds.length} Keys`;
  }

  activityItems.push({
    type: "claim",
    wallet,
    short: shortAddress(wallet),
    amount: Number(ethers.formatEther(amountRaw)),
    label: keyLabel,
    timestampMs
  });
}

// treasury signals
try {
  const treasuryUrl =
    `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist` +
    `&address=${TREASURY_WALLET}` +
    `&startblock=0&endblock=99999999&page=1&offset=10&sort=desc` +
    `&apikey=${ETHERSCAN_API_KEY}`;

  const treasuryResponse = await fetch(treasuryUrl);
  if (treasuryResponse.ok) {
    const treasuryData = await treasuryResponse.json();

    if (treasuryData && Array.isArray(treasuryData.result)) {
      const incomingSignals = treasuryData.result.filter((tx) => {
        return (
          tx.to &&
          tx.to.toLowerCase() === TREASURY_WALLET.toLowerCase() &&
          tx.value &&
          BigInt(tx.value) > 0n &&
          tx.isError === "0"
        );
      });

      for (const tx of incomingSignals.slice(0, 5)) {
        const timestampMs = Number(tx.timeStamp) * 1000;

        activityItems.push({
          type: "signal",
          wallet: tx.from,
          short: shortAddress(tx.from),
          amount: Number(ethers.formatEther(tx.value)),
          label: "Treasury Signal",
          timestampMs
        });
      }
    }
  }
} catch (signalErr) {
  console.warn("Failed to load treasury signals for activity", signalErr);
}

activityItems.sort((a, b) => b.timestampMs - a.timestampMs);
const recentItems = activityItems.slice(0, 5);

list.innerHTML = "";

    if (!recentItems.length) {
      if (countLabel) countLabel.textContent = "No recent activity";
      if (footer) footer.textContent = "No recent system activity yet.";
      list.innerHTML = '<div class="small">No claims yet.</div>';
      return;
    }

    if (countLabel) {
      countLabel.textContent = `${recentItems.length} recent events`;
    }

    let totalClaimed = 0;

    let totalShown = 0;

for (let index = 0; index < recentItems.length; index++) {
  const itemData = recentItems[index];
  totalShown += itemData.amount;

  const activityTime = itemData.timestampMs ? timeAgo(itemData.timestampMs) : "";

  const item = document.createElement("div");
  item.className = "recent-claim-item";
  item.style.display = "flex";
  item.style.flexWrap = "wrap";
  item.style.alignItems = "center";
  item.style.gap = "8px";
  item.style.padding = "10px 0";
  item.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

  if (itemData.type === "claim") {
    item.innerHTML = `
      <span class="recent-claim-meta" style="opacity:0.8">${itemData.label}</span>
      <span class="recent-claim-meta">•</span>
      <a href="https://etherscan.io/address/${itemData.wallet}" target="_blank" rel="noopener noreferrer">${itemData.short}</a>
      <span class="recent-claim-meta">extracted</span>
      <strong>${itemData.amount.toFixed(6)} ETH</strong>
      ${activityTime ? `<span class="recent-claim-meta">• ${activityTime}</span>` : ""}
    `;
  } else {
    item.innerHTML = `
      <span class="recent-claim-meta" style="opacity:0.8">${itemData.label}</span>
      <span class="recent-claim-meta">•</span>
      <a href="https://etherscan.io/address/${itemData.wallet}" target="_blank" rel="noopener noreferrer">${itemData.short}</a>
      <span class="recent-claim-meta">submitted</span>
      <strong>${itemData.amount.toFixed(4)} ETH</strong>
      ${activityTime ? `<span class="recent-claim-meta">• ${activityTime}</span>` : ""}
    `;
  }

  list.appendChild(item);

  if (index === 0) {
    setTimeout(() => {
      if (itemData.type === "claim") {
        showLiveClaimToast(`${itemData.label} • ${itemData.short} extracted ${itemData.amount.toFixed(6)} ETH`);
      } else {
        showLiveClaimToast(`Signal detected: ${itemData.amount.toFixed(4)} ETH`);
      }
    }, 800);
  }
}

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
        <span class="recent-claim-meta" style="opacity:0.8">${keyLabel}</span>
        <span class="recent-claim-meta">•</span>
        <a href="https://etherscan.io/address/${wallet}" target="_blank" rel="noopener noreferrer">${short}</a>
        <span class="recent-claim-meta">claimed</span>
        <strong>${amount} ETH</strong>
        ${claimTime ? `<span class="recent-claim-meta">• ${claimTime}</span>` : ""}
      `;

      list.appendChild(item);

      if (index === 0) {
        setTimeout(() => {
          showLiveClaimToast(`${keyLabel} • ${short} extracted ${amount} ETH`);
        }, 800);
      }
    }

    if (footer) {
      footer.textContent = `Total value shown: ${totalShown.toFixed(6)} ETH`;
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
  `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist` +
  `&address=${TREASURY_WALLET}` +
  `&startblock=0&endblock=99999999&page=1&offset=10&sort=desc` +
  `&apikey=${ETHERSCAN_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) return;

   const data = await response.json();

if (!data || data.status === "0") {
  console.warn("Treasury deposits API issue:", data);
  return;
}

if (!Array.isArray(data.result)) {
  console.warn("Treasury deposits unexpected response:", data);
  return;
}
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

      showLiveClaimToast(`💰 ${short} sent signal: ${amount} ETH`);

      await loadTreasuryData();
    }
  } catch (err) {
    console.error("Treasury deposits load failed", err);
  }
}
async function loadTreasuryNFTs() {
  const container = document.getElementById("treasuryNFTList");
  if (!container) return;

  container.innerHTML = '<div class="small">Loading vault...</div>';

  try {
    const url =
      `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_API_KEY}/getNFTsForOwner` +
      `?owner=${TREASURY_WALLET}&withMetadata=true&pageSize=12`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to load treasury NFTs.");
    }

    const data = await response.json();
    console.log("Treasury NFT API response:", data);

    const ownedNfts = Array.isArray(data.ownedNfts) ? data.ownedNfts : [];

    if (!ownedNfts.length) {
      container.innerHTML = `
        <div class="small">
          No NFTs detected in the treasury wallet yet.
        </div>
      `;
      return;
    }

    const normalized = ownedNfts
  .map((nft) => {
    const name =
      nft?.name ||
      nft?.title ||
      `${nft?.contract?.name || "Unknown Collection"} #${nft?.tokenId || "?"}`;

    const image =
      nft?.image?.cachedUrl ||
      nft?.image?.pngUrl ||
      nft?.image?.thumbnailUrl ||
      nft?.media?.[0]?.gateway ||
      nft?.raw?.metadata?.image ||
      "";

    const contractAddress = nft?.contract?.address || "";
    const tokenId = nft?.tokenId || "";
    const collection = nft?.contract?.name || "Unknown Collection";

    return {
      name,
      image,
      tokenId,
      collection,
      contractAddress
    };
  })
  .filter((nft) => nft.image)
  .filter((nft) =>
    TREASURY_VAULT_CONTRACTS.length === 0 ||
    TREASURY_VAULT_CONTRACTS.includes((nft.contractAddress || "").toLowerCase())
  );

    if (!normalized.length) {
  container.innerHTML = `
    <div class="small">
      No featured vault assets are visible right now.<br>
      New treasury rewards will appear here.
    </div>
  `;
  return;
}

    container.innerHTML = "";

    normalized.slice(0, 4).forEach((nft) => {
      const item = document.createElement("div");
      item.style.display = "flex";
      item.style.alignItems = "center";
      item.style.gap = "12px";
      item.style.padding = "10px 0";
      item.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

      const openSeaUrl = nft.contractAddress && nft.tokenId
        ? `https://opensea.io/assets/ethereum/${nft.contractAddress}/${BigInt(nft.tokenId).toString()}`
        : "#";

      item.innerHTML = `
       <img
  src="${nft.image}"
  alt="${nft.name}"
  style="width:56px;height:56px;border-radius:12px;object-fit:cover;border:1px solid rgba(255,255,255,0.08);background:#111;box-shadow:0 0 20px rgba(255,200,80,0.15)"
  onerror="this.style.display='none'"
/>

        <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
         <div style="display:flex;align-items:center;gap:8px">
  <div style="font-weight:700;line-height:1.2">${nft.name}</div>
  <span style="font-size:12px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.08);opacity:0.8">
    🎁 Vault Asset
  </span>
</div>
</div>
          <div class="small" style="opacity:0.7">Locked in the treasury</div>
          ${
            openSeaUrl !== "#"
              ? `<a href="${openSeaUrl}" target="_blank" rel="noopener noreferrer" class="small" style="opacity:0.75">View asset</a>`
              : ""
          }
        </div>
      `;

      container.appendChild(item);
    });
    // добавляем скрытые элементы (placeholders)
for (let i = 0; i < 2; i++) {
  const hidden = document.createElement("div");
  hidden.style.display = "flex";
  hidden.style.alignItems = "center";
  hidden.style.gap = "12px";
  hidden.style.padding = "10px 0";
  hidden.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
  hidden.style.opacity = "0.6";

  hidden.innerHTML = `
    <div style="
      width:56px;
      height:56px;
      border-radius:12px;
      background:linear-gradient(135deg,#0f0f0f,#1c1c1c);
box-shadow: inset 0 0 20px rgba(0,0,0,0.6);
      border:1px dashed rgba(255,255,255,0.12);
    "></div>

    <div style="display:flex;flex-direction:column;gap:4px">
      <div style="font-weight:600">Sealed Asset</div>
      <div class="small">Visibility restricted by cycle state</div>
    </div>
  `;

  container.appendChild(hidden);
}
  } catch (err) {
    console.error("Treasury vault load failed", err);
    container.innerHTML = `
      <div class="small" style="color:#ff8a8a">
        Failed to load treasury vault
      </div>
    `;
  }
}
async function loadDonatorLeaderboard() {
  try {
    const list = document.getElementById("donatorLeaderboardList");
    const countLabel = document.getElementById("donatorLeaderboardCount");
    const footer = document.getElementById("donatorLeaderboardFooter");

    if (!list) return;
const EXCLUDED_WALLETS = [
  "0x88eEb79b0cCE7000142BBB474562663B4aB623db".toLowerCase()
];
    list.innerHTML = '<div class="small">Loading leaderboard...</div>';

    const url =
  `https://api.etherscan.io/v2/api?chainid=1&module=account&action=txlist` +
  `&address=${TREASURY_WALLET}` +
  `&startblock=0&endblock=99999999&page=1&offset=200&sort=desc` +
  `&apikey=${ETHERSCAN_API_KEY}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to load leaderboard data.");
    }

    const data = await response.json();
    console.log("Leaderboard API response:", data);

    if (!data || data.status === "0") {
      const apiMessage = data?.message || "Etherscan error";
      const apiResult = typeof data?.result === "string" ? data.result : "Unknown API response";
      throw new Error(`${apiMessage}: ${apiResult}`);
    }

    if (!Array.isArray(data.result)) {
      throw new Error("Etherscan returned unexpected data format.");
    }

    const incomingEthTxs = data.result.filter((tx) => {
  return (
    tx.to &&
    tx.to.toLowerCase() === TREASURY_WALLET.toLowerCase() &&
    tx.value &&
    BigInt(tx.value) > 0n &&
    tx.isError === "0" &&
    !EXCLUDED_WALLETS.includes(tx.from.toLowerCase()) // ← ВОТ ЭТО ВАЖНО
  );
});

    if (!incomingEthTxs.length) {
      list.innerHTML = `
        <div class="small">
          No valid positions detected yet.
Signals below 0.005 ETH do not enter the layer.<br>
          Be the first to enter the cycle.
        </div>
      `;

      if (countLabel) countLabel.textContent = "No supporters yet";
      if (footer) footer.textContent = "The cycle has already started.";
      return;
    }

    const donorMap = new Map();

    for (const tx of incomingEthTxs) {
      const from = tx.from.toLowerCase();
      const valueEth = Number(ethers.formatEther(tx.value));

      if (!donorMap.has(from)) {
        donorMap.set(from, {
          address: tx.from,
          total: 0,
          txCount: 0
        });
      }

      const donor = donorMap.get(from);
      donor.total += valueEth;
      donor.txCount += 1;
    }

   const MIN_SIGNAL_ETH = 0.005;

const sortedDonors = [...donorMap.values()]
  .filter((donor) => donor.total >= MIN_SIGNAL_ETH)
  .sort((a, b) => b.total - a.total)
  .slice(0, 10);

const donorsWithEns = await Promise.all(
  sortedDonors.map(async (donor) => {
    const ensName = await getEnsName(donor.address);
    return {
      ...donor,
      ensName
    };
  })
);

list.innerHTML = "";

donorsWithEns.forEach((donor, index) => {
      let badge = "";

      if (index === 0) badge = "👑 Alpha";
      else if (index === 1) badge = "🥇 Core";
      else if (index === 2) badge = "🥈 Early";
   else if (index === 3) badge = "◦ Signal";
   else if (index === 4) badge = "· Trace";

      const item = document.createElement("div");
      item.className = "recent-claim-item";
      item.style.display = "flex";
      item.style.justifyContent = "space-between";
      item.style.alignItems = "center";
      item.style.gap = "12px";
      item.style.padding = "12px 0";
      item.style.borderBottom = "1px solid rgba(255,255,255,0.06)";
      item.style.flexWrap = "wrap";
  item.style.alignItems = "center";

      item.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;min-width:0;flex:1;">
          <strong style="min-width:32px">#${index + 1}</strong>
     <a href="https://etherscan.io/address/${donor.address}" target="_blank" rel="noopener noreferrer" style="display:flex;flex-direction:column;line-height:1.15;min-width:0;">
  <span style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
    ${donor.ensName || shortAddress(donor.address)}
  </span>
  ${
    donor.ensName
      ? `<span class="small" style="opacity:0.5">${shortAddress(donor.address)}</span>`
      : ""
  }
</a>
          
          ${badge ? `<span style="opacity:0.7">${badge}</span>` : ""}
          <span class="recent-claim-meta" style="opacity:0.5">
  • Position Strength: ${
    donor.total >= 0.05 ? "High" :
    donor.total >= 0.01 ? "Medium" :
    "Low"
  }
</span>
          <span class="recent-claim-meta" style="opacity:0.75">
            • ${donor.txCount} deposit${donor.txCount > 1 ? "s" : ""}
          </span>
        </div>

        <div style="font-weight:700; white-space:nowrap; text-align:right; flex-shrink:0; margin-left:auto;">
  ${donor.total.toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH
</div>
      `;
  if (index === 0) {
  item.style.background = "rgba(255, 170, 0, 0.04)";
  item.style.borderRadius = "8px";
  item.style.padding = "12px 8px";
  item.style.boxShadow = "0 0 0 1px rgba(255, 170, 0, 0.08)";
    item.style.boxShadow = "0 0 30px rgba(255, 170, 0, 0.08)";
item.style.border = "1px solid rgba(255, 170, 0, 0.18)";
}
  if (index === 0) {
  item.querySelector("strong").style.color = "#ffd166";
}

      list.appendChild(item);
    });

    if (countLabel) {
      countLabel.textContent = `${sortedDonors.length} tracked positions`;
    }

    if (footer) {
      footer.textContent = "Positions form as signals enter the system.";
    }
  } catch (err) {
    console.error("Leaderboard load failed", err);

    const list = document.getElementById("donatorLeaderboardList");
    const footer = document.getElementById("donatorLeaderboardFooter");

    if (list) {
      list.innerHTML = '<div class="small" style="color:#ff8a8a">Failed to load leaderboard</div>';
    }

    if (footer) {
      footer.textContent = err.message || "Could not load treasury leaderboard right now.";
    }
  }
}
async function connectWallet() {
  try {
    if (!window.ethereum) {
      setMessage("MetaMask or Rabby is not installed.", "error");
      return;
    }

    setWalletStatus("Connected...");
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
  setWalletStatus("Error");
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
  await loadDonatorLeaderboard();
  loadTreasuryNFTs();

setInterval(async () => {
  await loadRecentTreasuryDeposits();
  await loadDonatorLeaderboard();
  await loadTreasuryNFTs();
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
