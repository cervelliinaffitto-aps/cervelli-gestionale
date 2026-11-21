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
const DEFAULT_CORSO_ID = "corso-teatro-ragazzi-2026";

async function seedDefaultCourseIfNeeded(env) {
  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO attivita_eventi (id, titolo, tipo, descrizione, luogo, quota_o_prezzo, capienza_massima, stato)
      VALUES (
        ?,
        'Laboratorio Teatrale Bambini e Ragazzi',
        'corso_teatro_minori',
        'Laboratorio teatrale propedeutico e di recitazione per minori con copertura assicurativa UILT.',
        'Sede Cervelli in Affitto APS',
        0,
        30,
        'aperto'
      )
    `).bind(DEFAULT_CORSO_ID).run();
  } catch (e) {
    console.error("Errore verifica corso default:", e);
  }
}

async function getCorsiAttivi(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, titolo, descrizione, luogo FROM attivita_eventi WHERE stato = 'aperto' ORDER BY titolo"
    ).all();
    if (results && results.length > 0) return results;
  } catch (e) {
    console.error("Errore lettura corsi da D1:", e);
  }
  return [
    {
      id: DEFAULT_CORSO_ID,
      titolo: "Laboratorio Teatrale Bambini e Ragazzi",
      descrizione: "Laboratorio teatrale propedeutico per minori con copertura assicurativa UILT",
      luogo: "Sede Cervelli in Affitto APS"
    }
  ];
}

/* =========================================================================
   ELABORAZIONE DATI INVIATI (POST)
   ========================================================================= */
async function handleIscrizionePost(request, env, ctx) {
  try {
    const url = new URL(request.url);
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
    const gCf = (formData.get("genitore_cf") || "").trim().toUpperCase();
    const gTelefono = (formData.get("genitore_telefono") || "").trim();
    const gEmail = (formData.get("genitore_email") || "").trim().toLowerCase();
    const gRuolo = formData.get("genitore_ruolo") || "genitore";

    // Dati Allievo Minore
    const mNome = (formData.get("minore_nome") || "").trim();
    const mCognome = (formData.get("minore_cognome") || "").trim();
    const mCf = (formData.get("minore_cf") || "").trim().toUpperCase();
    const mDataNascita = formData.get("minore_data_nascita") || "";
    const mLuogoNascita = (formData.get("minore_luogo_nascita") || "").trim();
    const mIndirizzo = (formData.get("minore_indirizzo") || "").trim();
    const mNote = (formData.get("minore_note") || "").trim();

    // Corso Selezionato (con fallback di sicurezza)
    const corsoId = formData.get("corso_id") || DEFAULT_CORSO_ID;

    // Consensi
    const consStatuto = formData.get("consenso_statuto") ? 1 : 0;
    const consPrivacy = formData.get("consenso_privacy") ? 1 : 0;
    const consFoto = formData.get("consenso_foto") ? 1 : 0;
    const consNews = formData.get("consenso_newsletter") ? 1 : 0;

    // Validazione Campi Obbligatori Minimi
    if (!gNome || !gCognome || !gCf || !gEmail || !gTelefono || !mNome || !mCognome || !mCf || !mDataNascita) {
      return new Response(
        renderErrorPage("Tutti i campi obbligatori contrassegnati con l'asterisco (*) devono essere compilati."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    if (!consStatuto || !consPrivacy) {
      return new Response(
        renderErrorPage("Per poter inviare la richiesta è necessario accettare lo Statuto Sociale e l'Informativa Privacy GDPR."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    const clientIP = request.headers.get("CF-Connecting-IP") || "ip-non-disponibile";

    // 1. Assicura che l'attività corso esista nella tabella attivita_eventi
    await env.DB.prepare(`
      INSERT OR IGNORE INTO attivita_eventi (id, titolo, tipo, descrizione, luogo, quota_o_prezzo, capienza_massima, stato)
      VALUES (?, 'Laboratorio Teatrale Bambini e Ragazzi', 'corso_teatro_minori', 'Laboratorio teatrale annuale con copertura UILT', 'Sede Cervelli in Affitto APS', 0, 30, 'aperto')
    `).bind(corsoId).run();

    // 2. Gestione Tutore Legale (ricerca esistente o inserimento)
    let tutoreRow = await env.DB.prepare("SELECT id FROM tutori WHERE codice_fiscale = ?").bind(gCf).first();
    let tutoreId = tutoreRow ? tutoreRow.id : "tut-" + crypto.randomUUID().slice(0, 12);

    if (!tutoreRow) {
      await env.DB.prepare(`
        INSERT INTO tutori (id, nome, cognome, codice_fiscale, telefono, email, grado_parentela, residenza_indirizzo, residenza_citta, residenza_cap, residenza_provincia)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Bologna', '40100', 'BO')
      `).bind(tutoreId, gNome, gCognome, gCf, gTelefono, gEmail, gRuolo, mIndirizzo || "Indirizzo non specificato").run();
    } else {
      await env.DB.prepare(`
        UPDATE tutori SET telefono = ?, email = ? WHERE id = ?
      `).bind(gTelefono, gEmail, tutoreId).run();
    }

    // 3. Gestione Socio Genitore (richiesta di ammissione socio ordinario)
    let socioGenitoreRow = await env.DB.prepare("SELECT id FROM soci WHERE codice_fiscale = ?").bind(gCf).first();
    let socioGenitoreId = socioGenitoreRow ? socioGenitoreRow.id : "soc-g-" + crypto.randomUUID().slice(0, 12);

    if (!socioGenitoreRow) {
      await env.DB.prepare(`
        INSERT INTO soci (id, is_minore, tutore_id, nome, cognome, codice_fiscale, data_nascita, luogo_nascita, residenza_indirizzo, residenza_citta, residenza_cap, residenza_provincia, telefono, email, tipologia_socio, stato_richiesta)
        VALUES (?, 0, NULL, ?, ?, ?, '1980-01-01', 'Non specificato', ?, 'Bologna', '40100', 'BO', ?, ?, 'ordinario', 'in_attesa')
      `).bind(socioGenitoreId, gNome, gCognome, gCf, mIndirizzo || "Indirizzo non specificato", gTelefono, gEmail).run();
    } else {
      await env.DB.prepare(`
        UPDATE soci SET telefono = ?, email = ?, updated_at = datetime('now') WHERE id = ?
      `).bind(gTelefono, gEmail, socioGenitoreId).run();
    }

    // 4. Gestione Socio Minore (Allievo con riferimento certo a tutoreId)
    let socioMinoreRow = await env.DB.prepare("SELECT id FROM soci WHERE codice_fiscale = ?").bind(mCf).first();
    let socioMinoreId = socioMinoreRow ? socioMinoreRow.id : "soc-m-" + crypto.randomUUID().slice(0, 12);

    if (!socioMinoreRow) {
      await env.DB.prepare(`
        INSERT INTO soci (id, is_minore, tutore_id, nome, cognome, codice_fiscale, data_nascita, luogo_nascita, residenza_indirizzo, residenza_citta, residenza_cap, residenza_provincia, telefono, email, tipologia_socio, stato_richiesta)
        VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 'Bologna', '40100', 'BO', ?, ?, 'ordinario', 'in_attesa')
      `).bind(socioMinoreId, tutoreId, mNome, mCognome, mCf, mDataNascita, mLuogoNascita || "Non indicato", mIndirizzo || "Indirizzo non specificato", gTelefono, gEmail).run();
    } else {
      await env.DB.prepare(`
        UPDATE soci SET tutore_id = ?, data_nascita = ?, updated_at = datetime('now') WHERE id = ?
      `).bind(tutoreId, mDataNascita, socioMinoreId).run();
    }

    // 5. Iscrizione al Corso Teatrale
    let iscrRow = await env.DB.prepare("SELECT id FROM iscrizioni_corsi WHERE attivita_id = ? AND socio_id = ?").bind(corsoId, socioMinoreId).first();
    let iscrizioneId = iscrRow ? iscrRow.id : "isc-" + crypto.randomUUID().slice(0, 12);

    if (!iscrRow) {
      await env.DB.prepare(`
        INSERT INTO iscrizioni_corsi (id, attivita_id, socio_id, quota_dovuta, quota_saldata, stato_pagamento, note)
        VALUES (?, ?, ?, 0, 0, 'da_saldare', ?)
      `).bind(iscrizioneId, corsoId, socioMinoreId, mNote || null).run();
    } else {
      await env.DB.prepare(`
        UPDATE iscrizioni_corsi SET note = ? WHERE id = ?
      `).bind(mNote || null, iscrizioneId).run();
    }

    // 6. Registrazione Consensi Privacy
    await env.DB.prepare(`
      INSERT INTO consensi_privacy (id, socio_id, tutore_id, accettazione_statuto, consenso_trattamento_dati, consenso_foto_video, consenso_newsletter, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind("cons-" + crypto.randomUUID().slice(0, 12), socioMinoreId, tutoreId, consStatuto, consPrivacy, consFoto, consNews, clientIP).run();

    // 7. Registrazione Deleghe al Ritiro
    const delegheNomi = formData.getAll("delega_nome[]");
    const delegheCognomi = formData.getAll("delega_cognome[]");
    const delegheTelefoni = formData.getAll("delega_telefono[]");
    const delegheRelazioni = formData.getAll("delega_relazione[]");
    const delegheCF = formData.getAll("delega_cf[]");

    // Elimina eventuali vecchie deleghe per questa iscrizione prima di reinserirle
    await env.DB.prepare("DELETE FROM deleghe_ritiro WHERE iscrizione_id = ?").bind(iscrizioneId).run();

    if (delegheNomi && delegheNomi.length > 0) {
      for (let i = 0; i < delegheNomi.length; i++) {
        const dNome = (delegheNomi[i] || "").trim();
        const dCognome = (delegheCognomi[i] || "").trim();
        const dTel = (delegheTelefoni[i] || "").trim();
        const dRel = (delegheRelazioni[i] || "").trim();
        const dCf = (delegheCF[i] || "").trim().toUpperCase();

        if (dNome && dCognome && dTel) {
          await env.DB.prepare(`
            INSERT INTO deleghe_ritiro (id, iscrizione_id, socio_minore_id, nome, cognome, codice_fiscale, telefono, relazione)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).bind("del-" + crypto.randomUUID().slice(0, 12), iscrizioneId, socioMinoreId, dNome, dCognome, dCf || null, dTel, dRel || "Delegato autorizzato").run();
        }
      }
    }

    // 8. Invio Email di Conferma con Resend
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

    // 9. Reindirizzamento a pagina di conferma
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
   INVIO EMAIL CON RESEND
   ========================================================================= */
async function sendConfirmationEmails(apiKey, data) {
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Cervelli in Affitto APS <noreply@cervellinaffitto-aps.it>",
        to: [data.genitoreEmail],
        subject: `Richiesta Iscrizione Ricevuta - ${data.minoreNome}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1f2937; line-height: 1.6;">
            <div style="background-color: #121214; padding: 25px; text-align: center; border-radius: 8px 8px 0 0;">
              <h2 style="color: #D98295; margin: 0; font-size: 22px;">Cervelli in Affitto APS</h2>
              <p style="color: #9ca3af; margin: 5px 0 0 0; font-size: 13px;">Affiliata UILT - Unione Italiana Libero Teatro</p>
            </div>
            <div style="padding: 25px; border: 1px solid #e5e7eb; border-top: none; background: #ffffff;">
              <p>Gentile <strong>${data.genitoreNome}</strong>,</p>
              <p>abbiamo ricevuto correttamente la domanda di ammissione a socio e la richiesta di iscrizione al laboratorio teatrale per <strong>${data.minoreNome}</strong>.</p>
              <div style="background-color: #fdf2f4; border-left: 4px solid #D98295; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; font-size: 14px; color: #831843;">
                  <strong>Prossimi passi:</strong> La domanda sarà ratificata dal Consiglio Direttivo con l'assegnazione del Numero Tessera APS e la copertura assicurativa UILT.
                </p>
              </div>
              <p>A presto sul palcoscenico!</p>
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 25px 0;" />
              <p style="font-size: 11px; color: #6b7280; text-align: center;">
                Cervelli in Affitto APS &bull; CF: 91456950371 &bull; info@cervellinaffitto-aps.it
              </p>
            </div>
          </div>
        `
      })
    });
  } catch (err) {
    console.error("Errore invio notifica Resend:", err);
  }
}

/* =========================================================================
   PAGINE HTML: FORM A 5 STEP, CONFERMA, ERRORE
   ========================================================================= */
function renderFormPage(corsi) {
  const opzioniCorsi = corsi.map(c => `
    <label class="radio-card">
      <input type="radio" name="corso_id" value="${c.id}" checked required>
      <div class="radio-body">
        <strong>${c.titolo}</strong>
        <span>${c.descrizione || "Laboratorio annuale teatro ragazzi"}</span>
        <small>&bull; Luogo: ${c.luogo || "Sede APS"}</small>
      </div>
    </label>
  `).join("");

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iscrizione Corsi Minori & Domanda Socio | Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #121214;
      --brand-rose: #D98295;
      --brand-rose-dark: #9F5D6B;
      --brand-rose-light: #FDF2F4;
      --silver: #E8E7E9;
      --text-dark: #18181B;
      --text-muted: #71717A;
      --bg-light: #F4F4F5;
      --border-light: #E4E4E7;
      --success: #15803D;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg-light);
      color: var(--text-dark);
      line-height: 1.5;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header {
      background-color: var(--bg-dark);
      color: white;
      padding: 30px 20px;
      text-align: center;
      border-bottom: 3px solid var(--brand-rose);
    }
    .header-badge {
      display: inline-block;
      background-color: rgba(217, 130, 149, 0.15);
      color: var(--brand-rose);
      border: 1px solid rgba(217, 130, 149, 0.3);
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    header h1 {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 6px;
    }
    header p {
      font-size: 13px;
      color: #A1A1AA;
      max-width: 600px;
      margin: 0 auto;
    }
    .container {
      width: 100%;
      max-width: 760px;
      margin: -20px auto 40px auto;
      padding: 0 16px;
      flex: 1;
    }
    .card {
      background: #FFFFFF;
      border-radius: 16px;
      border: 1px solid var(--border-light);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
      padding: 24px 28px;
    }
    @media (max-width: 640px) {
      .card { padding: 20px 16px; }
    }
    .stepper {
      display: flex;
      justify-content: space-between;
      margin-bottom: 24px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--border-light);
      gap: 6px;
      overflow-x: auto;
    }
    .step-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 700;
      color: #A1A1AA;
      white-space: nowrap;
    }
    .step-num {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #E4E4E7;
      color: #71717A;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
    }
    .step-item.active { color: var(--brand-rose-dark); }
    .step-item.active .step-num {
      background: var(--brand-rose);
      color: #FFFFFF;
    }
    .step-item.completed { color: var(--success); }
    .step-item.completed .step-num {
      background: var(--success);
      color: #FFFFFF;
    }
    .form-step { display: none; }
    .form-step.active { display: block; }
    .step-header { margin-bottom: 20px; }
    .step-header h2 {
      font-size: 19px;
      font-weight: 800;
      color: var(--text-dark);
      margin-bottom: 4px;
    }
    .step-header p {
      font-size: 13px;
      color: var(--text-muted);
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    @media (max-width: 600px) {
      .grid { grid-template-columns: 1fr; }
    }
    .form-group {
      margin-bottom: 16px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 12px;
      font-weight: 700;
      color: #27272A;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    label .req { color: #E11D48; }
    input[type="text"], input[type="email"], input[type="tel"], input[type="date"], select, textarea {
      width: 100%;
      padding: 10px 14px;
      border-radius: 8px;
      border: 1.5px solid var(--border-light);
      font-family: inherit;
      font-size: 14px;
      background: #FAFAFA;
      transition: all 0.2s ease;
      color: var(--text-dark);
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--brand-rose);
      background: #FFFFFF;
      box-shadow: 0 0 0 3px rgba(217, 130, 149, 0.2);
    }
    .radio-card {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 16px;
      border: 2px solid var(--brand-rose);
      background: var(--brand-rose-light);
      border-radius: 10px;
      cursor: pointer;
      margin-bottom: 12px;
    }
    .radio-card input { margin-top: 4px; }
    .radio-body strong { display: block; font-size: 15px; color: #831843; }
    .radio-body span { display: block; font-size: 12px; color: #4B5563; margin-top: 2px; }
    .radio-body small { display: block; font-size: 11px; color: #6B7280; margin-top: 4px; }
    .deleghe-container {
      background: #FAFAFA;
      border: 1px solid var(--border-light);
      border-radius: 12px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .delega-row {
      background: #FFFFFF;
      border: 1px solid var(--border-light);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
    }
    .delega-row-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 700;
      color: var(--brand-rose-dark);
    }
    .btn-add-delega {
      background: #FFFFFF;
      border: 1.5px dashed var(--brand-rose);
      color: var(--brand-rose-dark);
      padding: 10px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 13px;
      cursor: pointer;
      width: 100%;
      transition: all 0.2s;
    }
    .btn-add-delega:hover {
      background: var(--brand-rose-light);
    }
    .btn-remove-delega {
      background: none;
      border: none;
      color: #EF4444;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
    }
    .consent-card {
      background: #FAFAFA;
      border: 1px solid var(--border-light);
      border-radius: 10px;
      padding: 14px;
      margin-bottom: 12px;
      display: flex;
      gap: 12px;
      align-items: flex-start;
    }
    .consent-card input[type="checkbox"] {
      width: 18px;
      height: 18px;
      margin-top: 2px;
      accent-color: var(--brand-rose);
      flex-shrink: 0;
    }
    .consent-card label {
      font-size: 12px;
      font-weight: 500;
      text-transform: none;
      letter-spacing: 0;
      color: #3F3F46;
      line-height: 1.4;
      cursor: pointer;
    }
    .actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-top: 24px;
      padding-top: 18px;
      border-top: 1px solid var(--border-light);
    }
    .btn {
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 14px;
      cursor: pointer;
      transition: all 0.2s;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-prev {
      background: #F4F4F5;
      color: #3F3F46;
    }
    .btn-prev:hover { background: #E4E4E7; }
    .btn-next {
      background: var(--bg-dark);
      color: #FFFFFF;
      margin-left: auto;
    }
    .btn-next:hover {
      background: #27272A;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .btn-submit {
      background: var(--brand-rose);
      color: #FFFFFF;
      margin-left: auto;
    }
    .btn-submit:hover {
      background: var(--brand-rose-dark);
      box-shadow: 0 4px 16px rgba(217, 130, 149, 0.4);
    }
    footer {
      background: var(--bg-dark);
      color: #71717A;
      padding: 25px 20px;
      text-align: center;
      font-size: 12px;
      margin-top: auto;
      border-top: 1px solid #27272A;
    }
    footer strong { color: #A1A1AA; }
  </style>
</head>
<body>

  <header>
    <div class="header-badge">Stagione 2026/2027 &bull; Affiliato UILT</div>
    <h1>Cervelli in Affitto APS</h1>
    <p>Domanda di Ammissione a Socio e Iscrizione al Laboratorio Teatrale Ragazzi</p>
  </header>

  <div class="container">
    <div class="card">
      <div class="stepper">
        <div class="step-item active" id="badge-step-1"><span class="step-num">1</span> Genitore/Tutore</div>
        <div class="step-item" id="badge-step-2"><span class="step-num">2</span> Allievo Minore</div>
        <div class="step-item" id="badge-step-3"><span class="step-num">3</span> Laboratorio</div>
        <div class="step-item" id="badge-step-4"><span class="step-num">4</span> Deleghe Ritiro</div>
        <div class="step-item" id="badge-step-5"><span class="step-num">5</span> Consensi & Invio</div>
      </div>

      <form id="iscrizioneForm" method="POST" action="/iscrizione-minori">
        <div style="display:none;">
          <input type="text" name="codice_sicurezza_robot" value="">
        </div>

        <!-- STEP 1: DATI GENITORE / TUTORE -->
        <div class="form-step active" id="step-1">
          <div class="step-header">
            <h2>1. Dati Genitore o Tutore Legale</h2>
            <p>Il richiedente che sottoscrive l'iscrizione e la richiesta di ammissione socio.</p>
          </div>
          <div class="grid">
            <div class="form-group">
              <label>Nome Genitore / Tutore <span class="req">*</span></label>
              <input type="text" name="genitore_nome" required placeholder="Es. Mario">
            </div>
            <div class="form-group">
              <label>Cognome <span class="req">*</span></label>
              <input type="text" name="genitore_cognome" required placeholder="Es. Rossi">
            </div>
          </div>
          <div class="grid">
            <div class="form-group">
              <label>Codice Fiscale <span class="req">*</span></label>
              <input type="text" name="genitore_cf" required maxlength="16" placeholder="RSSMRA..." style="text-transform:uppercase;">
            </div>
            <div class="form-group">
              <label>Ruolo Familiare <span class="req">*</span></label>
              <select name="genitore_ruolo">
                <option value="genitore">Genitore (Madre / Padre)</option>
                <option value="tutore_legale">Tutore Legale</option>
                <option value="affidatario">Affidatario</option>
              </select>
            </div>
          </div>
          <div class="grid">
            <div class="form-group">
              <label>Cellulare per Comunicazioni urgenti <span class="req">*</span></label>
              <input type="tel" name="genitore_telefono" required placeholder="Es. 333 1234567">
            </div>
            <div class="form-group">
              <label>Email per Conferme e Comunicazioni <span class="req">*</span></label>
              <input type="email" name="genitore_email" required placeholder="nome@esempio.it">
            </div>
          </div>
          <div class="actions">
            <div></div>
            <button type="button" class="btn btn-next" onclick="goToStep(2)">Avanti: Dati Allievo &rarr;</button>
          </div>
        </div>

        <!-- STEP 2: DATI ALLIEVO MINORE -->
        <div class="form-step" id="step-2">
          <div class="step-header">
            <h2>2. Dati del Minore da Iscrivere</h2>
            <p>I dati anagrafici del bambino/ragazzo per il registro soci e la polizza assicurativa UILT.</p>
          </div>
          <div class="grid">
            <div class="form-group">
              <label>Nome Allievo <span class="req">*</span></label>
              <input type="text" name="minore_nome" required placeholder="Es. Luca">
            </div>
            <div class="form-group">
              <label>Cognome Allievo <span class="req">*</span></label>
              <input type="text" name="minore_cognome" required placeholder="Es. Rossi">
            </div>
          </div>
          <div class="grid">
            <div class="form-group">
              <label>Codice Fiscale Minore <span class="req">*</span></label>
              <input type="text" name="minore_cf" required maxlength="16" placeholder="RSSLCU..." style="text-transform:uppercase;">
            </div>
            <div class="form-group">
              <label>Data di Nascita <span class="req">*</span></label>
              <input type="date" name="minore_data_nascita" required>
            </div>
          </div>
          <div class="grid">
            <div class="form-group">
              <label>Luogo di Nascita</label>
              <input type="text" name="minore_luogo_nascita" placeholder="Città (Provincia)">
            </div>
            <div class="form-group">
              <label>Indirizzo di Residenza</label>
              <input type="text" name="minore_indirizzo" placeholder="Via, Civico, Città">
            </div>
          </div>
          <div class="form-group">
            <label>Note utili per gli insegnanti (facoltativo)</label>
            <textarea name="minore_note" rows="2" placeholder="Eventuali allergie, esigenze particolari o segnalazioni..."></textarea>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-prev" onclick="goToStep(1)">&larr; Indietro</button>
            <button type="button" class="btn btn-next" onclick="goToStep(3)">Avanti: Laboratorio &rarr;</button>
          </div>
        </div>

        <!-- STEP 3: SELEZIONE LABORATORIO -->
        <div class="form-step" id="step-3">
          <div class="step-header">
            <h2>3. Selezione Laboratorio Teatrale</h2>
            <p>Seleziona l'attività laboratoriale per l'anno associativo.</p>
          </div>
          ${opzioniCorsi}
          <div class="actions">
            <button type="button" class="btn btn-prev" onclick="goToStep(2)">&larr; Indietro</button>
            <button type="button" class="btn btn-next" onclick="goToStep(4)">Avanti: Deleghe Ritiro &rarr;</button>
          </div>
        </div>

        <!-- STEP 4: DELEGHE AL RITIRO -->
        <div class="form-step" id="step-4">
          <div class="step-header">
            <h2>4. Persone Delegate al Ritiro del Minore</h2>
            <p>Facoltativo: puoi indicare altre persone maggiorenni autorizzate a prelevare l'allievo al termine della lezione.</p>
          </div>
          <div class="deleghe-container" id="delegheBox">
            <div class="delega-row" id="delega-1">
              <div class="delega-row-header">
                <span>Persona Delegata 1</span>
              </div>
              <div class="grid">
                <div class="form-group">
                  <label>Nome Delegato</label>
                  <input type="text" name="delega_nome[]" placeholder="Es. Anna">
                </div>
                <div class="form-group">
                  <label>Cognome Delegato</label>
                  <input type="text" name="delega_cognome[]" placeholder="Es. Bianchi">
                </div>
              </div>
              <div class="grid">
                <div class="form-group">
                  <label>Telefono</label>
                  <input type="tel" name="delega_telefono[]" placeholder="Es. 347 1122334">
                </div>
                <div class="form-group">
                  <label>Relazione (nonno, zia, babysitter...)</label>
                  <input type="text" name="delega_relazione[]" placeholder="Es. Nonna materna">
                </div>
              </div>
            </div>
          </div>
          <button type="button" class="btn-add-delega" onclick="addDelegaRow()">+ Aggiungi un'altra persona delegata</button>
          <div class="actions">
            <button type="button" class="btn btn-prev" onclick="goToStep(3)">&larr; Indietro</button>
            <button type="button" class="btn btn-next" onclick="goToStep(5)">Avanti: Consensi &rarr;</button>
          </div>
        </div>

        <!-- STEP 5: STATUTO, PRIVACY & CONSENSI -->
        <div class="form-step" id="step-5">
          <div class="step-header">
            <h2>5. Domanda di Ammissione & Consensi</h2>
            <p>Conferma la presa visione dello statuto e la conformità al regolamento associativo.</p>
          </div>
          <div class="consent-card">
            <input type="checkbox" id="c_statuto" name="consenso_statuto" value="1" required>
            <label for="c_statuto">
              <strong>Richiesta ufficiale di ammissione a socio APS e accettazione dello Statuto:</strong>
              Dichiaro di aver preso visione dello Statuto e del Regolamento di Cervelli in Affitto APS, di condividerne le finalità e di impegnarmi al versamento della quota associativa annuale comprensiva della copertura UILT.
            </label>
          </div>
          <div class="consent-card">
            <input type="checkbox" id="c_privacy" name="consenso_privacy" value="1" required>
            <label for="c_privacy">
              <strong>Informativa Privacy GDPR (Regolamento UE 2016/679):</strong>
              Autorizzo il trattamento dei dati personali del genitore e del minore ai soli fini della gestione del rapporto associativo, dell'assicurazione UILT e dell'organizzazione delle attività.
            </label>
          </div>
          <div class="consent-card">
            <input type="checkbox" id="c_foto" name="consenso_foto" value="1">
            <label for="c_foto">
              <strong>Liberatoria Foto e Video (facoltativa):</strong>
              Autorizzo l'associazione alle riprese fotografiche e video dell'allievo durante le lezioni e i saggi finali per scopi documentativi e promozionali interni dell'associazione.
            </label>
          </div>
          <div class="consent-card">
            <input type="checkbox" id="c_news" name="consenso_newsletter" value="1" checked>
            <label for="c_news">
              <strong>Comunicazioni e Notiziario:</strong>
              Desidero ricevere comunicazioni relative a orari, prove, saggi ed eventi culturali dell'associazione via email o WhatsApp.
            </label>
          </div>
          <div class="actions">
            <button type="button" class="btn btn-prev" onclick="goToStep(4)">&larr; Indietro</button>
            <button type="submit" class="btn btn-submit">Invia Domanda di Ammissione e Iscrizione &check;</button>
          </div>
        </div>
      </form>
    </div>
  </div>

  <footer>
    <p><strong>Cervelli in Affitto APS</strong> &bull; Associazione di Promozione Sociale Teatrale</p>
    <p style="margin-top:4px;">C.F. 91456950371 &bull; Affiliata UILT &bull; Dominio: cervellinaffitto-aps.it</p>
  </footer>

  <script>
    let currentStep = 1;
    let delegaCount = 1;

    function goToStep(step) {
      if (step > currentStep) {
        const currentPane = document.getElementById('step-' + currentStep);
        const inputs = currentPane.querySelectorAll('input[required], select[required]');
        for (let input of inputs) {
          if (!input.checkValidity()) {
            input.reportValidity();
            return;
          }
        }
      }
      for (let i = 1; i <= 5; i++) {
        const pane = document.getElementById('step-' + i);
        const badge = document.getElementById('badge-step-' + i);
        if (pane) pane.classList.remove('active');
        if (badge) {
          badge.classList.remove('active');
          if (i < step) badge.classList.add('completed');
          else badge.classList.remove('completed');
        }
      }
      const targetPane = document.getElementById('step-' + step);
      const targetBadge = document.getElementById('badge-step-' + step);
      if (targetPane) targetPane.classList.add('active');
      if (targetBadge) {
        targetBadge.classList.remove('completed');
        targetBadge.classList.add('active');
      }
      currentStep = step;
      window.scrollTo({ top: 100, behavior: 'smooth' });
    }

    function addDelegaRow() {
      if (delegaCount >= 5) {
        alert("È possibile inserire fino a un massimo di 5 persone delegate.");
        return;
      }
      delegaCount++;
      const box = document.getElementById('delegheBox');
      const div = document.createElement('div');
      div.className = 'delega-row';
      div.id = 'delega-' + delegaCount;
      div.innerHTML = \`
        <div class="delega-row-header">
          <span>Persona Delegata \${delegaCount}</span>
          <button type="button" class="btn-remove-delega" onclick="removeDelegaRow('\${div.id}')">Rimuovi</button>
        </div>
        <div class="grid">
          <div class="form-group">
            <label>Nome Delegato</label>
            <input type="text" name="delega_nome[]" placeholder="Es. Anna">
          </div>
          <div class="form-group">
            <label>Cognome Delegato</label>
            <input type="text" name="delega_cognome[]" placeholder="Es. Bianchi">
          </div>
        </div>
        <div class="grid">
          <div class="form-group">
            <label>Telefono</label>
            <input type="tel" name="delega_telefono[]" placeholder="Es. 347 1122334">
          </div>
          <div class="form-group">
            <label>Relazione</label>
            <input type="text" name="delega_relazione[]" placeholder="Es. Nonna">
          </div>
        </div>
      \`;
      box.appendChild(div);
    }

    function removeDelegaRow(id) {
      const el = document.getElementById(id);
      if (el) el.remove();
      delegaCount--;
    }
  </script>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderSuccessPage(minore, email) {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Iscrizione Ricevuta | Cervelli in Affitto APS</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700;800&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #F4F4F5;
      padding: 30px 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 90vh;
    }
    .box {
      max-width: 540px;
      background: #FFFFFF;
      border-radius: 16px;
      border: 1px solid #E4E4E7;
      padding: 36px 28px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0,0,0,0.06);
    }
    .icon {
      width: 64px;
      height: 64px;
      background: #ECFDF5;
      color: #059669;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      margin: 0 auto 20px auto;
    }
    h1 { font-size: 22px; font-weight: 800; color: #18181B; margin-bottom: 8px; }
    p { font-size: 14px; color: #52525B; line-height: 1.6; margin-bottom: 16px; }
    .highlight {
      background: #FDF2F4;
      border-left: 4px solid #D98295;
      padding: 12px;
      border-radius: 6px;
      font-size: 13px;
      color: #831843;
      text-align: left;
      margin-bottom: 24px;
    }
    .btn {
      display: inline-block;
      background: #121214;
      color: #FFFFFF;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 700;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">&check;</div>
    <h1>Richiesta Inviata con Successo!</h1>
    <p>Abbiamo registrato la domanda di ammissione e l'iscrizione di <strong>${minore}</strong>.</p>
    <div class="highlight">
      La richiesta è ora registrata nel gestionale dell'associazione in attesa della ratifica da parte del Consiglio Direttivo con l'assegnazione del Numero Tessera e della copertura assicurativa UILT.
    </div>
    <a href="/" class="btn">Torna alla Pagina Principale</a>
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
