// src/public-forms/wizard-iscrizione.js
// Modulo pubblico Iscrizione Corsi & Laboratori (Sezione P.3 Bibbia v2.4)

export function renderWizardIscrizione(corsoDefault) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iscrizione Laboratori Teatrali - Cervelli in Affitto APS</title>
  <style>
    :root {
      --primary: #D98295;
      --primary-dark: #b86275;
      --bg-dark: #121214;
      --bg-card: #1a1a1e;
      --text-main: #f4f4f5;
      --text-muted: #a1a1aa;
      --border: #27272a;
      --accent-green: #22c55e;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background-color: var(--bg-dark); color: var(--text-main); min-height: 100vh; display: flex; flex-direction: column; }
    header { background: #09090b; border-bottom: 1px solid var(--border); padding: 1.25rem 1rem; text-align: center; }
    header h1 { font-size: 1.25rem; color: var(--primary); text-transform: uppercase; letter-spacing: 1px; }
    header p { font-size: 0.85rem; color: var(--text-muted); margin-top: 0.25rem; }
    main { flex: 1; max-width: 680px; width: 100%; margin: 1.5rem auto; padding: 0 1rem; }
    .card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 1.75rem; box-shadow: 0 8px 24px rgba(0,0,0,0.4); }
    .step-indicator { display: flex; justify-content: space-between; margin-bottom: 2rem; position: relative; }
    .step-indicator::before { content: ''; position: absolute; top: 14px; left: 0; right: 0; height: 2px; background: var(--border); z-index: 1; }
    .step-dot { position: relative; z-index: 2; width: 30px; height: 30px; border-radius: 50%; background: var(--bg-card); border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: bold; color: var(--text-muted); }
    .step-dot.active { border-color: var(--primary); background: var(--primary); color: #fff; }
    .step-dot.completed { border-color: var(--accent-green); background: var(--accent-green); color: #fff; }
    .step-pane { display: none; }
    .step-pane.active { display: block; animation: fadeIn 0.2s ease-in-out; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
    h2 { font-size: 1.2rem; margin-bottom: 0.5rem; color: #fff; }
    p.desc { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.25rem; }
    .form-group { margin-bottom: 1rem; }
    label { display: block; font-size: 0.85rem; font-weight: 500; margin-bottom: 0.35rem; color: var(--text-main); }
    input, select, textarea { width: 100%; padding: 0.75rem; border-radius: 6px; border: 1px solid var(--border); background: #121214; color: #fff; font-size: 0.95rem; }
    input:focus, select:focus { outline: none; border-color: var(--primary); }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 560px) { .grid-2 { grid-template-columns: 1fr; } }
    .btn-row { display: flex; justify-content: space-between; margin-top: 1.75rem; gap: 1rem; }
    button { padding: 0.75rem 1.25rem; border-radius: 6px; border: none; font-weight: 600; cursor: pointer; font-size: 0.9rem; transition: background 0.2s; }
    .btn-prev { background: #27272a; color: #fff; }
    .btn-next { background: var(--primary); color: #fff; margin-left: auto; }
    .btn-next:hover { background: var(--primary-dark); }
    .btn-submit { background: var(--accent-green); color: #fff; margin-left: auto; }
    .checkbox-item { display: flex; gap: 0.6rem; align-items: flex-start; margin-bottom: 0.75rem; }
    .checkbox-item input { width: auto; margin-top: 0.25rem; }
    .checkbox-item span { font-size: 0.82rem; color: var(--text-muted); line-height: 1.3; }
    footer { text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.75rem; border-top: 1px solid var(--border); }
  </style>
</head>
<body>
  <header>
    <h1>Cervelli in Affitto APS</h1>
    <p>Modulo Ufficiale Iscrizione Corsi & Richiesta Ammissione Socio</p>
  </header>
  <main>
    <div class="card">
      <div class="step-indicator">
        <div class="step-dot active" id="dot-1">1</div>
        <div class="step-dot" id="dot-2">2</div>
        <div class="step-dot" id="dot-3">3</div>
        <div class="step-dot" id="dot-4">4</div>
        <div class="step-dot" id="dot-5">5</div>
      </div>
      <form id="wizardForm" method="POST" action="/iscrizione">
        <input type="hidden" name="corso_id" value="${corsoDefault ? corsoDefault.id : 1}">
        
        <!-- STEP 1: Dati Allievo/Minore -->
        <div class="step-pane active" id="step-1">
          <h2>1. Dati dell'Allievo (Socio Frequentatore)</h2>
          <p class="desc">Inserisci i dati anagrafici del partecipante al laboratorio.</p>
          <div class="grid-2">
            <div class="form-group"><label>Nome *</label><input type="text" name="nome_minore" required placeholder="es. Marco"></div>
            <div class="form-group"><label>Cognome *</label><input type="text" name="cognome_minore" required placeholder="es. Rossi"></div>
          </div>
          <div class="grid-2">
            <div class="form-group"><label>Codice Fiscale *</label><input type="text" name="cf_minore" required placeholder="16 caratteri" maxlength="16"></div>
            <div class="form-group"><label>Data di Nascita *</label><input type="date" name="data_nascita_minore" required></div>
          </div>
          <div class="form-group"><label>Luogo di Nascita *</label><input type="text" name="luogo_nascita_minore" required placeholder="Comune o Stato estero"></div>
          <div class="btn-row"><button type="button" class="btn-next" onclick="nextStep(1)">Avanti &rarr;</button></div>
        </div>

        <!-- STEP 2: Genitore/Tutore -->
        <div class="step-pane" id="step-2">
          <h2>2. Dati del Genitore / Tutore Legale</h2>
          <p class="desc">Referente maggiorenne responsabile della domanda.</p>
          <div class="grid-2">
            <div class="form-group"><label>Nome Genitore *</label><input type="text" name="nome_tutore" required></div>
            <div class="form-group"><label>Cognome Genitore *</label><input type="text" name="cognome_tutore" required></div>
          </div>
          <div class="grid-2">
            <div class="form-group"><label>Codice Fiscale Genitore *</label><input type="text" name="cf_tutore" required maxlength="16"></div>
            <div class="form-group"><label>Cellulare per Comunicazioni *</label><input type="tel" name="telefono_tutore" required placeholder="es. 3331234567"></div>
          </div>
          <div class="form-group"><label>Email per Conferma e Ricevute *</label><input type="email" name="email_tutore" required placeholder="indirizzo@email.it"></div>
          <div class="form-group"><label>Indirizzo di Residenza Completo *</label><input type="text" name="indirizzo_tutore" required placeholder="Via, Civico, CAP, Città"></div>
          <div class="btn-row">
            <button type="button" class="btn-prev" onclick="prevStep(2)">&larr; Indietro</button>
            <button type="button" class="btn-next" onclick="nextStep(2)">Avanti &rarr;</button>
          </div>
        </div>

        <!-- STEP 3: Corso & Quota -->
        <div class="step-pane" id="step-3">
          <h2>3. Corso e Quota Sociale</h2>
          <p class="desc">Riepilogo del laboratorio teatrale selezionato.</p>
          <div class="form-group">
            <label>Laboratorio Selezionato</label>
            <input type="text" readonly value="${corsoDefault ? corsoDefault.titolo + ' (' + corsoDefault.fascia_eta + ')' : 'Laboratorio Teatrale Bambini & Ragazzi'}">
          </div>
          <div class="grid-2">
            <div class="form-group">
              <label>Tesseramento & Assicurazione UILT</label>
              <input type="text" readonly value="Inclusa con ammissione APS">
            </div>
            <div class="form-group">
              <label>Modalità di Pagamento Preferita</label>
              <select name="metodo_pagamento">
                <option value="bonifico">Bonifico Bancario</option>
                <option value="satispay">Satispay</option>
                <option value="contanti">Contanti in Sede</option>
              </select>
            </div>
          </div>
          <div class="btn-row">
            <button type="button" class="btn-prev" onclick="prevStep(3)">&larr; Indietro</button>
            <button type="button" class="btn-next" onclick="nextStep(3)">Avanti &rarr;</button>
          </div>
        </div>

        <!-- STEP 4: Deleghe e Note -->
        <div class="step-pane" id="step-4">
          <h2>4. Deleghe Ritiro & Note</h2>
          <p class="desc">Eventuali persone maggiorenni autorizzate a ritirare l'allievo al termine della lezione.</p>
          <div class="grid-2">
            <div class="form-group"><label>Nome e Cognome Delegato</label><input type="text" name="delegato_nome" placeholder="es. Nonna Maria Bianchi"></div>
            <div class="form-group"><label>Telefono Delegato</label><input type="tel" name="delegato_tel" placeholder="Cellulare delegato"></div>
          </div>
          <div class="form-group"><label>Note Utili (allergie o necessità particolari)</label><textarea name="note" rows="2" placeholder="Nessuna nota"></textarea></div>
          <div class="btn-row">
            <button type="button" class="btn-prev" onclick="prevStep(4)">&larr; Indietro</button>
            <button type="button" class="btn-next" onclick="nextStep(4)">Avanti &rarr;</button>
          </div>
        </div>

        <!-- STEP 5: Consensi e Invio -->
        <div class="step-pane" id="step-5">
          <h2>5. Consensi Istituzionali & Invio Domanda</h2>
          <p class="desc">Conferma i consensi obbligatori per il tesseramento e lo Statuto dell'APS.</p>
          <div class="checkbox-item">
            <input type="checkbox" name="consenso_statuto" required id="c1">
            <span>Dichiaro di aver preso visione dello Statuto Sociale dell'APS e richiedo l'ammissione dell'allievo a socio ordinario. *</span>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" name="consenso_privacy" required id="c2">
            <span>Accetto l'Informativa Privacy ai sensi del GDPR per la gestione dei dati associativi e la registrazione UILT. *</span>
          </div>
          <div class="checkbox-item">
            <input type="checkbox" name="consenso_foto" id="c3">
            <span>Autorizzo l'utilizzo di foto e riprese video durante saggi e laboratori a scopi esclusivamente istituzionali e promozionali dell'APS.</span>
          </div>
          <div class="btn-row">
            <button type="button" class="btn-prev" onclick="prevStep(5)">&larr; Indietro</button>
            <button type="submit" class="btn-submit">Invia Domanda Ufficiale &check;</button>
          </div>
        </div>
      </form>
    </div>
  </main>
  <footer>
    &copy; ${new Date().getFullYear()} Cervelli in Affitto APS &bull; Affiliata UILT &bull; Dominio: cervellinaffitto-aps.it
  </footer>

  <script>
    function nextStep(current) {
      const pane = document.getElementById('step-' + current);
      const inputs = pane.querySelectorAll('input[required]');
      for (let input of inputs) {
        if (!input.value.trim()) {
          input.focus();
          alert('Compila tutti i campi obbligatori contrassegnati con * prima di procedere.');
          return;
        }
      }
      pane.classList.remove('active');
      document.getElementById('dot-' + current).classList.remove('active');
      document.getElementById('dot-' + current).classList.add('completed');
      
      const next = current + 1;
      document.getElementById('step-' + next).classList.add('active');
      document.getElementById('dot-' + next).classList.add('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function prevStep(current) {
      document.getElementById('step-' + current).classList.remove('active');
      document.getElementById('dot-' + current).classList.remove('active');
      
      const prev = current - 1;
      document.getElementById('step-' + prev).classList.add('active');
      document.getElementById('dot-' + prev).classList.add('active');
      document.getElementById('dot-' + prev).classList.remove('completed');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  </script>
</body>
</html>`;
}

// Funzione di elaborazione POST sul database Cloudflare D1
export async function handleIscrizionePost(request, env) {
  try {
    const formData = await request.formData();
    const nomeMinore = (formData.get("nome_minore") || "").trim();
    const cognomeMinore = (formData.get("cognome_minore") || "").trim();
    const cfMinore = (formData.get("cf_minore") || "").trim().toUpperCase();
    const dataNascitaMinore = formData.get("data_nascita_minore") || "";
    const luogoNascitaMinore = (formData.get("luogo_nascita_minore") || "").trim();
    
    const nomeTutore = (formData.get("nome_tutore") || "").trim();
    const cognomeTutore = (formData.get("cognome_tutore") || "").trim();
    const cfTutore = (formData.get("cf_tutore") || "").trim().toUpperCase();
    const telefonoTutore = (formData.get("telefono_tutore") || "").trim();
    const emailTutore = (formData.get("email_tutore") || "").trim().toLowerCase();
    const indirizzoTutore = (formData.get("indirizzo_tutore") || "").trim();

    const delegatoNome = (formData.get("delegato_nome") || "").trim();
    const delegatoTel = (formData.get("delegato_tel") || "").trim();
    const note = (formData.get("note") || "").trim();
    const corsoId = parseInt(formData.get("corso_id") || "1", 10);

    if (!nomeMinore || !cognomeMinore || !cfMinore || !nomeTutore || !emailTutore || !telefonoTutore) {
      return new Response("Dati obbligatori mancanti", { status: 400 });
    }

    // 1. Inserimento o recupero Tutore
    let tutoreId;
    const tutoreEsistente = await env.DB.prepare("SELECT id FROM tutori WHERE codice_fiscale = ?").bind(cfTutore).first();
    if (tutoreEsistente) {
      tutoreId = tutoreEsistente.id;
    } else {
      const resTutore = await env.DB.prepare(
        "INSERT INTO tutori (nome, cognome, codice_fiscale, email, telefono, indirizzo_residenza) VALUES (?, ?, ?, ?, ?, ?)"
      ).bind(nomeTutore, cognomeTutore, cfTutore, emailTutore, telefonoTutore, indirizzoTutore).run();
      tutoreId = resTutore.meta.last_row_id;
    }

    // 2. Inserimento Socio/Minore in stato "in_attesa"
    let socioId;
    const socioEsistente = await env.DB.prepare("SELECT id FROM soci WHERE codice_fiscale = ?").bind(cfMinore).first();
    if (socioEsistente) {
      socioId = socioEsistente.id;
    } else {
      const resSocio = await env.DB.prepare(
        `INSERT INTO soci (
          tipo_socio, stato_ammissione, nome, cognome, codice_fiscale,
          data_nascita, luogo_nascita, email, telefono, tutore_id, note_interne
        ) VALUES ('ordinario', 'in_attesa', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        nomeMinore, cognomeMinore, cfMinore, dataNascitaMinore, luogoNascitaMinore,
        emailTutore, telefonoTutore, tutoreId, note
      ).run();
      socioId = resSocio.meta.last_row_id;
    }

    // 3. Iscrizione al corso
    await env.DB.prepare(
      "INSERT INTO iscrizioni_corsi (socio_id, corso_id, stato_pagamento, note) VALUES (?, ?, 'in_attesa', ?)"
    ).bind(socioId, corsoId, note).run();

    // 4. Delega opzionale
    if (delegatoNome) {
      await env.DB.prepare(
        "INSERT INTO deleghe_ritiro (socio_id, nome_delegato, telefono_delegato, grado_parentela) VALUES (?, ?, ?, 'Delegato')"
      ).bind(socioId, delegatoNome, delegatoTel).run();
    }

    // Schermata di conferma
    return new Response(`<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8"><title>Domanda Ricevuta - Cervelli in Affitto APS</title>
  <style>
    body { background: #121214; color: #f4f4f5; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 1rem; }
    .box { background: #1a1a1e; border: 1px solid #27272a; padding: 2.5rem; border-radius: 12px; max-width: 500px; text-align: center; }
    .icon { font-size: 3rem; color: #22c55e; margin-bottom: 1rem; }
    h1 { font-size: 1.4rem; margin-bottom: 0.5rem; color: #22c55e; }
    p { color: #a1a1aa; font-size: 0.95rem; line-height: 1.5; margin-bottom: 1.5rem; }
    a { display: inline-block; background: #D98295; color: #fff; text-decoration: none; padding: 0.75rem 1.5rem; border-radius: 6px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">&check;</div>
    <h1>Domanda Inviata con Successo!</h1>
    <p>La richiesta di ammissione a socio e iscrizione al corso per <strong>${nomeMinore} ${cognomeMinore}</strong> è stata acquisita dal Consiglio Direttivo dell'APS Cervelli in Affitto.</p>
    <a href="/">Torna alla Pagina Principale</a>
  </div>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=UTF-8" } });

  } catch (err) {
    return new Response("Errore durante il salvataggio: " + err.message, { status: 500 });
  }
}
