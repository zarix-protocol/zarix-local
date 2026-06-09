// solana program interaction — PDA derivation, account parsing, instruction builders
const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram,
  SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY } = SolanaBundle;
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, getAssociatedTokenAddress,
  getAccount, createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } = SolanaBundle;

const PROGRAM_ID = new PublicKey(ZARIX.PROGRAM_ID);
const TOKEN_MINT = new PublicKey(ZARIX.TOKEN_MINT);

// --- PDA derivations ---
function getProgramStatePDA() {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(ZARIX.PDA_SEEDS.PROGRAM_STATE)], PROGRAM_ID
  );
}

function getUserAccountPDA(userPubkey) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(ZARIX.PDA_SEEDS.USER_ACCOUNT), userPubkey.toBuffer()], PROGRAM_ID
  );
}

function getStakePDA(userPubkey, stakeIndex) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(stakeIndex), true);
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(ZARIX.PDA_SEEDS.STAKE), userPubkey.toBuffer(), new Uint8Array(buf)], PROGRAM_ID
  );
}

function getVaultPDA() {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(ZARIX.PDA_SEEDS.VAULT)], PROGRAM_ID
  );
}

function getVaultTokenAccount(tokenMint) {
  const [vaultPDA] = getVaultPDA();
  return getAssociatedTokenAddressSync(tokenMint, vaultPDA, true);
}

// --- account parsing ---
function parseProgramState(data) {
  const dv = new DataView(data.buffer, data.byteOffset);
  let o = 0;

  const u8 = () => { const v = data[o]; o += 1; return v; };
  const u64 = () => { const v = dv.getBigUint64(o, true); o += 8; return v; };
  const i64 = () => { const v = dv.getBigInt64(o, true); o += 8; return v; };
  const pk = () => { const k = new PublicKey(data.slice(o, o + 32)); o += 32; return k; };
  const skip = (n) => { o += n; };

  // --- Fixed fields ---
  skip(8); // discriminator
  const deployer = pk();
  const tokenMint = pk();
  const minStakeAmount = u64();
  const totalSupply = u64();
  const totalNetworkStaked = u64();
  const stakerAllocationPoolBalance = u64();
  const lpAllocationPoolBalance = u64();
  const ecosystemDevFundBalance = u64();
  const isInitialized = u8() === 1;
  const isPaused = u8() === 1;
  const genesisTimestamp = i64();
  const lastDistributionTimestamp = i64();
  const claimPeriodSeconds = i64();
  const currentHalvingPhase = u8();
  const stakerAllocationPercentage = u8();
  const timelockSeconds = i64();
  const quorumPercent = u8();
  const minVotersStandard = u64();
  const minVotersSupermajority = u64();
  const minVotersUpgrade = u64();

  // --- Proposals (variable size, must parse properly) ---
  function parseProposal(isActiveFlag) {
    if (o >= data.length) return null;

    const changeTypeDisc = u8();

    // If not active and discriminator is out of range, skip fixed 90 bytes
    if (changeTypeDisc > 16 && !isActiveFlag) {
      skip(90); // 91 total including the discriminator byte already read
      return null;
    }

    // Skip change type data based on variant
    switch (changeTypeDisc) {
      case 0: skip(8); break;   // UpdateMinStakeAmount: u64
      case 1: skip(8); break;   // UpdateClaimPeriod: i64
      case 2: skip(8); break;   // UpdateTimelock: i64
      case 3: skip(1); break;   // SetPause: bool
      case 4: skip(32); break;  // AddLPGauge: pubkey
      case 5: skip(32); break;  // DeactivateLPGauge: pubkey
      case 6: skip(1); break;   // UpdateAllocationRatio: u8
      case 7: skip(56); break;  // UpdateVotingMultipliers: 7 * u64
      case 8: skip(48); break;  // UpdateLPMultipliers: 6 * u64
      case 9: skip(8); break;   // UpdateMinVotingPowerToPropose: u64
      case 10: skip(1); break;  // UpdateQuorum: u8
      case 11: skip(24); break; // UpdateMinVoters: 3 * u64
      case 12: skip(8); break;  // AdjustEcosystemDevCap: u64
      case 13: skip(1); break;  // PauseEcosystemDev: bool
      case 14: skip(32); break; // UpdateDeveloperAddress: pubkey
      case 15: skip(80); break; // ApprovePartnership: u64 + pubkey + u64 + 32 bytes
      case 16: skip(64); break; // UpgradeProgram: pubkey + 32 bytes
      default: break;
    }

    // Common proposal fields: proposer(32) + proposedAt(8) + votesFor(8) + votesAgainst(8) + totalVoted(8) + executionTimestamp(8) + isActive(1) + isExecuted(1) + uniqueVoterCount(8) + snapshotTotalStaked(8)
    skip(32 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 8 + 8); // = 90

    return null; // We don't need proposal data for staking
  }

  const hasStd = u8() === 1;
  parseProposal(hasStd);

  const hasCrit = u8() === 1;
  parseProposal(hasCrit);

  const hasUpg = u8() === 1;
  parseProposal(hasUpg);

  // --- Post-proposal fields ---
  const minVotingPowerToPropose = u64();
  const pendingUpgradeBuffer = pk();
  skip(32); // pendingUpgradeCodeHash
  const pendingNetworkStake = u64();

  // Epoch snapshots (45 entries)
  const epochSnapshots = [];
  for (let i = 0; i < 45; i++) {
    epochSnapshots.push(u64());
  }

  const currentSnapshotIndex = u8();
  const lastEpochProcessed = u64();

  return {
    deployer, tokenMint, minStakeAmount, totalSupply, totalNetworkStaked,
    stakerAllocationPoolBalance, lpAllocationPoolBalance,
    isInitialized, isPaused, genesisTimestamp, claimPeriodSeconds,
    currentHalvingPhase, stakerAllocationPercentage,
    pendingNetworkStake, epochSnapshots, lastEpochProcessed,
  };
}

