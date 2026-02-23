/**
 * IPL Auction — Auctioneer Control Panel JS
 */

// ── State ─────────────────────────────────────────────────────────────────────
let currentPlayer = null;

document.addEventListener('DOMContentLoaded', () => {
  const playerIdEl = document.getElementById('player-id');
  if (playerIdEl && playerIdEl.value) {
    const nameEl = document.getElementById('player-name');
    const roleEl = document.querySelector('.meta-tag');
    const categoryEl = document.querySelector('.player-badge');
    const basePriceEl = document.getElementById('player-base-price');
    currentPlayer = {
      id:         parseInt(playerIdEl.value),
      name:       nameEl ? nameEl.textContent.trim() : '',
      category:   categoryEl ? categoryEl.textContent.trim() : 'Indian',
      role:       roleEl ? roleEl.textContent.trim() : '',
      base_price: parseFloat(basePriceEl ? basePriceEl.textContent.match(/[\d.]+/)[0] : '2.00'),
    };
    const bidInput = document.getElementById('bid-amount');
    if (bidInput) bidInput.value = currentPlayer.base_price.toFixed(2);
  }

  setupEventListeners();
  validateBidInput();
  loadUnsoldCount();
  loadMarkedCount();

  // SSE for real-time updates
  const es = new EventSource('/api/events');
  es.addEventListener('sale',           onRemoteUpdate);
  es.addEventListener('unsold',         onRemoteUpdate);
  es.addEventListener('undo',           onRemoteUpdate);
  es.addEventListener('reset',          onRemoteUpdate);
  es.addEventListener('cancel_rebid',   onRemoteUpdate);
  es.addEventListener('budget_deducted', onTeamsUpdate);
  es.addEventListener('player_assigned', onTeamsUpdate);
});

function onRemoteUpdate(e) {
  const data = JSON.parse(e.data);
  if (data.next_player !== undefined) updatePlayerCard(data.next_player);
  if (data.teams) { updateTeamsPanel(data.teams); updateTeamSelect(data.teams); }
  loadUnsoldCount();
  loadMarkedCount();
}

function onTeamsUpdate(e) {
  const data = JSON.parse(e.data);
  if (data.teams) { updateTeamsPanel(data.teams); updateTeamSelect(data.teams); }
}

// ── Event Listeners ───────────────────────────────────────────────────────────

function setupEventListeners() {
  document.getElementById('sell-btn')?.addEventListener('click', sellPlayer);
  document.getElementById('unsold-btn')?.addEventListener('click', markUnsold);
  document.getElementById('undo-btn')?.addEventListener('click', undoSale);
  document.getElementById('reset-btn')?.addEventListener('click', confirmReset);
  document.getElementById('reset-btn-empty')?.addEventListener('click', confirmReset);

  document.querySelectorAll('.increment-btn').forEach(btn => {
    btn.addEventListener('click', () => adjustBid(parseFloat(btn.dataset.delta)));
  });
  document.querySelectorAll('.quick-bid-btn').forEach(btn => {
    btn.addEventListener('click', () => adjustBid(parseFloat(btn.dataset.delta)));
  });
  document.getElementById('bid-amount')?.addEventListener('input', validateBidInput);
  document.getElementById('team-select')?.addEventListener('change', validateBidInput);
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateBidInput() {
  const amtInput = document.getElementById('bid-amount');
  const teamSel  = document.getElementById('team-select');
  const msgEl    = document.getElementById('validation-msg');
  const sellBtn  = document.getElementById('sell-btn');

  const amount   = parseFloat(amtInput.value);
  const teamName = teamSel.value;

  if (!currentPlayer) { sellBtn.disabled = true; msgEl.textContent = ''; return; }

  if (isNaN(amount) || amount < 0.25) {
    msgEl.textContent = 'Minimum bid is ₹0.25 Cr';
    msgEl.className = 'validation-msg error';
    sellBtn.disabled = true; return;
  }
  if (!teamName) {
    msgEl.textContent = 'Please select a team';
    msgEl.className = 'validation-msg error';
    sellBtn.disabled = true; return;
  }

  const opt     = teamSel.selectedOptions[0];
  const purse   = parseFloat(opt.dataset.purse);
  const overseas = parseInt(opt.dataset.overseas);

  if (amount > purse) {
    msgEl.textContent = `Insufficient purse — ₹${purse.toFixed(2)} Cr left`;
    msgEl.className = 'validation-msg error';
    sellBtn.disabled = true; return;
  }
  if (currentPlayer.category === 'Overseas' && overseas >= 8) {
    msgEl.textContent = 'Team has reached 8 overseas player limit';
    msgEl.className = 'validation-msg error';
    sellBtn.disabled = true; return;
  }

  msgEl.textContent = `✓ ₹${amount.toFixed(2)} Cr → ${teamName}`;
  msgEl.className = 'validation-msg ok';
  sellBtn.disabled = false;
}

function adjustBid(delta) {
  const input = document.getElementById('bid-amount');
  const next  = Math.max(0.25, Math.round((parseFloat(input.value || 0) + delta) * 100) / 100);
  input.value = next.toFixed(2);
  validateBidInput();
}

// ── Sell ──────────────────────────────────────────────────────────────────────

async function sellPlayer() {
  if (!currentPlayer) return;
  const amount   = parseFloat(document.getElementById('bid-amount').value);
  const teamName = document.getElementById('team-select').value;
  setLoading(true);
  try {
    const res  = await fetch('/api/sell', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ player_id: currentPlayer.id, team_name: teamName, bid_amount: amount }),
    });
    const data = await res.json();
    if (data.status === 'ok') {
      showFlash(data.message || 'Player sold!', 'success');
      const sold = {...currentPlayer};
      updatePageAfterAction(data);
      addHistoryItem(sold, teamName, amount);
    } else {
      showFlash(data.message || 'Sale failed', 'error');
    }
  } catch { showFlash('Network error', 'error'); }
  finally  { setLoading(false); }
}

