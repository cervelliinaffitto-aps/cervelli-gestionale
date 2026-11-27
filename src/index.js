/**
 * Cervelli in Affitto APS - Piattaforma Gestionale
 * - Portale Pubblico: Modulo Iscrizione Corsi Minori & Domanda Socio (Wizard a 5 step)
 * - Area Riservata (/admin): Dashboard Generale, Pagine HUB Macro-Aree a Tessere e Delibera CD
 * Affiliato UILT - Unione Italiana Libero Teatro
 */

const DEFAULT_CORSO_ID = "corso-teatro-ragazzi-2026";
const COOKIE_NAME = "cervelli_admin_session";
const PBKDF2_SALT = "cervelli-aps-security-salt-2026";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Endpoint di test rapido per verificare il database
    if (url.pathname === "/api/test-db") {
      try {
        const { results } = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
        ).all();
        return new Response(JSON.stringify({ status: "ok", tables: results }), {
          headers: { "Content-Type": "application/json" }
        });
      } catch (err) {
        return new Response(JSON.stringify({ status: "error", message: err.message }), {
          status: 500,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    // 2. Sezione Amministrazione (/admin)
    if (url.pathname.startsWith("/admin")) {
      return handleAdminRoutes(request, env, url);
    }

    // 3. Portale Pubblico: Invio Modulo Minori
    if (url.pathname === "/iscrizione-minori" && request.method === "POST") {
      return handleIscrizionePost(request, env, url);
    }

    // 4. Portale Pubblico: Visualizzazione Wizard 5 Step
    if (url.pathname === "/" || url.pathname === "/iscrizione-minori") {
      const step = parseInt(url.searchParams.get("step") || "1", 10);
      const isSuccess = url.searchParams.get("success") === "1";
      return renderPublicWizard(step, isSuccess, url.searchParams);
    }

    return new Response("Pagina non trovata", { status: 404 });
  }
};

/* =========================================================================
   ROUTER AREA AMMINISTRATIVA
   ========================================================================= */

async function handleAdminRoutes(request, env, url) {
  // Setup primo avvio Super Admin
  if (url.pathname === "/admin/setup" && request.method === "POST") {
    return handleSetupPost(request, env);
  }

  // Login POST
  if (url.pathname === "/admin/login" && request.method === "POST") {
    return handleLoginPost(request, env);
  }

  // Logout GET
  if (url.pathname === "/admin/logout") {
    return handleLogout(request, env);
  }

  // Delibera Consiglio Direttivo POST
  if (url.pathname === "/admin/delibera" && request.method === "POST") {
    const session = await getAdminSession(request, env);
    if (!session) {
      return new Response(null, { status: 302, headers: { Location: "/admin" } });
    }
    return handleDeliberaPost(request, env, session.user);
  }

  // Verifica se esiste già un Super Admin
  let adminExists = false;
  try {
    const row = await env.DB.prepare(
      "SELECT id FROM utenti_gestionale WHERE ruolo = 'super_admin' LIMIT 1"
    ).first();
    adminExists = !!row;
  } catch (e) {
    console.error("Errore verifica utenti:", e);
  }

  if (!adminExists) {
    return renderSetupPage();
  }

  // Verifica sessione attiva tramite Cookie
  const session = await getAdminSession(request, env);
  if (!session) {
    const errorMsg = url.searchParams.get("error");
    return renderLoginPage(errorMsg);
  }

  // Visualizzazione Area di Lavoro Admin (Dashboard, Hub Macro-Aree o Sottosezioni)
  return renderAdminDashboard(env, session.user, url);
}

/* =========================================================================
   AUTENTICAZIONE E SICUREZZA CON PBKDF2 (WEB CRYPTO)
   ========================================================================= */

async function hashPassword(password) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(PBKDF2_SALT),
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    true,
    ["sign"]
  );
  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  return Array.from(new Uint8Array(exported))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getAdminSession(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const token = match[1];

  try {
    const session = await env.DB.prepare(`
      SELECT s.token, s.scadenza, u.id, u.email, u.nome, u.cognome, u.ruolo
      FROM sessioni_admin s
      JOIN utenti_gestionale u ON s.utente_id = u.id
      WHERE s.token = ? AND s.scadenza > datetime('now')
    `).bind(token).first();

    if (!session) return null;

    return {
      token: session.token,
      user: {
        id: session.id,
        email: session.email,
        nome: session.nome,
        cognome: session.cognome,
        ruolo: session.ruolo
      }
    };
  } catch (e) {
    console.error("Errore verifica sessione:", e);
    return null;
  }
}

async function handleLogout(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (match) {
    try {
      await env.DB.prepare("DELETE FROM sessioni_admin WHERE token = ?").bind(match[1]).run();
    } catch (e) {
      console.warn("Errore eliminazione sessione:", e);
    }
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: "/admin",
      "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`
    }
  });
}

async function handleSetupPost(request, env) {
  try {
    const formData = await request.formData();
    const nome = (formData.get("nome") || "").toString().trim();
    const cognome = (formData.get("cognome") || "").toString().trim();
    const email = (formData.get("email") || "").toString().trim().toLowerCase();
    const password = (formData.get("password") || "").toString();

    if (!nome || !cognome || !email || password.length < 8) {
      return renderSetupPage("Tutti i campi sono obbligatori (password min 8 caratteri).");
    }

    const adminCheck = await env.DB.prepare(
      "SELECT id FROM utenti_gestionale WHERE ruolo = 'super_admin' LIMIT 1"
    ).first();
    if (adminCheck) {
      return new Response(null, { status: 302, headers: { Location: "/admin" } });
    }

    const userId = "usr-admin-" + Date.now();
    const passwordHash = await hashPassword(password);

    await env.DB.prepare(`
      INSERT INTO utenti_gestionale (id, email, password_hash, nome, cognome, ruolo, attivo)
      VALUES (?, ?, ?, ?, ?, 'super_admin', 1)
    `).bind(userId, email, passwordHash, nome, cognome).run();

    const sessionToken = generateSessionToken();
    await env.DB.prepare(`
      INSERT INTO sessioni_admin (token, utente_id, scadenza)
      VALUES (?, ?, datetime('now', '+7 days'))
    `).bind(sessionToken, userId).run();

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/admin?view=dashboard",
        "Set-Cookie": `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`
      }
    });
  } catch (e) {
    console.error("Errore setup admin:", e);
    return renderSetupPage(`Errore durante la creazione: ${e.message}`);
  }
}

async function handleLoginPost(request, env) {
  try {
    const formData = await request.formData();
    const email = (formData.get("email") || "").toString().trim().toLowerCase();
    const password = (formData.get("password") || "").toString();

    if (!email || !password) {
      return renderLoginPage("Inserisci sia email che password.");
    }

    const user = await env.DB.prepare(
      "SELECT id, email, password_hash, nome, cognome, attivo FROM utenti_gestionale WHERE email = ?"
    ).bind(email).first();

    if (!user || user.attivo !== 1) {
      return renderLoginPage("Credenziali non valide o utente disattivato.");
    }

    const hashedInput = await hashPassword(password);
    if (hashedInput !== user.password_hash) {
      return renderLoginPage("Credenziali non valide.");
    }

    const sessionToken = generateSessionToken();
    await env.DB.prepare(`
      INSERT INTO sessioni_admin (token, utente_id, scadenza)
      VALUES (?, ?, datetime('now', '+7 days'))
    `).bind(sessionToken, user.id).run();

    await env.DB.prepare(
      "UPDATE utenti_gestionale SET ultimo_accesso = datetime('now') WHERE id = ?"
    ).bind(user.id).run();

    return new Response(null, {
      status: 302,
      headers: {
        Location: "/admin?view=dashboard",
        "Set-Cookie": `${COOKIE_NAME}=${sessionToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`
      }
    });
  } catch (e) {
    console.error("Errore login admin:", e);
    return renderLoginPage(`Errore di sistema: ${e.message}`);
  }
}

