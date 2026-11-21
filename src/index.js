/**
 * Cervelli in Affitto APS - Piattaforma Gestionale
 * Modulo Ufficiale Iscrizione Corsi Minori & Ammissione Socio (Wizard Multi-Step)
 * Affiliato UILT - Unione Italiana Libero Teatro
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Endpoint diagnostico database D1
    if (url.pathname === "/api/test-db") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
        ).all();
        const tables = results.map((r) => r.name);
        return Response.json({
          status: "ok",
          database: "cervelli-gestionale-db",
          tabelle_attive: tables,
          deleghe_pronte: tables.includes("deleghe_ritiro"),
          timestamp: new Date().toISOString()
        });
      } catch (err) {
        return Response.json({ status: "error", message: err.message }, { status: 500 });
      }
    }

    // Assicura l'esistenza del corso predefinito in D1
    await seedDefaultCourseIfNeeded(env);

    // 2. Ricezione dati del modulo (POST)
    if (request.method === "POST" && (url.pathname === "/iscrizione-minori" || url.pathname === "/")) {
      return handleIscrizionePost(request, env, ctx);
    }

    // 3. Pagina di conferma avvenuta iscrizione
    if (url.pathname === "/iscrizione-confermata") {
      const nomeMinore = url.searchParams.get("minore") || "allievo/a";
      const email = url.searchParams.get("email") || "";
      return renderSuccessPage(nomeMinore, email);
    }

    // 4. Pagina principale del Modulo Iscrizione (GET - Wizard a passaggi)
    const corsi = await getCorsiAttivi(env);
    return renderFormPage(corsi);
  }
};

/* =========================================================================
   GESTIONE DEI CORSI IN DATABASE
   ========================================================================= */
async function seedDefaultCourseIfNeeded(env) {
  try {
    const check = await env.DB.prepare(
      "SELECT COUNT(*) as tot FROM attivita_eventi WHERE tipo = 'corso_teatro_minori'"
    ).first();
    if (check && check.tot === 0) {
      await env.DB.prepare(`
        INSERT INTO attivita_eventi (id, titolo, tipo, descrizione, data_evento, luogo, quota_o_prezzo, capienza_massima, stato)
        VALUES (
          'corso-teatro-ragazzi-2024-25',
          'Laboratorio Teatrale Bambini e Ragazzi (Anno 2024/2025)',
          'corso_teatro_minori',
          'Percorso propedeutico di espressione corporea, voce, improvvisazione teatrale e messa in scena finale. Include tesseramento UILT e copertura assicurativa.',
          'Settimanale (Ottobre - Maggio)',
          'Sede Cervelli in Affitto APS',
          0,
          25,
          'aperto'
        )
      `).run();
    }
  } catch (e) {
    console.error("Errore verifica corso default:", e);
  }
}

async function getCorsiAttivi(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, titolo, descrizione, luogo, quota_o_prezzo FROM attivita_eventi WHERE tipo = 'corso_teatro_minori' AND stato = 'aperto'"
    ).all();
    if (results && results.length > 0) return results;
  } catch (e) {
    console.error("Errore lettura corsi:", e);
  }
  return [
    {
      id: "corso-teatro-ragazzi-2024-25",
      titolo: "Laboratorio Teatrale Bambini e Ragazzi",
      descrizione: "Laboratorio annuale di teatro ragazzi con copertura UILT",
      luogo: "Sede Cervelli in Affitto APS"
    }
  ];
}

/* =========================================================================
   ELABORAZIONE DATI INVIATI (POST)
   ========================================================================= */
