/**
 * Cervelli in Affitto APS - Piattaforma Gestionale
 * - Portale Pubblico: Modulo Iscrizione Corsi Minori & Domanda Socio (Wizard a 5 step)
 * - Area Riservata (/admin): Dashboard Generale, Pagine HUB Macro-Aree e Delibera CD
 * - Builder del Tema & Identità Visiva (Macro-Area 4.2) collegato a Cloudflare D1
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

    // 2. Area Amministrativa e di Gestione (/admin)
    if (url.pathname.startsWith("/admin")) {
      return handleAdminRoutes(request, env, url);
    }

    // 3. Portale Pubblico: Invio Modulo Minori
    if (url.pathname === "/iscrizione-minori" && request.method === "POST") {
      return handleIscrizionePost(request, env, url);
    }

    // 4. Portale Pubblico: Visualizzazione Wizard 5 Step (legge i colori e il logo da D1)
    if (url.pathname === "/" || url.pathname === "/iscrizione-minori") {
      const step = parseInt(url.searchParams.get("step") || "1", 10);
      const isSuccess = url.searchParams.get("success") === "1";
      const settings = await getImpostazioni(env);
      return renderPublicWizard(step, isSuccess, url.searchParams, settings);
    }

    return new Response("Pagina non trovata", { status: 404 });
  }
};

/* =========================================================================
   GESTIONE IMPOSTAZIONI TEMA E IDENTITÀ D1
   ========================================================================= */

async function getImpostazioni(env) {
  const defaults = {
    nome_aps: "Cervelli in Affitto APS",
    dominio_ufficiale: "cervellinaffitto-aps.it",
    logo_url: "",
    colore_primario: "#D98295",
    colore_sfondo: "#121214",
    colore_card: "#18181B",
    colore_macro_1: "#D98295",
    colore_macro_2: "#60A5FA",
    colore_macro_3: "#F59E0B",
    colore_macro_4: "#A78BFA",
    colore_macro_5: "#34D399",
    scala_caratteri: "normale",
    email_contatto: "info@cervellinaffitto-aps.it"
  };

  try {
    const { results } = await env.DB.prepare("SELECT chiave, valore FROM impostazioni_gestionale").all();
    if (results && results.length > 0) {
      results.forEach(row => {
        if (row.valore !== undefined && row.valore !== null && row.valore !== "") {
          defaults[row.chiave] = row.valore;
        }
      });
    }
  } catch (e) {
    console.warn("Impostazioni non trovate in D1, uso valori di default:", e);
  }

  return defaults;
}

async function handleSalvaTemaPost(request, env, user) {
  try {
    const formData = await request.formData();
    const chiavi = [
      'nome_aps', 'dominio_ufficiale', 'email_contatto', 'logo_url',
      'colore_primario', 'colore_sfondo', 'colore_card',
      'colore_macro_1', 'colore_macro_2', 'colore_macro_3', 'colore_macro_4', 'colore_macro_5',
      'scala_caratteri'
    ];

    const statements = chiavi.map(chiave => {
      const val = (formData.get(chiave) || "").toString().trim();
      return env.DB.prepare(`
        INSERT INTO impostazioni_gestionale (chiave, valore, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore, updated_at = CURRENT_TIMESTAMP
      `).bind(chiave, val);
    });

    await env.DB.batch(statements);

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

  const rawKey = await crypto.subtle.exportKey("raw", derivedKey);
  const hashArray = Array.from(new Uint8Array(rawKey));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function generateSessionToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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

async function handleSetupPost(request, env) {
  try {
    const formData = await request.formData();
    const nome = (formData.get("nome") || "").toString().trim();
    const cognome = (formData.get("cognome") || "").toString().trim();
    const email = (formData.get("email") || "").toString().trim().toLowerCase();
    const password = (formData.get("password") || "").toString();

    if (!nome || !cognome || !email || !password) {
      return renderSetupPage("Tutti i campi sono obbligatori.");
    }

    if (password.length < 8) {
      return renderSetupPage("La password deve avere almeno 8 caratteri.");
    }

    const checkAdmin = await env.DB.prepare(
      "SELECT id FROM utenti_gestionale WHERE ruolo = 'super_admin' LIMIT 1"
    ).first();

    if (checkAdmin) {
      return new Response(null, { status: 302, headers: { Location: "/admin/login" } });
    }

    const passHash = await hashPassword(password);

    const result = await env.DB.prepare(`
      INSERT INTO utenti_gestionale (nome, cognome, email, password_hash, ruolo, attivo)
      VALUES (?, ?, ?, ?, 'super_admin', 1)
    `).bind(nome, cognome, email, passHash).run();

    const userId = result.meta.last_row_id;
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
    return renderSetupPage(`Errore: ${e.message}`);
  }
}

async function handleLoginPost(request, env) {
  try {
    const formData = await request.formData();
    const email = (formData.get("email") || "").toString().trim().toLowerCase();
    const password = (formData.get("password") || "").toString();

    if (!email || !password) {
      return renderLoginPage("Inserisci email e password.");
    }

    const passHash = await hashPassword(password);

    const user = await env.DB.prepare(`
      SELECT id, nome, cognome, email, ruolo, attivo
      FROM utenti_gestionale
      WHERE email = ? AND password_hash = ?
    `).bind(email, passHash).first();

    if (!user) {
      return renderLoginPage("Credenziali non valide o utente inesistente.");
    }

    if (user.attivo !== 1) {
      return renderLoginPage("Questo account è disattivato. Contatta l'amministratore.");
    }

    const sessionToken = generateSessionToken();
    await env.DB.prepare(`
      INSERT INTO sessioni_admin (token, utente_id, scadenza)
      VALUES (?, ?, datetime('now', '+7 days'))
    `).bind(sessionToken, user.id).run();

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
        "SELECT COUNT(*) as c FROM soci WHERE stato_richiesta = 'approvato'"
      ).first();
      const progressive = ((countRow ? countRow.c : 0) + 1).toString().padStart(3, "0");
      numeroTessera = `${year}-${progressive}`;
    }

    await env.DB.prepare(`
      UPDATE soci 
      SET 
        stato_richiesta = 'approvato',
        data_delibera = ?,
        numero_verbale = ?,
        numero_tessera_aps = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(dataDelibera, numeroVerbale, numeroTessera, socioId).run();

    return new Response(null, {
      status: 302,
      headers: { Location: "/admin?view=domande&msg=delibera_ok" }
    });
  } catch (e) {
    console.error("Errore ratifica delibera:", e);
    return new Response("Errore delibera: " + e.message, { status: 500 });
  }
}

async function handleLogout(request, env) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (match) {
    const token = match[1];
    try {
      await env.DB.prepare("DELETE FROM sessioni_admin WHERE token = ?").bind(token).run();
    } catch (e) {
      console.warn("Errore eliminazione token sessione:", e);
    }
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/admin/login",
      "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`
    }
  });
}

/* =========================================================================
   STRUTTURA E ARCHITETTURA UFFICIALE DELLE MACRO-AREE (BIBBIA)
   ========================================================================= */

