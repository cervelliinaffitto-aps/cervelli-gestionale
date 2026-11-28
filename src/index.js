/**
 * Cervelli in Affitto APS - Piattaforma Gestionale Integrata
 * - Portale Pubblico: Modulo Iscrizione Corsi Minori & Domanda Socio (Wizard a 5 Step)
 * - Area Riservata: Login Super Admin, Dashboard Generale con Hub Macro-Aree (Bibbia v2.4)
 * - Macro-Area 4.2: Builder Tema & Identità Visiva (Palette Colori, Logo, Font, Dati D1)
 *
 * Dominio: cervelliinaffitto-aps.it
 * Autore: Cervelli in Affitto APS / Lovable Platform
 */

/* =========================================================================
   CONFIGURAZIONI E COSTANTI DI SICUREZZA
   ========================================================================= */

const SESSION_COOKIE_NAME = "cervelli_admin_sess";
const SESSION_DURATION_HOURS = 12;
const PBKDF2_SALT = "cervelli_aps_secure_salt_2026_uilt";

// Configurazione predefinita del tema (usata se la tabella D1 non è ancora popolata)
const DEFAULT_THEME = {
  nome_associazione: "Cervelli in Affitto APS",
  dominio_ufficiale: "cervelliinaffitto-aps.it",
  colore_primario: "#D98295",      // Rosa Cervello teatrale
  colore_secondario: "#E8E7E9",    // Argento Maschere
  colore_scuro: "#121214",         // Nero Ribalta
  colore_sfondo: "#18181B",        // Grigio scuro per card admin
  colore_accento: "#10B981",       // Verde per stati completati/attivi
  colore_testo: "#FAFAFA",         // Bianco crema per testi
  scala_font: "normale",           // normale, compatta, grande
  url_logo: "https://lh3.googleusercontent.com/d/1h-xfyBoxK5TuAsx-FamJIXf3nFh7FVoO",
  email_contatto: "info@cervelliinaffitto-aps.it"
};

/* =========================================================================
   HANDLER PRINCIPALE DI ENTRATA (WORKER FETCH)
   ========================================================================= */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Endpoint diagnostico per verificare tabelle e connessione D1
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

    // Rotte dell'Area Amministrativa e Gestionale (/admin e sottomenu)
    if (url.pathname.startsWith("/admin")) {
      return handleAdminRoutes(request, env, url);
    }

    // Rotte del Portale Pubblico (Modulo Iscrizione Corsi Minori & Domanda Socio)
    return handlePublicRoutes(request, env, url, ctx);
  }
};

/* =========================================================================
   CARICAMENTO DINAMICO DELLE IMPOSTAZIONI DAL DATABASE D1
   ========================================================================= */

async function getThemeSettings(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT chiave, valore FROM impostazioni_gestionale"
    ).all();

    if (!results || results.length === 0) {
      return { ...DEFAULT_THEME };
    }

    const config = { ...DEFAULT_THEME };
    for (const row of results) {
      if (row.valore !== null && row.valore !== undefined) {
        config[row.chiave] = row.valore;
      }
    }
    return config;
  } catch (err) {
    console.warn("Tabella impostazioni_gestionale non ancora disponibile, uso valori di fallback:", err.message);
    return { ...DEFAULT_THEME };
  }
}

/* =========================================================================
   SALVATAGGIO CONFIGURAZIONI TEMA SU D1 (POST DA ADMIN BUILDER TEMA)
   ========================================================================= */

async function handleSalvaTemaPost(request, env, user) {
  try {
    const form = await request.formData();

    const chiaviPermesse = [
      "nome_associazione",
      "dominio_ufficiale",
      "colore_primario",
      "colore_secondario",
      "colore_scuro",
      "colore_sfondo",
      "colore_accento",
      "colore_testo",
      "scala_font",
      "url_logo",
      "email_contatto"
    ];

    const statements = [];
    for (const chiave of chiaviPermesse) {
      const val = form.get(chiave);
      if (val !== null && val !== undefined) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO impostazioni_gestionale (chiave, valore, data_aggiornamento)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(chiave) DO UPDATE SET valore=excluded.valore, data_aggiornamento=datetime('now')`
          ).bind(chiave, val.toString().trim())
        );
      }
    }

    if (statements.length > 0) {
      await env.DB.batch(statements);
    }

    return new Response(null, {
      status: 302,
      headers: { Location: "/admin?view=theme-builder&msg=tema_salvato" }
    });
  } catch (e) {
    console.error("Errore salvataggio tema:", e);
    return new Response(null, {
      status: 302,
      headers: { Location: `/admin?view=theme-builder&msg=err_salvataggio&err=${encodeURIComponent(e.message)}` }
    });
  }
}

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

  // Salvataggio Builder Tema POST (Macro-Area 4.2)
  if (url.pathname === "/admin/salva-tema" && request.method === "POST") {
    const session = await getAdminSession(request, env);
    if (!session) {
      return new Response(null, { status: 302, headers: { Location: "/admin" } });
    }
    return handleSalvaTemaPost(request, env, session.user);
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
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  return Array.from(new Uint8Array(exported))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateSecureToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getAdminSession(request, env) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;

  const cookies = Object.fromEntries(
    cookieHeader.split(";").map(c => {
      const parts = c.trim().split("=");
      return [parts[0], parts.slice(1).join("=")];
    })
  );

  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  try {
    const row = await env.DB.prepare(`
      SELECT s.id as session_id, s.utente_id, u.nome, u.cognome, u.email, u.ruolo
      FROM sessioni_admin s
      JOIN utenti_gestionale u ON s.utente_id = u.id
      WHERE s.token = ? AND datetime(s.scadenza) > datetime('now')
      LIMIT 1
    `).bind(token).first();

    if (!row) return null;

    return {
      session_id: row.session_id,
      user: {
        id: row.utente_id,
        nome: row.nome,
        cognome: row.cognome,
        email: row.email,
        ruolo: row.ruolo
      }
    };
  } catch (err) {
    console.error("Errore verifica sessione:", err);
    return null;
  }
}

async function handleSetupPost(request, env) {
  try {
    const countRow = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM utenti_gestionale WHERE ruolo = 'super_admin'"
    ).first();

    if (countRow && countRow.count > 0) {
      return new Response("Setup già completato. Effettua il login.", { status: 403 });
    }

    const form = await request.formData();
    const nome = form.get("nome")?.trim();
    const cognome = form.get("cognome")?.trim();
    const email = form.get("email")?.trim().toLowerCase();
    const password = form.get("password");

    if (!nome || !cognome || !email || !password) {
      return renderSetupPage("Tutti i campi sono obbligatori.");
    }

    if (password.length < 8) {
      return renderSetupPage("La password deve contenere almeno 8 caratteri.");
    }

    const passwordHash = await hashPassword(password);

    await env.DB.prepare(`
      INSERT INTO utenti_gestionale (nome, cognome, email, password_hash, ruolo, attivo, creato_il)
      VALUES (?, ?, ?, ?, 'super_admin', 1, datetime('now'))
    `).bind(nome, cognome, email, passwordHash).run();

    return new Response(null, {
      status: 302,
      headers: { Location: "/admin?setup=success" }
    });
  } catch (err) {
    console.error("Errore setup:", err);
    return renderSetupPage("Errore durante la creazione del Super Admin: " + err.message);
  }
}

async function handleLoginPost(request, env) {
  try {
    const form = await request.formData();
    const email = form.get("email")?.trim().toLowerCase();
    const password = form.get("password");

    if (!email || !password) {
      return renderLoginPage("Inserisci sia l'email che la password.");
    }

    const user = await env.DB.prepare(`
      SELECT id, nome, cognome, email, password_hash, ruolo, attivo
      FROM utenti_gestionale
      WHERE email = ? AND attivo = 1
      LIMIT 1
    `).bind(email).first();

    if (!user) {
      return renderLoginPage("Credenziali non valide o utente non attivo.");
    }

    const inputHash = await hashPassword(password);
    if (inputHash !== user.password_hash) {
      return renderLoginPage("Credenziali non valide.");
    }

    const token = generateSecureToken();

    await env.DB.prepare(`
      INSERT INTO sessioni_admin (utente_id, token, scadenza, creata_il)
      VALUES (?, ?, datetime('now', '+${SESSION_DURATION_HOURS} hours'), datetime('now'))
    `).bind(user.id, token).run();

    const cookieValue = `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_HOURS * 3600}; Secure`;

    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/admin?view=dashboard",
        "Set-Cookie": cookieValue
      }
    });
  } catch (err) {
    console.error("Errore durante il login:", err);
    return renderLoginPage("Errore di sistema durante l'accesso.");
  }
}

async function handleLogout(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = Object.fromEntries(
    cookieHeader.split(";").map(c => {
      const parts = c.trim().split("=");
      return [parts[0], parts.slice(1).join("=")];
    })
  );

  const token = cookies[SESSION_COOKIE_NAME];
  if (token) {
    try {
      await env.DB.prepare("DELETE FROM sessioni_admin WHERE token = ?").bind(token).run();
    } catch (e) {
      console.warn("Errore eliminazione token sessione:", e);
    }
  }

  const deleteCookie = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax`;
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/admin",
      "Set-Cookie": deleteCookie
    }
  });
}

