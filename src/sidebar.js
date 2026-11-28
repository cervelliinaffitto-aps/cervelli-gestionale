// src/sidebar.js - Barra laterale ufficiale gestionale Cervelli in Affitto APS
// Struttura completa a 5 Macro-Aree con sottomenu a fisarmonica (Bibbia v2.4)

export function renderSidebar(currentView = 'dashboard', settings = {}) {
  const primaryColor = settings.colore_primario || '#D98295';
  const logoUrl = settings.logo_url || 'https://lh3.googleusercontent.com/d/1h-xfyBoxK5TuAsx-FamJIXf3nFh7FVoO';

  // Definizione ufficiale delle 5 Macro-Aree e dei sottomenu
  const macroAree = [
    {
      id: 'area-1',
      numero: '1',
      titolo: 'Vita Associativa & Soci',
      icona: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
      views: ['domande', 'libro-soci', 'minori-tutori', 'tesseramento-uilt', 'quote-rinnovi'],
      voci: [
        { id: 'domande', label: '1.1 Domande Ammissione' },
        { id: 'libro-soci', label: '1.2 Libro Soci Ufficiale' },
        { id: 'minori-tutori', label: '1.3 Minori & Tutori' },
        { id: 'tesseramento-uilt', label: '1.4 Tesseramento UILT' },
        { id: 'quote-rinnovi', label: '1.5 Quote & Rinnovi' }
      ]
    },
    {
      id: 'area-2',
      numero: '2',
      titolo: 'Attività & Corsi',
      icona: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/></svg>`,
      views: ['corsi', 'iscrizioni-corsi', 'presenze-deleghe', 'liberatorie'],
      voci: [
        { id: 'corsi', label: '2.1 Gestione Corsi Teatrali' },
        { id: 'iscrizioni-corsi', label: '2.2 Iscrizioni ai Corsi' },
        { id: 'presenze-deleghe', label: '2.3 Presenze & Deleghe' },
        { id: 'liberatorie', label: '2.4 Liberatorie Privacy' }
      ]
    },
    {
      id: 'area-3',
      numero: '3',
      titolo: 'Eventi & Casse',
      icona: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 15h0M12 15h0M17 15h0M7 11h2M12 11h2M17 11h2"/></svg>`,
      views: ['spettacoli', 'sale-posti', 'prenotazioni', 'cassa-teatro', 'cassa-eventi'],
      voci: [
        { id: 'spettacoli', label: '3.1 Cartellone Spettacoli' },
        { id: 'sale-posti', label: '3.2 Piantine Sale & Posti' },
        { id: 'prenotazioni', label: '3.3 Prenotazioni' },
        { id: 'cassa-teatro', label: '3.4 Cassa Spettacoli' },
        { id: 'cassa-eventi', label: '3.5 Cassa Altri Eventi' }
      ]
    },
    {
      id: 'area-4',
      numero: '4',
      titolo: 'Builder & Contenuti',
      icona: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
      views: ['form-builder', 'email-templates', 'theme-builder', 'metodi-pagamento'],
      voci: [
        { id: 'form-builder', label: '4.1 Form Builder' },
        { id: 'email-templates', label: '4.2 Template Email' },
        { id: 'theme-builder', label: '4.3 Builder Tema & Brand' },
        { id: 'metodi-pagamento', label: '4.4 Metodi Pagamento' }
      ]
    },
    {
      id: 'area-5',
      numero: '5',
      titolo: 'Sistema & Utenti',
      icona: `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>`,
      views: ['utenti-ruoli', 'audit-log', 'documenti-legali', 'impostazioni-db'],
      voci: [
        { id: 'utenti-ruoli', label: '5.1 Utenti & Ruoli RBAC' },
        { id: 'audit-log', label: '5.2 Log Operazioni' },
        { id: 'documenti-legali', label: '5.3 Documenti & Privacy' },
        { id: 'impostazioni-db', label: '5.4 Manutenzione DB' }
      ]
    }
  ];

  const isDashboardActive = currentView === 'dashboard';

  let html = `
  <aside class="sidebar" id="mainSidebar">
    <!-- Intestazione Brand -->
    <div class="sidebar-header">
      <img src="${logoUrl}" alt="Logo Cervelli in Affitto" class="sidebar-logo" />
      <div class="sidebar-brand-info">
        <span class="sidebar-brand-name">${settings.nome_associazione || 'Cervelli in Affitto APS'}</span>
        <span class="sidebar-badge-role">SUPER ADMIN</span>
      </div>
    </div>

    <!-- Navigazione Principale -->
    <nav class="sidebar-nav">
      <!-- 0. Dashboard Generale (Sempre visibile in cima) -->
      <a href="/admin?view=dashboard" class="nav-item ${isDashboardActive ? 'active' : ''}">
        <span class="nav-icon">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
        </span>
        <span class="nav-label">Dashboard Generale</span>
      </a>

      <div class="sidebar-divider-title">MACRO-AREE</div>
  `;

  // Render delle 5 Macro-Aree a fisarmonica
  macroAree.forEach(area => {
    const isGroupActive = area.views.includes(currentView);

    html += `
      <div class="nav-group ${isGroupActive ? 'open' : ''}" id="group-${area.id}">
        <!-- Intestazione Macro-Area cliccabile -->
        <button type="button" class="nav-group-header ${isGroupActive ? 'group-active' : ''}" onclick="toggleMacroArea('${area.id}')">
          <span class="nav-icon">${area.icona}</span>
          <span class="nav-label">${area.numero}. ${area.titolo}</span>
          <span class="nav-chevron">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
          </span>
        </button>

        <!-- Sottomenu a discesa con le singole sezioni -->
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

  <!-- Script per la fisarmonica (Accordion) -->
  <script>
    function toggleMacroArea(areaId) {
      const targetGroup = document.getElementById('group-' + areaId);
      if (!targetGroup) return;
      const isOpen = targetGroup.classList.contains('open');
      
      // Se vuoi che se ne apra una sola alla volta, decommenta le 2 righe sotto:
      // document.querySelectorAll('.nav-group').forEach(g => g.classList.remove('open'));
      
      if (isOpen) {
        targetGroup.classList.remove('open');
      } else {
        targetGroup.classList.add('open');
      }
    }
  </script>
  `;

  return html;
}
