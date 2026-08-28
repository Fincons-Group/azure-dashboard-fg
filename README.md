# Azure DevOps Dashboard

## Run locally

```bash
npx @acahet/azure-dashboard
```

First run asks for your Azure DevOps organization and Personal Access Token
(PAT). They are stored only in your browser's local storage.

> Note: this package is hosted on GitHub Packages (private to the org).
> One-time setup per machine — add to `~/.npmrc`:
> ```
> @acahet:registry=https://npm.pkg.github.com
> //npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
> ```
> GitHub Packages requires auth even for package install/read access in a
> private org. The token needs `read:packages`.

### Architecture note

The React app does **not** call Azure DevOps directly today. It already goes
through the existing Express API first (`client/src/api/client.ts`
→ `src/server.ts`
→ `src/azdo.ts`), so the
local package reuses that backend and forwards PAT/org per request.

Versione inglese: [README.en.md](README.en.md)

Questa guida e pensata anche per chi ha **zero esperienza tecnica**.

## 1. Installa Node.js

Il progetto richiede **Node.js**.

1. Vai su [nodejs.org](https://nodejs.org)
2. Scarica la versione **LTS**
3. Avvia l'installer e conferma le opzioni predefinite

Verifica in PowerShell:

```
node --version
npm --version
```

Requisito minimo: `v22.22.0` o superiore.

Se non trovi subito la patch `22.22.0`, installa la LTS piu recente della major 22 (o successiva). Se la shell mostra ancora una versione vecchia, chiudi e riapri PowerShell.

## 2. Ottieni i file del progetto

Se hai ricevuto un `.zip`, estrailo dove preferisci.

Se usi Git:

```
git clone https://github.com/Fincons-Group/azure-dashboard-fg.git
```

## 3. Apri un terminale nella cartella progetto

1. Apri la cartella in Esplora File
2. Nella barra indirizzi digita `powershell` e premi Invio

## 4. Installa le dipendenze

Da root progetto:

```
npm install
```

Poi dentro `client`:

```
cd client
npm install
cd ..
```

## 5. Configura i file ambiente

Servono due file:
- root: `.env`
- frontend: `client/.env`

Non c'e piu un login Microsoft obbligatorio: la dashboard e visibile a chiunque la raggiunga, e i dati si caricano solo se `AZDO_PAT` e valido (altrimenti la pagina resta vuota).

### Backend

1. Copia `.env.example` in `.env`
2. Compila almeno:
   - `AZDO_PAT`
   - `AZDO_ORG`
   - `AZDO_PROJECT`

### Frontend

1. Copia `client/.env.example` in `client/.env`
2. Lascia `VITE_SKIP_OWNER_CHECK=true` com'e, a meno che tu non voglia restringere "Plan Progress"/"Remove Test Cases" a un solo proprietario. Facoltativo: compila `VITE_MY_EMAIL`/`VITE_MY_NAME` per far funzionare le schede "assegnati a me"/"creati da me" in "My Work Items"

Non condividere mai token o credenziali contenute nei file `.env`.

## 6. Avvia l'app

Da root progetto:

```
npm run dev:all
```

Poi apri:

```
http://localhost:3000
```

Al primo avvio si apre in alto un menu **Project**: scegli un progetto (elenca tutti i progetti Azure DevOps visibili al token `AZDO_PAT`, non solo quello in `.env`) prima che vengano caricati i dati. Puoi anche filtrare per Area Path e Sprint. La scelta viene ricordata nel browser; usa il pulsante **Change scope** per cambiarla in seguito.

Per fermare: `Ctrl + C` nel terminale.

Se ci sono processi bloccati o porte occupate:

```
npm run kill:dev
npm run dev:all
```

## Problemi comuni

- **"npm is not recognized"**: Node.js non e installato correttamente. Reinstalla Node.js e riapri il terminale.
- **Errori Azure DevOps**: ricontrolla `AZDO_PAT`, `AZDO_ORG`, `AZDO_PROJECT` nel `.env`.
- **L'app non parte con `npm run dev:all`**: verifica di aver eseguito `npm install` sia in root sia in `client`.
- **Errore 502 o pagina bloccata**: esegui `npm run kill:dev` e poi rilancia `npm run dev:all`.
- **Pagina "My Work Items" vuota** (schede "assegnati a me"/"creati da me"): imposta `VITE_MY_EMAIL` in `client/.env`.

## Onboarding Italiano (Windows)

- Guida completa italiana: `docs/guida-windows-da-zero-it.md`
- Skill AI automatica italiana: `.claude/skills/setup-windows-it/SKILL.md`
