# KPI test - analisi di fattibilita

Tutti i KPI richiesti sono calcolabili con i dati Azure DevOps gia disponibili. L'implementazione riusa l'endpoint esistente `/api/report-extra-kpis` e la sezione KPI aggiuntivi del Report Sprint.

| KPI | Dati usati | Nota |
| --- | --- | --- |
| First Execution Pass Rate - Functional Test Case | storico Test Runs/Results | N/A incluso nel denominatore |
| First Execution Pass Rate - UAT Test Case | storico Test Runs/Results | N/A incluso nel denominatore |
| First Execution Pass Rate - Functional Test Steps | Iterations/Action Results | per test case + step |
| First Execution Pass Rate - UAT Test Steps | Iterations/Action Results | per test case + step |
| Critical Defect Rate | bug Critical / test eseguiti | N/A incluso tra gli eseguiti |
| Average Bug Fix Time | apertura -> prima entrata in Da verificare | giorni lavorativi lun-ven |
| Test Plan Correctness / Executability | casi non N/A / pianificati | N/A e il flag di non eseguibilita adottato dal team |
| Bug Re-open Rate | bug riaperti / bug arrivati in verifica | ogni bug conta una volta |
| Average Closing Time | apertura -> chiusura | giorni lavorativi lun-ven |

## Assunzioni e limiti

- I piani sono distinti come Functional/UAT tramite la classificazione centralizzata in `planClassifier.ts`.
- Gli esiti non conclusivi non entrano nel denominatore dei first-pass rate; NotApplicable e invece incluso come richiesto dal documento.
- Gli step richiedono che Azure DevOps abbia registrato gli Action Results. In assenza di dettaglio il valore resta non disponibile.
- Il calendario lavorativo esclude sabato e domenica. Festivita aziendali e sospensioni non sono strutturate in Azure DevOps e richiederebbero una configurazione aggiuntiva per essere sottratte.
- La modalita di calcolo del Bug Re-open Rate riportata nel documento parla di tempo medio, ma nome, descrizione e soglia definiscono una percentuale. L'implementazione segue la definizione percentuale.
