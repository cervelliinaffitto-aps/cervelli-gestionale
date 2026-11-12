/**
 * Cervelli in Affitto APS - Gestionale
 * Modulo Iscrizioni Corsi Minori & Domanda Socio
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Endpoint diagnostico D1
    if (url.pathname === "/api/test-db") {
      try {
        const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        return Response.json({ status: "ok", tabelle_attive: results.map(r => r.name) });
      } catch (err) {
        return Response.json({ status: "error", message: err.message }, { status: 500 });
      }
    }

    // Assicuriamo l'esistenza del corso predefinito nel database D1
    await seedDefaultCourseIfNeeded(env);

    // 2. Ricezione dati inviati dal modulo (POST)
    if (request.method === "POST" && (url.pathname === "/iscrizione-minori" || url.pathname === "/")) {
      return handleIscrizionePost(request, env);
    }

    // 3. Pagina di successo
    if (url.pathname === "/iscrizione-confermata") {
      return renderSuccessPage(url.searchParams.get("nome_minore") || "allievo");
    }

    // 4. Pagina del Modulo Iscrizione (GET)
    const corsi = await getCorsiAttivi(env);
    return renderFormPage(corsi);
  }
};

/* =========================================================================
   RECUPERO E SEED DEI CORSI
   ========================================================================= */