/* =========================================================================
   DELIBERA DEL CONSIGLIO DIRETTIVO E ASSEGNAZIONE TESSERA APS
   ========================================================================= */

async function handleDeliberaPost(request, env, user) {
  try {
    const form = await request.formData();
    const socioId = form.get("socio_id");
    const dataDelibera = form.get("data_delibera");
    const numeroVerbale = form.get("numero_verbale")?.trim();
    const numeroTessera = form.get("numero_tessera")?.trim();
    const dataSaldoQuota = form.get("data_saldo_quota");
    const modalitaPagamento = form.get("modalita_pagamento") || "contanti";

    if (!socioId || !dataDelibera || !numeroVerbale || !numeroTessera) {
      return new Response("Tutti i campi di delibera sono obbligatori.", { status: 400 });
    }

    const statements = [
      env.DB.prepare(`
        UPDATE soci
        SET stato_iscrizione = 'attivo',
            data_ammissione = ?,
            delibera_verbale_ammissione = ?,
            numero_tessera_aps = ?,
            aggiornato_il = datetime('now')
        WHERE id = ?
      `).bind(dataDelibera, numeroVerbale, numeroTessera, socioId),

      env.DB.prepare(`
        UPDATE quote_sociali
        SET stato_pagamento = 'saldato',
            data_pagamento = ?,
            modalita_pagamento = ?
        WHERE socio_id = ?
      `).bind(dataSaldoQuota || dataDelibera, modalitaPagamento, socioId)
    ];

    await env.DB.batch(statements);

    return new Response(null, {
      status: 302,
      headers: { Location: "/admin?view=domande&msg=delibera_completata" }
    });
  } catch (err) {
    console.error("Errore durante la delibera:", err);
    return new Response("Errore durante il salvataggio della delibera: " + err.message, { status: 500 });
  }
}

/* =========================================================================
   DEFINIZIONE DELLA STRUTTURA UFFICIALE DEL GESTIONALE (BIBBIA v2.4)
   ========================================================================= */

const MACRO_AREE = [
  {
    id: "soci",
    numero: "1",
    titolo: "Soci & Libro Soci",
    icona: "users",
    colore: "#D98295",
    descrizione: "Gestione domande di ammissione, Libro Soci ufficiale, anagrafiche minori, quote sociali e tesseramento nazionale UILT.",
    sezioni: [
      { id: "domande", etichetta: "1.1 Domande Ammissione", desc: "Verifica e delibera delle richieste di nuovi soci o minori dei laboratori." },
      { id: "libro-soci", etichetta: "1.2 Libro Soci Ufficiale", desc: "Registro anagrafico soci attivi con stato quota APS e data verbale delibera." },
      { id: "tutori-minori", etichetta: "1.3 Tutori & Minori", desc: "Elenco genitori, deleghe di ritiro per i corsi e contatti per emergenze." },
      { id: "uilt", etichetta: "1.4 Tesseramento UILT", desc: "Copertura infortuni/RC e caricamento attestati tessera UILT in PDF." }
    ]
  },
  {
    id: "corsi",
    numero: "2",
    titolo: "Attività & Corsi",
    icona: "graduation-cap",
    colore: "#38BDF8",
    descrizione: "Laboratori teatrali per bambini, ragazzi e adulti, registri allievi, quote di frequenza e foglio presenze.",
    sezioni: [
      { id: "laboratori", etichetta: "2.1 Elenco Corsi & Laboratori", desc: "Corsi teatrali attivi, fasce orarie, sedi di svolgimento e docenti." },
      { id: "presenze", etichetta: "2.2 Registro Presenze", desc: "Foglio presenze lezioni con spunta allievi presenti ed esportazione PDF." },
      { id: "quote-corsi", etichetta: "2.3 Quote & Rate Frequenza", desc: "Stato dei pagamenti mensili o quadrimestrali per la frequenza ai laboratori." }
    ]
  },
  {
    id: "teatro",
    numero: "3",
    titolo: "Eventi, Teatro & Casse",
    icona: "ticket",
    colore: "#F59E0B",
    descrizione: "Cartellone spettacoli, cene con delitto, eventi sul territorio, gestione prenotazioni e casse distinte.",
    sezioni: [
      { id: "cartellone", etichetta: "3.1 Cartellone Spettacoli", desc: "Stagione teatrale, date di debutto e repliche con mappa posti a sedere." },
      { id: "altri-eventi", etichetta: "3.2 Cene con Delitto & Eventi", desc: "Eventi gastronomici e animazioni con moduli di iscrizione dedicati." },
      { id: "prenotazioni", etichetta: "3.3 Gestione Prenotazioni", desc: "Ricerca persistente, modifica capienza, omaggi e ingressi con codice univoco." },
      { id: "cassa-teatro", etichetta: "3.4 Cassa Spettacoli Teatrali", desc: "Biglietteria sul posto, gestione piantina platea e saldo all'ingresso." },
      { id: "cassa-eventi", etichetta: "3.5 Cassa Altri Eventi", desc: "Incassi quote eventi esterni, modalità flessibili e causali personalizzate." }
    ]
  },
  {
    id: "builder",
    numero: "4",
    titolo: "Builder & Contenuti",
    icona: "palette",
    colore: "#10B981",
    descrizione: "Strumenti per personalizzare logo, colori, moduli pubblici, modelli di tessere e comunicazioni email.",
    sezioni: [
      { id: "form-builder", etichetta: "4.1 Form Builder Dinamico", desc: "Modifica campi, consensi e requisiti dei form pubblici senza toccare il codice." },
      { id: "theme-builder", etichetta: "4.2 Builder Tema & Identità Visiva", desc: "Configura colori, sfondi, logo e layout di portale e gestionale." },
      { id: "card-builder", etichetta: "4.3 Builder Tessera APS", desc: "Layout grafico della tessera associativa digitale stampabile o scaricabile." },
      { id: "email-templates", etichetta: "4.4 Template Email & Comunicazioni", desc: "Modelli automatici per conferme iscrizione, delibere e solleciti quote." }
    ]
  },
  {
    id: "sistema",
    numero: "5",
    titolo: "Sistema & Utenti",
    icona: "shield",
    colore: "#818CF8",
    descrizione: "Gestione accessi direttivo e operatori, permessi granulari, sicurezza database, log e backup.",
    sezioni: [
      { id: "utenti", etichetta: "5.1 Gestione Utenti & Ruoli", desc: "Accessi Super Admin, Direttivo, Cassa e Operatori con permessi differenziati." },
      { id: "log-audit", etichetta: "5.2 Registro Eventi & Audit", desc: "Storico modifiche per trasparenza interna e conformità al Terzo Settore." },
      { id: "backup-dati", etichetta: "5.3 Backup & Esportazione Dati", desc: "Esportazione completa in CSV/Excel e copie di salvataggio conformi a D1." }
    ]
  }
];