function parseUserAccount(data) {
  let o = 8; // skip discriminator
  const dv = new DataView(data.buffer, data.byteOffset);
  const pk = new PublicKey(data.slice(o, o + 32)); o += 32;
  const isActivated = data[o] === 1; o += 1;
  const nextStakeIndex = dv.getBigUint64(o, true); o += 8;
  const activeStakeCount = dv.getBigUint64(o, true); o += 8;
  const totalAllocatedAllocations = dv.getBigUint64(o, true); o += 8;
  const votingPower = dv.getBigUint64(o, true); o += 8;
  const firstStakeTimestamp = dv.getBigInt64(o, true); o += 8;
  o += 24; // skip last voted proposals
  const totalStakedAmount = o + 8 <= data.length ? dv.getBigUint64(o, true) : 0n;
  return { owner: pk, isActivated, nextStakeIndex, activeStakeCount, votingPower, totalStakedAmount };
}

function parseStake(data) {
  const dv = new DataView(data.buffer, data.byteOffset);
  let o = 8; // skip discriminator
  const owner = new PublicKey(data.slice(o, o + 32)); o += 32;
  const stakeIndex = dv.getBigUint64(o, true); o += 8;
  const amount = dv.getBigUint64(o, true); o += 8;
  const startTimestamp = dv.getBigInt64(o, true); o += 8;
  const lockDurationDays = dv.getBigUint64(o, true); o += 8;
  const lockEndTimestamp = dv.getBigInt64(o, true); o += 8;
  const lastClaimTimestamp = dv.getBigInt64(o, true); o += 8;
  const totalWithdrawn = dv.getBigUint64(o, true); o += 8;
  const votingPowerMultiplier = dv.getBigUint64(o, true); o += 8;
  const lastPartialUnstakeTimestamp = o + 8 <= data.length ? dv.getBigInt64(o, true) : 0n; o += 8;
  const isClosed = o < data.length ? data[o] === 1 : false; o += 1;
  const isPending = o < data.length ? data[o] === 1 : false; o += 1;
  const activationEpoch = o + 8 <= data.length ? dv.getBigUint64(o, true) : 0n; o += 8;
  const accumulatedAllocations = o + 8 <= data.length ? dv.getBigUint64(o, true) : 0n; o += 8;
  const lastAllocationEpoch = o + 8 <= data.length ? dv.getBigUint64(o, true) : 0n; o += 8;
  const totalClaimedAllocations = o + 8 <= data.length ? dv.getBigUint64(o, true) : 0n;
  return {
    owner, stakeIndex, amount, startTimestamp, lockDurationDays, lockEndTimestamp,
    lastClaimTimestamp, totalWithdrawn, votingPowerMultiplier, isClosed, isPending,
    activationEpoch, accumulatedAllocations, lastAllocationEpoch, totalClaimedAllocations,
  };
}
async function fetchProgramState(connection) {
  const [pda] = getProgramStatePDA();
  const info = await connection.getAccountInfo(pda, 'confirmed');
  if (!info) return null;
  return parseProgramState(info.data);
}