// ── Mark Unsold ───────────────────────────────────────────────────────────────

async function markUnsold() {
  if (!currentPlayer) return;
  if (!confirm(`Mark "${currentPlayer.name}" as UNSOLD? They will move to the unsold list.`)) return;
  setLoading(true);
  try {
    const res  = await fetch('/api/mark-unsold', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ player_id: currentPlayer.id }),
    });
    const data = await res.json();
    if (data.status === 'ok') {
      showFlash(`${currentPlayer.name} marked unsold`, 'info');
      updatePageAfterAction(data);
    } else {
      showFlash(data.message, 'error');
    }
  } catch { showFlash('Network error', 'error'); }
  finally  { setLoading(false); }
}

// ── Undo ──────────────────────────────────────────────────────────────────────

async function undoSale() {
  setLoading(true);
  try {
    const res  = await fetch('/api/undo', { method: 'POST' });
    const data = await res.json();
    if (data.status === 'ok') {
      updatePageAfterAction(data);
      showFlash(data.message, 'info');
      const hist = document.getElementById('history-list');
      if (hist?.firstElementChild?.classList.contains('history-item')) {
        hist.firstElementChild.remove();
      }
      if (hist?.children.length === 0) {
        hist.innerHTML = '<p class="no-history">No sales yet. Let the auction begin!</p>';
      }
    } else { showFlash(data.message, 'error'); }
  } catch { showFlash('Network error', 'error'); }
  finally  { setLoading(false); }
}

// ── Reset ─────────────────────────────────────────────────────────────────────

function confirmReset() {
  if (!confirm('⚠️ RESET AUCTION?\n\nThis will mark all players unsold, restore all purses to ₹100 Cr, and clear history.\n\nThis CANNOT be undone!')) return;
  doReset();
}

async function doReset() {
  setLoading(true);
  try {
    const res  = await fetch('/api/reset', { method: 'POST' });
    const data = await res.json();
    if (data.status === 'ok') {
      updatePageAfterAction(data);
      showFlash('Auction reset!', 'info');
      const hist = document.getElementById('history-list');
      if (hist) hist.innerHTML = '<p class="no-history">No sales yet. Let the auction begin!</p>';
    } else { showFlash(data.message, 'error'); }
  } catch { showFlash('Network error', 'error'); }
  finally  { setLoading(false); }
}

