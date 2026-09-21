# ContractorLink

**Elijah Njugi | Final-year project**

ContractorLink is my final-year project on managing service work between companies and contractors. The main idea is to keep the agreement, assigned work and progress records in one place. A company and its contractor can agree on service terms, create tickets under the agreement and follow each ticket through to completion.

The application covers organization registration and approval, partnerships, service level agreements (SLAs), ticket assignment, discussions, approved holds, notifications and reports. After an SLA breach, a client or contractor administrator can mark unfinished work as failed and record the reason. Failed tickets close separately from completed work. It also includes a Random Forest model that gives an advisory breach-risk score. I use this score to support ticket review; the SLA deadline and recorded progress remain the basis for tracking the work.

## How the project works

1. A company or contractor submits an organization application for review.
2. Approved organizations establish a partnership.
3. The company prepares an SLA, which the contractor reviews and approves.
4. Tickets are created under the approved agreement and assigned for action.
5. Users record progress, discuss the work, request holds where necessary and complete tickets. Reports bring these records together for review.

## Running the application

The launcher is intended to make the project easier to demonstrate on another Windows computer. It installs missing dependencies, prepares the local database and opens the application in a browser.

1. Download [ContractorLink-Windows.zip](https://github.com/ElijahNjugi/ContractorLink/releases/tag/v1.0.0) and extract the whole folder.
2. Double-click **Launch ContractorLink.cmd**. The first setup needs internet access and can take several minutes.
3. Open `.runtime/First login.txt` for the generated administrator login, then change the initial password when prompted.
4. Keep the launcher window open while using the application.
5. Use **Stop ContractorLink.cmd** when finished. Your records remain available the next time you start it.

The launcher supports 64-bit Windows 10 and Windows 11. Allow a few GB of free space for the tools and dependencies. Node.js, Python and PostgreSQL do not need to be installed beforehand, and no paid account is needed.

The usual address is `http://127.0.0.1:5173`. If that port is occupied, the launcher selects another one and opens the correct address. The shortcut inside `.runtime` also uses that address. The top-level **Open ContractorLink.url** shortcut only opens the default address after the application has started.

## Demonstrating the project with existing records

The public download starts with a separate database and a generated administrator account. For a demonstration with the existing project records, I provide **ContractorLink-With-Records.zip** separately. After extracting it, use the same launcher and sign in with the application login details I provide.

This version imports the supplied accounts, records and uploaded files on the first launch. Later launches keep the recipient's changes. Each copy runs independently, so changes on one computer do not appear on another. An existing local installation is not overwritten by the snapshot.

The snapshot contains account password hashes and project documents, so I keep it out of the public repository and share it directly with the intended reviewers. It does not include database server passwords, email/API keys or password-reset tokens.

## Dataset and Google Colab notebook

[Open the ContractorLink notebook in Google Colab](https://colab.research.google.com/github/ElijahNjugi/ContractorLink/blob/main/notebooks/ContractorLink_Dataset_and_Model.ipynb).

The notebook explains the dataset, checks its contents, trains the Random Forest and evaluates the predictions. Select **Runtime → Run all** using a free CPU runtime. To keep an editable copy, select **File → Save a copy in Drive**. Each code cell starts with a short comment explaining its purpose.

The dataset contains 12,000 records: 6,000 external incident snapshots and 6,000 simulated ContractorLink records. All 1,530 breach labels in the prepared dataset come from the simulated portion. The external labels use the initial incident snapshot rather than the final outcome. I explain these limitations, along with the repeated rows, in the notebook and [dataset notes](ml/data/provenance.md).

The model detects many of the labelled breaches but also produces many false alarms. I therefore present it as an experimental feature. The dataset results do not establish its accuracy on real ContractorLink operations.

## Tools used

| Part | Tools |
| --- | --- |
| User interface | React 18 and Vite |
| Backend API | Node.js and Express |
| Database | PostgreSQL |
| Live updates | Socket.IO |
| Breach-risk model | Python and scikit-learn |

The launcher uses [Node.js](https://nodejs.org/), [uv](https://docs.astral.sh/uv/) and [embedded-postgres](https://github.com/leinelissen/embedded-postgres). These components retain their own licences. The required runtimes are downloaded during setup rather than included in the source ZIP.

## Local setup and limitations

When `backend/.env` contains database settings, the launcher uses that existing development database and the same account logins as `npm run dev`. Otherwise, it creates its own portable database and imports the supplied snapshot when present.

The launcher runs the website on the local computer; it does not publish it online. It uses guided SLA drafting without a paid API key. In-app notifications are available, but email delivery is disabled. Emailed invitations and password-reset links need SMTP configuration in a development installation.

Local records, uploads and settings are stored in `.runtime/`. Keep this folder to preserve your work, and stop the application before making a backup. Do not share a used runtime folder as a clean project copy because it contains local credentials and records.

## Working with the source code

The `backend` and `frontend` folders each have their own package files. For development, configure `backend/.env` using the example file, install the dependencies in both folders and run `npm run dev` in each. The Vite proxy forwards API, upload and Socket.IO requests to backend port 5000. The launcher instead builds the frontend and serves it with the API at one address.

`PYTHON_EXECUTABLE` sets the Python interpreter used by the model, and `UPLOAD_ROOT` sets the upload location. `HOST`, `PORT` and `SERVE_FRONTEND` control how the backend serves the application.

Run `npm test` to check the launcher utilities. Run `npm run package` to prepare the public ZIP in `.distribution/ContractorLink-Windows.zip`. The package includes the prepared research CSV and saved model, while excluding private records, environment files, installed dependencies and research documents.

For a private handover, `node scripts/export-snapshot.mjs` exports the configured development database, and `scripts/package-snapshot.ps1` prepares the ZIP with those records. This ZIP is for direct sharing with reviewers, not for uploading to the public GitHub release.
