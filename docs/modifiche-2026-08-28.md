# Modifiche del 2026-08-28

Panoramica in breve di tutte le modifiche effettuate.

---

## 1. Nuovo export Excel del Report Sprint dinamico

- Pulsante **"Anteprima & Esporta"** nella pagina Report Sprint → apre un dialog
  con l'**anteprima a schede** dei fogli, poi il pulsante "Scarica .xlsx".
- Alla generazione **richiama le API di Azure** per avere dati freschi (non usa la
  cache di React Query).
- Il workbook è generato con `exceljs`, caricato in un lazy-chunk separato (~930 KB)
  solo al momento dell'export.
- Link interni tra fogli tramite formula `HYPERLINK("#...")` (evita il prompt di
  "ripristino" di Excel).

**File nuovi:**
- `client/src/utils/excelReport.ts`
- `client/src/components/ExcelReportPreview.tsx`

---

## 2. Contenuto del workbook (7 fogli)

| Foglio | Contenuto |
|---|---|
| **Riepilogo** | Indice con link, KPI esecuzione test, KPI bug, pannello DSI, bug per stato / severità / origine, mini-tabella piani + 4 grafici |
| **Bug Sprint** | ID, Titolo, Stato, Severità, Priorità, Assegnato a, Creato da, Link |
| **Bug per Suite** | Piano → Suite → bug con assegnatario / creatore / stato |
| **Bug DSI** | Pannello sintetico + elenco completo + grafico per stato |
| **Suite** | Passati/Falliti/Bloccati/N-A/Non eseguiti, % eseguito, % pass (scale colore), bug aperti |
| **Piani di Test** | Riepilogo per piano con link ad Azure |
| **Per Assegnatario** | Bug per persona con barre dati |

- Colonne ad **auto-larghezza** in base al contenuto.
- Percentuali con **semaforo** verde / giallo / rosso + scale colore condizionali.
- **Barre dati** sulle colonne di conteggio.
- **Grafici come immagini PNG** disegnate al volo (exceljs non genera grafici nativi).

> Nota: era stata prodotta una versione "super-semplificata" a 4 fogli, poi
> **annullata** su richiesta e ripristinata la versione dettagliata.

---

## 3. Anteprima nel sito

- Dialog con `TabList` (una scheda per foglio) + tabelle HTML che replicano il
  contenuto del file con gli stessi colori e i link cliccabili.
- Liste lunghe: in anteprima max 100 righe con nota "+ N righe nel file completo";
  il file scaricato le contiene tutte più i grafici.

---

## 4. Descrizione dei bug

- **Server:** aggiunti `System.Description` e `Microsoft.VSTS.TCM.ReproSteps` ai
  campi letti per i bug; nuovo helper `htmlToPlainText` (rimuove l'HTML mantenendo
  gli a-capo, decodifica le entità, taglia a 600 caratteri).
- Nuovo campo `description?` su `BugInfo` / `DefectRecord` / `DefectSummary`
  (server e client).
- L'elenco **Bug DSI** ora ha le colonne:
  `ID · Titolo · Descrizione · Stato · Assegnatario · Creato da · Link`.

---

## 5. Fix elenco Bug DSI vuoto

- **Causa:** l'elenco cercava una suite chiamata "Test DSI" nell'albero dei piani
  di test selezionati, ma un bug è "DSI" in base al proprio campo **`Custom.Suite`**,
  non alla struttura dei piani.
- **Fix:** il server espone `SprintDefectReport.dsiDefects` = tutti i bug con
  origine DSI (`Custom.Suite = "Test DSI"`); l'Excel legge direttamente quella lista.

---

## 6. Tile "Bug aperti da Test Business"

- Nuova KPI tile nella **Scheda Stato Sprint** — stesso formato di "Bug aperti da
  DSI" (numero grande + etichetta), **sempre visibile anche quando è 0**.
- Presente su: scheda a schermo, email (Copia per Email/Teams e invio), legenda KPI
  del PDF, e riga "Bug rilevati da Test Business" nel foglio Riepilogo dell'Excel.
- **Discriminante:** `Custom.Suite = "Test Business"` (origine "Business"), già
  disponibile in `byOriginDetected["Business"]` — nessuna modifica server necessaria
  per la tile.

---

## 7. Testo rimosso

- Tolto "**· solo bug effettivi**" dal sottotitolo "(rilevati da …)" della Scheda
  Stato Sprint (chiave `bugStatusSubtitle`, it + en).

---

## Come si riconosce l'origine di un bug (DSI / Test Business / Test Factory)

La discriminante è **il campo `Custom.Suite` del bug**, compilato a mano in Azure DevOps:

| `Custom.Suite` | Origine nel report |
|---|---|
| `Test DSI` | **DSI** |
| `Test Business` | **Business** |
| `Test Agenti` | Test Agenti |
| qualsiasi altro / vuoto | Test Factory |

Non contano: chi ha creato il bug, l'assegnatario, l'area path, la suite del test
case collegato, i tag. Il report è filtrato per sprint/area, quindi nel report
dello Sprint corrente questi conteggi riguardano solo i bug di quello sprint.

---

## File modificati

| Area | File |
|---|---|
| Server | `src/azdo.ts`, `src/dashboardData.ts`, `src/defectData.ts`, `src/types.ts` |
| Client | `client/src/utils/excelReport.ts` *(nuovo)*, `client/src/components/ExcelReportPreview.tsx` *(nuovo)*, `client/src/pages/DynamicSprintReportPage.tsx`, `client/src/components/StatusReportCard.tsx`, `client/src/utils/export.ts`, `client/src/types.ts`, `client/src/i18n/locales/it.json`, `client/src/i18n/locales/en.json` |

Verificato: typecheck server + client, `eslint .`, `vite build` — tutto pulito.

---

## ⚠️ Per rendere effettive le modifiche server

I dati dei difetti sono in **cache lato server**. Per vedere descrizioni bug,
elenco DSI popolato e conteggi Test Business:

1. Riavviare / ridistribuire il server con il codice nuovo.
2. Premere **"Aggiorna Ora"** nella dashboard per invalidare la cache.
