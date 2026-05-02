// Twinkling starfield overlay
(function() {
  const sf = document.createElement("div");
  sf.className = "starfield-twinkle";
  sf.setAttribute("aria-hidden", "true");
  document.body.insertBefore(sf, document.body.firstChild);
})();

// BullRun Key — site config
//
// Все внешние ключи (Alchemy, Etherscan) живут внутри Cloudflare Worker,
// см. 03_site/proxy/worker.js + 03_site/proxy/README.md.
// В этот JS не должно попасть ни одного секрета.
const PROXY_BASE = "https://bullrun-key-proxy.bullrunkey.workers.dev";

const REWARD_CONTRACT = "0xb522609cF7f2e8aF1d55Af1B685Cc9f6A159BC4D";
const NFT_CONTRACT = "0x367ac60FB4B2bb8851a46ab7A7FD13654eF70419";
const TREASURY_WALLET = "0x942587ffad5d0bc3e8ed72817ff27ff358e5486d";
const TREASURY_TARGET_ETH = 1;
const OPENSEA_URL = "https://opensea.io/collection/bullrunkey";

// Коллекции, которые подсвечиваются в Treasury Vault:
//   - BullRun Key (основная)
//   - Gemesis (OpenSea commemorative, лежит в treasury как артефакт эпохи)
//   - Lil Pudgys (vault asset, locked)
//   - Gift of Time by Manuel Larino (Art Blocks, цикловой артефакт)
const TREASURY_VAULT_CONTRACTS = [
  "0x367ac60FB4B2bb8851a46ab7A7FD13654eF70419".toLowerCase(), // BullRun Key
  "0xbe9371326f91345777b04394448c23e2bfeaa826".toLowerCase(), // Gemesis (OpenSea, ERC721SeaDrop)
  "0x524cAB2ec69124574082676e6F654a18df49A048".toLowerCase(), // Lil Pudgys
  "0x000000dc68934ed27fd11e32491cdf6717acaf21".toLowerCase()  // Gift of Time by Manuel Larino (Art Blocks)
];

// Общий read-only провайдер для публичных запросов до коннекта кошелька.
// Для on-chain записей (claim / signal) используется BrowserProvider над window.ethereum.
const READ_PROVIDER = new ethers.JsonRpcProvider(`${PROXY_BASE}/rpc`);
const ENS_PROVIDER = READ_PROVIDER;

// Минимальный осмысленный сигнал, см. 06_strategy/signals.md
const SIGNAL_MIN_ETH = 0.005;
const SIGNAL_ANCHOR_ETH = 0.01;

// Кошельки, которые не считаются публичными сигналами (founder top-ups и т.п.).
// Единый источник — используется и в leaderboard, и в recent deposits, и в toast.
const EXCLUDED_WALLETS = [
  "0x88eEb79b0cCE7000142BBB474562663B4aB623db".toLowerCase()
];

// Единый фильтр входящих сигналов на treasury. Используется везде,
// где читаются txlist: leaderboard, recent deposits, toast на новый сигнал.
// Требования: успешная tx, value > 0, адресат = treasury, отправитель не из EXCLUDED_WALLETS.
function filterIncomingTreasurySignals(txs) {
  if (!Array.isArray(txs)) return [];
  const treasury = TREASURY_WALLET.toLowerCase();
  return txs.filter((tx) => {
    if (!tx || !tx.to || !tx.from || !tx.value) return false;
    if (tx.to.toLowerCase() !== treasury) return false;
    try {
      if (BigInt(tx.value) <= 0n) return false;
    } catch (_) {
      return false;
    }
    if (tx.isError !== "0") return false;
    if (EXCLUDED_WALLETS.includes(tx.from.toLowerCase())) return false;
    return true;
  });
}

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
const nftActivityAbi = [
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
];

let currentAccount = "";
let currentTokenIds = [];
let lastTreasuryDepositHash = "";