async function fetchUserAccount(connection, userPubkey) {
  const [pda] = getUserAccountPDA(userPubkey);
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  return parseUserAccount(info.data);
}

async function fetchAllUserStakes(connection, userPubkey) {
  const userAccount = await fetchUserAccount(connection, userPubkey);
  if (!userAccount) return [];
  const count = Number(userAccount.nextStakeIndex);
  if (count === 0) return [];

  const pdas = [];
  for (let i = 0n; i < BigInt(count); i++) {
    const [pda] = getStakePDA(userPubkey, i);
    pdas.push(pda);
  }

  const infos = await connection.getMultipleAccountsInfo(pdas);
  const stakes = [];
  for (const info of infos) {
    if (!info) continue;
    try {
      const s = parseStake(info.data);
      if (!s.isClosed) stakes.push(s);
    } catch(e) { console.error('Parse stake error:', e); }
  }
  return stakes;
}

// instruction builders
function createPreFundInstruction(from, to, lamports) {
  return SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports });
}

function createStakeInstruction(userPubkey, userTokenAccount, amount, lockDurationDays, stakeIndex) {
  const [programStatePDA] = getProgramStatePDA();
  const [userAccountPDA] = getUserAccountPDA(userPubkey);
  const [stakePDA] = getStakePDA(userPubkey, stakeIndex);
  const [vaultPDA] = getVaultPDA();
  const vaultTokenAccount = getVaultTokenAccount(TOKEN_MINT);

  const data = new Uint8Array(17);
  const dv = new DataView(data.buffer);
  dv.setUint8(0, InstructionType.Stake);
  dv.setBigUint64(1, BigInt(amount), true);
  dv.setBigUint64(9, BigInt(lockDurationDays), true);

  return new TransactionInstruction({
    keys: [
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: userAccountPDA, isSigner: false, isWritable: true },
      { pubkey: stakePDA, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: programStatePDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data,
  });
}

function createClaimInstruction(userPubkey, userTokenAccount, stakeIndex) {
  const [programStatePDA] = getProgramStatePDA();
  const [userAccountPDA] = getUserAccountPDA(userPubkey);
  const [stakePDA] = getStakePDA(userPubkey, stakeIndex);
  const [vaultPDA] = getVaultPDA();

  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint8(0, InstructionType.ClaimAllocation);
  dv.setBigUint64(1, BigInt(stakeIndex), true);

  return new TransactionInstruction({
    keys: [
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: userAccountPDA, isSigner: false, isWritable: true },
      { pubkey: stakePDA, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_MINT, isSigner: false, isWritable: true },
      { pubkey: programStatePDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: vaultPDA, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data,
  });
}

function createUnstakeInstruction(userPubkey, userTokenAccount, stakeIndex) {
  const [programStatePDA] = getProgramStatePDA();
  const [userAccountPDA] = getUserAccountPDA(userPubkey);
  const [stakePDA] = getStakePDA(userPubkey, stakeIndex);
  const [vaultPDA] = getVaultPDA();
  const vaultTokenAccount = getVaultTokenAccount(TOKEN_MINT);

  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint8(0, InstructionType.Unstake);
  dv.setBigUint64(1, BigInt(stakeIndex), true);

  return new TransactionInstruction({
    keys: [
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: userAccountPDA, isSigner: false, isWritable: true },
      { pubkey: stakePDA, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vaultTokenAccount, isSigner: false, isWritable: true },
      { pubkey: programStatePDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: vaultPDA, isSigner: false, isWritable: true },
    ],
    programId: PROGRAM_ID,
    data: data,
  });
}


// LP staking PDAs
function getLPGaugePDA(lpTokenMint) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(ZARIX.PDA_SEEDS.LP_GAUGE), lpTokenMint.toBuffer()], PROGRAM_ID
  );
}