async function handleIscrizionePost(request, env, ctx) {
  try {
    const formData = await request.formData();

    // Protezione Anti-Spam Honeypot
    const honey = formData.get("codice_sicurezza_robot") || formData.get("website") || "";
    if (honey.trim() !== "") {
      console.warn("Spam intercettato via honeypot:", honey);
      return new Response("Invio non valido.", { status: 400 });
    }

    // Dati Genitore / Tutore
    const gNome = (formData.get("genitore_nome") || "").trim();
    const gCognome = (formData.get("genitore_cognome") || "").trim();
    const gCF = (formData.get("genitore_cf") || "").trim().toUpperCase();
    const gTelefono = (formData.get("genitore_telefono") || "").trim();
    const gEmail = (formData.get("genitore_email") || "").trim().toLowerCase();
    const gParentela = (formData.get("genitore_ruolo") || "genitore").trim();
    const gIndirizzo = (formData.get("genitore_indirizzo") || "").trim();
    const gCitta = (formData.get("genitore_citta") || "").trim();
    const gCap = (formData.get("genitore_cap") || "").trim();
    const gProv = (formData.get("genitore_provincia") || "").trim().toUpperCase();
    const gDataNascita = (formData.get("genitore_data_nascita") || "").trim();
    const gLuogoNascita = (formData.get("genitore_luogo_nascita") || "").trim();

    // Dati Minore
    const mNome = (formData.get("minore_nome") || "").trim();
    const mCognome = (formData.get("minore_cognome") || "").trim();
    const mCF = (formData.get("minore_cf") || "").trim().toUpperCase();
    const mDataNascita = (formData.get("minore_data_nascita") || "").trim();
    const mLuogoNascita = (formData.get("minore_luogo_nascita") || "").trim();
    const mNote = (formData.get("minore_note") || "").trim();

    // Corso
    const corsoId = formData.get("corso_id") || "corso-teatro-ragazzi-2024-25";

    // Validazione campi obbligatori
    if (!gNome || !gCognome || !gCF || !gEmail || !gTelefono || !mNome || !mCognome || !mCF || !mDataNascita) {
      return new Response(
        renderErrorPage("Dati incompleti: assicurati di compilare tutti i campi contrassegnati con l'asterisco (*) per genitore e allievo."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // Consensi
    const consStatuto = formData.get("consenso_statuto") ? 1 : 0;
    const consPrivacy = formData.get("consenso_privacy") ? 1 : 0;
    const consFoto = formData.get("consenso_foto") ? 1 : 0;
    const consNews = formData.get("consenso_news") ? 1 : 0;

    if (!consStatuto || !consPrivacy) {
      return new Response(
        renderErrorPage("L'accettazione dello Statuto dell'APS e l'informativa Privacy sono obbligatori per legge."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    const clientIP = request.headers.get("cf-connecting-ip") || "unknown";
    const tutoreId = "tut-" + crypto.randomUUID().slice(0, 12);
    const socioGenitoreId = "soc-g-" + crypto.randomUUID().slice(0, 12);
    const socioMinoreId = "soc-m-" + crypto.randomUUID().slice(0, 12);
    const iscrizioneId = "isc-" + crypto.randomUUID().slice(0, 12);

    // Esecuzione inserimenti su database D1
    const statements = [
      // 1. Inserimento Tutore
      env.DB.prepare(`
        INSERT INTO tutori (id, nome, cognome, codice_fiscale, telefono, email, grado_parentela, residenza_indirizzo, residenza_citta, residenza_cap, residenza_provincia)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(tutoreId, gNome, gCognome, gCF, gTelefono, gEmail, gParentela, gIndirizzo, gCitta, gCap, gProv),

      // 2. Inserimento Socio Genitore (Ordinario, in attesa di delibera)
      env.DB.prepare(`
        INSERT INTO soci (id, is_minore, tutore_id, nome, cognome, codice_fiscale, data_nascita, luogo_nascita, residenza_indirizzo, residenza_citta, residenza_cap, residenza_provincia, telefono, email, tipologia_socio, stato_richiesta)
        VALUES (?, 0, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ordinario', 'in_attesa')
        ON CONFLICT(codice_fiscale) DO UPDATE SET
          telefono = excluded.telefono,
          email = excluded.email,
          residenza_indirizzo = excluded.residenza_indirizzo,
          updated_at = datetime('now')
      `).bind(socioGenitoreId, gNome, gCognome, gCF, gDataNascita || "Non indicata", gLuogoNascita || "Non indicato", gIndirizzo, gCitta, gCap, gProv, gTelefono, gEmail),

      // 3. Inserimento Socio Minore (Ordinario minore, collegato al tutore)
      env.DB.prepare(`
        INSERT INTO soci (id, is_minore, tutore_id, nome, cognome, codice_fiscale, data_nascita, luogo_nascita, residenza_indirizzo, residenza_citta, residenza_cap, residenza_provincia, telefono, email, tipologia_socio, stato_richiesta)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ordinario', 'in_attesa')
        ON CONFLICT(codice_fiscale) DO UPDATE SET
          tutore_id = excluded.tutore_id,
          updated_at = datetime('now')
      `).bind(socioMinoreId, tutoreId, mNome, mCognome, mCF, mDataNascita, mLuogoNascita || "Non indicato", gIndirizzo, gCitta, gCap, gProv, gTelefono, gEmail),

      // 4. Inserimento Iscrizione Corso
      env.DB.prepare(`
        INSERT INTO iscrizioni_corsi (id, attivita_id, socio_id, quota_dovuta, quota_saldata, stato_pagamento, note)
        VALUES (?, ?, ?, 0, 0, 'da_saldare', ?)
      `).bind(iscrizioneId, corsoId, socioMinoreId, mNote || null),

      // 5. Inserimento Consensi Privacy
      env.DB.prepare(`
        INSERT INTO consensi_privacy (id, socio_id, tutore_id, accettazione_statuto, consenso_trattamento_dati, consenso_foto_video, consenso_newsletter, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind("cons-" + crypto.randomUUID().slice(0, 12), socioMinoreId, tutoreId, consStatuto, consPrivacy, consFoto, consNews, clientIP)
    ];

    // 6. Inserimento Deleghe al Ritiro
    const delegheNomi = formData.getAll("delega_nome[]");
    const delegheCognomi = formData.getAll("delega_cognome[]");
    const delegheTelefoni = formData.getAll("delega_telefono[]");
    const delegheRelazioni = formData.getAll("delega_relazione[]");
    const delegheCF = formData.getAll("delega_cf[]");

    if (delegheNomi && delegheNomi.length > 0) {
      for (let i = 0; i < delegheNomi.length; i++) {
        const dNome = (delegheNomi[i] || "").trim();
        const dCognome = (delegheCognomi[i] || "").trim();
        const dTel = (delegheTelefoni[i] || "").trim();
        const dRel = (delegheRelazioni[i] || "").trim();
        const dCf = (delegheCF[i] || "").trim().toUpperCase();

        if (dNome && dCognome && dTel) {
          statements.push(
            env.DB.prepare(`
              INSERT INTO deleghe_ritiro (id, iscrizione_id, socio_minore_id, nome, cognome, codice_fiscale, telefono, relazione)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).bind("del-" + crypto.randomUUID().slice(0, 12), iscrizioneId, socioMinoreId, dNome, dCognome, dCf || null, dTel, dRel || "Delegato autorizzato")
          );
        }
      }
    }

    // Esegui la scrittura atomica su D1
    await env.DB.batch(statements);

    // Invio Email con Resend (con gestione sicura di ctx)
    if (env.RESEND_API_KEY) {
      const emailPromise = sendConfirmationEmails(env.RESEND_API_KEY, {
        genitoreNome: `${gNome} ${gCognome}`,
        genitoreEmail: gEmail,
        minoreNome: `${mNome} ${mCognome}`,
        telefono: gTelefono
      });

      if (ctx && typeof ctx.waitUntil === "function") {
        ctx.waitUntil(emailPromise);
      } else {
        await emailPromise;
      }
    }

    // Reindirizzamento a pagina di conferma
    return Response.redirect(
      `${url.origin}/iscrizione-confermata?minore=${encodeURIComponent(mNome)}&email=${encodeURIComponent(gEmail)}`,
      303
    );
  } catch (err) {
    console.error("Errore salvataggio iscrizione:", err);
    return new Response(
      renderErrorPage(`Si è verificato un errore durante il salvataggio: ${err.message}. Ti invitiamo a riprovare o contattare l'associazione.`),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

/* =========================================================================
   INVIO EMAIL TRAMITE RESEND API
   ========================================================================= */
async function sendConfirmationEmails(apiKey, data) {
  try {
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #18181B; line-height: 1.6;">
        <div style="background-color: #121214; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="color: #D98295; margin: 0; font-size: 22px; letter-spacing: 0.5px;">Cervelli in Affitto APS</h1>
          <p style="color: #E8E7E9; margin: 6px 0 0 0; font-size: 13px;">Laboratorio Teatrale & Domanda di Ammissione Socio</p>
        </div>
        <div style="background-color: #FFFFFF; padding: 28px; border: 1px solid #E4E4E7; border-top: none; border-radius: 0 0 8px 8px;">
          <h2 style="color: #121214; font-size: 18px; margin-top: 0;">Richiesta ricevuta con successo!</h2>
          <p>Gentile <strong>${data.genitoreNome}</strong>,</p>
          <p>ti confermiamo la ricezione della richiesta di iscrizione al Laboratorio Teatrale per <strong>${data.minoreNome}</strong> e la contestuale domanda di ammissione a socio per l'anno sociale in corso.</p>
          
          <div style="background-color: #FAF5F6; border-left: 4px solid #D98295; padding: 14px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 14px; color: #9F5D6B;"><strong>I prossimi passi associativi:</strong></p>
            <ul style="margin: 8px 0 0 0; padding-left: 20px; font-size: 13px; color: #4A4A50;">
              <li>Il Consiglio Direttivo deliberera formalmente l'ammissione a socio nella prima riunione utile.</li>
              <li>Riceverai le istruzioni per il perfezionamento del tesseramento e la copertura assicurativa UILT.</li>
              <li>Verrai ricontattato prima dell'inizio delle lezioni per tutti i dettagli organizzativi.</li>
            </ul>
          </div>

          <p style="font-size: 13px; color: #71717A;">Per qualsiasi necessita o chiarimento puoi rispondere a questa email o contattarci ai recapiti dell'associazione.</p>
          <hr style="border: none; border-top: 1px solid #E4E4E7; margin: 24px 0;" />
          <p style="font-size: 11px; color: #A1A1AA; text-align: center; margin: 0;">
            Cervelli in Affitto APS &bull; Affiliato UILT (Unione Italiana Libero Teatro)<br>
            cervellinaffitto-aps.it
          </p>
        </div>
      </div>
    `;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Cervelli in Affitto APS <info@cervellinaffitto-aps.it>",
        to: [data.genitoreEmail],
        subject: `Iscrizione Laboratorio Teatrale ricevuta - ${data.minoreNome}`,
        html: emailHtml
      })
    });
  } catch (err) {
    console.error("Errore invio email Resend:", err);
  }
}

/* =========================================================================
   PAGINE HTML: WIZARD MULTI-STEP E CONFERMA
   ========================================================================= */
function renderFormPage(corsi) {
  const opzioniCorsi = corsi.map((c) =>
    `<option value="${c.id}">${c.titolo} - ${c.luogo || 'Sede APS'}</option>`
  ).join("\n");

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iscrizione Corsi Bambini & Ragazzi | Cervelli in Affitto APS</title>
  <style>
    :root {
      --bg-dark: #121214;
      --bg-light: #F8F9FA;
      --card-bg: #FFFFFF;
      --brand-rose: #D98295;
      --brand-rose-light: #DFA1AE;
      --brand-rose-dark: #9F5D6B;
      --brand-rose-soft: #FCF4F6;
      --text-main: #18181B;
      --text-muted: #71717A;
      --border-color: #E4E4E7;
      --silver-mask: #E8E7E9;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background-color: var(--bg-light);
      color: var(--text-main);
      line-height: 1.5;
    }

    header {
      background-color: var(--bg-dark);
      color: #FFFFFF;
      padding: 22px 20px;
      border-bottom: 3px solid var(--brand-rose);
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .header-content {
      max-width: 860px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .badge-icon {
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: linear-gradient(135deg, var(--brand-rose-dark), var(--brand-rose));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 26px;
      box-shadow: 0 2px 8px rgba(217, 130, 149, 0.4);
      flex-shrink: 0;
    }
    .header-titles h1 {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #FFFFFF;
    }
    .header-titles p {
      font-size: 13px;
      color: var(--brand-rose-light);
      margin-top: 2px;
    }

    main {
      max-width: 860px;
      margin: 28px auto 60px;
      padding: 0 16px;
    }

    /* Stepper visivo a step reali */
    .stepper {
      display: flex;
      justify-content: space-between;
      margin-bottom: 12px;
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 12px 16px;
      overflow-x: auto;
      gap: 8px;
    }
    .step-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      white-space: nowrap;
      transition: color 0.2s ease;
    }
    .step-num {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #E4E4E7;
      color: #52525B;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      transition: all 0.2s ease;
    }
    .step-item.active { color: var(--brand-rose-dark); }
    .step-item.active .step-num {
      background: var(--brand-rose);
      color: #FFFFFF;
    }
    .step-item.completed { color: #059669; }
    .step-item.completed .step-num {
      background: #059669;
      color: #FFFFFF;
    }

    /* Barra di avanzamento percentuale fluida */
    .progress-bar-container {
      width: 100%;
      height: 6px;
      background: #E4E4E7;
      border-radius: 3px;
      margin-bottom: 24px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      width: 20%;
      background: linear-gradient(90deg, var(--brand-rose), var(--brand-rose-dark));
      transition: width 0.3s ease;
    }

    /* Pagine del Wizard */
    .wizard-step { display: none; }
    .wizard-step.active {
      display: block;
      animation: fadeIn 0.25s ease-in-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .form-card {
      background: var(--card-bg);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      padding: 28px;
      margin-bottom: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.04);
    }
    .section-title {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      font-size: 18px;
      font-weight: 700;
      color: #121214;
    }
    .section-tag {
      background: var(--brand-rose-soft);
      color: var(--brand-rose-dark);
      border: 1px solid #F2CBD3;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .section-desc {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 20px;
    }

    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: 2fr 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    @media (max-width: 640px) {
      .grid-2, .grid-3 { grid-template-columns: 1fr; gap: 12px; }
      .form-card { padding: 20px 16px; }
    }

    .form-group { margin-bottom: 16px; }
    .form-group label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #27272A;
      margin-bottom: 6px;
    }
    .form-group label .req { color: #E11D48; margin-left: 2px; }
    .form-control {
      width: 100%;
      padding: 11px 13px;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      font-size: 14px;
      color: var(--text-main);
      background-color: #FFFFFF;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .form-control:focus {
      outline: none;
      border-color: var(--brand-rose);
      box-shadow: 0 0 0 3px rgba(217, 130, 149, 0.2);
    }
    textarea.form-control { resize: vertical; min-height: 80px; }

    .info-callout {
      background: var(--brand-rose-soft);
      border-left: 4px solid var(--brand-rose);
      border-radius: 6px;
      padding: 14px 16px;
      margin-bottom: 20px;
      font-size: 13px;
      color: #3F3F46;
      line-height: 1.5;
    }
    .info-callout strong { color: var(--brand-rose-dark); }

    .delegate-item {
      background: #FAFAFA;
      border: 1px solid #E4E4E7;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
      position: relative;
    }
    .btn-remove-delegate {
      background: #FEE2E2;
      color: #991B1B;
      border: none;
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      float: right;
    }
    .btn-secondary {
      background: #FFFFFF;
      color: var(--brand-rose-dark);
      border: 1px dashed var(--brand-rose);
      padding: 10px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-secondary:hover { background: var(--brand-rose-soft); }

    .wizard-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 24px;
      gap: 12px;
    }
    .btn-prev {
      background: #FFFFFF;
      color: #3F3F46;
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-prev:hover { background: #F4F4F5; }
    .btn-next {
      background: linear-gradient(135deg, var(--brand-rose), var(--brand-rose-dark));
      color: #FFFFFF;
      border: none;
      border-radius: 8px;
      padding: 12px 24px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(217, 130, 149, 0.4);
      margin-left: auto;
      transition: transform 0.15s ease;
    }
    .btn-next:hover { transform: translateY(-1px); }

    .checkbox-label {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 14px;
      font-size: 13px;
      color: #27272A;
      cursor: pointer;
    }
    .checkbox-label input[type="checkbox"] {
      margin-top: 3px;
      width: 17px;
      height: 17px;
      accent-color: var(--brand-rose);
      cursor: pointer;
      flex-shrink: 0;
    }

    .btn-submit {
      background: linear-gradient(135deg, var(--brand-rose), var(--brand-rose-dark));
      color: #FFFFFF;
      border: none;
      border-radius: 10px;
      padding: 16px 28px;
      font-size: 16px;
      font-weight: 700;
      width: 100%;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(217, 130, 149, 0.4);
      letter-spacing: 0.3px;
      margin-top: 10px;
    }
    .btn-submit:hover { transform: translateY(-1px); }

    .robot-trap {
      opacity: 0;
      position: absolute;
      top: 0;
      left: 0;
      height: 0;
      width: 0;
      z-index: -1;
    }

    footer {
      background-color: var(--bg-dark);
      color: #A1A1AA;
      padding: 32px 20px;
      font-size: 12px;
      border-top: 1px solid #27272A;
      text-align: center;
      line-height: 1.8;
    }
    footer strong { color: #FFFFFF; }
    footer a { color: var(--brand-rose-light); text-decoration: none; }
  </style>
</head>
<body>

  <header>
    <div class="header-content">
      <div class="badge-icon">🎭</div>
      <div class="header-titles">
        <h1>Cervelli in Affitto APS</h1>
        <p>Associazione di Promozione Sociale &bull; Affiliata UILT (Unione Italiana Libero Teatro)</p>
      </div>
    </div>
  </header>

  <main>
    <!-- Stepper 5 Passaggi Interattivo -->
    <div class="stepper">
      <div class="step-item active" id="badge_step_1"><span class="step-num">1</span> Genitore/Tutore</div>
      <div class="step-item" id="badge_step_2"><span class="step-num">2</span> Allievo Minore</div>
      <div class="step-item" id="badge_step_3"><span class="step-num">3</span> Laboratorio</div>
      <div class="step-item" id="badge_step_4"><span class="step-num">4</span> Deleghe Ritiro</div>
      <div class="step-item" id="badge_step_5"><span class="step-num">5</span> Consensi & Invio</div>
    </div>

    <!-- Barra di avanzamento percentuale -->
    <div class="progress-bar-container">
      <div class="progress-bar-fill" id="progressBar"></div>
    </div>

    <form method="POST" action="/iscrizione-minori" id="iscrizioneForm">

      <!-- Honeypot Anti-Spam invisibile -->
      <div class="robot-trap">
        <label for="website">Non compilare questo campo:</label>
        <input type="text" id="website" name="website" tabindex="-1" autocomplete="off">
        <input type="text" name="codice_sicurezza_robot" tabindex="-1" autocomplete="off">
      </div>

      <!-- ========================================== -->
      <!-- PAGINA 1: DATI GENITORE / TUTORE LEGALE -->
      <!-- ========================================== -->
      <div class="wizard-step active" id="step_1">
        <div class="form-card">
          <div class="section-title">
            <span>Passaggio 1: Dati Genitore / Tutore Legale</span>
            <span class="section-tag">Ammissione Socio APS</span>
          </div>
          <p class="section-desc">
            Per iscrivere un allievo minore ai laboratori dell'APS, il genitore o tutore legale richiede l'ammissione in qualita di Socio Ordinario.
          </p>

          <div class="grid-2">
            <div class="form-group">
              <label>Nome genitore/tutore <span class="req">*</span></label>
              <input type="text" name="genitore_nome" id="genitore_nome" class="form-control" required placeholder="Es. Marco">
            </div>
            <div class="form-group">
              <label>Cognome genitore/tutore <span class="req">*</span></label>
              <input type="text" name="genitore_cognome" id="genitore_cognome" class="form-control" required placeholder="Es. Rossi">
            </div>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label>Codice Fiscale genitore <span class="req">*</span></label>
              <input type="text" name="genitore_cf" id="genitore_cf" class="form-control" maxlength="16" required placeholder="Es. RSSMRC80A01H501U" style="text-transform: uppercase;">
            </div>
            <div class="form-group">
              <label>Ruolo / Grado parentela <span class="req">*</span></label>
              <select name="genitore_ruolo" class="form-control" required>
                <option value="genitore">Genitore (Madre / Padre)</option>
                <option value="tutore_legale">Tutore Legale / Esercente potesta</option>
              </select>
            </div>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label>Telefono / Cellulare per comunicazioni <span class="req">*</span></label>
              <input type="tel" name="genitore_telefono" id="genitore_telefono" class="form-control" required placeholder="Es. 333 1234567">
            </div>
            <div class="form-group">
              <label>Email per conferme e delibera <span class="req">*</span></label>
              <input type="email" name="genitore_email" id="genitore_email" class="form-control" required placeholder="Es. marco.rossi@email.it">
            </div>
          </div>

          <div class="form-group">
            <label>Indirizzo di residenza (Via/Piazza e civico) <span class="req">*</span></label>
            <input type="text" name="genitore_indirizzo" id="genitore_indirizzo" class="form-control" required placeholder="Es. Via Roma 10">
          </div>

          <div class="grid-3">
            <div class="form-group">
              <label>Comune di residenza <span class="req">*</span></label>
              <input type="text" name="genitore_citta" id="genitore_citta" class="form-control" required placeholder="Es. Bologna">
            </div>
            <div class="form-group">
              <label>CAP <span class="req">*</span></label>
              <input type="text" name="genitore_cap" id="genitore_cap" class="form-control" maxlength="5" required placeholder="40100">
            </div>
            <div class="form-group">
              <label>Provincia <span class="req">*</span></label>
              <input type="text" name="genitore_provincia" id="genitore_provincia" class="form-control" maxlength="2" required placeholder="BO" style="text-transform: uppercase;">
            </div>
          </div>

          <div class="wizard-actions">
            <div></div>
            <button type="button" class="btn-next" onclick="goToStep(2)">
              Avanti: Dati Allievo &rarr;
            </button>
          </div>
        </div>
      </div>

      <!-- ========================================== -->
      <!-- PAGINA 2: DATI ALLIEVO MINORE -->
      <!-- ========================================== -->
      <div class="wizard-step" id="step_2">
        <div class="form-card">
          <div class="section-title">
            <span>Passaggio 2: Dati dell'Allievo/a (Minore)</span>
            <span class="section-tag">Socio Minore</span>
          </div>
          <p class="section-desc">
            I minori iscritti ai corsi vengono associati all'APS e tesserati UILT per la necessaria copertura assicurativa infortuni e RC.
          </p>

          <div class="grid-2">
            <div class="form-group">
              <label>Nome allievo/a <span class="req">*</span></label>
              <input type="text" name="minore_nome" id="minore_nome" class="form-control" required placeholder="Es. Sofia">
            </div>
            <div class="form-group">
              <label>Cognome allievo/a <span class="req">*</span></label>
              <input type="text" name="minore_cognome" id="minore_cognome" class="form-control" required placeholder="Es. Rossi">
            </div>
          </div>

          <div class="grid-2">
            <div class="form-group">
              <label>Codice Fiscale allievo/a <span class="req">*</span></label>
              <input type="text" name="minore_cf" id="minore_cf" class="form-control" maxlength="16" required placeholder="Es. RSSFSO15M41H501Z" style="text-transform: uppercase;">
            </div>
            <div class="form-group">
              <label>Data di nascita <span class="req">*</span></label>
              <input type="date" name="minore_data_nascita" id="minore_data_nascita" class="form-control" required>
            </div>
          </div>

          <div class="form-group">
            <label>Luogo di nascita (Comune o Stato estero)</label>
            <input type="text" name="minore_luogo_nascita" class="form-control" placeholder="Es. Bologna">
          </div>

          <div class="form-group">
            <label>Note utili per gli insegnanti (allergie, esigenze particolari o bisogni educativi)</label>
            <textarea name="minore_note" class="form-control" placeholder="Segnala eventuali aspetti importanti per il benessere del bambino/a durante l'attivita"></textarea>
          </div>

          <div class="wizard-actions">
            <button type="button" class="btn-prev" onclick="goToStep(1)">&larr; Indietro</button>
            <button type="button" class="btn-next" onclick="goToStep(3)">Avanti: Laboratorio &rarr;</button>
          </div>
        </div>
      </div>

      <!-- ========================================== -->
      <!-- PAGINA 3: SELEZIONE LABORATORIO -->
      <!-- ========================================== -->
      <div class="wizard-step" id="step_3">
        <div class="form-card">
          <div class="section-title">
            <span>Passaggio 3: Laboratorio Teatrale</span>
            <span class="section-tag">Attivita APS</span>
          </div>
          <p class="section-desc">Seleziona il gruppo o laboratorio a cui intendi iscrivere l'allievo/a.</p>

          <div class="form-group">
            <label>Corso prescelto <span class="req">*</span></label>
            <select name="corso_id" class="form-control" required>
              ${opzioniCorsi}
            </select>
          </div>

          <div class="info-callout">
            <strong>Copertura Federale Inclusa:</strong> La frequenza ai laboratori teatrali di Cervelli in Affitto APS comprende il tesseramento UILT per l'anno solare, con copertura assicurativa infortuni e responsabilita civile per l'allievo/a.
          </div>

          <div class="wizard-actions">
            <button type="button" class="btn-prev" onclick="goToStep(2)">&larr; Indietro</button>
            <button type="button" class="btn-next" onclick="goToStep(4)">Avanti: Deleghe Ritiro &rarr;</button>
          </div>
        </div>
      </div>

      <!-- ========================================== -->
      <!-- PAGINA 4: DELEGHE AL RITIRO (FACOLTATIVE) -->
      <!-- ========================================== -->
      <div class="wizard-step" id="step_4">
        <div class="form-card">
          <div class="section-title">
            <span>Passaggio 4: Deleghe al Ritiro dell'Allievo/a</span>
            <span class="section-tag">Sicurezza Minori</span>
          </div>
          <p class="section-desc">
            Indica le persone maggiorenni autorizzate a ritirare il minore al termine delle lezioni oltre ai genitori (es. nonni, zii, amici di famiglia). Se non hai deleghe da aggiungere, puoi procedere subito al passaggio successivo.
          </p>

          <div id="delegheContainer"></div>

          <button type="button" class="btn-secondary" id="btnAddDelega" onclick="addDelegaBlock()">
            + Aggiungi una persona delegata al ritiro
          </button>

          <div class="wizard-actions">
            <button type="button" class="btn-prev" onclick="goToStep(3)">&larr; Indietro</button>
            <button type="button" class="btn-next" onclick="goToStep(5)">Avanti: Consensi & Invio &rarr;</button>
          </div>
        </div>
      </div>

      <!-- ========================================== -->
      <!-- PAGINA 5: CONSENSI E CONFERMA FINALE -->
      <!-- ========================================== -->
      <div class="wizard-step" id="step_5">
        <div class="form-card">
          <div class="section-title">
            <span>Passaggio 5: Statuto dell'APS, Privacy & Consensi</span>
            <span class="section-tag">Conformita di Legge</span>
          </div>

          <div class="info-callout">
            <strong>Trasparenza Associativa:</strong> Con l'invio del presente modulo richiedi formalmente l'ammissione all'Associazione di Promozione Sociale "Cervelli in Affitto APS" per l'anno sociale in corso, dichiarando di condividerne le finalita educative, culturali e teatrali.
          </div>

          <label class="checkbox-label">
            <input type="checkbox" name="consenso_statuto" id="consenso_statuto" value="1" required checked>
            <span>
              <strong>Adesione allo Statuto dell'APS <span class="req">*</span>:</strong>
              Dichiaro di aver preso visione dello Statuto di Cervelli in Affitto APS, di accettarne le norme e i regolamenti interni e di richiedere l'ammissione a socio per me e per il minore rappresentato.
            </span>
          </label>

          <label class="checkbox-label">
            <input type="checkbox" name="consenso_privacy" id="consenso_privacy" value="1" required checked>
            <span>
              <strong>Informativa Privacy GDPR <span class="req">*</span>:</strong>
              Acconsento al trattamento dei dati personali forniti per le finalita connesse alla gestione associativa, all'affiliazione e assicurazione UILT e alla partecipazione al laboratorio teatrale.
            </span>
          </label>

          <label class="checkbox-label">
            <input type="checkbox" name="consenso_foto" value="1" checked>
            <span>
              <strong>Liberatoria Foto e Video Teatrali (consigliato):</strong>
              Autorizzo l'APS a effettuare riprese fotografiche e video esclusivamente a scopo documentativo interno e per saggi teatrali di fine corso.
            </span>
          </label>

          <label class="checkbox-label">
            <input type="checkbox" name="consenso_news" value="1">
            <span>
              <strong>Comunicazioni su spettacoli ed eventi:</strong>
              Desidero ricevere via email gli inviti e le date degli spettacoli teatrali dell'APS.
            </span>
          </label>

          <div class="wizard-actions" style="margin-top: 24px;">
            <button type="button" class="btn-prev" onclick="goToStep(4)">&larr; Indietro</button>
            <div style="flex: 1; max-width: 380px;">
              <button type="submit" class="btn-submit" id="btnSubmitForm">
                Invia Domanda di Iscrizione & Ammissione Socio
              </button>
            </div>
          </div>
        </div>
      </div>

    </form>
  </main>

  <footer>
    <p>
      <strong>Cervelli in Affitto APS</strong> &bull; Associazione di Promozione Sociale<br>
      Affiliata UILT (Unione Italiana Libero Teatro) &bull; Dominio ufficiale: <a href="https://cervellinaffitto-aps.it" target="_blank">cervellinaffitto-aps.it</a><br>
      Codice Fiscale: <strong>92095900518</strong> &bull; Tutti i diritti riservati
    </p>
  </footer>

  <script>
    let currentStep = 1;
    const totalSteps = 5;

    function goToStep(step) {
      if (step > currentStep) {
        if (!validateStep(currentStep)) return;
      }

      document.querySelectorAll('.wizard-step').forEach(el => el.classList.remove('active'));
      document.getElementById('step_' + step).classList.add('active');

      for (let i = 1; i <= totalSteps; i++) {
        const badge = document.getElementById('badge_step_' + i);
        badge.classList.remove('active', 'completed');
        if (i < step) badge.classList.add('completed');
        else if (i === step) badge.classList.add('active');
      }

      const progress = (step / totalSteps) * 100;
      document.getElementById('progressBar').style.width = progress + '%';

      currentStep = step;
      window.scrollTo({ top: 100, behavior: 'smooth' });
    }

    function validateStep(step) {
      if (step === 1) {
        const reqFields = ['genitore_nome', 'genitore_cognome', 'genitore_cf', 'genitore_telefono', 'genitore_email', 'genitore_indirizzo', 'genitore_citta', 'genitore_cap', 'genitore_provincia'];
        for (const id of reqFields) {
          const el = document.getElementById(id);
          if (!el || !el.value.trim()) {
            alert('Compila tutti i campi obbligatori del Genitore/Tutore prima di proseguire.');
            if (el) el.focus();
            return false;
          }
        }
      }
      if (step === 2) {
        const reqFields = ['minore_nome', 'minore_cognome', 'minore_cf', 'minore_data_nascita'];
        for (const id of reqFields) {
          const el = document.getElementById(id);
          if (!el || !el.value.trim()) {
            alert("Compila tutti i campi obbligatori dell'Allievo Minore prima di proseguire.");
            if (el) el.focus();
            return false;
          }
        }
      }
      return true;
    }

    let delegaCount = 0;
    function addDelegaBlock() {
      delegaCount++;
      const container = document.getElementById('delegheContainer');
      const div = document.createElement('div');
      div.className = 'delegate-item';
      div.id = 'delega_' + delegaCount;
      div.innerHTML = \`
        <button type="button" class="btn-remove-delegate" onclick="removeDelega('delega_\${delegaCount}')">Rimuovi</button>
        <strong style="display:block; margin-bottom: 10px; color: #121214; font-size: 13px;">Persona Delegata #\${delegaCount}</strong>
        <div class="grid-2">
          <div class="form-group" style="margin-bottom:8px;">
            <label style="font-size:12px;">Nome <span class="req">*</span></label>
            <input type="text" name="delega_nome[]" class="form-control" required placeholder="Es. Anna">
          </div>
          <div class="form-group" style="margin-bottom:8px;">
            <label style="font-size:12px;">Cognome <span class="req">*</span></label>
            <input type="text" name="delega_cognome[]" class="form-control" required placeholder="Es. Bianchi">
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group" style="margin-bottom:0;">
            <label style="font-size:12px;">Telefono di reperibilita <span class="req">*</span></label>
            <input type="tel" name="delega_telefono[]" class="form-control" required placeholder="Es. 347 9876543">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label style="font-size:12px;">Relazione con l'allievo/a</label>
            <input type="text" name="delega_relazione[]" class="form-control" placeholder="Es. Nonna / Zio / Amica di famiglia">
          </div>
        </div>
      \`;
      container.appendChild(div);
    }

    function removeDelega(id) {
      const el = document.getElementById(id);
      if (el) el.remove();
    }

    document.getElementById('iscrizioneForm').addEventListener('submit', function() {
      const btn = document.getElementById('btnSubmitForm');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Invio e registrazione in corso...';
      }
    });
  </script>

</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderSuccessPage(nomeMinore, email) {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iscrizione Ricevuta | Cervelli in Affitto APS</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: #F8F9FA;
      color: #18181B;
      margin: 0; padding: 20px;
      display: flex; align-items: center; justify-content: center; min-height: 100vh;
    }
    .card {
      background: #FFFFFF;
      max-width: 580px; width: 100%;
      border-radius: 12px;
      border: 1px solid #E4E4E7;
      padding: 36px 28px;
      text-align: center;
      box-shadow: 0 4px 16px rgba(0,0,0,0.06);
    }
    .icon {
      width: 64px; height: 64px;
      border-radius: 50%;
      background: #ECFDF5;
      color: #059669;
      display: flex; align-items: center; justify-content: center;
      font-size: 32px;
      margin: 0 auto 20px;
    }
    h1 { font-size: 22px; color: #121214; margin-bottom: 12px; }
    p { font-size: 14px; color: #52525B; line-height: 1.6; margin-bottom: 16px; }
    .box {
      background: #FCF4F6;
      border-left: 4px solid #D98295;
      text-align: left;
      padding: 16px;
      border-radius: 6px;
      margin: 24px 0;
      font-size: 13px;
    }
    .box strong { color: #9F5D6B; }
    .btn {
      display: inline-block;
      background: #121214;
      color: #FFFFFF;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Richiesta Registrata con Successo!</h1>
    <p>
      La domanda di ammissione e iscrizione al laboratorio per <strong>${nomeMinore}</strong> e stata registrata correttamente nel gestionale associativo.
    </p>
    ${email ? `<p style="font-size:13px; color:#71717A;">Abbiamo inviato un'email di riepilogo all'indirizzo <strong>${email}</strong>.</p>` : ''}
    <div class="box">
      <strong>Cosa succede adesso?</strong>
      <ol style="margin: 8px 0 0 18px; padding: 0; color: #4A4A50; line-height: 1.6;">
        <li>Il Consiglio Direttivo dell'APS deliberera formalmente la richiesta di ammissione socio.</li>
        <li>L'allievo/a verra registrato presso la federazione teatrale <strong>UILT</strong> per l'attivazione della copertura assicurativa obbligatoria.</li>
        <li>La segreteria ti contattera per fornirti il calendario delle lezioni e le indicazioni sul saldo della quota.</li>
      </ol>
    </div>
    <a href="/" class="btn">Torna al modulo principale</a>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderErrorPage(messaggio) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Attenzione | Cervelli in Affitto APS</title>
  <style>
    body { font-family: sans-serif; background: #F8F9FA; padding: 30px; text-align: center; }
    .box { max-width: 500px; margin: 40px auto; background: #fff; padding: 30px; border-radius: 10px; border: 1px solid #E4E4E7; }
    h2 { color: #DC2626; margin-bottom: 12px; }
    p { font-size: 14px; color: #4B5563; line-height: 1.5; margin-bottom: 20px; }
    a { display: inline-block; background: #121214; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Attenzione</h2>
    <p>${messaggio}</p>
    <a href="javascript:history.back()">Torna indietro e correggi</a>
  </div>
</body>
</html>`;
}