async function seedDefaultCourseIfNeeded(env) {
  try {
    const check = await env.DB.prepare("SELECT COUNT(*) as tot FROM attivita_eventi WHERE tipo = 'corso_teatro_minori'").first();
    if (check && check.tot === 0) {
      await env.DB.prepare(`
        INSERT INTO attivita_eventi (id, titolo, tipo, descrizione, luogo, quota_o_prezzo, capienza_massima, stato)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        "corso-teatro-ragazzi-2026",
        "Laboratorio Teatrale Bambini e Ragazzi",
        "corso_teatro_minori",
        "Percorso annuale di recitazione, espressione corporea ed educazione alla voce dedicato a bambini e ragazzi.",
        "Sede Cervelli in Affitto APS",
        0,
        25,
        "aperto"
      ).run();
    }
  } catch (e) {
    console.error("Errore verifica corso base:", e);
  }
}

async function getCorsiAttivi(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, titolo, descrizione, quota_o_prezzo FROM attivita_eventi WHERE tipo = 'corso_teatro_minori' AND stato = 'aperto' ORDER BY created_at DESC"
    ).all();
    return results || [];
  } catch (e) {
    return [{ id: "corso-teatro-ragazzi-2026", titolo: "Laboratorio Teatrale Bambini e Ragazzi" }];
  }
}

/* =========================================================================
   SALVATAGGIO ISCRIZIONE & DOMANDA SOCIO (POST)
   ========================================================================= */
async function handleIscrizionePost(request, env) {
  try {
    const formData = await request.formData();
    
    // Dati Tutore
    const tutore_nome = (formData.get("tutore_nome") || "").trim();
    const tutore_cognome = (formData.get("tutore_cognome") || "").trim();
    const tutore_cf = (formData.get("tutore_cf") || "").trim().toUpperCase();
    const tutore_telefono = (formData.get("tutore_telefono") || "").trim();
    const tutore_email = (formData.get("tutore_email") || "").trim().toLowerCase();
    const tutore_ruolo = formData.get("tutore_ruolo") || "genitore";
    const tutore_indirizzo = (formData.get("tutore_indirizzo") || "").trim();
    const tutore_citta = (formData.get("tutore_citta") || "").trim();
    const tutore_cap = (formData.get("tutore_cap") || "").trim();
    const tutore_provincia = (formData.get("tutore_provincia") || "").trim().toUpperCase();

    // Dati Minore
    const minore_nome = (formData.get("minore_nome") || "").trim();
    const minore_cognome = (formData.get("minore_cognome") || "").trim();
    const minore_cf = (formData.get("minore_cf") || "").trim().toUpperCase();
    const minore_data_nascita = (formData.get("minore_data_nascita") || "").trim();
    const minore_luogo_nascita = (formData.get("minore_luogo_nascita") || "").trim();
    const corso_id = formData.get("corso_id") || "corso-teatro-ragazzi-2026";
    const note_socio = (formData.get("note") || "").trim();

    // Consensi
    const accetta_statuto = formData.get("accetta_statuto") ? 1 : 0;
    const privacy_dati = formData.get("privacy_dati") ? 1 : 0;
    const privacy_foto = formData.get("privacy_foto") ? 1 : 0;
    const client_ip = request.headers.get("CF-Connecting-IP") || "0.0.0.0";

    // Validazione essenziale
    if (!tutore_nome || !tutore_cognome || !tutore_cf || !tutore_email || !tutore_telefono ||
        !minore_nome || !minore_cognome || !minore_cf || !minore_data_nascita) {
      return new Response("Compilare tutti i campi obbligatori contrassegnati da asterisco.", { status: 400 });
    }

    if (!accetta_statuto || !privacy_dati) {
      return new Response("È obbligatorio accettare lo Statuto Sociale e l'Informativa Privacy.", { status: 400 });
    }

    // Identificativi univoci
    const tutore_id = "tut_" + crypto.randomUUID().slice(0, 8);
    const socio_id = "soc_" + crypto.randomUUID().slice(0, 8);
    const consenso_id = "prv_" + crypto.randomUUID().slice(0, 8);
    const quota_id = "qta_" + crypto.randomUUID().slice(0, 8);
    const iscrizione_id = "isc_" + crypto.randomUUID().slice(0, 8);
    const anno_sociale = "2026/2027";

    // Salvataggio nel Database Cloudflare D1
    await env.DB.batch([
      // 1. Tabella Tutori
      env.DB.prepare(`
        INSERT INTO tutori (id, nome, cognome, codice_fiscale, telefono, email, grado_parentela, residenza_indirizzo, residenza_citta, residenza_cap, residenza_provincia)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tutore_id, tutore_nome, tutore_cognome, tutore_cf, tutore_telefono, tutore_email,
        tutore_ruolo, tutore_indirizzo, tutore_citta, tutore_cap, tutore_provincia
      ),

      // 2. Tabella Soci (Minore con tipologia 'ordinario' e stato 'in_attesa' di delibera)
      env.DB.prepare(`
        INSERT INTO soci (id, is_minore, tutore_id, nome, cognome, codice_fiscale, data_nascita, luogo_nascita, residenza_indirizzo, residenza_citta, residenza_cap, residenza_provincia, email, telefono, tipologia_socio, stato_richiesta)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ordinario', 'in_attesa')
      `).bind(
        socio_id, tutore_id, minore_nome, minore_cognome, minore_cf, minore_data_nascita,
        minore_luogo_nascita, tutore_indirizzo, tutore_citta, tutore_cap, tutore_provincia,
        tutore_email, tutore_telefono
      ),

      // 3. Tabella Consensi Privacy
      env.DB.prepare(`
        INSERT INTO consensi_privacy (id, socio_id, tutore_id, accettazione_statuto, consenso_trattamento_dati, consenso_foto_video, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(consenso_id, socio_id, tutore_id, accetta_statuto, privacy_dati, privacy_foto, client_ip),

      // 4. Tabella Quote Sociali (preparata per quota APS e tesseramento UILT)
      env.DB.prepare(`
        INSERT INTO quote_sociali (id, socio_id, anno_sociale, quota_aps_importo, quota_aps_saldata, quota_uilt_importo, quota_uilt_saldata, note)
        VALUES (?, ?, ?, 0, 0, 0, 0, ?)
      `).bind(quota_id, socio_id, anno_sociale, "Iscrizione avviata da modulo online"),

      // 5. Tabella Iscrizione Corso
      env.DB.prepare(`
        INSERT INTO iscrizioni_corsi (id, attivita_id, socio_id, quota_dovuta, quota_saldata, stato_pagamento, note)
        VALUES (?, ?, ?, 0, 0, 'da_saldare', ?)
      `).bind(iscrizione_id, corso_id, socio_id, note_socio)
    ]);

    // Invio Email di notifica tramite Resend
    if (env.RESEND_API_KEY) {
      await sendConfirmationEmail(env, {
        tutore_email,
        tutore_nome,
        tutore_cognome,
        minore_nome,
        minore_cognome,
        minore_cf
      });
    }

    return Response.redirect(`${request.url.split("/iscrizione-minori")[0].split("?")[0]}/iscrizione-confermata?nome_minore=${encodeURIComponent(minore_nome)}`, 303);

  } catch (err) {
    console.error("Errore salvataggio iscrizione:", err);
    return new Response(`Si è verificato un errore durante l'invio: ${err.message}`, { status: 500 });
  }
}

/* =========================================================================
   INVIO EMAIL CON RESEND
   ========================================================================= */
async function sendConfirmationEmail(env, data) {
  try {
    const payload = {
      from: "Cervelli in Affitto APS <info@cervellinaffitto-aps.it>",
      to: [data.tutore_email],
      bcc: ["cervellinaffitto.teatro@gmail.com"],
      subject: `Richiesta di ammissione socio e iscrizione laboratorio: ${data.minore_nome} ${data.minore_cognome}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 8px; padding: 24px;">
          <h2 style="color: #0284c7; margin-top: 0;">Cervelli in Affitto APS</h2>
          <p>Gentile <strong>${data.tutore_nome} ${data.tutore_cognome}</strong>,</p>
          <p>abbiamo ricevuto correttamente la richiesta di ammissione come <strong>socio ordinario</strong> e l'iscrizione al <strong>Laboratorio Teatrale</strong> per:</p>
          <div style="background: #f8fafc; border-left: 4px solid #0284c7; padding: 12px 16px; margin: 16px 0;">
            <p style="margin: 0;"><strong>Allievo/a:</strong> ${data.minore_nome} ${data.minore_cognome}</p>
            <p style="margin: 4px 0 0 0;"><strong>Codice Fiscale:</strong> ${data.minore_cf}</p>
            <p style="margin: 4px 0 0 0;"><strong>Anno sociale:</strong> 2026/2027</p>
          </div>
          <h4 style="color: #334155; margin-bottom: 6px;">Prossimi passi:</h4>
          <ol style="margin-top: 0; padding-left: 20px; color: #475569;">
            <li>La richiesta verrà formalmente deliberata dal Consiglio Direttivo alla prima seduta utile, come previsto dallo Statuto.</li>
            <li>Riceverai le istruzioni relative al versamento della quota associativa (comprensiva di assicurazione UILT) e al calendario del laboratorio.</li>
          </ol>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
          <p style="font-size: 12px; color: #64748b; margin: 0;">
            <strong>Cervelli in Affitto APS</strong><br>
            Associazione di Promozione Sociale - Affiliata UILT<br>
            Sito web: <a href="https://cervellinaffitto-aps.it" style="color: #0284c7;">cervellinaffitto-aps.it</a>
          </p>
        </div>
      `
    };

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      console.error("Resend API warning:", await res.text());
    }
  } catch (emailErr) {
    console.error("Errore invio email Resend:", emailErr);
  }
}

/* =========================================================================
   PAGINA FORM PUBBLICO (HTML + CSS)
   ========================================================================= */
function renderFormPage(corsi) {
  const optionsCorsi = corsi.map(c => `<option value="${c.id}">${c.titolo}</option>`).join("");

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iscrizione Corsi & Domanda Socio - Cervelli in Affitto APS</title>
  <style>
    :root {
      --primary: #0284c7;
      --primary-dark: #0369a1;
      --bg: #0f172a;
      --card-bg: #1e293b;
      --text: #f8fafc;
      --muted: #94a3b8;
      --border: #334155;
    }
    * { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 24px 16px;
      line-height: 1.5;
    }
    .container {
      max-width: 720px;
      margin: 0 auto;
    }
    .header {
      text-align: center;
      margin-bottom: 28px;
    }
    .header h1 {
      color: #38bdf8;
      margin: 0 0 8px 0;
      font-size: 1.75rem;
    }
    .header p {
      color: var(--muted);
      margin: 0;
      font-size: 0.95rem;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 20px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
    }
    .card h2 {
      font-size: 1.15rem;
      color: #38bdf8;
      margin-top: 0;
      margin-bottom: 16px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    @media (max-width: 600px) {
      .grid { grid-template-columns: 1fr; }
    }
    .full-width { grid-column: 1 / -1; }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      margin-bottom: 4px;
      color: #e2e8f0;
    }
    label span.req { color: #f87171; }
    input[type="text"], input[type="email"], input[type="tel"], input[type="date"], select, textarea {
      width: 100%;
      padding: 10px 12px;
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      color: #fff;
      font-size: 0.95rem;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--primary);
      box-shadow: 0 0 0 2px rgba(2, 132, 199, 0.3);
    }
    .checkbox-group {
      margin-top: 12px;
      display: flex;
      gap: 10px;
      align-items: flex-start;
      font-size: 0.85rem;
      color: #cbd5e1;
    }
    .checkbox-group input {
      margin-top: 3px;
      accent-color: var(--primary);
      width: 18px;
      height: 18px;
    }
    .submit-btn {
      width: 100%;
      background: var(--primary);
      color: #fff;
      font-size: 1.05rem;
      font-weight: 600;
      padding: 14px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .submit-btn:hover {
      background: var(--primary-dark);
    }
    .footer-note {
      text-align: center;
      font-size: 0.8rem;
      color: var(--muted);
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Cervelli in Affitto APS</h1>
      <p>Richiesta di Ammissione a Socio Ordinario & Iscrizione Laboratorio Teatrale</p>
    </div>

    <form method="POST" action="/iscrizione-minori">
      <!-- 1. Dati Genitore / Tutore Legale -->
      <div class="card">
        <h2>1. Dati del Genitore o Tutore Legale</h2>
        <div class="grid">
          <div>
            <label>Nome <span class="req">*</span></label>
            <input type="text" name="tutore_nome" required placeholder="Es. Mario">
          </div>
          <div>
            <label>Cognome <span class="req">*</span></label>
            <input type="text" name="tutore_cognome" required placeholder="Es. Rossi">
          </div>
          <div>
            <label>Codice Fiscale <span class="req">*</span></label>
            <input type="text" name="tutore_cf" maxlength="16" required placeholder="Codice fiscale tutore" style="text-transform: uppercase;">
          </div>
          <div>
            <label>Ruolo <span class="req">*</span></label>
            <select name="tutore_ruolo">
              <option value="genitore">Genitore</option>
              <option value="tutore_legale">Tutore Legale</option>
            </select>
          </div>
          <div>
            <label>Telefono Cellulare <span class="req">*</span></label>
            <input type="tel" name="tutore_telefono" required placeholder="Es. 333 1234567">
          </div>
          <div>
            <label>Email per comunicazioni <span class="req">*</span></label>
            <input type="email" name="tutore_email" required placeholder="nome@email.it">
          </div>
          <div class="full-width">
            <label>Indirizzo di Residenza <span class="req">*</span></label>
            <input type="text" name="tutore_indirizzo" required placeholder="Es. Via Roma, 10">
          </div>
          <div>
            <label>Città <span class="req">*</span></label>
            <input type="text" name="tutore_citta" required placeholder="Es. Mantova">
          </div>
          <div>
            <label>CAP <span class="req">*</span></label>
            <input type="text" name="tutore_cap" maxlength="5" required placeholder="Es. 46100">
          </div>
          <div class="full-width">
            <label>Provincia <span class="req">*</span></label>
            <input type="text" name="tutore_provincia" maxlength="2" required placeholder="MN" style="text-transform: uppercase; width: 100px;">
          </div>
        </div>
      </div>

      <!-- 2. Dati Allievo Minorenne -->
      <div class="card">
        <h2>2. Dati dell'Allievo/a (Minore)</h2>
        <div class="grid">
          <div>
            <label>Nome Minore <span class="req">*</span></label>
            <input type="text" name="minore_nome" required placeholder="Nome bambino/a">
          </div>
          <div>
            <label>Cognome Minore <span class="req">*</span></label>
            <input type="text" name="minore_cognome" required placeholder="Cognome bambino/a">
          </div>
          <div>
            <label>Codice Fiscale Minore <span class="req">*</span></label>
            <input type="text" name="minore_cf" maxlength="16" required placeholder="Codice fiscale minore" style="text-transform: uppercase;">
          </div>
          <div>
            <label>Data di Nascita <span class="req">*</span></label>
            <input type="date" name="minore_data_nascita" required>
          </div>
          <div class="full-width">
            <label>Luogo di Nascita <span class="req">*</span></label>
            <input type="text" name="minore_luogo_nascita" required placeholder="Città di nascita">
          </div>
          <div class="full-width">
            <label>Seleziona Attività / Corso <span class="req">*</span></label>
            <select name="corso_id">
              ${optionsCorsi}
            </select>
          </div>
          <div class="full-width">
            <label>Eventuali note o segnalazioni</label>
            <textarea name="note" rows="2" placeholder="Indicazioni utili, esigenze particolari o orari"></textarea>
          </div>
        </div>
      </div>

      <!-- 3. Statuto e Consensi Privacy -->
      <div class="card">
        <h2>3. Statuto e Consensi di Legge</h2>
        
        <div class="checkbox-group">
          <input type="checkbox" id="statuto" name="accetta_statuto" value="1" required checked>
          <label for="statuto">
            <strong>Richiesta di ammissione socio & Accettazione Statuto</strong> <span class="req">*</span><br>
            In qualità di genitore/tutore, richiedo l'ammissione dell'allievo/a quale Socio Ordinario di Cervelli in Affitto APS, dichiarando di conoscere e approvare lo Statuto e i regolamenti associativi.
          </label>
        </div>

        <div class="checkbox-group">
          <input type="checkbox" id="privacy" name="privacy_dati" value="1" required checked>
          <label for="privacy">
            <strong>Trattamento dei Dati Personali (GDPR)</strong> <span class="req">*</span><br>
            Acconsento al trattamento dei dati personali forniti ai fini dell'iscrizione, della gestione del libro soci e delle coperture assicurative obbligatorie con l'ente affiliante UILT.
          </label>
        </div>

        <div class="checkbox-group">
          <input type="checkbox" id="foto" name="privacy_foto" value="1">
          <label for="foto">
            <strong>Liberatoria Foto e Video per attività teatrali</strong><br>
            Autorizzo riprese fotografiche e video effettuate durante saggi, prove e spettacoli del laboratorio per sole finalità promozionali e istituzionali dell'APS (senza fini di lucro).
          </label>
        </div>
      </div>

      <button type="submit" class="submit-btn">Invia Richiesta di Iscrizione &rarr;</button>
    </form>

    <div class="footer-note">
      Cervelli in Affitto APS - Codice Fiscale & Associazione di Promozione Sociale affiliata UILT.<br>
      Tutti i dati sono protetti in conformità al Regolamento UE 2016/679 (GDPR).
    </div>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

/* =========================================================================
   PAGINA DI SUCCESSO
   ========================================================================= */
function renderSuccessPage(nomeMinore) {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iscrizione Ricevuta - Cervelli in Affitto APS</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a;
      color: #f8fafc;
      display: grid;
      place-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 16px;
    }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 32px;
      max-width: 520px;
      text-align: center;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
    }
    .icon {
      font-size: 3rem;
      margin-bottom: 12px;
    }
    h1 {
      color: #38bdf8;
      margin: 0 0 12px 0;
      font-size: 1.5rem;
    }
    p {
      color: #cbd5e1;
      line-height: 1.6;
      font-size: 0.95rem;
    }
    .badge {
      display: inline-block;
      background: rgba(56, 189, 248, 0.15);
      color: #38bdf8;
      padding: 6px 14px;
      border-radius: 20px;
      font-weight: 600;
      margin: 12px 0;
    }
    .btn {
      display: inline-block;
      margin-top: 20px;
      background: #0284c7;
      color: #fff;
      padding: 10px 20px;
      border-radius: 6px;
      text-decoration: none;
      font-weight: 500;
    }
    .btn:hover { background: #0369a1; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🎭</div>
    <h1>Richiesta Ricevuta con Successo!</h1>
    <div class="badge">Allievo/a: ${nomeMinore}</div>
    <p>
      La richiesta di ammissione a socio ordinario e l'iscrizione al laboratorio teatrale sono state registrate nel sistema.
    </p>
    <p style="font-size: 0.85rem; color: #94a3b8;">
      Abbiamo inviato un'email di riepilogo al genitore/tutore. Il Consiglio Direttivo provvederà alla delibera associativa e riceverai a breve tutte le informazioni organizzative.
    </p>
    <a href="/" class="btn">&larr; Torna alla pagina iniziale</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
