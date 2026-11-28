/**
 * Cervelli in Affitto APS - Gestionale Ufficiale (Bibbia v2.4)
 * Router principale modulare: collega Sidebar, Placeholder e viste per Macro-Area
 */

import { renderSidebar } from './sidebar.js';
import { renderPlaceholder } from './placeholder.js';
import { renderDomandeView } from './area1-soci/1-1-domande.js';
import { renderThemeBuilderView } from './area4-builder/4-3-theme-builder.js';

// Costanti di sicurezza e durata sessione
const SESSION_COOKIE_NAME = "cervelli_admin_session";
const SESSION_DURATION_HOURS = 12;
const PBKDF2_SALT = "cervelli-aps-security-salt-2026";
const LEGACY_SALT_UILT = "uilt-affiliazione-nazionale-2026";

// Impostazioni grafiche e istituzionali predefinite (di fallback)
const DEFAULT_SETTINGS = {
  nome_associazione: "Cervelli in Affitto APS",
  nome_aps: "Cervelli in Affitto APS",
  codice_fiscale_aps: "",
  email_ufficiale: "info@cervelliinaffitto-aps.it",
  email_contatto: "info@cervelliinaffitto-aps.it",
  dominio_sito: "cervelliinaffitto-aps.it",
  dominio_ufficiale: "cervelliinaffitto-aps.it",
  logo_url: "https://lh3.googleusercontent.com/d/1h-xfyBoxK5TuAsx-FamJIXf3nFh7FVoO",
  colore_primario: "#D98295",
  colore_secondario: "#E8E7E9",
  colore_sidebar: "#121214",
  colore_accento: "#E63946",
  colore_sfondo: "#121214",
  scala_font: "16px"
};

/* =========================================================================
   ENTRY POINT CLOUDFLARE WORKER
   ========================================================================= */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Endpoint diagnostico database D1
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

    // 2. Rotte Area Amministrativa Gestionale (/admin*)
    if (url.pathname.startsWith("/admin")) {
      return handleAdminRoutes(request, env, url);
    }

    // 3. Portale Pubblico (Iscrizioni laboratori e ammissione soci)
    await seedDefaultCourseIfNeeded(env);

    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/iscrizione-minori")) {
      return handleIscrizionePost(request, env, ctx);
    }

    if (url.pathname === "/" || url.pathname === "/iscrizione-minori") {
      const step = parseInt(url.searchParams.get("step") || "1", 10);
      const isSuccess = url.searchParams.get("success") === "1";
      return renderPublicWizard(step, isSuccess, url.searchParams, env);
    }

    if (url.pathname === "/iscrizione-confermata") {
      const nomeMinore = url.searchParams.get("minore") || "allievo/a";
      const email = url.searchParams.get("email") || "";
      return renderSuccessPage(nomeMinore, email);
    }

    return new Response("Pagina non trovata", { status: 404 });
  }
};

/* =========================================================================
   ROUTER AREA AMMINISTRATIVA
   ========================================================================= */

async function handleAdminRoutes(request, env, url) {
  // Setup iniziale Super Admin
  if (url.pathname === "/admin/setup" && request.method === "POST") {
    return handleSetupPost(request, env);
  }

  // Login
  if (url.pathname === "/admin/login" && request.method === "POST") {
    return handleLoginPost(request, env);
  }

  // Logout
  if (url.pathname === "/admin/logout") {
    return handleLogout(request, env);
  }

  // Salvataggio Builder Tema POST (Macro-Area 4.3)
  if (url.pathname === "/admin/salva-tema" && request.method === "POST") {
    const session = await getAdminSession(request, env);
    if (!session) {
      return new Response(null, { status: 302, headers: { Location: "/admin" } });
    }
    return handleSalvaTemaPost(request, env);
  }

  // Delibera / Approvazione Socio POST (Macro-Area 1.1)
  if ((url.pathname === "/admin/approva-socio" || url.pathname === "/admin/delibera") && request.method === "POST") {
    const session = await getAdminSession(request, env);
    if (!session) {
      return new Response(null, { status: 302, headers: { Location: "/admin" } });
    }
    return handleApprovaSocioPost(request, env);
  }

  // Verifica presenza di almeno un Super Admin nel DB
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

  // Verifica sessione autenticata
  const session = await getAdminSession(request, env);
  if (!session) {
    const errorMsg = url.searchParams.get("error");
    return renderLoginPage(errorMsg);
  }

  // Visualizzazione interfaccia amministrativa
  return renderAdminApp(env, session.user, url);
}

/* =========================================================================
   RECUPERO E SALVATAGGIO IMPOSTAZIONI TEMA & BRAND
   ========================================================================= */

async function getImpostazioniGestionale(env) {
  const settings = { ...DEFAULT_SETTINGS };
  try {
    const { results } = await env.DB.prepare("SELECT chiave, valore FROM impostazioni_gestionale").all();
    if (results && results.length > 0) {
      results.forEach(row => {
        if (row.valore !== null && row.valore !== undefined && row.valore !== "") {
          settings[row.chiave] = row.valore;
        }
      });
    }
  } catch (e) {
    console.error("Lettura impostazioni_gestionale non riuscita:", e);
  }
  return settings;
}

