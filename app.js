/* =========================================================================
   Bolão Copa 2026 — app.js
   Estado, navegação entre telas, persistência (localStorage com debounce),
   compartilhamento (lz-string + WhatsApp intent), PDF (html2pdf.js).
   Vanilla JS — roda em GitHub Pages, sem build.
   ========================================================================= */
(function () {
  'use strict';

  /* ---------- Data ---------- */
  const JOGOS = window.__JOGOS__;
  const TEAM_COLORS = window.__TEAM_COLORS__ || {};
  const GRUPOS = JOGOS.grupos;
  const ALL_TEAMS = GRUPOS.flatMap(g => g.times); // 48 times, ordem dos grupos
  const TEAM_BY_CODE = Object.fromEntries(ALL_TEAMS.map(t => [t.codigo, t]));
  const ALL_MATCHES = GRUPOS.flatMap(g => g.jogos);
  const TOTAL_JOGOS = ALL_MATCHES.length; // 72

  /* ---------- Storage ---------- */
  const STORAGE_KEY = 'bolao-copa-2026';
  const DEFAULT_STATE = () => ({
    nome: '',
    time: null,
    palpites: {},      // { G01: { casa: 2, fora: 1 } }
    bonus: { campeao: '', artilheiro: '', zebra: '' },
    screenIdx: 0,      // 0=welcome, 1..12=grupos A..L, 13=bonus, 14=summary
    createdAt: Date.now(),
  });

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_STATE();
      const parsed = JSON.parse(raw);
      return Object.assign(DEFAULT_STATE(), parsed);
    } catch (e) {
      console.warn('storage load failed', e);
      return DEFAULT_STATE();
    }
  }

  let state = loadState();
  let viewOnly = false;
  let viewOnlyData = null;

  let saveTimer = null;
  let savePillTimer = null;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
      showSavedPill();
    }, 300);
  }
  function showSavedPill() {
    const el = document.getElementById('savedPill');
    if (!el) return;
    el.classList.add('is-on');
    clearTimeout(savePillTimer);
    savePillTimer = setTimeout(() => el.classList.remove('is-on'), 900);
  }

  /* ---------- Helpers ---------- */
  function flagSrc(code, w) {
    const size = w || 80;
    // flagcdn ISO codes ou subdivisões (gb-eng, gb-sct)
    return `https://flagcdn.com/w${size}/${code}.png`;
  }
  function flagSrcSet(code) {
    return `https://flagcdn.com/w40/${code}.png 1x, https://flagcdn.com/w80/${code}.png 2x`;
  }
  function fmtDate(iso) {
    // iso = "2026-06-11"
    const months = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    const [, m, d] = iso.split('-').map(Number);
    return `${String(d).padStart(2,'0')}/${months[m-1]}`;
  }
  function fmtHora(h) {
    // "16:00" → "16h"
    if (!h) return '';
    const [hh, mm] = h.split(':');
    return mm === '00' ? `${hh}h` : `${hh}h${mm}`;
  }
  function setAccent(hex) {
    const root = document.documentElement;
    if (!hex) {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-ink');
      root.style.removeProperty('--accent-soft');
      root.style.removeProperty('--accent-line');
      return;
    }
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--accent-ink', accentInk(hex));
    root.style.setProperty('--accent-soft', hexToRgba(hex, 0.16));
    root.style.setProperty('--accent-line', hexToRgba(hex, 0.42));
    // meta theme-color para barra do navegador
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', '#0b0c0e');
  }
  function hexToRgba(hex, a) {
    const v = hex.replace('#','');
    const r = parseInt(v.slice(0,2),16);
    const g = parseInt(v.slice(2,4),16);
    const b = parseInt(v.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }
  function accentInk(hex) {
    const v = hex.replace('#','');
    const r = parseInt(v.slice(0,2),16);
    const g = parseInt(v.slice(2,4),16);
    const b = parseInt(v.slice(4,6),16);
    const lum = (0.299*r + 0.587*g + 0.114*b);
    return lum > 150 ? '#0b0c0e' : '#ffffff';
  }
  function countFilled() {
    let n = 0;
    for (const m of ALL_MATCHES) {
      const p = state.palpites[m.id];
      if (p && Number.isFinite(p.casa) && Number.isFinite(p.fora)) n++;
    }
    return n;
  }
  function countFilledInGroup(idx) {
    let n = 0;
    for (const m of GRUPOS[idx].jogos) {
      const p = state.palpites[m.id];
      if (p && Number.isFinite(p.casa) && Number.isFinite(p.fora)) n++;
    }
    return n;
  }
  function countBonus() {
    const b = state.bonus;
    return (b.campeao ? 1 : 0) + (b.artilheiro?.trim() ? 1 : 0) + (b.zebra?.trim() ? 1 : 0);
  }
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('is-on'), 2200);
  }

  /* ---------- Routing ---------- */
  // screenIdx:
  // 0           => welcome
  // 1..12       => grupos A..L  (idx grupo = screenIdx - 1)
  // 13          => bonus
  // 14          => summary
  const SCREEN_WELCOME = 0;
  const SCREEN_BONUS = 13;
  const SCREEN_SUMMARY = 14;
  function isGroupScreen(i) { return i >= 1 && i <= 12; }

  function go(idx) {
    state.screenIdx = idx;
    saveState();
    render();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  /* ---------- Render orchestrator ---------- */
  function render() {
    if (viewOnly) {
      renderViewOnly();
      document.body.dataset.screen = 'viewonly';
      showOnly('viewonly');
      return;
    }
    const i = state.screenIdx;

    if (i === SCREEN_WELCOME) {
      document.body.dataset.screen = 'welcome';
      showOnly('welcome');
      renderWelcome();
    } else if (isGroupScreen(i)) {
      document.body.dataset.screen = 'group';
      showOnly('group');
      renderGroup(i - 1);
    } else if (i === SCREEN_BONUS) {
      document.body.dataset.screen = 'bonus';
      showOnly('bonus');
      renderBonus();
    } else if (i === SCREEN_SUMMARY) {
      document.body.dataset.screen = 'summary';
      showOnly('summary');
      renderSummary();
    }
    renderChrome();
  }

  function showOnly(name) {
    document.querySelectorAll('.screen').forEach(s => {
      s.hidden = (s.dataset.screen !== name);
    });
  }

  function renderChrome() {
    const i = state.screenIdx;
    const topbar = document.getElementById('topbar');
    const navbar = document.getElementById('navbar');
    const fab = document.getElementById('fabRandom');

    const internal = isGroupScreen(i) || i === SCREEN_BONUS;
    topbar.hidden = !internal;
    navbar.hidden = !internal;
    fab.hidden = !isGroupScreen(i);

    if (!internal) return;

    // Topbar conteúdo
    const totalFilled = countFilled();
    document.getElementById('progressFill').style.width = `${(totalFilled / TOTAL_JOGOS) * 100}%`;
    document.getElementById('topbarCounter').textContent = `${totalFilled}/72`;
    if (isGroupScreen(i)) {
      document.getElementById('topbarTitle').textContent = `Grupo ${i}/12`;
    } else {
      document.getElementById('topbarTitle').textContent = 'Palpites bônus';
    }

    // Navbar label
    const nextLabel = document.getElementById('navNextLabel');
    if (isGroupScreen(i)) {
      nextLabel.textContent = (i === 12) ? 'Palpites bônus' : 'Próximo grupo';
    } else {
      nextLabel.textContent = 'Finalizar cartela';
    }
  }

  /* ---------- Welcome ---------- */
  function renderWelcome() {
    const nomeInput = document.getElementById('nomeInput');
    nomeInput.value = state.nome || '';

    // Grid de times
    const grid = document.getElementById('teamGrid');
    grid.innerHTML = '';
    ALL_TEAMS.forEach(t => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'teamchip' + (state.time === t.codigo ? ' is-selected' : '');
      chip.setAttribute('role', 'option');
      chip.setAttribute('aria-selected', state.time === t.codigo ? 'true' : 'false');
      chip.title = t.nome;
      chip.innerHTML = `
        <img class="teamchip__flag" src="${flagSrc(t.bandeira, 80)}" alt="" loading="lazy" />
        <span class="teamchip__sigla">${t.codigo}</span>
      `;
      chip.addEventListener('click', () => selectTeam(t.codigo));
      grid.appendChild(chip);
    });

    // Hint
    const hint = document.getElementById('teampickHint');
    if (state.time) {
      hint.textContent = TEAM_BY_CODE[state.time].nome;
    } else {
      hint.textContent = 'define a cor da sua cartela';
    }

    updateStartBtn();
  }

  function selectTeam(code) {
    state.time = code;
    const color = TEAM_COLORS[code] || '#22c55e';
    setAccent(color);
    saveState();
    renderWelcome();
  }

  function updateStartBtn() {
    const btn = document.getElementById('startBtn');
    btn.disabled = !(state.nome && state.nome.trim().length >= 2 && state.time);
  }

  document.getElementById('nomeInput').addEventListener('input', (e) => {
    state.nome = e.target.value;
    saveState();
    updateStartBtn();
    e.target.classList.toggle('is-filled', e.target.value.trim().length >= 2);
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    if (document.getElementById('startBtn').disabled) return;
    go(1);
  });

  /* ---------- Group screen ---------- */
  function renderGroup(idx) {
    const g = GRUPOS[idx];
    document.getElementById('groupLetter').textContent = g.letra;
    document.getElementById('groupTitle').textContent = `Grupo ${g.letra}`;
    const teamsEl = document.getElementById('groupTeams');
    teamsEl.innerHTML = g.times.map(t => `<span>${t.codigo}</span>`).join('');

    // Lista de partidas
    const ol = document.getElementById('matchesList');
    ol.innerHTML = '';
    g.jogos.forEach((m, mi) => {
      const li = document.createElement('li');
      li.className = 'match';
      const home = TEAM_BY_CODE[m.casa];
      const away = TEAM_BY_CODE[m.fora];
      const palp = state.palpites[m.id] || {};
      const filled = Number.isFinite(palp.casa) && Number.isFinite(palp.fora);
      if (filled) li.classList.add('is-filled');

      li.innerHTML = `
        <div class="match__row">
          <div class="match__team match__team--home">
            <img class="match__flag" src="${flagSrc(home.bandeira, 80)}" alt="${home.nome}" loading="lazy" />
            <span class="match__sigla">${home.codigo}</span>
          </div>
          <div class="match__scores">
            <input class="match__input ${Number.isFinite(palp.casa) ? 'is-filled' : ''}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2"
                   data-match="${m.id}" data-side="casa" value="${Number.isFinite(palp.casa) ? palp.casa : ''}" placeholder="–" aria-label="Gols ${home.codigo}" />
            <span class="match__x">×</span>
            <input class="match__input ${Number.isFinite(palp.fora) ? 'is-filled' : ''}" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="2"
                   data-match="${m.id}" data-side="fora" value="${Number.isFinite(palp.fora) ? palp.fora : ''}" placeholder="–" aria-label="Gols ${away.codigo}" />
          </div>
          <div class="match__team match__team--away">
            <img class="match__flag" src="${flagSrc(away.bandeira, 80)}" alt="${away.nome}" loading="lazy" />
            <span class="match__sigla">${away.codigo}</span>
          </div>
        </div>
        <div class="match__meta">
          <span>${fmtDate(m.data)}</span>
          <span class="match__meta-dot"></span>
          <span>${fmtHora(m.hora)}</span>
          <span class="match__meta-dot"></span>
          <span class="match__meta-stadium">${m.estadio}</span>
        </div>
      `;
      ol.appendChild(li);
    });

    // Eventos nos inputs
    ol.querySelectorAll('.match__input').forEach((input) => {
      input.addEventListener('focus', (e) => e.target.select());
      input.addEventListener('input', onScoreInput);
      input.addEventListener('keydown', onScoreKey);
      input.addEventListener('blur', onScoreBlur);
    });
  }

  function onScoreInput(e) {
    const el = e.target;
    // Mantém apenas dígitos, no máximo 2
    const raw = el.value.replace(/[^0-9]/g, '').slice(0, 2);
    if (raw !== el.value) el.value = raw;

    const mid = el.dataset.match;
    const side = el.dataset.side;
    const val = raw === '' ? null : Math.min(parseInt(raw, 10), 20);
    state.palpites[mid] = state.palpites[mid] || {};
    if (val === null) {
      delete state.palpites[mid][side];
      el.classList.remove('is-filled');
    } else {
      state.palpites[mid][side] = val;
      el.classList.add('is-filled');
    }
    updateMatchFilled(mid);
    saveState();
    renderChrome();

    // Auto-advance: ao digitar dígito em "casa" foca o "fora" depois de uma pequena pausa
    // (deixa janela pra o usuário digitar "10"). Cancela se o user mudar o valor.
    clearTimeout(el._advTimer);
    if (raw.length >= 1) {
      el._advTimer = setTimeout(() => {
        const stillSame = el.value === raw;
        if (!stillSame) return;
        if (side === 'casa') {
          const otherInput = document.querySelector(`.match__input[data-match="${mid}"][data-side="fora"]`);
          if (otherInput && document.activeElement === el) otherInput.focus();
        } else if (raw.length === 2) {
          el.blur();
        }
      }, 650);
    }
  }
  function onScoreKey(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const el = e.target;
      const mid = el.dataset.match;
      const side = el.dataset.side;
      if (side === 'casa') {
        const other = document.querySelector(`.match__input[data-match="${mid}"][data-side="fora"]`);
        if (other) other.focus();
      } else {
        const all = [...document.querySelectorAll('.match__input')];
        const i = all.indexOf(el);
        if (all[i+1]) all[i+1].focus(); else el.blur();
      }
    } else if (e.key === 'Tab') {
      // deixa default
    } else if (e.key === 'Backspace' && e.target.value === '') {
      const el = e.target;
      const mid = el.dataset.match;
      const side = el.dataset.side;
      if (side === 'fora') {
        const other = document.querySelector(`.match__input[data-match="${mid}"][data-side="casa"]`);
        if (other) other.focus();
      }
    }
  }
  function onScoreBlur(e) {
    const el = e.target;
    if (el.value === '') return;
    // normaliza zeros à esquerda
    const n = parseInt(el.value, 10);
    if (Number.isFinite(n)) el.value = String(n);
  }

  function updateMatchFilled(mid) {
    const p = state.palpites[mid];
    const filled = p && Number.isFinite(p.casa) && Number.isFinite(p.fora);
    const inputs = document.querySelectorAll(`.match__input[data-match="${mid}"]`);
    if (!inputs.length) return;
    const card = inputs[0].closest('.match');
    if (card) card.classList.toggle('is-filled', !!filled);
  }

  /* ---------- Navbar ---------- */
  document.getElementById('navBackBtn').addEventListener('click', () => {
    if (state.screenIdx > 0) go(state.screenIdx - 1);
  });
  document.getElementById('backBtn').addEventListener('click', () => {
    if (state.screenIdx > 0) go(state.screenIdx - 1);
  });
  document.getElementById('navNextBtn').addEventListener('click', () => {
    go(state.screenIdx + 1);
  });

  /* ---------- FAB chutar restantes ---------- */
  document.getElementById('fabRandom').addEventListener('click', () => {
    // Distribuição realista: 0–4 gols, com peso favorecendo 0–2
    const weights = [22, 28, 22, 14, 8, 4, 1, 1]; // 0..7
    const pickGoal = () => {
      let r = Math.random() * weights.reduce((a,b) => a+b, 0);
      for (let i = 0; i < weights.length; i++) {
        if (r < weights[i]) return i;
        r -= weights[i];
      }
      return 0;
    };
    const idx = state.screenIdx - 1;
    let added = 0;
    GRUPOS[idx].jogos.forEach(m => {
      const p = state.palpites[m.id] || {};
      if (!Number.isFinite(p.casa)) { p.casa = pickGoal(); added++; }
      if (!Number.isFinite(p.fora)) { p.fora = pickGoal(); added++; }
      state.palpites[m.id] = p;
    });
    saveState();
    renderGroup(idx);
    renderChrome();
    toast(added ? `✨ ${added/2 | 0} palpites chutados` : 'Esse grupo já tava completo');
  });

  /* ---------- Bonus ---------- */
  function renderBonus() {
    const sel = document.getElementById('campeaoSelect');
    if (sel.options.length <= 1) {
      // popular 1x
      const sorted = [...ALL_TEAMS].sort((a,b) => a.nome.localeCompare(b.nome, 'pt'));
      sorted.forEach(t => {
        const o = document.createElement('option');
        o.value = t.codigo;
        o.textContent = t.nome;
        sel.appendChild(o);
      });
    }
    sel.value = state.bonus.campeao || '';
    document.getElementById('artilheiroInput').value = state.bonus.artilheiro || '';
    document.getElementById('zebraInput').value = state.bonus.zebra || '';

    updateBonusFilledClasses();
  }
  function updateBonusFilledClasses() {
    const cards = document.querySelectorAll('.bonus__card');
    cards[0]?.classList.toggle('is-filled', !!state.bonus.campeao);
    cards[1]?.classList.toggle('is-filled', !!state.bonus.artilheiro?.trim());
    cards[2]?.classList.toggle('is-filled', !!state.bonus.zebra?.trim());
  }
  document.getElementById('campeaoSelect').addEventListener('change', (e) => {
    state.bonus.campeao = e.target.value;
    saveState();
    updateBonusFilledClasses();
  });
  document.getElementById('artilheiroInput').addEventListener('input', (e) => {
    state.bonus.artilheiro = e.target.value;
    saveState();
    updateBonusFilledClasses();
  });
  document.getElementById('zebraInput').addEventListener('input', (e) => {
    state.bonus.zebra = e.target.value;
    saveState();
    updateBonusFilledClasses();
  });

  /* ---------- Summary ---------- */
  function renderSummary() {
    document.getElementById('summaryName').textContent = state.nome || '—';
    document.getElementById('statJogos').textContent = countFilled();
    document.getElementById('statBonus').textContent = countBonus();
    const team = state.time ? TEAM_BY_CODE[state.time] : null;
    const flagEl = document.getElementById('statTeamFlag');
    flagEl.innerHTML = team ? `<img src="${flagSrc(team.bandeira, 80)}" alt="" />` : '';
    document.getElementById('statTeamName').textContent = team ? team.codigo : '—';

    // Lista resumo
    const listEl = document.getElementById('summaryList');
    listEl.innerHTML = '';
    GRUPOS.forEach((g) => {
      listEl.appendChild(renderSummaryGroup(g));
    });
    listEl.appendChild(renderSummaryBonus());
  }
  function renderSummaryGroup(g) {
    const wrap = document.createElement('div');
    wrap.className = 'summary__group';
    const filled = g.jogos.filter(m => {
      const p = state.palpites[m.id]; return p && Number.isFinite(p.casa) && Number.isFinite(p.fora);
    }).length;
    wrap.innerHTML = `
      <div class="summary__group-head">
        <div class="summary__group-letter">${g.letra}</div>
        <div class="summary__group-name">Grupo ${g.letra}</div>
        <div class="summary__group-count">${filled}/6</div>
      </div>
    `;
    g.jogos.forEach(m => {
      const home = TEAM_BY_CODE[m.casa];
      const away = TEAM_BY_CODE[m.fora];
      const p = state.palpites[m.id] || {};
      const has = Number.isFinite(p.casa) && Number.isFinite(p.fora);
      const div = document.createElement('div');
      div.className = 'summary__match' + (has ? '' : ' summary__match--empty');
      div.innerHTML = `
        <div class="summary__match-side">
          <img src="${flagSrc(home.bandeira, 40)}" alt="" />
          <span>${home.codigo}</span>
        </div>
        <div class="summary__match-score ${has ? '' : 'summary__match-score--empty'}">
          ${has ? p.casa : '–'} : ${has ? p.fora : '–'}
        </div>
        <div class="summary__match-side summary__match-side--away">
          <img src="${flagSrc(away.bandeira, 40)}" alt="" />
          <span>${away.codigo}</span>
        </div>
      `;
      wrap.appendChild(div);
    });
    return wrap;
  }
  function renderSummaryBonus() {
    const wrap = document.createElement('div');
    wrap.className = 'summary__bonus';
    const camp = state.bonus.campeao ? (TEAM_BY_CODE[state.bonus.campeao]?.nome || state.bonus.campeao) : null;
    wrap.innerHTML = `
      <div class="summary__group-head" style="margin-bottom: 10px;">
        <div class="summary__group-letter">★</div>
        <div class="summary__group-name">Palpites bônus</div>
        <div class="summary__group-count">${countBonus()}/3</div>
      </div>
      <div class="summary__bonus-row">
        <span>🏆</span><strong>Campeão</strong>
        <span class="summary__bonus-val ${camp ? '' : 'summary__bonus-val--empty'}">${camp || 'em branco'}</span>
      </div>
      <div class="summary__bonus-row">
        <span>⚽</span><strong>Artilheiro</strong>
        <span class="summary__bonus-val ${state.bonus.artilheiro ? '' : 'summary__bonus-val--empty'}">${state.bonus.artilheiro || 'em branco'}</span>
      </div>
      <div class="summary__bonus-row">
        <span>🐴</span><strong>Zebra</strong>
        <span class="summary__bonus-val ${state.bonus.zebra ? '' : 'summary__bonus-val--empty'}">${state.bonus.zebra || 'em branco'}</span>
      </div>
    `;
    return wrap;
  }

  document.getElementById('editBtn').addEventListener('click', () => go(1));

  /* ---------- Share via WhatsApp + URL comprimida ---------- */
  function buildShareUrl() {
    const payload = {
      n: state.nome,
      t: state.time,
      p: state.palpites,
      b: state.bonus,
    };
    const json = JSON.stringify(payload);
    const compressed = LZString.compressToEncodedURIComponent(json);
    const base = location.origin + location.pathname;
    return `${base}?b=${compressed}`;
  }
  document.getElementById('shareWa').addEventListener('click', () => {
    const url = buildShareUrl();
    const team = state.time ? TEAM_BY_CODE[state.time] : null;
    const filled = countFilled();
    const lines = [
      `🏆 *Minha cartela do Bolão Copa 2026*`,
      ``,
      `👤 ${state.nome || '—'}`,
      team ? `❤️ ${team.nome}` : null,
      `📊 ${filled}/72 jogos · ${countBonus()}/3 bônus`,
    ].filter(Boolean);
    if (state.bonus.campeao) {
      const cn = TEAM_BY_CODE[state.bonus.campeao]?.nome || state.bonus.campeao;
      lines.push(`🥇 Campeão: ${cn}`);
    }
    if (state.bonus.artilheiro) lines.push(`⚽ Artilheiro: ${state.bonus.artilheiro}`);
    if (state.bonus.zebra) lines.push(`🐴 Zebra: ${state.bonus.zebra}`);
    lines.push(``, `Vê minha cartela aqui:`, url);
    const text = encodeURIComponent(lines.join('\n'));
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener');
  });

  /* ---------- PDF ---------- */
  document.getElementById('downloadPdf').addEventListener('click', async () => {
    const root = document.getElementById('pdfRoot');
    root.innerHTML = buildPdfHTML();
    const today = new Date().toLocaleDateString('pt-BR');
    const filename = `bolao-copa-2026-${(state.nome || 'cartela').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}.pdf`;
    toast('Gerando PDF…');
    try {
      await html2pdf().set({
        margin: 0,
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'pt', format: 'a4', orientation: 'portrait' },
      }).from(root.firstElementChild).save();
      toast('✓ PDF salvo');
    } catch (e) {
      console.error(e);
      toast('Erro ao gerar PDF');
    } finally {
      root.innerHTML = '';
    }
  });

  function buildPdfHTML() {
    const today = new Date().toLocaleDateString('pt-BR');
    const team = state.time ? TEAM_BY_CODE[state.time] : null;
    const groups = GRUPOS.map(g => {
      const matches = g.jogos.map(m => {
        const home = TEAM_BY_CODE[m.casa], away = TEAM_BY_CODE[m.fora];
        const p = state.palpites[m.id] || {};
        const has = Number.isFinite(p.casa) && Number.isFinite(p.fora);
        return `
          <div class="pdf__match ${has ? 'pdf__match--filled' : ''}">
            <div class="pdf__match-side">
              <img src="${flagSrc(home.bandeira, 40)}" crossorigin="anonymous" />
              <span>${home.codigo}</span>
            </div>
            <div class="pdf__match-score ${has ? '' : 'pdf__match-score--empty'}">
              ${has ? p.casa : '–'} : ${has ? p.fora : '–'}
            </div>
            <div class="pdf__match-side pdf__match-side--away">
              <img src="${flagSrc(away.bandeira, 40)}" crossorigin="anonymous" />
              <span>${away.codigo}</span>
            </div>
          </div>
        `;
      }).join('');
      return `
        <section class="pdf__group">
          <div class="pdf__group-head">
            <div class="pdf__group-letter">${g.letra}</div>
            <div class="pdf__group-name">Grupo ${g.letra}</div>
            <div class="pdf__group-teams">${g.times.map(t=>t.codigo).join(' · ')}</div>
          </div>
          <div class="pdf__matches">${matches}</div>
        </section>
      `;
    }).join('');

    const camp = state.bonus.campeao ? (TEAM_BY_CODE[state.bonus.campeao]?.nome || state.bonus.campeao) : '—';

    return `
      <div class="pdf">
        <header class="pdf__head">
          <div>
            <div class="pdf__brand-eyebrow">BOLÃO · COPA · 2026</div>
            <div class="pdf__brand-title">Cartela oficial</div>
          </div>
          <div class="pdf__player">
            <strong>${state.nome || '—'}</strong>
            ${team ? `Time do coração: ${team.nome}` : ''}<br/>
            Emitida em ${today}
          </div>
        </header>
        ${groups}
        <section class="pdf__bonus-page">
          <h2 class="pdf__bonus-title">Palpites bônus</h2>
          <div class="pdf__bonus-list">
            <div class="pdf__bonus-item"><span class="pdf__bonus-item-label">🏆 Campeão</span><span class="pdf__bonus-item-val">${camp}</span></div>
            <div class="pdf__bonus-item"><span class="pdf__bonus-item-label">⚽ Artilheiro</span><span class="pdf__bonus-item-val">${state.bonus.artilheiro || '—'}</span></div>
            <div class="pdf__bonus-item"><span class="pdf__bonus-item-label">🐴 Zebra</span><span class="pdf__bonus-item-val">${state.bonus.zebra || '—'}</span></div>
          </div>
        </section>
        <footer class="pdf__foot">
          Gerado por bolao-copa-2026 · ${countFilled()}/72 jogos · ${countBonus()}/3 bônus
        </footer>
      </div>
    `;
  }

  /* ---------- View-only (URL ?b=...) ---------- */
  function detectViewOnly() {
    const p = new URLSearchParams(location.search);
    const b = p.get('b');
    if (!b) return null;
    try {
      const json = LZString.decompressFromEncodedURIComponent(b);
      if (!json) return null;
      return JSON.parse(json);
    } catch (e) {
      console.warn('viewonly decode failed', e);
      return null;
    }
  }

  function renderViewOnly() {
    const d = viewOnlyData;
    document.getElementById('viewonlyName').textContent = d.n || 'Cartela compartilhada';
    const team = d.t ? TEAM_BY_CODE[d.t] : null;
    let filled = 0;
    for (const mid in (d.p || {})) {
      const x = d.p[mid];
      if (x && Number.isFinite(x.casa) && Number.isFinite(x.fora)) filled++;
    }
    const sub = document.getElementById('viewonlySub');
    sub.innerHTML = `
      ${team ? `<img src="${flagSrc(team.bandeira, 40)}" alt="" style="width:18px;height:13px;border-radius:2px;vertical-align:middle;margin-right:4px;" /> ${team.nome} · ` : ''}
      ${filled}/72 jogos
    `;

    // ajustar acento ao time
    if (team) setAccent(TEAM_COLORS[team.codigo] || '#22c55e');

    // Render lista igual ao summary mas baseada em d
    const listEl = document.getElementById('viewonlyList');
    listEl.innerHTML = '';
    GRUPOS.forEach((g) => {
      const wrap = document.createElement('div');
      wrap.className = 'summary__group';
      const fcount = g.jogos.filter(m => {
        const x = d.p?.[m.id]; return x && Number.isFinite(x.casa) && Number.isFinite(x.fora);
      }).length;
      wrap.innerHTML = `
        <div class="summary__group-head">
          <div class="summary__group-letter">${g.letra}</div>
          <div class="summary__group-name">Grupo ${g.letra}</div>
          <div class="summary__group-count">${fcount}/6</div>
        </div>
      `;
      g.jogos.forEach(m => {
        const home = TEAM_BY_CODE[m.casa];
        const away = TEAM_BY_CODE[m.fora];
        const p = d.p?.[m.id] || {};
        const has = Number.isFinite(p.casa) && Number.isFinite(p.fora);
        const row = document.createElement('div');
        row.className = 'summary__match' + (has ? '' : ' summary__match--empty');
        row.innerHTML = `
          <div class="summary__match-side">
            <img src="${flagSrc(home.bandeira, 40)}" alt="" />
            <span>${home.codigo}</span>
          </div>
          <div class="summary__match-score ${has ? '' : 'summary__match-score--empty'}">
            ${has ? p.casa : '–'} : ${has ? p.fora : '–'}
          </div>
          <div class="summary__match-side summary__match-side--away">
            <img src="${flagSrc(away.bandeira, 40)}" alt="" />
            <span>${away.codigo}</span>
          </div>
        `;
        wrap.appendChild(row);
      });
      listEl.appendChild(wrap);
    });

    // Bônus
    const bonusWrap = document.createElement('div');
    bonusWrap.className = 'summary__bonus';
    const camp = d.b?.campeao ? (TEAM_BY_CODE[d.b.campeao]?.nome || d.b.campeao) : null;
    bonusWrap.innerHTML = `
      <div class="summary__group-head" style="margin-bottom: 10px;">
        <div class="summary__group-letter">★</div>
        <div class="summary__group-name">Palpites bônus</div>
      </div>
      <div class="summary__bonus-row"><span>🏆</span><strong>Campeão</strong>
        <span class="summary__bonus-val ${camp ? '' : 'summary__bonus-val--empty'}">${camp || 'em branco'}</span>
      </div>
      <div class="summary__bonus-row"><span>⚽</span><strong>Artilheiro</strong>
        <span class="summary__bonus-val ${d.b?.artilheiro ? '' : 'summary__bonus-val--empty'}">${d.b?.artilheiro || 'em branco'}</span>
      </div>
      <div class="summary__bonus-row"><span>🐴</span><strong>Zebra</strong>
        <span class="summary__bonus-val ${d.b?.zebra ? '' : 'summary__bonus-val--empty'}">${d.b?.zebra || 'em branco'}</span>
      </div>
    `;
    listEl.appendChild(bonusWrap);
  }

  document.getElementById('makeOwnBtn').addEventListener('click', () => {
    // limpa querystring e reinicia
    history.replaceState({}, '', location.pathname);
    viewOnly = false;
    viewOnlyData = null;
    state = DEFAULT_STATE();
    setAccent(null);
    setAccent('#22c55e');
    saveState();
    render();
  });

  /* ---------- Tweaks (in-design controls) ---------- */
  let tweaksOn = false;
  function buildTweaksPanel() {
    const mount = document.getElementById('tweaksMount');
    if (mount.firstElementChild) return mount.firstElementChild;
    const panel = document.createElement('div');
    panel.className = 'tweaks';
    panel.innerHTML = `
      <div class="tweaks__head">
        <span class="tweaks__title">Tweaks</span>
        <button class="tweaks__close" aria-label="Fechar" id="tweaksClose">
          <svg viewBox="0 0 24 24" width="14" height="14"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="tweaks__section">
        <div class="tweaks__label">Cor de destaque</div>
        <div class="tweaks__swatches" id="tweaksSwatches"></div>
      </div>
      <div class="tweaks__section">
        <div class="tweaks__label">Pular para</div>
        <div class="tweaks__row">
          <button class="tweaks__btn" data-go="0">Welcome</button>
          <button class="tweaks__btn" data-go="3">Grupo C</button>
          <button class="tweaks__btn" data-go="13">Bônus</button>
        </div>
        <div class="tweaks__row">
          <button class="tweaks__btn" data-go="14">Resumo</button>
          <button class="tweaks__btn" id="tweaksFillAll">Preencher tudo</button>
        </div>
      </div>
      <div class="tweaks__section">
        <button class="tweaks__btn tweaks__btn--danger" id="tweaksReset">↺ Resetar cartela</button>
      </div>
    `;
    mount.appendChild(panel);

    const palettes = [
      { name: 'time', color: state.time ? TEAM_COLORS[state.time] : '#22c55e' },
      { name: 'verde', color: '#22c55e' },
      { name: 'amarelo', color: '#facc15' },
      { name: 'roxo', color: '#a855f7' },
      { name: 'rosa', color: '#ec4899' },
      { name: 'ciano', color: '#06b6d4' },
    ];
    const sw = panel.querySelector('#tweaksSwatches');
    palettes.forEach(p => {
      const b = document.createElement('button');
      b.className = 'tweaks__swatch';
      b.style.background = p.color;
      b.title = p.name;
      b.addEventListener('click', () => {
        setAccent(p.color);
        sw.querySelectorAll('.tweaks__swatch').forEach(x => x.classList.remove('is-on'));
        b.classList.add('is-on');
      });
      sw.appendChild(b);
    });

    panel.querySelectorAll('[data-go]').forEach(btn => {
      btn.addEventListener('click', () => {
        const i = parseInt(btn.dataset.go, 10);
        // Garante nome+time pra screens internas
        if (i > 0) {
          if (!state.nome) state.nome = 'João da Silva';
          if (!state.time) {
            state.time = 'BRA';
            setAccent(TEAM_COLORS.BRA);
          }
        }
        saveState();
        go(i);
      });
    });

    panel.querySelector('#tweaksFillAll').addEventListener('click', () => {
      const weights = [22, 28, 22, 14, 8, 4, 1, 1];
      const pick = () => {
        let r = Math.random() * weights.reduce((a,b)=>a+b,0);
        for (let i=0;i<weights.length;i++) { if (r < weights[i]) return i; r -= weights[i]; }
        return 0;
      };
      ALL_MATCHES.forEach(m => {
        state.palpites[m.id] = { casa: pick(), fora: pick() };
      });
      state.bonus = { campeao: 'BRA', artilheiro: 'Vinícius Jr.', zebra: 'Marrocos' };
      if (!state.nome) state.nome = 'João da Silva';
      if (!state.time) { state.time = 'BRA'; setAccent(TEAM_COLORS.BRA); }
      saveState();
      render();
      toast('Cartela preenchida');
    });

    panel.querySelector('#tweaksReset').addEventListener('click', () => {
      if (!confirm('Apagar todos os palpites?')) return;
      state = DEFAULT_STATE();
      setAccent('#22c55e');
      saveState();
      render();
      toast('Cartela zerada');
    });

    panel.querySelector('#tweaksClose').addEventListener('click', () => {
      panel.classList.remove('is-on');
      tweaksOn = false;
      try { window.parent.postMessage({ type: '__edit_mode_dismissed' }, '*'); } catch (e) {}
    });

    return panel;
  }
  window.addEventListener('message', (e) => {
    const t = e.data?.type;
    if (t === '__activate_edit_mode') {
      const p = buildTweaksPanel();
      p.classList.add('is-on');
      tweaksOn = true;
    } else if (t === '__deactivate_edit_mode') {
      const p = document.querySelector('.tweaks');
      if (p) p.classList.remove('is-on');
      tweaksOn = false;
    }
  });
  try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}

  /* ---------- Boot ---------- */
  function boot() {
    const sharedData = detectViewOnly();
    if (sharedData) {
      viewOnly = true;
      viewOnlyData = sharedData;
    } else {
      // Aplica acento se tiver time salvo
      if (state.time && TEAM_COLORS[state.time]) {
        setAccent(TEAM_COLORS[state.time]);
      }
    }
    render();
  }

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();

})();