function getLPStakerPDA(lpGaugePDA, userPubkey) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(ZARIX.PDA_SEEDS.LP_STAKER), lpGaugePDA.toBuffer(), userPubkey.toBuffer()], PROGRAM_ID
  );
}

function getLPStakePDA(lpGaugePDA, userPubkey, stakeIndex) {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, BigInt(stakeIndex), true);
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(ZARIX.PDA_SEEDS.LP_STAKE), lpGaugePDA.toBuffer(), userPubkey.toBuffer(), new Uint8Array(buf)], PROGRAM_ID
  );
}
function parseLPGauge(data) {
  const dv = new DataView(data.buffer, data.byteOffset);
  let o = 8; // skip discriminator
  const poolMint = new PublicKey(data.slice(o, o + 32)); o += 32;
  const totalLpStaked = dv.getBigUint64(o, true); o += 8;
  // totalWeightedLp is u128 (two u64s)
  const totalWeightedLpLow = dv.getBigUint64(o, true); o += 8;
  const totalWeightedLpHigh = dv.getBigUint64(o, true); o += 8;
  const totalWeightedLp = totalWeightedLpLow + (totalWeightedLpHigh << 64n);
  const dailyAllocation = dv.getBigUint64(o, true); o += 8;
  const lastDistributionTimestamp = dv.getBigInt64(o, true); o += 8;
  const isActive = data[o] === 1;
  return { poolMint, totalLpStaked, totalWeightedLp, dailyAllocation, lastDistributionTimestamp, isActive };
}

function parseLPStakerAccount(data) {
  const dv = new DataView(data.buffer, data.byteOffset);
  let o = 8; // skip discriminator
  const owner = new PublicKey(data.slice(o, o + 32)); o += 32;
  const gauge = new PublicKey(data.slice(o, o + 32)); o += 32;
  const nextStakeIndex = dv.getBigUint64(o, true); o += 8;
  const activeStakeCount = dv.getBigUint64(o, true); o += 8;
  const totalLpStaked = dv.getBigUint64(o, true); o += 8;
  const totalAllocatedAllocations = dv.getBigUint64(o, true);
  return { owner, gauge, nextStakeIndex, activeStakeCount, totalLpStaked, totalAllocatedAllocations };
}

