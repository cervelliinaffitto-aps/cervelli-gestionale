// src/sidebar.js - Barra laterale ufficiale gestionale Cervelli in Affitto APS (Bibbia v2.4)
// Modulo autosufficiente: include HTML, CSS tematico e logica a fisarmonica

export function renderSidebar(currentView = 'dashboard', settings = {}) {
  const primaryColor = settings.colore_primario || '#D98295';
  const logoUrl = settings.logo_url || 'https://lh3.googleusercontent.com/d/1h-xfyBoxK5TuAsx-FamJIXf3nFh7FVoO';

  // 5 Macro-Aree ufficiali con icone e colori tematici da Bibbia v2.4
  const macroAree = [
    {
      id: 'area-1',
      numero: '1',
      titolo: 'Vita Associativa & Soci',
      colore: '#3B82F6', // Blu istituzionale
      icona: `<svg width="18" height="18" fill="none" stroke="#3B82F6" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
      views: ['domande', '1-1', 'libro-soci', '1-2', 'minori-tutori', '1-3', 'tesseramento-uilt', '1-4', 'quote-rinnovi', '1-5'],
      voci: [
        { id: '1-1', label: '1.1 Domande Ammissione' },
        { id: '1-2', label: '1.2 Libro Soci Ufficiale' },
        { id: '1-3', label: '1.3 Minori & Tutori' },
        { id: '1-4', label: '1.4 Tesseramento UILT' },
        { id: '1-5', label: '1.5 Quote & Rinnovi' }
      ]
    },
    {
      id: 'area-2',
      numero: '2',
      titolo: 'Attività & Corsi',
      colore: '#22C55E', // Verde teatro/corsi
      icona: `<svg width="18" height="18" fill="none" stroke="#22C55E" stroke-width="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>`,
      views: ['corsi', '2-1', 'iscrizioni-corsi', '2-2', 'presenze-deleghe', '2-3', 'liberatorie', '2-4'],
      voci: [
        { id: '2-1', label: '2.1 Gestione Corsi Teatrali' },
        { id: '2-2', label: '2.2 Iscrizioni ai Corsi' },
        { id: '2-3', label: '2.3 Presenze & Deleghe' },
        { id: '2-4', label: '2.4 Liberatorie Privacy' }
      ]
    },
    {
      id: 'area-3',
      numero: '3',
      titolo: 'Eventi & Casse',
      colore: '#F43F5E', // Amaranto ribalta
      icona: `<svg width="18" height="18" fill="none" stroke="#F43F5E" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h0M12 15h0M17 15h0M7 11h2M12 11h2M17 11h2"/></svg>`,
      views: ['spettacoli', '3-1', 'sale-posti', '3-2', 'prenotazioni', '3-3', 'cassa-teatro', '3-4', 'cassa-eventi', '3-5'],
      voci: [
        { id: '3-1', label: '3.1 Cartellone Spettacoli' },
        { id: '3-2', label: '3.2 Piantine Sale & Posti' },
        { id: '3-3', label: '3.3 Prenotazioni' },
        { id: '3-4', label: '3.4 Cassa Spettacoli' },
        { id: '3-5', label: '3.5 Cassa Altri Eventi' }
      ]
    },
    {
      id: 'area-4',
      numero: '4',
      titolo: 'Builder & Contenuti',
      colore: '#A855F7', // Viola creatività
      icona: `<svg width="18" height="18" fill="none" stroke="#A855F7" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
      views: ['form-builder', '4-1', 'email-templates', '4-2', 'tessera-aps', '4-3', 'sezioni-vetrina', '4-4', 'ricevute-builder', '4-5'],
      voci: [
        { id: '4-1', label: '4.1 Form Builder' },
        { id: '4-2', label: '4.2 Template Email' },
        { id: '4-3', label: '4.3 Builder Tessera APS' },
        { id: '4-4', label: '4.4 Gestore Sezioni Vetrina' },
        { id: '4-5', label: '4.5 Ricevute & Documenti' }
      ]
    },
    {
      id: 'area-5',
      numero: '5',
      titolo: 'Sistema & Utenti',
      colore: '#94A3B8', // Ardesia configurazione
      icona: `<svg width="18" height="18" fill="none" stroke="#94A3B8" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
      views: ['utenti-ruoli', '5-1', 'aspetto-brand', '5-2', 'documenti-legali', '5-3', 'manutenzione-db', '5-4', 'audit-log', '5-5'],
      voci: [
        { id: '5-1', label: '5.1 Utenti & Ruoli RBAC' },
        { id: '5-2', label: '5.2 Aspetto, Colori & Brand' },
        { id: '5-3', label: '5.3 Documenti & Privacy' },
        { id: '5-4', label: '5.4 Manutenzione DB & Backup' },
        { id: '5-5', label: '5.5 Audit Log Operazioni' }
      ]
    }
  ];

  const isDashboardActive = currentView === 'dashboard' || currentView === '';

  let html = `
  <style>
    /* Stili dedicati della Sidebar */
    .sidebar {
      width: 280px;
      background: #141417;
      border-right: 1px solid #27272a;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      height: 100vh;
      position: sticky;
      top: 0;
      overflow-y: auto;
      z-index: 50;
    }
    .sidebar-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 1rem;
      border-bottom: 1px solid #27272a;
      background: #16161a;
    }
    .sidebar-logo {
      width: 42px;
      height: 42px;
      object-fit: contain;
      border-radius: 6px;
      flex-shrink: 0;
      background: #1a1a1e;
    }
    .sidebar-brand-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .sidebar-brand-name {
      font-weight: 700;
      font-size: 0.88rem;
      color: #f4f4f5;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .sidebar-badge-role {
      display: inline-block;
      align-self: flex-start;
      margin-top: 2px;
      padding: 2px 6px;
      border-radius: 4px;
      background: rgba(217, 130, 149, 0.2);
      color: ${primaryColor};
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 0.5px;
    }
    .sidebar-nav {
      display: flex;
      flex-direction: column;
      padding: 0.75rem 0.5rem;
      gap: 3px;
    }
    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: 6px;
      color: #a1a1aa;
      text-decoration: none;
      font-size: 0.86rem;
      font-weight: 500;
      transition: all 0.15s ease;
    }
    .nav-item:hover {
      background: #202025;
      color: #ffffff;
    }
    .nav-item.active {
      background: #27272f;
      color: #ffffff;
      font-weight: 600;
      border-left: 3px solid ${primaryColor};
    }
    .sidebar-divider-title {
      font-size: 0.65rem;
      font-weight: 700;
      letter-spacing: 1px;
      color: #71717a;
      text-transform: uppercase;
      padding: 1rem 0.75rem 0.35rem 0.75rem;
    }
    .nav-group {
      display: flex;
      flex-direction: column;
      border-radius: 6px;
      margin-bottom: 2px;
    }
    .nav-group-header {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      background: transparent;
      border: none;
      border-radius: 6px;
      color: #d4d4d8;
      font-size: 0.84rem;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition: all 0.15s ease;
      user-select: none;
    }
    .nav-group-header:hover {
      background: #202025;
      color: #ffffff;
    }
    .nav-group-header.group-active {
      color: #ffffff;
      background: #1c1c21;
    }
    .nav-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .nav-label {
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .nav-chevron {
      display: flex;
      align-items: center;
      transition: transform 0.2s ease;
      color: #71717a;
    }
    .nav-group.open .nav-chevron {
      transform: rotate(180deg);
    }
    .nav-subitems {
      display: none;
      flex-direction: column;
      padding: 2px 0 4px 24px;
      gap: 1px;
    }
    .nav-group.open .nav-subitems {
      display: flex;
    }
    .nav-subitem {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 5px;
      color: #a1a1aa;
      text-decoration: none;
      font-size: 0.80rem;
      transition: all 0.15s ease;
    }
    .nav-subitem:hover {
      background: #1f1f24;
      color: #ffffff;
    }
    .nav-subitem.active {
      background: #27272f;
      color: ${primaryColor};
      font-weight: 600;
    }
    .subitem-bullet {
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: #52525b;
      flex-shrink: 0;
    }
    .nav-subitem.active .subitem-bullet {
      background: ${primaryColor};
    }
  </style>

  <aside class="sidebar" id="mainSidebar">
    <!-- Intestazione con Logo a dimensione fissa -->
    <div class="sidebar-header">
      <img src="${logoUrl}" alt="Logo" class="sidebar-logo" />
      <div class="sidebar-brand-info">
        <span class="sidebar-brand-name">${settings.nome_aps || settings.nome_associazione || 'Cervelli in Affitto'}</span>
        <span class="sidebar-badge-role">SUPER ADMIN</span>
      </div>
    </div>

    <!-- Navigazione Principale -->
    <nav class="sidebar-nav">
      <!-- 0. Dashboard Generale sempre visibile -->
      <a href="/admin?view=dashboard" class="nav-item ${isDashboardActive ? 'active' : ''}">
        <span class="nav-icon">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
        </span>
        <span class="nav-label">Dashboard Generale</span>
      </a>

      <div class="sidebar-divider-title">MACRO-AREE</div>
  `;

  // Render delle 5 Macro-Aree con sottomenu
  macroAree.forEach(area => {
    const isGroupActive = area.views.includes(currentView);

    html += `
      <div class="nav-group ${isGroupActive ? 'open' : ''}" id="group-${area.id}">
        <button type="button" class="nav-group-header ${isGroupActive ? 'group-active' : ''}" onclick="toggleMacroArea('${area.id}')">
          <span class="nav-icon">${area.icona}</span>
          <span class="nav-label">${area.numero}. ${area.titolo}</span>
          <span class="nav-chevron">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        </button>

        <div class="nav-subitems">
    `;

    area.voci.forEach(voce => {
      const isItemActive = currentView === voce.id;
      html += `
          <a href="/admin?view=${voce.id}" class="nav-subitem ${isItemActive ? 'active' : ''}">
            <span class="subitem-bullet"></span>
            <span class="subitem-label">${voce.label}</span>
          </a>
      `;
    });

    html += `
        </div>
      </div>
    `;
  });

  html += `
    </nav>
  </aside>

  <script>
    function toggleMacroArea(areaId) {
      const targetGroup = document.getElementById('group-' + areaId);
      if (!targetGroup) return;
      targetGroup.classList.toggle('open');
    }
  </script>
  `;

  return html;
}
