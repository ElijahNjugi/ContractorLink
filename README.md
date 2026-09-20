# ContractorLink

A final-year web application for coordinating service work between companies and contractors. It links organization admission, partnerships, two-party service level agreements, ticket assignment, discussions, approved holds, resolution monitoring and reporting. An experimental Random Forest model provides an advisory breach-risk score.

## Run the project on Windows

Download **ContractorLink-Windows.zip** from the repository's **Releases** page, extract the entire folder, and double-click **Launch ContractorLink.cmd**.

The first launch downloads missing dependencies, creates an isolated PostgreSQL database, builds the frontend and opens the website automatically. Later launches reuse the installed dependencies and saved data. No hosting subscription, Docker installation or paid AI account is required.

- Supported target: Windows 10/11, x64. First-time setup requires internet and a few GB of disk space.
- Login: open `.runtime/First login.txt` for the generated administrator credentials. Change the password at first login. The initial password file is not updated after a password change.
- Keep the launcher window open. Use **Stop ContractorLink.cmd** or Ctrl+C to shut down cleanly.
- Default address: `http://127.0.0.1:5173`. If occupied, another local port is selected. The browser and `.runtime/Open ContractorLink.url` use the selected address.
- The top-level **Open ContractorLink.url** shortcut is for the default address after startup; it cannot install dependencies or start a server by itself.

The ZIP contains source code and the supplied model, not the developer's live records or credentials. Every recipient gets a separate local installation. The launcher binds services to the local computer and does not expose a public internet website.

## Local demonstration workflow

Sign in as the generated platform administrator. Use the public application form to submit company/contractor applications, then review them through platform administration. Approved participants can establish a partnership, prepare and approve an SLA, and create tickets under it. Organizations and service records are created locally as part of the demonstration.

The launcher uses free guided drafting and disables outbound email. Features that depend on email delivery, such as emailed invitations and password-reset links, require SMTP setup in a separately configured development installation. The launcher does not silently reuse any existing `.env` email credentials. Notifications recorded inside the app remain available.

## What the launcher does

1. Uses compatible Node.js or downloads a project-local Node.js 22 runtime from nodejs.org, checking its SHA-256 checksum.
2. Installs the locked Node dependencies and embedded PostgreSQL binaries.
3. Downloads a checksum-verified uv utility from Astral, provisions project-local Python 3.12, and installs the pinned packages matching the saved model.
4. Applies the schema and dated migrations to its own local database, with a migration ledger. Your existing development database and `.env` files are left alone.
5. Creates an administrator only if one is missing, without resetting an existing password.
6. Builds React and serves it with the Express API on one local address. It opens the browser after the database health check succeeds.

Local state, uploads, credentials and logs are kept in `.runtime/`. Preserve this folder to retain your work. Do not publish or distribute it. Use the Stop launcher before backing up or moving an installation. The launcher does not automatically upgrade previously edited database migrations.

## Development

The application uses React 18/Vite, Node.js/Express, Socket.IO, PostgreSQL and Python/scikit-learn. The `backend` and `frontend` folders retain their independent package manifests.

For an existing development environment, configure `backend/.env` from its example, install backend/frontend dependencies, and run their `npm run dev` commands. The Vite development proxy forwards API, upload and Socket.IO requests to port 5000. The portable launcher instead supplies its own isolated environment and serves the production frontend build.

`PYTHON_EXECUTABLE` overrides the predictor/retraining Python path. `UPLOAD_ROOT` overrides upload storage. `HOST`, `PORT` and `SERVE_FRONTEND=true` control combined serving. Existing development defaults remain available.

Run `npm test` for launcher utility tests. Run `npm run package` to generate a clean distributable in `.distribution/ContractorLink-Windows.zip`; private data, dependency folders, environment files, reports and raw incident data are excluded. The model and prepared training CSV are included for inference and the existing retraining feature.

## Evaluation boundaries

The breach predictor is experimental. Its hybrid training data and simulated positive labels do not establish real-world breach probability or operational effectiveness. See `ml/data/provenance.md` and `ml/models/breach_risk_v1_metrics.json`. The application remains an academic prototype; a local demonstration is not evidence of production security or capacity.

## Distribution components

The launcher uses [Node.js](https://nodejs.org/), [uv](https://docs.astral.sh/uv/) and [embedded-postgres](https://github.com/leinelissen/embedded-postgres). They retain their respective licenses. Downloaded runtimes and libraries are installed on first run rather than bundled into the source ZIP. Research documents, signatures, live database records and local credentials are not included in the public source package.