function parseLPStake(data) {
  const dv = new DataView(data.buffer, data.byteOffset);
  let o = 8; // skip discriminator
  const owner = new PublicKey(data.slice(o, o + 32)); o += 32;
  const gauge = new PublicKey(data.slice(o, o + 32)); o += 32;
  const stakeIndex = dv.getBigUint64(o, true); o += 8;
  const lpAmount = dv.getBigUint64(o, true); o += 8;
  const lockDurationDays = dv.getBigUint64(o, true); o += 8;
  const lockEndTimestamp = dv.getBigInt64(o, true); o += 8;
  const lockMultiplier = dv.getBigUint64(o, true); o += 8;
  const stakeTimestamp = dv.getBigInt64(o, true); o += 8;
  const lastClaimTimestamp = dv.getBigInt64(o, true); o += 8;
  const totalAllocatedAllocations = dv.getBigUint64(o, true); o += 8;
  const isClosed = o < data.length ? data[o] === 1 : false;
  return {
    owner, gauge, stakeIndex, lpAmount, lockDurationDays, lockEndTimestamp,
    lockMultiplier, stakeTimestamp, lastClaimTimestamp, totalAllocatedAllocations, isClosed
  };
}
async function fetchAllLPGauges(connection) {

  function toBase58(bytes) {
    const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let num = 0n;
    for (const b of bytes) num = num * 256n + BigInt(b);
    let result = '';
    while (num > 0n) { const [q, r] = [num / 58n, num % 58n]; result = ALPHABET[Number(r)] + result; num = q; }
    for (const b of bytes) { if (b === 0) result = '1' + result; else break; }
    return result || '1';
  }

  const discBytes = ZARIX.DISCRIMINATORS.LP_GAUGE;
  const filters = [{ memcmp: { offset: 0, bytes: toBase58(new Uint8Array(discBytes)) } }];
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters,
  });
  const gauges = [];

  for (const { pubkey, account } of accounts) {
    try {
      const gauge = parseLPGauge(account.data);
      gauge.pda = pubkey;

      if (UI.EXCLUDED_LP_MINTS.has(gauge.poolMint.toString())) continue;
      gauges.push(gauge);
    } catch(e) { console.error('Parse LP gauge error:', e); }
  }
  return gauges;
}
async function fetchUserLPPositions(connection, userPubkey, gauges) {
  if (!gauges || gauges.length === 0) return [];
  const stakerPDAs = gauges.map(g => getLPStakerPDA(g.pda, userPubkey)[0]);
  const stakerInfos = await connection.getMultipleAccountsInfo(stakerPDAs);
  const allStakePDAs = [];
  const stakeMap = []; // track which gauge each stake belongs to

  for (let i = 0; i < gauges.length; i++) {
    if (!stakerInfos[i]) continue;
    try {
      const staker = parseLPStakerAccount(stakerInfos[i].data);
      const count = Number(staker.nextStakeIndex);
      for (let idx = 0; idx < count; idx++) {
        const [stakePDA] = getLPStakePDA(gauges[i].pda, userPubkey, idx);
        allStakePDAs.push(stakePDA);
        stakeMap.push({ gaugeIndex: i, gauge: gauges[i], staker });
      }
    } catch(e) { console.error('Parse LP staker error:', e); }
  }

  if (allStakePDAs.length === 0) return [];

  const stakeInfos = await connection.getMultipleAccountsInfo(allStakePDAs);

  const positions = [];
  for (let i = 0; i < stakeInfos.length; i++) {
    if (!stakeInfos[i]) continue;
    try {
      const stake = parseLPStake(stakeInfos[i].data);
      if (!stake.isClosed) {
        positions.push({
          ...stake,
          gaugePDA: stakeMap[i].gauge.pda,
          poolMint: stakeMap[i].gauge.poolMint,
          gaugeDailyAllocation: stakeMap[i].gauge.dailyAllocation,
          gaugeTotalLpStaked: stakeMap[i].gauge.totalLpStaked,
          gaugeTotalWeightedLp: stakeMap[i].gauge.totalWeightedLp,
          gaugeIsActive: stakeMap[i].gauge.isActive,
        });
      }
    } catch(e) { console.error('Parse LP stake error:', e); }
  }

  return positions;
}
function getLPVaultPDA(lpGaugePDA) {
  return PublicKey.findProgramAddressSync(
    [new TextEncoder().encode(ZARIX.PDA_SEEDS.LP_VAULT), lpGaugePDA.toBuffer()], PROGRAM_ID
  );
}

