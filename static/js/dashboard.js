// Dashboard: SSE real-time updates + squad expansion

document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();

  // SSE — auto-update on any auctioneer action, no manual refresh needed
  const es = new EventSource('/api/events');
  const ALL_EVENTS = ['sale','unsold','undo','reset','cancel_rebid','budget_deducted','player_assigned','restore'];
  ALL_EVENTS.forEach(ev => {
    es.addEventListener(ev, (e) => {
      const data = JSON.parse(e.data);
      // If event carries teams data, update directly without a fetch round-trip
      if (data.teams) {
        updateAllCards(data.teams);
      } else {
        // fallback full reload
        loadDashboard();
      }
      showToast(ev);
    });
  });

  es.addEventListener('ping', () => {}); // keep-alive, ignore
  es.onerror = () => {
    // SSE dropped, retry after 3s
    setTimeout(() => location.reload(), 3000);
  };
});

function loadDashboard() {
  fetch('/api/teams').then(r => r.json()).then(d => {
    if (d.status !== 'ok') return;
    updateAllCards(d.teams);
    document.getElementById('last-updated').textContent = new Date().toLocaleTimeString();
  });
}

function updateAllCards(teams) {
  let totalPlayers = 0, totalSpent = 0, totalOverseas = 0, totalWK = 0;
  teams.forEach(t => {
    totalPlayers  += t.total_players  || 0;
    totalSpent    += (100 - parseFloat(t.purse || 0));
    totalOverseas += t.overseas_count || 0;
    totalWK       += t.wk_count       || 0;
    updateTeamCard(t);
  });
  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('total-players',  totalPlayers);
  el('total-spent',    `₹${totalSpent.toFixed(2)} Cr`);
  el('total-overseas', totalOverseas);
  el('total-wk',       totalWK);
  el('last-updated',   new Date().toLocaleTimeString());
}

function updateTeamCard(t) {
  const card = document.getElementById(`dash-${t.id}`);
  if (!card) return;
  const purse = parseFloat(t.purse || 0);
  const purseClass = purse < 20 ? 'low' : purse < 50 ? 'mid' : 'high';

  const purseVal = card.querySelector('.purse-value');
  const purseDiv = card.querySelector('.dash-purse');
  const fill     = card.querySelector('.purse-progress-fill');
  if (purseVal) purseVal.textContent = `₹${purse.toFixed(2)} Cr`;
  if (purseDiv) purseDiv.className   = `dash-purse purse-${purseClass}`;
  if (fill)     fill.style.width     = `${Math.min((purse / 100) * 100, 100)}%`;

  const vals = card.querySelectorAll('.stat-val');
  if (vals[0]) vals[0].textContent = t.total_players  || 0;
  if (vals[1]) vals[1].textContent = `${t.overseas_count || 0}/8`;
  if (vals[2]) vals[2].textContent = t.wk_count || 0;

  // Update WK warning
  const wkBox = card.querySelectorAll('.stat-box')[2];
  if (wkBox) {
    wkBox.className = `stat-box ${(t.wk_count || 0) < 1 ? 'wk-warn-box' : ''}`;
    const lbl = wkBox.querySelector('.stat-lbl');
    if (lbl) lbl.textContent = `WK ${(t.wk_count || 0) < 1 ? '⚠️' : '✅'}`;
  }

  // Update squad title count
  const squadTitle = card.querySelector('.squad-title');
  if (squadTitle) squadTitle.textContent = `Squad (${t.total_players || 0})`;

  // If squad is expanded, reload it
  const squadEl = document.getElementById(`players-${t.id}`);
  if (squadEl && squadEl.style.display === 'block') {
    loadSquad(t.id, t.name);
  }
}

function toggleSquad(teamId) {
  const el = document.getElementById(`players-${teamId}`);
  if (!el) return;
  if (el.style.display === 'none' || !el.style.display) {
    el.style.display = 'block';
    const card = document.getElementById(`dash-${teamId}`);
    const teamName = card?.dataset.name;
    if (teamName) loadSquad(teamId, teamName);
  } else {
    el.style.display = 'none';
  }
}

function loadSquad(teamId, teamName) {
  const el = document.getElementById(`players-${teamId}`);
  if (!el) return;
  fetch(`/api/teams/${encodeURIComponent(teamName)}`).then(r => r.json()).then(d => {
    if (d.status !== 'ok') { el.innerHTML = '<p>Error loading squad</p>'; return; }
    const players = d.team.players || [];
    if (players.length === 0) {
      el.innerHTML = '<p class="empty-squad">No players bought yet</p>';
      return;
    }
    el.innerHTML = players.map(p => `
      <div class="squad-player-row">
        <span class="sp-name">${p.name}</span>
        <span class="sp-cat badge-${(p.category||'indian').toLowerCase()}">${p.category}</span>
        <span class="sp-role">${p.role}</span>
        <span class="sp-price">₹${parseFloat(p.current_bid||0).toFixed(2)} Cr</span>
      </div>`).join('');
  });
}

// Toast notification for updates
let toastTimer;
function showToast(eventType) {
  const msgs = {
    sale:            '🔨 Player sold!',
    unsold:          '🚫 Player marked unsold',
    undo:            '↩ Last sale undone',
    reset:           '🔄 Auction reset — all budgets restored',
    cancel_rebid:    '↩ Sale cancelled — player re-queued',
    budget_deducted: '💸 Team budget deducted',
    player_assigned: '✅ Player assigned to team',
    restore:         '🔁 Player restored to queue',
  };
  let toast = document.getElementById('dash-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'dash-toast';
    toast.style.cssText = `
      position:fixed; bottom:1.5rem; right:1.5rem; z-index:9999;
      background:#1e293b; border:1px solid #334155; color:#f1f5f9;
      padding:0.75rem 1.25rem; border-radius:10px; font-size:0.9rem;
      font-weight:600; box-shadow:0 4px 20px rgba(0,0,0,.5);
      transition: opacity .3s;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = msgs[eventType] || '🔄 Updated';
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}