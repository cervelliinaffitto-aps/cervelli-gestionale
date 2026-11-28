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
const PBKDF2_SALT = "cervelli-aps-security-salt-2026";
const LEGACY_SALT_UILT = "cervelli_aps_secure_salt_2026_uilt";

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

    // Rotte dell'Area Amministrativa (/admin*)
    if (url.pathname.startsWith("/admin")) {
      return handleAdminRoutes(request, env, url);
    }

    // Assicura l'esistenza del corso predefinito in D1
    await seedDefaultCourseIfNeeded(env);

    // Ricezione modulo iscrizione e domanda socio (POST)
    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/iscrizione-minori")) {
      return handleIscrizionePost(request, env, ctx);
    }

    // Portale pubblico: Wizard a passaggi
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

async function hashPassword(password, salt = PBKDF2_SALT) {
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
      salt: enc.encode(salt),
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

async function verifyPasswordMatch(password, storedHash) {
  if (!storedHash || !password) return false;

  // 1. Prova con salt standard originale (cervelli-aps-security-salt-2026)
  const h1 = await hashPassword(password, PBKDF2_SALT);
  if (h1 === storedHash) return true;

  // 2. Prova con deriveBits (formato usato nei primi test)
  try {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(PBKDF2_SALT), iterations: 100000, hash: "SHA-256" }, km, 256);
    const h2 = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (h2 === storedHash) return true;
  } catch (e) {}

  // 3. Prova con HMAC (variante intermedia)
  try {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
    const dk = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: enc.encode(PBKDF2_SALT), iterations: 100000, hash: "SHA-256" }, km, { name: "HMAC", hash: "SHA-256", length: 256 }, true, ["sign"]);
    const exp = await crypto.subtle.exportKey("raw", dk);
    const h3 = Array.from(new Uint8Array(exp)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (h3 === storedHash) return true;
  } catch (e) {}

  // 4. Prova con salt alternativo temporaneo
  const h4 = await hashPassword(password, LEGACY_SALT_UILT);
  if (h4 === storedHash) return true;

  // 5. Prova con hash SHA-256 semplice (primissimo avvio)
  try {
    const enc = new TextEncoder();
    const data = enc.encode(password + ":cervelli-aps-gestionale-2026");
    const buf = await crypto.subtle.digest("SHA-256", data);
    const h5 = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (h5 === storedHash) return true;
  } catch (e) {}

  return false;
}

function generateSecureToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach(cookie => {
    let [name, ...rest] = cookie.split("=");
    name = name?.trim();
    if (!name) return;
    const value = rest.join("=").trim();
    if (value) list[name] = decodeURIComponent(value);
  });
  return list;
}