function formatEth(value) {
  const eth = Number(ethers.formatEther(value));
  return eth.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function shortAddress(address) {
  return address.slice(0, 6) + "..." + address.slice(-4);
}

function sanitizeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    `${PROXY_BASE}/nft/getNFTsForOwner` +
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

// Определяем язык страницы по имени файла
const IS_RU = window.location.pathname.endsWith("ru.html") || window.location.pathname.includes("/ru");

const i18n = {
  socialProof: IS_RU
    ? (n) => `${n} коллекционеров уже держат кусочек цикла.`
    : (n) => `${n} collectors already hold a piece of the cycle.`,
  loading: IS_RU ? "Загрузка..." : "Loading...",
  loadingLeaderboard: IS_RU ? "Загружаем лидерборд..." : "Loading leaderboard...",
  loadingClaims: IS_RU ? "Загружаем активность..." : "Loading recent claims...",
  noRounds: IS_RU ? "Раундов наград пока нет." : "No reward rounds loaded yet.",
  connectWalletCheck: IS_RU ? "Подключить кошелёк для проверки наград" : "Connect wallet to check rewards",
  positionStrength: IS_RU ? "Сила позиции" : "Position Strength",
  deposits: IS_RU ? "депозитов" : "deposits",
  trackedPositions: IS_RU ? "позиций отслеживается" : "tracked positions",
  recentEvents: IS_RU ? "последних событий" : "recent events",
  liveSignalPositions: IS_RU ? "Живые позиции сигналов" : "Live signal positions",
};

// Загружает holder-счётчик и социальный proof в hero до коннекта кошелька.
// Без этого #heroSocialProof остаётся пустым абзацем для анонимных посетителей.
async function loadHeroSocialProof() {
  try {
    const holders = await fetchHolderCount();
    const heroHolders = document.getElementById("heroHolders");
    const heroSocialProof = document.getElementById("heroSocialProof");

    if (heroHolders) heroHolders.textContent = String(holders);
    if (heroSocialProof) {
      heroSocialProof.textContent = i18n.socialProof(holders);
    }
  } catch (err) {
    console.warn("Hero social proof load failed", err);
  }
}

async function fetchHolderCount() {
  const url =
    `${PROXY_BASE}/nft/getOwnersForContract` +
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
    const provider = READ_PROVIDER;

    const balanceWei = await provider.getBalance(TREASURY_WALLET);
    const balanceEth = Number(ethers.formatEther(balanceWei));
    const progress = Math.min((balanceEth / TREASURY_TARGET_ETH) * 100, 100);

    const treasuryBalanceEl = document.getElementById("treasuryBalance");
    const treasuryAddressEl = document.getElementById("treasuryAddress");
    const treasuryTargetEl = document.getElementById("treasuryTarget");
    const treasuryProgressTextEl = document.getElementById("treasuryProgressText");
    const treasuryProgressFillEl = document.getElementById("treasuryProgressFill");
    const systemStateTextEl = document.getElementById("systemStateText");
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
        balanceEth.toLocaleString("en-US", { maximumFractionDigits: 4 }) + " ETH";
    }
    const heroTreasuryEl = document.getElementById("heroTreasury");
    if (heroTreasuryEl) {
      heroTreasuryEl.textContent =
        balanceEth.toLocaleString("en-US", { maximumFractionDigits: 4 }) + " ETH";
    }
    // Full-width progress block
    const rpbCurrent = document.getElementById("rpbCurrent");
    const rpbFill = document.getElementById("rpbFill");
    const rpbPct = document.getElementById("rpbPct");
    if (rpbCurrent) rpbCurrent.textContent = balanceEth.toLocaleString("en-US", { maximumFractionDigits: 4 }) + " ETH";
    if (rpbFill) rpbFill.style.width = Math.min(progress, 100).toFixed(1) + "%";
    if (rpbPct) rpbPct.textContent = Math.min(progress, 100).toFixed(1) + "%";
    const rpbRemaining = document.getElementById("rpbRemaining");
    if (rpbRemaining) {
      const remaining = Math.max(0, TREASURY_TARGET_ETH - balanceEth);
      if (remaining > 0.001) {
        rpbRemaining.textContent = remaining.toLocaleString("en-US", { maximumFractionDigits: 4 }) + " ETH to reveal";
      } else {
        rpbRemaining.textContent = "Reveal threshold reached";
        rpbRemaining.style.color = "#f7931a";
      }
    }

    if (treasuryAddressEl) {
      treasuryAddressEl.textContent = shortAddress(TREASURY_WALLET);
    }

    if (treasuryTargetEl) {
      treasuryTargetEl.textContent = TREASURY_TARGET_ETH + " ETH";
    }

    if (treasuryProgressTextEl) {
      treasuryProgressTextEl.textContent =
        balanceEth.toLocaleString("en-US", { maximumFractionDigits: 4 }) +
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

if (window.POST_REVEAL) {
  // Post-reveal state — treasury now accumulates for Round #2
  if (systemStateTextEl) systemStateTextEl.textContent = IS_RU ? "Раунд #1 активен" : "Round #1 Active";
  if (systemStateEl) systemStateEl.classList.add("is-triggered");
  if (revealNoteEl) revealNoteEl.innerHTML = IS_RU
    ? `Раунд #1 активен.<br>Подключи кошелёк и заклеймируй награду.`
    : `Round #1 is live.<br>Connect your wallet and claim your reward.`;
  if (nextRoundStatusEl) { nextRoundStatusEl.classList.add("is-ready"); nextRoundStatusEl.textContent = IS_RU ? "Активен" : "Active"; }
  if (nextRoundTimingEl) nextRoundTimingEl.textContent = "1 ETH";
  if (roundIntroEl) roundIntroEl.innerHTML = IS_RU
    ? `Раунд #1 активен.<br>1 ETH распределён поровну между всеми 333 ключами.`
    : `Round #1 is live.<br>1 ETH distributed equally across all 333 keys.`;
  if (roundNoteEl) roundNoteEl.textContent = IS_RU
    ? "Каждый ключ может заклеймить свою долю один раз. Подключи кошелёк в секции Rewards."
    : "Each key can claim its share once. Connect your wallet in the Rewards section.";
  if (rpbRemaining) rpbRemaining.textContent = "";
  if (rpbFill) rpbFill.style.width = "0%";
} else if (balanceEth >= 1) {
  if (systemStateTextEl) {
    systemStateTextEl.textContent = "Trigger reached";
  }
if (nextRoundStatusEl) {
  nextRoundStatusEl.classList.add("is-ready");
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
  if (systemStateTextEl) {
    systemStateTextEl.textContent = "Trigger approaching";
  }
if (nextRoundStatusEl) {
  nextRoundStatusEl.classList.add("is-approaching");
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
  nextRoundTimingEl.textContent = `${balanceEth.toLocaleString("en-US", { maximumFractionDigits: 4 })} / 1 ETH`;
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
  if (systemStateTextEl) {
    systemStateTextEl.textContent = "Threshold forming";
  }
if (nextRoundStatusEl) {
  nextRoundStatusEl.classList.add("is-building");
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
  nextRoundTimingEl.textContent = `${balanceEth.toLocaleString("en-US", { maximumFractionDigits: 4 })} / 1 ETH`;
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
  if (systemStateTextEl) {
    systemStateTextEl.textContent = "Accumulating signals";
  }
if (nextRoundStatusEl) {
  nextRoundStatusEl.classList.add("is-forming");
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
    const heroTreasuryEl2 = document.getElementById("heroTreasury");
    if (heroTreasuryEl2) heroTreasuryEl2.textContent = "—";
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

      // Round 0 (contract index 0) is a public test round — claimable by all holders,
      // but with a small amount to verify the reward flow. Not the main Round #1.
      // Public Round #1 triggers when Treasury hits 1 ETH — it will be contract index 1+.
      const isTestRound = i === 0;
      const roundTitle = isTestRound
        ? `Round 0 <span class="history-round-tag">Test</span>`
        : `Round #${i}`;
      const roundNote = isTestRound
        ? `<div class="history-round-meta history-round-note">Public test round. Claimable by all holders, small amount. Run to verify the reward flow before the main 1 ETH cycle round.</div>`
        : "";

      item.innerHTML = `
  <div class="history-round-title">${roundTitle}</div>
  <div class="history-round-amount">${amountDeposited}</div>
  <div class="history-round-meta">Started: ${startDate}</div>
  <div class="history-round-meta">Status: ${status}</div>
  <div class="history-round-meta">Claim window: 365 days</div>
  ${roundNote}
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
// loadRecentClaims — полностью переписана на Etherscan API.
// Старая версия использовала queryFilter (eth_getLogs через Alchemy) — очень дорого.
// Теперь все данные берутся через Etherscan: tokentx для NFT-трансферов,
// txlist для treasury-сигналов. Alchemy не используется вообще.
async function loadRecentClaims(provider = READ_PROVIDER) {
  try {
    const list = document.getElementById("recentClaimsList");
    const countLabel = document.getElementById("recentClaimsCount");
    const footer = document.getElementById("recentClaimsFooter");

    if (!list) return;

    list.innerHTML = "";

    const activityItems = [];
    const nowMs = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    let recentSignals = [];

    // -------------------------
    // 1) TREASURY SIGNALS (Etherscan txlist — дёшево)
    // -------------------------
    try {
      const treasuryUrl =
        `${PROXY_BASE}/etherscan?chainid=1&module=account&action=txlist` +
        `&address=${TREASURY_WALLET}` +
        `&startblock=0&endblock=99999999&page=1&offset=20&sort=desc`;

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

          recentSignals = incomingSignals;

          for (const tx of incomingSignals.slice(0, 10)) {
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

    // -------------------------
    // 2) NFT TRANSFERS (Etherscan tokentx — дёшево, без eth_getLogs)
    // -------------------------
    try {
      const transferUrl =
        `${PROXY_BASE}/etherscan?chainid=1&module=account&action=tokennfttx` +
        `&contractaddress=${NFT_CONTRACT}` +
        `&page=1&offset=20&sort=desc`;

      const transferResponse = await fetch(transferUrl);

      if (transferResponse.ok) {
        const transferData = await transferResponse.json();

        if (transferData && Array.isArray(transferData.result)) {
          const secondaryTransfers = transferData.result.filter((tx) => {
            return (
              tx.from !== "0x0000000000000000000000000000000000000000" &&
              tx.to !== "0x0000000000000000000000000000000000000000"
            );
          });

          for (const tx of secondaryTransfers.slice(0, 10)) {
            const timestampMs = Number(tx.timeStamp) * 1000;
            activityItems.push({
              type: "transfer",
              from: tx.from,
              to: tx.to,
              fromShort: shortAddress(tx.from),
              toShort: shortAddress(tx.to),
              label: `Key #${tx.tokenID}`,
              timestampMs
            });
          }
        }
      }
    } catch (transferErr) {
      console.warn("Failed to load NFT transfer activity", transferErr);
    }

    // -------------------------
    // 3) REWARD CLAIMS (internal txs from reward contract)
    // -------------------------
    try {
      const claimUrl =
        `${PROXY_BASE}/etherscan?chainid=1&module=account&action=txlistinternal` +
        `&address=${REWARD_CONTRACT}` +
        `&page=1&offset=20&sort=desc`;

      const claimResponse = await fetch(claimUrl);

      if (claimResponse.ok) {
        const claimData = await claimResponse.json();

        if (claimData && Array.isArray(claimData.result)) {
          const claimTxs = claimData.result.filter((tx) => {
            return (
              tx.from &&
              tx.from.toLowerCase() === REWARD_CONTRACT.toLowerCase() &&
              tx.value &&
              BigInt(tx.value) > 0n &&
              tx.isError === "0"
            );
          });

          for (const tx of claimTxs.slice(0, 10)) {
            const timestampMs = Number(tx.timeStamp) * 1000;
            activityItems.push({
              type: "claim",
              wallet: tx.to,
              short: shortAddress(tx.to),
              amount: Number(ethers.formatEther(tx.value)),
              label: "Reward Claim",
              timestampMs
            });
          }
        }
      }
    } catch (claimErr) {
      console.warn("Failed to load claim activity", claimErr);
    }

    // -------------------------
    // 4) VAULT NFT DEPOSITS (NFT transfers TO treasury wallet)
    // -------------------------
    const VAULT_NAMES = {
      "0x367ac60fb4b2bb8851a46ab7a7fd13654ef70419": "BullRun Key",
      "0xbe9371326f91345777b04394448c23e2bfeaa826": "Gemesis",
      "0x524cab2ec69124574082676e6f654a18df49a048": "Lil Pudgy",
      "0x000000dc68934ed27fd11e32491cdf6717acaf21": "Gift of Time"
    };
    try {
      const vaultUrl =
        `${PROXY_BASE}/etherscan?chainid=1&module=account&action=tokennfttx` +
        `&address=${TREASURY_WALLET}&page=1&offset=50&sort=desc`;

      const vaultResponse = await fetch(vaultUrl);
      if (vaultResponse.ok) {
        const vaultData = await vaultResponse.json();
        if (vaultData && Array.isArray(vaultData.result)) {
          const deposits = vaultData.result.filter((tx) =>
            tx.to.toLowerCase() === TREASURY_WALLET.toLowerCase() &&
            tx.from !== "0x0000000000000000000000000000000000000000" &&
            TREASURY_VAULT_CONTRACTS.includes(tx.contractAddress.toLowerCase())
          );
          for (const tx of deposits.slice(0, 5)) {
            const contractKey = tx.contractAddress.toLowerCase();
            const friendlyName = VAULT_NAMES[contractKey] || tx.tokenName || tx.contractAddress;
            let rawId = tx.tokenID ? BigInt(tx.tokenID) : null;
            // Art Blocks: tokenId = projectId * 1000000 + tokenNumber
            const isArtBlocks = contractKey === "0x000000dc68934ed27fd11e32491cdf6717acaf21";
            if (isArtBlocks && rawId !== null && rawId >= 1000000n) rawId = rawId % 1000000n;
            const tokenId = rawId !== null ? ` #${rawId.toString()}` : "";
            activityItems.push({
              type: "vault",
              label: `${friendlyName}${tokenId}`,
              from: tx.from,
              fromShort: shortAddress(tx.from),
              timestampMs: Number(tx.timeStamp) * 1000
            });
          }
        }
      }
    } catch (vaultErr) {
      console.warn("Failed to load vault deposit activity", vaultErr);
    }

    // -------------------------
    // 5) AUTOMATIC SYSTEM EVENTS
    // -------------------------
    try {
      const treasuryBalanceWei = await provider.getBalance(TREASURY_WALLET);
      const treasuryBalanceEth = Number(ethers.formatEther(treasuryBalanceWei));

      // threshold event
      if (treasuryBalanceEth >= 0.8) {
        activityItems.push({
          type: "system",
          label: "System",
          text: "reveal pressure increasing",
          timestampMs: nowMs - 60 * 1000
        });
      } else if (treasuryBalanceEth >= 0.5) {
        activityItems.push({
          type: "system",
          label: "System",
          text: "threshold forming",
          timestampMs: nowMs - 2 * 60 * 1000
        });
      }

      // signal cluster event (если 3+ сигналов за 24ч)
      const signalsLast24h = recentSignals.filter((tx) => {
        const ts = Number(tx.timeStamp) * 1000;
        return nowMs - ts <= oneDayMs;
      });

      if (signalsLast24h.length >= 3) {
        const latestSignalTs = Number(signalsLast24h[0].timeStamp) * 1000;

        activityItems.push({
          type: "system",
          label: "System",
          text: "positioning activity increasing",
          timestampMs: latestSignalTs + 1
        });
      }
      // reward activity event (если были клеймы)
      const hasRecentClaim = activityItems.some((item) => item.type === "claim");
      if (hasRecentClaim) {
        const latestClaim = activityItems
          .filter((item) => item.type === "claim")
          .sort((a, b) => b.timestampMs - a.timestampMs)[0];

        if (latestClaim) {
          activityItems.push({
            type: "system",
            label: "System",
            text: "reward activity detected",
            timestampMs: latestClaim.timestampMs + 1
          });
        }
      }
    } catch (systemErr) {
      console.warn("Failed to build system activity", systemErr);
    }

    // -------------------------
    // 5) SORT + LIMIT
    // -------------------------
    activityItems.sort((a, b) => b.timestampMs - a.timestampMs);
    const recentItems = activityItems.slice(0, 16);

    if (!recentItems.length) {
      if (countLabel) countLabel.textContent = "No recent activity";
      if (footer) footer.textContent = "No recent system activity yet.";
      list.innerHTML = '<div class="small">No recent activity yet.</div>';
      return;
    }

    if (countLabel) {
      countLabel.textContent = `${recentItems.length} recent events`;
    }

    let totalShown = 0;

    for (let index = 0; index < recentItems.length; index++) {
      const itemData = recentItems[index];
      const activityTime = itemData.timestampMs ? timeAgo(itemData.timestampMs) : "";

      if (itemData.amount) {
        totalShown += itemData.amount;
      }

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
      } else if (itemData.type === "signal") {
    
        item.innerHTML = `
          <span class="recent-claim-meta" style="opacity:0.8">${itemData.label}</span>
          <span class="recent-claim-meta">•</span>
          <a href="https://etherscan.io/address/${itemData.wallet}" target="_blank" rel="noopener noreferrer">${itemData.short}</a>
          <span class="recent-claim-meta">positioned</span>
          <strong>${itemData.amount.toFixed(4)} ETH</strong>
          ${activityTime ? `<span class="recent-claim-meta">• ${activityTime}</span>` : ""}
        `;
      } else if (itemData.type === "transfer") {
        item.innerHTML = `
          <span class="recent-claim-meta" style="opacity:0.8">${itemData.label}</span>
          <span class="recent-claim-meta">•</span>
          <a href="https://etherscan.io/address/${itemData.from}" target="_blank" rel="noopener noreferrer">${itemData.fromShort}</a>
          <span class="recent-claim-meta">transferred to</span>
          <a href="https://etherscan.io/address/${itemData.to}" target="_blank" rel="noopener noreferrer">${itemData.toShort}</a>
          ${activityTime ? `<span class="recent-claim-meta">• ${activityTime}</span>` : ""}
        `;
      } else if (itemData.type === "vault") {
        item.innerHTML = `
          <span class="recent-claim-meta" style="opacity:0.8">Vault Asset</span>
          <span class="recent-claim-meta">•</span>
          <span style="font-weight:600">${itemData.label}</span>
          <span class="recent-claim-meta">NFT added to treasury</span>
          ${activityTime ? `<span class="recent-claim-meta">• ${activityTime}</span>` : ""}
        `;
      } else {
         item.classList.add("system");
        item.innerHTML = `
          <span class="recent-claim-meta" style="opacity:0.8">${itemData.label}</span>
          <span class="recent-claim-meta">•</span>
          <span class="recent-claim-meta">${itemData.text}</span>
          ${activityTime ? `<span class="recent-claim-meta">• ${activityTime}</span>` : ""}
        `;
      }

      list.appendChild(item);

      if (index === 0) {
        setTimeout(() => {
          if (itemData.type === "claim") {
            showLiveClaimToast(`${itemData.label} • ${itemData.short} extracted ${itemData.amount.toFixed(6)} ETH`);
          } else if (itemData.type === "signal") {
            showLiveClaimToast(`Signal detected: ${itemData.amount.toFixed(4)} ETH`);
          } else if (itemData.type === "transfer") {
            showLiveClaimToast(`${itemData.label} transferred`);
          } else if (itemData.type === "system") {
            showLiveClaimToast(`System: ${itemData.text}`);
          }
        }, 800);
      }
    }

    if (footer) {
      footer.textContent = `Value shown (signals + rewards): ${totalShown.toFixed(6)} ETH`;
    }
  } catch (err) {
    console.error("Activity load failed", err);

    const list = document.getElementById("recentClaimsList");
    if (list) {
      list.innerHTML = `<div class="small" style="opacity:0.5">Live data temporarily unavailable. On-chain records remain public.</div>`;
    }
  }
}
async function loadRecentTreasuryDeposits() {
  try {
    const url =
  `${PROXY_BASE}/etherscan?chainid=1&module=account&action=txlist` +
  `&address=${TREASURY_WALLET}` +
  `&startblock=0&endblock=99999999&page=1&offset=10&sort=desc`;

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
    const incomingEthTxs = filterIncomingTreasurySignals(data.result);

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
      const amount = Number(ethers.formatEther(latest.value)).toLocaleString("en-US", {
        maximumFractionDigits: 4
      });

      showLiveClaimToast(`New signal · ${short} · ${amount} ETH`);

      await loadTreasuryData();
    }
  } catch (err) {
    console.error("Treasury deposits load failed", err);
  }
}
async function loadTreasuryNFTs() {
  const container = document.getElementById("treasuryNFTList");
  if (!container) return;

  container.innerHTML = `
    <div class="vault-skeleton">
      <div class="vault-skel-item"></div>
      <div class="vault-skel-item"></div>
    </div>
  `;

  try {
    const url =
      `${PROXY_BASE}/nft/getNFTsForOwner` +
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

    const rawImage =
      nft?.image?.cachedUrl ||
      nft?.image?.pngUrl ||
      nft?.image?.thumbnailUrl ||
      nft?.media?.[0]?.gateway ||
      nft?.raw?.metadata?.image ||
      "";
    const resolvedImage = rawImage.startsWith("ipfs://")
      ? rawImage.replace("ipfs://", "https://ipfs.io/ipfs/")
      : rawImage;

    const contractAddress = nft?.contract?.address || "";
    const tokenId = nft?.tokenId || "";
    const collection = nft?.contract?.name || "Unknown Collection";

    // fallback для BullRun Key пока метаданные запечатаны
    const isBullRunKey = contractAddress.toLowerCase() === "0x367ac60fb4b2bb8851a46ab7a7fd13654ef70419";
    const image = resolvedImage || (isBullRunKey ? "/key.png" : "");

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
    <div class="vault-locked-state">
      <div class="vault-locked-icon">⬡</div>
      <div class="vault-locked-text">
        Vault contents are not visible yet.<br>
        Reveal unlocks at 1 ETH.
      </div>
    </div>
  `;
  return;
}

    container.innerHTML = "";

    // Группируем одинаковые коллекции в одну строку
    const groupMap = new Map();
    normalized.forEach((nft) => {
      const key = nft.contractAddress.toLowerCase() || nft.collection;
      if (!groupMap.has(key)) {
        groupMap.set(key, { ...nft, count: 1 });
      } else {
        groupMap.get(key).count += 1;
      }
    });
    const grouped = Array.from(groupMap.values()).sort(() => Math.random() - 0.5);

    grouped.forEach((nft) => {
      const item = document.createElement("div");
      item.style.display = "flex";
      item.style.alignItems = "center";
      item.style.gap = "12px";
      item.style.padding = "10px 0";
      item.style.borderBottom = "1px solid rgba(255,255,255,0.06)";

      const openSeaCollectionUrl = nft.contractAddress
        ? `https://opensea.io/assets/ethereum/${nft.contractAddress}`
        : "#";

      const displayName = nft.count > 1 ? nft.collection : nft.name;
      const countBadge = nft.count > 1
        ? `<span style="font-size:12px;padding:2px 8px;border-radius:999px;background:rgba(255,200,80,0.15);color:rgba(255,200,80,0.9);font-weight:600;border:1px solid rgba(255,200,80,0.25)">${nft.count}x</span>`
        : "";

      item.innerHTML = `
        <img
          src="${sanitizeHtml(nft.image)}"
          alt="${sanitizeHtml(displayName)}"
          style="width:56px;height:56px;border-radius:12px;object-fit:cover;border:1px solid rgba(255,255,255,0.08);background:#111;box-shadow:0 0 20px rgba(255,200,80,0.15)"
          onerror="this.src='/key.png'"
        />
        <div style="display:flex;flex-direction:column;gap:4px;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div style="font-weight:700;line-height:1.2">${sanitizeHtml(displayName)}</div>
            ${countBadge}
            <span style="font-size:12px;padding:2px 8px;border-radius:999px;background:rgba(255,255,255,0.08);opacity:0.8">
              Vault Asset
            </span>
          </div>
          <div class="small" style="opacity:0.7">Locked in the treasury</div>
          ${
            openSeaCollectionUrl !== "#"
              ? `<a href="${openSeaCollectionUrl}" target="_blank" rel="noopener noreferrer" class="small" style="opacity:0.75">View asset</a>`
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
    container.innerHTML = `<div class="small" style="opacity:0.5">Live data temporarily unavailable. On-chain records remain public.</div>`;
  }
}
async function loadDonatorLeaderboard() {
  try {
    const list = document.getElementById("donatorLeaderboardList");
    const countLabel = document.getElementById("donatorLeaderboardCount");
    const footer = document.getElementById("donatorLeaderboardFooter");

    if (!list) return;
    list.innerHTML = '<div class="small">Loading leaderboard...</div>';

    const url =
  `${PROXY_BASE}/etherscan?chainid=1&module=account&action=txlist` +
  `&address=${TREASURY_WALLET}` +
  `&startblock=0&endblock=99999999&page=1&offset=10000&sort=desc`;

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

    const incomingEthTxs = filterIncomingTreasurySignals(data.result);

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
      // Minimal tier markers — no emojis, no crowns. Premium/calm tone per 04_content/twitter/README.md.
      let badge = "";
      if (index === 0) badge = "Alpha";
      else if (index === 1) badge = "Core";
      else if (index === 2) badge = "Early";
      else if (index === 3) badge = "Signal";
      else if (index === 4) badge = "Trace";

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
          
          ${badge ? `<span class="leaderboard-tier tier-${badge.toLowerCase()}">${badge}</span>` : ""}
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
  ${donor.total.toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH
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
      list.innerHTML = '<div class="small" style="opacity:0.5">Live data temporarily unavailable. On-chain records remain public.</div>';
    }

    if (footer) {
      footer.textContent = err.message || "Could not load treasury leaderboard right now.";
    }
  }
}
function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function showMobileWalletOptions() {
  const url = encodeURIComponent("https://bullrunkey.xyz");
  const wallets = [
    { name: "MetaMask",      link: `https://metamask.app.link/dapp/bullrunkey.xyz` },
    { name: "Trust Wallet",  link: `https://link.trustwallet.com/open_url?coin_id=60&url=https://bullrunkey.xyz` },
    { name: "Coinbase Wallet", link: `https://go.cb-wallet.com/dapp?url=https://bullrunkey.xyz` },
    { name: "Rabby",         link: `https://rabby.io/` },
  ];

  const existing = document.getElementById("mobileWalletModal");
  if (existing) existing.remove();

  const modal = document.createElement("div");
  modal.id = "mobileWalletModal";
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.85);z-index:9999;
    display:flex;align-items:flex-end;justify-content:center;
  `;
  modal.innerHTML = `
    <div style="
      background:#111;border:1px solid rgba(255,255,255,0.1);
      border-radius:20px 20px 0 0;padding:28px 24px 36px;
      width:100%;max-width:480px;
    ">
      <div style="font-size:16px;font-weight:700;margin-bottom:6px">Open in wallet browser</div>
      <div style="font-size:13px;opacity:0.5;margin-bottom:20px">
        Mobile browsers don't support wallet connections directly.<br>
        Open the site from your wallet app.
      </div>
      ${wallets.map(w => `
        <a href="${w.link}" target="_blank" rel="noopener noreferrer" style="
          display:flex;align-items:center;justify-content:space-between;
          padding:14px 16px;margin-bottom:8px;
          background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);
          border-radius:12px;text-decoration:none;color:inherit;font-weight:600;font-size:15px;
        ">
          ${w.name}
          <span style="opacity:0.4;font-size:18px">→</span>
        </a>
      `).join("")}
      <button onclick="document.getElementById('mobileWalletModal').remove()" style="
        width:100%;margin-top:12px;padding:12px;
        background:transparent;border:1px solid rgba(255,255,255,0.1);
        border-radius:12px;color:rgba(255,255,255,0.5);font-size:14px;cursor:pointer;
      ">Cancel</button>
    </div>
  `;
  modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
}

async function connectWallet() {
  try {
    if (!window.ethereum) {
      if (isMobile()) {
        showMobileWalletOptions();
      } else {
        setMessage("No wallet detected. Install MetaMask or Rabby to connect.");
      }
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

// ----- Signals -----
// Сигнал — это не donate. Это позиционирование (см. 06_strategy/signals.md).
// Кнопки отправляют ETH на TREASURY_WALLET. Если кошелёк не подключён — сначала
// запрашиваем коннект, потом отправляем. Если MetaMask/Rabby не установлены —
// открываем ethereum:-deep-link как fallback (работает на мобильных кошельках).

async function sendSignal(amountEth) {
  try {
    if (!Number.isFinite(amountEth) || amountEth <= 0) {
      setMessage("Enter a valid ETH amount.", "error");
      return;
    }

    if (amountEth < SIGNAL_MIN_ETH) {
      const proceed = confirm(
        `Signals below ${SIGNAL_MIN_ETH} ETH are considered noise and do not enter the leaderboard.\n\n` +
        `Send ${amountEth} ETH anyway?`
      );
      if (!proceed) return;
    }

    const valueWei = ethers.parseEther(String(amountEth));
    const valueHex = "0x" + valueWei.toString(16);

    if (!window.ethereum) {
      // Fallback: открыть кошелёк через ethereum: URI (работает на iOS/Android MetaMask).
      window.open(
        `ethereum:${TREASURY_WALLET}?value=${valueWei.toString()}`,
        "_blank"
      );
      return;
    }

    // Коннект, если ещё не.
    if (!currentAccount) {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      currentAccount = accounts?.[0] || "";
      if (!currentAccount) {
        setMessage("Wallet connection rejected.", "error");
        return;
      }
    }

    const chainId = await window.ethereum.request({ method: "eth_chainId" });
    if (parseInt(chainId, 16) !== 1) {
      setMessage("Please switch wallet to Ethereum Mainnet before signaling.", "error");
      return;
    }

    setMessage(`Sending signal of ${amountEth} ETH... confirm in your wallet.`);

    const txHash = await window.ethereum.request({
      method: "eth_sendTransaction",
      params: [{
        from: currentAccount,
        to: TREASURY_WALLET,
        value: valueHex,
      }],
    });

    setMessage(`Signal submitted. Tx: ${txHash.slice(0, 10)}...`, "success");
    showLiveClaimToast(`Signal submitted: ${amountEth} ETH`);

    // Даём сети пару секунд, потом подтягиваем фронт.
    setTimeout(async () => {
      await loadTreasuryData();
      await loadRecentTreasuryDeposits();
      await loadDonatorLeaderboard();
    }, 3000);
  } catch (err) {
    const msg = err?.reason || err?.shortMessage || err?.message || "Signal failed.";
    setMessage(msg, "error");
  }
}

function wireSignalButtons() {
  const buttons = document.querySelectorAll("[data-signal-amount]");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const amount = Number(btn.getAttribute("data-signal-amount"));
      sendSignal(amount);
    });
  });

  const customBtn = document.querySelector("[data-signal-custom]");
  const customRow = document.getElementById("signal-custom-row");
  const customInput = document.getElementById("signal-custom-value");
  const customConfirm = document.getElementById("signal-custom-confirm");
  const customCancel = document.getElementById("signal-custom-cancel");

  function hideCustomRow() {
    if (customRow) customRow.style.display = "none";
    if (customInput) customInput.value = "";
  }

  if (customBtn && customRow) {
    customBtn.addEventListener("click", () => {
      customRow.style.display = "block";
      if (customInput) customInput.focus();
    });
  }

  if (customConfirm) {
    customConfirm.addEventListener("click", () => {
      const raw = customInput ? customInput.value.replace(",", ".") : "";
      const amount = Number(raw);
      hideCustomRow();
      sendSignal(amount);
    });
  }

  if (customCancel) {
    customCancel.addEventListener("click", hideCustomRow);
  }

  if (customInput) {
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") customConfirm && customConfirm.click();
      if (e.key === "Escape") hideCustomRow();
    });
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
  setMessage(""); // clear any stale messages on load

  // Публичные блоки — грузим до коннекта кошелька,
  // чтобы анонимный посетитель видел живые данные, а не "Loading...".
  await Promise.all([
    loadTreasuryData(),
    loadHeroSocialProof(),
    loadRecentTreasuryDeposits(),
    loadDonatorLeaderboard(),
    loadTreasuryNFTs(),
    loadRecentClaims(READ_PROVIDER),
  ]);

  wireSignalButtons();

// Лёгкий poll каждые 3 минуты — только treasury и leaderboard (Etherscan, дёшево).
// loadRecentClaims и loadTreasuryNFTs убраны из цикла: они дорогие (eth_getLogs + NFT API).
// Они грузятся один раз при загрузке страницы — этого достаточно.
setInterval(async () => {
  await loadRecentTreasuryDeposits();
  await loadDonatorLeaderboard();
}, 180000);

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
