# Guida Windows Da Zero (Italiano)

Questa guida e pensata per chi ha un nuovo PC Windows e nessuna esperienza tecnica.

Obiettivo: clonare il progetto, configurarlo e avviarlo in locale.

Se preferisci fare tutto in modo automatico con AI, puoi usare anche la skill in italiano:
- `.claude/skills/setup-windows-it/SKILL.md`

## 1) Cosa devi installare prima

1. Installa Node.js LTS da https://nodejs.org
2. Installa Git for Windows da https://git-scm.com/download/win

### Opzionale: installare VS Code (consigliato)

Se vuoi usare la skill automatica o lavorare in modo piu comodo, installa anche VS Code:

1. Vai su https://code.visualstudio.com
2. Clicca Download for Windows
3. Avvia l'installer e lascia le opzioni predefinite
4. Durante l'installazione, abilita queste voci se presenti:
   - Add to PATH
   - Add "Open with Code" nel menu contestuale
5. Apri VS Code e fai Sign in (opzionale ma utile per Copilot)
6. Installa l'estensione "GitHub Copilot" da Extensions

Se non installi VS Code, puoi comunque seguire tutta questa guida manuale con PowerShell.

Apri PowerShell e verifica:

```powershell
node --version
npm --version
git --version
```

Requisiti minimi:
- Node.js: `v22.22.0` o superiore
- npm: qualsiasi versione recente inclusa con Node
- Git: installato e funzionante

Nota importante su Node.js:
- Se non trovi subito la versione esatta `22.22.0` sul sito, installa la LTS piu recente della major 22 (o successiva).
- Dopo l'installazione, conta il risultato di `node --version`: se e uguale o superiore a `v22.22.0`, va bene.
- Se vedi ancora una versione vecchia, chiudi e riapri PowerShell (o riavvia il PC) e riprova il controllo.

## 2) Clona il repository

Scegli una cartella dove salvare il progetto, poi in PowerShell:

```powershell
git clone <URL_DEL_REPOSITORY>
Set-Location <NOME_CARTELLA_REPOSITORY>
```

Esempio: se la cartella si chiama `azure-dashboard-fg`, entra con:

```powershell
Set-Location azure-dashboard-fg
```

## 3) Installa le dipendenze

Dalla root del progetto:

```powershell
npm install
npm install --prefix client
```

Attendi il completamento (puo richiedere alcuni minuti).

## 4) Crea i file di configurazione

Servono due file:
- `.env` nella root
- `client/.env` nella cartella client

### 4.1 Root `.env`

1. Copia `.env.example` in `.env`
2. Apri `.env` e compila almeno:
   - `AZDO_PAT`
   - `AZDO_ORG`
   - `AZDO_PROJECT`
3. Lascia `SKIP_AUTH=true` per test locale senza login Microsoft

### 4.2 Frontend `client/.env`

1. Copia `client/.env.example` in `client/.env`
2. Lascia `VITE_SKIP_AUTH=true` per test locale senza login Microsoft

Importante: non condividere mai token, password o contenuto del tuo `.env`.

## 5) Controlla che i flag combacino

I valori server/client devono essere coerenti:

- `SKIP_AUTH` = `VITE_SKIP_AUTH`
- `ENABLE_EMAIL_REPORT` = `VITE_ENABLE_EMAIL_REPORT`
- `ENABLE_RELEASE_READINESS` = `VITE_ENABLE_RELEASE_READINESS`
- `SHOW_ONLY_DEFECT_AND_RELEASE` = `VITE_SHOW_ONLY_DEFECT_AND_RELEASE`

## 6) Avvia il progetto

Dalla root del progetto:

```powershell
npm run dev:all
```

Poi apri il browser su:

`http://localhost:3000`

Per fermare tutto: `Ctrl + C` nel terminale.

Se qualcosa resta bloccato sulle porte:

```powershell
npm run kill:dev
npm run dev:all
```

## 7) Verifica build client

Per controllare che la build del frontend sia pronta:

```powershell
npm run build --prefix client
```

Se il comando termina senza errori, la build e ok.

Nota: in questo repository il deploy GitHub Pages non e applicabile.

## 8) Problemi comuni

1. `npm is not recognized`
   - Node.js non installato correttamente. Reinstalla Node e riapri PowerShell.
2. Errori Azure DevOps
   - Controlla `AZDO_PAT`, `AZDO_ORG`, `AZDO_PROJECT` nel `.env`.
3. Porta occupata o app non raggiungibile
   - Esegui `npm run kill:dev` e riavvia con `npm run dev:all`.
4. Pagina vuota o errore di autenticazione in locale
   - Verifica che `SKIP_AUTH=true` e `VITE_SKIP_AUTH=true`.

## 9) Opzione automatica con AI (in italiano)

Se non vuoi seguire manualmente tutti i passaggi, usa la skill:

- `.claude/skills/setup-windows-it/SKILL.md`

La skill guida e verifica automaticamente prerequisiti, setup e build.

### Come richiamarla in Copilot Chat

Apri Copilot Chat dentro VS Code e scrivi un prompt semplice, ad esempio:

```text
Usa la skill setup-windows-it per configurare questo repository da zero su Windows.
```

Oppure:

```text
Esegui la procedura setup-windows-it: verifica prerequisiti, installa dipendenze, configura .env e avvia il progetto.
```

### Come richiamarla in Claude

Se usi Claude con questa repository aperta, puoi chiedere in modo diretto:

```text
Usa la skill setup-windows-it e guidami passo-passo sul mio PC Windows.
```

Suggerimento: specifica sempre che vuoi output in italiano e che parti da zero.

### Se non hai VS Code

Nessun problema: puoi seguire questa guida manuale dall'inizio alla fine usando solo:
1. PowerShell
2. Git
3. Node.js

In questo caso la skill automatica non e disponibile come esecuzione diretta, perche e pensata per agenti AI che leggono la repository aperta in un ambiente compatibile (es. VS Code con Copilot Chat).

Alternativa pratica:
1. usa questa guida manuale;
2. se vuoi comunque aiuto AI, copia i passaggi in un assistente esterno e chiedi supporto passo-passo, eseguendo i comandi tu in PowerShell.