async function getAdminSession(request, env) {
  const cookieHeader = request.headers.get("Cookie");
  if (!cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME] || cookies["cervelli_admin_session"];
  if (!token) return null;

  try {
    const row = await env.DB.prepare(`
      SELECT s.token, s.scadenza, u.id, u.nome, u.cognome, u.email, u.ruolo
      FROM sessioni_admin s
      JOIN utenti_gestionale u ON s.utente_id = u.id
      WHERE s.token = ? AND s.scadenza > datetime('now')
      LIMIT 1
    `).bind(token).first();

    if (!row) return null;

    return {
      token: row.token,
      user: {
        id: row.id,
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
      return renderLoginPage("Inserisci sia l'email che la password.", email);
    }

    const user = await env.DB.prepare(`
      SELECT id, nome, cognome, email, password_hash, ruolo, attivo
      FROM utenti_gestionale
      WHERE email = ? AND attivo = 1
      LIMIT 1
    `).bind(email).first();

    if (!user) {
      return renderLoginPage("Credenziali non valide o utente non attivo.", email);
    }

    const passwordValida = await verifyPasswordMatch(password, user.password_hash);
    if (!passwordValida) {
      return renderLoginPage("Credenziali non valide.", email);
    }

    // Se l'impronta salvata era in un formato precedente, la aggiorna automaticamente al formato standard
    const standardHash = await hashPassword(password, PBKDF2_SALT);
    if (user.password_hash !== standardHash) {
      try {
        await env.DB.prepare("UPDATE utenti_gestionale SET password_hash = ? WHERE id = ?").bind(standardHash, user.id).run();
      } catch (e) {
        console.error("Errore aggiornamento hash utente:", e);
      }
    }

    const token = generateSecureToken();

    // Inserimento sessione allineato esattamente alle colonne della tabella sessioni_admin
    await env.DB.prepare(`
      INSERT INTO sessioni_admin (token, utente_id, scadenza)
      VALUES (?, ?, datetime('now', '+${SESSION_DURATION_HOURS} hours'))
    `).bind(token, user.id).run();

    const cookieValue = `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_HOURS * 3600}; Secure`;

    return new Response(null, {
      status: 302,
      headers: {
        "Location": "/admin?view=dashboard",
        "Set-Cookie": cookieValue
      }
    });
  } catch (err) {
    console.error("Errore login:", err);
    return renderLoginPage("Errore del server durante il login: " + err.message);
  }
}

async function handleLogout(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[SESSION_COOKIE_NAME] || cookies["cervelli_admin_session"];
  if (token) {
    try {
      await env.DB.prepare("DELETE FROM sessioni_admin WHERE token = ?").bind(token).run();
    } catch (e) {
      console.error("Errore logout sessione:", e);
    }
  }
  const cookieValue = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`;
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/admin/login",
      "Set-Cookie": cookieValue
    }
  });
}

/* =========================================================================
   GESTIONE IMPOSTAZIONI TEMA (MACRO-AREA 4.2)
   ========================================================================= */

async function getTemaGestionale(env) {
  try {
    const { results } = await env.DB.prepare(
      "SELECT chiave, valore FROM impostazioni_gestionale WHERE gruppo IN ('brand', 'tema', 'contatti')"
    ).all();

    if (!results || results.length === 0) {
      return DEFAULT_THEME;
    }

    const config = { ...DEFAULT_THEME };
    for (const row of results) {
      if (row.valore !== null && row.valore !== undefined) {
        config[row.chiave] = row.valore;
      }
    }
    return config;
  } catch (err) {
    console.warn("Tabella impostazioni_gestionale non ancora pronta o vuota. Uso tema default:", err.message);
    return DEFAULT_THEME;
  }
}

async function handleSalvaTemaPost(request, env, user) {
  try {
    const form = await request.formData();
    const nome_associazione = form.get("nome_associazione")?.trim() || DEFAULT_THEME.nome_associazione;
    const dominio_ufficiale = form.get("dominio_ufficiale")?.trim() || DEFAULT_THEME.dominio_ufficiale;
    const email_contatto = form.get("email_contatto")?.trim() || DEFAULT_THEME.email_contatto;
    const url_logo = form.get("url_logo")?.trim() || DEFAULT_THEME.url_logo;
    const colore_primario = form.get("colore_primario")?.trim() || DEFAULT_THEME.colore_primario;
    const colore_secondario = form.get("colore_secondario")?.trim() || DEFAULT_THEME.colore_secondario;
    const colore_scuro = form.get("colore_scuro")?.trim() || DEFAULT_THEME.colore_scuro;
    const scala_font = form.get("scala_font")?.trim() || DEFAULT_THEME.scala_font;

    const upsertSql = `
      INSERT INTO impostazioni_gestionale (chiave, valore, gruppo, tipo, aggiornato_il)
      VALUES (?, ?, ?, 'testo', datetime('now'))
      ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore, aggiornato_il = datetime('now');
    `;

    const statements = [
      env.DB.prepare(upsertSql).bind("nome_associazione", nome_associazione, "brand"),
      env.DB.prepare(upsertSql).bind("dominio_ufficiale", dominio_ufficiale, "brand"),
      env.DB.prepare(upsertSql).bind("email_contatto", email_contatto, "contatti"),
      env.DB.prepare(upsertSql).bind("url_logo", url_logo, "brand"),
      env.DB.prepare(upsertSql).bind("colore_primario", colore_primario, "tema"),
      env.DB.prepare(upsertSql).bind("colore_secondario", colore_secondario, "tema"),
      env.DB.prepare(upsertSql).bind("colore_scuro", colore_scuro, "tema"),
      env.DB.prepare(upsertSql).bind("scala_font", scala_font, "tema")
    ];

    await env.DB.batch(statements);

    return new Response(null, {
      status: 302,
      headers: { Location: "/admin?view=theme-builder&msg=tema_salvato" }
    });
  } catch (err) {
    console.error("Errore salvataggio tema:", err);
    return new Response(null, {
      status: 302,
      headers: { Location: "/admin?view=theme-builder&err=" + encodeURIComponent(err.message) }
    });
  }
}

/* =========================================================================
   DELIBERA CONSIGLIO DIRETTIVO E APPROVAZIONE DOMANDE
   ========================================================================= */

async function handleDeliberaPost(request, env, user) {
  try {
    const form = await request.formData();
    const socioId = form.get("socio_id");
    const numVerbale = form.get("numero_verbale")?.trim();
    const dataDelibera = form.get("data_delibera") || new Date().toISOString().split("T")[0];
    const numTessera = form.get("numero_tessera")?.trim();

    if (!socioId || !numVerbale || !numTessera) {
      return new Response("Dati mancanti per la delibera.", { status: 400 });
    }

    await env.DB.prepare(`
      UPDATE soci
      SET stato_ammissione = 'approvata',
          numero_verbale_ammissione = ?,
          data_delibera_ammissione = ?,
          numero_tessera_aps = ?,
          aggiornato_il = datetime('now')
      WHERE id = ?
    `).bind(numVerbale, dataDelibera, numTessera, socioId).run();

    return new Response(null, {
      status: 302,
      headers: { Location: "/admin?view=domande&msg=delibera_ok" }
    });
  } catch (err) {
    console.error("Errore delibera socio:", err);
    return new Response("Errore durante la delibera: " + err.message, { status: 500 });
  }
}

/* =========================================================================
   RENDER INTERFACCIA AMMINISTRATIVA (DASHBOARD, HUB E BUILDER TEMA)
   ========================================================================= */

async function renderAdminDashboard(env, user, url) {
  const view = url.searchParams.get("view") || "dashboard";
  const msg = url.searchParams.get("msg");
  const err = url.searchParams.get("err");

  const tema = await getTemaGestionale(env);

  // Conteggi statistici generali
  let countDomande = 0;
  let countSociAttivi = 0;
  let countCorsi = 0;

  try {
    const r1 = await env.DB.prepare("SELECT COUNT(*) as c FROM soci WHERE stato_ammissione = 'in_attesa'").first();
    countDomande = r1 ? r1.c : 0;

    const r2 = await env.DB.prepare("SELECT COUNT(*) as c FROM soci WHERE stato_ammissione = 'approvata'").first();
    countSociAttivi = r2 ? r2.c : 0;

    const r3 = await env.DB.prepare("SELECT COUNT(*) as c FROM attivita_eventi WHERE attivo = 1").first();
    countCorsi = r3 ? r3.c : 0;
  } catch (e) {
    console.error("Errore statistiche dashboard:", e);
  }

  // Lista domande di ammissione
  let listaDomande = [];
  try {
    const { results } = await env.DB.prepare(`
      SELECT s.id, s.nome, s.cognome, s.tipologia, s.quota_dovuta, s.creato_il, s.stato_ammissione,
             t.nome as tutore_nome, t.cognome as tutore_cognome, t.email as tutore_email, t.telefono as tutore_tel
      FROM soci s
      LEFT JOIN tutori t ON s.tutore_id = t.id
      ORDER BY s.creato_il DESC
      LIMIT 25
    `).all();
    listaDomande = results || [];
  } catch (e) {
    console.error("Errore caricamento lista domande:", e);
  }

  // Costruzione della vista principale in base al parametro view
  let contenutoPrincipale = "";
  let titoloSezione = "Dashboard Generale";
  let breadcrumb = "Panoramica Associazione";

  if (view === "dashboard") {
    titoloSezione = "Dashboard Generale";
    breadcrumb = "Panoramica Associazione";
    contenutoPrincipale = renderVistaDashboard(countDomande, countSociAttivi, countCorsi, listaDomande, tema);
  } else if (view === "hub-soci") {
    titoloSezione = "1. Soci & Libro Soci";
    breadcrumb = "Macro-Area 1 • Gestione Associati UILT";
    contenutoPrincipale = renderHubSoci(countDomande, countSociAttivi);
  } else if (view === "domande") {
    titoloSezione = "1.1 Domande di Ammissione";
    breadcrumb = "Soci & Libro Soci • Delibere Consiglio Direttivo";
    contenutoPrincipale = renderTabellaDomande(listaDomande);
  } else if (view === "hub-corsi") {
    titoloSezione = "2. Attività & Corsi";
    breadcrumb = "Macro-Area 2 • Laboratori Teatrali";
    contenutoPrincipale = renderHubCorsi(countCorsi);
  } else if (view === "hub-eventi") {
    titoloSezione = "3. Eventi, Biglietteria & Casse";
    breadcrumb = "Macro-Area 3 • Stagione Teatrale e Altri Eventi";
    contenutoPrincipale = renderHubEventi();
  } else if (view === "hub-builder") {
    titoloSezione = "4. Builder & Contenuti";
    breadcrumb = "Macro-Area 4 • Personalizzazione Senza Codice";
    contenutoPrincipale = renderHubBuilder();
  } else if (view === "theme-builder") {
    titoloSezione = "4.2 Builder Tema & Identità Visiva";
    breadcrumb = "Builder & Contenuti • Palette, Logo e Tipografia";
    contenutoPrincipale = renderThemeBuilderView(tema, msg, err);
  } else if (view === "hub-sistema") {
    titoloSezione = "5. Sistema & Utenti";
    breadcrumb = "Macro-Area 5 • Permessi e Sicurezza";
    contenutoPrincipale = renderHubSistema();
  } else {
    titoloSezione = "Sezione in Allestimento";
    breadcrumb = "Bibbia Gestionale v2.4";
    contenutoPrincipale = `
      <div class="card" style="padding: 40px; text-align: center;">
        <h3 style="color: #FFF; font-size: 18px; margin-bottom: 8px;">Modulo "${view}" previsto dalla Bibbia</h3>
        <p style="color: #A1A1AA; font-size: 14px; max-width: 500px; margin: 0 auto 20px;">
          Questa sezione è mappata nell'architettura ufficiale e verrà attivata nei prossimi rilasci del gestionale.
        </p>
        <a href="/admin?view=dashboard" class="btn btn-secondary">Torna alla Dashboard</a>
      </div>
    `;
  }

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${titoloSezione} • ${tema.nome_associazione}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --color-primary: ${tema.colore_primario};
      --color-secondary: ${tema.colore_secondario};
      --color-dark: ${tema.colore_scuro};
      --color-surface: #18181B;
      --color-border: #27272A;
      --color-text: #FAFAFA;
      --color-muted: #A1A1AA;
      --color-success: #10B981;
      --color-warning: #F59E0B;
      --color-danger: #EF4444;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--color-dark);
      color: var(--color-text);
      min-height: 100vh;
      display: flex;
    }

    /* SIDEBAR */
    .sidebar {
      width: 270px;
      background: #0D0D0E;
      border-right: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      transition: width 0.25s ease;
    }

    .brand-box {
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--color-border);
    }
    .brand-logo-img {
      width: 36px;
      height: 36px;
      object-fit: contain;
      border-radius: 8px;
    }
    .brand-name {
      font-size: 14.5px;
      font-weight: 800;
      color: #FFF;
      letter-spacing: -0.2px;
    }
    .brand-badge {
      display: inline-block;
      font-size: 10px;
      font-weight: 700;
      background: rgba(217, 130, 149, 0.15);
      color: var(--color-primary);
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      margin-top: 2px;
    }

    .nav-section {
      padding: 16px 12px;
      overflow-y: auto;
      flex: 1;
    }
    .nav-group-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: #71717A;
      letter-spacing: 0.5px;
      padding: 12px 12px 6px 12px;
    }
    .nav-link {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      color: var(--color-muted);
      text-decoration: none;
      font-size: 13.5px;
      font-weight: 600;
      border-radius: 8px;
      transition: all 0.15s ease;
      margin-bottom: 3px;
    }
    .nav-link:hover {
      background: rgba(255, 255, 255, 0.05);
      color: #FFF;
    }
    .nav-link.active {
      background: var(--color-primary);
      color: #121214;
      font-weight: 700;
    }
    .nav-link.active svg {
      stroke: #121214;
    }
    .nav-sublink {
      display: flex;
      align-items: center;
      padding: 7px 12px 7px 34px;
      font-size: 12.5px;
      color: #A1A1AA;
      text-decoration: none;
      border-radius: 6px;
      margin-bottom: 2px;
    }
    .nav-sublink:hover { color: #FFF; background: rgba(255, 255, 255, 0.03); }
    .nav-sublink.active { color: var(--color-primary); font-weight: 700; }

    /* TOPBAR & MAIN CONTENT */
    .main-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      background: #121214;
    }

    .topbar {
      height: 64px;
      background: #0D0D0E;
      border-bottom: 1px solid var(--color-border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 28px;
    }
    .user-pill {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      color: var(--color-muted);
    }
    .user-name {
      color: #FFF;
      font-weight: 600;
    }
    .btn-logout {
      background: transparent;
      border: 1px solid var(--color-border);
      color: #EF4444;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      text-decoration: none;
      transition: background 0.15s;
    }
    .btn-logout:hover { background: rgba(239, 68, 68, 0.1); }

    .content-area {
      padding: 32px 36px;
      flex: 1;
      overflow-y: auto;
    }

    .page-header {
      margin-bottom: 28px;
    }
    .breadcrumb {
      font-size: 12px;
      color: #71717A;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 6px;
    }
    .page-title {
      font-size: 26px;
      font-weight: 800;
      color: #FFF;
      letter-spacing: -0.5px;
    }

    /* GRIGLIE & CARD */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 20px;
    }
    .stat-label {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--color-muted);
      letter-spacing: 0.4px;
      margin-bottom: 8px;
    }
    .stat-val {
      font-size: 32px;
      font-weight: 800;
      color: #FFF;
      line-height: 1;
      margin-bottom: 6px;
    }
    .stat-desc {
      font-size: 12px;
      color: #71717A;
    }

    .card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 14px;
      padding: 24px;
      margin-bottom: 28px;
    }
    .card-title {
      font-size: 17px;
      font-weight: 700;
      color: #FFF;
      margin-bottom: 6px;
    }
    .card-sub {
      font-size: 13px;
      color: var(--color-muted);
      margin-bottom: 20px;
    }

    .hub-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
    }
    .hub-card {
      background: #1E1E22;
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 20px;
      text-decoration: none;
      display: block;
      transition: all 0.2s ease;
    }
    .hub-card:hover {
      border-color: var(--color-primary);
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(0,0,0,0.3);
    }
    .hub-card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .hub-card-title {
      font-size: 15px;
      font-weight: 700;
      color: #FFF;
      margin-bottom: 4px;
    }
    .hub-card-desc {
      font-size: 12.5px;
      color: #A1A1AA;
      line-height: 1.45;
    }
    .badge-count {
      background: rgba(255, 255, 255, 0.08);
      font-size: 11px;
      font-weight: 700;
      color: #FFF;
      padding: 3px 8px;
      border-radius: 12px;
    }

    /* TABELLE */
    .table-container {
      overflow-x: auto;
      border: 1px solid var(--color-border);
      border-radius: 10px;
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
      font-weight: 700;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--color-border);
    }
    td {
      padding: 14px 16px;
      border-bottom: 1px solid var(--color-border);
      color: #E4E4E7;
    }
    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }

    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .badge-pending { background: rgba(245, 158, 11, 0.15); color: #F59E0B; }
    .badge-approved { background: rgba(16, 185, 129, 0.15); color: #10B981; }

    /* BOTTONI */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      border-radius: 8px;
      font-size: 13.5px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      text-decoration: none;
      transition: all 0.15s ease;
    }
    .btn-primary { background: var(--color-primary); color: #121214; }
    .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-secondary { background: #27272A; color: #FFF; }
    .btn-secondary:hover { background: #3F3F46; }

    /* NOTIFICHE */
    .alert-banner {
      padding: 14px 18px;
      border-radius: 8px;
      font-size: 13.5px;
      font-weight: 600;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .alert-success { background: rgba(16, 185, 129, 0.15); border: 1px solid #10B981; color: #10B981; }
    .alert-error { background: rgba(239, 68, 68, 0.15); border: 1px solid #EF4444; color: #EF4444; }

    /* MODALE DELIBERA */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal-box {
      background: #18181B;
      border: 1px solid var(--color-border);
      border-radius: 14px;
      width: 100%;
      max-width: 480px;
      padding: 24px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.5);
    }
  </style>
</head>
<body>
  <!-- SIDEBAR UFFICIALE BIBBIA -->
  <aside class="sidebar">
    <div class="brand-box">
      <img src="${tema.url_logo}" alt="Logo" class="brand-logo-img">
      <div>
        <div class="brand-name">${tema.nome_associazione}</div>
        <div class="brand-badge">Super Admin</div>
      </div>
    </div>

    <div class="nav-section">
      <!-- 0. DASHBOARD ESTERNA -->
      <a href="/admin?view=dashboard" class="nav-link ${view === 'dashboard' ? 'active' : ''}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span>Dashboard Generale</span>
      </a>

      <!-- 1. SOCI & LIBRO SOCI -->
      <div class="nav-group-title">Macro-Aree</div>
      <a href="/admin?view=hub-soci" class="nav-link ${view.startsWith('hub-soci') || view === 'domande' ? 'active' : ''}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        <span>1. Soci & Libro Soci</span>
      </a>
      ${view.startsWith('hub-soci') || view === 'domande' ? `
        <a href="/admin?view=domande" class="nav-sublink ${view === 'domande' ? 'active' : ''}">↳ 1.1 Domande Ammissione</a>
        <a href="/admin?view=libro-soci" class="nav-sublink">↳ 1.2 Libro Soci Ufficiale</a>
        <a href="/admin?view=quote-uilt" class="nav-sublink">↳ 1.3 Quote & Tessere UILT</a>
      ` : ''}

      <!-- 2. ATTIVITÀ & CORSI -->
      <a href="/admin?view=hub-corsi" class="nav-link ${view.startsWith('hub-corsi') ? 'active' : ''}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        <span>2. Attività & Corsi</span>
      </a>

      <!-- 3. EVENTI, TEATRO & CASSE -->
      <a href="/admin?view=hub-eventi" class="nav-link ${view.startsWith('hub-eventi') ? 'active' : ''}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/></svg>
        <span>3. Eventi & Casse</span>
      </a>

      <!-- 4. BUILDER & CONTENUTI -->
      <a href="/admin?view=hub-builder" class="nav-link ${view.startsWith('hub-builder') || view === 'theme-builder' ? 'active' : ''}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <span>4. Builder & Contenuti</span>
      </a>
      ${view.startsWith('hub-builder') || view === 'theme-builder' ? `
        <a href="/admin?view=theme-builder" class="nav-sublink ${view === 'theme-builder' ? 'active' : ''}">↳ 4.2 Builder Tema & Brand</a>
      ` : ''}

      <!-- 5. SISTEMA & UTENTI -->
      <a href="/admin?view=hub-sistema" class="nav-link ${view.startsWith('hub-sistema') ? 'active' : ''}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        <span>5. Sistema & Utenti</span>
      </a>
    </div>
  </aside>

  <!-- CONTENUTO PRINCIPALE -->
  <div class="main-wrapper">
    <header class="topbar">
      <div class="user-pill">
        <span>Connesso:</span>
        <strong class="user-name">${user.nome} ${user.cognome}</strong>
        <span>(${user.email})</span>
      </div>
      <a href="/admin/logout" class="btn-logout">Disconnetti</a>
    </header>

    <main class="content-area">
      <div class="page-header">
        <div class="breadcrumb">${breadcrumb}</div>
        <h1 class="page-title">${titoloSezione}</h1>
      </div>

      ${msg === 'delibera_ok' ? '<div class="alert-banner alert-success">Domanda approvata con successo! Assegnato numero di tessera APS e registrato verbale CD.</div>' : ''}
      ${msg === 'tema_salvato' ? '<div class="alert-banner alert-success">Impostazioni del Brand e del Tema salvate correttamente nel database Cloudflare D1!</div>' : ''}
      ${err ? `<div class="alert-banner alert-error">Errore: ${decodeURIComponent(err)}</div>` : ''}

      ${contenutoPrincipale}
    </main>
  </div>

  <!-- MODALE FORMALE DI DELIBERA CONSIGLIO DIRETTIVO -->
  <div id="modaleDelibera" class="modal-overlay">
    <div class="modal-box">
      <h3 style="color:#FFF; font-size: 18px; margin-bottom: 6px;">Delibera Consiglio Direttivo</h3>
      <p style="color:#A1A1AA; font-size: 13px; margin-bottom: 20px;">
        Ammissione a socio per: <strong id="modalNomeSocio" style="color:var(--color-primary)"></strong>
      </p>

      <form method="POST" action="/admin/delibera">
        <input type="hidden" name="socio_id" id="modalSocioId">

        <div style="margin-bottom: 14px;">
          <label style="display:block; font-size: 12px; font-weight:700; color:#A1A1AA; margin-bottom: 6px;">Data Verbale CD *</label>
          <input type="date" name="data_delibera" value="${new Date().toISOString().split('T')[0]}" required style="width:100%; padding:10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
        </div>

        <div style="margin-bottom: 14px;">
          <label style="display:block; font-size: 12px; font-weight:700; color:#A1A1AA; margin-bottom: 6px;">Numero Verbale CD *</label>
          <input type="text" name="numero_verbale" placeholder="Es. Verbale CD n. 04/2026" required style="width:100%; padding:10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
        </div>

        <div style="margin-bottom: 20px;">
          <label style="display:block; font-size: 12px; font-weight:700; color:#A1A1AA; margin-bottom: 6px;">Numero Tessera APS Assegnato *</label>
          <input type="text" name="numero_tessera" placeholder="Es. APS-2026-0042" required style="width:100%; padding:10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
        </div>

        <div style="display:flex; justify-content:flex-end; gap: 10px;">
          <button type="button" onclick="chiudiModaleDelibera()" class="btn btn-secondary">Annulla</button>
          <button type="submit" class="btn btn-primary">Approva &amp; Registra</button>
        </div>
      </form>
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

/* =========================================================================
   PAGINE DI AUTENTICAZIONE (SETUP E LOGIN)
   ========================================================================= */

function renderLoginPage(errorMsg = null, emailVal = "") {
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
      padding: 36px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }
    .brand-header {
      text-align: center;
      margin-bottom: 28px;
    }
    .brand-title {
      font-size: 20px;
      font-weight: 800;
      color: #FFF;
      margin-top: 12px;
    }
    .brand-sub {
      font-size: 13px;
      color: #A1A1AA;
      margin-top: 4px;
    }
    .form-group {
      margin-bottom: 18px;
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
      background: #0D0D0E;
      border: 1px solid #27272A;
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 14px;
      color: #FFF;
      outline: none;
      transition: border-color 0.15s;
    }
    input:focus { border-color: #D98295; }
    .btn-submit {
      width: 100%;
      background: #D98295;
      color: #121214;
      border: none;
      border-radius: 8px;
      padding: 13px;
      font-size: 14.5px;
      font-weight: 700;
      cursor: pointer;
      transition: opacity 0.15s;
      margin-top: 6px;
    }
    .btn-submit:hover { opacity: 0.9; }
    .error-box {
      background: rgba(239, 68, 68, 0.15);
      border: 1px solid #EF4444;
      color: #EF4444;
      padding: 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 20px;
      text-align: center;
    }
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
        <input type="email" name="email" value="${emailVal ? emailVal.replace(/"/g, '&quot;') : ''}" placeholder="tua-email@personale.it" required autofocus>
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
    .auth-card {
      background: #18181B;
      border: 1px solid #27272A;
      border-radius: 16px;
      padding: 36px;
      width: 100%;
      max-width: 440px;
      box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    }
    .brand-title { font-size: 20px; font-weight: 800; text-align: center; margin-bottom: 4px; }
    .brand-sub { font-size: 13px; color: #A1A1AA; text-align: center; margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    label { display: block; font-size: 12px; font-weight: 600; color: #D4D4D8; margin-bottom: 6px; }
    input {
      width: 100%;
      background: #0D0D0E;
      border: 1px solid #27272A;
      border-radius: 8px;
      padding: 11px 13px;
      font-size: 14px;
      color: #FFF;
      outline: none;
    }
    input:focus { border-color: #D98295; }
    .btn-submit {
      width: 100%;
      background: #D98295;
      color: #121214;
      border: none;
      border-radius: 8px;
      padding: 13px;
      font-size: 14.5px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 10px;
    }
  </style>
</head>
<body>
  <div class="auth-card">
    <h1 class="brand-title">Primo Avvio Gestionale</h1>
    <p class="brand-sub">Configura l'account Super Admin principale</p>
    ${errorMsg ? `<div style="background:rgba(239,68,68,0.15); border:1px solid #EF4444; color:#EF4444; padding:10px; border-radius:6px; font-size:12.5px; margin-bottom:16px;">${errorMsg}</div>` : ''}
    <form method="POST" action="/admin/setup">
      <div class="form-group">
        <label>Nome</label>
        <input type="text" name="nome" placeholder="Giacomo" required>
      </div>
      <div class="form-group">
        <label>Cognome</label>
        <input type="text" name="cognome" placeholder="Garofani" required>
      </div>
      <div class="form-group">
        <label>Email Ufficiale Super Admin</label>
        <input type="email" name="email" placeholder="garofanigiacomo@hotmail.it" required>
      </div>
      <div class="form-group">
        <label>Password (minimo 8 caratteri)</label>
        <input type="password" name="password" minlength="8" required>
      </div>
      <button type="submit" class="btn-submit">Crea Account Super Admin</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* =========================================================================
   VISTE INTERNE DELLA DASHBOARD
   ========================================================================= */

function renderVistaDashboard(countDomande, countSociAttivi, countCorsi, listaDomande, tema) {
  return `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Domande in Attesa CD</div>
        <div class="stat-val" style="color: #F59E0B;">${countDomande}</div>
        <div class="stat-desc">Richieste di ammissione da deliberare</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Soci Attivi & Tesserati</div>
        <div class="stat-val" style="color: #10B981;">${countSociAttivi}</div>
        <div class="stat-desc">Soci con tessera APS attiva</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Attività & Laboratori</div>
        <div class="stat-val">${countCorsi}</div>
        <div class="stat-desc">Corsi di teatro attivi</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Spettacoli & Cassa</div>
        <div class="stat-val">0 €</div>
        <div class="stat-desc">Incassi del mese corrente</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">Centro di Controllo • Tutte le Macro-Aree</div>
      <div class="card-sub">Naviga rapidamente tra i settori del gestionale approvati nella Bibbia</div>

      <div class="hub-grid">
        <a href="/admin?view=hub-soci" class="hub-card">
          <div class="hub-card-header">
            <span class="hub-card-title">Soci & Libro Soci</span>
            <span class="badge-count">4 sezioni</span>
          </div>
          <div class="hub-card-desc">Gestione domande di ammissione, Libro Soci ufficiale, anagrafiche minori, quote sociali e tesseramento nazionale UILT.</div>
        </a>

        <a href="/admin?view=hub-corsi" class="hub-card">
          <div class="hub-card-header">
            <span class="hub-card-title">Attività & Corsi</span>
            <span class="badge-count">3 sezioni</span>
          </div>
          <div class="hub-card-desc">Laboratori teatrali per bambini, ragazzi e adulti, registri allievi, quote di frequenza e foglio presenze.</div>
        </a>

        <a href="/admin?view=hub-eventi" class="hub-card">
          <div class="hub-card-header">
            <span class="hub-card-title">Eventi, Teatro & Casse</span>
            <span class="badge-count">5 sezioni</span>
          </div>
          <div class="hub-card-desc">Cartellone spettacoli, cene con delitto, eventi sul territorio, gestione prenotazioni e casse distinte.</div>
        </a>

        <a href="/admin?view=theme-builder" class="hub-card" style="border-color: rgba(217, 130, 149, 0.4);">
          <div class="hub-card-header">
            <span class="hub-card-title" style="color: var(--color-primary)">Builder Tema & Brand</span>
            <span class="badge-count" style="background: rgba(217,130,149,0.2); color: var(--color-primary);">Macro 4.2</span>
          </div>
          <div class="hub-card-desc">Personalizza logo ufficiale, palette colori (rosa cervello, argento maschere), scala font e dati legali.</div>
        </a>
      </div>
    </div>

    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div>
          <div class="card-title">Ultime Domande di Ammissione</div>
          <div class="card-sub" style="margin-bottom:0">Richieste recenti inviate dal modulo online pubblico</div>
        </div>
        <a href="/admin?view=domande" class="btn btn-secondary">Vedi Tutte</a>
      </div>
      ${renderTabellaDomande(listaDomande.slice(0, 5))}
    </div>
  `;
}

function renderTabellaDomande(domande) {
  if (!domande || domande.length === 0) {
    return `<div style="text-align:center; padding: 30px; color: #71717A; font-size: 13.5px;">Nessuna domanda di ammissione presente nel database.</div>`;
  }

  const rows = domande.map(d => {
    const isMinore = !!d.tutore_nome;
    const nomeCompleto = `${d.nome} ${d.cognome}`;
    const infoTutore = isMinore ? `<div style="font-size:11px; color:#A1A1AA; margin-top:2px;">Tutore: ${d.tutore_nome} ${d.tutore_cognome} (${d.tutore_email || d.tutore_tel || ''})</div>` : '';
    const badgeStato = d.stato_ammissione === 'approvata'
      ? '<span class="badge badge-approved">Approvata</span>'
      : '<span class="badge badge-pending">In Attesa CD</span>';

    const btnAzione = d.stato_ammissione === 'in_attesa'
      ? `<button onclick="apriModaleDelibera('${d.id}', '${nomeCompleto.replace(/'/g, "\\'")}', '${d.tipologia}')" class="btn btn-primary" style="padding: 6px 12px; font-size: 12px;">Approva &amp; Tessera</button>`
      : '<span style="color:#10B981; font-size:12px; font-weight:700;">Deliberato</span>';

    return `
      <tr>
        <td>
          <strong style="color:#FFF;">${nomeCompleto}</strong>
          ${infoTutore}
        </td>
        <td><span class="badge" style="background:#27272A; color:#E4E4E7;">${d.tipologia.toUpperCase()}</span></td>
        <td><strong>${d.quota_dovuta || 0} €</strong></td>
        <td><span style="font-size:12px; color:#A1A1AA;">${d.creato_il ? d.creato_il.substring(0, 10) : '-'}</span></td>
        <td>${badgeStato}</td>
        <td style="text-align: right;">${btnAzione}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th>Nominativo Socio</th>
            <th>Tipologia</th>
            <th>Quota APS</th>
            <th>Data Richiesta</th>
            <th>Stato</th>
            <th style="text-align: right;">Azione</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function renderHubSoci(countDomande, countSociAttivi) {
  return `
    <div class="card">
      <div class="card-title">Macro-Area 1: Soci & Libro Soci</div>
      <div class="card-sub">Gestione del corpo sociale, conformità Codice Terzo Settore e affiliazione UILT</div>

      <div class="hub-grid">
        <a href="/admin?view=domande" class="hub-card">
          <div class="hub-card-header">
            <span class="hub-card-title">1.1 Domande Ammissione</span>
            <span class="badge-count" style="background: rgba(245,158,11,0.2); color:#F59E0B;">${countDomande} in attesa</span>
          </div>
          <div class="hub-card-desc">Valutazione formale e delibera del Consiglio Direttivo con verbalizzazione automatica.</div>
        </a>

        <a href="/admin?view=libro-soci" class="hub-card">
          <div class="hub-card-header">
            <span class="hub-card-title">1.2 Libro Soci Ufficiale</span>
            <span class="badge-count">${countSociAttivi} attivi</span>
          </div>
          <div class="hub-card-desc">Registro progressivo vidimabile ed esportabile in PDF/Excel conforme CTS.</div>
        </a>

        <a href="/admin?view=quote-uilt" class="hub-card">
          <div class="hub-card-header">
            <span class="hub-card-title">1.3 Quote & Tessere UILT</span>
            <span class="badge-count">Annualità 2026</span>
          </div>
          <div class="hub-card-desc">Monitoraggio quote associative APS, caricamento e invio tessere assicurative UILT.</div>
        </a>
      </div>
    </div>
  `;
}

function renderHubCorsi(countCorsi) {
  return `
    <div class="card">
      <div class="card-title">Macro-Area 2: Attività & Corsi Teatrali</div>
      <div class="card-sub">Gestione allievi, laboratori per ragazzi e adulti e registri presenze</div>
      <div class="hub-grid">
        <div class="hub-card">
          <div class="hub-card-header"><span class="hub-card-title">2.1 Laboratori Teatrali</span><span class="badge-count">${countCorsi} attivi</span></div>
          <div class="hub-card-desc">Corsi annuali, quote di frequenza periodiche e docenti referenti.</div>
        </div>
        <div class="hub-card">
          <div class="hub-card-header"><span class="hub-card-title">2.2 Registro Allievi</span></div>
          <div class="hub-card-desc">Anagrafiche allievi, deleghe di ritiro per minori e contatti d'emergenza.</div>
        </div>
      </div>
    </div>
  `;
}

function renderHubEventi() {
  return `
    <div class="card">
      <div class="card-title">Macro-Area 3: Eventi, Teatro & Casse</div>
      <div class="card-sub">Gestione cartellone, prenotazioni e casse distinte conformi alla Bibbia</div>
      <div class="hub-grid">
        <div class="hub-card">
          <div class="hub-card-header"><span class="hub-card-title">3.1 Spettacoli Teatrali</span></div>
          <div class="hub-card-desc">Biglietti, capienza platea, assegnazione posti e cassa teatrale.</div>
        </div>
        <div class="hub-card">
          <div class="hub-card-header"><span class="hub-card-title">3.2 Eventi Altri (Cene con Delitto)</span></div>
          <div class="hub-card-desc">Moduli prenotazione dinamici e cassa personalizzabile per eventi esterni.</div>
        </div>
      </div>
    </div>
  `;
}

function renderHubBuilder() {
  return `
    <div class="card">
      <div class="card-title">Macro-Area 4: Builder & Contenuti</div>
      <div class="card-sub">Personalizzazione grafica e modulare della piattaforma senza scrivere codice</div>
      <div class="hub-grid">
        <a href="/admin?view=theme-builder" class="hub-card" style="border-color: var(--color-primary)">
          <div class="hub-card-header"><span class="hub-card-title" style="color:var(--color-primary)">4.2 Builder Tema & Brand</span></div>
          <div class="hub-card-desc">Configurazione colori, logo ufficiale ad alta definizione e dati istituzionali.</div>
        </a>
        <div class="hub-card">
          <div class="hub-card-header"><span class="hub-card-title">4.1 Form Builder</span></div>
          <div class="hub-card-desc">Creazione e modifica dei campi dei moduli pubblici online.</div>
        </div>
      </div>
    </div>
  `;
}

function renderHubSistema() {
  return `
    <div class="card">
      <div class="card-title">Macro-Area 5: Sistema & Utenti</div>
      <div class="card-sub">Gestione account, ruoli operativi, audit log e sicurezza del gestionale</div>
      <div class="hub-grid">
        <div class="hub-card">
          <div class="hub-card-header"><span class="hub-card-title">5.1 Gestione Utenti & Ruoli</span></div>
          <div class="hub-card-desc">Super Admin, cassieri, segreteria e volontari con permessi differenziati.</div>
        </div>
      </div>
    </div>
  `;
}

/* =========================================================================
   VISTA 4.2: BUILDER TEMA & IDENTITÀ VISIVA (D1 SETTINGS)
   ========================================================================= */

function renderThemeBuilderView(tema, msg, err) {
  return `
    <form method="POST" action="/admin/salva-tema">
      <div class="card">
        <div class="card-title">Identità Istituzionale & Contatti</div>
        <div class="card-sub">I dati qui impostati vengono salvati nel database Cloudflare D1 e usati su tutte le pagine e comunicazioni.</div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 16px;">
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:#A1A1AA; margin-bottom:6px;">Nome Ufficiale APS</label>
            <input type="text" name="nome_associazione" value="${tema.nome_associazione.replace(/"/g, '&quot;')}" required style="width:100%; padding:10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
          </div>
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:#A1A1AA; margin-bottom:6px;">Dominio Ufficiale</label>
            <input type="text" name="dominio_ufficiale" value="${tema.dominio_ufficiale.replace(/"/g, '&quot;')}" required style="width:100%; padding:10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
          </div>
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:#A1A1AA; margin-bottom:6px;">Email Istituzionale di Contatto</label>
            <input type="email" name="email_contatto" value="${tema.email_contatto.replace(/"/g, '&quot;')}" required style="width:100%; padding:10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Logo Ufficiale Trasparente</div>
        <div class="card-sub">Immagine del logo (cervello rosa e maschere d'argento) con sfondo trasparente</div>

        <div style="display: flex; gap: 20px; align-items: center; flex-wrap: wrap;">
          <div style="width: 80px; height: 80px; background: #000; border: 1px solid #27272A; border-radius: 12px; display: flex; align-items: center; justify-content: center; padding: 8px;">
            <img src="${tema.url_logo}" alt="Anteprima Logo" style="max-width: 100%; max-height: 100%; object-fit: contain;">
          </div>
          <div style="flex: 1; min-width: 250px;">
            <label style="display:block; font-size:12px; font-weight:700; color:#A1A1AA; margin-bottom:6px;">URL Immagine Logo (PNG trasparente)</label>
            <input type="url" name="url_logo" value="${tema.url_logo.replace(/"/g, '&quot;')}" required style="width:100%; padding:10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Palette Teatrale & Colori Ufficiali</div>
        <div class="card-sub">Personalizza i codici colore esadecimali del brand Cervelli in Affitto APS</div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:#A1A1AA; margin-bottom:6px;">Colore Primario (Rosa Cervello)</label>
            <div style="display:flex; gap:8px;">
              <input type="color" value="${tema.colore_primario}" onchange="document.getElementById('inputPrimario').value = this.value" style="width:44px; height:42px; border:none; border-radius:6px; cursor:pointer; background:none;">
              <input type="text" id="inputPrimario" name="colore_primario" value="${tema.colore_primario}" style="flex:1; padding:10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
            </div>
          </div>
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:#A1A1AA; margin-bottom:6px;">Colore Secondario (Argento Maschere)</label>
            <div style="display:flex; gap:8px;">
              <input type="color" value="${tema.colore_secondario}" onchange="document.getElementById('inputSecondario').value = this.value" style="width:44px; height:42px; border:none; border-radius:6px; cursor:pointer; background:none;">
              <input type="text" id="inputSecondario" name="colore_secondario" value="${tema.colore_secondario}" style="flex:1; padding:10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
            </div>
          </div>
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:#A1A1AA; margin-bottom:6px;">Colore Sfondo Scuro (Nero Ribalta)</label>
            <div style="display:flex; gap:8px;">
              <input type="color" value="${tema.colore_scuro}" onchange="document.getElementById('inputScuro').value = this.value" style="width:44px; height:42px; border:none; border-radius:6px; cursor:pointer; background:none;">
              <input type="text" id="inputScuro" name="colore_scuro" value="${tema.colore_scuro}" style="flex:1; padding:10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
            </div>
          </div>
          <div>
            <label style="display:block; font-size:12px; font-weight:700; color:#A1A1AA; margin-bottom:6px;">Scala Caratteri</label>
            <select name="scala_font" style="width:100%; height:42px; padding:0 10px; background:#121214; border:1px solid #27272A; border-radius:6px; color:#FFF;">
              <option value="compatta" ${tema.scala_font === 'compatta' ? 'selected' : ''}>Compatta (Desktop compatto)</option>
              <option value="normale" ${tema.scala_font === 'normale' ? 'selected' : ''}>Normale (Predefinita)</option>
              <option value="grande" ${tema.scala_font === 'grande' ? 'selected' : ''}>Grande (Maggiore leggibilità)</option>
            </select>
          </div>
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 10px;">
        <a href="/admin?view=dashboard" class="btn btn-secondary">Annulla</a>
        <button type="submit" class="btn btn-primary" style="padding: 12px 24px; font-size: 14.5px;">Salva Modifiche nel Database</button>
      </div>
    </form>
  `;
}

/* =========================================================================
   PORTALE PUBBLICO: WIZARD ISCRIZIONE E DOMANDA SOCIO (5 STEP)
   ========================================================================= */

async function seedDefaultCourseIfNeeded(env) {
  try {
    const existing = await env.DB.prepare(
      "SELECT id FROM attivita_eventi WHERE id = 'corso-teatro-ragazzi-2026' LIMIT 1"
    ).first();

    if (!existing) {
      await env.DB.prepare(`
        INSERT INTO attivita_eventi (id, tipologia, titolo, descrizione, quota_default, attivo, creato_il)
        VALUES ('corso-teatro-ragazzi-2026', 'corso', 'Laboratorio Teatrale Bambini & Ragazzi', 'Laboratorio propedeutico teatrale annuale con spettacolo di fine anno.', 20.0, 1, datetime('now'))
      `).run();
    }
  } catch (err) {
    console.error("Errore seed corso:", err);
  }
}

async function handleIscrizionePost(request, env, ctx) {
  try {
    const form = await request.formData();

    // Dati Minore
    const nomeMinore = form.get("minore_nome")?.trim();
    const cognomeMinore = form.get("minore_cognome")?.trim();
    const cfMinore = form.get("minore_cf")?.trim().toUpperCase();
    const dataNascitaMinore = form.get("minore_data_nascita");
    const luogoNascitaMinore = form.get("minore_luogo_nascita")?.trim();
    const corsoId = form.get("corso_id") || "corso-teatro-ragazzi-2026";
    const noteSalute = form.get("note_salute")?.trim();

    // Dati Tutore
    const nomeTutore = form.get("tutore_nome")?.trim();
    const cognomeTutore = form.get("tutore_cognome")?.trim();
    const cfTutore = form.get("tutore_cf")?.trim().toUpperCase();
    const emailTutore = form.get("tutore_email")?.trim().toLowerCase();
    const telefonoTutore = form.get("tutore_telefono")?.trim();
    const indirizzoTutore = form.get("tutore_indirizzo")?.trim();
    const cittaTutore = form.get("tutore_citta")?.trim();
    const capTutore = form.get("tutore_cap")?.trim();

    // Deleghe facoltative
    const delega1Nome = form.get("delega_1_nome")?.trim();
    const delega1Cognome = form.get("delega_1_cognome")?.trim();
    const delega1Telefono = form.get("delega_1_telefono")?.trim();
    const delega1Doc = form.get("delega_1_documento")?.trim();

    if (!nomeMinore || !cognomeMinore || !cfMinore || !nomeTutore || !cognomeTutore || !emailTutore || !telefonoTutore) {
      return new Response("Dati obbligatori mancanti.", { status: 400 });
    }

    // 1. Registra o aggiorna il tutore
    let tutoreId = null;
    const existingTutore = await env.DB.prepare(
      "SELECT id FROM tutori WHERE codice_fiscale = ? OR email = ? LIMIT 1"
    ).bind(cfTutore, emailTutore).first();

    if (existingTutore) {
      tutoreId = existingTutore.id;
      await env.DB.prepare(`
        UPDATE tutori SET nome = ?, cognome = ?, telefono = ?, indirizzo_residenza = ?, citta_residenza = ?, cap = ?
        WHERE id = ?
      `).bind(nomeTutore, cognomeTutore, telefonoTutore, indirizzoTutore, cittaTutore, capTutore, tutoreId).run();
    } else {
      const resTutore = await env.DB.prepare(`
        INSERT INTO tutori (nome, cognome, codice_fiscale, email, telefono, indirizzo_residenza, citta_residenza, cap, creato_il)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).bind(nomeTutore, cognomeTutore, cfTutore, emailTutore, telefonoTutore, indirizzoTutore, cittaTutore, capTutore).run();
      tutoreId = resTutore.meta.last_row_id;
    }

    // 2. Registra il socio (Minore con tipologia Ordinario per delibera CD)
    const resSocio = await env.DB.prepare(`
      INSERT INTO soci (
        nome, cognome, codice_fiscale, data_nascita, luogo_nascita,
        tutore_id, tipologia, quota_dovuta, note_sanitarie, stato_ammissione, creato_il
      ) VALUES (?, ?, ?, ?, ?, ?, 'ordinario', 20.0, ?, 'in_attesa', datetime('now'))
    `).bind(nomeMinore, cognomeMinore, cfMinore, dataNascitaMinore, luogoNascitaMinore, tutoreId, noteSalute).run();
    const socioId = resSocio.meta.last_row_id;

    // 3. Iscrizione al laboratorio teatrale
    await env.DB.prepare(`
      INSERT INTO iscrizioni_corsi (socio_id, corso_id, quota_frequenza, data_iscrizione, stato)
      VALUES (?, ?, 20.0, datetime('now'), 'richiesta')
    `).bind(socioId, corsoId).run();

    // 4. Deleghe di ritiro minori (se fornite)
    if (delega1Nome && delega1Cognome) {
      await env.DB.prepare(`
        INSERT INTO deleghe_ritiro (minore_id, nome, cognome, telefono, documento_tipo_numero, autorizzato_dal_tutore)
        VALUES (?, ?, ?, ?, ?, 1)
      `).bind(socioId, delega1Nome, delega1Cognome, delega1Telefono, delega1Doc).run();
    }

    // Invio notifica email tramite Resend (se la chiave è presente nei secret)
    if (env.RESEND_API_KEY) {
      ctx.waitUntil(inviaEmailConfermaIscrizione(env, emailTutore, nomeTutore, nomeMinore));
    }

    return new Response(null, {
      status: 302,
      headers: { Location: `/?success=1&minore=${encodeURIComponent(nomeMinore)}` }
    });
  } catch (err) {
    console.error("Errore salvataggio domanda socio/minore:", err);
    return new Response("Errore durante l'elaborazione della domanda: " + err.message, { status: 500 });
  }
}

