// src/placeholder.js - Segnaposto elegante per le sezioni in fase di sviluppo (Bibbia v2.4)

export function renderPlaceholder(viewId, settings = {}) {
  // Dizionario informativo delle sezioni basato sulla Bibbia ufficiale
  const sezioniInfo = {
    // Area 1: Vita Associativa & Soci
    'libro-soci': {
      titolo: '1.2 Libro Soci Ufficiale',
      categoria: 'Macro-Area 1: Vita Associativa & Soci',
      descrizione: 'Registro cronologico e immutabile degli associati dell\'APS. Include dati anagrafici, tipologia socio (Ordinario/Sostenitore), estremi della delibera del Consiglio Direttivo e quote versate, con esportazione ufficiale in formato Excel e PDF.'
    },
    'minori-tutori': {
      titolo: '1.3 Minori & Tutori',
      categoria: 'Macro-Area 1: Vita Associativa & Soci',
      descrizione: 'Archivio anagrafico dei soci minorenni iscritti ai laboratori e associazione bidirezionale con i rispettivi genitori/tutori legali per la gestione delle deleghe di ritiro e liberatorie.'
    },
    'tesseramento-uilt': {
      titolo: '1.4 Tesseramento UILT & Coperture Assicurative',
      categoria: 'Macro-Area 1: Vita Associativa & Soci',
      descrizione: 'Gestione dell\'affiliazione nazionale UILT per la copertura assicurativa infortuni e RC terzi. Monitoraggio della validità per anno solare (Gen-Dic) e caricamento dei PDF tessere per l\'area personale dei soci.'
    },
    'quote-rinnovi': {
      titolo: '1.5 Quote Sociali & Rinnovi Annuali',
      categoria: 'Macro-Area 1: Vita Associativa & Soci',
      descrizione: 'Stato di regolarità contributiva delle quote associative (validità 1 Nov - 31 Ott). Funzionalità di rinnovo singolo e massivo, integrazioni quote e storico annuale dei versamenti.'
    },

    // Area 2: Attività & Corsi
    'corsi': {
      titolo: '2.1 Gestione Corsi & Laboratori Teatrali',
      categoria: 'Macro-Area 2: Attività & Corsi',
      descrizione: 'Configurazione dell\'offerta didattica teatrale (bambini, ragazzi, adulti), orari, date lezioni, limiti di capienza partecipanti e importi delle quote di frequenza.'
    },
    'iscrizioni-corsi': {
      titolo: '2.2 Iscrizioni ai Corsi',
      categoria: 'Macro-Area 2: Attività & Corsi',
      descrizione: 'Elenco degli allievi iscritti ai diversi corsi, stato delle domande collegate all\'ammissione socio e gestione della lista d\'attesa al raggiungimento della capienza.'
    },
    'presenze-deleghe': {
      titolo: '2.3 Registri Presenze & Deleghe Ritiro',
      categoria: 'Macro-Area 2: Attività & Corsi',
      descrizione: 'Registro digitale delle presenze a ogni lezione per gli insegnanti ed elenco autorizzazioni con documenti di identità per il ritiro dei minori da parte di soggetti terzi delegati.'
    },
    'liberatorie': {
      titolo: '2.4 Liberatorie Privacy & Uso Immagini',
      categoria: 'Macro-Area 2: Attività & Corsi',
      descrizione: 'Archivio consensi privacy e liberatorie per riprese foto/video durante lezioni e saggi finali, con tracciamento temporale conforme al GDPR.'
    },

    // Area 3: Eventi & Casse
    'spettacoli': {
      titolo: '3.1 Cartellone Spettacoli & Repliche',
      categoria: 'Macro-Area 3: Eventi & Casse',
      descrizione: 'Gestione del cartellone delle produzioni teatrali, date di debutto e repliche, orari di apertura cassa e ingresso in sala, note di regia e schede tecniche.'
    },
    'sale-posti': {
      titolo: '3.2 Piantine Sale & Mappa Posti',
      categoria: 'Macro-Area 3: Eventi & Casse',
      descrizione: 'Configurazione grafica delle sale e teatri ospitanti: file pari/dispari, settori (platea, galleria), posti riservati a disabili/service e capienza omologata.'
    },
    'prenotazioni': {
      titolo: '3.3 Gestione Prenotazioni Spettacoli',
      categoria: 'Macro-Area 3: Eventi & Casse',
      descrizione: 'Elenco prenotazioni ricevute online, ricerca rapida persistente per cognome o telefono, modifica posti con verifica automatica della capienza e assegnazione omaggi.'
    },
    'cassa-teatro': {
      titolo: '3.4 Cassa Biglietteria Spettacoli',
      categoria: 'Macro-Area 3: Eventi & Casse',
      descrizione: 'Pannello cassa serale per spettacoli teatrali: emissione biglietti con piantina, gestione contanti, POS e Satispay, ingressi parziali e chiusura giornaliera con verbale incasso.'
    },
    'cassa-eventi': {
      titolo: '3.5 Cassa Altri Eventi (Cene con Delitto, Festival)',
      categoria: 'Macro-Area 3: Eventi & Casse',
      descrizione: 'Cassa flessibile per eventi non teatrali (cene con delitto, eventi di quartiere): gestione quote d\'iscrizione, registrazioni pagamenti cumulativi da ristoranti partner e causali personalizzabili.'
    },

    // Area 4: Builder & Contenuti
    'form-builder': {
      titolo: '4.1 Form Builder & Moduli Pubblici',
      categoria: 'Macro-Area 4: Builder & Contenuti',
      descrizione: 'Creazione e personalizzazione senza codice dei moduli pubblici: campi obbligatori o facoltativi, etichette personalizzate, salvataggio copie e associazione a singoli eventi.'
    },
    'email-templates': {
      titolo: '4.2 Template Email di Notifica',
      categoria: 'Macro-Area 4: Builder & Contenuti',
      descrizione: 'Modifica dei messaggi di conferma inviati ai soci e al pubblico via Resend: mittente personalizzabile, anteprima grafica e footer istituzionale automatico con dati legali.'
    },
    'metodi-pagamento': {
      titolo: '4.4 Configurazione Metodi di Pagamento',
      categoria: 'Macro-Area 4: Builder & Contenuti',
      descrizione: 'Attivazione e parametri per i metodi di pagamento ammessi: Bonifico Bancario con IBAN, Contanti alla prima lezione/cassa, Satispay e POS fisico.'
    },

    // Area 5: Sistema & Utenti
    'utenti-ruoli': {
      titolo: '5.1 Utenti & Permessi RBAC',
      categoria: 'Macro-Area 5: Sistema & Utenti',
      descrizione: 'Creazione degli account operatori del gestionale (Consiglio Direttivo, Insegnanti, Operatori Cassa, Accoglienza) con assegnazione granulare dei permessi di visualizzazione e modifica.'
    },
    'audit-log': {
      titolo: '5.2 Registro Operazioni (Audit Log)',
      categoria: 'Macro-Area 5: Sistema & Utenti',
      descrizione: 'Log cronologico delle attività svolte dagli utenti del gestionale (approvazione soci, incassi registrati, modifiche a prenotazioni o impostazioni) per massima trasparenza e sicurezza.'
    },
    'documenti-legali': {
      titolo: '5.3 Documenti Legali & Informative',
      categoria: 'Macro-Area 5: Sistema & Utenti',
      descrizione: 'Gestione e aggiornamento dei testi dello Statuto Sociale, Regolamento Interno, Informativa Privacy e Condizioni di Partecipazione mostrati nei moduli pubblici.'
    },
    'impostazioni-db': {
      titolo: '5.4 Manutenzione Database Cloudflare D1',
      categoria: 'Macro-Area 5: Sistema & Utenti',
      descrizione: 'Stato di salute delle tabelle del database D1 in giurisdizione UE, conteggio record memorizzati, backup e diagnostica di sistema.'
    }
  };

  const info = sezioniInfo[viewId] || {
    titolo: 'Sezione ' + viewId,
    categoria: 'Gestionale Cervelli in Affitto APS',
    descrizione: 'Questa sezione è compresa nell\'architettura ufficiale della Bibbia v2.4 e sarà attiva a breve.'
  };

  return `
    <div class="placeholder-container">
      <div class="placeholder-card">
        <div class="placeholder-badge-wrap">
          <span class="placeholder-tag">${info.categoria}</span>
          <span class="placeholder-status-badge">In fase di attivazione</span>
        </div>

        <h1 class="placeholder-title">${info.titolo}</h1>
        <p class="placeholder-desc">${info.descrizione}</p>

        <div class="placeholder-box-note">
          <div class="box-note-icon">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          </div>
          <div class="box-note-text">
            <strong>Modulo programmato nella Bibbia:</strong> La struttura del database e i campi sono già stati definiti. Il modulo verrà collegato in uno dei prossimi step modulari senza toccare il resto del sistema.
          </div>
        </div>

        <div class="placeholder-actions">
          <a href="/admin?view=dashboard" class="btn-secondary-link">
            &larr; Torna alla Dashboard Generale
          </a>
        </div>
      </div>
    </div>
  `;
}