async function handleDeliberaPost(request, env, user) {
  try {
    const formData = await request.formData();
    const socioId = (formData.get("socio_id") || "").toString().trim();
    const dataDelibera = (formData.get("data_delibera") || "").toString().trim();
    const numeroVerbale = (formData.get("numero_verbale") || "").toString().trim();
    let numeroTessera = (formData.get("numero_tessera") || "").toString().trim();

    if (!socioId || !dataDelibera || !numeroVerbale) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?view=domande&msg=err_campi" }
      });
    }

    if (!numeroTessera) {
      const year = new Date().getFullYear();
      const countRow = await env.DB.prepare(
        "SELECT COUNT(*) as tot FROM soci WHERE anno_adesione = ? AND stato_richiesta = 'approvato'"
      ).bind(year).first();
      const nextNum = (countRow ? countRow.tot : 0) + 1;
      numeroTessera = `${year}-${String(nextNum).padStart(3, "0")}`;
    }

    await env.DB.prepare(`
      UPDATE soci 
      SET 
        stato_richiesta = 'approvato',
        data_delibera = ?,
        numero_verbale = ?,
        numero_tessera_aps = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).bind(dataDelibera, numeroVerbale, numeroTessera, socioId).run();

    return new Response(null, {
      status: 302,
      headers: { Location: "/admin?view=domande&msg=delibera_ok" }
    });
  } catch (e) {
    console.error("Errore delibera CD:", e);
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin?view=domande&msg=err_server" }
    });
  }
}

/* =========================================================================
   DIZIONARIO STRUTTURATO DELLE MACRO-AREE E SOTTOMENU (BIBBIA)
   ========================================================================= */

const MENU_SECTIONS = [
  {
    id: "macro-soci",
    titolo: "Soci & Libro Soci",
    colore: "#D98295", // Rosa Corallo Brand
    icona: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    descrizione: "Gestione domande di ammissione, Libro Soci ufficiale, anagrafiche minori, quote sociali e tesseramento nazionale UILT.",
    voci: [
      { id: "domande", etichetta: "1.1 Domande Ammissione", desc: "Verifica e approvazione con data delibera, verbale CD e numero tessera APS." },
      { id: "registro-soci", etichetta: "1.2 Registro Libro Soci", desc: "Registro cronologico ufficiale dei soci con filtri di ricerca ed esportazione." },
      { id: "schede-soci", etichetta: "1.3 Schede Soci & Minori", desc: "Dossier anagrafico completo dei soci, tutori legali e deleghe al ritiro." },
      { id: "quote-uilt", etichetta: "1.4 Quote & Tessere UILT", desc: "Stato quote annuali APS (1 nov-31 ott), quote UILT (anno solare) e upload tessere." }
    ]
  },
  {
    id: "macro-corsi",
    titolo: "Attività & Corsi",
    colore: "#06B6D4", // Ciano Teatrale
    icona: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
    descrizione: "Laboratori teatrali per bambini, ragazzi e adulti, registri allievi, quote di frequenza e foglio presenze.",
    voci: [
      { id: "corsi", etichetta: "2.1 Corsi e Laboratori Teatrali", desc: "Creazione e gestione corsi, docenti, calendario lezioni e quote mensili." },
      { id: "iscritti-corsi", etichetta: "2.2 Registro Iscritti per Corso", desc: "Elenco iscritti attivi, stato pagamenti quote laboratori e contatti tutori." },
      { id: "presenze", etichetta: "2.3 Registro Presenze & Lezioni", desc: "Appello digitale delle lezioni per docenti con report esportabile." }
    ]
  },
  {
    id: "macro-eventi",
    titolo: "Eventi, Teatro & Casse",
    colore: "#F59E0B", // Ambra Ribalta
    icona: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
    descrizione: "Cartellone spettacoli, cene con delitto, eventi sul territorio, gestione prenotazioni e casse distinte.",
    voci: [
      { id: "cartellone", etichetta: "3.1 Cartellone & Spettacoli Teatrali", desc: "Gestione repliche teatrali, debutti, locandine e capienza teatri." },
      { id: "eventi-extra", etichetta: "3.2 Altri Eventi (Cene con Delitto)", desc: "Eventi gastronomici o speciali con form e cassa dedicati." },
      { id: "prenotazioni", etichetta: "3.3 Prenotazioni & Posti", desc: "Ricerca persistente, modifica prenotazioni con verifica capienza e omaggi." },
      { id: "cassa-teatro", etichetta: "3.4 Cassa Spettacoli & Ingressi", desc: "Botteghino teatro, emissione biglietti, pagamenti e controllo ingressi." },
      { id: "cassa-eventi", etichetta: "3.5 Cassa Altri Eventi & Quote", desc: "Cassa flessibile per eventi convenzionati e incassi cene." }
    ]
  },
  {
    id: "macro-builder",
    titolo: "Builder & Contenuti",
    colore: "#10B981", // Smeraldo Strumenti
    icona: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
    descrizione: "Strumenti per personalizzare logo, colori, moduli pubblici, modelli di tessere e comunicazioni email.",
    voci: [
      { id: "form-builder", etichetta: "4.1 Form Builder Dinamico", desc: "Crea e modifica i campi dei form pubblici per corsi, soci o eventi." },
      { id: "theme-builder", etichetta: "4.2 Builder Tema & Identità Visiva", desc: "Configura colori, sfondi, logo e layout di portale e gestionale." },
      { id: "tessera-builder", etichetta: "4.3 Builder Tessera APS", desc: "Modello grafico della tessera associativa digitale e parametri di stampa." },
      { id: "email-builder", etichetta: "4.4 Template Email & Comunicazioni", desc: "Modifica i testi delle email automatiche di conferma e promemoria." }
    ]
  },
  {
    id: "macro-sistema",
    titolo: "Sistema & Utenti",
    colore: "#6366F1", // Indaco Sicurezza
    icona: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    descrizione: "Controllo accessi per ruoli (Super Admin, Cassiere, Docente), dati fiscali APS, registro log e backup D1.",
    voci: [
      { id: "utenti-ruoli", etichetta: "5.1 Utenti Gestionale & Ruoli", desc: "Gestione operatori interni, password e permessi per macro-area." },
      { id: "registro-attivita", etichetta: "5.2 Registro Attività & Log", desc: "Tracciamento cronologico immutabile delle operazioni amministrative." },
      { id: "dati-aps", etichetta: "5.3 Dati Fiscali APS & Impostazioni", desc: "CF, affiliazione UILT, sede legale, email mittente Resend e footer." },
      { id: "backup-dati", etichetta: "5.4 Esportazioni & Backup", desc: "Esportazione completa in CSV/JSON dei dati per massima sicurezza." }
    ]
  }
];

/* =========================================================================
   CARICAMENTO DATI E VISTE HTML AREA AMMINISTRATIVA
   ========================================================================= */

async function renderAdminDashboard(env, utente, url) {
  // Se non c'è parametro view, il default ufficiale è la Dashboard Generale
  const currentView = url.searchParams.get("view") || "dashboard";
  const msgParam = url.searchParams.get("msg");

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
    delegheMap[d.socio_minore_id].push(`${d.nome} ${d.cognome} (${d.relazione || "Delegato"} - ${d.telefono || ""})`);
  });

  const consensiMap = {};
  consensi.forEach((c) => {
    consensiMap[c.socio_id] = c;
  });

  const totDomande = domande.length;
  const inAttesa = domande.filter((d) => d.stato_richiesta === "in_attesa").length;
  const approvate = domande.filter((d) => d.stato_richiesta === "approvato").length;

  // Assegnazione badge dinamici alle voci
  MENU_SECTIONS[0].voci[0].badge = inAttesa > 0 ? inAttesa : null;

  // Riconoscimento pagina corrente, titolo, macro-area e colore
  let currentTitle = "Dashboard Generale";
  let currentMacro = "Panoramica Associazione";
  let currentMacroColor = "#D98295";
  let currentMacroIcon = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`;
  let activeMacroId = null;

  MENU_SECTIONS.forEach((sec) => {
    if (sec.id === currentView) {
      currentTitle = `Hub: ${sec.titolo}`;
      currentMacro = sec.titolo;
      currentMacroColor = sec.colore;
      currentMacroIcon = sec.icona;
      activeMacroId = sec.id;
    }
    sec.voci.forEach((v) => {
      if (v.id === currentView) {
        currentTitle = v.etichetta;
        currentMacro = sec.titolo;
        currentMacroColor = sec.colore;
        currentMacroIcon = sec.icona;
        activeMacroId = sec.id;
      }
    });
  });

  // Costruzione della Sidebar HTML
  const sidebarNavHtml = MENU_SECTIONS.map((sec) => {
    const isThisMacroHub = sec.id === currentView;
    const isAnyChildActive = sec.voci.some((v) => v.id === currentView);
    const isExpanded = isThisMacroHub || isAnyChildActive;

    const subItems = sec.voci.map((v) => {
      const activeClass = v.id === currentView ? "active" : "";
      const badgeHtml = v.badge ? `<span class="nav-badge">${v.badge}</span>` : "";
      return `<a href="/admin?view=${v.id}" class="nav-sub-item ${activeClass}">
        <span class="sub-dot" style="background: ${sec.colore};"></span>
        <span class="sub-text">${v.etichetta}</span>
        ${badgeHtml}
      </a>`;
    }).join("");

    return `
      <div class="nav-group ${isExpanded ? "expanded" : ""}">
        <div class="nav-group-header">
          <a href="/admin?view=${sec.id}" class="nav-group-title ${isThisMacroHub ? "macro-active" : ""}">
            <span class="nav-icon" style="color: ${sec.colore};">${sec.icona}</span>
            <span class="nav-group-name">${sec.titolo}</span>
          </a>
          <button type="button" class="chevron-btn" onclick="this.closest('.nav-group').classList.toggle('expanded')" title="Espandi/Comprimi sottomenu">
            <svg class="chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
        </div>
        <div class="nav-group-sub">
          ${subItems}
        </div>
      </div>
    `;
  }).join("");

  let msgNotifica = "";
  if (msgParam === "delibera_ok") {
    msgNotifica = `<div class="alert-box alert-success">Delibera Consiglio Direttivo registrata con successo! Il socio è stato approvato e tesserato.</div>`;
  } else if (msgParam === "err_campi") {
    msgNotifica = `<div class="alert-box alert-error">Compila tutti i campi obbligatori della delibera (Data, N° Verbale).</div>`;
  }

  // Costruzione del Contenuto Principale (Workspace)
  let mainContentHtml = "";

  // CASO 1: DASHBOARD GENERALE
  if (currentView === "dashboard") {
    mainContentHtml = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">DOMANDE IN ATTESA CD</div>
          <div class="stat-value" style="color: #F59E0B;">${inAttesa}</div>
          <div class="stat-sub">Richieste di ammissione da deliberare</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">SOCI ATTIVI &amp; TESSERATI</div>
          <div class="stat-value" style="color: #10B981;">${approvate}</div>
          <div class="stat-sub">Soci con tessera APS attiva</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">ATTIVITÀ &amp; LABORATORI</div>
          <div class="stat-value" style="color: #06B6D4;">1</div>
          <div class="stat-sub">Corsi di teatro attivi</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">SPETTACOLI &amp; CASSA</div>
          <div class="stat-value" style="color: #D98295;">0 €</div>
          <div class="stat-sub">Incassi del mese corrente</div>
        </div>
      </div>

      <div class="dashboard-hub-section">
        <div class="section-header-clean">
          <h2>Centro di Controllo • Tutte le Macro-Aree</h2>
          <p>Naviga rapidamente tra i settori del gestionale approvati nella Bibbia</p>
        </div>

        <div class="hub-cards-grid">
          ${MENU_SECTIONS.map((sec) => `
            <a href="/admin?view=${sec.id}" class="hub-card" style="--card-accent: ${sec.colore};">
              <div class="hub-card-top">
                <div class="hub-card-icon" style="background: ${sec.colore}18; color: ${sec.colore};">
                  ${sec.icona}
                </div>
                <span class="hub-card-badge" style="border-color: ${sec.colore}40; color: ${sec.colore};">
                  ${sec.voci.length} sezioni
                </span>
              </div>
              <h3 class="hub-card-title">${sec.titolo}</h3>
              <p class="hub-card-desc">${sec.descrizione}</p>
              <div class="hub-card-footer" style="color: ${sec.colore};">
                <span>Apri panoramica</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            </a>
          `).join("")}
        </div>
      </div>
    `;
  }
  // CASO 2: HUB DI UNA MACRO-AREA (Tessere quadrate con descrizione e link diretti)
  else if (currentView.startsWith("macro-")) {
    const sec = MENU_SECTIONS.find((s) => s.id === currentView);
    if (sec) {
      mainContentHtml = `
        <div class="macro-hub-intro">
          <p class="macro-hub-desc">${sec.descrizione}</p>
        </div>

        <div class="hub-cards-grid">
          ${sec.voci.map((v) => {
            const badgeLive = v.badge ? `<span class="badge-pill bg-amber" style="margin-left: auto;">${v.badge} in attesa</span>` : "";
            return `
              <a href="/admin?view=${v.id}" class="hub-card" style="--card-accent: ${sec.colore};">
                <div class="hub-card-top">
                  <div class="hub-card-icon" style="background: ${sec.colore}18; color: ${sec.colore};">
                    ${sec.icona}
                  </div>
                  ${badgeLive}
                </div>
                <h3 class="hub-card-title">${v.etichetta}</h3>
                <p class="hub-card-desc">${v.desc}</p>
                <div class="hub-card-footer" style="color: ${sec.colore};">
                  <span>Accedi alla sezione</span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
                </div>
              </a>
            `;
          }).join("")}
        </div>
      `;
    }
  }
  // CASO 3: SEZIONE 1.1 DOMANDE DI AMMISSIONE (TABELLA OPERATIVA & DELIBERE)
  else if (currentView === "domande") {
    const righeDomande = domande.length === 0
      ? `<tr><td colspan="7" style="text-align: center; padding: 36px; color: #71717A;">Nessuna domanda ricevuta al momento.</td></tr>`
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
                 <div class="form-row" style="margin-top: 6px;">
                   <label>N° Tessera APS:
                     <input type="text" name="numero_tessera" placeholder="Es. 2026-001 (vuoto = auto)">
                   </label>
                   <button type="submit" class="btn-delibera">Approva &amp; Tessera</button>
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

    mainContentHtml = `
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">DOMANDE RICEVUTE</div>
          <div class="stat-value">${totDomande}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">IN ATTESA DI DELIBERA CD</div>
          <div class="stat-value" style="color: #F59E0B;">${inAttesa}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">SOCI APPROVATI &amp; TESSERATI</div>
          <div class="stat-value" style="color: #10B981;">${approvate}</div>
        </div>
      </div>

      <div class="card-table">
        <div class="card-header-table">
          <div>
            <h3>Libro Soci • Domande di Ammissione e Iscrizioni Minori</h3>
            <p>Affiliazione UILT • Flusso Ufficiale Delibere Consiglio Direttivo APS</p>
          </div>
        </div>

        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Allievo Minore</th>
                <th>Genitore / Tutore</th>
                <th>Corso Selezionato</th>
                <th>Deleghe al Ritiro</th>
                <th>Consensi Privacy</th>
                <th>Stato Domanda</th>
                <th style="min-width: 250px;">Azione Delibera Consiglio Direttivo</th>
              </tr>
            </thead>
            <tbody>
              ${righeDomande}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
  // CASO 4: ALTRE VOCI SOTTOMENU NON ANCORA COLLEGATE A D1
  else {
    mainContentHtml = `
      <div class="placeholder-card">
        <div class="placeholder-icon" style="background: ${currentMacroColor}20; color: ${currentMacroColor};">
          ${currentMacroIcon}
        </div>
        <h2>${currentTitle}</h2>
        <div class="placeholder-meta">
          <span class="tag-macro" style="background: ${currentMacroColor}15; color: ${currentMacroColor}; border: 1px solid ${currentMacroColor}40;">
            Macro-Area: ${currentMacro}
          </span>
          <span class="tag-status">Struttura Sidebar Ufficiale della Bibbia</span>
        </div>
        <p class="placeholder-desc">
          Questa sezione è già perfettamente inserita e mappata nella struttura del gestionale. 
          Nei prossimi passaggi della roadmap collegheremo la configurazione D1 per gestire i contenuti e i dati direttamente da qui.
        </p>
        <div class="placeholder-roadmap">
          <h4>Prossimi Step Immediati da Roadmap:</h4>
          <ul>
            <li><strong>Passo 2:</strong> Tabella D1 Configurazione &amp; Dati Fiscali dell'APS</li>
            <li><strong>Passo 3:</strong> Sezione 4.2 Builder Tema &amp; Identità Visiva (Palette colori e logo caricabile)</li>
            <li><strong>Passo 4:</strong> Sezione 4.1 Form Builder Dinamico per creare e modificare i moduli soci/corsi</li>
          </ul>
        </div>
        <div style="margin-top: 24px; display: flex; gap: 12px; justify-content: center;">
          <a href="/admin?view=${activeMacroId || 'dashboard'}" class="btn-secondary" style="text-decoration: none;">
            Torna all'Hub ${currentMacro}
          </a>
          <a href="/admin?view=domande" class="btn-primary" style="display: inline-block; text-decoration: none;">
            Vai a 1.1 Domande Ammissione
          </a>
        </div>
      </div>
    `;
  }

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gestionale Admin • Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --brand-coral: #D98295;
      --brand-silver: #E8E7E9;
      --brand-black: #121214;
      --card-bg: #18181B;
      --card-border: #27272A;
      --text-muted: #A1A1AA;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #09090B;
      color: #FAFAFA;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* TOP NAVBAR */
    .topbar {
      height: 64px;
      background: #121214;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .toggle-sidebar-btn {
      background: transparent;
      border: 1px solid var(--card-border);
      color: #FAFAFA;
      padding: 7px 10px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      transition: all 0.2s;
    }
    .toggle-sidebar-btn:hover {
      background: #27272A;
      color: var(--brand-coral);
    }
    .topbar-brand {
      font-weight: 700;
      font-size: 16px;
      letter-spacing: -0.01em;
      display: flex;
      align-items: center;
      gap: 10px;
      color: #FFF;
      text-decoration: none;
    }
    .badge-role {
      font-size: 11px;
      font-weight: 700;
      background: var(--brand-coral)22;
      color: var(--brand-coral);
      padding: 3px 8px;
      border-radius: 9999px;
      border: 1px solid var(--brand-coral)44;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 16px;
      font-size: 13px;
    }
    .user-info {
      color: var(--text-muted);
    }
    .user-info strong {
      color: #FAFAFA;
    }
    .btn-logout {
      background: transparent;
      border: 1px solid #3F3F46;
      color: #E4E4E7;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
    }
    .btn-logout:hover {
      background: #EF444422;
      border-color: #EF4444;
      color: #EF4444;
    }

    /* APP LAYOUT */
    .app-body {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* SIDEBAR */
    .sidebar {
      width: 270px;
      background: #121214;
      border-right: 1px solid var(--card-border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow-y: auto;
      padding: 16px 12px;
      transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .sidebar.collapsed {
      width: 68px;
      padding: 16px 8px;
    }
    .sidebar.collapsed .sidebar-header-label,
    .sidebar.collapsed .nav-group-name,
    .sidebar.collapsed .chevron-btn,
    .sidebar.collapsed .nav-group-sub,
    .sidebar.collapsed .nav-dashboard-link span,
    .sidebar.collapsed .sub-text,
    .sidebar.collapsed .nav-badge {
      display: none !important;
    }
    .sidebar.collapsed .nav-group-title,
    .sidebar.collapsed .nav-dashboard-link {
      justify-content: center;
      padding: 10px 0;
    }

    .sidebar-header-label {
      font-size: 10px;
      font-weight: 700;
      color: #52525B;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin: 14px 8px 6px;
    }

    /* DASHBOARD LINK */
    .nav-dashboard-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      color: #D4D4D8;
      text-decoration: none;
      font-size: 13.5px;
      font-weight: 600;
      transition: all 0.15s;
      margin-bottom: 8px;
      background: transparent;
    }
    .nav-dashboard-link:hover {
      background: #1E1E24;
      color: #FFF;
    }
    .nav-dashboard-link.active {
      background: var(--brand-coral);
      color: #121214;
      font-weight: 700;
    }

    /* NAV GROUPS (ACCORDION) */
    .nav-group {
      margin-bottom: 4px;
    }
    .nav-group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-radius: 8px;
      transition: background 0.15s;
    }
    .nav-group-header:hover {
      background: #1E1E24;
    }
    .nav-group-title {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      color: #E4E4E7;
      text-decoration: none;
      font-size: 13.5px;
      font-weight: 600;
      border-radius: 8px 0 0 8px;
    }
    .nav-group-title.macro-active {
      background: #27272A;
      color: #FFF;
    }
    .chevron-btn {
      background: transparent;
      border: none;
      color: #71717A;
      padding: 10px 12px;
      cursor: pointer;
      display: flex;
      align-items: center;
      border-radius: 0 8px 8px 0;
      transition: color 0.15s;
    }
    .chevron-btn:hover {
      color: #FAFAFA;
    }
    .nav-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
    }
    .chevron {
      transition: transform 0.2s;
    }
    .nav-group.expanded .chevron {
      transform: rotate(180deg);
    }
    .nav-group-sub {
      display: none;
      padding-left: 14px;
      margin-top: 2px;
      margin-bottom: 6px;
      border-left: 1px solid #27272A;
      margin-left: 20px;
    }
    .nav-group.expanded .nav-group-sub {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .nav-sub-item {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 7px 10px;
      border-radius: 6px;
      color: #A1A1AA;
      text-decoration: none;
      font-size: 12.5px;
      font-weight: 500;
      transition: all 0.15s;
    }
    .nav-sub-item:hover {
      color: #FFF;
      background: #1E1E24;
    }
    .nav-sub-item.active {
      color: #FAFAFA;
      background: #27272A;
      font-weight: 600;
    }
    .sub-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .nav-badge {
      margin-left: auto;
      font-size: 10.5px;
      font-weight: 700;
      background: #EF4444;
      color: #FFF;
      padding: 2px 6px;
      border-radius: 9999px;
    }

    /* MAIN WORKSPACE */
    .main-workspace {
      flex: 1;
      overflow-y: auto;
      padding: 28px 36px;
      background: #09090B;
    }

    /* PAGE BANNER */
    .page-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--card-border);
    }
    .page-banner-left {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .macro-icon-box {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .page-banner-title h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #FFF;
    }
    .breadcrumb {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* STATS GRID */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 18px 20px;
    }
    .stat-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 800;
      color: #FFF;
      margin-top: 6px;
      letter-spacing: -0.02em;
    }
    .stat-sub {
      font-size: 12px;
      color: #71717A;
      margin-top: 4px;
    }

    /* HUB SECTION & CARDS GRID */
    .section-header-clean {
      margin-bottom: 18px;
    }
    .section-header-clean h2 {
      font-size: 18px;
      font-weight: 700;
      color: #FAFAFA;
    }
    .section-header-clean p {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 2px;
    }
    .macro-hub-intro {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      padding: 16px 20px;
      border-radius: 10px;
      margin-bottom: 24px;
    }
    .macro-hub-desc {
      font-size: 14px;
      color: #D4D4D8;
      line-height: 1.5;
    }
    .hub-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 18px;
      margin-bottom: 32px;
    }
    .hub-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 22px;
      text-decoration: none;
      display: flex;
      flex-direction: column;
      position: relative;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      overflow: hidden;
    }
    .hub-card::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: var(--card-accent, var(--brand-coral));
      opacity: 0.4;
      transition: opacity 0.2s;
    }
    .hub-card:hover {
      transform: translateY(-3px);
      border-color: #3F3F46;
      background: #1F1F24;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .hub-card:hover::before {
      opacity: 1;
    }
    .hub-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    .hub-card-icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .hub-card-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 9999px;
      border: 1px solid;
    }
    .hub-card-title {
      font-size: 16px;
      font-weight: 700;
      color: #FAFAFA;
      letter-spacing: -0.01em;
      margin-bottom: 8px;
    }
    .hub-card-desc {
      font-size: 13px;
      color: var(--text-muted);
      line-height: 1.45;
      margin-bottom: 20px;
      flex: 1;
    }
    .hub-card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12.5px;
      font-weight: 600;
      border-top: 1px solid #27272A;
      padding-top: 14px;
      transition: gap 0.2s;
    }
    .hub-card:hover .hub-card-footer svg {
      transform: translateX(3px);
    }

    /* TABLE SECTION */
    .card-table {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
      margin-bottom: 30px;
    }
    .card-header-table {
      padding: 20px 24px;
      border-bottom: 1px solid var(--card-border);
    }
    .card-header-table h3 {
      font-size: 16px;
      font-weight: 700;
      color: #FAFAFA;
    }
    .card-header-table p {
      font-size: 12.5px;
      color: var(--text-muted);
      margin-top: 3px;
    }
    .table-responsive {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }
    th {
      background: #141416;
      color: #A1A1AA;
      font-weight: 600;
      font-size: 11.5px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 12px 18px;
      border-bottom: 1px solid var(--card-border);
    }
    td {
      padding: 16px 18px;
      border-bottom: 1px solid #27272A;
      vertical-align: top;
      color: #E4E4E7;
    }
    tr:hover td {
      background: #1C1C20;
    }
    .text-sub {
      font-size: 11.5px;
      color: #A1A1AA;
    }
    .badge-pill {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 9999px;
      margin: 2px 0;
    }
    .bg-green { background: #10B98122; color: #10B981; border: 1px solid #10B98144; }
    .bg-amber { background: #F59E0B22; color: #F59E0B; border: 1px solid #F59E0B44; }
    .bg-gray { background: #27272A; color: #A1A1AA; border: 1px solid #3F3F46; }
    .tag-delegato {
      display: inline-block;
      background: #27272A;
      color: #E4E4E7;
      font-size: 11px;
      padding: 2px 6px;
      border-radius: 4px;
      margin-bottom: 2px;
    }

    /* FORM DELIBERA */
    .form-delibera {
      background: #141416;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid #27272A;
    }
    .form-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    .form-delibera label {
      font-size: 10.5px;
      color: #A1A1AA;
      display: flex;
      flex-direction: column;
      gap: 3px;
      flex: 1;
    }
    .form-delibera input {
      background: #09090B;
      border: 1px solid #3F3F46;
      color: #FFF;
      padding: 6px 8px;
      border-radius: 5px;
      font-size: 12px;
    }
    .form-delibera input:focus {
      outline: none;
      border-color: var(--brand-coral);
    }
    .btn-delibera {
      background: var(--brand-coral);
      color: #121214;
      font-weight: 700;
      font-size: 12px;
      border: none;
      padding: 8px 14px;
      border-radius: 6px;
      cursor: pointer;
      transition: opacity 0.2s;
      white-space: nowrap;
    }
    .btn-delibera:hover {
      opacity: 0.9;
    }
    .delibera-info {
      font-size: 12px;
      color: #D4D4D8;
      line-height: 1.6;
    }
    .tessera-highlight {
      color: var(--brand-coral);
      font-size: 13px;
    }

    /* PLACEHOLDER SECTION */
    .placeholder-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 40px 32px;
      text-align: center;
      max-width: 680px;
      margin: 30px auto;
    }
    .placeholder-icon {
      width: 72px;
      height: 72px;
      border-radius: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    .placeholder-card h2 {
      font-size: 22px;
      font-weight: 700;
      color: #FFF;
      margin-bottom: 12px;
    }
    .placeholder-meta {
      display: flex;
      gap: 8px;
      justify-content: center;
      margin-bottom: 16px;
    }
    .tag-macro {
      font-size: 12px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 9999px;
    }
    .tag-status {
      font-size: 12px;
      background: #27272A;
      color: #D4D4D8;
      padding: 3px 10px;
      border-radius: 9999px;
    }
    .placeholder-desc {
      font-size: 14px;
      color: var(--text-muted);
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .placeholder-roadmap {
      background: #121214;
      border: 1px solid #27272A;
      border-radius: 10px;
      padding: 16px 20px;
      text-align: left;
      font-size: 13px;
      color: #D4D4D8;
    }
    .placeholder-roadmap h4 {
      font-size: 13px;
      font-weight: 700;
      color: #FFF;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .placeholder-roadmap ul {
      list-style-type: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .btn-primary {
      background: var(--brand-coral);
      color: #121214;
      font-weight: 700;
      font-size: 13px;
      padding: 10px 18px;
      border-radius: 8px;
      transition: opacity 0.2s;
    }
    .btn-secondary {
      background: #27272A;
      color: #FAFAFA;
      font-weight: 600;
      font-size: 13px;
      padding: 10px 18px;
      border-radius: 8px;
      transition: background 0.2s;
    }
    .btn-secondary:hover {
      background: #3F3F46;
    }

    /* ALERTS */
    .alert-box {
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 20px;
      font-weight: 600;
    }
    .alert-success { background: #10B98120; border: 1px solid #10B981; color: #10B981; }
    .alert-error { background: #EF444420; border: 1px solid #EF4444; color: #EF4444; }

    @media (max-width: 900px) {
      .sidebar { position: fixed; height: calc(100vh - 64px); z-index: 99; transform: translateX(-100%); }
      .sidebar.open { transform: translateX(0); }
      .main-workspace { padding: 20px 16px; }
      .stats-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

  <!-- TOP NAVBAR -->
  <header class="topbar">
    <div class="topbar-left">
      <button class="toggle-sidebar-btn" id="toggleSidebar" title="Comprimi o Espandi Sidebar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <a href="/admin?view=dashboard" class="topbar-brand">
        <span>Cervelli in Affitto APS</span>
        <span class="badge-role">SUPER ADMIN</span>
      </a>
    </div>
    <div class="topbar-right">
      <span class="user-info">Connesso: <strong>${utente.nome} ${utente.cognome}</strong> (${utente.email})</span>
      <a href="/admin/logout" class="btn-logout">Disconnetti</a>
    </div>
  </header>

  <!-- CORPO PRINCIPALE -->
  <div class="app-body">
    <!-- SIDEBAR -->
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-header-label">Area Gestionale</div>
      <a href="/admin?view=dashboard" class="nav-dashboard-link ${currentView === "dashboard" ? "active" : ""}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span>Dashboard Generale</span>
      </a>

      <div class="sidebar-header-label">Macro-Aree Bibbia</div>
      ${sidebarNavHtml}
    </aside>

    <!-- AREA DI LAVORO CENTRALE -->
    <main class="main-workspace" id="mainWorkspace">
      ${msgNotifica}

      <div class="page-banner">
        <div class="page-banner-left">
          <div class="macro-icon-box" style="background: ${currentMacroColor}18; color: ${currentMacroColor};">
            ${currentMacroIcon}
          </div>
          <div class="page-banner-title">
            <h1>${currentTitle}</h1>
            <div class="breadcrumb">Pannello Gestionale &gt; ${currentMacro} &gt; <strong>${currentTitle}</strong></div>
          </div>
        </div>
      </div>

      ${mainContentHtml}
    </main>
  </div>

  <script>
    const toggleBtn = document.getElementById("toggleSidebar");
    const sidebar = document.getElementById("sidebar");

    toggleBtn.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
    });
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

/* =========================================================================
   PAGINE DI AUTENTICAZIONE AMMINISTRATIVA (SETUP & LOGIN)
   ========================================================================= */

function renderSetupPage(error = "") {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Setup Iniziale Super Admin • Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #121214;
      color: #FAFAFA;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .auth-card {
      background: #18181B;
      border: 1px solid #27272A;
      border-radius: 16px;
      padding: 36px 32px;
      width: 100%;
      max-width: 460px;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.7);
    }
    .brand-header {
      text-align: center;
      margin-bottom: 24px;
    }
    .brand-badge {
      display: inline-block;
      font-size: 11px;
      font-weight: 700;
      background: #D9829522;
      color: #D98295;
      padding: 4px 12px;
      border-radius: 9999px;
      border: 1px solid #D9829544;
      margin-bottom: 12px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: 8px;
    }
    p.sub {
      color: #A1A1AA;
      font-size: 13.5px;
      line-height: 1.5;
    }
    .error-box {
      background: #EF444422;
      border: 1px solid #EF4444;
      color: #F87171;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 20px;
    }
    .form-group {
      margin-bottom: 16px;
      text-align: left;
    }
    label {
      display: block;
      font-size: 12.5px;
      font-weight: 600;
      color: #E4E4E7;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      background: #09090B;
      border: 1px solid #3F3F46;
      color: #FFF;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #D98295;
      box-shadow: 0 0 0 2px #D9829533;
    }
    .btn-submit {
      width: 100%;
      background: #D98295;
      color: #121214;
      font-weight: 700;
      font-size: 14px;
      padding: 12px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      margin-top: 10px;
      transition: opacity 0.2s;
    }
    .btn-submit:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="brand-header">
      <span class="brand-badge">Primo Avvio Gestionale</span>
      <h1>Attivazione Super Admin</h1>
      <p class="sub">Crea l'account principale con pieno controllo su tutte le macro-aree della Bibbia.</p>
    </div>

    ${error ? `<div class="error-box">${error}</div>` : ""}

    <form method="POST" action="/admin/setup">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        <div class="form-group">
          <label>Nome</label>
          <input type="text" name="nome" placeholder="Giacomo" required autofocus>
        </div>
        <div class="form-group">
          <label>Cognome</label>
          <input type="text" name="cognome" placeholder="Garofani" required>
        </div>
      </div>
      <div class="form-group">
        <label>Email Ufficiale</label>
        <input type="email" name="email" placeholder="tua@email.it" required>
      </div>
      <div class="form-group">
        <label>Password Personale (min 8 caratteri)</label>
        <input type="password" name="password" placeholder="••••••••••••" minlength="8" required>
      </div>
      <button type="submit" class="btn-submit">Attiva Account Super Admin &amp; Accedi</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function renderLoginPage(error = "") {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Accedi al Gestionale • Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #121214;
      color: #FAFAFA;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .auth-card {
      background: #18181B;
      border: 1px solid #27272A;
      border-radius: 16px;
      padding: 40px 32px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.7);
    }
    .brand-header {
      text-align: center;
      margin-bottom: 28px;
    }
    .brand-title {
      font-size: 20px;
      font-weight: 700;
      color: #FFF;
      letter-spacing: -0.01em;
      margin-top: 10px;
    }
    .brand-sub {
      color: #A1A1AA;
      font-size: 13px;
      margin-top: 4px;
    }
    .error-box {
      background: #EF444422;
      border: 1px solid #EF4444;
      color: #F87171;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 20px;
    }
    .form-group {
      margin-bottom: 18px;
      text-align: left;
    }
    label {
      display: block;
      font-size: 12.5px;
      font-weight: 600;
      color: #E4E4E7;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      background: #09090B;
      border: 1px solid #3F3F46;
      color: #FFF;
      padding: 11px 14px;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.2s;
    }
    input:focus {
      outline: none;
      border-color: #D98295;
      box-shadow: 0 0 0 2px #D9829533;
    }
    .btn-submit {
      width: 100%;
      background: #D98295;
      color: #121214;
      font-weight: 700;
      font-size: 14px;
      padding: 12px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      margin-top: 8px;
      transition: opacity 0.2s;
    }
    .btn-submit:hover { opacity: 0.9; }
    .back-link {
      display: block;
      text-align: center;
      margin-top: 24px;
      color: #71717A;
      font-size: 12.5px;
      text-decoration: none;
    }
    .back-link:hover { color: #A1A1AA; }
  </style>
</head>
<body>
  <div class="auth-card">
    <div class="brand-header">
      <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#D98295" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <h1 class="brand-title">Cervelli in Affitto APS</h1>
      <p class="brand-sub">Area Riservata • Pannello Amministrativo</p>
    </div>

    ${error ? `<div class="error-box">${error}</div>` : ""}

    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label>Email</label>
        <input type="email" name="email" placeholder="admin@cervellinaffitto-aps.it" required autofocus>
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" name="password" placeholder="••••••••••••" required>
      </div>
      <button type="submit" class="btn-submit">Accedi al Gestionale</button>
    </form>

    <a href="/" class="back-link">← Torna al Portale Pubblico</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

/* =========================================================================
   PORTALE PUBBLICO: WIZARD A 5 STEP PER MINORI & DOMANDA SOCIO
   ========================================================================= */

function renderPublicWizard(step, isSuccess, params) {
  if (isSuccess) {
    return renderSuccessPage(params.get("socio") || "Socio");
  }

  const stepTitles = [
    "Dati Anagrafici Minore",
    "Genitore / Tutore Legale",
    "Deleghe al Ritiro",
    "Statuto & Consensi",
    "Riepilogo & Firma"
  ];

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iscrizione Corsi & Domanda Socio • Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --coral: #D98295;
      --silver: #E8E7E9;
      --dark: #121214;
      --card-bg: #FFFFFF;
      --text: #1F2937;
      --border: #E5E7EB;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #F9FAFB;
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    header.pub-header {
      background: var(--dark);
      color: #FFF;
      padding: 24px 20px;
      text-align: center;
      border-bottom: 2px solid var(--coral);
    }
    .brand-title {
      font-size: 20px;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .brand-sub {
      color: #9CA3AF;
      font-size: 13px;
      margin-top: 4px;
    }
    .wizard-container {
      max-width: 680px;
      width: 100%;
      margin: 30px auto;
      padding: 0 16px;
      flex: 1;
    }
    .wizard-progress {
      display: flex;
      justify-content: space-between;
      margin-bottom: 24px;
      position: relative;
    }
    .wizard-progress::before {
      content: "";
      position: absolute;
      top: 14px;
      left: 10px;
      right: 10px;
      height: 2px;
      background: #E5E7EB;
      z-index: 1;
    }
    .step-item {
      position: relative;
      z-index: 2;
      text-align: center;
      width: 40px;
    }
    .step-circle {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: #FFF;
      border: 2px solid #D1D5DB;
      color: #6B7280;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 700;
      margin: 0 auto;
      transition: all 0.2s;
    }
    .step-item.active .step-circle {
      border-color: var(--coral);
      background: var(--coral);
      color: #121214;
    }
    .step-item.done .step-circle {
      border-color: #10B981;
      background: #10B981;
      color: #FFF;
    }
    .step-label {
      font-size: 10.5px;
      color: #6B7280;
      margin-top: 6px;
      display: none;
    }
    @media (min-width: 640px) {
      .step-item { width: 80px; }
      .step-label { display: block; }
    }
    .form-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 30px 24px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);
    }
    .step-header {
      margin-bottom: 24px;
      border-bottom: 1px solid var(--border);
      padding-bottom: 14px;
    }
    .step-header h2 {
      font-size: 19px;
      font-weight: 700;
      color: var(--dark);
    }
    .step-header p {
      font-size: 13px;
      color: #6B7280;
      margin-top: 4px;
    }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 600px) {
      .form-grid.two-cols { grid-template-columns: 1fr 1fr; }
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    label {
      font-size: 12.5px;
      font-weight: 600;
      color: #374151;
    }
    input, select, textarea {
      padding: 10px 12px;
      border: 1px solid #D1D5DB;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      color: #111827;
      background: #FFF;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--coral);
      box-shadow: 0 0 0 2px #D9829533;
    }
    .checkbox-item {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 12px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #F9FAFB;
      margin-bottom: 10px;
    }
    .checkbox-item input[type="checkbox"] {
      margin-top: 3px;
      accent-color: var(--coral);
      width: 16px;
      height: 16px;
    }
    .checkbox-item label {
      font-size: 12.5px;
      font-weight: 500;
      line-height: 1.4;
      cursor: pointer;
    }
    .wizard-actions {
      display: flex;
      justify-content: space-between;
      margin-top: 28px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
    }
    .btn-prev {
      background: #E5E7EB;
      color: #374151;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13.5px;
      font-weight: 600;
      border: none;
      cursor: pointer;
    }
    .btn-next {
      background: var(--coral);
      color: #121214;
      padding: 10px 24px;
      border-radius: 8px;
      font-size: 13.5px;
      font-weight: 700;
      border: none;
      cursor: pointer;
      margin-left: auto;
    }
    .btn-submit-final {
      background: #10B981;
      color: #FFF;
      padding: 12px 28px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      border: none;
      cursor: pointer;
      margin-left: auto;
    }
    footer.pub-footer {
      background: var(--dark);
      color: #9CA3AF;
      text-align: center;
      padding: 20px;
      font-size: 12px;
      margin-top: auto;
      border-top: 1px solid #27272A;
    }
  </style>
</head>
<body>

  <header class="pub-header">
    <div class="brand-title">Cervelli in Affitto APS</div>
    <div class="brand-sub">Affiliata UILT • Laboratori Teatrali Bambini &amp; Ragazzi</div>
  </header>

  <div class="wizard-container">
    <div class="wizard-progress">
      ${stepTitles.map((title, idx) => {
        const num = idx + 1;
        const cls = num < step ? "done" : num === step ? "active" : "";
        return `
          <div class="step-item ${cls}">
            <div class="step-circle">${num < step ? "✓" : num}</div>
            <div class="step-label">${title}</div>
          </div>
        `;
      }).join("")}
    </div>

    <form method="POST" action="/iscrizione-minori" id="wizardForm" class="form-card">
      <input type="hidden" name="step" id="currentStepInput" value="${step}">

      <!-- STEP 1: DATI MINORE -->
      <div id="step-1" class="wizard-step-pane" style="${step === 1 ? "" : "display:none;"}">
        <div class="step-header">
          <h2>Passo 1: Dati Anagrafici dell'Allievo Minore</h2>
          <p>Compila i dati del minore che frequenterà il laboratorio teatrale e diventerà socio ordinario APS.</p>
        </div>
        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Nome del Minore *</label>
            <input type="text" name="minore_nome" required>
          </div>
          <div class="form-group">
            <label>Cognome del Minore *</label>
            <input type="text" name="minore_cognome" required>
          </div>
        </div>
        <div class="form-grid two-cols" style="margin-top: 14px;">
          <div class="form-group">
            <label>Codice Fiscale Minore *</label>
            <input type="text" name="minore_cf" maxlength="16" placeholder="Es. RSSMRA10A01F205Z" required>
          </div>
          <div class="form-group">
            <label>Data di Nascita *</label>
            <input type="date" name="minore_data_nascita" required>
          </div>
        </div>
        <div class="form-grid two-cols" style="margin-top: 14px;">
          <div class="form-group">
            <label>Luogo di Nascita *</label>
            <input type="text" name="minore_luogo_nascita" placeholder="Comune o Stato estero" required>
          </div>
          <div class="form-group">
            <label>Indirizzo di Residenza *</label>
            <input type="text" name="minore_indirizzo" placeholder="Via, Civico, Comune, CAP" required>
          </div>
        </div>
      </div>

      <!-- STEP 2: TUTORE LEGALE -->
      <div id="step-2" class="wizard-step-pane" style="${step === 2 ? "" : "display:none;"}">
        <div class="step-header">
          <h2>Passo 2: Genitore o Tutore Legale Esercente la Responsabilità</h2>
          <p>Dati dell'adulto referente che sottoscrive la richiesta di ammissione e l'iscrizione.</p>
        </div>
        <div class="form-grid two-cols">
          <div class="form-group">
            <label>Nome Genitore / Tutore *</label>
            <input type="text" name="tutore_nome">
          </div>
          <div class="form-group">
            <label>Cognome Genitore / Tutore *</label>
            <input type="text" name="tutore_cognome">
          </div>
        </div>
        <div class="form-grid two-cols" style="margin-top: 14px;">
          <div class="form-group">
            <label>Codice Fiscale Genitore *</label>
            <input type="text" name="tutore_cf" maxlength="16">
          </div>
          <div class="form-group">
            <label>Grado di Parentela *</label>
            <select name="tutore_ruolo">
              <option value="Madre">Madre</option>
              <option value="Padre">Padre</option>
              <option value="Tutore Legale">Tutore Legale</option>
              <option value="Affidatario">Affidatario</option>
            </select>
          </div>
        </div>
        <div class="form-grid two-cols" style="margin-top: 14px;">
          <div class="form-group">
            <label>Telefono Cellulare *</label>
            <input type="tel" name="tutore_telefono" placeholder="Es. 3401234567">
          </div>
          <div class="form-group">
            <label>Email Ufficiale (per comunicazioni e ricevute) *</label>
            <input type="email" name="tutore_email" placeholder="esempio@email.it">
          </div>
        </div>
      </div>

      <!-- STEP 3: DELEGHE AL RITIRO -->
      <div id="step-3" class="wizard-step-pane" style="${step === 3 ? "" : "display:none;"}">
        <div class="step-header">
          <h2>Passo 3: Persone Delegate al Ritiro dell'Allievo (Facoltativo)</h2>
          <p>Indica fino a due persone maggiorenni autorizzate a ritirare il minore al termine della lezione.</p>
        </div>
        <div style="background: #F3F4F6; padding: 14px; border-radius: 8px; margin-bottom: 14px;">
          <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 10px;">Delegato N° 1</h4>
          <div class="form-grid two-cols">
            <div class="form-group"><label>Nome e Cognome</label><input type="text" name="delega1_nome" placeholder="Es. Mario Rossi"></div>
            <div class="form-group"><label>Telefono</label><input type="tel" name="delega1_telefono" placeholder="Es. 3471122334"></div>
          </div>
          <div class="form-group" style="margin-top: 10px;"><label>Relazione di parentela / fiducia</label><input type="text" name="delega1_relazione" placeholder="Es. Nonno, Zia, Babysitter"></div>
        </div>

        <div style="background: #F3F4F6; padding: 14px; border-radius: 8px;">
          <h4 style="font-size: 13px; font-weight: 700; margin-bottom: 10px;">Delegato N° 2</h4>
          <div class="form-grid two-cols">
            <div class="form-group"><label>Nome e Cognome</label><input type="text" name="delega2_nome" placeholder="Es. Anna Bianchi"></div>
            <div class="form-group"><label>Telefono</label><input type="tel" name="delega2_telefono" placeholder="Es. 3489988776"></div>
          </div>
          <div class="form-group" style="margin-top: 10px;"><label>Relazione di parentela / fiducia</label><input type="text" name="delega2_relazione" placeholder="Es. Zio, Amico di famiglia"></div>
        </div>
      </div>

      <!-- STEP 4: STATUTO & PRIVACY -->
      <div id="step-4" class="wizard-step-pane" style="${step === 4 ? "" : "display:none;"}">
        <div class="step-header">
          <h2>Passo 4: Accettazione Statuto APS &amp; Consensi Privacy</h2>
          <p>Condizioni di ammissione a socio e tesseramento obbligatorio UILT.</p>
        </div>
        
        <div class="checkbox-item">
          <input type="checkbox" id="chk_statuto" name="accettazione_statuto" value="1" required>
          <label for="chk_statuto">
            <strong>Dichiaro di aver preso visione e di accettare integralmente lo Statuto e i Regolamenti interni di Cervelli in Affitto APS</strong>, nonché di condividere gli scopi associativi e culturali per conto del minore. (Obbligatorio)
          </label>
        </div>

        <div class="checkbox-item">
          <input type="checkbox" id="chk_privacy" name="consenso_privacy" value="1" required>
          <label for="chk_privacy">
            <strong>Acconsento al trattamento dei dati personali del minore e del sottoscritto</strong> ai sensi del Regolamento UE 2016/679 (GDPR), per finalità istituzionali, amministrative e per la copertura assicurativa UILT. (Obbligatorio)
          </label>
        </div>

        <div class="checkbox-item">
          <input type="checkbox" id="chk_foto" name="consenso_foto_video" value="1">
          <label for="chk_foto">
            <strong>Autorizzo riprese foto e video durante i laboratori e saggi teatrali</strong> ad esclusivo scopo documentale, promozionale delle attività dell'APS sui propri canali e archivi istituzionali. (Facoltativo)
          </label>
        </div>

        <div class="checkbox-item">
          <input type="checkbox" id="chk_news" name="consenso_newsletter" value="1">
          <label for="chk_news">
            Autorizzo la ricezione di comunicazioni teatrali, calendario spettacoli e inviti dell'APS via email o WhatsApp. (Facoltativo)
          </label>
        </div>
      </div>

      <!-- STEP 5: RIEPILOGO & INVIO -->
      <div id="step-5" class="wizard-step-pane" style="${step === 5 ? "" : "display:none;"}">
        <div class="step-header">
          <h2>Passo 5: Riepilogo &amp; Invio Richiesta</h2>
          <p>Verifica i dati inseriti prima di trasmettere ufficialmente la domanda al Consiglio Direttivo.</p>
        </div>
        
        <div style="background: #F3F4F6; border-left: 4px solid var(--coral); padding: 16px; border-radius: 6px; font-size: 13px; line-height: 1.6; margin-bottom: 20px;">
          <strong>Procedura di Delibera Associativa:</strong><br>
          L'invio di questo modulo costituisce formale richiesta di ammissione a socio ordinario per il minore e pre-iscrizione al laboratorio teatrale.
          La domanda sarà esaminata e ratificata dal Consiglio Direttivo dell'APS alla prima riunione utile, con contestuale assegnazione del numero di tessera e attivazione della copertura assicurativa UILT.
        </div>

        <p style="font-size: 13.5px; color: #4B5563; text-align: center; margin: 20px 0;">
          Cliccando su <strong>"Invia Domanda di Ammissione &amp; Iscrizione"</strong> confermi la veridicità di tutti i dati dichiarati.
        </p>
      </div>

      <!-- BOTTONI AVANTI / INDIETRO WIZARD -->
      <div class="wizard-actions">
        <button type="button" class="btn-prev" id="prevBtn" style="display: none;">← Indietro</button>
        <button type="button" class="btn-next" id="nextBtn">Continua →</button>
        <button type="submit" class="btn-submit-final" id="submitBtn" style="display: none;">Invia Domanda di Ammissione &amp; Iscrizione</button>
      </div>
    </form>
  </div>

  <footer class="pub-footer">
    Cervelli in Affitto APS • Sede Legale: Via del Teatro, Forlì • C.F. 92095390400 • Affiliata UILT
  </footer>

  <script>
    let currentStep = ${step};
    const totalSteps = 5;

    const prevBtn = document.getElementById("prevBtn");
    const nextBtn = document.getElementById("nextBtn");
    const submitBtn = document.getElementById("submitBtn");
    const stepInput = document.getElementById("currentStepInput");

    function updateStepView() {
      for (let i = 1; i <= totalSteps; i++) {
        const pane = document.getElementById("step-" + i);
        if (pane) pane.style.display = i === currentStep ? "block" : "none";
      }

      document.querySelectorAll(".step-item").forEach((el, idx) => {
        const n = idx + 1;
        el.className = "step-item " + (n < currentStep ? "done" : n === currentStep ? "active" : "");
      });

      prevBtn.style.display = currentStep > 1 ? "block" : "none";
      if (currentStep === totalSteps) {
        nextBtn.style.display = "none";
        submitBtn.style.display = "block";
      } else {
        nextBtn.style.display = "block";
        submitBtn.style.display = "none";
      }
      stepInput.value = currentStep;
      window.scrollTo({ top: 0, behavior: "smooth" });
    }

    nextBtn.addEventListener("click", () => {
      // Validazione rapida campi obbligatori del pane corrente
      const curPane = document.getElementById("step-" + currentStep);
      const reqInputs = curPane.querySelectorAll("input[required], select[required]");
      for (const input of reqInputs) {
        if (!input.checkValidity()) {
          input.reportValidity();
          return;
        }
      }
      if (currentStep < totalSteps) {
        currentStep++;
        updateStepView();
      }
    });

    prevBtn.addEventListener("click", () => {
      if (currentStep > 1) {
        currentStep--;
        updateStepView();
      }
    });

    updateStepView();
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function renderSuccessPage(nomeSocio) {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Domanda Ricevuta • Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #F9FAFB;
      color: #1F2937;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card-success {
      background: #FFF;
      border: 1px solid #E5E7EB;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 540px;
      text-align: center;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);
    }
    .icon-success {
      width: 64px;
      height: 64px;
      background: #10B98120;
      color: #10B981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 12px;
    }
    p {
      font-size: 14px;
      color: #4B5563;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .info-box {
      background: #F3F4F6;
      border-radius: 8px;
      padding: 16px;
      font-size: 13px;
      text-align: left;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .btn-home {
      display: inline-block;
      background: #D98295;
      color: #121214;
      font-weight: 700;
      font-size: 13.5px;
      padding: 11px 22px;
      border-radius: 8px;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="card-success">
    <div class="icon-success">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
    </div>
    <h1>Richiesta Inviata con Successo!</h1>
    <p>Grazie per aver compilato la richiesta di iscrizione per <strong>${nomeSocio}</strong>.</p>
    <div class="info-box">
      <strong>Cosa succede ora?</strong><br>
      1. Il Consiglio Direttivo di <em>Cervelli in Affitto APS</em> delibererà l'ammissione a socio.<br>
      2. Riceverai un'email di conferma con il numero di tessera APS e le istruzioni per il perfezionamento del tesseramento UILT.
    </div>
    <a href="/" class="btn-home">Torna alla Pagina Iniziale</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

/* =========================================================================
   PORTALE PUBBLICO: SALVATAGGIO DATI SU CLOUDFLARE D1
   ========================================================================= */

async function handleIscrizionePost(request, env, url) {
  try {
    const formData = await request.formData();

    const minoreNome = (formData.get("minore_nome") || "").toString().trim();
    const minoreCognome = (formData.get("minore_cognome") || "").toString().trim();
    const minoreCf = (formData.get("minore_cf") || "").toString().trim().toUpperCase();
    const minoreNascita = (formData.get("minore_data_nascita") || "").toString().trim();
    const minoreLuogo = (formData.get("minore_luogo_nascita") || "").toString().trim();
    const minoreIndirizzo = (formData.get("minore_indirizzo") || "").toString().trim();

    const tutoreNome = (formData.get("tutore_nome") || "").toString().trim();
    const tutoreCognome = (formData.get("tutore_cognome") || "").toString().trim();
    const tutoreCf = (formData.get("tutore_cf") || "").toString().trim().toUpperCase();
    const tutoreRuolo = (formData.get("tutore_ruolo") || "Genitore").toString().trim();
    const tutoreTelefono = (formData.get("tutore_telefono") || "").toString().trim();
    const tutoreEmail = (formData.get("tutore_email") || "").toString().trim().toLowerCase();

    const delega1Nome = (formData.get("delega1_nome") || "").toString().trim();
    const delega1Tel = (formData.get("delega1_telefono") || "").toString().trim();
    const delega1Rel = (formData.get("delega1_relazione") || "").toString().trim();

    const delega2Nome = (formData.get("delega2_nome") || "").toString().trim();
    const delega2Tel = (formData.get("delega2_telefono") || "").toString().trim();
    const delega2Rel = (formData.get("delega2_relazione") || "").toString().trim();

    const accettaStatuto = formData.get("accettazione_statuto") === "1" ? 1 : 0;
    const consensoPrivacy = formData.get("consenso_privacy") === "1" ? 1 : 0;
    const consensoFoto = formData.get("consenso_foto_video") === "1" ? 1 : 0;
    const consensoNews = formData.get("consenso_newsletter") === "1" ? 1 : 0;

    if (!minoreNome || !minoreCognome || !minoreCf) {
      return new Response("Dati del minore incompleti.", { status: 400 });
    }

    // Assicura l'esistenza del corso di riferimento
    await env.DB.prepare(`
      INSERT OR IGNORE INTO attivita_eventi (id, tipo, titolo, descrizione, anno_sociale, attivo)
      VALUES (?, 'corso', 'Laboratorio Teatrale Bambini e Ragazzi', 'Corso propedeutico di teatro per minori', 2026, 1)
    `).bind(DEFAULT_CORSO_ID).run();

    // 1. Inserimento Tutore (o recupero se già presente)
    let tutoreId = null;
    if (tutoreCf) {
      const existingTutore = await env.DB.prepare("SELECT id FROM tutori WHERE codice_fiscale = ?").bind(tutoreCf).first();
      if (existingTutore) {
        tutoreId = existingTutore.id;
        await env.DB.prepare(`
          UPDATE tutori SET nome = ?, cognome = ?, telefono = ?, email = ?, grado_parentela = ? WHERE id = ?
        `).bind(tutoreNome, tutoreCognome, tutoreTelefono, tutoreEmail, tutoreRuolo, tutoreId).run();
      } else {
        tutoreId = "tut-" + Date.now();
        await env.DB.prepare(`
          INSERT INTO tutori (id, nome, cognome, codice_fiscale, telefono, email, grado_parentela)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(tutoreId, tutoreNome, tutoreCognome, tutoreCf, tutoreTelefono, tutoreEmail, tutoreRuolo).run();
      }
    }

    // 2. Inserimento Minore come Socio Ordinario (in attesa di delibera)
    let socioId = null;
    const existingSocio = await env.DB.prepare("SELECT id FROM soci WHERE codice_fiscale = ?").bind(minoreCf).first();
    if (existingSocio) {
      socioId = existingSocio.id;
      await env.DB.prepare(`
        UPDATE soci 
        SET nome = ?, cognome = ?, data_nascita = ?, luogo_nascita = ?, residenza_indirizzo = ?, tutore_id = ?, updated_at = datetime('now')
        WHERE id = ?
      `).bind(minoreNome, minoreCognome, minoreNascita, minoreLuogo, minoreIndirizzo, tutoreId, socioId).run();
    } else {
      socioId = "soc-" + Date.now();
      await env.DB.prepare(`
        INSERT INTO soci (
          id, tipo_socio, is_minore, tutore_id, nome, cognome, codice_fiscale,
          data_nascita, luogo_nascita, residenza_indirizzo, email, telefono,
          stato_richiesta, anno_adesione, data_domanda
        ) VALUES (
          ?, 'ordinario', 1, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          'in_attesa', 2026, datetime('now')
        )
      `).bind(
        socioId, tutoreId, minoreNome, minoreCognome, minoreCf,
        minoreNascita, minoreLuogo, minoreIndirizzo, tutoreEmail, tutoreTelefono
      ).run();
    }

    // 3. Iscrizione al Corso Teatrale
    await env.DB.prepare(`
      INSERT OR REPLACE INTO iscrizioni_corsi (id, socio_id, attivita_id, stato_iscrizione, data_iscrizione)
      VALUES (?, ?, ?, 'confermata', datetime('now'))
    `).bind("isc-" + socioId, socioId, DEFAULT_CORSO_ID).run();

    // 4. Inserimento Deleghe
    if (delega1Nome) {
      await env.DB.prepare(`
        INSERT INTO deleghe_ritiro (id, socio_minore_id, nome, cognome, telefono, relazione)
        VALUES (?, ?, ?, '', ?, ?)
      `).bind("del1-" + socioId, socioId, delega1Nome, delega1Tel, delega1Rel).run();
    }
    if (delega2Nome) {
      await env.DB.prepare(`
        INSERT INTO deleghe_ritiro (id, socio_minore_id, nome, cognome, telefono, relazione)
        VALUES (?, ?, ?, '', ?, ?)
      `).bind("del2-" + socioId, socioId, delega2Nome, delega2Tel, delega2Rel).run();
    }

    // 5. Consensi Privacy & Statuto
    await env.DB.prepare(`
      INSERT OR REPLACE INTO consensi_privacy (
        id, socio_id, accettazione_statuto, consenso_trattamento_dati,
        consenso_foto_video, consenso_newsletter, data_consenso
      ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).bind("cons-" + socioId, socioId, accettaStatuto, consensoPrivacy, consensoFoto, consensoNews).run();

    return new Response(null, {
      status: 302,
      headers: {
        Location: `/?success=1&socio=${encodeURIComponent(minoreNome + " " + minoreCognome)}`
      }
    });
  } catch (err) {
    console.error("Errore salvataggio domanda:", err);
    return new Response("Errore durante il salvataggio dei dati: " + err.message, { status: 500 });
  }
}
