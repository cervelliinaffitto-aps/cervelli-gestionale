export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Test rapido connessione database D1
    if (url.pathname === "/api/test-db") {
      try {
        const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        return Response.json({ status: "ok", tabelle_attive: results.map(r => r.name) });
      } catch (err) {
        return Response.json({ status: "error", message: err.message }, { status: 500 });
      }
    }

    // Risposta base di benvenuto
    return new Response(
      `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <title>Cervelli in Affitto APS - Gestionale</title>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; text-align: center; }
    .card { background: #1e293b; padding: 2rem 3rem; border-radius: 1rem; border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-bottom: 0.5rem; }
    a { color: #38bdf8; text-decoration: none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Cervelli in Affitto APS</h1>
    <p>Nuovo gestionale in fase di configurazione.</p>
    <p><a href="/api/test-db" target="_blank">Verifica stato Database D1 &rarr;</a></p>
  </div>
</body>
</html>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
};