// LP instruction builders
function createStakeLPInstruction(userPubkey, userLpTokenAccount, lpTokenMint, amount, lockDurationDays, stakeIndex) {
  const [programStatePDA] = getProgramStatePDA();
  const [lpGaugePDA] = getLPGaugePDA(lpTokenMint);
  const [lpVaultPDA] = getLPVaultPDA(lpGaugePDA);
  const [lpStakerPDA] = getLPStakerPDA(lpGaugePDA, userPubkey);
  const [lpStakePDA] = getLPStakePDA(lpGaugePDA, userPubkey, stakeIndex);
  const lpVaultAta = getAssociatedTokenAddressSync(lpTokenMint, lpVaultPDA, true);

  const data = new Uint8Array(17);
  const dv = new DataView(data.buffer);
  dv.setUint8(0, InstructionType.StakeLP);
  dv.setBigUint64(1, BigInt(amount), true);
  dv.setBigUint64(9, BigInt(lockDurationDays), true);

  return new TransactionInstruction({
    keys: [
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: lpStakerPDA, isSigner: false, isWritable: true },
      { pubkey: lpStakePDA, isSigner: false, isWritable: true },
      { pubkey: lpGaugePDA, isSigner: false, isWritable: true },
      { pubkey: userLpTokenAccount, isSigner: false, isWritable: true },
      { pubkey: lpVaultAta, isSigner: false, isWritable: true },
      { pubkey: programStatePDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data,
  });
}

function createClaimLPAllocationsInstruction(userPubkey, userZarixTokenAccount, lpTokenMint, stakeIndex) {
  const [programStatePDA] = getProgramStatePDA();
  const [lpGaugePDA] = getLPGaugePDA(lpTokenMint);
  const [lpStakerPDA] = getLPStakerPDA(lpGaugePDA, userPubkey);
  const [lpStakePDA] = getLPStakePDA(lpGaugePDA, userPubkey, stakeIndex);
  const [vaultPDA] = getVaultPDA();

  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint8(0, InstructionType.ClaimLPAllocations);
  dv.setBigUint64(1, BigInt(stakeIndex), true);

  return new TransactionInstruction({
    keys: [
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: lpStakerPDA, isSigner: false, isWritable: true },
      { pubkey: lpStakePDA, isSigner: false, isWritable: true },
      { pubkey: lpGaugePDA, isSigner: false, isWritable: true },
      { pubkey: userZarixTokenAccount, isSigner: false, isWritable: true },
      { pubkey: TOKEN_MINT, isSigner: false, isWritable: true },
      { pubkey: programStatePDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: vaultPDA, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data,
  });
}

function createUnstakeLPInstruction(userPubkey, userLpTokenAccount, lpTokenMint, stakeIndex) {
  const [programStatePDA] = getProgramStatePDA();
  const [lpGaugePDA] = getLPGaugePDA(lpTokenMint);
  const [lpVaultPDA] = getLPVaultPDA(lpGaugePDA);
  const [lpStakerPDA] = getLPStakerPDA(lpGaugePDA, userPubkey);
  const [lpStakePDA] = getLPStakePDA(lpGaugePDA, userPubkey, stakeIndex);
  const lpVaultAta = getAssociatedTokenAddressSync(lpTokenMint, lpVaultPDA, true);

  const data = new Uint8Array(9);
  const dv = new DataView(data.buffer);
  dv.setUint8(0, InstructionType.UnstakeLP);
  dv.setBigUint64(1, BigInt(stakeIndex), true);

  return new TransactionInstruction({
    keys: [
      { pubkey: userPubkey, isSigner: true, isWritable: true },
      { pubkey: lpStakerPDA, isSigner: false, isWritable: true },
      { pubkey: lpStakePDA, isSigner: false, isWritable: true },
      { pubkey: lpGaugePDA, isSigner: false, isWritable: true },
      { pubkey: userLpTokenAccount, isSigner: false, isWritable: true },
      { pubkey: lpVaultAta, isSigner: false, isWritable: true },
      { pubkey: lpVaultPDA, isSigner: false, isWritable: false },
      { pubkey: programStatePDA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_CLOCK_PUBKEY, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data,
  });
}
