/**
 * Cervelli in Affitto APS - Gestionale Ufficiale (Bibbia v2.4)
 * Router principale modulare
 */

import { renderSidebar } from './sidebar.js';
import { renderPlaceholder } from './placeholder.js';
import { renderDomandeView } from './area1-soci/1-1-domande.js';
import { renderThemeBuilderView } from './area4-builder/4-3-theme-builder.js';
import { renderWizardIscrizione, handleIscrizionePost } from './public-forms/wizard-iscrizione.js';

const SESSION_COOKIE = "cervelli_admin_session";
const PBKDF2_SALT = "cervelli-aps-security-salt-2026";
const LEGACY_SALT = "uilt-affiliazione-nazionale-2026";

const DEFAULT_SETTINGS = {
  nome_aps: "Cervelli in Affitto APS",
  email_contatto: "info@cervelliinaffitto-aps.it",
  dominio_ufficiale: "cervelliinaffitto-aps.it",
  logo_url: "https://lh3.googleusercontent.com/d/1h-xfyBoxK5TuAsx-FamJIXf3nFh7FVoO",
  colore_primario: "#D98295",
  colore_secondario: "#E8E7E9",
  colore_sidebar: "#121214",
  colore_area1: "#1E40AF",
  colore_area2: "#15803D",
  colore_area3: "#881337",
  colore_area4: "#6B21A8",
  colore_area5: "#334155"
};

/* --- Funzioni di supporto e sicurezza --- */