function getIconSvg(name, size = 20) {
  const icons = {
    "dashboard": `<path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M14 14h7v7h-7z"/><path d="M3 14h7v7H3z"/>`,
    "users": `<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
    "graduation-cap": `<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>`,
    "ticket": `<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="12" y1="6" x2="12" y2="18"/>`,
    "palette": `<circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>`,
    "shield": `<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>`
  };
  const body = icons[name] || icons["dashboard"];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

/* =========================================================================
   RENDERING AREA AMMINISTRATIVA (DASHBOARD, HUB E BUILDER TEMA)
   ========================================================================= */

async function renderAdminDashboard(env, user, url) {
  const currentView = url.searchParams.get("view") || "dashboard";
  const msg = url.searchParams.get("msg");
  const theme = await getThemeSettings(env);

  // 1. Dati statistici di riepilogo per la Dashboard Generale
  let stats = { domandeAttesa: 0, sociAttivi: 0, corsiAttivi: 1, incassiTotali: 0 };
  let domande = [];

  try {
    const dAttesa = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM soci WHERE stato_iscrizione = 'in_attesa_delibera'"
    ).first();
    stats.domandeAttesa = dAttesa?.count || 0;

    const sAttivi = await env.DB.prepare(
      "SELECT COUNT(*) as count FROM soci WHERE stato_iscrizione = 'attivo'"
    ).first();
    stats.sociAttivi = sAttivi?.count || 0;

    domande = await env.DB.prepare(`
      SELECT 
        s.id, s.nome, s.cognome, s.codice_fiscale, s.data_nascita, s.luogo_nascita,
        s.tipo_socio, s.stato_iscrizione, s.creato_il,
        t.nome as tutore_nome, t.cognome as tutore_cognome, t.telefono as tutore_telefono,
        t.email as tutore_email, t.grado_parentela,
        q.importo as quota_importo, q.stato_pagamento as quota_stato
      FROM soci s
      LEFT JOIN tutori t ON s.tutore_id = t.id
      LEFT JOIN quote_sociali q ON q.socio_id = s.id AND q.stagione = '2025/2026'
      WHERE s.stato_iscrizione = 'in_attesa_delibera'
      ORDER BY s.creato_il ASC
    `).all();
  } catch (err) {
    console.warn("Errore caricamento statistiche dashboard:", err.message);
  }

  // Costruzione della Sidebar Ufficiale
  let sidebarHtml = `
    <div class="sidebar-brand">
      <div class="logo-box">
        <img src="${theme.url_logo}" alt="Logo" class="brand-img" onerror="this.style.display='none'; document.getElementById('logoSvgFallback').style.display='block';">
        <div id="logoSvgFallback" style="display:none;">${getIconSvg("shield", 28)}</div>
      </div>
      <div>
        <div class="brand-title">${theme.nome_associazione}</div>
        <div class="brand-badge">${user.ruolo === 'super_admin' ? 'SUPER ADMIN' : user.ruolo.toUpperCase()}</div>
      </div>
    </div>

    <div class="sidebar-menu">
      <div class="menu-section-title">AREA GESTIONALE</div>
      <a href="/admin?view=dashboard" class="menu-item-root ${currentView === 'dashboard' ? 'active' : ''}">
        <span class="icon">${getIconSvg("dashboard", 18)}</span>
        <span class="text">Dashboard Generale</span>
      </a>

      <div class="menu-section-title" style="margin-top: 18px;">MACRO-AREE BIBBIA</div>
  `;

  for (const macro of MACRO_AREE) {
    const isMacroActive = currentView.startsWith(macro.id) || macro.sezioni.some(s => s.id === currentView);
    sidebarHtml += `
      <div class="macro-group ${isMacroActive ? 'open' : ''}">
        <a href="/admin?view=${macro.id}-hub" class="macro-header ${isMacroActive ? 'active' : ''}">
          <span class="icon" style="color: ${macro.colore};">${getIconSvg(macro.icona, 18)}</span>
          <span class="text">${macro.titolo}</span>
          <span class="arrow">${isMacroActive ? '▾' : '▸'}</span>
        </a>
        <div class="macro-subitems">
          ${macro.sezioni.map(sez => `
            <a href="/admin?view=${sez.id}" class="subitem ${currentView === sez.id ? 'active' : ''}">
              <span class="subitem-dot"></span>
              <span class="text">${sez.etichetta}</span>
            </a>
          `).join("")}
        </div>
      </div>
    `;
  }

  sidebarHtml += `</div>`;

  // Costruzione del corpo centrale in base alla vista selezionata
  let mainContentHtml = "";

  if (currentView === "dashboard") {
    mainContentHtml = `
      <div class="page-header">
        <div class="page-title-box">
          <span class="page-icon">${getIconSvg("dashboard", 24)}</span>
          <div>
            <h1>Dashboard Generale</h1>
            <p class="breadcrumbs">Pannello Gestionale &gt; Panoramica Associazione &gt; Dashboard Generale</p>
          </div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">DOMANDE IN ATTESA CD</div>
          <div class="stat-value" style="color: #F59E0B;">${stats.domandeAttesa}</div>
          <div class="stat-desc">Richieste di ammissione da deliberare</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">SOCI ATTIVI & TESSERATI</div>
          <div class="stat-value" style="color: #10B981;">${stats.sociAttivi}</div>
          <div class="stat-desc">Soci con tessera APS attiva</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">ATTIVITÀ & LABORATORI</div>
          <div class="stat-value" style="color: #38BDF8;">${stats.corsiAttivi}</div>
          <div class="stat-desc">Corsi di teatro attivi</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">SPETTACOLI & CASSA</div>
          <div class="stat-value" style="color: #D98295;">${stats.incassiTotali} €</div>
          <div class="stat-desc">Incassi del mese corrente</div>
        </div>
      </div>

      <div class="hub-header" style="margin-top: 36px; margin-bottom: 16px;">
        <h2>Centro di Controllo • Tutte le Macro-Aree</h2>
        <p style="color: #A1A1AA; font-size: 13px;">Naviga rapidamente tra i settori del gestionale approvati nella Bibbia</p>
      </div>

      <div class="hub-cards-grid">
        ${MACRO_AREE.map(macro => `
          <div class="hub-card" style="border-top: 3px solid ${macro.colore};">
            <div class="hub-card-header">
              <span class="hub-icon" style="color: ${macro.colore};">${getIconSvg(macro.icona, 24)}</span>
              <span class="hub-count">${macro.sezioni.length} sezioni</span>
            </div>
            <h3 class="hub-title">${macro.titolo}</h3>
            <p class="hub-desc">${macro.descrizione}</p>
            <div class="hub-action">
              <a href="/admin?view=${macro.id}-hub" style="color: ${macro.colore};">Apri panoramica <span>&rsaquo;</span></a>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }
  else if (currentView.endsWith("-hub")) {
    const macroId = currentView.replace("-hub", "");
    const macro = MACRO_AREE.find(m => m.id === macroId) || MACRO_AREE[0];

    mainContentHtml = `
      <div class="page-header">
        <div class="page-title-box">
          <span class="page-icon" style="color: ${macro.colore};">${getIconSvg(macro.icona, 24)}</span>
          <div>
            <h1>Macro-Area ${macro.numero}: ${macro.titolo}</h1>
            <p class="breadcrumbs">Pannello Gestionale &gt; ${macro.titolo} &gt; Panoramica Sotto-Sezioni</p>
          </div>
        </div>
      </div>

      <div class="hub-intro-card">
        <div class="intro-icon" style="background: ${macro.colore}22; color: ${macro.colore};">
          ${getIconSvg(macro.icona, 32)}
        </div>
        <div>
          <h2>${macro.titolo}</h2>
          <p style="color: #D4D4D8; font-size: 14px; margin-top: 4px;">${macro.descrizione}</p>
        </div>
      </div>

      <h3 style="font-size: 16px; margin: 28px 0 16px; color: #FFF;">Sotto-Sezioni Operative</h3>
      <div class="sections-list-grid">
        ${macro.sezioni.map(sez => `
          <div class="section-card">
            <div class="section-header">
              <span class="section-dot" style="background: ${macro.colore};"></span>
              <h4>${sez.etichetta}</h4>
            </div>
            <p class="section-desc">${sez.desc}</p>
            <a href="/admin?view=${sez.id}" class="btn-open-section">Accedi alla sezione &rsaquo;</a>
          </div>
        `).join("")}
      </div>
    `;
  }
  else if (currentView === "theme-builder") {
    // 4.2 BUILDER TEMA & IDENTITÀ VISIVA (OPERATIVO)
    mainContentHtml = `
      <div class="page-header">
        <div class="page-title-box">
          <span class="page-icon" style="color: #10B981;">${getIconSvg("palette", 24)}</span>
          <div>
            <h1>4.2 Builder Tema & Identità Visiva</h1>
            <p class="breadcrumbs">Pannello Gestionale &gt; Builder & Contenuti &gt; 4.2 Builder Tema</p>
          </div>
        </div>
      </div>

      ${msg === 'tema_salvato' ? `
        <div class="alert-success">
          <strong>Configurazione salvata con successo!</strong> Le impostazioni visive e il logo sono state aggiornate sia per il gestionale sia per il modulo pubblico.
        </div>
      ` : ''}

      ${msg === 'err_salvataggio' ? `
        <div class="alert-error">
          <strong>Errore durante il salvataggio:</strong> ${url.searchParams.get("err") || "Verificare i dati e riprovare."}
        </div>
      ` : ''}

      <form method="POST" action="/admin/salva-tema" class="theme-builder-form">
        <div class="form-grid-2">
          
          <!-- Sezione Brand & Logo -->
          <div class="builder-card">
            <h3 class="card-heading">Dati Istituzionali & Logo Ufficiale</h3>
            <p class="card-hint">I dati dell'associazione e l'immagine del logo che compaiono nell'header, nei moduli e nel footer.</p>

            <div class="form-group" style="margin-top: 16px;">
              <label>Nome Ufficiale Associazione</label>
              <input type="text" name="nome_associazione" value="${theme.nome_associazione}" required>
            </div>

            <div class="form-group">
              <label>Dominio Web Ufficiale</label>
              <input type="text" name="dominio_ufficiale" value="${theme.dominio_ufficiale}" required>
            </div>

            <div class="form-group">
              <label>Email Ufficiale di Contatto</label>
              <input type="email" name="email_contatto" value="${theme.email_contatto}" required>
            </div>

            <div class="form-group">
              <label>URL Immagine Logo (PNG Trasparente)</label>
              <input type="url" name="url_logo" id="inputUrlLogo" value="${theme.url_logo}" required oninput="document.getElementById('previewLogoImg').src = this.value">
            </div>

            <div class="logo-preview-box">
              <div class="preview-title">Anteprima Logo su Sfondo Scuro:</div>
              <div class="preview-canvas">
                <img id="previewLogoImg" src="${theme.url_logo}" alt="Logo Preview" style="max-height: 80px; max-width: 100%;">
              </div>
            </div>
          </div>

          <!-- Sezione Palette Colori -->
          <div class="builder-card">
            <h3 class="card-heading">Palette Colori Teatrale (HEX)</h3>
            <p class="card-hint">Tutti i componenti del portale pubblico e del gestionale attingono a questi colori.</p>

            <div class="color-picker-row">
              <div class="color-preview" style="background: ${theme.colore_primario};"></div>
              <div class="color-info">
                <label>Colore Primario (Rosa Cervello)</label>
                <input type="text" name="colore_primario" value="${theme.colore_primario}" class="color-hex-input" required>
              </div>
              <input type="color" value="${theme.colore_primario}" class="native-picker" onchange="this.previousElementSibling.querySelector('input').value = this.value; this.parentElement.querySelector('.color-preview').style.background = this.value;">
            </div>

            <div class="color-picker-row">
              <div class="color-preview" style="background: ${theme.colore_secondario};"></div>
              <div class="color-info">
                <label>Colore Secondario (Argento Maschere)</label>
                <input type="text" name="colore_secondario" value="${theme.colore_secondario}" class="color-hex-input" required>
              </div>
              <input type="color" value="${theme.colore_secondario}" class="native-picker" onchange="this.previousElementSibling.querySelector('input').value = this.value; this.parentElement.querySelector('.color-preview').style.background = this.value;">
            </div>

            <div class="color-picker-row">
              <div class="color-preview" style="background: ${theme.colore_scuro};"></div>
              <div class="color-info">
                <label>Colore Scuro Header & Footer (Nero Ribalta)</label>
                <input type="text" name="colore_scuro" value="${theme.colore_scuro}" class="color-hex-input" required>
              </div>
              <input type="color" value="${theme.colore_scuro}" class="native-picker" onchange="this.previousElementSibling.querySelector('input').value = this.value; this.parentElement.querySelector('.color-preview').style.background = this.value;">
            </div>

            <div class="color-picker-row">
              <div class="color-preview" style="background: ${theme.colore_accento};"></div>
              <div class="color-info">
                <label>Colore Accento & Notifiche (Verde Attivo)</label>
                <input type="text" name="colore_accento" value="${theme.colore_accento}" class="color-hex-input" required>
              </div>
              <input type="color" value="${theme.colore_accento}" class="native-picker" onchange="this.previousElementSibling.querySelector('input').value = this.value; this.parentElement.querySelector('.color-preview').style.background = this.value;">
            </div>

            <div class="form-group" style="margin-top: 20px;">
              <label>Scala Dimensione Caratteri (Leggibilità)</label>
              <select name="scala_font" style="width: 100%; background: #09090B; border: 1px solid #3F3F46; color: #FFF; padding: 10px; border-radius: 8px;">
                <option value="compatta" ${theme.scala_font === 'compatta' ? 'selected' : ''}>Compatta (Ideale per tabelle dense)</option>
                <option value="normale" ${theme.scala_font === 'normale' ? 'selected' : ''}>Normale (Bilanciata standard UX)</option>
                <option value="grande" ${theme.scala_font === 'grande' ? 'selected' : ''}>Grande (Caratteri maggiorati per massima leggibilità)</option>
              </select>
            </div>
          </div>

        </div>

        <div class="builder-actions-bar">
          <a href="/admin?view=builder-hub" class="btn-secondary">Annulla</a>
          <button type="submit" class="btn-primary">Salva Configurazione Tema su Database D1</button>
        </div>
      </form>
    `;
  }
  else if (currentView === "domande") {
    // 1.1 DOMANDE DI AMMISSIONE (OPERATIVO)
    mainContentHtml = `
      <div class="page-header">
        <div class="page-title-box">
          <span class="page-icon" style="color: #D98295;">${getIconSvg("users", 24)}</span>
          <div>
            <h1>1.1 Domande di Ammissione</h1>
            <p class="breadcrumbs">Pannello Gestionale &gt; Soci &amp; Libro Soci &gt; Domande di Ammissione</p>
          </div>
        </div>
      </div>

      ${msg === 'delibera_completata' ? `
        <div class="alert-success">
          <strong>Delibera registrata con successo!</strong> Il socio è stato ammesso, il numero di tessera APS assegnato e la quota registrata.
        </div>
      ` : ''}

      <div class="table-card">
        <div class="table-header">
          <div class="table-title">Richieste in attesa di delibera del Direttivo (${domande?.results?.length || 0})</div>
          <span class="badge-pending">Da Deliberare</span>
        </div>

        ${(!domande?.results || domande.results.length === 0) ? `
          <div class="empty-state">
            <p>Nessuna domanda di ammissione in attesa al momento.</p>
          </div>
        ` : `
          <div class="table-responsive">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Data Richiesta</th>
                  <th>Aspirante Socio</th>
                  <th>Codice Fiscale</th>
                  <th>Tipologia</th>
                  <th>Tutore / Contatti</th>
                  <th>Quota Sociale</th>
                  <th style="text-align: right;">Azione Consiglio Direttivo</th>
                </tr>
              </thead>
              <tbody>
                ${domande.results.map(d => `
                  <tr>
                    <td>${new Date(d.creato_il).toLocaleDateString('it-IT')}</td>
                    <td>
                      <strong>${d.nome} ${d.cognome}</strong>
                      <div class="sub-cell">Nato il ${d.data_nascita || 'N/D'} a ${d.luogo_nascita || 'N/D'}</div>
                    </td>
                    <td><code>${d.codice_fiscale}</code></td>
                    <td><span class="tag-tipo">${d.tipo_socio?.toUpperCase()}</span></td>
                    <td>
                      ${d.tutore_nome ? `
                        <div><strong>${d.tutore_nome} ${d.tutore_cognome}</strong> (${d.grado_parentela})</div>
                        <div class="sub-cell">${d.tutore_telefono || ''} • ${d.tutore_email || ''}</div>
                      ` : '<span style="color: #71717A;">Maggiorenne</span>'}
                    </td>
                    <td>
                      <strong>${d.quota_importo || 20} €</strong>
                      <div class="sub-cell">${d.quota_stato === 'saldato' ? 'Saldato' : 'In attesa'}</div>
                    </td>
                    <td style="text-align: right;">
                      <button class="btn-action" onclick="apriModaleDelibera('${d.id}', '${d.nome} ${d.cognome}', '${d.tipo_socio}')">
                        Approva &amp; Tessera
                      </button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        `}
      </div>

      <!-- Modale Delibera del Consiglio Direttivo -->
      <div id="modaleDelibera" class="modal-backdrop" style="display: none;">
        <div class="modal-card">
          <div class="modal-header">
            <h3>Delibera Consiglio Direttivo</h3>
            <button class="modal-close" onclick="chiudiModaleDelibera()">&times;</button>
          </div>
          <p class="modal-subtitle">Ammissione a socio di: <strong id="modalNomeSocio"></strong></p>

          <form method="POST" action="/admin/delibera">
            <input type="hidden" name="socio_id" id="modalSocioId">
            
            <div class="form-group">
              <label>Data Riunione Consiglio Direttivo *</label>
              <input type="date" name="data_delibera" value="${new Date().toISOString().split('T')[0]}" required>
            </div>

            <div class="form-group">
              <label>Numero Verbale delibera CD *</label>
              <input type="text" name="numero_verbale" placeholder="Es. Verbale CD n. 03/2026" required>
            </div>

            <div class="form-group">
              <label>Numero Tessera APS da Assegnare *</label>
              <input type="text" name="numero_tessera" placeholder="Es. APS-2026-042" required>
            </div>

            <div class="form-row-2">
              <div class="form-group">
                <label>Data Saldo Quota Sociale</label>
                <input type="date" name="data_saldo_quota" value="${new Date().toISOString().split('T')[0]}" required>
              </div>
              <div class="form-group">
                <label>Modalità di Pagamento</label>
                <select name="modalita_pagamento" style="width: 100%; background: #09090B; border: 1px solid #3F3F46; color: #FFF; padding: 10px; border-radius: 8px;">
                  <option value="contanti">Contanti in Sede</option>
                  <option value="bonifico">Bonifico Bancario</option>
                  <option value="pos">POS / Carta</option>
                  <option value="satispay">Satispay</option>
                </select>
              </div>
            </div>

            <div class="modal-actions">
              <button type="button" class="btn-secondary" onclick="chiudiModaleDelibera()">Annulla</button>
              <button type="submit" class="btn-primary">Conferma Ammissione Ufficiale</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }
  else {
    // Segnaposto modulare per le sezioni future
    mainContentHtml = `
      <div class="page-header">
        <div class="page-title-box">
          <span class="page-icon" style="color: #10B981;">${getIconSvg("dashboard", 24)}</span>
          <div>
            <h1>${currentView.toUpperCase().replace("-", " ")}</h1>
            <p class="breadcrumbs">Pannello Gestionale &gt; Sezione Operativa</p>
          </div>
        </div>
      </div>

      <div class="hub-intro-card" style="text-align: center; justify-content: center; padding: 48px 24px;">
        <div style="max-width: 540px;">
          <div style="font-size: 36px; margin-bottom: 12px;">⚙️</div>
          <h2 style="margin-bottom: 10px;">${currentView.toUpperCase().replace("-", " ")}</h2>
          <p style="color: #A1A1AA; font-size: 14px; line-height: 1.6;">
            Questa sezione è già perfettamente inserita e mappata nella struttura del gestionale. 
            Nel prossimo passaggio collegheremo i dati specifici di questa schermata.
          </p>
          <div style="margin-top: 24px;">
            <a href="/admin?view=theme-builder" class="btn-primary" style="display: inline-block; text-decoration: none;">
              Vai al Builder Tema & Identità Visiva
            </a>
          </div>
        </div>
      </div>
    `;
  }

  // Costruzione della pagina completa con stili CSS dinamici
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gestionale Admin • ${theme.nome_associazione}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --coral: ${theme.colore_primario};
      --silver: ${theme.colore_secondario};
      --dark: ${theme.colore_scuro};
      --card-bg: ${theme.colore_sfondo};
      --accent: ${theme.colore_accento};
      --text: ${theme.colore_testo};
      --sidebar-w: 270px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--dark);
      color: var(--text);
      min-height: 100vh;
      display: flex;
    }

    /* Sidebar Layout */
    .admin-sidebar {
      width: var(--sidebar-w);
      background: #09090B;
      border-right: 1px solid #27272A;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
    }
    .sidebar-brand {
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #27272A;
    }
    .logo-box {
      width: 40px;
      height: 40px;
      background: #18181B;
      border: 1px solid #27272A;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .brand-img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    .brand-title {
      font-size: 14px;
      font-weight: 700;
      color: #FFF;
      line-height: 1.2;
    }
    .brand-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      color: var(--coral);
      letter-spacing: 0.05em;
      margin-top: 3px;
    }
    .sidebar-menu {
      padding: 16px 12px;
      flex: 1;
    }
    .menu-section-title {
      font-size: 11px;
      font-weight: 700;
      color: #71717A;
      letter-spacing: 0.05em;
      padding: 0 10px 8px;
    }
    .menu-item-root {
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
    }
    .menu-item-root:hover {
      background: #18181B;
      color: #FFF;
    }
    .menu-item-root.active {
      background: var(--coral);
      color: #121214;
    }
    .macro-group {
      margin-top: 4px;
    }
    .macro-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 12px;
      border-radius: 8px;
      color: #A1A1AA;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.15s;
    }
    .macro-header:hover {
      background: #18181B;
      color: #FFF;
    }
    .macro-header .arrow {
      margin-left: auto;
      font-size: 11px;
      color: #71717A;
    }
    .macro-subitems {
      display: none;
      padding-left: 20px;
      margin-top: 2px;
    }
    .macro-group.open .macro-subitems {
      display: block;
    }
    .macro-group.open .macro-header {
      color: #FFF;
    }
    .subitem {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 10px;
      border-radius: 6px;
      color: #A1A1AA;
      text-decoration: none;
      font-size: 12.5px;
      transition: all 0.15s;
    }
    .subitem:hover {
      color: #FFF;
      background: #18181B;
    }
    .subitem.active {
      color: var(--accent);
      font-weight: 600;
      background: #10B98115;
    }
    .subitem-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    /* Main Area Layout */
    .admin-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
      min-height: 100vh;
    }
    .admin-topbar {
      height: 60px;
      border-bottom: 1px solid #27272A;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 32px;
      background: #121214;
    }
    .topbar-user {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 13px;
      color: #A1A1AA;
    }
    .topbar-user strong { color: #FFF; }
    .btn-logout {
      background: transparent;
      border: 1px solid #3F3F46;
      color: #D4D4D8;
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 12.5px;
      text-decoration: none;
      transition: all 0.15s;
    }
    .btn-logout:hover {
      background: #27272A;
      color: #FFF;
    }
    .admin-content {
      padding: 32px;
      flex: 1;
      max-width: 1400px;
      width: 100%;
      margin: 0 auto;
    }

    /* Common Components */
    .page-header {
      margin-bottom: 28px;
    }
    .page-title-box {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .page-icon {
      background: #18181B;
      border: 1px solid #27272A;
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .page-title-box h1 {
      font-size: 22px;
      font-weight: 700;
      color: #FFF;
      letter-spacing: -0.01em;
    }
    .breadcrumbs {
      font-size: 12.5px;
      color: #71717A;
      margin-top: 3px;
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid #27272A;
      border-radius: 12px;
      padding: 20px;
    }
    .stat-label {
      font-size: 11.5px;
      font-weight: 700;
      color: #71717A;
      letter-spacing: 0.05em;
    }
    .stat-value {
      font-size: 32px;
      font-weight: 700;
      margin: 8px 0 4px;
    }
    .stat-desc {
      font-size: 12px;
      color: #A1A1AA;
    }

    /* Hub Cards */
    .hub-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 20px;
    }
    .hub-card {
      background: var(--card-bg);
      border: 1px solid #27272A;
      border-radius: 12px;
      padding: 22px;
      display: flex;
      flex-direction: column;
      transition: transform 0.15s, border-color 0.15s;
    }
    .hub-card:hover {
      transform: translateY(-2px);
      border-color: #3F3F46;
    }
    .hub-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .hub-icon {
      background: #09090B;
      padding: 8px;
      border-radius: 8px;
      border: 1px solid #27272A;
      display: flex;
    }
    .hub-count {
      font-size: 11.5px;
      background: #27272A;
      color: #D4D4D8;
      padding: 3px 8px;
      border-radius: 12px;
      font-weight: 600;
    }
    .hub-title {
      font-size: 16px;
      font-weight: 700;
      color: #FFF;
      margin-bottom: 8px;
    }
    .hub-desc {
      font-size: 12.5px;
      color: #A1A1AA;
      line-height: 1.5;
      flex: 1;
      margin-bottom: 18px;
    }
    .hub-action a {
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    /* Hub Inner View */
    .hub-intro-card {
      background: var(--card-bg);
      border: 1px solid #27272A;
      border-radius: 14px;
      padding: 24px;
      display: flex;
      align-items: center;
      gap: 20px;
    }
    .intro-icon {
      width: 60px;
      height: 60px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .sections-list-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .section-card {
      background: var(--card-bg);
      border: 1px solid #27272A;
      border-radius: 12px;
      padding: 20px;
      display: flex;
      flex-direction: column;
    }
    .section-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .section-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    .section-header h4 {
      font-size: 15px;
      font-weight: 700;
      color: #FFF;
    }
    .section-desc {
      font-size: 12.5px;
      color: #A1A1AA;
      line-height: 1.5;
      flex: 1;
      margin-bottom: 16px;
    }
    .btn-open-section {
      background: #27272A;
      color: #FFF;
      text-decoration: none;
      font-size: 12.5px;
      font-weight: 600;
      padding: 8px 12px;
      border-radius: 6px;
      text-align: center;
      transition: background 0.15s;
    }
    .btn-open-section:hover {
      background: #3F3F46;
    }

    /* Table Component */
    .table-card {
      background: var(--card-bg);
      border: 1px solid #27272A;
      border-radius: 12px;
      overflow: hidden;
    }
    .table-header {
      padding: 18px 24px;
      border-bottom: 1px solid #27272A;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .table-title {
      font-size: 15px;
      font-weight: 700;
      color: #FFF;
    }
    .badge-pending {
      background: #F59E0B22;
      color: #FBBF24;
      border: 1px solid #F59E0B;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 11.5px;
      font-weight: 600;
    }
    .table-responsive {
      overflow-x: auto;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
      font-size: 13px;
    }
    .data-table th {
      background: #09090B;
      padding: 12px 20px;
      color: #A1A1AA;
      font-weight: 600;
      border-bottom: 1px solid #27272A;
      font-size: 11.5px;
      letter-spacing: 0.03em;
    }
    .data-table td {
      padding: 14px 20px;
      border-bottom: 1px solid #27272A;
      color: #D4D4D8;
    }
    .data-table tr:last-child td {
      border-bottom: none;
    }
    .sub-cell {
      font-size: 11.5px;
      color: #71717A;
      margin-top: 2px;
    }
    .tag-tipo {
      background: #27272A;
      color: #E4E4E7;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }
    .btn-action {
      background: var(--coral);
      color: #121214;
      border: none;
      padding: 7px 14px;
      border-radius: 6px;
      font-weight: 700;
      font-size: 12px;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn-action:hover { opacity: 0.9; }

    /* Builder Tema Form */
    .theme-builder-form {
      margin-top: 10px;
    }
    .form-grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
      gap: 24px;
    }
    .builder-card {
      background: var(--card-bg);
      border: 1px solid #27272A;
      border-radius: 12px;
      padding: 24px;
    }
    .card-heading {
      font-size: 16px;
      font-weight: 700;
      color: #FFF;
      margin-bottom: 4px;
    }
    .card-hint {
      font-size: 12.5px;
      color: #A1A1AA;
      margin-bottom: 16px;
      line-height: 1.4;
    }
    .color-picker-row {
      display: flex;
      align-items: center;
      gap: 14px;
      background: #09090B;
      border: 1px solid #27272A;
      padding: 10px 14px;
      border-radius: 8px;
      margin-bottom: 12px;
    }
    .color-preview {
      width: 32px;
      height: 32px;
      border-radius: 6px;
      border: 1px solid #3F3F46;
      flex-shrink: 0;
    }
    .color-info {
      flex: 1;
    }
    .color-info label {
      display: block;
      font-size: 11.5px;
      color: #A1A1AA;
      margin-bottom: 2px;
    }
    .color-hex-input {
      background: transparent;
      border: none;
      color: #FFF;
      font-family: monospace;
      font-size: 13.5px;
      font-weight: 700;
      width: 100%;
    }
    .color-hex-input:focus { outline: none; }
    .native-picker {
      width: 36px;
      height: 36px;
      border: none;
      background: transparent;
      cursor: pointer;
    }
    .logo-preview-box {
      margin-top: 18px;
      border-top: 1px solid #27272A;
      padding-top: 14px;
    }
    .preview-title {
      font-size: 12px;
      color: #71717A;
      margin-bottom: 8px;
    }
    .preview-canvas {
      background: #09090B;
      border: 1px dashed #3F3F46;
      border-radius: 8px;
      padding: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 90px;
    }
    .builder-actions-bar {
      margin-top: 24px;
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      background: var(--card-bg);
      border: 1px solid #27272A;
      padding: 16px 24px;
      border-radius: 12px;
    }

    /* Modale Delibera */
    .modal-backdrop {
      position: fixed;
      top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(0,0,0,0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999;
      padding: 20px;
    }
    .modal-card {
      background: #18181B;
      border: 1px solid #3F3F46;
      border-radius: 14px;
      padding: 28px;
      width: 100%;
      max-width: 520px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.8);
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .modal-header h3 { font-size: 18px; color: #FFF; font-weight: 700; }
    .modal-close {
      background: transparent;
      border: none;
      color: #71717A;
      font-size: 24px;
      cursor: pointer;
    }
    .modal-subtitle {
      font-size: 13px;
      color: #A1A1AA;
      margin-bottom: 20px;
    }
    .modal-subtitle strong { color: var(--coral); }
    .form-group {
      margin-bottom: 16px;
      text-align: left;
    }
    .form-group label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #D4D4D8;
      margin-bottom: 6px;
    }
    .form-group input, .form-group select {
      width: 100%;
      background: #09090B;
      border: 1px solid #3F3F46;
      color: #FFF;
      padding: 10px 12px;
      border-radius: 8px;
      font-size: 13.5px;
    }
    .form-group input:focus, .form-group select:focus {
      outline: none;
      border-color: var(--coral);
    }
    .form-row-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 24px;
    }
    .btn-secondary {
      background: #27272A;
      color: #E4E4E7;
      border: none;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
    }
    .btn-primary {
      background: var(--coral);
      color: #121214;
      border: none;
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
    }

    /* Alerts */
    .alert-success {
      background: #10B9811A;
      border: 1px solid #10B981;
      color: #34D399;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 24px;
    }
    .alert-error {
      background: #EF44441A;
      border: 1px solid #EF4444;
      color: #F87171;
      padding: 12px 18px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 24px;
    }
  </style>
</head>
<body>
  <div class="admin-sidebar">
    ${sidebarHtml}
  </div>

  <div class="admin-main">
    <div class="admin-topbar">
      <div style="font-size: 13px; color: #71717A;">
        Ambiente: <span style="color: #10B981; font-weight: 600;">Produzione • D1 Cloudflare</span>
      </div>
      <div class="topbar-user">
        <span>Connesso: <strong>${user.nome} ${user.cognome}</strong> (${user.email})</span>
        <a href="/admin/logout" class="btn-logout">Disconnetti</a>
      </div>
    </div>

    <div class="admin-content">
      ${mainContentHtml}
    </div>
  </div>

  <script>
    function apriModaleDelibera(id, nome, tipo) {
      document.getElementById('modalSocioId').value = id;
      document.getElementById('modalNomeSocio').innerText = nome + ' (' + tipo.toUpperCase() + ')';
      document.getElementById('modaleDelibera').style.display = 'flex';
    }

    function chiudiModaleDelibera() {
      document.getElementById('modaleDelibera').style.display = 'none';
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function renderLoginPage(errorMsg = null) {
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

    ${errorMsg ? `<div class="error-box">${errorMsg}</div>` : ''}

    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label>Email</label>
        <input type="email" name="email" placeholder="tua-email@personale.it" required autofocus>
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

function renderSetupPage(errorMsg = null) {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Primo Avvio • Configurazione Super Admin</title>
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
    .setup-card {
      background: #18181B;
      border: 1px solid #27272A;
      border-radius: 16px;
      padding: 40px 32px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.7);
    }
    .brand-header {
      text-align: center;
      margin-bottom: 28px;
    }
    .brand-title {
      font-size: 22px;
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
      margin-bottom: 16px;
      text-align: left;
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
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
      margin-top: 12px;
      transition: opacity 0.2s;
    }
    .btn-submit:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="setup-card">
    <div class="brand-header">
      <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#D98295" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <h1 class="brand-title">Primo Avvio Gestionale</h1>
      <p class="brand-sub">Creazione Account Super Admin • Cervelli in Affitto APS</p>
    </div>

    ${errorMsg ? `<div class="error-box">${errorMsg}</div>` : ''}

    <form method="POST" action="/admin/setup">
      <div class="form-row">
        <div class="form-group">
          <label>Nome *</label>
          <input type="text" name="nome" placeholder="Giacomo" required>
        </div>
        <div class="form-group">
          <label>Cognome *</label>
          <input type="text" name="cognome" placeholder="Garofani" required>
        </div>
      </div>
      <div class="form-group">
        <label>Email Ufficiale Super Admin *</label>
        <input type="email" name="email" placeholder="garofanigiacomo@hotmail.it" required>
      </div>
      <div class="form-group">
        <label>Password Super Admin (minimo 8 caratteri) *</label>
        <input type="password" name="password" minlength="8" required>
      </div>
      <button type="submit" class="btn-submit">Crea Account Super Admin</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

/* =========================================================================
   PORTALE PUBBLICO: WIZARD ISCRIZIONE CORSI MINORI & DOMANDA SOCIO
   ========================================================================= */

async function handlePublicRoutes(request, env, url, ctx) {
  if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/iscrizione")) {
    return handleIscrizionePost(request, env, ctx);
  }
  const theme = await getThemeSettings(env);
  return renderPublicForm(theme);
}

async function handleIscrizionePost(request, env, ctx) {
  try {
    const form = await request.formData();

    const minoreNome = form.get("minore_nome")?.trim();
    const minoreCognome = form.get("minore_cognome")?.trim();
    const minoreCF = form.get("minore_cf")?.trim().toUpperCase();
    const minoreNascita = form.get("minore_nascita");
    const minoreLuogo = form.get("minore_luogo")?.trim();
    const noteMediche = form.get("note_mediche")?.trim() || null;

    const tutoreNome = form.get("tutore_nome")?.trim();
    const tutoreCognome = form.get("tutore_cognome")?.trim();
    const tutoreCF = form.get("tutore_cf")?.trim().toUpperCase();
    const tutoreTelefono = form.get("tutore_telefono")?.trim();
    const tutoreEmail = form.get("tutore_email")?.trim().toLowerCase();
    const tutoreResidenza = form.get("tutore_residenza")?.trim();
    const gradoParentela = form.get("grado_parentela") || "Genitore";

    const delega1Nome = form.get("delega1_nome")?.trim();
    const delega1Cognome = form.get("delega1_cognome")?.trim();
    const delega1Tel = form.get("delega1_telefono")?.trim();
    const delega1Rel = form.get("delega1_relazione")?.trim();

    const accStatuto = form.get("accettazione_statuto") ? 1 : 0;
    const consPrivacy = form.get("consenso_privacy") ? 1 : 0;
    const consFoto = form.get("consenso_foto_video") ? 1 : 0;

    if (!minoreNome || !minoreCognome || !minoreCF || !tutoreNome || !tutoreCognome || !tutoreEmail || !tutoreTelefono) {
      return new Response("Campi anagrafici obbligatori mancanti.", { status: 400 });
    }
    if (!accStatuto || !consPrivacy) {
      return new Response("Accettazione dello statuto e consenso privacy obbligatori.", { status: 400 });
    }

    let tutoreId;
    const existingTutore = await env.DB.prepare(
      "SELECT id FROM tutori WHERE codice_fiscale = ? OR email = ? LIMIT 1"
    ).bind(tutoreCF, tutoreEmail).first();

    if (existingTutore) {
      tutoreId = existingTutore.id;
    } else {
      const resTutore = await env.DB.prepare(`
        INSERT INTO tutori (nome, cognome, codice_fiscale, telefono, email, residenza, grado_parentela, creato_il)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(tutoreNome, tutoreCognome, tutoreCF, tutoreTelefono, tutoreEmail, tutoreResidenza, gradoParentela).run();
      tutoreId = resTutore.meta.last_row_id;
    }

    let socioId;
    const existingSocio = await env.DB.prepare(
      "SELECT id FROM soci WHERE codice_fiscale = ? LIMIT 1"
    ).bind(minoreCF).first();

    if (existingSocio) {
      socioId = existingSocio.id;
      await env.DB.prepare(`
        UPDATE soci
        SET tutore_id = ?, note_mediche = ?, aggiornato_il = datetime('now')
        WHERE id = ?
      `).bind(tutoreId, noteMediche, socioId).run();
    } else {
      const resSocio = await env.DB.prepare(`
        INSERT INTO soci (
          tipo_socio, stato_iscrizione, nome, cognome, codice_fiscale,
          data_nascita, luogo_nascita, tutore_id, note_mediche, creato_il, aggiornato_il
        ) VALUES (
          'ordinario', 'in_attesa_delibera', ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
        )
      `).bind(minoreNome, minoreCognome, minoreCF, minoreNascita, minoreLuogo, tutoreId, noteMediche).run();
      socioId = resSocio.meta.last_row_id;
    }

    await env.DB.prepare(`
      INSERT INTO quote_sociali (socio_id, stagione, tipo_quota, importo, stato_pagamento)
      VALUES (?, '2025/2026', 'ordinario', 20.00, 'in_attesa')
    `).bind(socioId).run();

    await env.DB.prepare(`
      INSERT INTO consensi_privacy (socio_id, consenso_gdpr, consenso_foto_video, data_consenso, ip_registrazione)
      VALUES (?, ?, ?, datetime('now'), ?)
    `).bind(socioId, consPrivacy, consFoto, request.headers.get("CF-Connecting-IP") || "0.0.0.0").run();

    let corso = await env.DB.prepare(
      "SELECT id FROM attivita_eventi WHERE tipologia = 'corso' AND attivo = 1 LIMIT 1"
    ).first();

    if (!corso) {
      const resCorso = await env.DB.prepare(`
        INSERT INTO attivita_eventi (titolo, tipologia, anno_sociale, attivo, creato_il)
        VALUES ('Laboratorio Teatrale Bambini & Ragazzi', 'corso', '2025/2026', 1, datetime('now'))
      `).run();
      corso = { id: resCorso.meta.last_row_id };
    }

    await env.DB.prepare(`
      INSERT INTO iscrizioni_corsi (socio_id, attivita_id, stato_frequenza, data_iscrizione)
      VALUES (?, ?, 'confermata', datetime('now'))
    `).bind(socioId, corso.id).run();

    if (delega1Nome && delega1Cognome) {
      await env.DB.prepare(`
        INSERT INTO deleghe_ritiro (socio_id, tutore_id, nome, cognome, telefono, relazione, creato_il)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(socioId, tutoreId, delega1Nome, delega1Cognome, delega1Tel || null, delega1Rel || null).run();
    }

    return renderSuccessPage(minoreNome);
  } catch (err) {
    console.error("Errore salvataggio domanda:", err);
    return new Response("Errore durante il salvataggio della domanda: " + err.message, { status: 500 });
  }
}

function renderPublicForm(theme) {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iscrizione Corsi & Domanda Socio • ${theme.nome_associazione}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --coral: ${theme.colore_primario};
      --silver: ${theme.colore_secondario};
      --dark: ${theme.colore_scuro};
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
      color: var(--silver);
      font-size: 13px;
      margin-top: 4px;
    }
    .form-container {
      max-width: 680px;
      width: 100%;
      margin: 32px auto;
      padding: 0 16px;
      flex: 1;
    }
    .wizard-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px 28px;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.05);
    }
    .stepper {
      display: flex;
      justify-content: space-between;
      margin-bottom: 28px;
      position: relative;
    }
    .stepper::before {
      content: "";
      position: absolute;
      top: 15px;
      left: 20px;
      right: 20px;
      height: 2px;
      background: #E5E7EB;
      z-index: 1;
    }
    .step-item {
      position: relative;
      z-index: 2;
      background: #FFF;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 2px solid #D1D5DB;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      color: #6B7280;
    }
    .step-item.active {
      border-color: var(--coral);
      color: var(--coral);
      background: #FFF;
    }
    .step-item.completed {
      border-color: var(--coral);
      background: var(--coral);
      color: #121214;
    }
    .step-section { display: none; }
    .step-section.active { display: block; }
    .step-title {
      font-size: 18px;
      font-weight: 700;
      color: #111827;
      margin-bottom: 8px;
    }
    .step-desc {
      font-size: 13.5px;
      color: #4B5563;
      margin-bottom: 22px;
      line-height: 1.5;
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 6px;
    }
    input, select, textarea {
      width: 100%;
      background: #FFF;
      border: 1px solid #D1D5DB;
      color: #111827;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.15s;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--coral);
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }
    .checkbox-box {
      background: #F9FAFB;
      border: 1px solid #E5E7EB;
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 14px;
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }
    .checkbox-box input[type="checkbox"] {
      width: 18px;
      height: 18px;
      margin-top: 2px;
      flex-shrink: 0;
    }
    .checkbox-label {
      font-size: 13px;
      color: #374151;
      line-height: 1.4;
    }
    .step-actions {
      display: flex;
      justify-content: space-between;
      margin-top: 28px;
      padding-top: 18px;
      border-top: 1px solid #E5E7EB;
    }
    .btn-step {
      background: var(--coral);
      color: #121214;
      font-weight: 700;
      font-size: 14px;
      padding: 11px 22px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
    }
    .btn-back {
      background: #E5E7EB;
      color: #374151;
      font-weight: 600;
      font-size: 14px;
      padding: 11px 20px;
      border-radius: 8px;
      border: none;
      cursor: pointer;
    }
    .review-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #F3F4F6;
      font-size: 13px;
    }
    .review-label { color: #6B7280; }
    .review-val { font-weight: 600; color: #111827; }
    footer.pub-footer {
      background: var(--dark);
      color: var(--silver);
      text-align: center;
      padding: 24px 20px;
      font-size: 12px;
      margin-top: auto;
      border-top: 1px solid #27272A;
    }
  </style>
</head>
<body>
  <header class="pub-header">
    <div class="brand-title">${theme.nome_associazione}</div>
    <div class="brand-sub">Portale Istituzionale • Richiesta Ammissione Socio &amp; Corsi Teatrali</div>
  </header>

  <div class="form-container">
    <div class="wizard-card">
      <div class="stepper">
        <div class="step-item active" id="dot1">1</div>
        <div class="step-item" id="dot2">2</div>
        <div class="step-item" id="dot3">3</div>
        <div class="step-item" id="dot4">4</div>
        <div class="step-item" id="dot5">5</div>
      </div>

      <form id="iscrizioneForm" method="POST" action="/iscrizione">
        
        <!-- STEP 1: ALLIEVO MINORE -->
        <div class="step-section active" id="step1">
          <h2 class="step-title">1. Dati Anagrafici del Minore (Aspirante Socio)</h2>
          <p class="step-desc">I minori iscritti ai corsi teatrali sono soci ordinari dell'associazione con copertura assicurativa UILT.</p>

          <div class="form-row">
            <div class="form-group">
              <label>Nome Minore *</label>
              <input type="text" name="minore_nome" required>
            </div>
            <div class="form-group">
              <label>Cognome Minore *</label>
              <input type="text" name="minore_cognome" required>
            </div>
          </div>

          <div class="form-group">
            <label>Codice Fiscale Minore *</label>
            <input type="text" name="minore_cf" placeholder="Es. RSSMRA15A01A944X" maxlength="16" required style="text-transform: uppercase;">
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Data di Nascita *</label>
              <input type="date" name="minore_nascita" required>
            </div>
            <div class="form-group">
              <label>Comune o Stato Estero di Nascita *</label>
              <input type="text" name="minore_luogo" placeholder="Es. Bologna" required>
            </div>
          </div>

          <div class="form-group">
            <label>Eventuali allergie o note rilevanti (facoltativo)</label>
            <textarea name="note_mediche" rows="2" placeholder="Indicazioni utili per gli operatori teatrali..."></textarea>
          </div>

          <div class="step-actions">
            <div></div>
            <button type="button" class="btn-step" onclick="goToStep(2)">Avanti: Dati Genitore &rsaquo;</button>
          </div>
        </div>

        <!-- STEP 2: GENITORE / TUTORE -->
        <div class="step-section" id="step2">
          <h2 class="step-title">2. Dati del Genitore o Legale Rappresentante</h2>
          <p class="step-desc">Recapiti ufficiali del tutore per delibera CD, comunicazioni istituzionali ed emergenze.</p>

          <div class="form-row">
            <div class="form-group">
              <label>Nome Genitore *</label>
              <input type="text" name="tutore_nome" required>
            </div>
            <div class="form-group">
              <label>Cognome Genitore *</label>
              <input type="text" name="tutore_cognome" required>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Codice Fiscale Genitore *</label>
              <input type="text" name="tutore_cf" maxlength="16" required style="text-transform: uppercase;">
            </div>
            <div class="form-group">
              <label>Grado di Parentela *</label>
              <select name="grado_parentela">
                <option value="Madre">Madre</option>
                <option value="Padre">Padre</option>
                <option value="Tutore Legale">Tutore Legale / Affidatario</option>
              </select>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Telefono Cellulare *</label>
              <input type="tel" name="tutore_telefono" placeholder="Es. 340 1234567" required>
            </div>
            <div class="form-group">
              <label>Email Ufficiale *</label>
              <input type="email" name="tutore_email" placeholder="nome@email.it" required>
            </div>
          </div>

          <div class="form-group">
            <label>Indirizzo di Residenza *</label>
            <input type="text" name="tutore_residenza" placeholder="Via, Numero, CAP, Città" required>
          </div>

          <div class="step-actions">
            <button type="button" class="btn-back" onclick="goToStep(1)">&lsaquo; Indietro</button>
            <button type="button" class="btn-step" onclick="goToStep(3)">Avanti: Deleghe Ritiro &rsaquo;</button>
          </div>
        </div>

        <!-- STEP 3: DELEGHE DI RITIRO (FACOLTATIVO) -->
        <div class="step-section" id="step3">
          <h2 class="step-title">3. Deleghe per il Ritiro dell'Allievo (Facoltativo)</h2>
          <p class="step-desc">Persone maggiorenni autorizzate a prelevare il minore al termine delle attività teatrali oltre ai genitori.</p>

          <div class="form-row">
            <div class="form-group">
              <label>Nome Delegato</label>
              <input type="text" name="delega1_nome" placeholder="Es. Nonno / Zio">
            </div>
            <div class="form-group">
              <label>Cognome Delegato</label>
              <input type="text" name="delega1_cognome">
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label>Telefono Delegato</label>
              <input type="tel" name="delega1_telefono">
            </div>
            <div class="form-group">
              <label>Relazione di Parentela</label>
              <input type="text" name="delega1_relazione" placeholder="Es. Nonna / Babysitter">
            </div>
          </div>

          <div class="step-actions">
            <button type="button" class="btn-back" onclick="goToStep(2)">&lsaquo; Indietro</button>
            <button type="button" class="btn-step" onclick="goToStep(4)">Avanti: Statuto & Privacy &rsaquo;</button>
          </div>
        </div>

        <!-- STEP 4: STATUTO & PRIVACY -->
        <div class="step-section" id="step4">
          <h2 class="step-title">4. Norme Sociali, Statuto e Consensi</h2>
          <p class="step-desc">Dichiarazioni necessarie per la richiesta formale di ammissione all'APS teatrale e tutela minori.</p>

          <div class="checkbox-box">
            <input type="checkbox" name="accettazione_statuto" id="chkStatuto" required>
            <label for="chkStatuto" class="checkbox-label">
              <strong>Richiesta di Ammissione & Statuto APS *</strong><br>
              In qualità di esercente la responsabilità genitoriale, richiedo formalmente l'ammissione a socio ordinario di Cervelli in Affitto APS per il minore, dichiarando di conoscere e rispettare lo Statuto e i regolamenti associativi.
            </label>
          </div>

          <div class="checkbox-box">
            <input type="checkbox" name="consenso_privacy" id="chkPrivacy" required>
            <label for="chkPrivacy" class="checkbox-label">
              <strong>Trattamento Dati Personali (GDPR) *</strong><br>
              Autorizzo il trattamento dei dati personali del minore e del genitore per le finalità istituzionali dell'APS, la tenuta del Libro Soci e il tesseramento assicurativo nazionale UILT.
            </label>
          </div>

          <div class="checkbox-box">
            <input type="checkbox" name="consenso_foto_video" id="chkFoto">
            <label for="chkFoto" class="checkbox-label">
              <strong>Liberatoria Foto e Video (Facoltativo)</strong><br>
              Autorizzo la ripresa di immagini e video durante i laboratori e i saggi teatrali a esclusivo uso di archivio, rassegne culturali e canali social ufficiali dell'associazione (senza cessione a terzi a scopo di lucro).
            </label>
          </div>

          <div class="step-actions">
            <button type="button" class="btn-back" onclick="goToStep(3)">&lsaquo; Indietro</button>
            <button type="button" class="btn-step" onclick="goToStep(5)">Avanti: Riepilogo & Invia &rsaquo;</button>
          </div>
        </div>

        <!-- STEP 5: RIEPILOGO & CONFERMA -->
        <div class="step-section" id="step5">
          <h2 class="step-title">5. Riepilogo Domanda di Ammissione</h2>
          <p class="step-desc">Verifica la correttezza dei dati prima dell'invio formale al Consiglio Direttivo.</p>

          <div id="reviewContainer" style="margin-bottom: 24px;"></div>

          <div style="background: #ECFDF5; border: 1px solid #A7F3D0; padding: 14px; border-radius: 8px; font-size: 13px; color: #065F46; margin-bottom: 20px;">
            ℹ️ <strong>Cosa succede dopo:</strong> La richiesta verrà sottoposta alla delibera del Consiglio Direttivo. Riceverai conferma via email con le istruzioni per il saldo della quota sociale annuale e l'accesso all'area personale.
          </div>

          <div class="step-actions">
            <button type="button" class="btn-back" onclick="goToStep(4)">&lsaquo; Indietro</button>
            <button type="submit" class="btn-step" style="background: #10B981; color: #FFF;">Invia Domanda Ufficiale</button>
          </div>
        </div>

      </form>
    </div>
  </div>

  <footer class="pub-footer">
    ${theme.nome_associazione} • Sede Legale: Bologna • Dominio: ${theme.dominio_ufficiale} • Affiliato UILT
  </footer>

  <script>
    function goToStep(s) {
      if (s === 5) {
        populateReview();
      }
      const sections = document.querySelectorAll('.step-section');
      sections.forEach((sec, idx) => {
        sec.classList.remove('active');
        if (idx + 1 === s) sec.classList.add('active');
      });

      const circles = document.querySelectorAll('.step-item');
      circles.forEach((item, idx) => {
        const num = idx + 1;
        item.classList.remove('active', 'completed');
        if (num === s) item.classList.add('active');
        if (num < s) item.classList.add('completed');
      });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function populateReview() {
      const form = document.getElementById('iscrizioneForm');
      const container = document.getElementById('reviewContainer');
      const f = new FormData(form);

      const items = [
        { label: "Allievo Minore", val: (f.get("minore_nome") || "") + " " + (f.get("minore_cognome") || "") },
        { label: "Codice Fiscale Minore", val: f.get("minore_cf") || "" },
        { label: "Nato il", val: (f.get("minore_nascita") || "") + " a " + (f.get("minore_luogo") || "") },
        { label: "Genitore / Tutore", val: (f.get("tutore_nome") || "") + " " + (f.get("tutore_cognome") || "") + " (" + (f.get("grado_parentela") || "") + ")" },
        { label: "Recapiti Tutore", val: (f.get("tutore_telefono") || "") + " • " + (f.get("tutore_email") || "") },
        { label: "Laboratorio Scelto", val: "Laboratorio Teatrale Bambini & Ragazzi (2026)" },
        { label: "Statuto & Norme APS", val: f.get("accettazione_statuto") ? "Accettato" : "Non accettato" },
        { label: "Trattamento Dati GDPR", val: f.get("consenso_privacy") ? "Accettato" : "Non accettato" },
        { label: "Consenso Foto/Video", val: f.get("consenso_foto_video") ? "Autorizzato" : "Non autorizzato" }
      ];

      container.innerHTML = items.map(function(it) {
        return "<div class=\"review-row\">" +
          "<span class=\"review-label\">" + it.label + "</span>" +
          "<span class=\"review-val\">" + it.val + "</span>" +
        "</div>";
      }).join("");
    }
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
  <title>Richiesta Registrata • Cervelli in Affitto APS</title>
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
    .success-card {
      background: #18181B;
      border: 1px solid #27272A;
      border-radius: 16px;
      padding: 40px 32px;
      width: 100%;
      max-width: 520px;
      text-align: center;
      box-shadow: 0 20px 40px -15px rgba(0,0,0,0.7);
    }
    .success-icon {
      width: 64px;
      height: 64px;
      background: #10B98122;
      color: #10B981;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      border: 2px solid #10B981;
    }
    h1 { font-size: 22px; font-weight: 700; color: #FFF; margin-bottom: 12px; }
    p { font-size: 14px; color: #A1A1AA; line-height: 1.6; margin-bottom: 24px; }
    .btn-home {
      display: inline-block;
      background: #D98295;
      color: #121214;
      font-weight: 700;
      font-size: 14px;
      padding: 12px 24px;
      border-radius: 8px;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="success-card">
    <div class="success-icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
    </div>
    <h1>Richiesta Inviata con Successo!</h1>
    <p>
      La domanda di ammissione per <strong>${nomeSocio}</strong> è stata acquisita e inserita all'ordine del giorno del Consiglio Direttivo.<br><br>
      A seguito della delibera formale riceverai comunicazione via email con la conferma del tesseramento e le indicazioni per la frequenza al laboratorio teatrale.
    </p>
    <a href="/" class="btn-home">Torna alla Pagina Iniziale</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}
