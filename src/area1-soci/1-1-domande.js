// src/area1-soci/1-1-domande.js - Gestione Domande di Ammissione a Socio (Bibbia v2.4)

export function renderDomandeView(domande = [], settings = {}) {
  let tableRows = '';

  if (!domande || domande.length === 0) {
    tableRows = `
      <tr>
        <td colspan="7" class="empty-table-state">
          Nessuna domanda di ammissione in attesa di delibera del Consiglio Direttivo.
        </td>
      </tr>
    `;
  } else {
    domande.forEach(d => {
      const isMinore = !!d.tutore_id || d.tipo_socio === 'minore';
      const badgeTipo = isMinore 
        ? '<span class="badge-tag badge-minore">Minore</span>' 
        : '<span class="badge-tag badge-ordinario">Ordinario</span>';

      const dataRichiesta = d.created_at ? new Date(d.created_at).toLocaleDateString('it-IT') : 'N.D.';

      tableRows += `
        <tr>
          <td><strong>${d.cognome || ''} ${d.nome || ''}</strong></td>
          <td><code>${d.codice_fiscale || ''}</code></td>
          <td>${badgeTipo}</td>
          <td>${d.email || d.tutore_email || 'N.D.'}</td>
          <td>${d.telefono || d.tutore_telefono || 'N.D.'}</td>
          <td>${dataRichiesta}</td>
          <td class="table-actions">
            <button type="button" class="btn-action-primary" onclick="apriModalDelibera('${d.id}', '${d.nome || ''}', '${d.cognome || ''}')">
              Approva & Tessera
            </button>
          </td>
        </tr>
      `;
    });
  }

  return `
    <div class="view-header">
      <div>
        <h1 class="view-title">1.1 Domande di Ammissione</h1>
        <p class="view-subtitle">Esame delle richieste pervenute tramite il modulo pubblico e formalizzazione dell'ammissione a socio.</p>
      </div>
      <div class="view-header-stats">
        <span class="stat-pill">${domande.length} in attesa</span>
      </div>
    </div>

    <div class="card-table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Richiedente</th>
            <th>Codice Fiscale</th>
            <th>Tipologia</th>
            <th>Email</th>
            <th>Telefono</th>
            <th>Data Domanda</th>
            <th>Azione</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </div>

    <!-- Modal Delibera Consiglio Direttivo -->
    <div id="modalDelibera" class="modal-backdrop" style="display: none;">
      <div class="modal-card">
        <div class="modal-header">
          <h2 class="modal-title">Delibera Consiglio Direttivo</h2>
          <button type="button" class="btn-close-modal" onclick="chiudiModalDelibera()">&times;</button>
        </div>
        <form method="POST" action="/admin/approva-socio" class="modal-form">
          <input type="hidden" name="socio_id" id="modalSocioId" value="" />
          
          <p class="modal-info-text">
            Stai approvando l'ammissione formale per: <strong id="modalSocioNome"></strong>.
            I seguenti dati verranno iscritti nel <strong>Libro Soci Ufficiale</strong>.
          </p>

          <div class="form-row">
            <div class="form-field">
              <label for="numero_verbale">Numero Verbale CD *</label>
              <input type="text" id="numero_verbale" name="numero_verbale" placeholder="Es. 04/2026" required />
            </div>
            <div class="form-field">
              <label for="data_delibera">Data Delibera *</label>
              <input type="date" id="data_delibera" name="data_delibera" required />
            </div>
          </div>

          <div class="form-row">
            <div class="form-field">
              <label for="numero_tessera">Numero Tessera APS *</label>
              <input type="text" id="numero_tessera" name="numero_tessera" placeholder="Es. 2026-0042" required />
            </div>
            <div class="form-field">
              <label for="quota_versata">Quota Associativa (€) *</label>
              <input type="number" id="quota_versata" name="quota_versata" value="10.00" step="0.50" required />
            </div>
          </div>

          <div class="modal-footer-actions">
            <button type="button" class="btn-secondary" onclick="chiudiModalDelibera()">Annulla</button>
            <button type="submit" class="btn-primary">Registra nel Libro Soci &rarr;</button>
          </div>
        </form>
      </div>
    </div>

    <script>
      function apriModalDelibera(id, nome, cognome) {
        document.getElementById('modalSocioId').value = id;
        document.getElementById('modalSocioNome').textContent = cognome + ' ' + nome;
        // Preimposta la data odierna
        const oggi = new Date().toISOString().split('T')[0];
        document.getElementById('data_delibera').value = oggi;
        document.getElementById('modalDelibera').style.display = 'flex';
      }

      function chiudiModalDelibera() {
        document.getElementById('modalDelibera').style.display = 'none';
      }
    </script>
  `;
}