// ── Cancel & Rebid ────────────────────────────────────────────────────────────

async function cancelRebid(playerId, playerName) {
  if (!confirm(`Cancel sale of "${playerName}" and put them back for auction?`)) return;
  try {
    const res  = await fetch('/api/cancel-rebid', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ player_id: playerId }),
    });
    const data = await res.json();
    if (data.status === 'ok') {
      showFlash(data.message, 'info');
      updatePageAfterAction(data);
      loadSoldPlayers();
      // Remove from history if shown
      const hist = document.getElementById('history-list');
      if (hist) hist.innerHTML = '<p class="no-history">Refreshing...</p>';
      setTimeout(() => fetch('/api/history').then(r=>r.json()).then(d=>{
        if (d.status==='ok') renderHistory(d.history);
      }), 500);
    } else { showFlash(data.message, 'error'); }
  } catch { showFlash('Network error', 'error'); }
}

// ── Restore Unsold ────────────────────────────────────────────────────────────

async function restoreUnsold(playerId, playerName) {
  try {
    const res  = await fetch('/api/restore-unsold', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ player_id: playerId }),
    });
    const data = await res.json();
    if (data.status === 'ok') {
      showFlash(`${playerName} re-queued for auction`, 'success');
      updatePageAfterAction(data);
      loadMarkedUnsold();
    } else { showFlash(data.message, 'error'); }
  } catch { showFlash('Network error', 'error'); }
}

// ── UI Updates ────────────────────────────────────────────────────────────────

function updatePageAfterAction(data) {
  if (data.next_player !== undefined) updatePlayerCard(data.next_player);
  if (data.teams) { updateTeamsPanel(data.teams); updateTeamSelect(data.teams); }
  loadUnsoldCount();
  loadMarkedCount();
}

function updatePlayerCard(player) {
  const card     = document.getElementById('player-card');
  const controls = document.getElementById('bid-controls');
  currentPlayer  = player;

  if (!player) {
    card.innerHTML = `<div class="auction-complete"><div class="complete-icon">🏆</div><h2>Auction Complete!</h2><p>All players have been processed.</p></div>`;
    card.classList.add('empty');
    if (controls) controls.style.display = 'none';
    return;
  }

  const cat = (player.category || 'indian').toLowerCase();
  card.className = 'player-card';
  card.innerHTML = `
    <div class="player-badge badge-${cat}">${player.category || 'Indian'}</div>
    <div class="player-number">#${player.id}</div>
    <h1 class="player-name" id="player-name">${player.name}</h1>
    <div class="player-meta"><span class="meta-tag">${player.role || ''}</span></div>
    <div class="player-price">
      <span class="price-label">Base Price</span>
      <span class="price-value" id="player-base-price">₹${parseFloat(player.base_price).toFixed(2)} Cr</span>
    </div>
    <input type="hidden" id="player-id" value="${player.id}"/>`;

  if (controls) controls.style.display = 'block';

  currentPlayer = { id: player.id, name: player.name, category: player.category || 'Indian',
                    role: player.role || '', base_price: parseFloat(player.base_price) };

  const bidInput = document.getElementById('bid-amount');
  if (bidInput) bidInput.value = parseFloat(player.base_price).toFixed(2);
  validateBidInput();
}

