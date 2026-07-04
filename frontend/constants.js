const ZARIX = {
  PROGRAM_ID: '6uwVSD2u9FyZDPnyNPE8JeWyiwR2sy3ZexnVdfopXLVs',
  TOKEN_MINT: 'ukV3rKPFqaYuGMnSx9ZuShiY15aEjr2s5evf8ydHuTf',
  PROGRAM_STATE_PDA: '7UoNM7ihsFEfMiLjRA6PifTszP3b3NMv2TXZ1w9X9Bcc',
  VAULT_PDA: '6dxMcgNHJ3ZMiYjc6w1btjBBGhtgTCcp7Qcc3M9Z2iU6',

  TOKEN_DECIMALS: 9,
  LAMPORTS_PER_TOKEN: 1_000_000_000,
  SECONDS_PER_DAY: 86400,
  SECONDS_PER_YEAR: 31536000,
  EPOCH_DURATION_SECONDS: 86400,
  MAX_EPOCHS_PER_CLAIM: 30,
  MAX_REWARD_ACCRUAL_YEARS: 10,
  EPOCH_SNAPSHOT_COUNT: 45,

  TOTAL_DAILY_ALLOCATION: 20_000,
  DEFAULT_MIN_STAKE: 2_500,
  HALVING_PERIOD_DAYS: 730,
  MIN_LOCK_DAYS: 365,
  MAX_LOCK_DAYS: 2555,

  PDA_SEEDS: {
    PROGRAM_STATE: 'state',
    USER_ACCOUNT: 'user',
    STAKE: 'stake',
    VAULT: 'vault',
    LP_GAUGE: 'lp_gauge',
    LP_STAKER: 'lp_staker',
    LP_STAKE: 'lp_stake',
    LP_VAULT: 'lp_vault',
  },

  LOCK_DURATIONS: [
    { days: 365, years: 1, label: '1 Year', multiplier: 1.0 },
    { days: 730, years: 2, label: '2 Years', multiplier: 1.5 },
    { days: 1095, years: 3, label: '3 Years', multiplier: 2.0 },
    { days: 1460, years: 4, label: '4 Years', multiplier: 2.5 },
    { days: 1825, years: 5, label: '5 Years', multiplier: 3.0 },
    { days: 2190, years: 6, label: '6 Years', multiplier: 3.5 },
    { days: 2555, years: 7, label: '7 Years', multiplier: 4.0 },
  ],

  ACCOUNT_SIZES: {
    USER_ACCOUNT: 192,
    STAKE_PDA: 224,
    LP_GAUGE: 105,
    LP_STAKER: 160,
    LP_STAKE_PDA: 192,
  },

  DISCRIMINATORS: {
    LP_GAUGE: [0x5a, 0x41, 0x52, 0x49, 0x58, 0x4c, 0x50, 0x47],
    LP_STAKER: [0x5a, 0x41, 0x52, 0x49, 0x58, 0x4c, 0x50, 0x41],
    LP_STAKE_PDA: [0x5a, 0x41, 0x52, 0x49, 0x58, 0x4c, 0x50, 0x4b],
  },
};

