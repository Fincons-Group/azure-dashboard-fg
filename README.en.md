# Azure DevOps Dashboard

A dashboard that pulls test plan, test run, and defect data from Azure DevOps and shows it in one place.

This guide assumes **zero coding experience**. Just follow the steps in order.

## 1. Install Node.js

This project needs a program called **Node.js** to run. If you don't have it yet:

1. Go to [nodejs.org](https://nodejs.org).
2. Download the **LTS** version and run the installer.
3. Click "Next" through the installer with the default options.

To check it worked, open a terminal (on Windows: search for "PowerShell" in the Start menu) and type:

```
node --version
npm --version
```

You should see version numbers printed (e.g. `v22.22.0` or newer). If you instead see an error, restart your computer and try again.

## 2. Get the project files

If you received this project as a `.zip` file, extract it anywhere on your computer (e.g. your Desktop).

If you're using Git, clone the repository instead:

```
git clone https://github.com/Fincons-Group/azure-dashboard-fg.git
```

## 3. Open a terminal in the project folder

1. Open the project folder in File Explorer.
2. In the address bar at the top, type `powershell` and press Enter. This opens a terminal already pointed at the right folder.

## 4. Install the project's dependencies

This downloads all the code libraries the project needs. In the terminal, run:

```
npm install
```

Then do the same inside the `client` folder:

```
cd client
npm install
cd ..
```

This can take a minute or two. You'll see a progress bar - just wait for it to finish.

## 5. Set up your configuration files

The app needs two configuration files: one for the backend (project root) and one for the frontend (`client` folder).

There's no Microsoft sign-in wall - the dashboard is visible to anyone who can reach it, and access is really gated by whether `AZDO_PAT` below is valid: if it works, data loads; if not, the dashboard renders an empty screen.

### Backend config

1. Find the file named `.env.example` in the project's root folder.
2. Make a copy of it and rename the copy to `.env` (just `.env`, nothing else).
3. Open `.env` in any text editor (Notepad works fine) and fill in:
   - `AZDO_PAT` - your Azure DevOps Personal Access Token (ask whoever manages your Azure DevOps for one, or generate it yourself under Azure DevOps > User Settings > Personal Access Tokens).
   - `AZDO_ORG` - your Azure DevOps organization name.
   - `AZDO_PROJECT` - your Azure DevOps project name.
4. Save the file.

### Frontend config

1. Find `client/.env.example`.
2. Make a copy and rename it to `client/.env`.
3. Leave `VITE_SKIP_OWNER_CHECK=true` as-is unless you're restricting "Plan Progress"/"Remove Test Cases" to a single owner. Optionally fill in `VITE_MY_EMAIL`/`VITE_MY_NAME` so the "My Work Items" assigned/created/mentioned tabs know who "me" is.
4. Save the file.

**Never share your `.env` file or your token with anyone** - it works like a password.

## 6. Run the app

Back in the terminal (at the project's root folder, not inside `client`), run:

```
npm run dev:all
```

Wait until you see messages saying the server and the client are running. Then open your web browser and go to:

```
http://localhost:3000
```

You should see the dashboard directly - no sign-in screen. To stop the app, go back to the terminal and press `Ctrl + C`.

The first time you load the app, a **Project** dropdown opens at the top of the page - pick a project (it lists every Azure DevOps project your `AZDO_PAT` token can see, not just the one in `.env`) before any data loads. You can also narrow further by Area Path and Sprint. Your choice is remembered in the browser for next time; use the **Change scope** button to pick a different project later.

## Troubleshooting

- **"npm is not recognized"**: Node.js isn't installed correctly. Re-do step 1 and restart your terminal.
- **Blank page or errors about Azure DevOps**: double-check the values in your root `.env` file (step 5) - typos in the org/project name or an expired token are the most common causes.
- **Nothing happens after `npm run dev:all`**: make sure you ran `npm install` in both the root folder and the `client` folder (step 4).
- **A "502" or "Bad Gateway" error, or the page looks stuck**: a server from a previous `npm run dev:all` run may still be holding the ports. Press `Ctrl + C` in the terminal, then run `npm run kill:dev` to clean up any leftover processes, and try `npm run dev:all` again.
- **"My Work Items" page is empty on the "Assigned to me"/"Created by me" tabs**: set `VITE_MY_EMAIL` in `client/.env` to your Azure DevOps email.

## Deploying to GitHub Pages

The frontend can be published as a static site on GitHub Pages, calling a
separately hosted backend (e.g. a free [Render](https://render.com) web
service) instead of a local one. This is a different trust boundary than
running locally: the PAT now travels over the internet to that backend
(which forwards it straight to Azure DevOps and never stores it), instead of
staying on `localhost`.

### 1. Deploy the backend

Deploy this repo's root (not `client/`) as a Node web service - e.g. on
Render: **New + → Web Service**, connect this repo, leave Root Directory
blank, Build Command `npm install`, Start Command `npm run start`.

Set these environment variables on the host:

- `HOST=0.0.0.0` (required - the default of `127.0.0.1` is loopback-only and
  won't be reachable from outside the container)
- `CORS_ORIGIN=https://<org>.github.io/<repo>` (your Pages URL, no trailing
  slash)

Deliberately do **not** set `AZDO_PAT`/`AZDO_ORG`/`AZDO_PROJECT` there - left
unset, the backend only trusts the PAT/org the browser sends per request
(`x-ado-pat`/`x-ado-org` headers, from the user's own local storage), never a
secret stored on the host.

### 2. Configure and run the GitHub Pages workflow

In this repo's **Settings → Pages**, set Source to **GitHub Actions**.

In **Settings → Secrets and variables → Actions → Variables**, add:

- `VITE_API_BASE_URL` = the backend URL from step 1 (e.g.
  `https://your-service.onrender.com`)

Then push to `main`, or run the **Deploy to GitHub Pages** workflow manually
from the Actions tab. It builds the client with `VITE_PUBLIC_BASE_PATH` set
to this repo's Pages path automatically, and publishes `dist/` via
`actions/deploy-pages`.

> Note: GitHub Pages for a **private** repository requires GitHub
> Pro/Team/Enterprise, and can be restricted to organization members only
> instead of fully public - check your org's plan/policy before relying on
> this.

## Italian onboarding (Windows)

- Manual guide (Italian): `docs/guida-windows-da-zero-it.md`
- Automatic AI skill (Italian): `.claude/skills/setup-windows-it/SKILL.md`
