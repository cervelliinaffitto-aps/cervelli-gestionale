// src/area4-builder/4-3-theme-builder.js - Builder Tema, Brand e Dati APS (Bibbia v2.4)

export function renderThemeBuilderView(settings = {}, messaggi = {}) {
  const nomeAps = settings.nome_associazione || 'Cervelli in Affitto APS';
  const cfAps = settings.codice_fiscale_aps || '';
  const emailAps = settings.email_ufficiale || 'info@cervelliinaffitto-aps.it';
  const dominioAps = settings.dominio_sito || 'cervelliinaffitto-aps.it';
  const logoUrl = settings.logo_url || 'https://lh3.googleusercontent.com/d/1h-xfyBoxK5TuAsx-FamJIXf3nFh7FVoO';
  
  const colPrimario = settings.colore_primario || '#D98295';
  const colSecondario = settings.colore_secondario || '#E8E7E9';
  const colSidebar = settings.colore_sidebar || '#121214';
  const colAccento = settings.colore_accento || '#E63946';
  const scalaFont = settings.scala_font || '16px';

  let alertHtml = '';
  if (messaggi.success) {
    alertHtml = `
      <div class="alert-banner alert-success">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
        <span>${messaggi.success}</span>
      </div>
    `;
  } else if (messaggi.error) {
    alertHtml = `
      <div class="alert-banner alert-danger">
        <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span>${messaggi.error}</span>
      </div>
    `;
  }

  return `
    <div class="view-header">
      <div>
        <h1 class="view-title">4.3 Builder Tema & Brand Ufficiale</h1>
        <p class="view-subtitle">Configura i dati istituzionali, il logo, i colori del gestionale e la tipografia senza modificare il codice sorgente.</p>
      </div>
    </div>

    ${alertHtml}

    <form method="POST" action="/admin/salva-tema" class="theme-builder-layout">
      <!-- Colonna Sinistra: Modulo Impostazioni -->
      <div class="builder-column">
        <!-- Card 1: Dati Istituzionali -->
        <div class="card-box">
          <h2 class="card-box-title">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 21h18M3 7v14M21 7v14M6 3h12a3 3 0 013 3v1H3V6a3 3 0 013-3z"/></svg>
            Dati Istituzionali Ente Terzo Settore
          </h2>
          <div class="form-grid-2">
            <div class="form-field">
              <label for="nome_associazione">Nome Associazione (APS) *</label>
              <input type="text" id="nome_associazione" name="nome_associazione" value="${nomeAps}" required />
            </div>
            <div class="form-field">
              <label for="codice_fiscale_aps">Codice Fiscale APS *</label>
              <input type="text" id="codice_fiscale_aps" name="codice_fiscale_aps" value="${cfAps}" placeholder="Es. 900..." required />
            </div>
            <div class="form-field">
              <label for="email_ufficiale">Email Istituzionale (Mittente Resend) *</label>
              <input type="email" id="email_ufficiale" name="email_ufficiale" value="${emailAps}" required />
            </div>
            <div class="form-field">
              <label for="dominio_sito">Dominio Principale *</label>
              <input type="text" id="dominio_sito" name="dominio_sito" value="${dominioAps}" required />
            </div>
          </div>
        </div>

        <!-- Card 2: Logo e Identità Visiva -->
        <div class="card-box">
          <h2 class="card-box-title">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            Logo Ufficiale
          </h2>
          <div class="form-field">
            <label for="logo_url">URL Immagine Logo (PNG trasparente) *</label>
            <input type="url" id="logo_url" name="logo_url" value="${logoUrl}" oninput="aggiornaAnteprimaLogo(this.value)" required />
            <small class="field-help">Consigliato: immagine PNG quadrata ad alta risoluzione con sfondo trasparente.</small>
          </div>
        </div>

        <!-- Card 3: Palette Colori & Tipografia -->
        <div class="card-box">
          <h2 class="card-box-title">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2.69l5.66 5.66a8 8 0 11-11.31 0z"/></svg>
            Palette Cromatica & Stile
          </h2>
          <div class="color-picker-grid">
            <div class="color-picker-field">
              <label for="colore_primario">Primario (Rosa Cervello)</label>
              <div class="color-input-wrap">
                <input type="color" id="colore_primario" name="colore_primario" value="${colPrimario}" oninput="aggiornaColore('primario', this.value)" />
                <input type="text" class="color-text-val" id="text_colore_primario" value="${colPrimario}" readonly />
              </div>
            </div>

            <div class="color-picker-field">
              <label for="colore_secondario">Secondario (Argento Maschere)</label>
              <div class="color-input-wrap">
                <input type="color" id="colore_secondario" name="colore_secondario" value="${colSecondario}" oninput="aggiornaColore('secondario', this.value)" />
                <input type="text" class="color-text-val" id="text_colore_secondario" value="${colSecondario}" readonly />
              </div>
            </div>

            <div class="color-picker-field">
              <label for="colore_sidebar">Sfondo Barra Laterale</label>
              <div class="color-input-wrap">
                <input type="color" id="colore_sidebar" name="colore_sidebar" value="${colSidebar}" oninput="aggiornaColore('sidebar', this.value)" />
                <input type="text" class="color-text-val" id="text_colore_sidebar" value="${colSidebar}" readonly />
              </div>
            </div>

            <div class="color-picker-field">
              <label for="colore_accento">Pulsanti & Evidenziazioni</label>
              <div class="color-input-wrap">
                <input type="color" id="colore_accento" name="colore_accento" value="${colAccento}" oninput="aggiornaColore('accento', this.value)" />
                <input type="text" class="color-text-val" id="text_colore_accento" value="${colAccento}" readonly />
              </div>
            </div>
          </div>

          <div class="form-field" style="margin-top: 16px;">
            <label for="scala_font">Dimensione Testi Gestionale</label>
            <select id="scala_font" name="scala_font">
              <option value="14px" ${scalaFont === '14px' ? 'selected' : ''}>Compatta (14px) - Più dati su schermo</option>
              <option value="16px" ${scalaFont === '16px' ? 'selected' : ''}>Standard (16px) - Lettura bilanciata consigliata</option>
              <option value="18px" ${scalaFont === '18px' ? 'selected' : ''}>Grande (18px) - Massima leggibilità</option>
            </select>
          </div>
        </div>

        <div class="builder-actions-bar">
          <button type="submit" class="btn-save-theme">
            Salva Modifiche Tema & Dati nel Database &rarr;
          </button>
        </div>
      </div>

      <!-- Colonna Destra: Anteprima dal Vivo -->
      <div class="preview-column">
        <div class="preview-sticky-card">
          <h3 class="preview-card-title">Anteprima dal Vivo Elementi</h3>
          
          <div class="preview-box-demo" id="demoBox" style="background-color: ${colSidebar};">
            <img src="${logoUrl}" alt="Logo Preview" id="demoLogo" class="preview-logo-img" />
            <h4 id="demoNome" style="color: ${colSecondario};">${nomeAps}</h4>
            <span class="preview-role-pill" style="background-color: ${colPrimario}; color: #121214;">SUPER ADMIN</span>
            
            <div class="preview-elements-sample">
              <button type="button" class="sample-btn" id="demoBtn" style="background-color: ${colAccento};">
                Pulsante Esempio
              </button>
            </div>
          </div>
          <small class="preview-note">I cambiamenti salvati avranno effetto immediato su tutto il gestionale e sui moduli pubblici.</small>
        </div>
      </div>
    </form>

    <script>
      function aggiornaColore(tipo, valore) {
        document.getElementById('text_colore_' + tipo).value = valore;
        if (tipo === 'primario') {
          const pill = document.querySelector('.preview-role-pill');
          if (pill) pill.style.backgroundColor = valore;
        } else if (tipo === 'secondario') {
          const title = document.getElementById('demoNome');
          if (title) title.style.color = valore;
        } else if (tipo === 'sidebar') {
          const box = document.getElementById('demoBox');
          if (box) box.style.backgroundColor = valore;
        } else if (tipo === 'accento') {
          const btn = document.getElementById('demoBtn');
          if (btn) btn.style.backgroundColor = valore;
        }
      }

      function aggiornaAnteprimaLogo(url) {
        const logo = document.getElementById('demoLogo');
        if (logo) logo.src = url;
      }
    </script>
  `;
}