function updateTeamsPanel(teams) {
  const grid = document.getElementById('teams-grid');
  if (!grid) return;
  grid.innerHTML = teams.map(t => {
    const purse = parseFloat(t.purse);
    const safeName = t.name.replace(/'/g, "\\'");
    return `
    <div class="team-card team-card-clickable" id="team-${t.name.replace(/\s+/g, '-')}"
         onclick="openTeamPopup('${safeName}')" title="Click to view squad">
      <div class="team-header">
        <span class="team-code">${t.short_code || ''}</span>
        <span class="team-name-small">${t.name}</span>
      </div>
      <div class="team-purse">₹${purse.toFixed(2)} Cr</div>
      <div class="team-stats">
        <span title="Players">👥 ${t.total_players || 0}/18</span>
        <span title="Overseas">🌍 ${t.overseas_count || 0}/8</span>
        <span title="WK" class="${(t.wk_count||0)<2?'wk-warn':''}">🧤 ${t.wk_count||0}/2</span>
      </div>
      <div class="purse-bar-wrap"><div class="purse-bar" style="width:${Math.min((purse/100)*100,100)}%"></div></div>
    </div>`}).join('');
}

function updateTeamSelect(teams) {
  const sel = document.getElementById('team-select');
  if (!sel) return;
  const prev = sel.value;
  sel.innerHTML = '<option value="">-- Select Team --</option>' +
    teams.map(t => {
      const purse = parseFloat(t.purse);
      return `<option value="${t.name}" data-purse="${purse.toFixed(2)}" data-overseas="${t.overseas_count||0}" ${t.name===prev?'selected':''}>${t.name} (₹${purse.toFixed(2)} Cr)</option>`;
    }).join('');
  validateBidInput();
}

function renderHistory(history) {
  const list = document.getElementById('history-list');
  if (!list) return;
  if (!history || history.length === 0) {
    list.innerHTML = '<p class="no-history">No sales yet.</p>'; return;
  }
  list.innerHTML = history.map(h => `
    <div class="history-item">
      <span class="h-player">${h.player_name}</span>
      <span class="h-badge badge-${(h.category||'indian').toLowerCase()}">${h.category}</span>
      <span class="h-role">${h.role}</span>
      <span class="h-team">→ ${h.team_name}</span>
      <span class="h-price">₹${parseFloat(h.bid_amount).toFixed(2)} Cr</span>
    </div>`).join('');
}

function addHistoryItem(player, teamName, amount) {
  const list = document.getElementById('history-list');
  if (!list) return;
  const empty = list.querySelector('.no-history');
  if (empty) empty.remove();
  const div = document.createElement('div');
  div.className = 'history-item';
  div.innerHTML = `
    <span class="h-player">${player.name}</span>
    <span class="h-badge badge-${(player.category||'indian').toLowerCase()}">${player.category||'Indian'}</span>
    <span class="h-role">${player.role||''}</span>
    <span class="h-team">→ ${teamName}</span>
    <span class="h-price">₹${parseFloat(amount).toFixed(2)} Cr</span>`;
  list.insertBefore(div, list.firstChild);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function switchTab(tab) {
  ['current','unsold','marked','sold-list'].forEach(t => {
    document.getElementById(`tab-${t}`)?.classList.remove('active');
    document.getElementById(`${t}-player-view`) && document.getElementById(`${t}-player-view`).classList.remove('active');
  });

  const viewMap = {
    'current':   'current-player-view',
    'unsold':    'unsold-players-view',
    'marked':    'marked-players-view',
    'sold-list': 'sold-list-view',
  };

  document.getElementById(`tab-${tab}`)?.classList.add('active');
  const view = document.getElementById(viewMap[tab]);
  if (view) view.classList.add('active');

  if (tab === 'unsold')    loadUnsoldPlayers();
  if (tab === 'marked')    loadMarkedUnsold();
  if (tab === 'sold-list') loadSoldPlayers();
}

// ── Unsold Players List ───────────────────────────────────────────────────────

function loadUnsoldCount() {
  fetch('/api/unsold-players').then(r=>r.json()).then(d => {
    if (d.status==='ok') {
      const b = document.getElementById('unsold-count');
      if (b) { b.textContent = d.players?.length||0; b.style.display = d.players?.length ? 'inline-block' : 'none'; }
    }
  });
}

function loadMarkedCount() {
  fetch('/api/marked-unsold').then(r=>r.json()).then(d => {
    if (d.status==='ok') {
      const b = document.getElementById('marked-count');
      if (b) { b.textContent = d.players?.length||0; b.style.display = d.players?.length ? 'inline-block' : 'none'; }
    }
  });
}

function loadUnsoldPlayers() {
  const el = document.getElementById('unsold-players-list');
  if (!el) return;
  el.innerHTML = '<div class="loading-unsold"><span class="spinner"></span><span>Loading...</span></div>';
  fetch('/api/unsold-players').then(r=>r.json()).then(d => {
    if (d.status==='ok') displayPlayerList(el, d.players||[], 'unsold');
    else el.innerHTML = '<div class="error-message">Failed to load</div>';
  }).catch(() => { el.innerHTML = '<div class="error-message">Error loading</div>'; });
}

function loadMarkedUnsold() {
  const el = document.getElementById('marked-unsold-list');
  if (!el) return;
  el.innerHTML = '<div class="loading-unsold"><span class="spinner"></span><span>Loading...</span></div>';
  fetch('/api/marked-unsold').then(r=>r.json()).then(d => {
    if (d.status==='ok') displayPlayerList(el, d.players||[], 'marked');
    else el.innerHTML = '<div class="error-message">Failed to load</div>';
  });
}

function loadSoldPlayers() {
  const el = document.getElementById('sold-players-list');
  if (!el) return;
  el.innerHTML = '<div class="loading-unsold"><span class="spinner"></span><span>Loading...</span></div>';
  fetch('/api/sold-players').then(r=>r.json()).then(d => {
    if (d.status==='ok') displayPlayerList(el, d.players||[], 'sold');
    else el.innerHTML = '<div class="error-message">Failed to load</div>';
  });
}

function displayPlayerList(el, players, mode) {
  if (players.length === 0) {
    const msgs = { unsold: '🎉 All players processed!', marked: '✅ No unsold players.', sold: 'No players sold yet.' };
    el.innerHTML = `<div class="no-unsold"><p>${msgs[mode]||''}</p></div>`;
    return;
  }

  if (mode === 'sold') {
    el.innerHTML = players.map(p => `
      <div class="unsold-player-item">
        <div class="unsold-player-info">
          <span class="unsold-player-name">${p.name}</span>
          <span class="unsold-player-badge badge-${(p.category||'indian').toLowerCase()}">${p.category||'Indian'}</span>
          <span class="unsold-player-role">${p.role||''}</span>
        </div>
        <div class="unsold-player-price">₹${parseFloat(p.current_bid||0).toFixed(2)} Cr → ${p.current_team||'?'}</div>
        <button class="btn btn-rebid" onclick="cancelRebid(${p.id||0}, '${(p.name||'').replace(/'/g,"\\'")}')">Cancel & Rebid</button>
      </div>`).join('');
    return;
  }

  // Group by role
  const grouped = {};
  players.forEach(p => {
    const r = p.role || 'Other';
    if (!grouped[r]) grouped[r] = [];
    grouped[r].push(p);
  });

  let html = '';
  Object.keys(grouped).sort().forEach(role => {
    html += `<div class="unsold-role-group">
      <div class="role-group-header">${role} <span class="role-count">(${grouped[role].length})</span></div>
      <div class="role-players">`;
    grouped[role].forEach(p => {
      const cat = (p.category||'indian').toLowerCase();
      const name = (p.name||'').replace(/'/g, "\\'");
      const basePrice = parseFloat(p.base_price||0);

      if (mode === 'unsold') {
        html += `
          <div class="unsold-player-item" onclick="selectUnsoldPlayer(${p.id},'${name}','${p.role||''}','${p.category||'Indian'}',${basePrice})">
            <div class="unsold-player-info">
              <span class="unsold-player-name">${p.name}</span>
              <span class="unsold-player-badge badge-${cat}">${p.category||'Indian'}</span>
            </div>
            <div class="unsold-player-price">₹${basePrice.toFixed(2)} Cr</div>
            <div class="unsold-player-action">Select →</div>
          </div>`;
      } else { // marked
        html += `
          <div class="unsold-player-item">
            <div class="unsold-player-info">
              <span class="unsold-player-name">${p.name}</span>
              <span class="unsold-player-badge badge-${cat}">${p.category||'Indian'}</span>
            </div>
            <div class="unsold-player-price">₹${basePrice.toFixed(2)} Cr</div>
            <button class="btn btn-restore" onclick="restoreUnsold(${p.id},'${name}')">Re-queue</button>
          </div>`;
      }
    });
    html += `</div></div>`;
  });
  el.innerHTML = html;
}

function selectUnsoldPlayer(id, name, role, category, basePrice) {
  switchTab('current');
  currentPlayer = { id, name, role, category, base_price: basePrice };
  updatePlayerCard(currentPlayer);
  showFlash(`Selected: ${name}`, 'info');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Auctioneer Tool Modals ────────────────────────────────────────────────────

// Track unsold players for assign modal
let _unsoldPlayersCache = [];

function openAssignModal() {
  const m = document.getElementById('assign-modal');
  m.style.display = '';   // clear inline style so CSS takes over
  m.classList.add('open');
  // Load unsold + marked-unsold players into dropdown
  const sel = document.getElementById('assign-player-select');
  sel.innerHTML = '<option value="">-- Loading... --</option>';
  // Fetch both unsold queued and marked unsold
  Promise.all([
    fetch('/api/unsold-players').then(r => r.json()),
    fetch('/api/marked-unsold').then(r => r.json())
  ]).then(([queued, marked]) => {
    const all = [
      ...(queued.players || []).map(p => ({...p, _src: 'queued'})),
      ...(marked.players || []).map(p => ({...p, _src: 'marked'}))
    ];
    _unsoldPlayersCache = all;
    if (all.length === 0) {
      sel.innerHTML = '<option value="">-- No unsold players available --</option>';
      return;
    }
    sel.innerHTML = '<option value="">-- Select Player --</option>' +
      all.map(p => `<option value="${p.id}" data-role="${p.role}" data-category="${p.category}" data-src="${p._src}">
        ${p.name} (${p.role} • ${p.category}) ${p._src === 'marked' ? '[Marked Unsold]' : ''}
      </option>`).join('');
  });

  // Auto-fill role & category when player selected
  sel.onchange = function() {
    const opt = sel.selectedOptions[0];
    if (!opt || !opt.value) return;
    const role = opt.dataset.role;
    const cat  = opt.dataset.category;
    const roleEl = document.getElementById('assign-role');
    const catEl  = document.getElementById('assign-category');
    if (role) roleEl.value = role;
    if (cat)  catEl.value  = cat;
  };
}

function closeAssignModal() {
  const m = document.getElementById('assign-modal');
  m.classList.remove('open');
  m.style.display = 'none';
}
function openDeductModal() {
  const m = document.getElementById('deduct-modal');
  m.style.display = '';
  m.classList.add('open');
}
function closeDeductModal() {
  const m = document.getElementById('deduct-modal');
  m.classList.remove('open');
  m.style.display = 'none';
}
function openAddPlayerModal() {
  const m = document.getElementById('add-player-modal');
  m.style.display = '';
  m.classList.add('open');
}
function closeAddPlayerModal() {
  const m = document.getElementById('add-player-modal');
  m.classList.remove('open');
  m.style.display = 'none';
}

async function doAssignPlayer() {
  const sel      = document.getElementById('assign-player-select');
  const playerId = parseInt(sel.value);
  const role     = document.getElementById('assign-role').value;
  const category = document.getElementById('assign-category').value;
  const teamName = document.getElementById('assign-team').value;
  const amount   = parseFloat(document.getElementById('assign-amount').value);
  const msgEl    = document.getElementById('assign-msg');

  if (!playerId || !role || !category || !teamName || isNaN(amount)) {
    msgEl.textContent = 'All fields are required';
    msgEl.className = 'form-message error'; msgEl.style.display = 'block'; return;
  }

  // Get player name from cache
  const player = _unsoldPlayersCache.find(p => p.id === playerId);
  const playerName = player ? player.name : '';

  try {
    // First mark as sold via sell_player API (uses existing player in DB)
    const res  = await fetch('/api/sell', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ player_id: playerId, team_name: teamName, bid_amount: amount }),
    });
    const data = await res.json();
    msgEl.style.display = 'block';
    if (data.status === 'ok') {
      msgEl.textContent = `✅ ${playerName} assigned to ${teamName} for ₹${amount.toFixed(2)} Cr`;
      msgEl.className = 'form-message success';
      document.getElementById('assign-amount').value = '';
      sel.innerHTML = '<option value="">-- Select Player --</option>';
      _unsoldPlayersCache = _unsoldPlayersCache.filter(p => p.id !== playerId);
      updateTeamsPanel(data.teams); updateTeamSelect(data.teams);
      loadUnsoldCount(); loadMarkedCount();
      // Reload the dropdown
      setTimeout(() => {
        const m = document.getElementById('assign-modal');
        m.style.display = '';
        m.classList.add('open');
        openAssignModal();
      }, 500);
    } else {
      msgEl.textContent = data.message; msgEl.className = 'form-message error';
    }
  } catch { msgEl.textContent = 'Network error'; msgEl.className = 'form-message error'; msgEl.style.display = 'block'; }
}

async function doDeductBudget() {
  const teamName = document.getElementById('deduct-team').value;
  const amount   = parseFloat(document.getElementById('deduct-amount').value);
  const msgEl    = document.getElementById('deduct-msg');

  if (!teamName || isNaN(amount)) {
    msgEl.textContent = 'Team and amount required'; msgEl.className='form-message error'; msgEl.style.display='block'; return;
  }

  try {
    const res  = await fetch('/api/deduct-budget', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ team_name: teamName, amount }),
    });
    const data = await res.json();
    msgEl.style.display = 'block';
    if (data.status === 'ok') {
      msgEl.textContent = data.message; msgEl.className = 'form-message success';
      document.getElementById('deduct-amount').value = '';
      updateTeamsPanel(data.teams); updateTeamSelect(data.teams);
    } else {
      msgEl.textContent = data.message; msgEl.className = 'form-message error';
    }
  } catch { msgEl.textContent = 'Network error'; msgEl.className='form-message error'; msgEl.style.display='block'; }
}

