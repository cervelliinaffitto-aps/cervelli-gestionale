/**
 * Cervelli in Affitto APS - Piattaforma Gestionale
 * - Portale Pubblico: Modulo Iscrizione Corsi Minori & Domanda Socio (Wizard a 5 step)
 * - Area Riservata (/admin): Setup Super Admin, Login con Sessioni D1, Dashboard e Delibera CD
 * Affiliato UILT - Unione Italiana Libero Teatro
 */

const DEFAULT_CORSO_ID = "corso-teatro-ragazzi-2026";
const COOKIE_NAME = "cervelli_admin_session";
const PBKDF2_SALT = "cervelli-aps-security-salt-2026";

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

    // 2. Rotte Area Riservata Amministrativa (/admin*)
    if (url.pathname.startsWith("/admin")) {
      return handleAdminRoutes(request, env, url);
    }

    // Assicura l'esistenza del corso predefinito in D1
    await seedDefaultCourseIfNeeded(env);

    // 3. Ricezione modulo pubblico iscrizioni (POST)
    if (request.method === "POST" && (url.pathname === "/iscrizione-minori" || url.pathname === "/")) {
      return handleIscrizionePost(request, env, ctx);
    }

    // 4. Pagina di conferma avvenuta iscrizione
    if (url.pathname === "/iscrizione-confermata") {
      const nomeMinore = url.searchParams.get("minore") || "allievo/a";
      const email = url.searchParams.get("email") || "";
      return renderSuccessPage(nomeMinore, email);
    }

    // 5. Portale pubblico: Wizard iscrizione
    const corsi = await getCorsiAttivi(env);
    return renderFormPage(corsi);
  }
};

/* =========================================================================
   ROUTER E GESTIONE AREA AMMINISTRATIVA (/admin)
   ========================================================================= */

