
(function() {
  'use strict';
  const state = {
    wallet: null,
    publicKey: null,
    connection: null,
    programState: null,
    userAccount: null,
    userStakes: [],
    tokenBalance: 0,
    selectedLockDays: 365,
    rpcUrl: localStorage.getItem(UI.STORAGE.RPC_URL) || UI.APP.PROXY_URL,
    refreshInterval: null,
  };
  function showToast(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const icons = { success: '✅', error: '❌', info: 'ℹ️', loading: '⏳' };
    const icon = document.createElement('span');
    icon.textContent = icons[type] || '';
    const msg = document.createElement('span');
    msg.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(msg);
    container.appendChild(toast);
    if (type !== 'loading') {
      setTimeout(() => {
        toast.style.animation = 'toastOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
      }, duration);
    }
    return toast;
  }
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-' + view).classList.add('active');
      if (view === 'transactions' && state.publicKey) {
        if (!isPremiumRPC()) premiumRpcGate('tx-list', 'Transaction history');
        else fetchRecentTransactions();
      }
      if (view === 'lp' && state.publicKey) {
        if (!isPremiumRPC()) premiumRpcGate('lp-gauges', 'LP Staker');
        else fetchLPStakerData();
      }
    });
  });
  async function pollConfirmation(signature, maxRetries = UI.TIME.POLL_MAX_RETRIES) {
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(r => setTimeout(r, UI.TIME.POLL_INTERVAL_MS));
      try {
        const resp = await state.connection.getSignatureStatuses([signature]);
        const status = resp && resp.value && resp.value[0];
        if (status) {
          if (status.err) throw new Error('Transaction failed: ' + JSON.stringify(status.err));
          if (status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized') {
            return status;
          }
        }
      } catch(e) {
        if (e.message.includes('Transaction failed')) throw e;
        // RPC error, retry
      }
    }
    throw new Error('Transaction confirmation timeout — check Solscan for tx: ' + signature);
  }
  function isPremiumRPC() {
    const target = localStorage.getItem(UI.STORAGE.RPC_TARGET) || '';
    const url = (target || state.rpcUrl).toLowerCase();
    return UI.PREMIUM_RPC_PROVIDERS.some(p => url.includes(p));
  }

  function emptyState(msg) {
    return '<div class="empty-state"><p>' + msg + '</p></div>';
  }

  function shortenMint(addr) {
    return addr.slice(0, 6) + '...' + addr.slice(-4);
  }

  function getHalvingCtx() {
    const ps = state.programState;
    if (!ps) return { epoch: 0, phase: 0, stakerPct: 75 };
    const epoch = calculateCurrentEpoch(ps.genesisTimestamp);
    return { epoch, phase: calculateHalvingPhase(epoch), stakerPct: ps.stakerAllocationPercentage || 75 };
  }

  function getDailyLpAllocation() {
    const { phase, stakerPct } = getHalvingCtx();
    const total = ZARIX.TOTAL_DAILY_ALLOCATION / Math.pow(2, Math.min(phase, 3));
    return total * (100 - stakerPct) / 100;
  }

  function getDailyLpAllocationLamports() {
    const { phase, stakerPct } = getHalvingCtx();
    const baseLamports = ZARIX.TOTAL_DAILY_ALLOCATION * ZARIX.LAMPORTS_PER_TOKEN;
    const total = baseLamports / Math.pow(2, Math.min(phase, 3));
    return total - Math.floor((total * stakerPct) / 100);
  }

  async function signAndConfirm(tx) {
    tx.feePayer = state.publicKey;
    const { blockhash } = await state.connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    const signed = await state.wallet.signTransaction(tx);
    const sig = await state.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await pollConfirmation(sig);
    return sig;
  }

  function premiumRpcGate(elementId, featureName) {
    document.getElementById(elementId).innerHTML =
      '<div class="empty-state">' +
      '<p>\uD83D\uDD12 ' + featureName + ' requires a <strong>Helius</strong> or <strong>QuickNode</strong> RPC.</p>' +
      '<p style="margin-top:8px;color:var(--text-tertiary);font-size:0.8rem;">Go to \u2699\uFE0F Settings and paste your RPC URL to enable this feature.</p>' +
      '</div>';
  }
  function initConnection() {
    state.connection = new Connection(state.rpcUrl, {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout: 60000,
    });
    const target = localStorage.getItem(UI.STORAGE.RPC_TARGET) || '';
    const isProxy = state.rpcUrl.includes(UI.APP.API_SET_RPC.replace('/set', ''));

    if (isProxy && target) {
      fetch(UI.APP.API_SET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpc_url: target }),
      }).catch(() => {});
    }

    let label = 'Custom';
    if (isProxy && !target) label = 'Local Proxy → Solana Public';
    else if (isProxy && target.includes('helius')) label = 'Local Proxy → Helius';
    else if (isProxy && target.includes('quicknode')) label = 'Local Proxy → QuickNode';
    else if (isProxy && target) label = 'Local Proxy → Custom';
    else if (state.rpcUrl.includes('helius')) label = 'Helius';
    document.getElementById('footer-rpc').textContent = '🔗 RPC: ' + label;
    document.getElementById('rpc-url').value = isProxy ? (target || UI.APP.DEFAULT_SOLANA_RPC) : state.rpcUrl;
  }
  function getProvider() {
    if (window.phantom?.solana?.isPhantom) return window.phantom.solana;
    if (window.solana?.isPhantom) return window.solana;
    if (window.jupiter?.solana) return window.jupiter.solana;
    if (window.solflare?.isSolflare) return window.solflare;
    return null;
  }

  function getDetectedWalletName() {
    if (window.phantom?.solana?.isPhantom || window.solana?.isPhantom) return 'Phantom';
    if (window.jupiter?.solana) return 'Jupiter';
    if (window.solflare?.isSolflare) return 'Solflare';
    return null;
  }

  function showWalletInstallModal() {
    const existing = document.getElementById('wallet-install-modal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'wallet-install-modal';
    overlay.className = 'wallet-modal-overlay';
    overlay.innerHTML =
      '<div class="wallet-modal glass-card">' +
        '<button class="wallet-modal-close" id="wallet-modal-close">✕</button>' +
        '<div class="wallet-modal-icon">🔌</div>' +
        '<h2>Wallet Required</h2>' +
        '<p>Install a Solana wallet extension to connect. Your keys stay safe in the extension — ZARIX never touches them.</p>' +
        '<div class="wallet-modal-options">' +
          '<a href="https://chrome.google.com/webstore/detail/phantom/bfnaelmomeimhlpmgjnjophhpkkoljpa" target="_blank" rel="noopener" class="wallet-option">' +
            '<div class="wallet-option-icon">👻</div>' +
            '<div class="wallet-option-info">' +
              '<strong>Phantom</strong>' +
              '<span>Most popular Solana wallet</span>' +
            '</div>' +
            '<span class="wallet-option-badge">Recommended</span>' +
          '</a>' +
          '<a href="https://chrome.google.com/webstore/detail/jupiter/cahgpbdpcmcojmackchfkoapghijbfag" target="_blank" rel="noopener" class="wallet-option">' +
            '<div class="wallet-option-icon">🪐</div>' +
            '<div class="wallet-option-info">' +
              '<strong>Jupiter</strong>' +
              '<span>Built-in swap + wallet</span>' +
            '</div>' +
            '<span class="wallet-option-badge secondary">Alternative</span>' +
          '</a>' +
        '</div>' +
        '<p class="wallet-modal-hint">After installing, refresh this app to connect.</p>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('wallet-modal-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  async function connectWallet() {
    const provider = getProvider();
    if (!provider) {
      showWalletInstallModal();
      return;
    }
    try {
      const resp = await provider.connect();
      state.wallet = provider;
      state.publicKey = new PublicKey(resp.publicKey.toString());

      document.getElementById('status-indicator').className = 'status-dot online';
      document.getElementById('btn-connect').classList.add('hidden');
      document.getElementById('btn-disconnect').classList.remove('hidden');
      document.getElementById('wallet-address').textContent = shortenAddress(state.publicKey.toString());
      document.getElementById('connect-prompt').classList.add('hidden');
      document.getElementById('dashboard-content').classList.remove('hidden');

      const walletName = getDetectedWalletName() || 'Wallet';
      showToast(walletName + ' connected!', 'success', 3000);
      await refreshAll();

      if (state.refreshInterval) clearInterval(state.refreshInterval);
      state.refreshInterval = setInterval(refreshAll, UI.TIME.REFRESH_INTERVAL_MS); 
    } catch(e) {
      showToast('Connection rejected', 'error');
    }
  }

  function disconnectWallet() {
    if (state.wallet) {
      try { state.wallet.disconnect(); } catch(e) {}
    }
    state.wallet = null;
    state.publicKey = null;
    state.userStakes = [];
    state.programState = null;
    state.userAccount = null;
    state.lpPositions = [];
    state.lpGauges = [];
    state.lpBalances = {};

    if (state.refreshInterval) clearInterval(state.refreshInterval);

    document.getElementById('status-indicator').className = 'status-dot offline';
    document.getElementById('btn-connect').classList.remove('hidden');
    document.getElementById('btn-disconnect').classList.add('hidden');
    document.getElementById('connect-prompt').classList.remove('hidden');
    document.getElementById('dashboard-content').classList.add('hidden');

    showToast('Wallet disconnected', 'info', 3000);
  }
  async function refreshAll() {
    if (!state.publicKey || !state.connection) return;
    try {
      state.programState = await fetchProgramState(state.connection);

      state.userStakes = await fetchAllUserStakes(state.connection, state.publicKey);

      try {
        const ata = getAssociatedTokenAddressSync(TOKEN_MINT, state.publicKey, false);
        const acc = await getAccount(state.connection, ata);
        state.tokenBalance = Number(acc.amount) / ZARIX.LAMPORTS_PER_TOKEN;
      } catch(e) {
        state.tokenBalance = 0;
      }

      updateDashboard();
      updateStakeForm();
    } catch(e) {
      console.error('Refresh error:', e);
      showToast('Failed to fetch data: ' + e.message, 'error');
    }
  }
  function updateDashboard() {
    const ps = state.programState;
    if (!ps) return;

    document.getElementById('stat-balance').textContent = Math.floor(state.tokenBalance).toLocaleString();

    let totalUserStaked = 0;
    let totalVotingPower = 0;
    let totalClaimable = 0;

    state.userStakes.forEach(s => {
      const amt = Number(s.amount) / ZARIX.LAMPORTS_PER_TOKEN;
      const withdrawn = Number(s.totalWithdrawn) / ZARIX.LAMPORTS_PER_TOKEN;
      const remaining = amt - withdrawn;
      totalUserStaked += remaining;
      totalVotingPower += remaining * (Number(s.votingPowerMultiplier) / 1000);
      totalClaimable += calculateClaimableAllocations(s, ps);
    });

    document.getElementById('stat-staked').textContent = Math.floor(totalUserStaked).toLocaleString();
    document.getElementById('stat-stakes-count').textContent = state.userStakes.length + ' active stake(s)';
    document.getElementById('stat-voting').textContent = Math.floor(totalVotingPower).toLocaleString();

    const totalNet = Number(ps.totalNetworkStaked) / ZARIX.LAMPORTS_PER_TOKEN;
    const share = totalNet > 0 ? ((totalUserStaked / totalNet) * 100).toFixed(UI.DECIMALS.PRECISE) : '0';
    document.getElementById('stat-network-share').textContent = share + '% of network';

    document.getElementById('stat-claimable').textContent = formatPrecise(totalClaimable);
    const { epoch, phase, stakerPct } = getHalvingCtx();
    const estDaily = calculateEstimatedDaily(totalUserStaked, totalNet, phase, stakerPct);
    document.getElementById('stat-daily-est').textContent = '~' + formatCompact(estDaily) + ' ' + UI.STRINGS.TOKEN + '/day';

    document.getElementById('net-total-staked').textContent = Math.floor(totalNet).toLocaleString() + ' ' + UI.STRINGS.TOKEN;
    document.getElementById('net-halving').textContent = 'Phase ' + phase;
    const dailyEmission = getDailyStakerAllocation(phase, stakerPct);
    document.getElementById('net-daily-emission').textContent = Math.floor(dailyEmission).toLocaleString() + ' ' + UI.STRINGS.TOKEN;
    document.getElementById('net-epoch').textContent = epoch.toLocaleString();

    renderStakes();
  }
  async function fetchRecentTransactions() {
    if (!state.publicKey || !state.connection) return;
    const container = document.getElementById('tx-list');
    container.innerHTML = '<div class="empty-state"><p><span class="spinner"></span> Loading ZARIX transactions...</p></div>';

    try {
      const allRawSigs = [];

      try {
        const [userAccountPDA] = getUserAccountPDA(state.publicKey);
        const stakeSigs = await state.connection.getSignaturesForAddress(userAccountPDA, { limit: 15 });
        if (stakeSigs) allRawSigs.push(...stakeSigs);
      } catch(e) { console.log('No staking PDA sigs:', e.message); }

      try {
        let gauges = state.lpGauges;
        if (!gauges || gauges.length === 0) {
          gauges = await fetchAllLPGauges(state.connection);
          state.lpGauges = gauges; // Cache for reuse across tabs
        }
        if (gauges && gauges.length > 0) {
          for (const g of gauges) {
            try {
              const [lpStakerPDA] = getLPStakerPDA(g.pda, state.publicKey);
              const lpSigs = await state.connection.getSignaturesForAddress(lpStakerPDA, { limit: 15 });
              if (lpSigs) allRawSigs.push(...lpSigs);
            } catch(e) {}
          }
        }
      } catch(e) { console.log('LP gauge fetch for txs:', e.message); }

      try {
        const zarixATA = getAssociatedTokenAddressSync(TOKEN_MINT, state.publicKey, false);
        const ataSigs = await state.connection.getSignaturesForAddress(zarixATA, { limit: 20 });
        if (ataSigs) allRawSigs.push(...ataSigs);
      } catch(e) { console.log('No ATA sigs:', e.message); }

      const seen = new Set();
      const uniqueSigs = [];
      for (const s of allRawSigs) {
        if (!seen.has(s.signature)) {
          seen.add(s.signature);
          uniqueSigs.push(s);
        }
      }

      uniqueSigs.sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0));
      const sigs = uniqueSigs.slice(0, 15);

      if (sigs.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No ZARIX transactions found.</p></div>';
        return;
      }

      const programId = ZARIX.PROGRAM_ID;
      const tokenMint = ZARIX.TOKEN_MINT;
      const walletAddr = state.publicKey.toString();
      const zarixTxs = [];

      const parsedResults = await Promise.allSettled(
        sigs.map(s => state.connection.getParsedTransaction(s.signature, { maxSupportedTransactionVersion: 0 }))
      );

      for (let i = 0; i < sigs.length; i++) {
        const result = parsedResults[i];
        const parsed = result.status === 'fulfilled' ? result.value : null;

        if (!parsed) {
          const memo = sigs[i].memo || '';
          let type = classifyFromMemo(memo);
          zarixTxs.push({ sig: sigs[i].signature, time: sigs[i].blockTime, err: sigs[i].err,
            type, zarixAmount: 0, amountSign: '' });
          continue;
        }

        const instructions = parsed.transaction?.message?.instructions || [];

        let type = { cls: 'other', label: 'Program' };
        for (const ix of instructions) {
          const ixProgram = ix.programId?.toString?.() || ix.programId || '';
          if (ixProgram === programId && ix.data) {
            try {
              let bytes;
              if (typeof SolanaBundle !== 'undefined' && SolanaBundle.bs58) {
                bytes = SolanaBundle.bs58.decode(ix.data);
              } else {
                bytes = Uint8Array.from(atob(ix.data), c => c.charCodeAt(0));
              }
              const disc = bytes[0];
              if (disc === 1) type = { cls: 'stake', label: 'Stake' };
              else if (disc === 2) type = { cls: 'claim', label: 'Claim' };
              else if (disc === 3) type = { cls: 'unstake', label: 'Unstake' };
              else if (disc === 4) type = { cls: 'unstake', label: 'Partial Unstake' };
              else if (disc === 7) type = { cls: 'stake', label: 'LP Stake' };
              else if (disc === 8) type = { cls: 'claim', label: 'LP Claim' };
              else if (disc === 9) type = { cls: 'unstake', label: 'LP Unstake' };
            } catch(e) {}
            break;
          }
        }

        let zarixAmount = 0, amountSign = '';
        const pre = parsed.meta?.preTokenBalances || [];
        const post = parsed.meta?.postTokenBalances || [];
        for (const postBal of post) {
          const mint = postBal.mint?.toString?.() || postBal.mint || '';
          const owner = postBal.owner?.toString?.() || postBal.owner || '';
          if (mint !== tokenMint || owner !== walletAddr) continue;
          const preBal = pre.find(p => p.accountIndex === postBal.accountIndex);
          const preAmt = preBal ? parseFloat(preBal.uiTokenAmount?.uiAmountString || '0') : 0;
          const postAmt = parseFloat(postBal.uiTokenAmount?.uiAmountString || '0');
          const diff = postAmt - preAmt;
          if (Math.abs(diff) > 0.001) {
            zarixAmount = Math.abs(diff);
            amountSign = diff > 0 ? '+' : '-';
          }
        }

        if (type.label === 'Program') {
          let dexLabel = '';
          for (const ix of instructions) {
            const ixProg = ix.programId?.toString?.() || ix.programId || '';
            if (UI.KNOWN_DEX_PROGRAMS[ixProg]) { dexLabel = UI.KNOWN_DEX_PROGRAMS[ixProg]; break; }
          }

          if (dexLabel) {
            type = { cls: dexLabel === 'Liquidity' ? 'transfer' : 'other', label: dexLabel };
          } else {
            // Classify from memo
            const memo = sigs[i].memo || '';
            type = classifyFromMemo(memo);
            // If still 'Program', use balance direction
            if (type.label === 'Program' && zarixAmount > 0) {
              type = amountSign === '+'
                ? { cls: 'claim', label: 'Receive' }
                : { cls: 'unstake', label: 'Send' };
            }
          }
        }

        zarixTxs.push({ sig: sigs[i].signature, time: sigs[i].blockTime, err: sigs[i].err,
          type, zarixAmount, amountSign });
      }

      if (zarixTxs.length > 0) {
        renderZarixTxs(zarixTxs);
      } else {
        container.innerHTML = '<div class="empty-state"><p>No ZARIX transactions found.</p></div>';
      }

    } catch(e) {
      console.error('fetchRecentTransactions:', e);
      container.innerHTML = '<div class="empty-state"><p>Failed to load transactions.</p></div>';
    }
  }

  function classifyFromMemo(memo) {
    const m = memo.toLowerCase();
    if (m.includes('claim')) return { cls: 'claim', label: 'Claim' };
    if (m.includes('unstake')) return { cls: 'unstake', label: 'Unstake' };
    if (m.includes('stake')) return { cls: 'stake', label: 'Stake' };
    return { cls: 'other', label: 'Program' };
  }

  function renderZarixTxs(txs) {
    const container = document.getElementById('tx-list');
    container.innerHTML = txs.map(tx => {
      const shortSig = tx.sig.slice(0, 8) + '...' + tx.sig.slice(-6);
      const time = tx.time ? formatTxTime(tx.time) : '—';
      const statusClass = tx.err ? 'failed' : 'success';
      const statusText = tx.err ? '✕ Failed' : '✓ OK';

      let amountHtml;
      if (tx.zarixAmount > UI.THRESHOLDS.MIN_CLAIMABLE) {
        const cls = tx.amountSign === '+' ? 'tx-amount positive' : 'tx-amount negative';
        amountHtml = '<span class="' + cls + '">' + tx.amountSign + Math.floor(tx.zarixAmount).toLocaleString() + ' ' + UI.STRINGS.TOKEN + '</span>';
      } else {
        amountHtml = '<span class="tx-amount">—</span>';
      }

      return '<div class="tx-row">' +
        '<span class="tx-type ' + tx.type.cls + '">' + tx.type.label + '</span>' +
        '<span class="tx-sig"><a href="' + explorerTxUrl(tx.sig) + '" target="_blank" title="' + tx.sig + '">' + shortSig + ' ↗</a></span>' +
        amountHtml +
        '<span class="tx-time">' + time + '</span>' +
        '<span class="tx-status ' + statusClass + '">' + statusText + '</span>' +
      '</div>';
    }).join('');
  }

  function formatTxTime(blockTime) {
    const d = new Date(blockTime * 1000);
    const now = Date.now();
    const diff = (now - d.getTime()) / 1000;
    if (diff < UI.TIME.SECONDS_PER_MINUTE) return 'Just now';
    if (diff < UI.TIME.SECONDS_PER_HOUR) return Math.floor(diff / UI.TIME.SECONDS_PER_MINUTE) + 'm ago';
    if (diff < ZARIX.SECONDS_PER_DAY) return Math.floor(diff / UI.TIME.SECONDS_PER_HOUR) + 'h ago';
    if (diff < UI.TIME.SECONDS_PER_WEEK) return Math.floor(diff / ZARIX.SECONDS_PER_DAY) + 'd ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // lp staker
  async function fetchLPStakerData() {
    if (!state.publicKey || !state.connection) return;
    const gaugesEl = document.getElementById('lp-gauges');
    const positionsEl = document.getElementById('lp-positions');
    gaugesEl.innerHTML = '<div class="empty-state"><p><span class="spinner"></span> Loading LP data from chain...</p></div>';
    positionsEl.innerHTML = '';

    try {
      const gauges = await fetchAllLPGauges(state.connection);

      if (gauges.length === 0) {
        gaugesEl.innerHTML = '<div class="empty-state"><p>No LP gauges found on-chain.</p></div>';
        return;
      }

      renderLPGauges(gauges);

      state.lpGauges = gauges;
      state.lpBalances = {};

      const mintATAs = gauges.map(g => getAssociatedTokenAddressSync(g.poolMint, state.publicKey, false));
      try {
        const ataInfos = await state.connection.getMultipleAccountsInfo(mintATAs);
        for (let i = 0; i < gauges.length; i++) {
          const mint = gauges[i].poolMint.toString();
          if (ataInfos[i]) {
            try {
              if (ataInfos[i].data.length >= 72) {
                const rawAmount = ataInfos[i].data.readBigUInt64LE(64); // SPL Token amount at offset 64
                state.lpBalances[mint] = Number(rawAmount) / ZARIX.LAMPORTS_PER_TOKEN;
              } else {
                state.lpBalances[mint] = 0;
              }
            } catch(e) { state.lpBalances[mint] = 0; }
          } else {
            state.lpBalances[mint] = 0;
          }
        }
      } catch(e) {
        gauges.forEach(g => { state.lpBalances[g.poolMint.toString()] = 0; });
      }

      const poolSelect = document.getElementById('lp-pool-select');
      poolSelect.innerHTML = gauges.map((g, i) => {
        const mint = g.poolMint.toString();
        const short = shortenMint(mint);
        const bal = formatPrecise(state.lpBalances[mint] || 0);
        return '<option value="' + i + '">' + short + ' — ' + bal + ' ' + UI.STRINGS.LP + ' available</option>';
      }).join('');
      document.getElementById('lp-stake-form').style.display = '';
      updateLPBalanceHint();

      const positions = await fetchUserLPPositions(state.connection, state.publicKey, gauges);
      renderLPPositions(positions, gauges);

    } catch(e) {
      console.error('fetchLPStakerData:', e);
      gaugesEl.innerHTML = '<div class="empty-state"><p>Failed to load LP data: ' + (e.message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p></div>';
    }
  }

  function updateLPBalanceHint() {
    if (!state.lpGauges || !state.lpBalances) return;
    const idx = parseInt(document.getElementById('lp-pool-select').value);
    const gauge = state.lpGauges[idx];
    if (!gauge) return;
    const mint = gauge.poolMint.toString();
    const bal = state.lpBalances[mint] || 0;
    document.getElementById('lp-balance-hint').textContent = 'Available: ' + formatPrecise(bal) + ' ' + UI.STRINGS.LP;
  }

  function renderLPGauges(gauges) {
    const el = document.getElementById('lp-gauges');
    const activeGauges = gauges.filter(g => g.isActive);
    const totalLpStaked = gauges.reduce((s, g) => s + Number(g.totalLpStaked), 0) / ZARIX.LAMPORTS_PER_TOKEN;
    const totalDailyAlloc = getDailyLpAllocation();

    el.innerHTML =
      '<div class="lp-summary-cards">' +
        '<div class="stat-card glass-card">' +
          '<div class="stat-label">LP Gauges</div>' +
          '<div class="stat-value">' + gauges.length + '</div>' +
          '<div class="stat-sub">' + activeGauges.length + ' active</div>' +
        '</div>' +
        '<div class="stat-card glass-card">' +
          '<div class="stat-label">Total LP Staked</div>' +
          '<div class="stat-value">' + Math.floor(totalLpStaked).toLocaleString() + '</div>' +
          '<div class="stat-sub">across all gauges</div>' +
        '</div>' +
        '<div class="stat-card glass-card">' +
          '<div class="stat-label">Daily LP Allocation</div>' +
          '<div class="stat-value">' + Math.floor(totalDailyAlloc).toLocaleString() + '</div>' +
          '<div class="stat-sub">ZARIX / day</div>' +
        '</div>' +
      '</div>' +
      '<div class="lp-gauge-list">' +
        '<h3>Gauge Details</h3>' +
        '<div class="gauge-cards">' +
          gauges.map(g => {
            const lpStaked = Number(g.totalLpStaked) / ZARIX.LAMPORTS_PER_TOKEN;
            const gaugeWeighted = Number(g.totalWeightedLp || 0n);
            const globalWeighted = gauges.reduce((s, gg) => s + Number(gg.totalWeightedLp || 0n), 0);
            const sharePercent = globalWeighted > 0 ? (gaugeWeighted / globalWeighted) * 100 : 0;
            const perGaugeDaily = totalDailyAlloc * (sharePercent / 100);
            const mintStr = g.poolMint.toString();
            const shortMint = shortenMint(mintStr);
            return '<div class="gauge-card glass-card">' +
              '<div class="gauge-card-top">' +
                '<div class="gauge-card-identity">' +
                  '<span class="tx-badge ' + (g.isActive ? 'stake' : 'other') + '">' + (g.isActive ? '● Active' : '○ Inactive') + '</span>' +
                  '<a href="' + explorerAccountUrl(mintStr) + '" target="_blank" rel="noopener" class="lp-pool-link">' + shortMint + ' ↗</a>' +
                '</div>' +
              '</div>' +
              '<div class="gauge-card-stats">' +
                '<div class="gauge-stat">' +
                  '<span class="gauge-stat-label">LP Staked</span>' +
                  '<span class="gauge-stat-value">' + Math.floor(lpStaked).toLocaleString() + '</span>' +
                '</div>' +
                '<div class="gauge-stat">' +
                  '<span class="gauge-stat-label">Daily Allocation</span>' +
                  '<span class="gauge-stat-value accent">' + Math.floor(perGaugeDaily).toLocaleString() + ' <small>' + UI.STRINGS.TOKEN + '</small></span>' +
                '</div>' +
              '</div>' +
              '<div class="gauge-share-bar">' +
                '<div class="gauge-share-header">' +
                  '<span>Network Share</span>' +
                  '<span class="gauge-share-pct">' + sharePercent.toFixed(UI.DECIMALS.MULTIPLIER) + '%</span>' +
                '</div>' +
                '<div class="gauge-share-track">' +
                  '<div class="gauge-share-fill" style="width:' + Math.min(sharePercent, 100) + '%"></div>' +
                '</div>' +
              '</div>' +
            '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  function renderLPPositions(positions, gauges) {
    const el = document.getElementById('lp-positions');

    if (positions.length === 0) {
      el.innerHTML = '<div class="empty-state" style="margin-top:16px"><p>No active LP positions for your wallet.</p></div>';
      return;
    }

    state.lpPositions = positions;
    state.lpGauges = gauges;

    const now = Math.floor(Date.now() / 1000);

    const dailyLpAllocationLamports = getDailyLpAllocationLamports();
    const globalTotalWeightedLamports = gauges.reduce((s, g) => s + Number(g.totalWeightedLp || 0n), 0);

    const posData = positions.map((p, i) => {
      const lpAmt = Number(p.lpAmount) / ZARIX.LAMPORTS_PER_TOKEN;
      const lockDays = Number(p.lockDurationDays);
      const lockEnd = Number(p.lockEndTimestamp);
      const isLocked = lockDays > 0 && lockEnd > now;
      const multiplier = Number(p.lockMultiplier) / 1000;
      const stakeIdx = Number(p.stakeIndex);
      const mintStr = p.poolMint.toString();
      const shortMint = shortenMint(mintStr);

      const userWeightedLamports = (Number(p.lpAmount) * Number(p.lockMultiplier)) / 1000;

      const dailyRewardLamports = globalTotalWeightedLamports > 0
        ? Math.floor((userWeightedLamports * dailyLpAllocationLamports) / globalTotalWeightedLamports)
        : 0;
      const dailyShare = dailyRewardLamports / ZARIX.LAMPORTS_PER_TOKEN;

      const lastClaim = Number(p.lastClaimTimestamp);
      const sinceLastClaim = lastClaim > 0 ? (now - lastClaim) : (now - Number(p.stakeTimestamp));
      const daysSinceLastClaim = Math.max(Math.floor(sinceLastClaim / ZARIX.SECONDS_PER_DAY), 0);
      const claimable = dailyShare * daysSinceLastClaim;

      const totalClaimed = Number(p.totalAllocatedAllocations) / ZARIX.LAMPORTS_PER_TOKEN;

      const stakedDate = new Date(Number(p.stakeTimestamp) * 1000).toLocaleDateString('en-US', UI.DATE_FORMAT);
      const lockEndDate = lockDays > 0 ? new Date(lockEnd * 1000).toLocaleDateString('en-US', UI.DATE_FORMAT) : '—';
      const lastClaimDate = lastClaim > 0
        ? new Date(lastClaim * 1000).toLocaleString('en-US', { ...UI.DATE_FORMAT, hour: 'numeric', minute: '2-digit', hour12: true })
        : 'Never';

      const effectiveLastClaim = lastClaim > 0 ? lastClaim : Number(p.stakeTimestamp);
      const nextClaimTimestamp = effectiveLastClaim + ZARIX.SECONDS_PER_DAY;
      let nextClaimLabel = '';
      if (daysSinceLastClaim >= 1) {
        nextClaimLabel = '✅ Available Now';
      } else {
        const secsLeft = Math.max(nextClaimTimestamp - now, 0);
        nextClaimLabel = '⏳ ' + formatDuration(secsLeft);
      }
      const nextClaimIsReady = daysSinceLastClaim >= 1;

      let timeRemaining = '';
      if (isLocked) {
        const rem = lockEnd - now;
        const d = Math.floor(rem / ZARIX.SECONDS_PER_DAY);
        const h = Math.floor((rem % ZARIX.SECONDS_PER_DAY) / UI.TIME.SECONDS_PER_HOUR);
        if (d > 365) { const y = Math.floor(d / 365); const dd = d % 365; timeRemaining = y + 'y ' + dd + 'd'; }
        else if (d > 0) timeRemaining = d + 'd ' + h + 'h';
        else timeRemaining = h + 'h';
      }

      return { lpAmt, lockDays, lockEnd, isLocked, multiplier, stakeIdx, mintStr, shortMint,
        dailyShare, claimable, totalClaimed, stakedDate, lockEndDate, lastClaimDate, nextClaimLabel, nextClaimIsReady, timeRemaining };
    });

    const totalClaimable = posData.reduce((s, p) => s + p.claimable, 0);
    const totalStaked = posData.reduce((s, p) => s + p.lpAmt, 0);

    el.innerHTML =
      '<div class="lp-pos-summary glass-card">' +
        '<div class="lp-pos-summary-item">' +
          '<span class="lp-pos-summary-label">Positions</span>' +
          '<span class="lp-pos-summary-value">' + positions.length + '</span>' +
        '</div>' +
        '<div class="lp-pos-summary-item">' +
          '<span class="lp-pos-summary-label">Total LP Staked</span>' +
          '<span class="lp-pos-summary-value">' + formatPrecise(totalStaked) + '</span>' +
        '</div>' +
        '<div class="lp-pos-summary-item highlight">' +
          '<span class="lp-pos-summary-label">Total Claimable</span>' +
          '<span class="lp-pos-summary-value positive">~' + formatPrecise(totalClaimable) + ' ' + UI.STRINGS.TOKEN + '</span>' +
        '</div>' +
      '</div>' +

      posData.map((p, i) => {
        return '<div class="lp-pos-card glass-card">' +
          '<div class="lp-pos-top">' +
            '<div class="lp-pos-identity">' +
              '<span class="lp-pos-num">#' + (i + 1) + '</span>' +
              '<a href="' + explorerAccountUrl(p.mintStr) + '" target="_blank" rel="noopener" class="lp-pool-link">' + p.shortMint + ' ↗</a>' +
              '<span class="tx-badge ' + (p.isLocked ? 'claim' : 'stake') + '">' + (p.isLocked ? '🔒 ' + p.timeRemaining : '✅ Unlocked') + '</span>' +
            '</div>' +
          '</div>' +

          '<div class="lp-pos-hero">' +
            '<div class="lp-pos-hero-stat">' +
              '<div class="lp-pos-hero-label">LP Staked</div>' +
              '<div class="lp-pos-hero-value">' + formatPrecise(p.lpAmt) + '</div>' +
              '<div class="lp-pos-hero-sub">' + p.multiplier.toFixed(UI.DECIMALS.MULTIPLIER) + 'x multiplier</div>' +
            '</div>' +
            '<div class="lp-pos-hero-stat accent">' +
              '<div class="lp-pos-hero-label">Claimable Rewards</div>' +
              '<div class="lp-pos-hero-value">' + formatPrecise(p.claimable) + ' <small>' + UI.STRINGS.TOKEN + '</small></div>' +
              '<div class="lp-pos-hero-sub">~' + formatCompact(p.dailyShare) + ' /day</div>' +
            '</div>' +
          '</div>' +

          '<div class="lp-pos-meta">' +
            '<div class="lp-pos-meta-item"><span>Lock</span><span>' + (p.lockDays > 0 ? p.lockDays + ' days' : 'Flexible') + '</span></div>' +
            '<div class="lp-pos-meta-item"><span>Staked</span><span>' + p.stakedDate + '</span></div>' +
            (p.isLocked ? '<div class="lp-pos-meta-item"><span>Lock Ends</span><span>' + p.lockEndDate + '</span></div>' : '') +
            '<div class="lp-pos-meta-item"><span>Last Claim</span><span>' + p.lastClaimDate + '</span></div>' +
            '<div class="lp-pos-meta-item"><span>Next Claim</span><span class="' + (p.nextClaimIsReady ? 'positive' : 'text-warning') + '">' + p.nextClaimLabel + '</span></div>' +
            '<div class="lp-pos-meta-item"><span>Total Claimed</span><span>' + formatCompact(p.totalClaimed) + ' ' + UI.STRINGS.TOKEN + '</span></div>' +
          '</div>' +

          '<div class="lp-pos-actions">' +
            '<button class="btn btn-primary lp-claim-btn" data-idx="' + i + '"' + (p.claimable < UI.THRESHOLDS.MIN_CLAIMABLE ? ' disabled' : '') + '>' +
              '💰 Claim' + (p.claimable >= UI.THRESHOLDS.MIN_CLAIMABLE ? ' ' + formatPrecise(p.claimable) + ' ' + UI.STRINGS.TOKEN : '') +
            '</button>' +
            (p.isLocked
              ? '<button class="btn btn-outline" disabled title="Locked until ' + p.lockEndDate + '">🔒 Locked</button>'
              : '<button class="btn btn-outline lp-unstake-btn" data-idx="' + i + '">📤 Unstake ' + formatPrecise(p.lpAmt) + ' ' + UI.STRINGS.LP + '</button>') +
          '</div>' +
        '</div>';
      }).join('');

    document.querySelectorAll('.lp-claim-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        await handleLPClaim(idx);
      });
    });

    document.querySelectorAll('.lp-unstake-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx);
        await handleLPUnstake(idx);
      });
    });
  }
  async function handleLPClaim(positionIndex) {
    const pos = state.lpPositions[positionIndex];
    if (!pos || !state.publicKey || !state.wallet) return;

    const loading = showToast('Processing LP Claim...', 'loading');
    try {
      const userZarixATA = getAssociatedTokenAddressSync(TOKEN_MINT, state.publicKey, false);
      const ix = createClaimLPAllocationsInstruction(state.publicKey, userZarixATA, pos.poolMint, pos.stakeIndex);
      await signAndConfirm(new Transaction().add(ix));
      loading.remove();
      showToast('LP Claim successful!', 'success');
      fetchLPStakerData();
    } catch(e) {
      loading.remove();
      console.error('LP Claim:', e);
      showToast('LP Claim failed: ' + (e.message || e), 'error');
    }
  }

  async function handleLPUnstake(positionIndex) {
    const pos = state.lpPositions[positionIndex];
    if (!pos || !state.publicKey || !state.wallet) return;

    const lpAmt = Number(pos.lpAmount) / ZARIX.LAMPORTS_PER_TOKEN;
    if (!confirm('Unstake ' + formatPrecise(lpAmt) + ' ' + UI.STRINGS.LP + ' from this position?')) return;

    const loading = showToast('Processing LP Unstake...', 'loading');
    try {
      const userLpATA = getAssociatedTokenAddressSync(pos.poolMint, state.publicKey, false);
      const ix = createUnstakeLPInstruction(state.publicKey, userLpATA, pos.poolMint, pos.stakeIndex);
      await signAndConfirm(new Transaction().add(ix));
      loading.remove();
      showToast('LP Unstake successful!', 'success');
      fetchLPStakerData();
    } catch(e) {
      loading.remove();
      console.error('LP Unstake:', e);
      showToast('LP Unstake failed: ' + (e.message || e), 'error');
    }
  }
  function renderStakes() {
    const container = document.getElementById('stakes-list');
    if (state.userStakes.length === 0) {
      container.innerHTML = '<div class="empty-state"><p>No active stakes found. Go to the <strong>Stake</strong> tab to create your first stake.</p></div>';
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    const cooldownSecs = state.programState ? Number(state.programState.claimPeriodSeconds) : ZARIX.SECONDS_PER_DAY;

    container.innerHTML = state.userStakes.map(s => {
      const amt = Number(s.amount) / ZARIX.LAMPORTS_PER_TOKEN;
      const withdrawn = Number(s.totalWithdrawn) / ZARIX.LAMPORTS_PER_TOKEN;
      const remaining = amt - withdrawn;
      const lockDays = Number(s.lockDurationDays);
      const lockEnd = Number(s.lockEndTimestamp);
      const status = getLockStatus(lockEnd);
      const claimable = calculateClaimableAllocations(s, state.programState);
      const isPending = s.isPending;
      const idx = Number(s.stakeIndex);

      const lastClaim = Number(s.lastClaimTimestamp);
      const elapsed = lastClaim > 0 ? (now - lastClaim) : Infinity;
      const cooldownActive = elapsed < cooldownSecs;
      const cooldownRemaining = cooldownActive ? cooldownSecs - elapsed : 0;
      const cooldownLabel = formatDuration(cooldownRemaining);
      const claimDisabled = claimable < UI.THRESHOLDS.MIN_CLAIMABLE || cooldownActive;
      const claimTitle = cooldownActive ? 'Cooldown: ~' + cooldownLabel + ' remaining' : '';

      return '<div class="stake-card">' +
        '<div class="stake-index">#' + idx + '</div>' +
        '<div class="stake-info">' +
          '<div class="stake-info-label">Staked</div>' +
          '<div class="stake-info-value">' + Math.floor(remaining).toLocaleString() + ' ' + UI.STRINGS.TOKEN + '</div>' +
        '</div>' +
        '<div class="stake-info">' +
          '<div class="stake-info-label">Lock</div>' +
          '<div class="stake-info-value">' + Math.floor(lockDays / 365) + 'Y ' +
            '<span class="lock-badge ' + status + '">' + (status === 'locked' ? '🔒 ' + formatTimeRemaining(lockEnd) : '🔓 Unlocked') + '</span>' +
            (isPending ? ' <span class="status-badge pending">Pending</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="stake-info">' +
          '<div class="stake-info-label">Claimable</div>' +
          '<div class="stake-info-value claimable-value">' + formatPrecise(claimable) + ' ' + UI.STRINGS.TOKEN + '</div>' +
        '</div>' +
        '<div class="stake-actions">' +
          '<button class="btn btn-sm btn-success stake-claim-btn" data-idx="' + idx + '" ' + (claimDisabled ? 'disabled' : '') + (claimTitle ? ' title="' + claimTitle + '"' : '') + '>' +
            (cooldownActive ? '⏳ ' + cooldownLabel : 'Claim') +
          '</button>' +
          '<button class="btn btn-sm btn-danger stake-unstake-btn" data-idx="' + idx + '" ' + (status === 'locked' ? 'disabled title="Lock not expired"' : '') + '>Unstake</button>' +
        '</div>' +
      '</div>';
    }).join('');

    container.querySelectorAll('.stake-claim-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        window._claim(idx);
      });
    });
    container.querySelectorAll('.stake-unstake-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx);
        window._unstake(idx);
      });
    });
  }
  function updateStakeForm() {
    document.getElementById('stake-balance-hint').textContent = 'Available: ' + Math.floor(state.tokenBalance).toLocaleString() + ' ' + UI.STRINGS.TOKEN;
    updatePreview();
  }

  function updatePreview() {
    const amount = parseFloat(document.getElementById('stake-amount').value) || 0;
    const days = state.selectedLockDays;
    const multiplier = getVotingMultiplier(days);
    const votingPower = amount * multiplier;

    document.getElementById('preview-multiplier').textContent = multiplier.toFixed(UI.DECIMALS.MULTIPLIER) + 'x';
    document.getElementById('preview-voting-power').textContent = Math.floor(votingPower).toLocaleString();

    const ps = state.programState;
    if (ps) {
      const totalNet = Number(ps.totalNetworkStaked) / ZARIX.LAMPORTS_PER_TOKEN;
      const { phase, stakerPct } = getHalvingCtx();
      const daily = calculateEstimatedDaily(amount, totalNet + amount, phase, stakerPct);
      document.getElementById('preview-daily').textContent = '~' + formatCompact(daily) + ' ' + UI.STRINGS.TOKEN;
    }

    const lockEndDate = new Date(Date.now() + days * ZARIX.SECONDS_PER_DAY * 1000);
    document.getElementById('preview-lock-end').textContent = lockEndDate.toLocaleDateString('en-US', UI.DATE_FORMAT);

    const minStake = state.programState ? Number(state.programState.minStakeAmount) / ZARIX.LAMPORTS_PER_TOKEN : ZARIX.DEFAULT_MIN_STAKE;
    const btn = document.getElementById('btn-stake');
    const statusEl = document.getElementById('stake-status');

    if (!state.publicKey) {
      btn.disabled = true;
      btn.textContent = '⚠️ Connect Wallet First';
      statusEl.className = 'form-status';
      statusEl.textContent = '';
    } else if (amount <= 0) {
      btn.disabled = true;
      btn.textContent = '🔒 Enter Amount';
      statusEl.className = 'form-status';
      statusEl.textContent = '';
    } else if (amount < minStake) {
      btn.disabled = true;
      btn.textContent = '⚠️ Below Minimum';
      statusEl.className = 'form-status error';
      statusEl.textContent = 'Minimum stake: ' + Math.floor(minStake).toLocaleString() + ' ' + UI.STRINGS.TOKEN;
    } else if (amount > state.tokenBalance) {
      btn.disabled = true;
      btn.textContent = '⚠️ Insufficient Balance';
      statusEl.className = 'form-status error';
      statusEl.textContent = 'You have ' + Math.floor(state.tokenBalance).toLocaleString() + ' ' + UI.STRINGS.TOKEN;
    } else {
      btn.disabled = false;
      btn.textContent = '🔒 Stake ' + Math.floor(amount).toLocaleString() + ' ' + UI.STRINGS.TOKEN;
      statusEl.className = 'form-status';
      statusEl.textContent = '';
    }
  }
  document.querySelectorAll('.lock-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.lock-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.selectedLockDays = parseInt(btn.dataset.days);
      updatePreview();
    });
  });
  document.getElementById('stake-amount').addEventListener('input', updatePreview);
  document.getElementById('btn-max').addEventListener('click', () => {
    document.getElementById('stake-amount').value = Math.floor(state.tokenBalance);
    updatePreview();
  });
  async function doStake() {
    if (!state.publicKey || !state.programState) return;
    const amount = parseFloat(document.getElementById('stake-amount').value) || 0;
    const amountLamports = BigInt(Math.floor(amount * ZARIX.LAMPORTS_PER_TOKEN));
    const lockDays = BigInt(state.selectedLockDays);
    const statusEl = document.getElementById('stake-status');

    try {
      statusEl.className = 'form-status loading';
      statusEl.textContent = '⏳ Preparing transaction...';

      const userTokenAccount = getAssociatedTokenAddressSync(TOKEN_MINT, state.publicKey, false);
      const userAccount = await fetchUserAccount(state.connection, state.publicKey);
      const stakeIndex = userAccount ? userAccount.nextStakeIndex : 0n;

      const tx = new Transaction();

      if (!userAccount) {
        const [userAccountPDA] = getUserAccountPDA(state.publicKey);
        const rent = calculateMinimumRent(ZARIX.ACCOUNT_SIZES.USER_ACCOUNT);
        tx.add(createPreFundInstruction(state.publicKey, userAccountPDA, rent));
      }

      const [stakePDA] = getStakePDA(state.publicKey, stakeIndex);
      const stakeRent = calculateMinimumRent(ZARIX.ACCOUNT_SIZES.STAKE_PDA);
      tx.add(createPreFundInstruction(state.publicKey, stakePDA, stakeRent));

      tx.add(createStakeInstruction(state.publicKey, userTokenAccount, amountLamports, lockDays, stakeIndex));

      statusEl.textContent = '⏳ Please approve in wallet...';

      const { blockhash, lastValidBlockHeight } = await state.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = state.publicKey;

      const signed = await state.wallet.signTransaction(tx);
      const sig = await state.connection.sendRawTransaction(signed.serialize());

      statusEl.textContent = '⏳ Confirming...';
      await pollConfirmation(sig);

      statusEl.className = 'form-status success';
      statusEl.textContent = '✅ Staked ' + amount.toLocaleString() + ' ' + UI.STRINGS.TOKEN + ' successfully!';
      showToast('Staked ' + amount.toLocaleString() + ' ' + UI.STRINGS.TOKEN + '!', 'success');

      document.getElementById('stake-amount').value = '';
      await refreshAll();
    } catch(e) {
      console.error('Stake error:', e);
      statusEl.className = 'form-status error';
      statusEl.textContent = handleTxError(e, 'Stake');
      showToast(handleTxError(e, 'Stake'), 'error');
    }
  }
  async function doClaim(stakeIndex) {
    if (!state.publicKey) return;
    const loading = showToast('Processing claim...', 'loading');
    try {
      const userTokenAccount = getAssociatedTokenAddressSync(TOKEN_MINT, state.publicKey, false);
      const tx = new Transaction().add(createClaimInstruction(state.publicKey, userTokenAccount, BigInt(stakeIndex)));
      await signAndConfirm(tx);
      loading.remove();
      showToast('Claim successful!', 'success');
      await refreshAll();
    } catch(e) {
      loading.remove();
      console.error('Claim:', e);
      if (e.message?.includes('rejected')) {
        showToast(handleTxError(e, 'Claim'), 'error');
      } else if (e.message?.includes('0x80') || e.message?.includes('cooldown')) {
        const match = e.message?.match(/Wait (\d+) more seconds/);
        const secs = match ? parseInt(match[1]) : 0;
        const timeStr = secs > 0 ? formatDuration(secs) : '';
        showToast('Claim cooldown active.' + (timeStr ? ' Try again in ~' + timeStr + '.' : ' Try again later.'), 'error');
        await refreshAll();
      } else {
        showToast(handleTxError(e, 'Claim'), 'error');
      }
    }
  }
  async function doUnstake(stakeIndex) {
    const stake = state.userStakes.find(s => Number(s.stakeIndex) === stakeIndex);
    if (!stake) return;
    if (getLockStatus(Number(stake.lockEndTimestamp)) === 'locked') {
      showToast('Lock period not expired yet!', 'error');
      return;
    }
    if (!confirm('Are you sure you want to unstake? This will return your ' + UI.STRINGS.TOKEN + ' tokens.')) return;

    const loading = showToast('Processing unstake...', 'loading');
    try {
      const userTokenAccount = getAssociatedTokenAddressSync(TOKEN_MINT, state.publicKey, false);
      const tx = new Transaction().add(createUnstakeInstruction(state.publicKey, userTokenAccount, BigInt(stakeIndex)));
      await signAndConfirm(tx);
      loading.remove();
      showToast('Unstake successful!', 'success');
      await refreshAll();
    } catch(e) {
      loading.remove();
      console.error('Unstake:', e);
      showToast(handleTxError(e, 'Unstake'), 'error');
    }
  }
  window._claim = doClaim;
  window._unstake = doUnstake;
  document.getElementById('btn-save-rpc').addEventListener('click', async () => {
    const rawUrl = document.getElementById('rpc-url').value.trim();
    if (!rawUrl) {
      showToast('Enter a URL or use Reset to restore default', 'error', 3000);
      return;
    }

    if (rawUrl.startsWith('http') && !rawUrl.includes('127.0.0.1:3847')) {
      try {
        await fetch(UI.APP.API_SET_RPC, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rpc_url: rawUrl }),
        });
        state.rpcUrl = UI.APP.PROXY_URL;
        localStorage.setItem(UI.STORAGE.RPC_URL, UI.APP.PROXY_URL);
        localStorage.setItem(UI.STORAGE.RPC_TARGET, rawUrl);
      } catch(e) {
        showToast('Failed to update proxy: ' + e.message, 'error');
        return;
      }
    } else {
      state.rpcUrl = rawUrl;
      localStorage.setItem(UI.STORAGE.RPC_URL, rawUrl);
    }

    initConnection();
    showToast('RPC URL saved!', 'success', 3000);
    if (state.publicKey) refreshAll();
  });

  document.getElementById('btn-reset-rpc').addEventListener('click', async () => {
    const defaultRpc = UI.APP.DEFAULT_SOLANA_RPC;
    try {
      await fetch(UI.APP.API_SET_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rpc_url: defaultRpc }),
      });
    } catch(e) {}
    localStorage.removeItem(UI.STORAGE.RPC_TARGET);
    localStorage.setItem(UI.STORAGE.RPC_URL, UI.APP.PROXY_URL);
    state.rpcUrl = UI.APP.PROXY_URL;
    document.getElementById('rpc-url').value = defaultRpc;
    initConnection();
    showToast('RPC reset to Solana Public', 'success', 3000);
    if (state.publicKey) refreshAll();
  });

  document.getElementById('btn-test-rpc').addEventListener('click', async () => {
    const resultEl = document.getElementById('rpc-test-result');
    resultEl.className = 'form-status loading';
    resultEl.textContent = 'Testing...';
    try {
      const testConn = new Connection(state.rpcUrl, 'confirmed');
      const slot = await testConn.getSlot();
      resultEl.className = 'form-status success';
      resultEl.textContent = '✅ Connected! Current slot: ' + slot.toLocaleString();
    } catch(e) {
      resultEl.className = 'form-status error';
      resultEl.textContent = '❌ Failed: ' + e.message;
    }
  });
  document.getElementById('btn-quit-app').addEventListener('click', async () => {
    const confirmed = confirm('Are you sure you want to quit ZARIX Local?\n\nThe server will stop and this window will close.');
    if (!confirmed) return;

    window.__zarixQuitting = true;
    const statusEl = document.getElementById('quit-status');
    statusEl.className = 'form-status loading';
    statusEl.textContent = 'Shutting down...';

    try {
      await fetch(UI.APP.API_SHUTDOWN + '?force=1', { method: 'POST' });
      statusEl.className = 'form-status success';
      statusEl.textContent = '✅ Server stopped. You can close this window.';
      document.title = 'ZARIX LOCAL — Stopped';
      showToast('Application stopped. You can close this window now.', 'info', 30000);
    } catch(e) {
      statusEl.className = 'form-status success';
      statusEl.textContent = '✅ Server stopped. You can close this window.';
    }
  });

  function sendHeartbeat() {
    fetch(UI.APP.API_HEARTBEAT, { method: 'POST' }).catch(() => {});
  }

  function requestGracefulShutdown() {
    if (window.__zarixQuitting) return;
    const url = UI.APP.API_SHUTDOWN;
    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, '');
    } else {
      fetch(url, { method: 'POST', keepalive: true }).catch(() => {});
    }
  }

  sendHeartbeat();
  setInterval(sendHeartbeat, UI.TIME.HEARTBEAT_INTERVAL_MS);
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    requestGracefulShutdown();
  });
  document.getElementById('btn-connect').addEventListener('click', connectWallet);
  document.getElementById('btn-connect-hero').addEventListener('click', connectWallet);
  document.getElementById('btn-disconnect').addEventListener('click', disconnectWallet);
  document.getElementById('btn-stake').addEventListener('click', doStake);
  document.getElementById('btn-refresh').addEventListener('click', () => {
    showToast('Refreshing...', 'info', 2000);
    refreshAll();
  });

  document.getElementById('btn-refresh-tx').addEventListener('click', () => {
    if (state.publicKey && isPremiumRPC()) fetchRecentTransactions();
  });

  document.getElementById('btn-refresh-lp').addEventListener('click', () => {
    if (state.publicKey && isPremiumRPC()) fetchLPStakerData();
  });

  document.getElementById('lp-pool-select').addEventListener('change', updateLPBalanceHint);

  document.getElementById('btn-lp-max').addEventListener('click', () => {
    if (!state.lpGauges || !state.lpBalances) return;
    const idx = parseInt(document.getElementById('lp-pool-select').value);
    const gauge = state.lpGauges[idx];
    if (!gauge) return;
    const mint = gauge.poolMint.toString();
    const bal = state.lpBalances[mint] || 0;
    document.getElementById('lp-amount-input').value = formatPrecise(bal);
  });

  document.getElementById('btn-lp-stake').addEventListener('click', async () => {
    if (!state.publicKey || !state.wallet || !state.lpGauges) return;

    const poolIdx = parseInt(document.getElementById('lp-pool-select').value);
    const amountRaw = parseFloat(document.getElementById('lp-amount-input').value);
    const lockDays = parseInt(document.getElementById('lp-lock-select').value);

    if (isNaN(amountRaw) || amountRaw <= 0) {
      showToast('Enter a valid LP amount', 'error');
      return;
    }

    const gauge = state.lpGauges[poolIdx];
    if (!gauge) { showToast('Invalid pool selection', 'error'); return; }

    const amountLamports = BigInt(Math.round(amountRaw * ZARIX.LAMPORTS_PER_TOKEN));

    const loading = showToast('Building LP Stake transaction...', 'loading');
    try {
      const [lpGaugePDA] = getLPGaugePDA(gauge.poolMint);
      const [lpStakerPDA] = getLPStakerPDA(lpGaugePDA, state.publicKey);
      const stakerInfo = await state.connection.getAccountInfo(lpStakerPDA);
      let nextIndex = 0n;
      if (stakerInfo) {
        const staker = parseLPStakerAccount(stakerInfo.data);
        nextIndex = staker.nextStakeIndex;
      }

      const userLpATA = getAssociatedTokenAddressSync(gauge.poolMint, state.publicKey, false);

      let preIx = null;
      try {
        await getAccount(state.connection, userLpATA);
      } catch(e) {
        preIx = createAssociatedTokenAccountInstruction(state.publicKey, userLpATA, state.publicKey, gauge.poolMint);
      }

      const [lpVaultPDA] = getLPVaultPDA(lpGaugePDA);
      const lpVaultAta = getAssociatedTokenAddressSync(gauge.poolMint, lpVaultPDA, true);
      let vaultAtaIx = null;
      try {
        await getAccount(state.connection, lpVaultAta);
      } catch(e) {
        vaultAtaIx = createAssociatedTokenAccountInstruction(state.publicKey, lpVaultAta, lpVaultPDA, gauge.poolMint);
      }

      let stakerRentIx = null;
      if (!stakerInfo) {
        const rentLamports = calculateMinimumRent(ZARIX.ACCOUNT_SIZES.LP_STAKER);
        stakerRentIx = createPreFundInstruction(state.publicKey, lpStakerPDA, rentLamports);
      }

      const [lpStakePDA] = getLPStakePDA(lpGaugePDA, state.publicKey, nextIndex);
      const stakeRentLamports = calculateMinimumRent(ZARIX.ACCOUNT_SIZES.LP_STAKE_PDA);
      const stakeRentIx = createPreFundInstruction(state.publicKey, lpStakePDA, stakeRentLamports);

      const ix = createStakeLPInstruction(
        state.publicKey,
        userLpATA,
        gauge.poolMint,
        amountLamports,
        BigInt(lockDays),
        nextIndex
      );

      const tx = new Transaction();
      if (preIx) tx.add(preIx);
      if (vaultAtaIx) tx.add(vaultAtaIx);
      if (stakerRentIx) tx.add(stakerRentIx);
      tx.add(stakeRentIx);
      tx.add(ix);

      tx.feePayer = state.publicKey;
      const { blockhash } = await state.connection.getLatestBlockhash('confirmed');
      tx.recentBlockhash = blockhash;

      const signed = await state.wallet.signTransaction(tx);
      const sig = await state.connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
      loading.remove();
      showToast('LP Stake sent! Confirming...', 'info');

      await pollConfirmation(sig);
      showToast('LP Stake successful! ✅', 'success');
      document.getElementById('lp-amount-input').value = '';
      fetchLPStakerData();
    } catch(e) {
      loading.remove();
      console.error('LP Stake error:', e);
      showToast('LP Stake failed: ' + (e.message || e), 'error');
    }
  });
  initConnection();
  setTimeout(() => {
    const provider = getProvider();
    if (provider?.isConnected) {
      connectWallet();
    }
  }, UI.TIME.AUTO_CONNECT_DELAY_MS);

})();