async function doAddPlayer() {
  const name     = document.getElementById('new-player-name').value.trim();
  const role     = document.getElementById('new-player-role').value;
  const category = document.getElementById('new-player-category').value;
  const price    = parseFloat(document.getElementById('new-player-price').value);
  const msgEl    = document.getElementById('add-player-msg');

  if (!name || !role || !category || isNaN(price)) {
    msgEl.textContent = 'All fields required'; msgEl.className='form-message error'; msgEl.style.display='block'; return;
  }

  try {
    const res  = await fetch('/api/players/add', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ name, role, category, base_price: price }),
    });
    const data = await res.json();
    msgEl.style.display = 'block';
    if (data.status === 'ok') {
      msgEl.textContent = data.message; msgEl.className = 'form-message success';
      document.getElementById('new-player-name').value = '';
      document.getElementById('new-player-price').value = '';
      loadUnsoldCount();
    } else {
      msgEl.textContent = data.message; msgEl.className = 'form-message error';
    }
  } catch { msgEl.textContent = 'Network error'; msgEl.className='form-message error'; msgEl.style.display='block'; }
}

// ── Misc UI ───────────────────────────────────────────────────────────────────

let flashTimer = null;
function showFlash(msg, type = 'info') {
  let el = document.getElementById('flash');
  if (!el) { el = document.createElement('div'); el.id='flash'; el.className='flash'; document.body.insertBefore(el, document.body.firstChild); }
  el.textContent = msg; el.className = `flash ${type}`; el.style.display = 'block';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.style.display = 'none'; }, 3500);
}