async function inviaEmailConfermaIscrizione(env, emailDestinatario, nomeTutore, nomeMinore) {
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Cervelli in Affitto APS <info@cervelliinaffitto-aps.it>",
        to: [emailDestinatario],
        subject: `Richiesta Iscrizione Ricevuta • ${nomeMinore}`,
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; color: #121214;">
            <h2 style="color: #D98295;">Cervelli in Affitto APS</h2>
            <p>Gentile <strong>${nomeTutore}</strong>,</p>
            <p>Abbiamo acquisito con successo la richiesta di ammissione a socio e l'iscrizione al laboratorio teatrale per <strong>${nomeMinore}</strong>.</p>
            <p>La domanda è stata inserita all'ordine del giorno del prossimo Consiglio Direttivo per la delibera formale e l'attribuzione del numero di tessera APS.</p>
            <p style="color: #71717A; font-size: 13px; margin-top: 30px; border-top: 1px solid #E5E7EB; padding-top: 15px;">
              Cervelli in Affitto APS • Dominio: cervelliinaffitto-aps.it • Affiliato UILT
            </p>
          </div>
        `
      })
    });
  } catch (e) {
    console.error("Errore invio email Resend:", e);
  }
}

function renderPublicWizard(step, isSuccess, searchParams) {
  if (isSuccess) {
    const nomeMinore = searchParams.get("minore") || "l'allievo/a";
    return renderPublicSuccess(nomeMinore);
  }

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iscrizione Corsi & Domanda Socio • Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --primary: #D98295;
      --secondary: #E8E7E9;
      --dark: #121214;
      --bg: #F4F4F5;
      --surface: #FFFFFF;
      --border: #E4E4E7;
      --text: #18181B;
      --text-muted: #71717A;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* THEATER HEADER (SCURO) */
    .pub-header {
      background: var(--dark);
      border-bottom: 2px solid var(--primary);
      padding: 24px 20px;
      text-align: center;
    }
    .pub-logo-box {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
    }
    .pub-logo-img {
      width: 44px;
      height: 44px;
      object-fit: contain;
    }
    .pub-brand-title {
      font-size: 22px;
      font-weight: 800;
      color: #FFF;
      letter-spacing: -0.3px;
    }
    .pub-brand-sub {
      font-size: 13px;
      color: #A1A1AA;
      margin-top: 2px;
    }

    /* STEPPER */
    .stepper-wrap {
      max-width: 680px;
      margin: 28px auto 0 auto;
      padding: 0 20px;
      width: 100%;
    }
    .stepper {
      display: flex;
      justify-content: space-between;
      position: relative;
      margin-bottom: 24px;
    }
    .stepper::before {
      content: '';
      position: absolute;
      top: 16px;
      left: 10%;
      right: 10%;
      height: 2px;
      background: var(--border);
      z-index: 1;
    }
    .step-item {
      position: relative;
      z-index: 2;
      text-align: center;
      background: var(--bg);
      padding: 0 8px;
    }
    .step-circle {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #E4E4E7;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      font-weight: 700;
      margin: 0 auto 6px auto;
      transition: all 0.2s ease;
    }
    .step-item.active .step-circle {
      background: var(--primary);
      color: var(--dark);
      box-shadow: 0 0 0 4px rgba(217, 130, 149, 0.25);
    }
    .step-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .step-item.active .step-label { color: var(--text); }

    /* FORM CARD (CHIARO E LEGGIBILE) */
    .form-container {
      max-width: 680px;
      margin: 0 auto 40px auto;
      padding: 0 20px;
      width: 100%;
      flex: 1;
    }
    .form-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.04);
    }
    .form-step-title {
      font-size: 19px;
      font-weight: 800;
      color: var(--text);
      margin-bottom: 6px;
    }
    .form-step-sub {
      font-size: 13.5px;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 24px;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
      margin-bottom: 20px;
    }
    .form-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-field label {
      font-size: 12.5px;
      font-weight: 700;
      color: #3F3F46;
    }
    .form-field input, .form-field select, .form-field textarea {
      padding: 11px 13px;
      border: 1px solid var(--border);
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      color: var(--text);
      background: #FAFAFA;
      outline: none;
      transition: all 0.15s ease;
    }
    .form-field input:focus, .form-field select:focus, .form-field textarea:focus {
      border-color: var(--primary);
      background: #FFFFFF;
      box-shadow: 0 0 0 3px rgba(217, 130, 149, 0.15);
    }

    /* STEP NAVIGATION */
    .step-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 28px;
      padding-top: 20px;
      border-top: 1px solid var(--border);
    }
    .btn-step {
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 700;
      cursor: pointer;
      border: none;
      transition: all 0.15s;
    }
    .btn-step-prev { background: #E4E4E7; color: #27272A; }
    .btn-step-next { background: var(--primary); color: var(--dark); margin-left: auto; }

    /* FOOTER TEATRALE */
    .pub-footer {
      background: var(--dark);
      border-top: 1px solid #27272A;
      color: #A1A1AA;
      padding: 24px 20px;
      text-align: center;
      font-size: 12.5px;
      line-height: 1.6;
    }
    .pub-footer a { color: var(--primary); text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <!-- HEADER TEATRALE -->
  <header class="pub-header">
    <a href="/" class="pub-logo-box">
      <img src="https://lh3.googleusercontent.com/d/1h-xfyBoxK5TuAsx-FamJIXf3nFh7FVoO" alt="Logo" class="pub-logo-img">
      <div>
        <div class="pub-brand-title">Cervelli in Affitto APS</div>
        <div class="pub-brand-sub">Modulo Iscrizione Laboratori & Richiesta Ammissione Socio</div>
      </div>
    </a>
  </header>

  <!-- STEPPER -->
  <div class="stepper-wrap">
    <div class="stepper">
      <div class="step-item active" id="stItem1"><div class="step-circle">1</div><div class="step-label">Minore</div></div>
      <div class="step-item" id="stItem2"><div class="step-circle">2</div><div class="step-label">Genitore</div></div>
      <div class="step-item" id="stItem3"><div class="step-circle">3</div><div class="step-label">Deleghe</div></div>
      <div class="step-item" id="stItem4"><div class="step-circle">4</div><div class="step-label">Privacy</div></div>
      <div class="step-item" id="stItem5"><div class="step-circle">5</div><div class="step-label">Riepilogo</div></div>
    </div>
  </div>

  <!-- FORM WIZARD -->
  <main class="form-container">
    <div class="form-card">
      <form id="wizardForm" method="POST" action="/iscrizione-minori">

        <!-- STEP 1: DATI MINORE -->
        <div class="wizard-step" id="step1">
          <div class="form-step-title">1. Dati dell'Allievo/a (Minore)</div>
          <div class="form-step-sub">Inserisci le informazioni anagrafiche del bambino/ragazzo da iscrivere al corso teatrale.</div>

          <div class="form-grid">
            <div class="form-field">
              <label>Nome del Minore *</label>
              <input type="text" name="minore_nome" id="minore_nome" required>
            </div>
            <div class="form-field">
              <label>Cognome del Minore *</label>
              <input type="text" name="minore_cognome" id="minore_cognome" required>
            </div>
            <div class="form-field">
              <label>Codice Fiscale Minore *</label>
              <input type="text" name="minore_cf" id="minore_cf" maxlength="16" placeholder="Es. RSSMRA14A01H501U" style="text-transform:uppercase;" required>
            </div>
            <div class="form-field">
              <label>Data di Nascita *</label>
              <input type="date" name="minore_data_nascita" id="minore_data_nascita" required>
            </div>
            <div class="form-field">
              <label>Luogo di Nascita *</label>
              <input type="text" name="minore_luogo_nascita" id="minore_luogo_nascita" required>
            </div>
            <div class="form-field">
              <label>Laboratorio Teatrale *</label>
              <select name="corso_id" id="corso_id" required>
                <option value="corso-teatro-ragazzi-2026">Laboratorio Bambini &amp; Ragazzi (Quota annuale 20 €)</option>
              </select>
            </div>
          </div>

          <div class="form-field" style="margin-bottom: 20px;">
            <label>Allergie o Note Sanitarie Rilevanti (Facoltativo)</label>
            <textarea name="note_salute" id="note_salute" rows="2" placeholder="Indicare eventuali intolleranze alimentari per le pause o note sanitarie"></textarea>
          </div>

          <div class="step-actions">
            <button type="button" class="btn-step btn-step-next" onclick="goToStep(2)">Avanti: Dati Genitore →</button>
          </div>
        </div>

        <!-- STEP 2: DATI TUTORE -->
        <div class="wizard-step" id="step2" style="display:none;">
          <div class="form-step-title">2. Dati del Genitore / Tutore Legale</div>
          <div class="form-step-sub">I recapiti del tutore verranno utilizzati per le comunicazioni istituzionali e l'ammissione a socio.</div>

          <div class="form-grid">
            <div class="form-field">
              <label>Nome Genitore *</label>
              <input type="text" name="tutore_nome" id="tutore_nome">
            </div>
            <div class="form-field">
              <label>Cognome Genitore *</label>
              <input type="text" name="tutore_cognome" id="tutore_cognome">
            </div>
            <div class="form-field">
              <label>Codice Fiscale Genitore *</label>
              <input type="text" name="tutore_cf" id="tutore_cf" maxlength="16" style="text-transform:uppercase;">
            </div>
            <div class="form-field">
              <label>Email Ufficiale Genitore *</label>
              <input type="email" name="tutore_email" id="tutore_email" placeholder="nome@dominio.it">
            </div>
            <div class="form-field">
              <label>Telefono / Cellulare *</label>
              <input type="tel" name="tutore_telefono" id="tutore_telefono">
            </div>
            <div class="form-field">
              <label>Indirizzo di Residenza *</label>
              <input type="text" name="tutore_indirizzo" id="tutore_indirizzo">
            </div>
            <div class="form-field">
              <label>Città di Residenza *</label>
              <input type="text" name="tutore_citta" id="tutore_citta">
            </div>
            <div class="form-field">
              <label>CAP *</label>
              <input type="text" name="tutore_cap" id="tutore_cap" maxlength="5">
            </div>
          </div>

          <div class="step-actions">
            <button type="button" class="btn-step btn-step-prev" onclick="goToStep(1)">← Indietro</button>
            <button type="button" class="btn-step btn-step-next" onclick="goToStep(3)">Avanti: Deleghe Ritiro →</button>
          </div>
        </div>

        <!-- STEP 3: DELEGHE RITIRO -->
        <div class="wizard-step" id="step3" style="display:none;">
          <div class="form-step-title">3. Deleghe di Ritiro del Minore</div>
          <div class="form-step-sub">Persone autorizzate a prendere in consegna il minore al termine del laboratorio teatrale (facoltativo).</div>

          <div class="form-grid">
            <div class="form-field">
              <label>Nome Persona Delegata</label>
              <input type="text" name="delega_1_nome" id="delega_1_nome">
            </div>
            <div class="form-field">
              <label>Cognome Persona Delegata</label>
              <input type="text" name="delega_1_cognome" id="delega_1_cognome">
            </div>
            <div class="form-field">
              <label>Telefono Delegato</label>
              <input type="tel" name="delega_1_telefono" id="delega_1_telefono">
            </div>
            <div class="form-field">
              <label>Documento di Riconoscimento</label>
              <input type="text" name="delega_1_documento" id="delega_1_documento" placeholder="Es. CI n. CA12345XY">
            </div>
          </div>

          <div class="step-actions">
            <button type="button" class="btn-step btn-step-prev" onclick="goToStep(2)">← Indietro</button>
            <button type="button" class="btn-step btn-step-next" onclick="goToStep(4)">Avanti: Consensi &amp; Privacy →</button>
          </div>
        </div>

        <!-- STEP 4: CONSENSI E PRIVACY -->
        <div class="wizard-step" id="step4" style="display:none;">
          <div class="form-step-title">4. Consensi Istituzionali &amp; Statuto</div>
          <div class="form-step-sub">Presa visione dello statuto dell'APS e consensi ai sensi del Regolamento UE 2016/679 (GDPR).</div>

          <div style="display:flex; flex-direction:column; gap:16px; margin-bottom:24px;">
            <label style="display:flex; gap:12px; align-items:flex-start; font-size:13.5px; line-height:1.5;">
              <input type="checkbox" name="accetto_statuto" id="accetto_statuto" required style="margin-top:3px;">
              <span>Dichiaro di aver preso visione dello <strong>Statuto di Cervelli in Affitto APS</strong> e richiedo l'ammissione a socio Ordinario per il minore ai sensi del Codice del Terzo Settore. *</span>
            </label>
            <label style="display:flex; gap:12px; align-items:flex-start; font-size:13.5px; line-height:1.5;">
              <input type="checkbox" name="accetto_privacy" id="accetto_privacy" required style="margin-top:3px;">
              <span>Acconsento al trattamento dei dati personali per la gestione del libro soci e la copertura assicurativa UILT. *</span>
            </label>
            <label style="display:flex; gap:12px; align-items:flex-start; font-size:13.5px; line-height:1.5;">
              <input type="checkbox" name="accetto_foto" id="accetto_foto" style="margin-top:3px;">
              <span>Autorizzo le riprese foto/video durante le attività e il saggio di fine anno a fini esclusivamente associativi e documentari. (Facoltativo)</span>
            </label>
          </div>

          <div class="step-actions">
            <button type="button" class="btn-step btn-step-prev" onclick="goToStep(3)">← Indietro</button>
            <button type="button" class="btn-step btn-step-next" onclick="goToStep(5)">Avanti: Riepilogo →</button>
          </div>
        </div>

        <!-- STEP 5: RIEPILOGO FINALE -->
        <div class="wizard-step" id="step5" style="display:none;">
          <div class="form-step-title">5. Riepilogo Domanda &amp; Invio</div>
          <div class="form-step-sub">Controlla i dati prima di inviare formalmente la richiesta di ammissione a socio.</div>

          <div id="reviewBox" style="background:#F4F4F5; border:1px solid var(--border); border-radius:10px; padding:20px; font-size:13.5px; line-height:1.7; margin-bottom:24px;"></div>

          <div class="step-actions">
            <button type="button" class="btn-step btn-step-prev" onclick="goToStep(4)">← Modifica Dati</button>
            <button type="submit" class="btn-step btn-step-next" style="background:#10B981; color:#FFF;">Invia Domanda di Ammissione</button>
          </div>
        </div>

      </form>
    </div>
  </main>

  <!-- FOOTER -->
  <footer class="pub-footer">
    <p><strong>Cervelli in Affitto APS</strong> • Associazione di Promozione Sociale Teatrale</p>
    <p>Sede Legale • Dominio: cervelliinaffitto-aps.it • Affiliata UILT (Unione Italiana Libero Teatro)</p>
    <p style="margin-top:8px;"><a href="/admin">Accesso Riservato Amministrazione</a></p>
  </footer>

  <script>
    function goToStep(num) {
      if (num === 2) {
        if (!document.getElementById('minore_nome').value || !document.getElementById('minore_cognome').value || !document.getElementById('minore_cf').value) {
          alert('Compila tutti i campi obbligatori del minore.');
          return;
        }
      }
      if (num === 3) {
        if (!document.getElementById('tutore_nome').value || !document.getElementById('tutore_cognome').value || !document.getElementById('tutore_email').value || !document.getElementById('tutore_telefono').value) {
          alert('Compila tutti i campi obbligatori del genitore.');
          return;
        }
      }
      if (num === 5) {
        if (!document.getElementById('accetto_statuto').checked || !document.getElementById('accetto_privacy').checked) {
          alert('È necessario accettare lo Statuto e l\\'informativa Privacy per inviare la domanda.');
          return;
        }
        populateReview();
      }

      for (let i = 1; i <= 5; i++) {
        document.getElementById('step' + i).style.display = (i === num) ? 'block' : 'none';
        const item = document.getElementById('stItem' + i);
        if (i === num) item.classList.add('active');
        else if (i < num) item.classList.add('active');
        else item.classList.remove('active');
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function populateReview() {
      const box = document.getElementById('reviewBox');
      const mNome = document.getElementById('minore_nome').value + ' ' + document.getElementById('minore_cognome').value;
      const mCF = document.getElementById('minore_cf').value;
      const tNome = document.getElementById('tutore_nome').value + ' ' + document.getElementById('tutore_cognome').value;
      const tMail = document.getElementById('tutore_email').value;
      const tTel = document.getElementById('tutore_telefono').value;

      box.innerHTML = '<strong>Allievo/a (Socio Minore):</strong> ' + mNome + ' (CF: ' + mCF + ')<br>' +
                      '<strong>Genitore / Tutore:</strong> ' + tNome + '<br>' +
                      '<strong>Recapiti:</strong> ' + tMail + ' • ' + tTel + '<br>' +
                      '<strong>Quota Associativa Richiesta:</strong> 20,00 € (Tesseramento APS e copertura assicurativa UILT inclusa)<br>' +
                      '<p style="margin-top:10px; color:#71717A; font-size:12px;">Cliccando su "Invia Domanda" la richiesta verrà acquisita e sottoposta alla formale delibera del Consiglio Direttivo.</p>';
    }
  </script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

function renderPublicSuccess(nomeSocio) {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Domanda Ricevuta • Cervelli in Affitto APS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap" rel="stylesheet">
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
      padding: 40px;
      max-width: 500px;
      width: 100%;
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