async function handleSalvaTemaPost(request, env) {
  try {
    const form = await request.formData();

    const nomeAps = form.get("nome_associazione")?.trim() || form.get("nome_aps")?.trim() || DEFAULT_SETTINGS.nome_associazione;
    const cfAps = form.get("codice_fiscale_aps")?.trim() || "";
    const emailAps = form.get("email_ufficiale")?.trim() || form.get("email_contatto")?.trim() || DEFAULT_SETTINGS.email_ufficiale;
    const dominioAps = form.get("dominio_sito")?.trim() || form.get("dominio_ufficiale")?.trim() || DEFAULT_SETTINGS.dominio_sito;
    const logoUrl = form.get("logo_url")?.trim() || DEFAULT_SETTINGS.logo_url;

    const colPrimario = form.get("colore_primario")?.trim() || DEFAULT_SETTINGS.colore_primario;
    const colSecondario = form.get("colore_secondario")?.trim() || DEFAULT_SETTINGS.colore_secondario;
    const colSidebar = form.get("colore_sidebar")?.trim() || DEFAULT_SETTINGS.colore_sidebar;
    const colAccento = form.get("colore_accento")?.trim() || DEFAULT_SETTINGS.colore_accento;
    const scalaFont = form.get("scala_font")?.trim() || DEFAULT_SETTINGS.scala_font;

    const upsertSql = `
      INSERT INTO impostazioni_gestionale (chiave, valore, gruppo)
      VALUES (?, ?, ?)
      ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore;
    `;

    const statements = [
      env.DB.prepare(upsertSql).bind("nome_associazione", nomeAps, "brand"),
      env.DB.prepare(upsertSql).bind("nome_aps", nomeAps, "brand"),
      env.DB.prepare(upsertSql).bind("codice_fiscale_aps", cfAps, "brand"),
      env.DB.prepare(upsertSql).bind("email_ufficiale", emailAps, "contatti"),
      env.DB.prepare(upsertSql).bind("email_contatto", emailAps, "contatti"),
      env.DB.prepare(upsertSql).bind("dominio_sito", dominioAps, "brand"),
      env.DB.prepare(upsertSql).bind("dominio_ufficiale", dominioAps, "brand"),
      env.DB.prepare(upsertSql).bind("logo_url", logoUrl, "brand"),
      env.DB.prepare(upsertSql).bind("colore_primario", colPrimario, "tema"),
      env.DB.prepare(upsertSql).bind("colore_secondario", colSecondario, "tema"),
      env.DB.prepare(upsertSql).bind("colore_sidebar", colSidebar, "tema"),
      env.DB.prepare(upsertSql).bind("colore_accento", colAccento, "tema"),
      env.DB.prepare(upsertSql).bind("scala_font", scalaFont, "tema")
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
   APPROVAZIONE DELIBERA SOCIO
   ========================================================================= */

async function handleApprovaSocioPost(request, env) {
  try {
    const form = await request.formData();
    const socioId = form.get("socio_id");
    const numVerbale = form.get("numero_verbale")?.trim();
    const dataDelibera = form.get("data_delibera") || new Date().toISOString().split("T")[0];
    const numTessera = form.get("numero_tessera")?.trim();
    const quotaVersata = parseFloat(form.get("quota_versata") || "10.00");

    if (!socioId || !numVerbale || !numTessera) {
      return new Response("Dati obbligatori mancanti per la delibera.", { status: 400 });
    }

    await env.DB.prepare(`
      UPDATE soci
      SET stato_ammissione = 'approvata',
          numero_verbale_ammissione = ?,
          data_delibera_ammissione = ?,
          numero_tessera_aps = ?,
          quota_versata = ?,
          aggiornato_il = datetime('now')
      WHERE id = ?
    `).bind(numVerbale, dataDelibera, numTessera, quotaVersata, socioId).run();

    return new Response(null, {
      status: 302,
      headers: { Location: "/admin?view=domande&msg=approvazione_ok" }
    });
  } catch (err) {
    console.error("Errore delibera socio:", err);
    return new Response("Errore delibera socio: " + err.message, { status: 500 });
  }
}

/* =========================================================================
   RENDERING APPLICAZIONE AMMINISTRATIVA (SHELL CON SIDEBAR E VISTE MODULARI)
   ========================================================================= */

async function renderAdminApp(env, user, url) {
  const view = url.searchParams.get("view") || "dashboard";
  const msg = url.searchParams.get("msg");
  const err = url.searchParams.get("err");

  const settings = await getImpostazioniGestionale(env);

  let mainContentHtml = "";
  let pageTitle = "Dashboard Generale";

  if (view === "dashboard") {
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
      console.error("Errore statistiche:", e);
    }

    pageTitle = "Dashboard Generale";
    mainContentHtml = `
      <div class="view-header">
        <div>
          <h1 class="view-title">Dashboard Generale</h1>
          <p class="view-subtitle">Panoramica delle attività istituzionali, iscrizioni e spettacoli teatrali.</p>
        </div>
      </div>

      <!-- Statistiche Generali -->
      <div class="dashboard-stats-grid">
        <div class="stat-card">
          <div class="stat-number" style="color: ${settings.colore_primario};">${countDomande}</div>
          <div class="stat-label">Domande in Attesa di Delibera CD</div>
          <a href="/admin?view=domande" class="stat-link">Vai alle domande &rarr;</a>
        </div>

        <div class="stat-card">
          <div class="stat-number" style="color: #10B981;">${countSociAttivi}</div>
          <div class="stat-label">Soci Ufficiali Attivi (Libro Soci)</div>
          <a href="/admin?view=libro-soci" class="stat-link">Consulta Libro Soci &rarr;</a>
        </div>

        <div class="stat-card">
          <div class="stat-number" style="color: #60A5FA;">${countCorsi}</div>
          <div class="stat-label">Corsi & Laboratori Teatrali Attivi</div>
          <a href="/admin?view=corsi" class="stat-link">Gestisci laboratori &rarr;</a>
        </div>
      </div>

      <!-- Scorciatoie Veloci alle Macro-Aree -->
      <h2 style="font-size: 18px; margin: 32px 0 16px 0; color: #FFF;">Accesso Rapido alle Macro-Aree</h2>
      <div class="quick-links-grid">
        <a href="/admin?view=domande" class="quick-card">
          <span class="quick-badge" style="background: rgba(217, 130, 149, 0.2); color: #D98295;">Area 1</span>
          <h3>Vita Associativa & Soci</h3>
          <p>Domande ammissione, Libro Soci, archivio minori/tutori, tesseramento UILT e quote.</p>
        </a>

        <a href="/admin?view=corsi" class="quick-card">
          <span class="quick-badge" style="background: rgba(96, 165, 250, 0.2); color: #60A5FA;">Area 2</span>
          <h3>Attività Didattiche & Corsi</h3>
          <p>Corsi ragazzi e adulti, registri presenze, deleghe di ritiro e liberatorie privacy.</p>
        </a>

        <a href="/admin?view=spettacoli" class="quick-card">
          <span class="quick-badge" style="background: rgba(245, 158, 11, 0.2); color: #F59E0B;">Area 3</span>
          <h3>Eventi, Spettacoli & Casse</h3>
          <p>Cartellone repliche, piantine sale a file pari/dispari, prenotazioni e cassa teatrale.</p>
        </a>

        <a href="/admin?view=theme-builder" class="quick-card">
          <span class="quick-badge" style="background: rgba(167, 139, 250, 0.2); color: #A78BFA;">Area 4</span>
          <h3>Builder & Personalizzazione</h3>
          <p>Builder Tema (colori, logo, font), Form Builder modulare e template email Resend.</p>
        </a>

        <a href="/admin?view=utenti-ruoli" class="quick-card">
          <span class="quick-badge" style="background: rgba(52, 211, 153, 0.2); color: #34D399;">Area 5</span>
          <h3>Sistema & Sicurezza</h3>
          <p>Ruoli operatori RBAC, audit log operazioni, privacy e stato database Cloudflare D1.</p>
        </a>
      </div>
    `;
  } else if (view === "domande") {
    pageTitle = "1.1 Domande di Ammissione";
    let listaDomande = [];
    try {
      const { results } = await env.DB.prepare(`
        SELECT s.id, s.nome, s.cognome, s.codice_fiscale, s.tipologia as tipo_socio, s.quota_dovuta, s.creato_il as created_at, s.stato_ammissione,
               s.tutore_id, t.nome as tutore_nome, t.cognome as tutore_cognome, t.email as tutore_email, t.telefono as tutore_telefono
        FROM soci s
        LEFT JOIN tutori t ON s.tutore_id = t.id
        WHERE s.stato_ammissione = 'in_attesa'
        ORDER BY s.creato_il DESC
        LIMIT 50;
      `).all();
      listaDomande = results || [];
    } catch (e) {
      console.error("Errore lettura domande soci:", e);
    }
    mainContentHtml = renderDomandeView(listaDomande, settings);
  } else if (view === "theme-builder") {
    pageTitle = "4.3 Builder Tema & Brand Ufficiale";
    const messaggi = {};
    if (msg === "tema_salvato") messaggi.success = "Impostazioni tema, brand e colori salvate con successo nel database!";
    if (err) messaggi.error = "Errore durante il salvataggio: " + decodeURIComponent(err);
    mainContentHtml = renderThemeBuilderView(settings, messaggi);
  } else {
    pageTitle = "Sezione Gestionale";
    mainContentHtml = renderPlaceholder(view, settings);
  }

  const sidebarHtml = renderSidebar(view, settings);

  const fullHtml = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pageTitle} • ${settings.nome_associazione}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --color-primary: ${settings.colore_primario || '#D98295'};
      --color-secondary: ${settings.colore_secondario || '#E8E7E9'};
      --color-sidebar: ${settings.colore_sidebar || '#121214'};
      --color-accent: ${settings.colore_accento || '#E63946'};
      --font-base-size: ${settings.scala_font || '16px'};
      --color-dark: #121214;
      --color-surface: #18181B;
      --color-surface-hover: #202024;
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
      font-size: var(--font-base-size);
      background-color: var(--color-dark);
      color: var(--color-text);
      min-height: 100vh;
      display: flex;
    }

    .app-layout {
      display: flex;
      width: 100%;
      min-height: 100vh;
    }

    .sidebar {
      width: 280px;
      background-color: var(--color-sidebar);
      border-right: 1px solid var(--color-border);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      height: 100vh;
      position: sticky;
      top: 0;
      overflow-y: auto;
    }

    .sidebar-header {
      padding: 24px 20px;
      display: flex;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid var(--color-border);
    }
    .sidebar-logo {
      width: 44px;
      height: 44px;
      border-radius: 8px;
      object-fit: contain;
      background: rgba(255, 255, 255, 0.05);
      padding: 4px;
    }
    .sidebar-brand-name {
      display: block;
      font-size: 15px;
      font-weight: 700;
      color: #FFF;
      line-height: 1.2;
    }
    .sidebar-badge-role {
      display: inline-block;
      margin-top: 4px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: var(--color-primary);
      background: rgba(217, 130, 149, 0.12);
      padding: 2px 6px;
      border-radius: 4px;
    }

    .sidebar-nav {
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .sidebar-divider-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--color-muted);
      padding: 16px 12px 6px 12px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      color: var(--color-muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: all 0.2s;
    }
    .nav-item:hover, .nav-item.active {
      color: #FFF;
      background: rgba(255, 255, 255, 0.06);
    }
    .nav-item.active {
      color: var(--color-primary);
      font-weight: 600;
      background: rgba(217, 130, 149, 0.1);
    }

    .nav-group-header {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 14px;
      border-radius: 8px;
      background: transparent;
      border: none;
      color: var(--color-muted);
      font-family: inherit;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
      transition: all 0.2s;
    }
    .nav-group-header:hover {
      color: #FFF;
      background: rgba(255, 255, 255, 0.04);
    }
    .nav-group.has-active > .nav-group-header {
      color: #FFF;
    }
    .nav-label { flex: 1; }
    .nav-chevron {
      transition: transform 0.25s ease;
      color: var(--color-muted);
    }
    .nav-group.open .nav-chevron {
      transform: rotate(180deg);
    }

    .nav-subitems {
      display: none;
      flex-direction: column;
      gap: 2px;
      padding: 4px 0 6px 38px;
    }
    .nav-group.open .nav-subitems {
      display: flex;
    }

    .nav-subitem {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 6px;
      color: var(--color-muted);
      text-decoration: none;
      font-size: 13px;
      transition: all 0.2s;
    }
    .nav-subitem:hover {
      color: #FFF;
      background: rgba(255, 255, 255, 0.04);
    }
    .nav-subitem.active {
      color: var(--color-primary);
      font-weight: 600;
      background: rgba(217, 130, 149, 0.1);
    }
    .subitem-bullet {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.6;
    }

    .main-wrapper {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow-y: auto;
    }

    .topbar {
      height: 70px;
      padding: 0 32px;
      border-bottom: 1px solid var(--color-border);
      background: rgba(18, 18, 20, 0.85);
      backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 50;
    }
    .topbar-user-wrap {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .user-info-text { text-align: right; }
    .user-email-label { font-size: 13px; color: #FFF; font-weight: 600; }
    .user-badge-role { font-size: 11px; color: var(--color-primary); text-transform: uppercase; font-weight: 700; }
    .btn-logout {
      padding: 7px 14px;
      border-radius: 6px;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: #EF4444;
      text-decoration: none;
      font-size: 13px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .btn-logout:hover { background: rgba(239, 68, 68, 0.2); }

    .content-body { padding: 32px; flex: 1; }

    .view-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 20px;
      margin-bottom: 28px;
    }
    .view-title { font-size: 24px; font-weight: 800; color: #FFF; margin-bottom: 6px; }
    .view-subtitle { font-size: 14px; color: var(--color-muted); line-height: 1.5; }
    .view-header-stats .stat-pill {
      background: rgba(217, 130, 149, 0.15);
      color: var(--color-primary);
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 700;
      border: 1px solid rgba(217, 130, 149, 0.3);
    }

    .dashboard-stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 20px;
      margin-bottom: 32px;
    }
    .stat-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .stat-number { font-size: 38px; font-weight: 800; line-height: 1; }
    .stat-label { font-size: 13px; color: var(--color-muted); font-weight: 500; }
    .stat-link {
      margin-top: 8px;
      font-size: 13px;
      color: #FFF;
      text-decoration: none;
      font-weight: 600;
      transition: color 0.2s;
    }
    .stat-link:hover { color: var(--color-primary); }

    .quick-links-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
    }
    .quick-card {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 20px;
      text-decoration: none;
      color: inherit;
      transition: all 0.2s;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .quick-card:hover {
      border-color: rgba(255, 255, 255, 0.2);
      transform: translateY(-2px);
    }
    .quick-badge {
      align-self: flex-start;
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .quick-card h3 { font-size: 16px; color: #FFF; font-weight: 700; }
    .quick-card p { font-size: 13px; color: var(--color-muted); line-height: 1.4; }

    .card-table-wrap {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      overflow: hidden;
    }
    .data-table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    .data-table th {
      background: #141416; padding: 14px 16px; color: var(--color-muted);
      font-weight: 600; border-bottom: 1px solid var(--color-border);
    }
    .data-table td {
      padding: 14px 16px; border-bottom: 1px solid var(--color-border);
      color: var(--color-text); vertical-align: middle;
    }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table tr:hover td { background: var(--color-surface-hover); }
    .empty-table-state { text-align: center; padding: 48px 20px; color: var(--color-muted); font-style: italic; }
    .badge-tag { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 4px; text-transform: uppercase; }
    .badge-minore { background: rgba(96, 165, 250, 0.15); color: #60A5FA; }
    .badge-ordinario { background: rgba(52, 211, 153, 0.15); color: #34D399; }
    .btn-action-primary {
      padding: 6px 12px; background: var(--color-primary); color: #121214;
      border: none; border-radius: 6px; font-size: 12px; font-weight: 700;
      cursor: pointer; transition: opacity 0.2s;
    }
    .btn-action-primary:hover { opacity: 0.9; }

    .modal-backdrop {
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 20px;
    }
    .modal-card {
      background: #1A1A1E; border: 1px solid var(--color-border);
      border-radius: 14px; width: 100%; max-width: 520px; padding: 28px;
    }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .modal-title { font-size: 18px; font-weight: 800; color: #FFF; }
    .btn-close-modal { background: none; border: none; color: var(--color-muted); font-size: 24px; cursor: pointer; }
    .modal-info-text { font-size: 13px; color: var(--color-muted); margin-bottom: 20px; line-height: 1.5; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
    .form-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px; }
    .form-field label { font-size: 12px; font-weight: 600; color: #E4E4E7; }
    .form-field input, .form-field select {
      background: #121214; border: 1px solid var(--color-border); border-radius: 6px;
      padding: 10px 12px; color: #FFF; font-size: 14px; font-family: inherit;
    }
    .modal-footer-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 24px; }
    .btn-secondary {
      background: transparent; border: 1px solid var(--color-border); color: #FFF;
      padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer;
    }
    .btn-primary {
      background: var(--color-primary); border: none; color: #121214;
      padding: 8px 18px; border-radius: 6px; font-weight: 700; cursor: pointer;
    }

    .theme-builder-layout { display: grid; grid-template-columns: 1fr 340px; gap: 28px; align-items: start; }
    .card-box { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 24px; margin-bottom: 20px; }
    .card-box-title { font-size: 16px; font-weight: 700; color: #FFF; margin-bottom: 18px; display: flex; align-items: center; gap: 8px; }
    .color-picker-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .color-input-wrap { display: flex; align-items: center; gap: 8px; background: #121214; border: 1px solid var(--color-border); border-radius: 6px; padding: 4px 8px; }
    .color-input-wrap input[type="color"] { border: none; width: 32px; height: 32px; border-radius: 4px; background: transparent; cursor: pointer; }
    .color-text-val { background: transparent; border: none; color: #FFF; font-family: monospace; font-size: 13px; width: 100%; }
    .btn-save-theme {
      background: var(--color-accent); color: #FFF; border: none; border-radius: 8px;
      padding: 14px 24px; font-size: 15px; font-weight: 700; cursor: pointer; width: 100%; transition: opacity 0.2s;
    }
    .btn-save-theme:hover { opacity: 0.9; }
    .preview-sticky-card { position: sticky; top: 94px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 12px; padding: 24px; }
    .preview-box-demo { border: 1px solid var(--color-border); border-radius: 10px; padding: 20px; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 10px; margin: 16px 0; }
    .preview-logo-img { max-width: 70px; height: auto; }
    .preview-role-pill { font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 4px; }
    .sample-btn { border: none; color: #FFF; padding: 8px 16px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: default; }
    .alert-banner { padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 600; }
    .alert-success { background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #10B981; }
    .alert-danger { background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #EF4444; }

    .placeholder-container { display: flex; justify-content: center; padding: 20px 0; }
    .placeholder-card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 14px; padding: 40px; max-width: 680px; width: 100%; text-align: center; }
    .placeholder-badge-wrap { display: flex; justify-content: center; gap: 8px; margin-bottom: 16px; }
    .placeholder-tag { font-size: 11px; font-weight: 700; color: var(--color-primary); background: rgba(217, 130, 149, 0.15); padding: 4px 10px; border-radius: 4px; }
    .placeholder-status-badge { font-size: 11px; font-weight: 700; color: #F59E0B; background: rgba(245, 158, 11, 0.15); padding: 4px 10px; border-radius: 4px; }
    .placeholder-title { font-size: 22px; font-weight: 800; color: #FFF; margin-bottom: 12px; }
    .placeholder-desc { font-size: 14px; color: var(--color-muted); line-height: 1.6; margin-bottom: 24px; text-align: left; }
    .placeholder-box-note {
      background: #141416; border: 1px solid var(--color-border); border-radius: 8px; padding: 14px 16px;
      display: flex; gap: 12px; text-align: left; margin-bottom: 28px; font-size: 13px; color: var(--color-muted);
    }
    .box-note-icon { color: var(--color-primary); flex-shrink: 0; }
    .btn-secondary-link {
      display: inline-block; padding: 10px 20px; border-radius: 6px; background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--color-border); color: #FFF; text-decoration: none; font-size: 13px; font-weight: 600;
    }

    @media (max-width: 900px) {
      .sidebar { display: none; }
      .theme-builder-layout { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app-layout">
    ${sidebarHtml}

    <main class="main-wrapper">
      <header class="topbar">
        <div>
          <span style="font-size: 12px; color: var(--color-muted); font-weight: 600; text-transform: uppercase;">Area Riservata Direttivo</span>
        </div>
        <div class="topbar-user-wrap">
          <div class="user-info-text">
            <div class="user-email-label">${user.email}</div>
            <div class="user-badge-role">Super Admin</div>
          </div>
          <a href="/admin/logout" class="btn-logout">Esci</a>
        </div>
      </header>

      <section class="content-body">
        ${mainContentHtml}
      </section>
    </main>
  </div>

  <script>
    function apriModalDelibera(socioId, nome, cognome) {
      const modal = document.getElementById('modalDelibera');
      if (!modal) return;
      document.getElementById('modalSocioId').value = socioId;
      document.getElementById('modalSocioNome').innerText = nome + ' ' + cognome;
      const today = new Date().toISOString().split('T')[0];
      const dateInput = document.getElementById('data_delibera');
      if (dateInput) dateInput.value = today;
      modal.style.display = 'flex';
    }

    function chiudiModalDelibera() {
      const modal = document.getElementById('modalDelibera');
      if (modal) modal.style.display = 'none';
    }
  </script>
</body>
</html>`;

  return new Response(fullHtml, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

/* =========================================================================
   AUTENTICAZIONE, SESSIONI E SICUREZZA WEB CRYPTO
   ========================================================================= */

async function hashPassword(password, salt = PBKDF2_SALT) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]
  );
  const derivedKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
  const exported = await crypto.subtle.exportKey("raw", derivedKey);
  return Array.from(new Uint8Array(exported)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPasswordMatch(password, storedHash) {
  if (!storedHash || !password) return false;
  const h1 = await hashPassword(password, PBKDF2_SALT);
  if (h1 === storedHash) return true;

  try {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: enc.encode(PBKDF2_SALT), iterations: 100000, hash: "SHA-256" }, km, 256);
    const h2 = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (h2 === storedHash) return true;
  } catch (e) {}

  const h4 = await hashPassword(password, LEGACY_SALT_UILT);
  if (h4 === storedHash) return true;

  try {
    const enc = new TextEncoder();
    const data = enc.encode(password + ":cervelli-aps-gestionale-2026");
    const buf = await crypto.subtle.digest("SHA-256", data);
    const h5 = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (h5 === storedHash) return true;
  } catch (e) {}

  return false;
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach(cookie => {
    let [name, ...rest] = cookie.split("=");
    name = name?.trim();
    if (!name) return;
    const value = rest.join("=").trim();
    list[name] = decodeURIComponent(value);
  });
  return list;
}

function generateSecureToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getAdminSession(request, env) {
  const cookieHeader = request.headers.get("Cookie");
  const cookies = parseCookies(cookieHeader);
  const token = cookies[SESSION_COOKIE_NAME] || cookies["cervelli_admin_session"];
  if (!token) return null;

  try {
    const session = await env.DB.prepare(`
      SELECT s.token, s.scadenza, u.id as user_id, u.nome, u.cognome, u.email, u.ruolo
      FROM sessioni_admin s
      JOIN utenti_gestionale u ON s.utente_id = u.id
      WHERE s.token = ? AND s.scadenza > datetime('now') AND u.attivo = 1
      LIMIT 1
    `).bind(token).first();

    if (!session) return null;
    return {
      token: session.token,
      user: {
        id: session.user_id,
        nome: session.nome,
        cognome: session.cognome,
        email: session.email,
        ruolo: session.ruolo
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
      return renderLoginPage("Credenziali non valide.", email);
    }

    const passwordValida = await verifyPasswordMatch(password, user.password_hash);
    if (!passwordValida) {
      return renderLoginPage("Credenziali non valide.", email);
    }

    const token = generateSecureToken();

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
    return renderLoginPage("Errore durante il login: " + err.message);
  }
}

async function handleLogout(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie"));
  const token = cookies[SESSION_COOKIE_NAME] || cookies["cervelli_admin_session"];
  if (token) {
    try {
      await env.DB.prepare("DELETE FROM sessioni_admin WHERE token = ?").bind(token).run();
    } catch (e) {}
  }
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/admin",
      "Set-Cookie": `${SESSION_COOKIE_NAME}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
    }
  });
}

function renderLoginPage(errorMessage = "", emailVal = "") {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Accedi al Gestionale • Cervelli in Affitto APS</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background: #121214; color: #FAFAFA;
      min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px;
    }
    .login-card {
      background: #18181B; border: 1px solid #27272A; border-radius: 14px;
      padding: 36px; width: 100%; max-width: 420px; text-align: center;
    }
    .login-title { font-size: 20px; font-weight: 800; color: #FFF; margin: 12px 0 6px 0; }
    .login-subtitle { font-size: 13px; color: #A1A1AA; margin-bottom: 24px; }
    .form-group { text-align: left; margin-bottom: 16px; }
    .form-group label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: #D4D4D8; }
    .form-group input {
      width: 100%; padding: 12px; background: #121214; border: 1px solid #27272A;
      border-radius: 8px; color: #FFF; font-size: 14px; font-family: inherit;
    }
    .form-group input:focus { border-color: #D98295; outline: none; }
    .btn-submit {
      width: 100%; padding: 12px; background: #D98295; border: none; border-radius: 8px;
      color: #121214; font-size: 14px; font-weight: 700; cursor: pointer; margin-top: 8px;
    }
    .error-box {
      background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3);
      color: #EF4444; padding: 10px; border-radius: 6px; font-size: 13px; margin-bottom: 16px;
    }
  </style>
</head>
<body>
  <div class="login-card">
    <h1 class="login-title">Cervelli in Affitto APS</h1>
    <p class="login-subtitle">Accesso Riservato Operatori & Direttivo</p>
    ${errorMessage ? `<div class="error-box">${errorMessage}</div>` : ""}
    <form method="POST" action="/admin/login">
      <div class="form-group">
        <label for="email">Indirizzo Email</label>
        <input type="email" id="email" name="email" value="${emailVal}" required />
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" name="password" required />
      </div>
      <button type="submit" class="btn-submit">Accedi al Gestionale &rarr;</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderSetupPage(errorMessage = "") {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Primo Setup • Cervelli in Affitto APS</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Plus Jakarta Sans', sans-serif; background: #121214; color: #FFF; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .setup-card { background: #18181B; border: 1px solid #27272A; border-radius: 14px; padding: 36px; max-width: 440px; width: 100%; }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 12px; margin-bottom: 6px; color: #A1A1AA; }
    .form-group input { width: 100%; padding: 10px; background: #121214; border: 1px solid #27272A; border-radius: 6px; color: #FFF; }
    .btn-submit { width: 100%; padding: 12px; background: #D98295; border: none; border-radius: 6px; color: #121214; font-weight: 700; cursor: pointer; margin-top: 10px; }
  </style>
</head>
<body>
  <div class="setup-card">
    <h2 style="margin-bottom: 8px;">Configura Super Admin</h2>
    <p style="font-size: 13px; color: #A1A1AA; margin-bottom: 20px;">Crea il primo account amministratore per il gestionale.</p>
    ${errorMessage ? `<div style="color: #EF4444; margin-bottom: 12px; font-size: 13px;">${errorMessage}</div>` : ""}
    <form method="POST" action="/admin/setup">
      <div class="form-group"><label>Nome</label><input type="text" name="nome" required /></div>
      <div class="form-group"><label>Cognome</label><input type="text" name="cognome" required /></div>
      <div class="form-group"><label>Email</label><input type="email" name="email" required /></div>
      <div class="form-group"><label>Password (min. 8 caratteri)</label><input type="password" name="password" minlength="8" required /></div>
      <button type="submit" class="btn-submit">Crea Super Admin</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

/* =========================================================================
   FUNZIONI AUSILIARIE PORTALE PUBBLICO
   ========================================================================= */

async function seedDefaultCourseIfNeeded(env) {
  try {
    const c = await env.DB.prepare("SELECT id FROM attivita_eventi WHERE id = 'corso-teatro-ragazzi-2026'").first();
    if (!c) {
      await env.DB.prepare(`
        INSERT INTO attivita_eventi (id, titolo, tipologia, capienza_massima, data_inizio, attivo)
        VALUES ('corso-teatro-ragazzi-2026', 'Laboratorio Teatrale Ragazzi 2026', 'corso', 25, '2026-10-01', 1)
      `).run();
    }
  } catch (e) {}
}

async function handleIscrizionePost(request, env, ctx) {
  try {
    const form = await request.formData();
    const nomeMinore = form.get("minore_nome")?.trim();
    const cognomeMinore = form.get("minore_cognome")?.trim();
    const cfMinore = form.get("minore_cf")?.trim().toUpperCase();
    const nomeTutore = form.get("tutore_nome")?.trim();
    const cognomeTutore = form.get("tutore_cognome")?.trim();
    const emailTutore = form.get("tutore_email")?.trim().toLowerCase();
    const telTutore = form.get("tutore_telefono")?.trim();
    const corsoId = form.get("corso_id") || "corso-teatro-ragazzi-2026";

    if (!nomeMinore || !cognomeMinore || !emailTutore) {
      return new Response("Dati obbligatori mancanti.", { status: 400 });
    }

    const tutoreId = "tut-" + crypto.randomUUID().slice(0, 8);
    const socioId = "soc-" + crypto.randomUUID().slice(0, 8);

    await env.DB.prepare(`
      INSERT INTO tutori (id, nome, cognome, email, telefono, creato_il)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).bind(tutoreId, nomeTutore, cognomeTutore, emailTutore, telTutore).run();

    await env.DB.prepare(`
      INSERT INTO soci (id, nome, cognome, codice_fiscale, tipologia, stato_ammissione, tutore_id, quota_dovuta, creato_il)
      VALUES (?, ?, ?, ?, 'minore', 'in_attesa', ?, 10.00, datetime('now'))
    `).bind(socioId, nomeMinore, cognomeMinore, cfMinore, tutoreId).run();

    try {
      await env.DB.prepare(`
        INSERT INTO iscrizioni_corsi (id, socio_id, attivita_id, stato_iscrizione, data_iscrizione)
        VALUES (?, ?, ?, 'in_attesa', datetime('now'))
      `).bind("isc-" + crypto.randomUUID().slice(0, 8), socioId, corsoId).run();
    } catch (e) {}

    return new Response(null, {
      status: 302,
      headers: { Location: `/iscrizione-confermata?minore=${encodeURIComponent(nomeMinore)}&email=${encodeURIComponent(emailTutore)}` }
    });
  } catch (err) {
    return new Response("Errore durante l'iscrizione: " + err.message, { status: 500 });
  }
}

function renderPublicWizard(step, isSuccess, params, env) {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Iscrizione Corsi & Richiesta Socio • Cervelli in Affitto APS</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Plus Jakarta Sans', sans-serif; background: #121214; color: #FAFAFA; min-height: 100vh; padding: 30px 20px; }
    .form-card { max-width: 600px; margin: 0 auto; background: #18181B; border: 1px solid #27272A; border-radius: 14px; padding: 32px; }
    h1 { font-size: 20px; margin-bottom: 8px; color: #D98295; }
    p { font-size: 14px; color: #A1A1AA; margin-bottom: 20px; }
    .field { margin-bottom: 14px; }
    .field label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: #E4E4E7; }
    .field input { width: 100%; padding: 10px; background: #121214; border: 1px solid #27272A; border-radius: 6px; color: #FFF; font-size: 14px; }
    .btn-submit { width: 100%; padding: 12px; background: #D98295; border: none; border-radius: 6px; color: #121214; font-weight: 700; font-size: 15px; cursor: pointer; margin-top: 14px; }
  </style>
</head>
<body>
  <div class="form-card">
    <h1>Iscrizione Laboratorio Teatrale Ragazzi</h1>
    <p>Compila la richiesta di iscrizione per il minore e la domanda di ammissione a socio APS.</p>
    <form method="POST" action="/iscrizione-minori">
      <div class="field"><label>Nome del Minore *</label><input type="text" name="minore_nome" required /></div>
      <div class="field"><label>Cognome del Minore *</label><input type="text" name="minore_cognome" required /></div>
      <div class="field"><label>Codice Fiscale Minore</label><input type="text" name="minore_cf" placeholder="Es. RSSMRA12A01H501Z" /></div>
      <div class="field"><label>Nome del Genitore/Tutore *</label><input type="text" name="tutore_nome" required /></div>
      <div class="field"><label>Cognome del Genitore/Tutore *</label><input type="text" name="tutore_cognome" required /></div>
      <div class="field"><label>Email Genitore/Tutore *</label><input type="email" name="tutore_email" required /></div>
      <div class="field"><label>Telefono Genitore/Tutore *</label><input type="tel" name="tutore_telefono" required /></div>
      <button type="submit" class="btn-submit">Invia Richiesta di Iscrizione &rarr;</button>
    </form>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function renderSuccessPage(nomeMinore, email) {
  const html = `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Iscrizione Inviata • Cervelli in Affitto APS</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    body { font-family: 'Plus Jakarta Sans', sans-serif; background: #121214; color: #FAFAFA; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #18181B; border: 1px solid #27272A; border-radius: 14px; padding: 40px; max-width: 500px; text-align: center; }
    h1 { color: #10B981; font-size: 22px; margin-bottom: 12px; }
    p { color: #A1A1AA; font-size: 14px; line-height: 1.5; margin-bottom: 24px; }
    a { display: inline-block; padding: 10px 20px; background: #D98295; color: #121214; font-weight: 700; text-decoration: none; border-radius: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Richiesta Inviata con Successo!</h1>
    <p>La richiesta di ammissione a socio e iscrizione al laboratorio per <strong>${nomeMinore}</strong> è stata ricevuta. Riceverai conferma all'indirizzo <strong>${email}</strong> appena il Consiglio Direttivo avrà deliberato.</p>
    <a href="/">Torna alla Pagina Iniziale</a>
  </div>
</body>
</html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