const MENU_SECTIONS = [
  {
    id: "macro-soci",
    titolo: "Soci & Libro Soci",
    colore: "#D98295", // Rosa Cervello
    icona: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    descrizione: "Gestione delibere di ammissione del Consiglio Direttivo, Libro Soci persistente, anagrafiche minori, tutori e affiliazione UILT.",
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
    colore: "#60A5FA", // Blu Teatrale
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
    colore: "#A78BFA", // Viola Strumenti
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
    colore: "#34D399", // Smeraldo Sicurezza
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
  const currentView = url.searchParams.get("view") || "dashboard";
  const msgParam = url.searchParams.get("msg");
  const settings = await getImpostazioni(env);

  // Applica i colori dinamici delle macro-aree salvati in D1
  if (MENU_SECTIONS[0]) MENU_SECTIONS[0].colore = settings.colore_macro_1 || "#D98295";
  if (MENU_SECTIONS[1]) MENU_SECTIONS[1].colore = settings.colore_macro_2 || "#60A5FA";
  if (MENU_SECTIONS[2]) MENU_SECTIONS[2].colore = settings.colore_macro_3 || "#F59E0B";
  if (MENU_SECTIONS[3]) MENU_SECTIONS[3].colore = settings.colore_macro_4 || "#A78BFA";
  if (MENU_SECTIONS[4]) MENU_SECTIONS[4].colore = settings.colore_macro_5 || "#34D399";

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
  let currentMacroColor = settings.colore_primario || "#D98295";
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
  } else if (msgParam === "tema_salvato") {
    msgNotifica = `<div class="alert-box alert-success">Impostazioni grafiche e identità visiva salvate con successo in Cloudflare D1! Tutti i colori e i loghi sono stati aggiornati.</div>`;
  } else if (msgParam === "err_salvataggio") {
    msgNotifica = `<div class="alert-box alert-error">Errore durante il salvataggio su D1: ${url.searchParams.get("err") || "Errore sconosciuto"}</div>`;
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
          <div class="stat-value" style="color: var(--brand-coral);">0 €</div>
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
  // CASO: BUILDER TEMA & IDENTITÀ VISIVA (SEZIONE 4.2)
  else if (currentView === "theme-builder") {
    mainContentHtml = `
      <form method="POST" action="/admin/salva-tema" class="theme-builder-form">
        <div class="theme-grid">
          <!-- SEZIONE A: IDENTITÀ APS & LOGO -->
          <div class="card-table" style="margin-bottom: 24px;">
            <div class="card-header-table">
              <div>
                <h3>Identità Ufficiale dell'Associazione</h3>
                <p>Nome, dominio e collegamenti ufficiali visibili in intestazioni e comunicazioni</p>
              </div>
            </div>
            <div style="padding: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
              <div class="form-group-clean">
                <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #E4E4E7;">Denominazione APS</label>
                <input type="text" name="nome_aps" value="${settings.nome_aps || ''}" required class="input-clean">
              </div>
              <div class="form-group-clean">
                <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #E4E4E7;">Dominio Web Ufficiale</label>
                <input type="text" name="dominio_ufficiale" value="${settings.dominio_ufficiale || ''}" required class="input-clean">
              </div>
              <div class="form-group-clean">
                <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #E4E4E7;">Email Ufficiale di Contatto</label>
                <input type="email" name="email_contatto" value="${settings.email_contatto || ''}" required class="input-clean">
              </div>
              <div class="form-group-clean">
                <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #E4E4E7;">URL Immagine Logo Ufficiale (PNG trasparente)</label>
                <input type="url" name="logo_url" id="input_logo_url" value="${settings.logo_url || ''}" placeholder="https://..." class="input-clean" oninput="aggiornaAnteprimaLogo(this.value)">
                <span style="font-size: 11px; color: #A1A1AA; margin-top: 4px; display: block;">Inserisci il link diretto al file immagine PNG trasparente del logo</span>
              </div>
            </div>
            <div style="padding: 0 24px 24px 24px;">
              <div style="display: flex; align-items: center; gap: 16px; background: #09090B; padding: 16px; border-radius: 8px; border: 1px dashed #3F3F46;">
                <div id="preview_logo_box" style="width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; background: #18181B; border-radius: 8px; border: 1px solid #27272A; overflow: hidden;">
                  ${settings.logo_url ? `<img src="${settings.logo_url}" alt="Anteprima Logo" style="max-width: 100%; max-height: 100%; object-fit: contain;">` : `<span style="font-size: 10px; color: #71717A; text-align: center;">Nessun logo</span>`}
                </div>
                <div>
                  <div style="font-weight: 600; font-size: 14px; color: #FAFAFA;">Anteprima Logo Ufficiale</div>
                  <div style="font-size: 12px; color: #A1A1AA;">Il logo comparirà nella barra di navigazione e nell'intestazione dei moduli pubblici.</div>
                </div>
              </div>
            </div>
          </div>

          <!-- SEZIONE B: PALETTE GENERALE -->
          <div class="card-table" style="margin-bottom: 24px;">
            <div class="card-header-table">
              <div>
                <h3>Palette Colori Principale &amp; Sfondi</h3>
                <p>Colori base del tema teatrale usati per sfondi, card e pulsanti primari</p>
              </div>
            </div>
            <div style="padding: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px;">
              <div class="color-picker-box">
                <label>Colore Primario Accenti (Rosa Corallo)</label>
                <div class="color-input-wrapper">
                  <input type="color" name="colore_primario" id="cp_primario" value="${settings.colore_primario || '#D98295'}" class="picker-native" onchange="document.getElementById('txt_primario').value = this.value; aggiornaLiveTheme();">
                  <input type="text" id="txt_primario" value="${settings.colore_primario || '#D98295'}" class="input-hex" oninput="document.getElementById('cp_primario').value = this.value; aggiornaLiveTheme();">
                </div>
              </div>
              <div class="color-picker-box">
                <label>Colore Sfondo Generale</label>
                <div class="color-input-wrapper">
                  <input type="color" name="colore_sfondo" id="cp_sfondo" value="${settings.colore_sfondo || '#121214'}" class="picker-native" onchange="document.getElementById('txt_sfondo').value = this.value; aggiornaLiveTheme();">
                  <input type="text" id="txt_sfondo" value="${settings.colore_sfondo || '#121214'}" class="input-hex" oninput="document.getElementById('cp_sfondo').value = this.value; aggiornaLiveTheme();">
                </div>
              </div>
              <div class="color-picker-box">
                <label>Colore Sfondo Card &amp; Riquadri</label>
                <div class="color-input-wrapper">
                  <input type="color" name="colore_card" id="cp_card" value="${settings.colore_card || '#18181B'}" class="picker-native" onchange="document.getElementById('txt_card').value = this.value; aggiornaLiveTheme();">
                  <input type="text" id="txt_card" value="${settings.colore_card || '#18181B'}" class="input-hex" oninput="document.getElementById('cp_card').value = this.value; aggiornaLiveTheme();">
                </div>
              </div>
            </div>
          </div>

          <!-- SEZIONE C: COLORI DISTINTIVI DELLE 5 MACRO-AREE -->
          <div class="card-table" style="margin-bottom: 24px;">
            <div class="card-header-table">
              <div>
                <h3>Colori Distintivi delle 5 Macro-Aree</h3>
                <p>Ogni settore del gestionale ha il proprio accento cromatico visibile nella sidebar e nelle schede HUB</p>
              </div>
            </div>
            <div style="padding: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 18px;">
              <div class="color-picker-box">
                <label>1. Soci &amp; Libro Soci</label>
                <div class="color-input-wrapper">
                  <input type="color" name="colore_macro_1" id="cp_m1" value="${settings.colore_macro_1 || '#D98295'}" class="picker-native" onchange="document.getElementById('txt_m1').value = this.value; aggiornaLiveTheme();">
                  <input type="text" id="txt_m1" value="${settings.colore_macro_1 || '#D98295'}" class="input-hex" oninput="document.getElementById('cp_m1').value = this.value; aggiornaLiveTheme();">
                </div>
              </div>
              <div class="color-picker-box">
                <label>2. Attività &amp; Corsi</label>
                <div class="color-input-wrapper">
                  <input type="color" name="colore_macro_2" id="cp_m2" value="${settings.colore_macro_2 || '#60A5FA'}" class="picker-native" onchange="document.getElementById('txt_m2').value = this.value; aggiornaLiveTheme();">
                  <input type="text" id="txt_m2" value="${settings.colore_macro_2 || '#60A5FA'}" class="input-hex" oninput="document.getElementById('cp_m2').value = this.value; aggiornaLiveTheme();">
                </div>
              </div>
              <div class="color-picker-box">
                <label>3. Eventi, Teatro &amp; Casse</label>
                <div class="color-input-wrapper">
                  <input type="color" name="colore_macro_3" id="cp_m3" value="${settings.colore_macro_3 || '#F59E0B'}" class="picker-native" onchange="document.getElementById('txt_m3').value = this.value; aggiornaLiveTheme();">
                  <input type="text" id="txt_m3" value="${settings.colore_macro_3 || '#F59E0B'}" class="input-hex" oninput="document.getElementById('cp_m3').value = this.value; aggiornaLiveTheme();">
                </div>
              </div>
              <div class="color-picker-box">
                <label>4. Builder &amp; Contenuti</label>
                <div class="color-input-wrapper">
                  <input type="color" name="colore_macro_4" id="cp_m4" value="${settings.colore_macro_4 || '#A78BFA'}" class="picker-native" onchange="document.getElementById('txt_m4').value = this.value; aggiornaLiveTheme();">
                  <input type="text" id="txt_m4" value="${settings.colore_macro_4 || '#A78BFA'}" class="input-hex" oninput="document.getElementById('cp_m4').value = this.value; aggiornaLiveTheme();">
                </div>
              </div>
              <div class="color-picker-box">
                <label>5. Sistema &amp; Utenti</label>
                <div class="color-input-wrapper">
                  <input type="color" name="colore_macro_5" id="cp_m5" value="${settings.colore_macro_5 || '#34D399'}" class="picker-native" onchange="document.getElementById('txt_m5').value = this.value; aggiornaLiveTheme();">
                  <input type="text" id="txt_m5" value="${settings.colore_macro_5 || '#34D399'}" class="input-hex" oninput="document.getElementById('cp_m5').value = this.value; aggiornaLiveTheme();">
                </div>
              </div>
            </div>
          </div>

          <!-- SEZIONE D: TIPOGRAFIA E SCALA CARATTERI -->
          <div class="card-table" style="margin-bottom: 24px;">
            <div class="card-header-table">
              <div>
                <h3>Dimensione Caratteri &amp; Densità Visiva</h3>
                <p>Regola la grandezza dei testi dell'intera interfaccia gestionale per il massimo comfort</p>
              </div>
            </div>
            <div style="padding: 24px; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
              <label class="radio-card ${settings.scala_caratteri === 'compatta' ? 'selected' : ''}">
                <input type="radio" name="scala_caratteri" value="compatta" ${settings.scala_caratteri === 'compatta' ? 'checked' : ''} onchange="aggiornaRadioCards(this)">
                <div class="radio-card-body">
                  <div class="radio-card-title">Compatta (13px)</div>
                  <div class="radio-card-desc">Massima quantità di dati a schermo su monitor e desktop.</div>
                </div>
              </label>
              <label class="radio-card ${(!settings.scala_caratteri || settings.scala_caratteri === 'normale') ? 'selected' : ''}">
                <input type="radio" name="scala_caratteri" value="normale" ${(!settings.scala_caratteri || settings.scala_caratteri === 'normale') ? 'checked' : ''} onchange="aggiornaRadioCards(this)">
                <div class="radio-card-body">
                  <div class="radio-card-title">Normale (14.5px)</div>
                  <div class="radio-card-desc">Standard consigliato per equilibrio e perfetta leggibilità.</div>
                </div>
              </label>
              <label class="radio-card ${settings.scala_caratteri === 'grande' ? 'selected' : ''}">
                <input type="radio" name="scala_caratteri" value="grande" ${settings.scala_caratteri === 'grande' ? 'checked' : ''} onchange="aggiornaRadioCards(this)">
                <div class="radio-card-body">
                  <div class="radio-card-title">Grande / Alta Leggibilità (16px)</div>
                  <div class="radio-card-desc">Testi grandi, campi ampi e massimo contrasto visivo.</div>
                </div>
              </label>
            </div>
          </div>

          <!-- SEZIONE E: ANTEPRIMA DAL VIVO (LIVE PREVIEW) -->
          <div class="card-table" style="margin-bottom: 24px;">
            <div class="card-header-table">
              <div>
                <h3>Anteprima Dal Vivo • Componenti del Gestionale</h3>
                <p>Verifica l'armonia dei colori prima di salvare le modifiche su D1</p>
              </div>
            </div>
            <div style="padding: 24px;">
              <div id="live_preview_container" style="background: ${settings.colore_sfondo || '#121214'}; padding: 24px; border-radius: 12px; border: 1px solid #27272A; display: flex; flex-wrap: wrap; gap: 20px; align-items: center;">
                <div id="live_preview_card" style="background: ${settings.colore_card || '#18181B'}; border: 1px solid #27272A; border-radius: 10px; padding: 18px; width: 280px;">
                  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <div id="live_preview_icon_box" style="width: 36px; height: 36px; border-radius: 8px; background: ${(settings.colore_macro_1 || '#D98295')}22; color: ${settings.colore_macro_1 || '#D98295'}; display: flex; align-items: center; justify-content: center; font-weight: 700;">★</div>
                    <div style="font-weight: 700; font-size: 14px; color: #FAFAFA;">Esempio Scheda Hub</div>
                  </div>
                  <div style="font-size: 12px; color: #A1A1AA; line-height: 1.4; margin-bottom: 14px;">Così appariranno le card e i testi nelle pagine del tuo gestionale.</div>
                  <div id="live_preview_badge" style="display: inline-block; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px; background: ${(settings.colore_primario || '#D98295')}22; color: ${settings.colore_primario || '#D98295'}; border: 1px solid ${(settings.colore_primario || '#D98295')}44;">Notifica Live</div>
                </div>

                <div style="display: flex; flex-direction: column; gap: 12px;">
                  <button type="button" id="live_preview_btn" style="background: ${settings.colore_primario || '#D98295'}; color: #121214; font-weight: 700; padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer;">
                    Pulsante Primario
                  </button>
                  <div style="font-size: 13px; color: #A1A1AA;">
                    Testo secondario con <strong style="color: #FAFAFA;">grassetto evidenziato</strong>.
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- BARRA AZIONI SALVATAGGIO IN FONDO -->
          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 16px; padding: 20px; background: #18181B; border: 1px solid #27272A; border-radius: 12px;">
            <a href="/admin?view=macro-builder" class="btn-secondary" style="text-decoration: none;">Annulla modifiche</a>
            <button type="submit" class="btn-primary" style="padding: 12px 28px; font-size: 15px; font-weight: 700; cursor: pointer;">
              Salva Configurazione Tema su Database D1
            </button>
          </div>
        </div>
      </form>

      <script>
        function aggiornaAnteprimaLogo(url) {
          const box = document.getElementById('preview_logo_box');
          if (url && url.startsWith('http')) {
            box.innerHTML = '<img src="' + url + '" alt="Logo" style="max-width: 100%; max-height: 100%; object-fit: contain;" onerror="this.outerHTML=\\'<span style=\\\\'font-size:10px;color:#EF4444;\\\\'>Errore link</span>\\'">';
          } else {
            box.innerHTML = '<span style="font-size: 10px; color: #71717A; text-align: center;">Nessun logo</span>';
          }
        }

        function aggiornaRadioCards(radio) {
          document.querySelectorAll('.radio-card').forEach(function(el) { el.classList.remove('selected'); });
          if (radio.checked) {
            radio.closest('.radio-card').classList.add('selected');
          }
        }

        function aggiornaLiveTheme() {
          const primario = document.getElementById('txt_primario').value;
          const sfondo = document.getElementById('txt_sfondo').value;
          const card = document.getElementById('txt_card').value;
          const m1 = document.getElementById('txt_m1').value;

          const container = document.getElementById('live_preview_container');
          const pCard = document.getElementById('live_preview_card');
          const pBtn = document.getElementById('live_preview_btn');
          const pBadge = document.getElementById('live_preview_badge');
          const pIcon = document.getElementById('live_preview_icon_box');

          if (container) container.style.background = sfondo;
          if (pCard) pCard.style.background = card;
          if (pBtn) pBtn.style.background = primario;
          if (pBadge) {
            pBadge.style.color = primario;
            pBadge.style.borderColor = primario + '44';
            pBadge.style.background = primario + '22';
          }
          if (pIcon) {
            pIcon.style.color = m1;
            pIcon.style.background = m1 + '22';
          }
        }
      </script>
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
            <li><strong>Passo 2:</strong> Tabella D1 Configurazione &amp; Dati Fiscali dell'APS (Completato)</li>
            <li><strong>Passo 3:</strong> Sezione 4.2 Builder Tema &amp; Identità Visiva (Attivo)</li>
            <li><strong>Passo 4:</strong> Sezione 4.1 Form Builder Dinamico per creare e modificare i moduli soci/corsi</li>
          </ul>
        </div>
        <div style="margin-top: 24px; display: flex; gap: 12px; justify-content: center;">
          <a href="/admin?view=${activeMacroId || 'dashboard'}" class="btn-secondary" style="text-decoration: none;">
            Torna all'Hub ${currentMacro}
          </a>
          <a href="/admin?view=theme-builder" class="btn-primary" style="display: inline-block; text-decoration: none;">
            Vai a 4.2 Builder Tema
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
      --brand-coral: ${settings.colore_primario || '#D98295'};
      --brand-silver: #E8E7E9;
      --brand-black: ${settings.colore_sfondo || '#121214'};
      --card-bg: ${settings.colore_card || '#18181B'};
      --card-border: #27272A;
      --text-muted: #A1A1AA;
      --base-font-size: ${settings.scala_caratteri === 'grande' ? '16px' : settings.scala_caratteri === 'compatta' ? '13px' : '14.5px'};
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #09090B;
      color: #FAFAFA;
      font-size: var(--base-font-size);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* THEME BUILDER STYLES */
    .input-clean {
      width: 100%;
      background: #09090B;
      border: 1px solid #27272A;
      color: #FAFAFA;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.2s;
    }
    .input-clean:focus {
      border-color: var(--brand-coral);
    }
    .color-picker-box {
      background: #09090B;
      border: 1px solid #27272A;
      border-radius: 8px;
      padding: 14px;
    }
    .color-picker-box label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #E4E4E7;
      margin-bottom: 8px;
    }
    .color-input-wrapper {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .picker-native {
      -webkit-appearance: none;
      border: none;
      width: 40px;
      height: 38px;
      border-radius: 6px;
      cursor: pointer;
      background: transparent;
    }
    .picker-native::-webkit-color-swatch-wrapper { padding: 0; }
    .picker-native::-webkit-color-swatch { border: 1px solid #3F3F46; border-radius: 6px; }
    .input-hex {
      flex: 1;
      background: #18181B;
      border: 1px solid #27272A;
      color: #FAFAFA;
      padding: 8px 12px;
      border-radius: 6px;
      font-family: monospace;
      font-size: 13px;
      text-transform: uppercase;
    }
    .radio-card {
      display: block;
      background: #09090B;
      border: 1px solid #27272A;
      border-radius: 8px;
      padding: 16px;
      cursor: pointer;
      position: relative;
      transition: all 0.2s;
    }
    .radio-card input {
      position: absolute;
      top: 16px;
      right: 16px;
    }
    .radio-card.selected {
      border-color: var(--brand-coral);
      background: #18181B;
      box-shadow: 0 0 0 1px var(--brand-coral);
    }
    .radio-card-title {
      font-weight: 700;
      font-size: 14px;
      color: #FAFAFA;
      margin-bottom: 4px;
    }
    .radio-card-desc {
      font-size: 12px;
      color: #A1A1AA;
      line-height: 1.4;
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

    /* LAYOUT A DUE COLONNE */
    .admin-wrapper {
      display: flex;
      flex: 1;
      position: relative;
    }

    /* SIDEBAR NAVIGAZIONE */
    .sidebar {
      width: 290px;
      background: #121214;
      border-right: 1px solid var(--card-border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      overflow-x: hidden;
      overflow-y: auto;
      max-height: calc(100vh - 64px);
      position: sticky;
      top: 64px;
    }
    .sidebar.collapsed {
      width: 68px;
    }
    .sidebar-inner {
      padding: 16px 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    /* VOCE DASHBOARD PRINCIPALE */
    .nav-dashboard-link {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 14px;
      border-radius: 8px;
      color: #E4E4E7;
      text-decoration: none;
      font-weight: 600;
      font-size: 13.5px;
      background: #18181B;
      border: 1px solid #27272A;
      margin-bottom: 12px;
      transition: all 0.2s;
    }
    .nav-dashboard-link:hover {
      background: #27272A;
      color: #FFF;
      border-color: var(--brand-coral)66;
    }
    .nav-dashboard-link.active {
      background: var(--brand-coral)18;
      border-color: var(--brand-coral);
      color: #FFF;
    }
    .nav-dashboard-link.active .nav-icon {
      color: var(--brand-coral);
    }
    .nav-dashboard-text {
      white-space: nowrap;
      transition: opacity 0.2s;
    }
    .sidebar.collapsed .nav-dashboard-text {
      opacity: 0;
      display: none;
    }

    /* GRUPPI MACRO-AREE */
    .nav-group {
      border-radius: 8px;
      background: #18181B55;
      border: 1px solid #27272A44;
      overflow: hidden;
      margin-bottom: 6px;
      transition: all 0.2s;
    }
    .nav-group:hover {
      border-color: #27272A;
    }
    .nav-group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px;
      cursor: pointer;
    }
    .nav-group-title {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #D4D4D8;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
      flex: 1;
      white-space: nowrap;
    }
    .nav-group-title:hover {
      color: #FFF;
    }
    .nav-group-title.macro-active {
      color: var(--brand-coral);
      font-weight: 700;
    }
    .nav-group-name {
      transition: opacity 0.2s;
    }
    .sidebar.collapsed .nav-group-name {
      opacity: 0;
      display: none;
    }
    .chevron-btn {
      background: transparent;
      border: none;
      color: #71717A;
      cursor: pointer;
      display: flex;
      align-items: center;
      padding: 4px;
      border-radius: 4px;
    }
    .chevron-btn:hover {
      color: #FAFAFA;
      background: #27272A;
    }
    .chevron {
      transition: transform 0.2s;
    }
    .nav-group.expanded .chevron {
      transform: rotate(180deg);
    }
    .sidebar.collapsed .chevron-btn {
      display: none;
    }

    /* SOTTOMENU VOCI */
    .nav-group-sub {
      display: none;
      flex-direction: column;
      padding: 4px 8px 8px 8px;
      background: #141417;
      border-top: 1px solid #27272A44;
    }
    .nav-group.expanded .nav-group-sub {
      display: flex;
    }
    .sidebar.collapsed .nav-group-sub {
      display: none !important;
    }
    .nav-sub-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      color: #A1A1AA;
      text-decoration: none;
      font-size: 12.5px;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .nav-sub-item:hover {
      background: #27272A;
      color: #FAFAFA;
    }
    .nav-sub-item.active {
      background: #27272A;
      color: #FFF;
      font-weight: 600;
      border-left: 2px solid var(--brand-coral);
    }
    .sub-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .nav-badge {
      margin-left: auto;
      background: #F59E0B;
      color: #121214;
      font-size: 11px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 9999px;
    }

    /* WORKSPACE CONTENUTO PRINCIPALE */
    .workspace {
      flex: 1;
      padding: 28px 32px;
      overflow-y: auto;
      max-width: 1400px;
    }

    /* HEADER WORKSPACE DINAMICO */
    .workspace-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 24px;
      padding-bottom: 18px;
      border-bottom: 1px solid var(--card-border);
    }
    .header-info-group {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .header-icon-box {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .page-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: #FFF;
    }
    .page-breadcrumbs {
      font-size: 12.5px;
      color: var(--text-muted);
      margin-top: 2px;
    }

    /* ALERT MESSAGES */
    .alert-box {
      padding: 12px 18px;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 13.5px;
      font-weight: 500;
    }
    .alert-success {
      background: #10B98118;
      border: 1px solid #10B98144;
      color: #34D399;
    }
    .alert-error {
      background: #EF444418;
      border: 1px solid #EF444444;
      color: #F87171;
    }

    /* STATISTICHE DASHBOARD */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 28px;
    }
    .stat-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 18px 20px;
    }
    .stat-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      letter-spacing: 0.05em;
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .stat-sub {
      font-size: 11.5px;
      color: #71717A;
      margin-top: 4px;
    }

    /* SEZIONE HUB A TESSERE (CARDS GRID) */
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
      margin-bottom: 24px;
      background: #18181B;
      padding: 18px 20px;
      border-radius: 10px;
      border: 1px solid #27272A;
    }
    .macro-hub-desc {
      font-size: 14px;
      color: #E4E4E7;
      line-height: 1.5;
    }
    .hub-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 18px;
      margin-bottom: 30px;
    }
    .hub-card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 22px;
      text-decoration: none;
      display: flex;
      flex-direction: column;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      position: relative;
    }
    .hub-card:hover {
      transform: translateY(-2px);
      border-color: var(--card-accent, var(--brand-coral));
      box-shadow: 0 8px 20px -6px rgba(0,0,0,0.4);
    }
    .hub-card-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 14px;
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
      font-weight: 600;
      border: 1px solid;
      padding: 2px 8px;
      border-radius: 9999px;
    }
    .hub-card-title {
      font-size: 15px;
      font-weight: 700;
      color: #FFF;
      margin-bottom: 8px;
      line-height: 1.3;
    }
    .hub-card-desc {
      font-size: 12.5px;
      color: var(--text-muted);
      line-height: 1.45;
      margin-bottom: 16px;
      flex: 1;
    }
    .hub-card-footer {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      margin-top: auto;
    }

    /* TABELLE & CARD LISTE */
    .card-table {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
    }
    .card-header-table {
      padding: 18px 22px;
      border-bottom: 1px solid var(--card-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .card-header-table h3 {
      font-size: 15px;
      font-weight: 700;
      color: #FFF;
    }
    .card-header-table p {
      font-size: 12.5px;
      color: var(--text-muted);
      margin-top: 2px;
    }
    .table-responsive {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      text-align: left;
    }
    th {
      background: #141417;
      color: var(--text-muted);
      font-weight: 600;
      padding: 12px 18px;
      border-bottom: 1px solid var(--card-border);
      white-space: nowrap;
    }
    td {
      padding: 14px 18px;
      border-bottom: 1px solid #222226;
      vertical-align: middle;
      color: #E4E4E7;
    }
    tr:hover td {
      background: #1C1C20;
    }
    .text-sub {
      color: #A1A1AA;
      font-size: 11.5px;
      display: block;
      margin-top: 2px;
    }
    .badge-pill {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 9999px;
      display: inline-block;
      margin: 2px 0;
    }
    .bg-green { background: #10B98122; color: #34D399; border: 1px solid #10B98144; }
    .bg-amber { background: #F59E0B22; color: #FBBF24; border: 1px solid #F59E0B44; }
    .bg-gray { background: #3F3F4644; color: #A1A1AA; border: 1px solid #52525B44; }
    .tag-delegato {
      font-size: 11.5px;
      color: #CBD5E1;
      display: inline-block;
      margin-bottom: 2px;
    }

    /* MODULO DELIBERA CONSIGLIO DIRETTIVO */
    .form-delibera {
      background: #121214;
      border: 1px solid #2E2E33;
      border-radius: 8px;
      padding: 10px 12px;
    }
    .form-row {
      display: flex;
      gap: 8px;
      align-items: flex-end;
    }
    .form-row label {
      font-size: 10.5px;
      color: #A1A1AA;
      font-weight: 600;
      flex: 1;
    }
    .form-row input {
      width: 100%;
      background: #1C1C20;
      border: 1px solid #3F3F46;
      color: #FFF;
      padding: 5px 8px;
      border-radius: 5px;
      font-size: 12px;
      margin-top: 3px;
    }
    .form-row input:focus {
      outline: none;
      border-color: var(--brand-coral);
    }
    .btn-delibera {
      background: var(--brand-coral);
      color: #121214;
      font-weight: 700;
      border: none;
      padding: 6px 12px;
      border-radius: 5px;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      transition: opacity 0.2s;
    }
    .btn-delibera:hover {
      opacity: 0.9;
    }
    .delibera-info {
      font-size: 12px;
      line-height: 1.5;
      color: #D4D4D8;
    }
    .tessera-highlight {
      color: #34D399;
      font-weight: 700;
    }

    /* PLACEHOLDER SCHERMATE IN FASE DI SVILUPPO */
    .placeholder-card {
      background: var(--card-bg);
      border: 1px dashed var(--card-border);
      border-radius: 12px;
      padding: 40px 32px;
      text-align: center;
      max-width: 680px;
      margin: 40px auto;
    }
    .placeholder-icon {
      width: 60px;
      height: 60px;
      border-radius: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 18px auto;
    }
    .placeholder-card h2 {
      font-size: 20px;
      font-weight: 700;
      color: #FFF;
      margin-bottom: 8px;
    }
    .placeholder-meta {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .tag-macro {
      font-size: 11.5px;
      font-weight: 600;
      padding: 2px 10px;
      border-radius: 9999px;
    }
    .tag-status {
      font-size: 11.5px;
      font-weight: 500;
      background: #27272A;
      color: #D4D4D8;
      padding: 2px 10px;
      border-radius: 9999px;
    }
    .placeholder-desc {
      font-size: 13.5px;
      color: var(--text-muted);
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .placeholder-roadmap {
      background: #141417;
      border: 1px solid #27272A;
      border-radius: 8px;
      padding: 16px;
      text-align: left;
      font-size: 12.5px;
      color: #D4D4D8;
    }
    .placeholder-roadmap h4 {
      font-size: 12.5px;
      font-weight: 700;
      color: #FAFAFA;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .placeholder-roadmap ul {
      padding-left: 18px;
      line-height: 1.7;
    }
    .btn-primary {
      background: var(--brand-coral);
      color: #121214;
      font-weight: 700;
      padding: 8px 18px;
      border-radius: 6px;
      text-decoration: none;
      border: none;
      cursor: pointer;
      font-size: 13px;
    }
    .btn-secondary {
      background: #27272A;
      color: #E4E4E7;
      font-weight: 600;
      padding: 8px 18px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 13px;
    }

    @media (max-width: 900px) {
      .sidebar {
        position: fixed;
        left: 0;
        top: 64px;
        bottom: 0;
        z-index: 99;
        transform: translateX(-100%);
      }
      .sidebar.mobile-open {
        transform: translateX(0);
      }
      .workspace {
        padding: 20px 16px;
      }
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
        ${settings.logo_url ? `<img src="${settings.logo_url}" alt="Logo" style="height: 32px; width: auto; object-fit: contain; border-radius: 4px;" onerror="this.style.display='none'">` : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--brand-coral)" stroke-width="2.2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`}
        <span>${settings.nome_aps || 'Cervelli in Affitto APS'}</span>
        <span class="badge-role">SUPER ADMIN</span>
      </a>
    </div>
    <div class="topbar-right">
      <div class="user-info">
        Collegato: <strong>${utente.nome} ${utente.cognome}</strong>
      </div>
      <a href="/admin/logout" class="btn-logout">Disconnetti</a>
    </div>
  </header>

  <!-- STRUTTURA A DUE COLONNE -->
  <div class="admin-wrapper">
    <!-- COLONNA SINISTRA: SIDEBAR ACCORDION -->
    <aside class="sidebar" id="adminSidebar">
      <div class="sidebar-inner">
        <!-- 0. LINK DIRETTO DASHBOARD GENERALE -->
        <a href="/admin?view=dashboard" class="nav-dashboard-link ${currentView === 'dashboard' ? 'active' : ''}">
          <span class="nav-icon" style="color: ${currentView === 'dashboard' ? 'var(--brand-coral)' : '#A1A1AA'};">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          </span>
          <span class="nav-dashboard-text">Dashboard Generale</span>
        </a>

        <!-- 5 MACRO-AREE UFFICIALI DELLA BIBBIA -->
        ${sidebarNavHtml}
      </div>
    </aside>

    <!-- COLONNA DESTRA: WORKSPACE -->
    <main class="workspace">
      <!-- HEADER CONTESTUALE -->
      <div class="workspace-header">
        <div class="header-info-group">
          <div class="header-icon-box" style="background: ${currentMacroColor}18; color: ${currentMacroColor};">
            ${currentMacroIcon}
          </div>
          <div>
            <h1 class="page-title">${currentTitle}</h1>
            <div class="page-breadcrumbs">
              <span>Area Riservata</span> &gt; <span>${currentMacro}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- MESSAGGI DI NOTIFICA -->
      ${msgNotifica}

      <!-- CONTENUTO DELLA VISTA ATTIVA -->
      ${mainContentHtml}
    </main>
  </div>

  <script>
    // Gestione espansione e compressione Sidebar
    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.getElementById('adminSidebar');

    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener('click', () => {
        if (window.innerWidth <= 900) {
          sidebar.classList.toggle('mobile-open');
        } else {
          sidebar.classList.toggle('collapsed');
        }
      });
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

/* =========================================================================
   PAGINE DI AUTENTICAZIONE (SETUP E LOGIN)
   ========================================================================= */

function renderSetupPage(errorMsg = "") {
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
      background: #09090B;
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
      border-radius: 12px;
      max-width: 460px;
      width: 100%;
      padding: 32px;
    }
    .logo-box {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo-box svg {
      width: 48px;
      height: 48px;
      stroke: #D98295;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 6px;
      text-align: center;
    }
    p.sub {
      font-size: 13px;
      color: #A1A1AA;
      text-align: center;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .alert-err {
      background: #EF444415;
      border: 1px solid #EF444444;
      color: #F87171;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 20px;
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 12.5px;
      font-weight: 600;
      color: #D4D4D8;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      background: #09090B;
      border: 1px solid #27272A;
      color: #FAFAFA;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
    }
    input:focus {
      border-color: #D98295;
    }
    .btn-submit {
      width: 100%;
      background: #D98295;
      color: #121214;
      font-weight: 700;
      padding: 12px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      margin-top: 10px;
    }
    .btn-submit:hover {
      opacity: 0.9;
    }
  </style>
</head>
<body>
  <div class="setup-card">
    <div class="logo-box">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <h1>Primo Avvio Gestionale</h1>
      <p class="sub">Configura il primo account <strong>Super Admin</strong> con accesso totale a tutte le macro-aree.</p>
    </div>

    ${errorMsg ? `<div class="alert-err">${errorMsg}</div>` : ""}

    <form method="POST" action="/admin/setup">
      <div style="display: flex; gap: 12px;">
        <div class="form-group" style="flex: 1;">
          <label>Nome</label>
          <input type="text" name="nome" placeholder="Giacomo" required autofocus>
        </div>
        <div class="form-group" style="flex: 1;">
          <label>Cognome</label>
          <input type="text" name="cognome" placeholder="Garofani" required>
        </div>
      </div>
      <div class="form-group">
        <label>Email Ufficiale</label>
        <input type="email" name="email" placeholder="admin@cervellinaffitto-aps.it" required>
      </div>
      <div class="form-group">
        <label>Password di Accesso (minimo 8 caratteri)</label>
        <input type="password" name="password" required>
      </div>
      <button type="submit" class="btn-submit">Crea Account Super Admin &amp; Accedi</button>
    </form>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function renderLoginPage(errorMsg = "") {
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
      background: #09090B;
      color: #FAFAFA;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .login-card {
      background: #18181B;
      border: 1px solid #27272A;
      border-radius: 12px;
      max-width: 420px;
      width: 100%;
      padding: 32px;
    }
    .logo-box {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo-box svg {
      width: 44px;
      height: 44px;
      stroke: #D98295;
      margin-bottom: 12px;
    }
    h1 {
      font-size: 19px;
      font-weight: 700;
      margin-bottom: 4px;
      text-align: center;
    }
    p.sub {
      font-size: 13px;
      color: #A1A1AA;
      text-align: center;
      margin-bottom: 24px;
    }
    .alert-err {
      background: #EF444415;
      border: 1px solid #EF444444;
      color: #F87171;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 13px;
      margin-bottom: 20px;
      line-height: 1.4;
    }
    .form-group {
      margin-bottom: 16px;
    }
    label {
      display: block;
      font-size: 12.5px;
      font-weight: 600;
      color: #D4D4D8;
      margin-bottom: 6px;
    }
    input {
      width: 100%;
      background: #09090B;
      border: 1px solid #27272A;
      color: #FAFAFA;
      padding: 10px 14px;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
    }
    input:focus {
      border-color: #D98295;
    }
    .btn-submit {
      width: 100%;
      background: #D98295;
      color: #121214;
      font-weight: 700;
      padding: 12px;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      margin-top: 10px;
    }
    .btn-submit:hover {
      opacity: 0.9;
    }
    .link-home {
      display: block;
      text-align: center;
      margin-top: 20px;
      color: #71717A;
      font-size: 12.5px;
      text-decoration: none;
    }
    .link-home:hover {
      color: #FAFAFA;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <div class="logo-box">
      <svg viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      <h1>Cervelli in Affitto APS</h1>
      <p class="sub">Area Riservata • Pannello Amministrativo</p>
    </div>

    ${errorMsg ? `<div class="alert-err">${errorMsg}</div>` : ""}

    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label>Email</label>
        <input type="email" name="email" placeholder="admin@cervellinaffitto-aps.it" required autofocus>
      </div>
      <div class="form-group">
        <label>Password</label>
        <input type="password" name="password" required>
      </div>
      <button type="submit" class="btn-submit">Accedi al Gestionale</button>
    </form>

    <a href="/" class="link-home">&larr; Torna al Portale Pubblico</a>
  </div>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

/* =========================================================================
   PORTALE PUBBLICO (WIZARD A 5 STEP)
   ========================================================================= */

function renderPublicWizard(step, isSuccess, params, settings = {}) {
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
      --coral: ${settings.colore_primario || '#D98295'};
      --silver: #E8E7E9;
      --dark: ${settings.colore_sfondo || '#121214'};
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
      margin: 24px auto 40px auto;
      padding: 0 16px;
      flex: 1;
    }
    .stepper {
      display: flex;
      justify-content: space-between;
      position: relative;
      margin-bottom: 30px;
    }
    .stepper::before {
      content: "";
      position: absolute;
      top: 14px;
      left: 10px;
      right: 10px;
      height: 2px;
      background: var(--border);
      z-index: 1;
    }
    .step-item {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
    }
    .step-circle {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: #FFF;
      border: 2px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 13px;
      color: #6B7280;
    }
    .step-item.active .step-circle {
      border-color: var(--coral);
      background: var(--coral);
      color: #FFF;
    }
    .step-item.completed .step-circle {
      border-color: #10B981;
      background: #10B981;
      color: #FFF;
    }
    .step-label {
      font-size: 11px;
      color: #6B7280;
      font-weight: 500;
      text-align: center;
    }
    .step-item.active .step-label {
      color: var(--dark);
      font-weight: 700;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 28px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .card-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--dark);
      margin-bottom: 6px;
    }
    .card-desc {
      font-size: 13px;
      color: #6B7280;
      margin-bottom: 24px;
      line-height: 1.5;
    }
    .form-group {
      margin-bottom: 18px;
    }
    .form-row {
      display: flex;
      gap: 14px;
    }
    .form-row .form-group {
      flex: 1;
    }
    label {
      display: block;
      font-size: 12.5px;
      font-weight: 600;
      color: #374151;
      margin-bottom: 6px;
    }
    input[type="text"], input[type="email"], input[type="tel"], input[type="date"], select {
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 14px;
      font-family: inherit;
      color: var(--text);
      outline: none;
      transition: border-color 0.2s;
    }
    input:focus, select:focus {
      border-color: var(--coral);
      box-shadow: 0 0 0 1px var(--coral);
    }
    .checkbox-group {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      margin-bottom: 14px;
    }
    .checkbox-group input {
      margin-top: 3px;
    }
    .checkbox-group label {
      font-size: 12.5px;
      font-weight: 400;
      color: #4B5563;
      line-height: 1.4;
      margin: 0;
    }
    .btn-group {
      display: flex;
      justify-content: space-between;
      margin-top: 28px;
      padding-top: 18px;
      border-top: 1px solid var(--border);
    }
    .btn {
      padding: 10px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      border: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .btn-next {
      background: var(--coral);
      color: #121214;
      margin-left: auto;
    }
    .btn-prev {
      background: #F3F4F6;
      color: #4B5563;
    }
    .btn-submit {
      background: #10B981;
      color: #FFF;
      font-weight: 700;
      padding: 12px 28px;
    }
    .delega-box {
      border: 1px dashed #D1D5DB;
      padding: 16px;
      border-radius: 8px;
      margin-bottom: 16px;
      background: #F9FAFB;
    }
    .delega-box h4 {
      font-size: 13px;
      font-weight: 600;
      color: #4B5563;
      margin-bottom: 12px;
    }
    .doc-preview {
      background: #F3F4F6;
      border: 1px solid #E5E7EB;
      padding: 14px;
      border-radius: 6px;
      font-size: 12px;
      color: #4B5563;
      margin-bottom: 16px;
      max-height: 120px;
      overflow-y: auto;
    }
    .review-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #F3F4F6;
      font-size: 13px;
    }
    .review-label {
      color: #6B7280;
    }
    .review-val {
      font-weight: 600;
      color: #111827;
    }
    footer.pub-footer {
      background: var(--dark);
      color: #9CA3AF;
      font-size: 12px;
      padding: 20px;
      text-align: center;
      margin-top: auto;
    }
  </style>
</head>
<body>

  <header class="pub-header">
    <div style="max-width: 600px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; gap: 6px;">
      ${settings.logo_url ? `<img src="${settings.logo_url}" alt="Logo" style="max-height: 52px; width: auto; object-fit: contain; margin-bottom: 4px;" onerror="this.style.display='none'">` : ''}
      <div class="brand-title">${settings.nome_aps || 'Cervelli in Affitto APS'}</div>
      <div class="brand-sub">Affiliata UILT • Laboratori Teatrali Bambini &amp; Ragazzi</div>
    </div>
  </header>

  <div class="wizard-container">
    <div class="stepper">
      ${stepTitles.map((t, idx) => {
        const stepNum = idx + 1;
        const stateClass = stepNum === step ? "active" : stepNum < step ? "completed" : "";
        return `
          <div class="step-item ${stateClass}">
            <div class="step-circle">${stepNum < step ? "✓" : stepNum}</div>
            <div class="step-label">${t}</div>
          </div>
        `;
      }).join("")}
    </div>

    <form id="iscrizioneForm" method="POST" action="/iscrizione-minori">
      <!-- STEP 1: DATI MINORE -->
      <div class="card" id="step-1" style="display: ${step === 1 ? 'block' : 'none'};">
        <h2 class="card-title">1. Dati Anagrafici del Minore</h2>
        <p class="card-desc">Inserisci i dati dell'allievo/a che parteciperà al laboratorio teatrale.</p>
        
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

        <div class="form-row">
          <div class="form-group">
            <label>Data di Nascita *</label>
            <input type="date" name="minore_nascita" required>
          </div>
          <div class="form-group">
            <label>Luogo di Nascita *</label>
            <input type="text" name="minore_luogo" placeholder="Es. Bologna" required>
          </div>
        </div>

        <div class="form-group">
          <label>Codice Fiscale Minore *</label>
          <input type="text" name="minore_cf" placeholder="RSSMRA..." style="text-transform: uppercase;" required>
        </div>

        <div class="form-group">
          <label>Indirizzo di Residenza *</label>
          <input type="text" name="residenza_indirizzo" placeholder="Via, Numero, Città, CAP" required>
        </div>

        <div class="form-group">
          <label>Laboratorio Teatrale Richiesto *</label>
          <select name="corso_id" required>
            <option value="corso-teatro-ragazzi-2026">Laboratorio Teatrale Bambini &amp; Ragazzi (2026)</option>
          </select>
        </div>

        <div class="btn-group">
          <button type="button" class="btn btn-next" onclick="goToStep(2)">Avanti: Genitore / Tutore &rarr;</button>
        </div>
      </div>

      <!-- STEP 2: TUTORE LEGALE -->
      <div class="card" id="step-2" style="display: ${step === 2 ? 'block' : 'none'};">
        <h2 class="card-title">2. Dati del Genitore o Tutore Legale</h2>
        <p class="card-desc">Dati dell'esercente la responsabilità genitoriale che sottoscrive l'iscrizione.</p>

        <div class="form-row">
          <div class="form-group">
            <label>Nome Tutore *</label>
            <input type="text" name="tutore_nome">
          </div>
          <div class="form-group">
            <label>Cognome Tutore *</label>
            <input type="text" name="tutore_cognome">
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label>Codice Fiscale Tutore *</label>
            <input type="text" name="tutore_cf" style="text-transform: uppercase;">
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
            <input type="tel" name="tutore_telefono" placeholder="+39 ...">
          </div>
          <div class="form-group">
            <label>Indirizzo Email *</label>
            <input type="email" name="tutore_email" placeholder="nome@esempio.it">
          </div>
        </div>

        <div class="btn-group">
          <button type="button" class="btn btn-prev" onclick="goToStep(1)">&larr; Indietro</button>
          <button type="button" class="btn btn-next" onclick="goToStep(3)">Avanti: Deleghe Ritiro &rarr;</button>
        </div>
      </div>

      <!-- STEP 3: DELEGHE AL RITIRO -->
      <div class="card" id="step-3" style="display: ${step === 3 ? 'block' : 'none'};">
        <h2 class="card-title">3. Deleghe al Ritiro del Minore (Facoltative)</h2>
        <p class="card-desc">Indica fino a due persone maggiorenni autorizzate a ritirare il minore al termine delle lezioni.</p>

        <div class="delega-box">
          <h4>Delega N° 1</h4>
          <div class="form-row">
            <div class="form-group">
              <label>Nome Delegato</label>
              <input type="text" name="delega1_nome" placeholder="Nome">
            </div>
            <div class="form-group">
              <label>Cognome Delegato</label>
              <input type="text" name="delega1_cognome" placeholder="Cognome">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Relazione / Grado di Parentela</label>
              <input type="text" name="delega1_relazione" placeholder="Es. Nonno, Zio, Amico di famiglia">
            </div>
            <div class="form-group">
              <label>Telefono</label>
              <input type="tel" name="delega1_telefono" placeholder="+39 ...">
            </div>
          </div>
        </div>

        <div class="delega-box">
          <h4>Delega N° 2 (Opzionale)</h4>
          <div class="form-row">
            <div class="form-group">
              <label>Nome Delegato</label>
              <input type="text" name="delega2_nome">
            </div>
            <div class="form-group">
              <label>Cognome Delegato</label>
              <input type="text" name="delega2_cognome">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Relazione</label>
              <input type="text" name="delega2_relazione">
            </div>
            <div class="form-group">
              <label>Telefono</label>
              <input type="tel" name="delega2_telefono">
            </div>
          </div>
        </div>

        <div class="btn-group">
          <button type="button" class="btn btn-prev" onclick="goToStep(2)">&larr; Indietro</button>
          <button type="button" class="btn btn-next" onclick="goToStep(4)">Avanti: Consensi &rarr;</button>
        </div>
      </div>

      <!-- STEP 4: STATUTO & PRIVACY -->
      <div class="card" id="step-4" style="display: ${step === 4 ? 'block' : 'none'};">
        <h2 class="card-title">4. Statuto Sociale &amp; Consensi Obbligatori</h2>
        <p class="card-desc">L'iscrizione ai corsi comporta la richiesta di ammissione a Socio Ordinario dell'APS, affiliata UILT.</p>

        <div class="doc-preview">
          <strong>Estratto Statuto Sociale e Affiliazione UILT:</strong><br>
          Il richiedente dichiara di condividere le finalità dell'Associazione di Promozione Sociale Cervelli in Affitto e si impegna a osservarne lo Statuto, i regolamenti interni e le deliberazioni degli organi sociali. L'ammissione è subordinata alla ratifica del Consiglio Direttivo e include la copertura assicurativa UILT.
        </div>

        <div class="checkbox-group">
          <input type="checkbox" id="check_statuto" name="accettazione_statuto" value="1" required>
          <label for="check_statuto"><strong>Dichiaro di aver preso visione dello Statuto</strong> dell'APS e di accettarne integralmente le disposizioni (Obbligatorio per ammissione socio). *</label>
        </div>

        <div class="checkbox-group">
          <input type="checkbox" id="check_privacy" name="consenso_privacy" value="1" required>
          <label for="check_privacy"><strong>Consenso Privacy GDPR:</strong> Autorizzo il trattamento dei dati personali del minore e del genitore per le finalità associative e assicurative UILT. *</label>
        </div>

        <div class="checkbox-group">
          <input type="checkbox" id="check_foto" name="consenso_foto_video" value="1">
          <label for="check_foto"><strong>Liberatoria Foto e Video:</strong> Autorizzo la realizzazione di foto e registrazioni video delle attività didattiche e dei saggi teatrali a uso documentativo e promozionale dell'APS (Facoltativo).</label>
        </div>

        <div class="checkbox-group">
          <input type="checkbox" id="check_news" name="consenso_newsletter" value="1">
          <label for="check_news">Desidero ricevere comunicazioni su spettacoli, rassegne ed eventi teatrali dell'APS.</label>
        </div>

        <div class="btn-group">
          <button type="button" class="btn btn-prev" onclick="goToStep(3)">&larr; Indietro</button>
          <button type="button" class="btn btn-next" onclick="populateReview(); goToStep(5)">Avanti: Riepilogo &rarr;</button>
        </div>
      </div>

      <!-- STEP 5: RIEPILOGO & INVIO -->
      <div class="card" id="step-5" style="display: ${step === 5 ? 'block' : 'none'};">
        <h2 class="card-title">5. Riepilogo Domanda &amp; Sottoscrizione</h2>
        <p class="card-desc">Verifica i dati inseriti prima di inoltrare ufficialmente la richiesta al Consiglio Direttivo.</p>

        <div id="reviewContainer"></div>

        <div style="background: #ECFDF5; border: 1px solid #A7F3D0; padding: 14px; border-radius: 8px; margin-top: 20px; font-size: 12.5px; color: #065F46;">
          <strong>Cosa succede dopo l'invio?</strong><br>
          La domanda verrà protocollata nel registro ammissioni e sottoposta alla prima seduta utile del Consiglio Direttivo per l'assegnazione del numero di tessera APS e la registrazione nel circuito UILT.
        </div>

        <div class="btn-group">
          <button type="button" class="btn btn-prev" onclick="goToStep(4)">&larr; Modifica Dati</button>
          <button type="submit" class="btn btn-submit">Conferma &amp; Invia Domanda Ufficiale</button>
        </div>
      </div>
    </form>
  </div>

  <footer class="pub-footer">
    Cervelli in Affitto APS • Sede Legale: Bologna • Dominio: cervellinaffitto-aps.it • Affiliato UILT
  </footer>

  <script>
    function goToStep(s) {
      for (let i = 1; i <= 5; i++) {
        const el = document.getElementById('step-' + i);
        if (el) el.style.display = (i === s) ? 'block' : 'none';
      }
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

      container.innerHTML = items.map(it => `
        <div class="review-row">
          <span class="review-label">\${it.label}</span>
          <span class="review-val">\${it.val}</span>
        </div>
      `).join("");
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
  <title>Iscrizione Ricevuta • Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #09090B;
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
      border-radius: 12px;
      max-width: 520px;
      width: 100%;
      padding: 40px 32px;
      text-align: center;
    }
    .check-icon {
      width: 64px;
      height: 64px;
      background: #10B98122;
      border: 1px solid #10B98144;
      color: #34D399;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px auto;
      font-size: 28px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin-bottom: 12px;
      color: #FFF;
    }
    p {
      font-size: 14px;
      color: #A1A1AA;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .next-box {
      background: #121214;
      border: 1px solid #27272A;
      border-radius: 8px;
      padding: 16px;
      text-align: left;
      font-size: 13px;
      color: #D4D4D8;
      margin-bottom: 28px;
    }
    .btn-home {
      display: inline-block;
      background: #D98295;
      color: #121214;
      font-weight: 700;
      padding: 12px 28px;
      border-radius: 6px;
      text-decoration: none;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div class="success-card">
    <div class="check-icon">✓</div>
    <h1>Richiesta Inviata con Successo!</h1>
    <p>
      La domanda di ammissione e iscrizione per <strong>${nomeSocio}</strong> è stata registrata correttamente nel sistema di Cervelli in Affitto APS.
    </p>
    <div class="next-box">
      <strong>Prossimi Passaggi:</strong>
      <ol style="padding-left: 18px; margin-top: 8px; line-height: 1.6;">
        <li>Il Consiglio Direttivo esaminerà e delibererà la richiesta nella prima riunione utile.</li>
        <li>Verrà generato il numero di tessera sociale APS.</li>
        <li>Riceverai via email la conferma e la tessera assicurativa UILT.</li>
      </ol>
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
   BACKEND: SALVATAGGIO ISCRIZIONE MINORI SU D1
   ========================================================================= */

async function handleIscrizionePost(request, env, url) {
  try {
    const formData = await request.formData();

    // Dati Minore
    const minoreNome = (formData.get("minore_nome") || "").toString().trim();
    const minoreCognome = (formData.get("minore_cognome") || "").toString().trim();
    const minoreNascita = (formData.get("minore_nascita") || "").toString().trim();
    const minoreLuogo = (formData.get("minore_luogo") || "").toString().trim();
    const minoreCf = (formData.get("minore_cf") || "").toString().trim().toUpperCase();
    const residenzaIndirizzo = (formData.get("residenza_indirizzo") || "").toString().trim();
    const corsoId = (formData.get("corso_id") || DEFAULT_CORSO_ID).toString().trim();

    // Dati Tutore
    const tutoreNome = (formData.get("tutore_nome") || "").toString().trim();
    const tutoreCognome = (formData.get("tutore_cognome") || "").toString().trim();
    const tutoreCf = (formData.get("tutore_cf") || "").toString().trim().toUpperCase();
    const gradoParentela = (formData.get("grado_parentela") || "Genitore").toString().trim();
    const tutoreTelefono = (formData.get("tutore_telefono") || "").toString().trim();
    const tutoreEmail = (formData.get("tutore_email") || "").toString().trim().toLowerCase();

    // Deleghe al Ritiro
    const delega1Nome = (formData.get("delega1_nome") || "").toString().trim();
    const delega1Cognome = (formData.get("delega1_cognome") || "").toString().trim();
    const delega1Relazione = (formData.get("delega1_relazione") || "").toString().trim();
    const delega1Telefono = (formData.get("delega1_telefono") || "").toString().trim();

    const delega2Nome = (formData.get("delega2_nome") || "").toString().trim();
    const delega2Cognome = (formData.get("delega2_cognome") || "").toString().trim();
    const delega2Relazione = (formData.get("delega2_relazione") || "").toString().trim();
    const delega2Telefono = (formData.get("delega2_telefono") || "").toString().trim();

    // Consensi
    const statuto = formData.get("accettazione_statuto") === "1" ? 1 : 0;
    const privacy = formData.get("consenso_privacy") === "1" ? 1 : 0;
    const foto = formData.get("consenso_foto_video") === "1" ? 1 : 0;
    const newsletter = formData.get("consenso_newsletter") === "1" ? 1 : 0;

    if (!minoreNome || !minoreCognome || !minoreCf || !tutoreNome || !tutoreCognome || !tutoreEmail) {
      return new Response("Campi obbligatori mancanti.", { status: 400 });
    }

    // 1. Inserimento o recupero Tutore Legale
    let tutoreId = null;
    const existingTutore = await env.DB.prepare(
      "SELECT id FROM tutori WHERE email = ? OR (codice_fiscale = ? AND codice_fiscale != '')"
    ).bind(tutoreEmail, tutoreCf).first();

    if (existingTutore) {
      tutoreId = existingTutore.id;
    } else {
      const tutoreRes = await env.DB.prepare(`
        INSERT INTO tutori (nome, cognome, codice_fiscale, telefono, email, grado_parentela)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(tutoreNome, tutoreCognome, tutoreCf, tutoreTelefono, tutoreEmail, gradoParentela).run();
      tutoreId = tutoreRes.meta.last_row_id;
    }

    // 2. Inserimento Socio Minore (in_attesa di delibera del Direttivo)
    const socioRes = await env.DB.prepare(`
      INSERT INTO soci (
        nome, cognome, codice_fiscale, data_nascita, luogo_nascita,
        residenza_indirizzo, tutore_id, is_minore, tipologia, stato_richiesta, data_domanda
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'ordinario', 'in_attesa', datetime('now'))
    `).bind(
      minoreNome, minoreCognome, minoreCf, minoreNascita, minoreLuogo,
      residenzaIndirizzo, tutoreId
    ).run();

    const socioId = socioRes.meta.last_row_id;

    // 3. Registrazione Consensi Privacy
    await env.DB.prepare(`
      INSERT INTO consensi_privacy (
        socio_id, accettazione_statuto, consenso_trattamento_dati,
        consenso_foto_video, consenso_newsletter
      ) VALUES (?, ?, ?, ?, ?)
    `).bind(socioId, statuto, privacy, foto, newsletter).run();

    // 4. Registrazione Deleghe al Ritiro (se compilate)
    if (delega1Nome && delega1Cognome) {
      await env.DB.prepare(`
        INSERT INTO deleghe_ritiro (socio_minore_id, nome, cognome, telefono, relazione)
        VALUES (?, ?, ?, ?, ?)
      `).bind(socioId, delega1Nome, delega1Cognome, delega1Telefono, delega1Relazione).run();
    }

    if (delega2Nome && delega2Cognome) {
      await env.DB.prepare(`
        INSERT INTO deleghe_ritiro (socio_minore_id, nome, cognome, telefono, relazione)
        VALUES (?, ?, ?, ?, ?)
      `).bind(socioId, delega2Nome, delega2Cognome, delega2Telefono, delega2Relazione).run();
    }

    // 5. Iscrizione al Corso Teatrale (con garanzia presenza attività in D1)
    await env.DB.prepare(`
      INSERT OR IGNORE INTO attivita_eventi (id, titolo, tipo, descrizione)
      VALUES (?, 'Laboratorio Teatrale Bambini & Ragazzi', 'corso', 'Laboratorio teatrale annuale per allievi minori')
    `).bind(corsoId).run();

    await env.DB.prepare(`
      INSERT INTO iscrizioni_corsi (socio_id, attivita_id, stato_iscrizione)
      VALUES (?, ?, 'confermata')
    `).bind(socioId, corsoId).run();

    return Response.redirect(`${url.origin}/?success=1&socio=${encodeURIComponent(minoreNome)}`, 303);
  } catch (e) {
    console.error("Errore salvataggio iscrizione:", e);
    return new Response(`Errore salvataggio iscrizione: ${e.message}`, { status: 500 });
  }
}