function setLoading(on) {
  const ids = ['sell-btn','undo-btn','unsold-btn'];
  ids.forEach(id => { const el = document.getElementById(id); if (el) el.disabled = on; });
  document.querySelectorAll('#reset-btn,#reset-btn-empty').forEach(b => { b.disabled = on; });
  if (!on) validateBidInput();
}

// ── Modal close on background click ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  ['assign-modal','deduct-modal','add-player-modal'].forEach(id => {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.remove('open');
        modal.style.display = 'none';
      }
    });
  });
});

// Escape key closes all modals
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeTeamPopup();
    closeAssignModal();
    closeDeductModal();
    closeAddPlayerModal();
  }
});

// ── Team Detail Popup ─────────────────────────────────────────────────────────

function openTeamPopup(teamName) {
  const popup = document.getElementById('team-popup');
  if (!popup) return;

  // Reset content
  document.getElementById('popup-team-code').textContent = '…';
  document.getElementById('popup-team-name').textContent = teamName;
  document.getElementById('popup-purse').textContent = '…';
  document.getElementById('popup-players').textContent = '…';
  document.getElementById('popup-overseas').textContent = '…';
  document.getElementById('popup-wk').textContent = '…';
  document.getElementById('popup-spent').textContent = '…';
  document.getElementById('popup-purse-bar').style.width = '0%';
  document.getElementById('popup-purse-pct').textContent = '0%';
  document.getElementById('popup-squad-body').innerHTML =
    '<div class="loading-unsold"><span class="spinner"></span><span>Loading squad…</span></div>';

  popup.classList.add('open');

  // Fetch team detail
  fetch(`/api/teams/${encodeURIComponent(teamName)}`)
    .then(r => r.json())
    .then(d => {
      if (d.status !== 'ok' || !d.team) {
        document.getElementById('popup-squad-body').innerHTML =
          '<div class="error-message">Failed to load team data.</div>';
        return;
      }
      renderTeamPopup(d.team);
    })
    .catch(() => {
      document.getElementById('popup-squad-body').innerHTML =
        '<div class="error-message">Network error.</div>';
    });
}