async function handleAdminRoutes(request, env, url) {
  // A. Controllo esistenza Super Admin
  const checkAdmin = await env.DB.prepare("SELECT COUNT(*) as tot FROM utenti_gestionale").first();
  const hasSuperAdmin = checkAdmin && checkAdmin.tot > 0;

  // B. PRIMO AVVIO: se non esiste alcun admin nel database
  if (!hasSuperAdmin) {
    if (request.method === "POST" && url.pathname === "/admin/setup") {
      return handleSetupAdminPost(request, env);
    }
    return renderSetupAdminPage();
  }

  // C. LOGIN
  if (url.pathname === "/admin/login") {
    if (request.method === "POST") {
      return handleLoginPost(request, env);
    }
    return renderLoginPage();
  }

  // D. LOGOUT
  if (url.pathname === "/admin/logout") {
    const cookies = parseCookies(request.headers.get("Cookie"));
    const token = cookies[COOKIE_NAME];
    if (token) {
      await env.DB.prepare("DELETE FROM sessioni_admin WHERE token = ?").bind(token).run();
    }
    return new Response(null, {
      status: 303,
      headers: {
        "Location": "/admin/login",
        "Set-Cookie": `${COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax; Secure`
      }
    });
  }

  // E. AUTENTICAZIONE SESSIONE PER ACCEDERE ALLA DASHBOARD
  const utenteLoggato = await getAuthenticatedUser(request, env);
  if (!utenteLoggato) {
    return Response.redirect(`${url.origin}/admin/login`, 303);
  }

  // F. AZIONE: Delibera Domanda Ammissione Socio
  if (request.method === "POST" && url.pathname === "/admin/delibera") {
    const formData = await request.formData();
    const socioId = (formData.get("socio_id") || "").trim();
    const dataDelibera = (formData.get("data_delibera") || "").trim() || new Date().toISOString().slice(0, 10);
    const numeroVerbale = (formData.get("numero_verbale") || "").trim() || "Verbale CD";
    const numeroTessera = (formData.get("numero_tessera_aps") || "").trim();

    if (!socioId || !numeroTessera) {
      return new Response("ID Socio e Numero Tessera APS sono obbligatori.", { status: 400 });
    }

    try {
      await env.DB.prepare(`
        UPDATE soci 
        SET stato_richiesta = 'approvato',
            data_delibera = ?,
            numero_verbale = ?,
            numero_tessera_aps = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).bind(dataDelibera, numeroVerbale, numeroTessera, socioId).run();

      return new Response(null, {
        status: 303,
        headers: { "Location": "/admin?msg=delibera_ok" }
      });
    } catch (e) {
      console.error("Errore salvataggio delibera:", e);
      return new Response(renderErrorPage(`Errore durante il salvataggio della delibera: ${e.message}`), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  // G. VISTA DASHBOARD AMMINISTRATIVA
  return renderAdminDashboard(env, utenteLoggato, url);
}

/* =========================================================================
   FUNZIONI DI SUPPORTO SICUREZZA, PASSWORD E SESSIONI
   ========================================================================= */

async function hashPassword(password, salt = PBKDF2_SALT) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    let [name, ...rest] = cookie.split("=");
    name = name?.trim();
    if (!name) return;
    const value = rest.join("=").trim();
    if (value) list[name] = decodeURIComponent(value);
  });
  return list;
}

async function getAuthenticatedUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  try {
    const session = await env.DB.prepare(`
      SELECT s.token, u.id, u.email, u.nome, u.cognome, u.ruolo 
      FROM sessioni_admin s
      JOIN utenti_gestionale u ON s.utente_id = u.id
      WHERE s.token = ? AND s.expires_at > datetime('now') AND u.attivo = 1
    `).bind(token).first();

    return session || null;
  } catch (err) {
    console.error("Errore verifica sessione:", err);
    return null;
  }
}

async function handleSetupAdminPost(request, env) {
  const formData = await request.formData();
  const nome = (formData.get("nome") || "").trim();
  const cognome = (formData.get("cognome") || "").trim();
  const email = (formData.get("email") || "").trim().toLowerCase();
  const password = (formData.get("password") || "").trim();

  if (!nome || !cognome || !email || password.length < 8) {
    return renderSetupAdminPage("Compila tutti i campi. La password deve contenere almeno 8 caratteri.");
  }

  try {
    const passwordHash = await hashPassword(password);
    const insertRes = await env.DB.prepare(`
      INSERT INTO utenti_gestionale (email, password_hash, nome, cognome, ruolo, attivo)
      VALUES (?, ?, ?, ?, 'super_admin', 1)
    `).bind(email, passwordHash, nome, cognome).run();

    const utenteId = insertRes.meta.last_row_id;
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(`
      INSERT INTO sessioni_admin (token, utente_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(sessionToken, utenteId, expiresAt).run();

    return new Response(null, {
      status: 303,
      headers: {
        "Location": "/admin",
        "Set-Cookie": `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`
      }
    });
  } catch (e) {
    console.error("Errore setup admin:", e);
    return renderSetupAdminPage(`Errore durante la creazione dell'account: ${e.message}`);
  }
}

async function handleLoginPost(request, env) {
  const formData = await request.formData();
  const email = (formData.get("email") || "").trim().toLowerCase();
  const password = (formData.get("password") || "").trim();

  if (!email || !password) {
    return renderLoginPage("Inserisci sia l'email che la password.");
  }

  try {
    const utente = await env.DB.prepare(
      "SELECT id, password_hash, attivo FROM utenti_gestionale WHERE email = ?"
    ).bind(email).first();

    if (!utente || utente.attivo !== 1) {
      return renderLoginPage("Credenziali non valide o utente non attivo.");
    }

    const inputHash = await hashPassword(password);
    if (inputHash !== utente.password_hash) {
      return renderLoginPage("Credenziali non valide.");
    }

    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await env.DB.prepare(`
      INSERT INTO sessioni_admin (token, utente_id, expires_at)
      VALUES (?, ?, ?)
    `).bind(sessionToken, utente.id, expiresAt).run();

    await env.DB.prepare(
      "UPDATE utenti_gestionale SET ultimo_accesso = datetime('now') WHERE id = ?"
    ).bind(utente.id).run();

    return new Response(null, {
      status: 303,
      headers: {
        "Location": "/admin",
        "Set-Cookie": `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`
      }
    });
  } catch (e) {
    console.error("Errore login admin:", e);
    return renderLoginPage(`Errore di sistema: ${e.message}`);
  }
}

/* =========================================================================
   CARICAMENTO DATI E VISTE HTML AREA AMMINISTRATIVA
   ========================================================================= */

async function renderAdminDashboard(env, utente, url) {
  let domande = [];
  try {
    const { results } = await env.DB.prepare(`
      SELECT 
        s.id as socio_id,
        s.nome as minore_nome,
        s.cognome as minore_cognome,
        s.codice_fiscale as minore_cf,
        s.data_nascita as minore_nascita,
        s.luogo_nascita as minore_luogo,
        s.residenza_indirizzo,
        s.stato_richiesta,
        s.data_domanda,
        s.data_delibera,
        s.numero_verbale,
        s.numero_tessera_aps,
        t.nome as tutore_nome,
        t.cognome as tutore_cognome,
        t.codice_fiscale as tutore_cf,
        t.telefono as tutore_telefono,
        t.email as tutore_email,
        t.grado_parentela,
        ae.titolo as corso_titolo
      FROM soci s
      LEFT JOIN tutori t ON s.tutore_id = t.id
      LEFT JOIN iscrizioni_corsi ic ON ic.socio_id = s.id
      LEFT JOIN attivita_eventi ae ON ic.attivita_id = ae.id
      WHERE s.is_minore = 1
      ORDER BY s.created_at DESC
    `).all();
    domande = results || [];
  } catch (e) {
    console.error("Errore caricamento domande:", e);
  }

  let deleghe = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT socio_minore_id, nome, cognome, telefono, relazione FROM deleghe_ritiro"
    ).all();
    deleghe = results || [];
  } catch (e) {
    console.warn("Nessuna delega o errore query:", e);
  }

  let consensi = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT socio_id, accettazione_statuto, consenso_trattamento_dati, consenso_foto_video, consenso_newsletter FROM consensi_privacy"
    ).all();
    consensi = results || [];
  } catch (e) {
    console.warn("Nessun consenso o errore query:", e);
  }

  const delegheMap = {};
  deleghe.forEach((d) => {
    if (!delegheMap[d.socio_minore_id]) delegheMap[d.socio_minore_id] = [];
    delegheMap[d.socio_minore_id].push(`${d.nome} ${d.cognome} (${d.relazione || "Delegato"} - Tel. ${d.telefono || "N.D."})`);
  });

  const consensiMap = {};
  consensi.forEach((c) => {
    consensiMap[c.socio_id] = c;
  });

  const totDomande = domande.length;
  const inAttesa = domande.filter((d) => d.stato_richiesta === "in_attesa").length;
  const approvate = domande.filter((d) => d.stato_richiesta === "approvato").length;

  const msgParam = url.searchParams.get("msg");
  let msgNotifica = "";
  if (msgParam === "delibera_ok") {
    msgNotifica = `<div class="alert-success">Delibera Consiglio Direttivo salvata con successo! Il socio &egrave; ora tesserato.</div>`;
  }

  const righeDomande = domande.length === 0
    ? `<tr><td colspan="7" style="text-align: center; padding: 32px; color: #71717A;">Nessuna domanda ricevuta al momento.</td></tr>`
    : domande.map((d) => {
        const dList = delegheMap[d.socio_id] || [];
        const delegheText = dList.length > 0
          ? dList.map((x) => `<span class="tag-delegato">${x}</span>`).join("<br>")
          : `<span style="color: #9CA3AF; font-size: 11px;">Nessuna delega</span>`;

        const cons = consensiMap[d.socio_id];
        const fotoVideoTag = cons && cons.consenso_foto_video === 1
          ? `<span class="badge-pill bg-green">Foto/Video: SI</span>`
          : `<span class="badge-pill bg-gray">Foto/Video: NO</span>`;

        const isApprovata = d.stato_richiesta === "approvato";
        const badgeStato = isApprovata
          ? `<span class="badge-pill bg-green">Socio Approvato</span>`
          : `<span class="badge-pill bg-amber">In Attesa Delibera</span>`;

        const moduloAzione = isApprovata
          ? `<div class="delibera-info">
               <div>Data: <strong>${d.data_delibera || "N.D."}</strong></div>
               <div>Verbale: <strong>${d.numero_verbale || "N.D."}</strong></div>
               <div>Tessera APS: <strong class="tessera-highlight">#${d.numero_tessera_aps || "N.D."}</strong></div>
             </div>`
          : `<form method="POST" action="/admin/delibera" class="form-delibera">
               <input type="hidden" name="socio_id" value="${d.socio_id}">
               <div class="form-row">
                 <label>Data Delibera:
                   <input type="date" name="data_delibera" value="${new Date().toISOString().slice(0, 10)}" required>
                 </label>
                 <label>Verbale N°:
                   <input type="text" name="numero_verbale" placeholder="Es. 04/2026" required>
                 </label>
               </div>
               <div class="form-row">
                 <label>N° Tessera APS:
                   <input type="text" name="numero_tessera_aps" placeholder="Es. 2026-042" required>
                 </label>
                 <button type="submit" class="btn-approva">Approva & Tessereggia</button>
               </div>
             </form>`;

        return `
          <tr>
            <td>
              <strong>${d.minore_nome} ${d.minore_cognome}</strong><br>
              <span class="text-sub">CF: ${d.minore_cf}</span><br>
              <span class="text-sub">Nascita: ${d.minore_nascita || "N.D."} (${d.minore_luogo || "N.D."})</span>
            </td>
            <td>
              <strong>${d.tutore_nome || "N.D."} ${d.tutore_cognome || ""}</strong> (${d.grado_parentela || "Genitore"})<br>
              <span class="text-sub">CF: ${d.tutore_cf || "N.D."}</span><br>
              <span class="text-sub">Tel: ${d.tutore_telefono || "N.D."}</span><br>
              <span class="text-sub">Email: ${d.tutore_email || "N.D."}</span>
            </td>
            <td>
              <strong>${d.corso_titolo || "Laboratorio Teatrale"}</strong><br>
              <span class="text-sub">Data domanda: ${d.data_domanda ? d.data_domanda.slice(0, 10) : "Oggi"}</span>
            </td>
            <td>${delegheText}</td>
            <td>
              <span class="badge-pill bg-green">Statuto: SI</span>
              <span class="badge-pill bg-green">Privacy: SI</span><br>
              ${fotoVideoTag}
            </td>
            <td>${badgeStato}</td>
            <td>${moduloAzione}</td>
          </tr>
        `;
      }).join("");

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard Amministrativa | Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
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
    }
    header {
      background: var(--bg-dark);
      color: #fff;
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--brand-rose);
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .header-brand h1 {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: var(--silver);
    }
    .header-brand h1 span { color: var(--brand-rose); }
    .badge-role {
      background: rgba(217, 130, 149, 0.2);
      color: var(--brand-rose);
      border: 1px solid var(--brand-rose);
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .header-user {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 13px;
    }
    .btn-logout {
      background: #27272A;
      color: #fff;
      text-decoration: none;
      padding: 6px 14px;
      border-radius: 6px;
      font-weight: 600;
      font-size: 12px;
      transition: background 0.2s;
    }
    .btn-logout:hover { background: #3F3F46; }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px 20px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      background: #fff;
      padding: 20px;
      border-radius: 12px;
      border: 1px solid var(--border-light);
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }
    .stat-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .stat-number {
      font-size: 28px;
      font-weight: 800;
      color: var(--text-dark);
    }
    .stat-card.alert-card .stat-number { color: #B45309; }
    .stat-card.success-card .stat-number { color: #15803D; }
    .alert-success {
      background: #ECFDF5;
      color: #065F46;
      border: 1px solid #A7F3D0;
      padding: 12px 16px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
      font-weight: 600;
    }
    .table-card {
      background: #fff;
      border-radius: 12px;
      border: 1px solid var(--border-light);
      overflow: hidden;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }
    .table-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border-light);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #FAFAFA;
    }
    .table-header h2 {
      font-size: 16px;
      font-weight: 800;
      color: var(--text-dark);
    }
    .table-wrapper {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      background: #F4F4F5;
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border-light);
    }
    td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-light);
      vertical-align: top;
      color: #374151;
    }
    tr:hover td { background: #FAFAFA; }
    .text-sub {
      font-size: 11px;
      color: var(--text-muted);
    }
    .badge-pill {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 999px;
      margin-bottom: 3px;
    }
    .bg-green { background: #DCFCE7; color: #166534; }
    .bg-amber { background: #FEF3C7; color: #92400E; }
    .bg-gray { background: #F3F4F6; color: #4B5563; }
    .tag-delegato {
      display: inline-block;
      background: #EFF6FF;
      color: #1E40AF;
      border: 1px solid #BFDBFE;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      margin-bottom: 4px;
    }
    .form-delibera {
      background: #F9FAFB;
      border: 1px solid #E5E7EB;
      padding: 10px;
      border-radius: 8px;
    }
    .form-row {
      display: flex;
      gap: 8px;
      margin-bottom: 6px;
    }
    .form-row:last-child { margin-bottom: 0; }
    .form-row label {
      font-size: 10px;
      font-weight: 700;
      color: #4B5563;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .form-row input {
      padding: 5px 8px;
      border: 1px solid #D1D5DB;
      border-radius: 4px;
      font-size: 12px;
      font-family: inherit;
    }
    .btn-approva {
      background: var(--brand-rose);
      color: #fff;
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 11px;
      cursor: pointer;
      align-self: flex-end;
      transition: background 0.2s;
    }
    .btn-approva:hover { background: var(--brand-rose-dark); }
    .delibera-info {
      font-size: 12px;
      line-height: 1.5;
      color: #374151;
    }
    .tessera-highlight {
      font-weight: 800;
      color: #15803D;
      background: #DCFCE7;
      padding: 2px 6px;
      border-radius: 4px;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-brand">
      <h1>Cervelli in Affitto <span>APS</span></h1>
      <span class="badge-role">Super Admin</span>
    </div>
    <div class="header-user">
      <span>Connesso: <strong>${utente.nome} ${utente.cognome}</strong> (${utente.email})</span>
      <a href="/admin/logout" class="btn-logout">Disconnetti</a>
    </div>
  </header>

  <div class="container">
    ${msgNotifica}

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-title">Domande Ricevute</div>
        <div class="stat-number">${totDomande}</div>
      </div>
      <div class="stat-card alert-card">
        <div class="stat-title">In Attesa di Delibera CD</div>
        <div class="stat-number">${inAttesa}</div>
      </div>
      <div class="stat-card success-card">
        <div class="stat-title">Soci Approvati & Tesserati</div>
        <div class="stat-number">${approvate}</div>
      </div>
    </div>

    <div class="table-card">
      <div class="table-header">
        <h2>Libro Soci &bull; Domande di Ammissione e Iscrizioni Minori</h2>
        <span style="font-size: 12px; color: #71717A;">Affiliazione UILT &bull; Flusso Delibere CD</span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Allievo Minore</th>
              <th>Genitore / Tutore</th>
              <th>Corso Selezionato</th>
              <th>Deleghe al Ritiro</th>
              <th>Consensi Privacy</th>
              <th>Stato Domanda</th>
              <th>Azione Delibera Consiglio Direttivo</th>
            </tr>
          </thead>
          <tbody>
            ${righeDomande}
          </tbody>
        </table>
      </div>
    </div>
  </div>
</body>
</html>`;

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderSetupAdminPage(errore = "") {
  const errHtml = errore ? `<div class="error-msg">${errore}</div>` : "";
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Primo Avvio: Configurazione Super Admin | Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #121214;
      color: #E8E7E9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: #1C1C1F;
      border: 1px solid #2E2E33;
      border-radius: 16px;
      padding: 36px 32px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-block;
      background: rgba(217, 130, 149, 0.15);
      color: #D98295;
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    h1 { font-size: 22px; font-weight: 800; color: #fff; margin-bottom: 8px; }
    p { font-size: 13px; color: #9CA3AF; line-height: 1.5; margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    .row { display: flex; gap: 12px; }
    .row .form-group { flex: 1; }
    label { display: block; font-size: 12px; font-weight: 700; color: #D1D5DB; margin-bottom: 6px; }
    input {
      width: 100%;
      padding: 12px 14px;
      background: #27272A;
      border: 1px solid #3F3F46;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-family: inherit;
    }
    input:focus { outline: none; border-color: #D98295; }
    .btn-submit {
      width: 100%;
      background: #D98295;
      color: #fff;
      border: none;
      padding: 13px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 14px;
      cursor: pointer;
      margin-top: 10px;
      transition: background 0.2s;
    }
    .btn-submit:hover { background: #9F5D6B; }
    .error-msg {
      background: #7F1D1D;
      color: #FCA5A5;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 16px;
    }
    .info-footer {
      text-align: center;
      margin-top: 24px;
      font-size: 11px;
      color: #71717A;
    }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Inizializzazione Sistema</span>
    <h1>Benvenuto, Super Admin</h1>
    <p>Crea il profilo principale per accedere alla gestione di <strong>Cervelli in Affitto APS</strong>. Questo passaggio comparir&agrave; una sola volta.</p>
    ${errHtml}
    <form method="POST" action="/admin/setup">
      <div class="row">
        <div class="form-group">
          <label>Nome *</label>
          <input type="text" name="nome" placeholder="Es. Giacomo" required>
        </div>
        <div class="form-group">
          <label>Cognome *</label>
          <input type="text" name="cognome" placeholder="Es. Garofani" required>
        </div>
      </div>
      <div class="form-group">
        <label>Email Super Admin *</label>
        <input type="email" name="email" placeholder="latua@email.it" required>
      </div>
      <div class="form-group">
        <label>Password Personale (almeno 8 caratteri) *</label>
        <input type="password" name="password" minlength="8" required>
      </div>
      <button type="submit" class="btn-submit">Attiva Account Super Admin &amp; Accedi</button>
    </form>
    <div class="info-footer">
      Gestionale Cervelli in Affitto APS &bull; Affiliato UILT
    </div>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderLoginPage(errore = "") {
  const errHtml = errore ? `<div class="error-msg">${errore}</div>` : "";
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Accesso Gestionale | Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #121214;
      color: #E8E7E9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 20px;
    }
    .card {
      background: #1C1C1F;
      border: 1px solid #2E2E33;
      border-radius: 16px;
      padding: 36px 32px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
    h1 { font-size: 20px; font-weight: 800; color: #fff; margin-bottom: 4px; }
    h1 span { color: #D98295; }
    p { font-size: 13px; color: #9CA3AF; margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 12px; font-weight: 700; color: #D1D5DB; margin-bottom: 6px; }
    input {
      width: 100%;
      padding: 12px 14px;
      background: #27272A;
      border: 1px solid #3F3F46;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-family: inherit;
    }
    input:focus { outline: none; border-color: #D98295; }
    .btn-submit {
      width: 100%;
      background: #D98295;
      color: #fff;
      border: none;
      padding: 13px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 14px;
      cursor: pointer;
      margin-top: 10px;
      transition: background 0.2s;
    }
    .btn-submit:hover { background: #9F5D6B; }
    .error-msg {
      background: #7F1D1D;
      color: #FCA5A5;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 16px;
    }
    .back-link {
      display: block;
      text-align: center;
      margin-top: 20px;
      font-size: 12px;
      color: #71717A;
      text-decoration: none;
    }
    .back-link:hover { color: #D98295; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Cervelli in Affitto <span>APS</span></h1>
    <p>Accedi all'area riservata gestionale</p>
    ${errHtml}
    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label>Email *</label>
        <input type="email" name="email" placeholder="latua@email.it" required>
      </div>
      <div class="form-group">
        <label>Password *</label>
        <input type="password" name="password" required>
      </div>
      <button type="submit" class="btn-submit">Accedi al Gestionale</button>
    </form>
    <a href="/" class="back-link">&larr; Torna al portale pubblico</a>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* =========================================================================
   GESTIONE DEI CORSI IN DATABASE
   ========================================================================= */

async function seedDefaultCourseIfNeeded(env) {
  try {
    await env.DB.prepare(`
      INSERT OR IGNORE INTO attivita_eventi (id, titolo, tipo, descrizione, luogo, quota_o_prezzo, capienza_massima, stato)
      VALUES (
        ?,
        'Laboratorio Teatrale Bambini e Ragazzi',
        'corso_teatro_minori',
        'Laboratorio propedeutico di teatro per bambini e ragazzi con saggio finale.',
        'Sede Operativa APS / Teatro',
        250.00,
        25,
        'aperto'
      )
    `).bind(DEFAULT_CORSO_ID).run();
  } catch (err) {
    console.warn("Avviso seed corso predefinito:", err);
  }
}

async function getCorsiAttivi(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT id, titolo, descrizione, quota_o_prezzo, capienza_massima FROM attivita_eventi WHERE tipo = 'corso_teatro_minori' AND stato = 'aperto'"
    ).all();
    if (results && results.length > 0) return results;
  } catch (err) {
    console.warn("Impossibile recuperare corsi da D1:", err);
  }
  return [{
    id: DEFAULT_CORSO_ID,
    titolo: "Laboratorio Teatrale Bambini e Ragazzi",
    descrizione: "Percorso ludico ed espressivo di teatro per la crescita e la fiducia in se stessi.",
    quota_o_prezzo: 250.00
  }];
}

/* =========================================================================
   RICEZIONE ED ELABORAZIONE ISCRIZIONE PUBBLICA (POST)
   ========================================================================= */

async function handleIscrizionePost(request, env, ctx) {
  const url = new URL(request.url);

  try {
    const formData = await request.formData();

    // 1. Dati Genitore / Tutore
    const gNome = (formData.get("genitore_nome") || "").trim();
    const gCognome = (formData.get("genitore_cognome") || "").trim();
    const gCf = (formData.get("genitore_cf") || "").trim().toUpperCase();
    const gTelefono = (formData.get("genitore_telefono") || "").trim();
    const gEmail = (formData.get("genitore_email") || "").trim().toLowerCase();
    const gRuolo = (formData.get("genitore_ruolo") || "genitore").trim();
    const gIndirizzo = (formData.get("genitore_indirizzo") || "").trim();
    const gCitta = (formData.get("genitore_citta") || "").trim();
    const gCap = (formData.get("genitore_cap") || "").trim();
    const gProvincia = (formData.get("genitore_provincia") || "").trim().toUpperCase();

    // 2. Dati Minore (Allievo/a)
    const mNome = (formData.get("minore_nome") || "").trim();
    const mCognome = (formData.get("minore_cognome") || "").trim();
    const mCf = (formData.get("minore_cf") || "").trim().toUpperCase();
    const mDataNascita = (formData.get("minore_data_nascita") || "").trim();
    const mLuogoNascita = (formData.get("minore_luogo_nascita") || "").trim();
    const mIndirizzo = (formData.get("minore_indirizzo") || "").trim();
    const mNote = (formData.get("minore_note") || "").trim();

    // 3. Corso selezionato
    const corsoId = (formData.get("corso_id") || DEFAULT_CORSO_ID).trim();

    // 4. Consensi Privacy e Statuto
    const consStatuto = formData.get("consenso_statuto") ? 1 : 0;
    const consPrivacy = formData.get("consenso_privacy") ? 1 : 0;
    const consFoto = formData.get("consenso_foto") ? 1 : 0;
    const consNews = formData.get("consenso_news") ? 1 : 0;

    if (!consStatuto || !consPrivacy) {
      return new Response(
        renderErrorPage("L'accettazione dello Statuto APS e il Consenso Privacy sono obbligatori per legge."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    if (!gNome || !gCognome || !gCf || !gTelefono || !gEmail || !mNome || !mCognome || !mCf) {
      return new Response(
        renderErrorPage("I campi anagrafici e di contatto contrassegnati con l'asterisco (*) sono obbligatori."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    // 5. Inserimento Tutore (o recupero esistente)
    let tutoreId = null;
    const existingTutore = await env.DB.prepare(
      "SELECT id FROM tutori WHERE codice_fiscale = ?"
    ).bind(gCf).first();

    if (existingTutore) {
      tutoreId = existingTutore.id;
      await env.DB.prepare(`
        UPDATE tutori SET telefono = ?, email = ? WHERE id = ?
      `).bind(gTelefono, gEmail, tutoreId).run();
    } else {
      tutoreId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO tutori (id, nome, cognome, codice_fiscale, telefono, email, grado_parentela, residenza_indirizzo, residenza_citta, residenza_cap, residenza_provincia)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(tutoreId, gNome, gCognome, gCf, gTelefono, gEmail, gRuolo, gIndirizzo || "N.D.", gCitta || "N.D.", gCap || "00000", gProvincia || "XX").run();
    }

    // 6. Inserimento Socio Minore
    let socioId = null;
    const existingSocio = await env.DB.prepare(
      "SELECT id FROM soci WHERE codice_fiscale = ?"
    ).bind(mCf).first();

    if (existingSocio) {
      socioId = existingSocio.id;
    } else {
      socioId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO soci (
          id, is_minore, tutore_id, nome, cognome, codice_fiscale, data_nascita, luogo_nascita,
          residenza_indirizzo, residenza_citta, residenza_cap, residenza_provincia, tipologia_socio, stato_richiesta
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ordinario', 'in_attesa')
      `).bind(
        socioId, tutoreId, mNome, mCognome, mCf, mDataNascita || "2015-01-01", mLuogoNascita || "N.D.",
        mIndirizzo || gIndirizzo || "N.D.", gCitta || "N.D.", gCap || "00000", gProvincia || "XX"
      ).run();
    }

    // 7. Iscrizione al Corso & Deleghe
    const iscrizioneId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO iscrizioni_corsi (id, attivita_id, socio_id, note_allievo, stato_iscrizione)
      VALUES (?, ?, ?, ?, 'confermata')
    `).bind(iscrizioneId, corsoId, socioId, mNote).run();

    // Inserimento eventuale delega 1
    const del1Nome = (formData.get("delega_1_nome") || "").trim();
    const del1Cognome = (formData.get("delega_1_cognome") || "").trim();
    const del1Tel = (formData.get("delega_1_telefono") || "").trim();
    const del1Grado = (formData.get("delega_1_relazione") || "").trim();

    if (del1Nome && del1Cognome) {
      await env.DB.prepare(`
        INSERT INTO deleghe_ritiro (id, iscrizione_id, socio_minore_id, nome, cognome, telefono, relazione)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), iscrizioneId, socioId, del1Nome, del1Cognome, del1Tel, del1Grado).run();
    }

    // Inserimento consensi privacy
    await env.DB.prepare(`
      INSERT INTO consensi_privacy (id, socio_id, tutore_id, accettazione_statuto, consenso_trattamento_dati, consenso_foto_video, consenso_newsletter)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(crypto.randomUUID(), socioId, tutoreId, consStatuto, consPrivacy, consFoto, consNews).run();

    // 8. Invio email asincrono tramite Resend
    if (env.RESEND_API_KEY) {
      const emailPromise = sendConfirmationEmails(env.RESEND_API_KEY, {
        genitoreEmail: gEmail,
        genitoreNome: gNome,
        minoreNome: mNome
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
      renderErrorPage(`Si &egrave; verificato un errore durante il salvataggio: ${err.message}. Ti invitiamo a riprovare o contattare l'associazione.`),
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
                  <strong>Prossimi passi:</strong> La domanda sar&agrave; ratificata dal Consiglio Direttivo con l'assegnazione del Numero Tessera APS e la copertura assicurativa UILT.
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
  const opzioniCorsi = corsi.map((c) => `
    <label class="radio-card">
      <input type="radio" name="corso_id" value="${c.id}" checked required>
      <div class="radio-body">
        <div class="radio-title">${c.titolo}</div>
        <div class="radio-desc">${c.descrizione || ""}</div>
        <div class="radio-price">&euro; ${c.quota_o_prezzo ? Number(c.quota_o_prezzo).toFixed(2) : "0.00"} (inclusa assicurazione UILT)</div>
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
      color: #FFFFFF;
      padding: 24px 20px;
      text-align: center;
      border-bottom: 2px solid var(--brand-rose);
    }
    .badge-uilt {
      display: inline-block;
      background: rgba(232, 231, 233, 0.1);
      color: var(--silver);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      padding: 4px 12px;
      border-radius: 999px;
      border: 1px solid rgba(232, 231, 233, 0.2);
      margin-bottom: 10px;
    }
    header h1 {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: var(--silver);
    }
    header h1 span { color: var(--brand-rose); }
    header p {
      color: #A1A1AA;
      font-size: 13px;
      margin-top: 4px;
    }
    .container {
      max-width: 680px;
      width: 100%;
      margin: 0 auto;
      padding: 24px 16px 48px 16px;
      flex: 1;
    }
    .stepper {
      display: flex;
      justify-content: space-between;
      margin-bottom: 24px;
      background: #FFFFFF;
      padding: 12px 16px;
      border-radius: 12px;
      border: 1px solid var(--border-light);
    }
    .step-item {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
    }
    .step-item.active {
      color: var(--text-dark);
      font-weight: 800;
    }
    .step-num {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--bg-light);
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
    }
    .step-item.active .step-num {
      background: var(--brand-rose);
      color: #FFFFFF;
    }
    .step-item.completed .step-num {
      background: var(--success);
      color: #FFFFFF;
    }
    .form-step {
      display: none;
      background: #FFFFFF;
      padding: 24px;
      border-radius: 16px;
      border: 1px solid var(--border-light);
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.04);
    }
    .form-step.active {
      display: block;
      animation: fadeIn 0.2s ease-in-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(4px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .step-title {
      font-size: 18px;
      font-weight: 800;
      color: var(--text-dark);
      margin-bottom: 6px;
    }
    .step-desc {
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 20px;
    }
    .form-grid {
      display: grid;
      gap: 16px;
      margin-bottom: 16px;
    }
    .two-cols {
      grid-template-columns: 1fr 1fr;
    }
    @media (max-width: 600px) {
      .two-cols { grid-template-columns: 1fr; }
      .step-item span.step-label { display: none; }
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 12px;
      font-weight: 700;
      color: #374151;
    }
    input[type="text"], input[type="email"], input[type="tel"], input[type="date"], select, textarea {
      padding: 10px 14px;
      border: 1px solid var(--border-light);
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      color: var(--text-dark);
      background: #FFFFFF;
      transition: border-color 0.15s;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--brand-rose);
      box-shadow: 0 0 0 3px rgba(217, 130, 149, 0.15);
    }
    .radio-card {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 14px;
      border: 2px solid var(--border-light);
      border-radius: 10px;
      cursor: pointer;
      margin-bottom: 10px;
      transition: all 0.15s;
    }
    .radio-card:hover {
      border-color: #CBD5E1;
      background: #F8FAFC;
    }
    .radio-card input {
      margin-top: 4px;
      accent-color: var(--brand-rose);
    }
    .radio-title {
      font-weight: 800;
      font-size: 14px;
      color: var(--text-dark);
    }
    .radio-desc {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }
    .radio-price {
      font-size: 13px;
      font-weight: 700;
      color: var(--brand-rose-dark);
      margin-top: 6px;
    }
    .checkbox-block {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      padding: 12px;
      background: #F9FAFB;
      border-radius: 8px;
      border: 1px solid var(--border-light);
      margin-bottom: 12px;
    }
    .checkbox-block input {
      margin-top: 3px;
      accent-color: var(--brand-rose);
      width: 16px;
      height: 16px;
    }
    .checkbox-text {
      font-size: 12px;
      color: #4B5563;
      line-height: 1.4;
    }
    .wizard-nav {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--border-light);
    }
    .btn-step {
      padding: 12px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }
    .btn-prev {
      background: #F3F4F6;
      color: #4B5563;
    }
    .btn-prev:hover { background: #E5E7EB; }
    .btn-next {
      background: var(--bg-dark);
      color: #FFFFFF;
      margin-left: auto;
    }
    .btn-next:hover { background: #27272A; }
    .btn-submit {
      background: var(--brand-rose);
      color: #FFFFFF;
      margin-left: auto;
    }
    .btn-submit:hover { background: var(--brand-rose-dark); }
    .info-callout {
      background: var(--brand-rose-light);
      border-left: 4px solid var(--brand-rose);
      padding: 12px 14px;
      border-radius: 6px;
      font-size: 12px;
      color: #831843;
      margin-bottom: 16px;
      line-height: 1.4;
    }
    footer {
      text-align: center;
      padding: 20px;
      font-size: 11px;
      color: var(--text-muted);
      border-top: 1px solid var(--border-light);
      background: #FFFFFF;
    }
    footer a { color: var(--text-muted); text-decoration: underline; }
  </style>
</head>
<body>
  <header>
    <div class="badge-uilt">Affiliato UILT - Libero Teatro</div>
    <h1>Cervelli in Affitto <span>APS</span></h1>
    <p>Domanda di Ammissione a Socio &bull; Iscrizione Laboratorio Bambini e Ragazzi</p>
  </header>

  <div class="container">
    <div class="stepper">
      <div class="step-item active" id="badge-1"><span class="step-num">1</span><span class="step-label">Genitore</span></div>
      <div class="step-item" id="badge-2"><span class="step-num">2</span><span class="step-label">Allievo/a</span></div>
      <div class="step-item" id="badge-3"><span class="step-num">3</span><span class="step-label">Laboratorio</span></div>
      <div class="step-item" id="badge-4"><span class="step-num">4</span><span class="step-label">Deleghe</span></div>
      <div class="step-item" id="badge-5"><span class="step-num">5</span><span class="step-label">Firma & Invio</span></div>
    </div>

    <form id="iscrizioneForm" method="POST" action="/iscrizione-minori">
      <!-- STEP 1: DATI GENITORE -->
      <div class="form-step active" id="step-1">
        <div class="step-title">Passo 1: Dati del Genitore o Tutore Legale</div>
        <div class="step-desc">Inserisci i recapiti dell'adulto referente per l'invio delle comunicazioni e la ricevuta di iscrizione.</div>

        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Nome del Genitore / Tutore *</label>
            <input type="text" name="genitore_nome" placeholder="Es. Mario" required>
          </div>
          <div class="form-group">
            <label>Cognome *</label>
            <input type="text" name="genitore_cognome" placeholder="Es. Rossi" required>
          </div>
        </div>

        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Codice Fiscale *</label>
            <input type="text" name="genitore_cf" maxlength="16" placeholder="Codice Fiscale (16 caratteri)" style="text-transform: uppercase;" required>
          </div>
          <div class="form-group">
            <label>Grado di Parentela *</label>
            <select name="genitore_ruolo" required>
              <option value="genitore" selected>Genitore (Padre / Madre)</option>
              <option value="tutore_legale">Tutore Legale</option>
              <option value="affidatario">Affidatario</option>
            </select>
          </div>
        </div>

        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Telefono Cellulare per Comunicazioni *</label>
            <input type="tel" name="genitore_telefono" placeholder="Es. 3331234567" required>
          </div>
          <div class="form-group">
            <label>Email Ufficiale (per ricevute e comunicazioni) *</label>
            <input type="email" name="genitore_email" placeholder="nome@esempio.it" required>
          </div>
        </div>

        <div class="wizard-nav">
          <button type="button" class="btn-step btn-next" onclick="goToStep(2)">Avanti: Dati Allievo/a &rarr;</button>
        </div>
      </div>

      <!-- STEP 2: DATI ALLIEVO MINORE -->
      <div class="form-step" id="step-2">
        <div class="step-title">Passo 2: Anagrafica dell'Allievo/a (Minore)</div>
        <div class="step-desc">I dati dell'allievo sono necessari per l'attivazione della copertura assicurativa UILT e per il Libro Soci.</div>

        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Nome dell'Allievo/a *</label>
            <input type="text" name="minore_nome" placeholder="Es. Giulia" required>
          </div>
          <div class="form-group">
            <label>Cognome *</label>
            <input type="text" name="minore_cognome" placeholder="Es. Rossi" required>
          </div>
        </div>

        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Codice Fiscale dell'Allievo/a *</label>
            <input type="text" name="minore_cf" maxlength="16" placeholder="Codice Fiscale (16 caratteri)" style="text-transform: uppercase;" required>
          </div>
          <div class="form-group">
            <label>Data di Nascita *</label>
            <input type="date" name="minore_data_nascita" required>
          </div>
        </div>

        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Comune o Stato Estero di Nascita *</label>
            <input type="text" name="minore_luogo_nascita" placeholder="Es. Bologna" required>
          </div>
          <div class="form-group">
            <label>Indirizzo di Residenza Completo</label>
            <input type="text" name="minore_indirizzo" placeholder="Via/Piazza, Civico, Citt&agrave;, CAP">
          </div>
        </div>

        <div class="form-group">
          <label>Eventuali Note o Esigenze Particolari (facoltativo)</label>
          <textarea name="minore_note" rows="2" placeholder="Indicazioni utili per i docenti o note organizzative"></textarea>
        </div>

        <div class="wizard-nav">
          <button type="button" class="btn-step btn-prev" onclick="goToStep(1)">&larr; Indietro</button>
          <button type="button" class="btn-step btn-next" onclick="goToStep(3)">Avanti: Laboratorio &rarr;</button>
        </div>
      </div>

      <!-- STEP 3: SELEZIONE CORSO -->
      <div class="form-step" id="step-3">
        <div class="step-title">Passo 3: Seleziona il Laboratorio Teatrale</div>
        <div class="step-desc">Seleziona il percorso a cui intendi iscrivere l'allievo/a.</div>

        ${opzioniCorsi}

        <div class="info-callout">
          <strong>Nota sull'Assicurazione UILT:</strong> La partecipazione al laboratorio include il tesseramento alla federazione UILT (Unione Italiana Libero Teatro) con relativa copertura infortuni e RC per tutta la durata dell'anno di attivit&agrave;.
        </div>

        <div class="wizard-nav">
          <button type="button" class="btn-step btn-prev" onclick="goToStep(2)">&larr; Indietro</button>
          <button type="button" class="btn-step btn-next" onclick="goToStep(4)">Avanti: Deleghe al Ritiro &rarr;</button>
        </div>
      </div>

      <!-- STEP 4: DELEGHE AL RITIRO -->
      <div class="form-step" id="step-4">
        <div class="step-title">Passo 4: Persone Delegate al Ritiro (Facoltativo)</div>
        <div class="step-desc">Indica eventuali persone autorizzate a ritirare il minore al termine delle lezioni oltre ai genitori (es. nonni, zii, baby sitter).</div>

        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Nome Delegato/a</label>
            <input type="text" name="delega_1_nome" placeholder="Es. Nonna Anna">
          </div>
          <div class="form-group">
            <label>Cognome Delegato/a</label>
            <input type="text" name="delega_1_cognome" placeholder="Es. Bianchi">
          </div>
        </div>

        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Recapito Telefonico Delegato/a</label>
            <input type="tel" name="delega_1_telefono" placeholder="Es. 3471122334">
          </div>
          <div class="form-group">
            <label>Relazione di Parentela / Ruolo</label>
            <input type="text" name="delega_1_relazione" placeholder="Es. Nonna, Zio, Amico di famiglia">
          </div>
        </div>

        <div class="wizard-nav">
          <button type="button" class="btn-step btn-prev" onclick="goToStep(3)">&larr; Indietro</button>
          <button type="button" class="btn-step btn-next" onclick="goToStep(5)">Avanti: Firma & Consensi &rarr;</button>
        </div>
      </div>

      <!-- STEP 5: CONSENSI E INVIO -->
      <div class="form-step" id="step-5">
        <div class="step-title">Passo 5: Domanda di Ammissione Socio & Consensi</div>
        <div class="step-desc">Conferma la richiesta formale di ammissione a socio e i consensi obbligatori per legge.</div>

        <div class="checkbox-block">
          <input type="checkbox" name="consenso_statuto" id="c_statuto" value="1" required>
          <div class="checkbox-text">
            <strong>Richiesta Ammissione a Socio & Statuto APS *</strong><br>
            Dichiaro di aver preso visione e di accettare integralmente lo Statuto dell'associazione "Cervelli in Affitto APS", i regolamenti interni e di condividere le finalit&agrave; associative. Richiedo l'iscrizione a socio ordinario per l'allievo/a minore.
          </div>
        </div>

        <div class="checkbox-block">
          <input type="checkbox" name="consenso_privacy" id="c_privacy" value="1" required>
          <div class="checkbox-text">
            <strong>Informativa Trattamento Dati Personali (GDPR) *</strong><br>
            Acconsento al trattamento dei dati personali forniti per le finalit&agrave; istituzionali, assicurative (UILT) e amministrative dell'APS ai sensi del Regolamento UE 2016/679.
          </div>
        </div>

        <div class="checkbox-block">
          <input type="checkbox" name="consenso_foto" id="c_foto" value="1">
          <div class="checkbox-text">
            <strong>Liberatoria Foto e Riprese Video (Facoltativo)</strong><br>
            Autorizzo l'associazione all'uso non commerciale di foto e riprese video effettuate durante saggi, laboratori o spettacoli per canali social e archivio storico dell'APS.
          </div>
        </div>

        <div class="checkbox-block">
          <input type="checkbox" name="consenso_news" id="c_news" value="1">
          <div class="checkbox-text">
            <strong>Comunicazioni Attivit&agrave; e Spettacoli (Facoltativo)</strong><br>
            Desidero ricevere via email o WhatsApp comunicazioni sugli spettacoli, repliche e nuove iniziative dell'associazione.
          </div>
        </div>

        <div class="wizard-nav">
          <button type="button" class="btn-step btn-prev" onclick="goToStep(4)">&larr; Indietro</button>
          <button type="submit" class="btn-step btn-submit">Invia Domanda Ufficiale & Iscrizione &check;</button>
        </div>
      </div>
    </form>
  </div>

  <footer>
    Cervelli in Affitto APS &bull; CF: 91456950371 &bull; Affiliata UILT<br>
    Sede Legale: Bologna &bull; <a href="/admin">Area Riservata Gestionale</a>
  </footer>

  <script>
    function goToStep(stepNum) {
      if (stepNum > 1) {
        const currentActive = document.querySelector('.form-step.active');
        if (currentActive) {
          const requiredInputs = currentActive.querySelectorAll('input[required], select[required]');
          for (let input of requiredInputs) {
            if (!input.value.trim()) {
              input.focus();
              input.reportValidity();
              return;
            }
          }
        }
      }

      document.querySelectorAll('.form-step').forEach(el => el.classList.remove('active'));
      document.getElementById('step-' + stepNum).classList.add('active');

      for (let i = 1; i <= 5; i++) {
        const b = document.getElementById('badge-' + i);
        if (i < stepNum) {
          b.className = 'step-item completed';
        } else if (i === stepNum) {
          b.className = 'step-item active';
        } else {
          b.className = 'step-item';
        }
      }

      window.scrollTo({ top: 0, behavior: 'smooth' });
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
  <title>Iscrizione Ricevuta con Successo | Cervelli in Affitto APS</title>
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
      La richiesta &egrave; ora registrata nel gestionale dell'associazione in attesa della ratifica da parte del Consiglio Direttivo con l'assegnazione del Numero Tessera e della copertura assicurativa UILT.
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