async function hashPassword(password, salt = PBKDF2_SALT) {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
  const dk = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode(salt), iterations: 100000, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]
  );
  const exp = await crypto.subtle.exportKey("raw", dk);
  return Array.from(new Uint8Array(exp)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function verifyPassword(password, hash) {
  if (!hash || !password) return false;
  if ((await hashPassword(password, PBKDF2_SALT)) === hash) return true;
  if ((await hashPassword(password, LEGACY_SALT)) === hash) return true;
  try {
    const enc = new TextEncoder();
    const data = enc.encode(password + ":cervelli-aps-gestionale-2026");
    const buf = await crypto.subtle.digest("SHA-256", data);
    const h = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (h === hash) return true;
  } catch (e) {}
  return false;
}

function parseCookies(header = "") {
  const map = {};
  header.split(";").forEach(c => {
    const [k, ...v] = c.trim().split("=");
    if (k) map[k] = decodeURIComponent(v.join("="));
  });
  return map;
}

async function getSessionUser(request, env) {
  const token = parseCookies(request.headers.get("Cookie") || "")[SESSION_COOKIE];
  if (!token) return null;
  try {
    return await env.DB.prepare(`
      SELECT u.id, u.email, u.ruolo, u.nome, u.cognome
      FROM sessioni_admin s
      JOIN utenti_gestionale u ON s.utente_id = u.id
      WHERE s.token = ? AND (s.scadenza > datetime('now') OR s.scadenza IS NULL)
    `).bind(token).first();
  } catch (e) {
    return null;
  }
}

async function getSettings(env) {
  try {
    const { results } = await env.DB.prepare("SELECT chiave, valore FROM impostazioni_gestionale").all();
    const s = { ...DEFAULT_SETTINGS };
    (results || []).forEach(r => { if (r.chiave && r.valore) s[r.chiave] = r.valore; });
    return s;
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}

/* --- Layout Amministrativo (Shell) --- */

function renderAdminShell(contentHtml, view, settings, user) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${settings.nome_aps} - Gestionale</title>
  <style>
    :root {
      --primary: ${settings.colore_primario || '#D98295'};
      --bg-dark: #121214;
      --card-bg: #1a1a1e;
      --border: #27272a;
      --text: #f4f4f5;
      --muted: #a1a1aa;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: var(--bg-dark); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; min-height: 100vh; }
    .layout-wrapper { display: flex; width: 100%; min-height: 100vh; }
    .sidebar { width: 280px; background: #141417; border-right: 1px solid var(--border); display: flex; flex-direction: column; flex-shrink: 0; }
    .main-wrap { flex: 1; display: flex; flex-direction: column; overflow-y: auto; }
    .topbar { height: 60px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 2rem; background: #16161a; }
    .topbar-user { font-size: 0.9rem; color: var(--muted); }
    .topbar-user strong { color: var(--text); }
    .btn-logout { background: transparent; border: 1px solid var(--border); color: var(--muted); padding: 0.35rem 0.75rem; border-radius: 6px; text-decoration: none; font-size: 0.85rem; }
    .btn-logout:hover { color: #ef4444; border-color: #ef4444; }
    .content-area { padding: 2rem; flex: 1; }
    
    /* Tabelle, bottoni e modali */
    .data-table { width: 100%; border-collapse: collapse; background: var(--card-bg); border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
    .data-table th, .data-table td { padding: 12px 16px; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
    .data-table th { background: #202025; color: var(--muted); font-weight: 600; text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.5px; }
    .badge-tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.75rem; font-weight: 600; }
    .badge-minore { background: rgba(59, 130, 246, 0.2); color: #60a5fa; }
    .badge-ordinario { background: rgba(34, 197, 94, 0.2); color: #4ade80; }
    .btn-action-primary { background: var(--primary); color: #fff; border: none; padding: 6px 12px; border-radius: 6px; font-size: 0.85rem; font-weight: 600; cursor: pointer; }
    .btn-primary { background: var(--primary); color: #fff; border: none; padding: 8px 16px; border-radius: 6px; font-weight: 600; cursor: pointer; }
    .btn-secondary { background: transparent; border: 1px solid var(--border); color: var(--muted); padding: 8px 16px; border-radius: 6px; cursor: pointer; }
    .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.75); display: flex; align-items: center; justify-content: center; z-index: 999; }
    .modal-card { background: #1a1a1e; border: 1px solid var(--border); border-radius: 12px; padding: 2rem; max-width: 520px; width: 90%; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .modal-title { font-size: 1.25rem; font-weight: 700; color: #fff; }
    .btn-close-modal { background: none; border: none; font-size: 1.5rem; color: var(--muted); cursor: pointer; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }
    .form-field { display: flex; flex-direction: column; gap: 0.35rem; }
    .form-field label { font-size: 0.85rem; color: var(--muted); }
    .form-field input { background: #121214; border: 1px solid var(--border); color: #fff; padding: 8px 12px; border-radius: 6px; }
    .modal-footer-actions { display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.5rem; }
    .modal-info-text { font-size: 0.9rem; color: var(--muted); margin-bottom: 1rem; line-height: 1.4; }
  </style>
</head>
<body>
  <div class="layout-wrapper">
    ${renderSidebar(view, settings)}
    <div class="main-wrap">
      <header class="topbar">
        <div class="topbar-user">Autenticato come: <strong>${user.email || 'Amministratore'}</strong> (${user.ruolo || 'Super Admin'})</div>
        <a href="/admin/logout" class="btn-logout">Disconnetti</a>
      </header>
      <main class="content-area">
        ${contentHtml}
      </main>
    </div>
  </div>
</body>
</html>`;
}

function renderLoginView(error = "") {
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8"><title>Accesso Gestionale - Cervelli in Affitto APS</title>
  <style>
    body { background: #121214; color: #f4f4f5; font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #1a1a1e; border: 1px solid #27272a; padding: 2.5rem; border-radius: 12px; width: 100%; max-width: 400px; }
    h1 { font-size: 1.4rem; margin-bottom: 0.5rem; color: #D98295; }
    p { font-size: 0.9rem; color: #a1a1aa; margin-bottom: 1.5rem; }
    .err { background: rgba(239, 68, 68, 0.2); border: 1px solid #ef4444; color: #fca5a5; padding: 0.75rem; border-radius: 6px; font-size: 0.85rem; margin-bottom: 1rem; }
    label { display: block; font-size: 0.85rem; color: #a1a1aa; margin-bottom: 0.25rem; }
    input { width: 100%; box-sizing: border-box; background: #121214; border: 1px solid #27272a; color: #fff; padding: 0.75rem; border-radius: 6px; margin-bottom: 1rem; }
    button { width: 100%; background: #D98295; color: #fff; border: none; padding: 0.75rem; border-radius: 6px; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Area Riservata APS</h1>
    <p>Accedi al pannello amministrativo istituzionale.</p>
    ${error ? `<div class="err">${error}</div>` : ""}
    <form method="POST" action="/admin/login">
      <label>Email Istituzionale</label>
      <input type="email" name="email" required placeholder="tua@email.it" />
      <label>Password</label>
      <input type="password" name="password" required />
      <button type="submit">Accedi al Gestionale</button>
    </form>
  </div>
</body>
</html>`;
}

function renderDashboardView(domandeCount, settings) {
  return `
    <div style="margin-bottom: 2rem;">
      <h1 style="font-size: 1.8rem; margin-bottom: 0.5rem;">Dashboard Istituzionale</h1>
      <p style="color: #a1a1aa;">Panoramica dell'APS Cervelli in Affitto secondo la Bibbia v2.4.</p>
    </div>
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1.5rem; margin-bottom: 2.5rem;">
      <div style="background: #1a1a1e; border: 1px solid #27272a; padding: 1.5rem; border-radius: 12px; border-left: 4px solid #1E40AF;">
        <div style="font-size: 0.85rem; color: #a1a1aa; text-transform: uppercase;">Area 1 - Domande in attesa</div>
        <div style="font-size: 2.2rem; font-weight: 700; color: #60a5fa; margin: 0.5rem 0;">${domandeCount}</div>
        <a href="/admin?view=domande" style="color: #D98295; font-size: 0.85rem; text-decoration: none;">Esamina richieste &rarr;</a>
      </div>
      <div style="background: #1a1a1e; border: 1px solid #27272a; padding: 1.5rem; border-radius: 12px; border-left: 4px solid #15803D;">
        <div style="font-size: 0.85rem; color: #a1a1aa; text-transform: uppercase;">Area 2 - Attività e Corsi</div>
        <div style="font-size: 1.1rem; font-weight: 600; color: #4ade80; margin: 0.8rem 0 0.5rem;">Laboratorio Bambini 2026/27</div>
        <a href="/admin?view=corsi" style="color: #D98295; font-size: 0.85rem; text-decoration: none;">Gestione corsi &rarr;</a>
      </div>
      <div style="background: #1a1a1e; border: 1px solid #27272a; padding: 1.5rem; border-radius: 12px; border-left: 4px solid #881337;">
        <div style="font-size: 0.85rem; color: #a1a1aa; text-transform: uppercase;">Area 3 - Spettacoli & Eventi</div>
        <div style="font-size: 1.1rem; font-weight: 600; color: #fda4af; margin: 0.8rem 0 0.5rem;">Cena con Delitto & Biglietteria</div>
        <a href="/admin?view=spettacoli" style="color: #D98295; font-size: 0.85rem; text-decoration: none;">Palinsesto & Piantine &rarr;</a>
      </div>
    </div>
  `;
}

/* =========================================================================
   ENTRY POINT CLOUDFLARE WORKER
   ========================================================================= */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. Modulo Pubblico Iscrizione Corsi & Laboratori
    if (url.pathname === "/" || url.pathname === "/iscrizione-corsi") {
      if (request.method === "POST") {
        return await handleIscrizionePost(request, env);
      }
      return new Response(renderWizardIscrizione(1), {
        headers: { "Content-Type": "text/html; charset=UTF-8" }
      });
    }

    // 2. Endpoint Diagnostica DB D1
    if (url.pathname === "/api/test-db") {
      try {
        const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        return new Response(JSON.stringify({ status: "ok", tables: results }), { headers: { "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ status: "error", error: e.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }

    // 3. Autenticazione Amministrativa
    if (url.pathname === "/admin/login") {
      if (request.method === "POST") {
        const data = await request.formData();
        const email = (data.get("email") || "").trim().toLowerCase();
        const password = data.get("password") || "";
        const user = await env.DB.prepare("SELECT * FROM utenti_gestionale WHERE email = ?").bind(email).first();
        if (user && (await verifyPassword(password, user.password_hash))) {
          const token = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO sessioni_admin (token, utente_id, scadenza) VALUES (?, ?, datetime('now', '+12 hours'))"
          ).bind(token, user.id).run();
          return new Response(null, {
            status: 302,
            headers: {
              Location: "/admin",
              "Set-Cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`
            }
          });
        }
        return new Response(renderLoginView("Credenziali non valide. Riprova."), {
          headers: { "Content-Type": "text/html; charset=UTF-8" }
        });
      }
      return new Response(renderLoginView(), { headers: { "Content-Type": "text/html; charset=UTF-8" } });
    }

    if (url.pathname === "/admin/logout") {
      const token = parseCookies(request.headers.get("Cookie") || "")[SESSION_COOKIE];
      if (token) {
        await env.DB.prepare("DELETE FROM sessioni_admin WHERE token = ?").bind(token).run().catch(() => {});
      }
      return new Response(null, {
        status: 302,
        headers: {
          Location: "/admin/login",
          "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`
        }
      });
    }

    // 4. Tutte le rotte /admin richiedono sessione valida
    if (url.pathname.startsWith("/admin")) {
      const user = await getSessionUser(request, env);
      if (!user) {
        return new Response(null, { status: 302, headers: { Location: "/admin/login" } });
      }

      const settings = await getSettings(env);

      // Azione di Delibera Ammissione Socio dal Consiglio Direttivo
      if (url.pathname === "/admin/approva-socio" && request.method === "POST") {
        const data = await request.formData();
        const socioId = data.get("socio_id");
        const verbale = data.get("numero_verbale");
        const dataDelibera = data.get("data_delibera") || new Date().toISOString().split("T")[0];
        const tessera = data.get("numero_tessera");

        await env.DB.prepare(`
          UPDATE soci 
          SET stato_ammissione = 'approvata',
              delibera_verbale_n = ?,
              data_ammissione = ?,
              numero_tessera_aps = ?
          WHERE id = ?
        `).bind(verbale, dataDelibera, tessera, socioId).run().catch(async () => {
          // Fallback con colonne minime se alcune colonne differiscono
          await env.DB.prepare("UPDATE soci SET stato_ammissione = 'approvata' WHERE id = ?").bind(socioId).run();
        });

        return new Response(null, { status: 302, headers: { Location: "/admin?view=domande" } });
      }

      // Smistamento viste (Routing)
      const view = url.searchParams.get("view") || "dashboard";
      let contentHtml = "";

      if (view === "dashboard") {
        let count = 0;
        try {
          const r = await env.DB.prepare("SELECT COUNT(*) as c FROM soci WHERE stato_ammissione = 'in_attesa'").first();
          count = r ? r.c : 0;
        } catch (e) {}
        contentHtml = renderDashboardView(count, settings);
      } else if (view === "domande" || view === "1-1") {
        let domande = [];
        try {
          const { results } = await env.DB.prepare(`
            SELECT s.*, t.nome as tutore_nome, t.cognome as tutore_cognome, t.email as tutore_email, t.telefono as tutore_telefono
            FROM soci s
            LEFT JOIN tutori t ON s.tutore_id = t.id
            WHERE s.stato_ammissione = 'in_attesa'
            ORDER BY s.id DESC
          `).all();
          domande = results || [];
        } catch (e) {}
        contentHtml = renderDomandeView(domande, settings);
      } else if (view === "4-3" || view === "theme-builder" || view === "5-2") {
        contentHtml = renderThemeBuilderView(settings);
      } else {
        contentHtml = renderPlaceholder(view, settings);
      }

      return new Response(renderAdminShell(contentHtml, view, settings, user), {
        headers: { "Content-Type": "text/html; charset=UTF-8" }
      });
    }

    return new Response("Pagina non trovata", { status: 404 });
  }
};