function renderTeamPopup(team) {
  const purse   = parseFloat(team.purse || 0);
  const spent   = parseFloat(team.total_spent || 0);
  const total   = purse + spent;           // original budget
  const pct     = total > 0 ? Math.round((spent / total) * 100) : 0;
  const wkCount = parseInt(team.wk_count || 0);

  // Header
  document.getElementById('popup-team-code').textContent = team.short_code || '';
  document.getElementById('popup-team-name').textContent = team.name || '';

  // Stats
  document.getElementById('popup-purse').textContent    = `₹${purse.toFixed(2)} Cr`;
  document.getElementById('popup-players').textContent  = `${team.total_players || 0}/18`;
  document.getElementById('popup-overseas').textContent = `${team.overseas_count || 0}/8`;
  document.getElementById('popup-wk').textContent       = `${wkCount}/2`;
  document.getElementById('popup-spent').textContent    = `₹${spent.toFixed(2)} Cr`;

  // Keeper warning
  const wkBox = document.getElementById('popup-wk-box');
  wkBox.classList.toggle('tps-warn', wkCount < 2);

  // Progress bar
  document.getElementById('popup-purse-bar').style.width = `${pct}%`;
  document.getElementById('popup-purse-pct').textContent = `${pct}%`;

  // Squad
  const body = document.getElementById('popup-squad-body');
  const players = team.players || [];

  if (players.length === 0) {
    body.innerHTML = '<div class="no-unsold" style="padding:1.5rem 0;"><p>No players bought yet.</p></div>';
    return;
  }

  // Group by role
  const grouped = {};
  players.forEach(p => {
    const r = p.role || 'Other';
    if (!grouped[r]) grouped[r] = [];
    grouped[r].push(p);
  });

  const roleOrder = ['Wicket-Keeper','Batsman','All-Rounder','Bowler','Other'];
  const orderedRoles = roleOrder.filter(r => grouped[r]).concat(
    Object.keys(grouped).filter(r => !roleOrder.includes(r))
  );

  let html = '<table class="squad-popup-table">';
  html += '<thead><tr><th>#</th><th>Player</th><th>Cat</th><th>Role</th><th>Price</th></tr></thead><tbody>';

  let idx = 1;
  orderedRoles.forEach(role => {
    // Role separator row
    html += `<tr class="squad-role-row"><td colspan="5">${role} <span class="role-count">(${grouped[role].length})</span></td></tr>`;
    grouped[role].forEach(p => {
      const cat = (p.category || 'indian').toLowerCase();
      const price = parseFloat(p.current_bid || p.bid_amount || 0);
      html += `<tr>
        <td class="squad-num">${idx++}</td>
        <td class="squad-name">${p.name || '—'}</td>
        <td><span class="unsold-player-badge badge-${cat}" style="display:inline-block;">${p.category || 'Indian'}</span></td>
        <td class="squad-role-cell">${p.role || '—'}</td>
        <td class="squad-price">₹${price.toFixed(2)}</td>
      </tr>`;
    });
  });

  html += '</tbody></table>';
  body.innerHTML = html;
}

function closeTeamPopup() {
  const popup = document.getElementById('team-popup');
  if (popup) popup.classList.remove('open');
}

// Close popup on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeTeamPopup();
    closeAssignModal();
    closeDeductModal();
    closeAddPlayerModal();
  }
});