const UI = {
  DECIMALS: {
    PRECISE: 4,
    COMPACT: 2,
    MULTIPLIER: 1,
  },

  THRESHOLDS: {
    MIN_CLAIMABLE: 0.001,
  },

  TIME: {
    SECONDS_PER_MINUTE: 60,
    SECONDS_PER_HOUR: 3600,
    SECONDS_PER_WEEK: 604800,
    POLL_INTERVAL_MS: 2000,
    POLL_MAX_RETRIES: 30,
    REFRESH_INTERVAL_MS: 120000,
    AUTO_CONNECT_DELAY_MS: 500,
    HEARTBEAT_INTERVAL_MS: 15000,
  },

  STRINGS: {
    TOKEN: 'ZARIX',
    LP: 'LP',
  },

  DATE_FORMAT: { month: 'short', day: 'numeric', year: 'numeric' },

  APP: {
    PROXY_URL: 'http://127.0.0.1:3847/api/rpc',
    API_SET_RPC: '/api/rpc/set',
    API_SHUTDOWN: '/api/shutdown',
    API_HEARTBEAT: '/api/heartbeat',
    DEFAULT_SOLANA_RPC: 'https://api.mainnet-beta.solana.com',
    EXPLORER_BASE: 'https://solscan.io',
  },

  STORAGE: {
    RPC_URL: 'zarix_rpc',
    RPC_TARGET: 'zarix_rpc_target',
  },

  PREMIUM_RPC_PROVIDERS: ['helius', 'quicknode', 'alchemy', 'triton'],

  KNOWN_DEX_PROGRAMS: {
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Liquidity',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8': 'Swap',
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Swap',
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Swap',
    'routeUGWgWzqBWFcrCfv8tritsqukccJPu3q5GPP3xS': 'Swap',
  },

  EXCLUDED_LP_MINTS: new Set([
    'So11111111111111111111111111111111111111112',
    'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  ]),
};

function formatPrecise(value) {
  return Number(value).toFixed(UI.DECIMALS.PRECISE);
}

function formatCompact(value) {
  return Number(value).toFixed(UI.DECIMALS.COMPACT);
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / UI.TIME.SECONDS_PER_HOUR);
  const m = Math.ceil((seconds % UI.TIME.SECONDS_PER_HOUR) / UI.TIME.SECONDS_PER_MINUTE);
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}

function explorerTxUrl(sig) {
  return UI.APP.EXPLORER_BASE + '/tx/' + sig;
}

function explorerAccountUrl(addr) {
  return UI.APP.EXPLORER_BASE + '/account/' + addr;
}

function handleTxError(e, context) {
  if (e.message?.includes('rejected')) {
    return 'Transaction rejected by user';
  }
  return context + ' failed: ' + (e.message || 'Unknown error');
}

const InstructionType = {
  Initialize: 0,
  Stake: 1,
  ClaimAllocation: 2,
  Unstake: 3,
  PartialUnstake: 4,
  ExtendLock: 5,
  InitializeLPGauge: 6,
  StakeLP: 7,
  ClaimLPAllocations: 8,
  UnstakeLP: 9,
  ExtendLPLock: 10,
};


function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

function calculateCurrentEpoch(genesisTimestamp) {
  const now = getCurrentTimestamp();
  const genesis = Number(genesisTimestamp);
  if (now <= genesis) return 0;
  return Math.floor((now - genesis) / ZARIX.EPOCH_DURATION_SECONDS);
}

function calculateHalvingPhase(epoch) {
  const halvingCount = Math.floor(epoch / ZARIX.HALVING_PERIOD_DAYS);
  return halvingCount >= 4 ? 4 : halvingCount;
}

function calculateHalvingPhaseForEpoch(epoch) {
  return calculateHalvingPhase(epoch);
}

function formatTokenAmount(amountLamports) {
  const value = Number(amountLamports) / ZARIX.LAMPORTS_PER_TOKEN;
  return Math.floor(value).toLocaleString('en-US');
}

function shortenAddress(address, chars = 4) {
  return address.slice(0, chars) + '...' + address.slice(-chars);
}

function getVotingMultiplier(lockDays) {
  const years = Math.floor(lockDays / 365);
  const multipliers = { 1: 1.0, 2: 1.5, 3: 2.0, 4: 2.5, 5: 3.0, 6: 3.5 };
  return multipliers[years] || (years >= 7 ? 4.0 : 1.0);
}

function formatTimeRemaining(lockEndTimestamp) {
  const now = getCurrentTimestamp();
  const remaining = Number(lockEndTimestamp) - now;
  if (remaining <= 0) return 'Unlocked';
  const days = remaining / ZARIX.SECONDS_PER_DAY;
  if (days < 1) return Math.floor(days * 24) + 'h';
  if (days < 365) return Math.floor(days) + 'd';
  const y = Math.floor(days / 365);
  const d = Math.floor(days % 365);
  return d === 0 ? y + 'y' : y + 'y ' + d + 'd';
}

function getLockStatus(lockEndTimestamp) {
  return Number(lockEndTimestamp) > getCurrentTimestamp() ? 'locked' : 'unlocked';
}

function getDailyStakerAllocation(halvingPhase, stakerPercentage) {
  const pct = (stakerPercentage || 75) / 100;
  const base = ZARIX.TOTAL_DAILY_ALLOCATION;
  switch (halvingPhase) {
    case 0: return base * pct;
    case 1: return (base / 2) * pct;
    case 2: return (base / 4) * pct;
    case 3: return (base / 8) * pct;
    default: return 2500 * pct;
  }
}

function getDailyStakerAllocationBigInt(halvingPhase, stakerPercentage) {
  const pct = stakerPercentage || 75;
  const base = BigInt(ZARIX.TOTAL_DAILY_ALLOCATION) * BigInt(ZARIX.LAMPORTS_PER_TOKEN);
  let phaseAlloc;
  switch (halvingPhase) {
    case 0: phaseAlloc = base; break;
    case 1: phaseAlloc = base / 2n; break;
    case 2: phaseAlloc = base / 4n; break;
    case 3: phaseAlloc = base / 8n; break;
    default: phaseAlloc = base / 8n; break;
  }
  return (phaseAlloc * BigInt(pct)) / 100n;
}

function calculateEstimatedDaily(userStake, totalNetworkStake, halvingPhase, stakerPct) {
  if (totalNetworkStake < 0.01) return 0;
  const daily = getDailyStakerAllocation(halvingPhase, stakerPct);
  return (userStake / totalNetworkStake) * daily;
}

function calculateMinimumRent(accountSize) {
  const totalSize = accountSize + 128;
  return Math.ceil(totalSize * 3480 * 2);
}

// --- claimable allocation calc ---

function isStakeActive(isPending, activationEpoch, genesisTimestamp) {
  const currentEpoch = calculateCurrentEpoch(genesisTimestamp);
  return currentEpoch >= Number(activationEpoch);
}

function getEpochSnapshot(epochSnapshots, totalNetworkStaked, pendingNetworkStake, epoch, currentEpoch) {
  const effectiveTotal = BigInt(totalNetworkStaked) + BigInt(pendingNetworkStake);
  const SNAP_COUNT = ZARIX.EPOCH_SNAPSHOT_COUNT;

  if (epoch >= currentEpoch) return effectiveTotal;

  if (currentEpoch - epoch >= SNAP_COUNT) {
    const oldestIndex = (currentEpoch - (SNAP_COUNT - 1)) % SNAP_COUNT;
    const snapshot = epochSnapshots[oldestIndex] || 0n;
    return snapshot === 0n ? effectiveTotal : snapshot;
  }

  const snapshotIndex = epoch % SNAP_COUNT;
  const snapshot = epochSnapshots[snapshotIndex] || 0n;
  return snapshot === 0n ? effectiveTotal : snapshot;
}

function calculateAllocationBigInt(userStakeLamports, totalNetworkStakeLamports, halvingPhase, stakerPercentage) {
  if (totalNetworkStakeLamports === 0n) return 0n;
  const dailyAllocation = getDailyStakerAllocationBigInt(halvingPhase, stakerPercentage);
  return (userStakeLamports * dailyAllocation) / totalNetworkStakeLamports;
}

function calculateClaimableAllocations(stake, programState) {
  if (!stake || !programState) return 0;

  const accumulated = Number(stake.accumulatedAllocations) / ZARIX.LAMPORTS_PER_TOKEN;
  const genesisTimestamp = programState.genesisTimestamp || 0n;
  const active = isStakeActive(stake.isPending, stake.activationEpoch, genesisTimestamp);
  if (!active) return 0;

  const currentEpoch = calculateCurrentEpoch(genesisTimestamp);
  const activationEpoch = Number(stake.activationEpoch);
  const rawLastAllocationEpoch = Number(stake.lastAllocationEpoch);

  const lastAllocationEpoch = (rawLastAllocationEpoch > 0 && rawLastAllocationEpoch >= activationEpoch)
    ? rawLastAllocationEpoch : Math.max(activationEpoch - 1, 0);

  const startEpoch = Math.max(lastAllocationEpoch + 1, activationEpoch);

  const lockEndTimestamp = Number(stake.lockEndTimestamp);
  const maxAccrualSecs = ZARIX.MAX_REWARD_ACCRUAL_YEARS * ZARIX.SECONDS_PER_YEAR;
  const accrualCutoffTimestamp = lockEndTimestamp + maxAccrualSecs;
  const accrualCutoffEpoch = Math.floor(
    (accrualCutoffTimestamp - Number(genesisTimestamp)) / ZARIX.EPOCH_DURATION_SECONDS
  );

  const idealEndEpoch = Math.min(currentEpoch - 1, accrualCutoffEpoch, startEpoch + ZARIX.MAX_EPOCHS_PER_CLAIM - 1);
  if (startEpoch > idealEndEpoch) return accumulated;

  const totalStaked = Number(programState.totalNetworkStaked) / ZARIX.LAMPORTS_PER_TOKEN;
  if (totalStaked <= 0) return accumulated;

  const originalAmount = Number(stake.amount) / ZARIX.LAMPORTS_PER_TOKEN;
  const totalWithdrawn = Number(stake.totalWithdrawn) / ZARIX.LAMPORTS_PER_TOKEN;
  const remainingStake = originalAmount - totalWithdrawn;
  if (remainingStake <= 0) return accumulated;

  let totalPendingLamports = 0n;
  const stakerPercentage = programState.stakerAllocationPercentage || 75;

  for (let e = startEpoch; e <= idealEndEpoch; e++) {
    const epochSnapshotLamports = getEpochSnapshot(
      programState.epochSnapshots || [],
      programState.totalNetworkStaked || 0n,
      0n,
      e,
      currentEpoch
    );

    const epochPhase = calculateHalvingPhaseForEpoch(e);
    const epochAlloc = calculateAllocationBigInt(
      BigInt(Math.round(remainingStake * ZARIX.LAMPORTS_PER_TOKEN)),
      epochSnapshotLamports,
      epochPhase,
      stakerPercentage
    );
    totalPendingLamports += epochAlloc;
  }

  const totalPending = Number(totalPendingLamports) / ZARIX.LAMPORTS_PER_TOKEN;
  const maxPending = remainingStake * 10;
  const safePending = Math.min(totalPending, maxPending);

  return Math.max(0, accumulated + safePending);
}
