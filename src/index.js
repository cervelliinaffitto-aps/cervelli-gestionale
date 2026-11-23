/**
 * Cervelli in Affitto APS - Piattaforma Gestionale
 * - Portale Pubblico: Modulo Iscrizione Corsi Minori & Domanda Socio (Wizard a 5 step)
 * - Area Riservata (/admin): Primo avvio Super Admin, Login, Dashboard e Delibera Domande
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

    // 5. Portale pubblico: Wizard a 5 passaggi
    const corsi = await getCorsiAttivi(env);
    return renderFormPage(corsi);
  }
};

/* =========================================================================
   AREA AMMINISTRATIVA (/admin): SICUREZZA, LOGIN E GESTIONE DELIBERE
   ========================================================================= */

const SALT_PASSWORD = "cervelli-aps-gestionale-2026";

async function hashPassword(password) {
  const enc = new TextEncoder();
  const data = enc.encode(password + ":" + SALT_PASSWORD);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach((cookie) => {
    let [name, ...rest] = cookie.split("=");
    name = name?.trim();
    if (!name) return;
    const value = rest.join("=").trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

async function getAdminUtenteLoggato(request, env) {
  try {
    const cookies = parseCookies(request.headers.get("Cookie"));
    const token = cookies["admin_session"];
    if (!token) return null;

    const sessione = await env.DB.prepare(`
      SELECT s.token, u.id, u.email, u.nome, u.cognome, u.ruolo
      FROM sessioni_admin s
      JOIN utenti_gestionale u ON s.utente_id = u.id
      WHERE s.token = ? AND datetime(s.expires_at) > datetime('now') AND u.attivo = 1
    `).bind(token).first();

    return sessione || null;
  } catch (e) {
    console.error("Errore verifica sessione admin:", e);
    return null;
  }
}

async function handleAdminRoutes(request, env, url) {
  // Verifica se esiste già un utente registrato nel gestionale
  let countUtenti = 0;
  try {
    const res = await env.DB.prepare("SELECT COUNT(*) as cnt FROM utenti_gestionale").first();
    countUtenti = res ? res.cnt : 0;
  } catch (e) {
    console.error("Errore conteggio utenti:", e);
  }

  // A. PRIMO AVVIO (0 utenti) -> Setup Guidato Super Admin
  if (countUtenti === 0) {
    if (request.method === "POST") {
      const formData = await request.formData();
      const nome = (formData.get("nome") || "").trim();
      const cognome = (formData.get("cognome") || "").trim();
      const email = (formData.get("email") || "").trim().toLowerCase();
      const pwd = formData.get("password") || "";
      const pwdConf = formData.get("password_conferma") || "";

      if (!nome || !cognome || !email || !pwd) {
        return renderSetupAdminPage("Tutti i campi sono obbligatori.");
      }
      if (pwd.length < 8) {
        return renderSetupAdminPage("La password deve contenere almeno 8 caratteri.");
      }
      if (pwd !== pwdConf) {
        return renderSetupAdminPage("Le password inserite non coincidono.");
      }

      const pHash = await hashPassword(pwd);
      const insertUser = await env.DB.prepare(`
        INSERT INTO utenti_gestionale (email, password_hash, nome, cognome, ruolo, attivo)
        VALUES (?, ?, ?, ?, 'super_admin', 1)
      `).bind(email, pHash, nome, cognome).run();

      const newUserId = insertUser.meta?.last_row_id || 1;
      const sessionToken = crypto.randomUUID();

      await env.DB.prepare(`
        INSERT INTO sessioni_admin (token, utente_id, expires_at)
        VALUES (?, ?, datetime('now', '+7 days'))
      `).bind(sessionToken, newUserId).run();

      return new Response(null, {
        status: 303,
        headers: {
          "Location": "/admin?benvenuto=1",
          "Set-Cookie": `admin_session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
        }
      });
    }

    return renderSetupAdminPage();
  }

  // B. LOGOUT
  if (url.pathname === "/admin/logout") {
    const cookies = parseCookies(request.headers.get("Cookie"));
    const token = cookies["admin_session"];
    if (token) {
      try {
        await env.DB.prepare("DELETE FROM sessioni_admin WHERE token = ?").bind(token).run();
      } catch (e) {}
    }
    return new Response(null, {
      status: 303,
      headers: {
        "Location": "/admin/login",
        "Set-Cookie": "admin_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"
      }
    });
  }

  // C. LOGIN
  if (url.pathname === "/admin/login") {
    if (request.method === "POST") {
      const formData = await request.formData();
      const email = (formData.get("email") || "").trim().toLowerCase();
      const pwd = formData.get("password") || "";

      const utente = await env.DB.prepare(
        "SELECT id, password_hash, attivo FROM utenti_gestionale WHERE email = ?"
      ).bind(email).first();

      if (!utente || utente.attivo !== 1) {
        return renderLoginAdminPage("Credenziali non valide o utente disabilitato.");
      }

      const pHash = await hashPassword(pwd);
      if (pHash !== utente.password_hash) {
        return renderLoginAdminPage("Credenziali non valide o password errata.");
      }

      const sessionToken = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO sessioni_admin (token, utente_id, expires_at)
        VALUES (?, ?, datetime('now', '+7 days'))
      `).bind(sessionToken, utente.id).run();

      await env.DB.prepare(`
        UPDATE utenti_gestionale SET ultimo_accesso = datetime('now') WHERE id = ?
      `).bind(utente.id).run();

      return new Response(null, {
        status: 303,
        headers: {
          "Location": "/admin",
          "Set-Cookie": `admin_session=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
        }
      });
    }

    return renderLoginAdminPage();
  }

  // D. VERIFICA AUTENTICAZIONE PER TUTTE LE ALTRE ROTTE /admin
  const utenteLoggato = await getAdminUtenteLoggato(request, env);
  if (!utenteLoggato) {
    return new Response(null, {
      status: 303,
      headers: { "Location": "/admin/login" }
    });
  }

  // E. DELIBERA E RATIFICA DOMANDA SOCIO (POST /admin/delibera)
  if (request.method === "POST" && url.pathname === "/admin/delibera") {
    const formData = await request.formData();
    const socioId = (formData.get("socio_id") || "").trim();
    const dataDelibera = (formData.get("data_delibera") || "").trim();
    const numeroVerbale = (formData.get("numero_verbale") || "").trim();
    const numeroTessera = (formData.get("numero_tessera_aps") || "").trim();

    if (!socioId || !numeroTessera) {
      return new Response("ID socio e Numero Tessera APS sono obbligatori.", { status: 400 });
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
      `).bind(dataDelibera || new Date().toISOString().slice(0, 10), numeroVerbale || "Verbale CD", numeroTessera, socioId).run();

      return new Response(null, {
        status: 303,
        headers: { "Location": "/admin?msg=delibera_ok" }
      });
    } catch (e) {
      console.error("Errore approvazione delibera:", e);
      return new Response(renderErrorPage(`Errore durante il salvataggio della delibera: ${e.message}`), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" }
      });
    }
  }

  // F. DASHBOARD AMMINISTRATIVA PRINCIPALE
  return renderAdminDashboard(env, utenteLoggato, url);
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
  } catch (e) {}

  let consensi = [];
  try {
    const { results } = await env.DB.prepare(
      "SELECT socio_id, accettazione_statuto, consenso_trattamento_dati, consenso_foto_video, data_consenso FROM consensi_privacy"
    ).all();
    consensi = results || [];
  } catch (e) {}

  const totDomande = domande.length;
  const inAttesa = domande.filter((d) => d.stato_richiesta !== "approvato").length;
  const approvate = domande.filter((d) => d.stato_richiesta === "approvato").length;

  const dataOggi = new Date().toISOString().slice(0, 10);
  const msgNotifica = url.searchParams.get("msg") === "delibera_ok"
    ? `<div class="alert-success">&check; Delibera registrata con successo e Numero Tessera APS assegnato!</div>`
    : url.searchParams.has("benvenuto")
    ? `<div class="alert-success">&check; Benvenuto nel gestionale! Il tuo account Super Admin è attivo.</div>`
    : "";

  const righeDomande = domande.length === 0
    ? `<tr><td colspan="7" style="text-align: center; padding: 40px; color: #71717A;">Nessuna domanda di iscrizione ricevuta finora.</td></tr>`
    : domande.map((d, idx) => {
        const delegheMinore = deleghe.filter((del) => del.socio_minore_id === d.socio_id);
        const consMinore = consensi.find((c) => c.socio_id === d.socio_id);

        const delegheHtml = delegheMinore.length > 0
          ? delegheMinore.map((del) => `<span class="badge-delega">&bull; ${del.nome} ${del.cognome} (${del.relazione || "Delegato"} - Tel: ${del.telefono})</span>`).join("<br>")
          : `<span style="color: #9CA3AF; font-size: 12px;">Nessuna delega</span>`;

        const isApprovato = d.stato_richiesta === "approvato";
        const statoBadge = isApprovato
          ? `<span class="status-badge status-approved">Deliberato &bull; Tessera APS ${d.numero_tessera_aps || ""}</span>`
          : `<span class="status-badge status-pending">In attesa di delibera</span>`;

        const moduloDelibera = isApprovato
          ? `<div class="delibera-info">
               <strong>Deliberato il:</strong> ${d.data_delibera || "N.D."}<br>
               <strong>Verbale CD:</strong> ${d.numero_verbale || "N.D."}<br>
               <strong>N&deg; Tessera APS:</strong> <span class="tessera-highlight">${d.numero_tessera_aps}</span>
             </div>`
          : `
            <form action="/admin/delibera" method="POST" class="form-delibera">
              <input type="hidden" name="socio_id" value="${d.socio_id}">
              <div class="form-row">
                <label>Data Delibera CD:
                  <input type="date" name="data_delibera" value="${dataOggi}" required>
                </label>
                <label>Verbale N&deg;:
                  <input type="text" name="numero_verbale" value="Verbale n. 01/2026" required>
                </label>
              </div>
              <div class="form-row">
                <label>Assegna Tessera APS:
                  <input type="text" name="numero_tessera_aps" value="APS-2026-${String(idx + 1).padStart(3, "0")}" required>
                </label>
                <button type="submit" class="btn-approva">Ratifica & Assegna</button>
              </div>
            </form>
          `;

        return `
          <tr>
            <td>
              <strong>${d.minore_nome} ${d.minore_cognome}</strong><br>
              <code class="cf-code">${d.minore_cf}</code><br>
              <small style="color: #71717A;">Nato il ${d.minore_nascita || "N.D."} (${d.minore_luogo || "N.D."})</small>
            </td>
            <td>
              <strong>${d.tutore_nome} ${d.tutore_cognome}</strong> (${d.grado_parentela || "Genitore"})<br>
              <small>&bull; Tel: <a href="tel:${d.tutore_telefono}" style="color: #18181B; text-decoration: underline;">${d.tutore_telefono}</a></small><br>
              <small>&bull; Email: <a href="mailto:${d.tutore_email}" style="color: #18181B; text-decoration: underline;">${d.tutore_email}</a></small>
            </td>
            <td>
              <span class="badge-corso">${d.corso_titolo || "Laboratorio Teatrale"}</span><br>
              <small style="color: #71717A;">Socio Ordinario (Minore)</small>
            </td>
            <td>${delegheHtml}</td>
            <td>
              <small style="color: #15803D;">&check; Statuto Sociale</small><br>
              <small style="color: #15803D;">&check; Privacy GDPR</small><br>
              <small style="color: ${consMinore?.consenso_foto_video ? "#15803D" : "#6B7280"};">
                ${consMinore?.consenso_foto_video ? "&check; Foto/Video S&igrave;" : "&times; Foto/Video No"}
              </small>
            </td>
            <td>${statoBadge}</td>
            <td style="min-width: 250px;">${moduloDelibera}</td>
          </tr>
        `;
      }).join("");

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pannello Amministrativo | Cervelli in Affitto APS</title>
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
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--bg-light);
      color: var(--text-dark);
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
      color: #52525B;
      text-align: left;
      padding: 12px 16px;
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1px solid var(--border-light);
    }
    td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--border-light);
      vertical-align: top;
    }
    tr:hover td { background: #FAFAFA; }
    .cf-code {
      font-family: monospace;
      background: #F4F4F5;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 11px;
      color: #09090B;
    }
    .badge-corso {
      background: var(--brand-rose-light);
      color: #831843;
      padding: 3px 8px;
      border-radius: 4px;
      font-weight: 700;
      font-size: 11px;
      display: inline-block;
      margin-bottom: 4px;
    }
    .badge-delega {
      font-size: 11px;
      color: #475569;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 700;
    }
    .status-pending { background: #FEF3C7; color: #92400E; }
    .status-approved { background: #DCFCE7; color: #166534; }
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
      padding: 14px;
      border-radius: 8px;
      font-weight: 800;
      font-size: 14px;
      cursor: pointer;
      margin-top: 12px;
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
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Primo Avvio &bull; Setup Iniziale</span>
    <h1>Crea Account Super Admin</h1>
    <p>Nessun account &egrave; presente nel database. Registra ora l'utente principale per accedere alla gestione dell'APS.</p>
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
        <label>Email Ufficiale *</label>
        <input type="email" name="email" placeholder="latua@email.it" required>
      </div>
      <div class="form-group">
        <label>Scegli Password * (min. 8 caratteri)</label>
        <input type="password" name="password" minlength="8" required>
      </div>
      <div class="form-group">
        <label>Conferma Password *</label>
        <input type="password" name="password_conferma" minlength="8" required>
      </div>
      <button type="submit" class="btn-submit">Attiva Account Super Admin & Accedi</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderLoginAdminPage(errore = "") {
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
    h1 { font-size: 22px; font-weight: 800; color: #fff; margin-bottom: 6px; }
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
   ELABORAZIONE DATI INVIATI MODULO PUBBLICO (POST)
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

    // Corso Selezionato
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
        renderErrorPage("Per poter inviare la richiesta &egrave; necessario accettare lo Statuto Sociale e l'Informativa Privacy GDPR."),
        { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
      );
    }

    const clientIP = request.headers.get("CF-Connecting-IP") || "ip-non-disponibile";

    // 1. Assicura esistenza corso
    await env.DB.prepare(`
      INSERT OR IGNORE INTO attivita_eventi (id, titolo, tipo, descrizione, luogo, quota_o_prezzo, capienza_massima, stato)
      VALUES (?, 'Laboratorio Teatrale Bambini e Ragazzi', 'corso_teatro_minori', 'Laboratorio teatrale annuale con copertura UILT', 'Sede Cervelli in Affitto APS', 0, 30, 'aperto')
    `).bind(corsoId).run();

    // 2. Gestione Tutore Legale
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

    // 3. Gestione Socio Genitore
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

    // 4. Gestione Socio Minore
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

    await env.DB.prepare("DELETE FROM deleghe_ritiro WHERE socio_minore_id = ?").bind(socioMinoreId).run();

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

    // 8. Invio Email con Resend (se la chiave è presente)
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
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--bg-light);
      color: var(--text-dark);
      line-height: 1.5;
    }
    header {
      background: var(--bg-dark);
      color: #fff;
      padding: 30px 20px;
      text-align: center;
      border-bottom: 3px solid var(--brand-rose);
    }
    .header-badge {
      display: inline-block;
      background: rgba(217, 130, 149, 0.15);
      color: var(--brand-rose);
      font-size: 11px;
      font-weight: 700;
      padding: 4px 12px;
      border-radius: 999px;
      margin-bottom: 12px;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    h1 { font-size: 26px; font-weight: 800; color: #fff; margin-bottom: 6px; }
    h1 span { color: var(--brand-rose); }
    .subtitle { font-size: 14px; color: var(--silver); max-width: 650px; margin: 0 auto; opacity: 0.9; }
    
    .wizard-container {
      max-width: 720px;
      margin: -20px auto 40px auto;
      background: #fff;
      border-radius: 16px;
      border: 1px solid var(--border-light);
      box-shadow: 0 10px 30px rgba(0,0,0,0.06);
      overflow: hidden;
      padding: 30px;
    }
    .steps-indicator {
      display: flex;
      justify-content: space-between;
      position: relative;
      margin-bottom: 32px;
    }
    .steps-indicator::before {
      content: "";
      position: absolute;
      top: 14px;
      left: 20px;
      right: 20px;
      height: 2px;
      background: var(--border-light);
      z-index: 1;
    }
    .step-node {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 18%;
    }
    .step-circle {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: #fff;
      border: 2px solid var(--border-light);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 6px;
      transition: all 0.25s ease;
    }
    .step-label {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-align: center;
      display: none;
    }
    @media(min-width: 600px) { .step-label { display: block; } }
    .step-node.active .step-circle {
      background: var(--brand-rose);
      border-color: var(--brand-rose);
      color: #fff;
      box-shadow: 0 0 0 3px rgba(217, 130, 149, 0.25);
    }
    .step-node.active .step-label { color: var(--text-dark); font-weight: 700; }
    .step-node.completed .step-circle {
      background: var(--success);
      border-color: var(--success);
      color: #fff;
    }

    .form-step { display: none; }
    .form-step.active { display: block; animation: fadeIn 0.3s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    .step-title { font-size: 18px; font-weight: 800; color: var(--text-dark); margin-bottom: 4px; }
    .step-desc { font-size: 13px; color: var(--text-muted); margin-bottom: 24px; }
    
    .form-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
      margin-bottom: 24px;
    }
    @media(min-width: 580px) {
      .form-grid.two-cols { grid-template-columns: 1fr 1fr; }
      .form-grid.three-cols { grid-template-columns: 1fr 1fr 1fr; }
    }
    .form-group { display: flex; flex-direction: column; }
    label { font-size: 13px; font-weight: 700; color: #27272A; margin-bottom: 6px; }
    input[type="text"], input[type="email"], input[type="tel"], input[type="date"], select, textarea {
      padding: 12px 14px;
      border: 1px solid var(--border-light);
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      color: var(--text-dark);
      background: #FAFAFA;
      transition: border 0.2s;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--brand-rose);
      background: #fff;
    }
    .radio-card {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 16px;
      border: 1px solid var(--border-light);
      border-radius: 10px;
      background: #FAFAFA;
      cursor: pointer;
      margin-bottom: 10px;
      transition: all 0.2s;
    }
    .radio-card:hover { border-color: var(--brand-rose); background: #FFF5F7; }
    .radio-card input { margin-top: 3px; accent-color: var(--brand-rose); }
    .radio-body strong { display: block; font-size: 14px; color: var(--text-dark); margin-bottom: 2px; }
    .radio-body span { display: block; font-size: 12px; color: var(--text-muted); margin-bottom: 4px; }
    .radio-body small { color: #831843; font-weight: 600; font-size: 11px; }

    .delega-item {
      background: #FAFAFA;
      border: 1px solid var(--border-light);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 12px;
      position: relative;
    }
    .delega-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      font-size: 12px;
      font-weight: 700;
      color: var(--text-muted);
    }
    .btn-remove-delega {
      background: none;
      border: none;
      color: #EF4444;
      font-size: 12px;
      cursor: pointer;
      font-weight: 600;
    }
    .btn-add-delega {
      background: #F4F4F5;
      border: 1px dashed #A1A1AA;
      color: var(--text-dark);
      padding: 10px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      width: 100%;
      cursor: pointer;
      margin-top: 8px;
      margin-bottom: 20px;
    }
    .btn-add-delega:hover { background: #E4E4E7; border-color: #71717A; }

    .privacy-box {
      border: 1px solid var(--border-light);
      border-radius: 8px;
      padding: 14px;
      margin-bottom: 12px;
      background: #FAFAFA;
    }
    .privacy-box label {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      font-size: 12px;
      font-weight: 500;
      color: #3F3F46;
      cursor: pointer;
    }
    .privacy-box input[type="checkbox"] {
      margin-top: 3px;
      accent-color: var(--brand-rose);
      width: 16px;
      height: 16px;
    }
    .info-callout {
      background: var(--brand-rose-light);
      border-left: 4px solid var(--brand-rose);
      padding: 14px;
      border-radius: 6px;
      font-size: 12px;
      color: #831843;
      margin-bottom: 20px;
      line-height: 1.5;
    }

    .wizard-nav {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid var(--border-light);
    }
    .btn-step {
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .btn-prev { background: #E4E4E7; color: var(--text-dark); }
    .btn-prev:hover { background: #D4D4D8; }
    .btn-next { background: var(--brand-rose); color: #fff; margin-left: auto; }
    .btn-next:hover { background: var(--brand-rose-dark); }
    .btn-submit { background: var(--brand-rose); color: #fff; font-size: 14px; padding: 14px 28px; }
    .btn-submit:hover { background: var(--brand-rose-dark); }
    
    .hidden-robot { display: none !important; }
    
    footer {
      text-align: center;
      padding: 24px;
      font-size: 12px;
      color: var(--text-muted);
    }
    footer a { color: var(--text-dark); text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <header>
    <div class="header-badge">Cervelli in Affitto APS &bull; Affiliato UILT</div>
    <h1>Modulo Ufficiale <span>Iscrizione Laboratori</span></h1>
    <p class="subtitle">Richiesta di ammissione a socio e iscrizione minori ai corsi di teatro per l'anno sociale in corso con copertura assicurativa nazionale UILT.</p>
  </header>

  <div class="wizard-container">
    <div class="steps-indicator">
      <div class="step-node active" id="node-1">
        <div class="step-circle">1</div>
        <div class="step-label">Genitore</div>
      </div>
      <div class="step-node" id="node-2">
        <div class="step-circle">2</div>
        <div class="step-label">Allievo/a</div>
      </div>
      <div class="step-node" id="node-3">
        <div class="step-circle">3</div>
        <div class="step-label">Laboratorio</div>
      </div>
      <div class="step-node" id="node-4">
        <div class="step-circle">4</div>
        <div class="step-label">Deleghe</div>
      </div>
      <div class="step-node" id="node-5">
        <div class="step-circle">5</div>
        <div class="step-label">Consensi</div>
      </div>
    </div>

    <form id="iscrizioneForm" method="POST" action="/iscrizione-minori">
      <div class="hidden-robot">
        <input type="text" name="codice_sicurezza_robot" value="">
      </div>

      <!-- STEP 1: DATI GENITORE / TUTORE -->
      <div class="form-step active" id="step-1">
        <div class="step-title">Passo 1: Dati del Genitore o Tutore Legale</div>
        <div class="step-desc">Inserisci i dati del genitore che presenta la domanda per il minore e richiede l'ammissione a socio dell'APS.</div>
        
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
        <div class="step-title">Passo 4: Deleghe al Ritiro del Minore</div>
        <div class="step-desc">Autorizza altre persone maggiorenni (nonni, zii, amici) a ritirare l'allievo/a al termine delle lezioni. (Facoltativo)</div>

        <div id="delegheContainer"></div>

        <button type="button" class="btn-add-delega" onclick="addDelegaField()">+ Aggiungi Persona Delegata al Ritiro</button>

        <div class="wizard-nav">
          <button type="button" class="btn-step btn-prev" onclick="goToStep(3)">&larr; Indietro</button>
          <button type="button" class="btn-step btn-next" onclick="goToStep(5)">Avanti: Consensi & Invio &rarr;</button>
        </div>
      </div>

      <!-- STEP 5: CONSENSI E INVIO -->
      <div class="form-step" id="step-5">
        <div class="step-title">Passo 5: Consensi Istituzionali e Invio Domanda</div>
        <div class="step-desc">Verifica e accetta le informative obbligatorie per finalizzare la richiesta di ammissione a socio e iscrizione.</div>

        <div class="privacy-box">
          <label>
            <input type="checkbox" name="consenso_statuto" value="1" required checked>
            <span><strong>Accettazione Statuto Sociale e Regolamento Interno APS *</strong><br>
            Dichiaro di aver preso visione dello statuto dell'APS Cervelli in Affitto e di condividerne gli scopi associativi e culturali.</span>
          </label>
        </div>

        <div class="privacy-box">
          <label>
            <input type="checkbox" name="consenso_privacy" value="1" required checked>
            <span><strong>Informativa Privacy GDPR (Regolamento UE 2016/679) *</strong><br>
            Autorizzo il trattamento dei dati personali forniti per le finalit&agrave; istituzionali dell'APS, per la gestione del Libro Soci e per il tesseramento UILT.</span>
          </label>
        </div>

        <div class="privacy-box">
          <label>
            <input type="checkbox" name="consenso_foto" value="1">
            <span><strong>Liberatoria Foto e Video Teatrali (facoltativo)</strong><br>
            Autorizzo riprese fotografiche e video durante saggi, lezioni e spettacoli a scopo di documentazione e archivio culturale dell'APS.</span>
          </label>
        </div>

        <div class="info-callout" style="margin-top: 20px;">
          Cliccando su <strong>"Invia Domanda di Iscrizione"</strong> la richiesta sar&agrave; registrata nel gestionale dell'associazione e sottoposta a ratifica del Consiglio Direttivo con l'assegnazione del Numero Tessera APS.
        </div>

        <div class="wizard-nav">
          <button type="button" class="btn-step btn-prev" onclick="goToStep(4)">&larr; Indietro</button>
          <button type="submit" class="btn-step btn-submit">Invia Domanda di Iscrizione</button>
        </div>
      </div>
    </form>
  </div>

  <footer>
    Cervelli in Affitto APS &bull; CF: 91456950371 &bull; Affiliato UILT<br>
    <a href="/admin">Area Riservata Amministrativa</a>
  </footer>

  <script>
    let currentStep = 1;

    function goToStep(step) {
      if (step > currentStep) {
        if (!validateStep(currentStep)) return;
      }
      document.querySelectorAll('.form-step').forEach(el => el.classList.remove('active'));
      document.getElementById('step-' + step).classList.add('active');

      document.querySelectorAll('.step-node').forEach((node, idx) => {
        const nodeIndex = idx + 1;
        node.classList.remove('active', 'completed');
        if (nodeIndex === step) {
          node.classList.add('active');
        } else if (nodeIndex < step) {
          node.classList.add('completed');
        }
      });

      currentStep = step;
      window.scrollTo({ top: 120, behavior: 'smooth' });
    }

    function validateStep(step) {
      const stepEl = document.getElementById('step-' + step);
      const inputs = stepEl.querySelectorAll('input[required], select[required]');
      for (const input of inputs) {
        if (!input.checkValidity()) {
          input.reportValidity();
          return false;
        }
      }
      return true;
    }

    let delegaCount = 0;
    function addDelegaField() {
      delegaCount++;
      const container = document.getElementById('delegheContainer');
      const div = document.createElement('div');
      div.className = 'delega-item';
      div.id = 'delega-' + delegaCount;
      div.innerHTML = `
        <div class="delega-header">
          <span>Persona Delegata n. ${delegaCount}</span>
          <button type="button" class="btn-remove-delega" onclick="document.getElementById('delega-${delegaCount}').remove()">&times; Rimuovi</button>
        </div>
        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Nome *</label>
            <input type="text" name="delega_nome[]" placeholder="Es. Anna" required>
          </div>
          <div class="form-group">
            <label>Cognome *</label>
            <input type="text" name="delega_cognome[]" placeholder="Es. Bianchi" required>
          </div>
        </div>
        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Telefono Cellulare *</label>
            <input type="tel" name="delega_telefono[]" placeholder="Es. 3401234567" required>
          </div>
          <div class="form-group">
            <label>Relazione / Grado di Parentela</label>
            <input type="text" name="delega_relazione[]" placeholder="Es. Nonna, Zio, Amico di famiglia">
          </div>
        </div>
      `;
      container.appendChild(div);
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
