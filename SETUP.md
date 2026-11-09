# Demetria's Diner: setup from the beginning (Mac)

Follow the steps **in order**. Each grey box is **one** command: paste it into VS Code's terminal
and press **Enter**. Wait until it finishes (you see the `%` prompt again) before the next one.

You need: a Mac, a **GitHub** account, a **Vercel** account, and this guide's zip file
(**demetrias-diner-vercel.zip**) in your **Downloads** folder.

---

## Step 1: Install the tools (skip any you already have)

1. **VS Code:** download from **code.visualstudio.com** and drag it into Applications.
2. **Node.js:** download the **LTS** version from **nodejs.org** and run the installer.
3. Open VS Code, then **Terminal → New Terminal**, and check Node works:

   ```bash
   node -v
   ```

   You should see `v20…` or higher. If you see *command not found*, quit VS Code fully (**Command + Q**),
   open it again, and retry.

---

## Step 2: Get a clean copy of the code

1. In **Finder**, if an old **demetrias-diner-vercel** folder is on your **Desktop**, drag it to the **Trash**.
   (We start fresh. Nothing in it is needed.)
2. In VS Code's terminal, unzip the new code onto your Desktop:

   ```bash
   unzip -o ~/Downloads/demetrias-diner-vercel.zip -d ~/Desktop/demetrias-diner-vercel
   ```

   If it says *cannot find*, your Mac renamed the download (e.g. `demetrias-diner-vercel (1).zip`).
   Rename it in Finder to exactly `demetrias-diner-vercel.zip` and run the command again.

3. In VS Code: **File → Open Folder…**, choose **Desktop → demetrias-diner-vercel**, and click **Open**.
   If asked "Do you trust the authors?", click **Yes**.
4. Open a new terminal (**Terminal → New Terminal**). It now starts inside the project folder.
   Install the one package the project needs:

   ```bash
   npm install
   ```

   It ends with *found 0 vulnerabilities*.

---

## Step 3: Create the database (Neon)

1. Open **https://console.neon.tech** and sign in with **Continue with GitHub**.
2. Click **New Project** and fill in:
   - **Project name:** `demetrias-db`
   - **Region:** **AWS Asia Pacific 1 (Singapore)**

   Then click **Create project**.
3. On the project page, click **Connect** (top right).
4. Make sure **Connection pooling** is **on**, then click **Copy** next to the connection string.
   It looks like this (yours has real values):

   ```
   postgresql://neondb_owner:PASSWORD@ep-something-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

   Paste it into the **Notes** app for now. You need it twice. It contains your database password,
   so don't share it.

---

## Step 4: Create your settings file (`.env`)

1. Make a secret for staff logins:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Copy the long code it prints into **Notes** too.

2. Create the settings file:

   ```bash
   cp .env.example .env
   ```

3. In VS Code's file list (left side), click **`.env`**. Check the tab says **`.env`**, *not* `.env.example`.
   Select everything (**Command + A**), press **Delete**, and paste this:

   ```
   DATABASE_URL=PASTE_YOUR_NEON_STRING_HERE
   STAFF_PASSWORD=test1234
   SESSION_SECRET=PASTE_YOUR_SECRET_HERE
   CAFE_TIMEZONE=Asia/Manila
   ```

4. Replace `PASTE_YOUR_NEON_STRING_HERE` with your Neon string (Step 3), and `PASTE_YOUR_SECRET_HERE`
   with your secret (this step). Each must stay on **one line**, with **no spaces** and **no quotes**.
5. Save with **Command + S**.

---

## Step 5: Connect the folder to Vercel

1. Log in to Vercel from the terminal:

   ```bash
   npx vercel login
   ```

   If it asks *Ok to proceed? (y)*, type **y** and press Enter. Choose **Continue with GitHub**
   (use the arrow keys, then Enter). A browser window opens: approve it, then return to VS Code.

2. Link this folder to your Vercel project:

   ```bash
   npx vercel link
   ```

   Answer the questions (arrow keys + Enter):

   | Question | Answer |
   |---|---|
   | Set up "~/Desktop/demetrias-diner-vercel"? | **yes** |
   | Which scope? | your account (**woodwalkerrs-projects**) |
   | Link to existing project? | **yes** |
   | What's the name of your existing project? | **demetriasdinerapp** |

   If it says the project doesn't exist, run the command again and answer **no** to
   "Link to existing project?", then type `demetriasdinerapp` as the new name.
   For **Code directory**, just press **Enter** (do **not** type anything).

---

## Step 6: Run it on your Mac

1. Start the site:

   ```bash
   npx vercel dev
   ```

   When you see **Ready! Available at http://localhost:3000**, it's running. Leave this terminal open.

2. Open these in **Google Chrome** (Safari can block the staff login on localhost):

   | Check | Address | You should see |
   |---|---|---|
   | Database | http://localhost:3000/api/menu | text starting with `{"currency":"PHP","accepting":true` |
   | Website | http://localhost:3000 | the Demetria's Diner site |
   | Staff / POS | http://localhost:3000/staff | a sign-in page: username **`admin`**, password **`test1234`** (your `STAFF_PASSWORD`). The first sign-in creates your **owner** account |

3. **Set up your shop** (signed in as admin):
   - **Users → + Add staff**: give each person their own username and password. Choose **Cashier** for counter staff
     and **Manager** for supervisors. You can tick or untick what each person may do.
   - **Products**: type the prices for the **Food Classics** (they say "—" until you do), turn on stock counts for
     items you want tracked (**Track → type the count**), and edit any add-on prices.
   - **Settings → GCash / Maya QR**: upload your QR (GCash app: **Profile → My QR Code → Download**), type the account
     name, click **Save QR details**, and switch it **on**.
   - **Settings → Delivery**: tap the map at your store, check the distance tiers (₱20 / ₱30 / ₱40), click
     **Save delivery settings**, and switch **Offer delivery** on.

4. **Try a normal day:**
   - **Shift → Open shift** with the cash in the drawer.
   - **POS**: ring up a sale with add-ons, try **+ Split payment** (part cash, part GCash), and print the receipt.
   - On the website (another browser tab), order with **Delivery** and send a message. It appears on the **Board** with a 💬.
   - **Shift → Cash out** something (e.g. ₱100 for ice), then **Close shift**, counting the cash, to see the shift report.

To stop the site, press **Control + C** in the terminal. To start it again later, open the folder in
VS Code and run `npx vercel dev`.

---

## Step 7: Put it online

Do this only after Step 6 works.

**A. Save the code to GitHub.** Run these one at a time:

```bash
git init
```
```bash
git add .
```

Check that no secret file is included:

```bash
git status --short | grep -i env
```

You must see **only** `.env.example`. If `.env` appears, stop and ask for help.

```bash
git commit -m "Demetria's Diner website"
```
```bash
git branch -M main
```
```bash
git remote add origin https://github.com/WoodWalkerr/demetriasdinerapp.git
```
```bash
git push -u origin main
```

If the push says the remote *contains work that you do not have*, your GitHub repository isn't empty.
Ask for help before forcing anything.

**Before you go live, read this.** Your Mac and the live site use the **same database**, so the `admin` account you
created with `test1234`, and every test order, are on the live site too. So:
1. Sign in at http://localhost:3000/staff as admin, open your name (top right) → **Change my password**, and set a strong one.
2. Clear the test orders and shifts in Neon (console.neon.tech → your project → **SQL Editor**), running:
   ```
   DELETE FROM orders; DELETE FROM messages; DELETE FROM cash_moves; DELETE FROM shifts; DELETE FROM stock_log; DELETE FROM expenses; DELETE FROM audit_log;
   ```
   This keeps your products, prices, add-ons, settings and staff accounts.

**B. Add your settings to Vercel.** On vercel.com go to **Projects → demetriasdinerapp → Settings →
Environment Variables**. Add these four. For each one, tick **Production**, **Preview** and **Development**:

| Key | Value |
|---|---|
| `DATABASE_URL` | the same Neon string from Step 3 |
| `STAFF_PASSWORD` | any strong password (it's only used if the database has no accounts yet) |
| `SESSION_SECRET` | a **new** secret: run the command from Step 4.1 again |
| `CAFE_TIMEZONE` | `Asia/Manila` |

**C. Connect GitHub to the project.** In the same project: **Settings → Git → Connect Git Repository**,
choose **GitHub**, then **demetriasdinerapp**.

**D. Publish:**

```bash
npx vercel --prod
```

When it finishes it prints your live address, e.g. `https://demetriasdinerapp.vercel.app`. Open:
- `…/api/menu`: should show `"accepting":true`
- `…/`: your website
- `…/staff`: sign in as **admin** with the strong password you set in step 1 above

From now on, to update the live site: in VS Code click **Source Control** (left bar), type a message,
click **Commit**, then **Sync Changes**. Vercel publishes it in about a minute.

---

## Nightly summary email (optional, about 5 minutes)

1. Go to **resend.com** and sign up **with the email address that should receive the summary** (free plan).
2. In Resend: **API Keys → Create API Key** → name it `demetrias` → **Add**. Copy the key (starts with `re_`).
3. Make a random secret for the daily job:

   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```

4. On vercel.com: **Projects → demetriasdinerapp → Settings → Environment Variables**. Add these two
   (tick Production, Preview and Development):

   | Key | Value |
   |---|---|
   | `RESEND_API_KEY` | the `re_…` key from step 2 |
   | `CRON_SECRET` | the secret from step 3 |

5. Publish again (Commit → **Sync Changes**), so the new settings are used.
6. On your site: **/staff → Settings → Nightly summary email**. Type the same email address you used for Resend,
   switch on **Email me a summary every night**, then tap **Send last night's now** to test. Check your spam folder the first time.

Vercel runs the job once a day at around 4–5 AM Philippine time (`vercel.json` → `crons`, written in UTC as `0 20 * * *`).
To also email other people (a partner, a manager), Resend needs your own domain: **Resend → Domains → Add domain**,
then set `SUMMARY_FROM` to e.g. `Demetria's Diner <reports@yourdomain.com>`. Until then, only your Resend sign-up address gets emails.

---

## Updating to a new version (you already have the site running)

1. In Finder, open your project folder and **delete only** the `api`, `lib` and `public` folders (keep `.env`, `.vercel` and `.git`).
   Also replace `vercel.json` and `README.md`/`SETUP.md` with the new ones.
2. Unzip the new version and copy everything **except** `.env` into your project folder. Say **Replace** when asked.
3. In the VS Code terminal run `npm install`, then `npx vercel dev`, and check http://localhost:3000/staff.
4. Commit and **Sync Changes** (Step 7) to publish.

The database updates itself the first time the new version runs: new columns and tables are added, new prices are
applied, and old menu items are hidden (your orders and history are kept). Prices or costs you edited yourself
earlier are replaced by the new list only once, at that first run.

---

## If something goes wrong

| You see | What to do |
|---|---|
| `"accepting":false` at /api/menu | `DATABASE_URL` in `.env` is wrong. Copy it again from Neon (Step 3), save, press **Control + C**, run `npx vercel dev` again |
| *The database is not connected yet* | Same as above |
| Staff sign-in sends you back to the login page | Use **Chrome** for localhost |
| *First sign-in: use username "admin"…* | No accounts exist yet: sign in with username `admin` and your `STAFF_PASSWORD` |
| *We're closed right now* when ordering | Check **Settings → Opening hours** (and special days). Customers can still order ahead |
| Nightly email didn't arrive | Settings → Nightly summary email → **Send last night's now** shows the exact error. Check spam, that `RESEND_API_KEY` and `CRON_SECRET` are in Vercel, and that you published again after adding them |
| *Open your shift first* | Go to the **Shift** tab and open your shift (needed for POS, cash in/out and confirming payments) |
| The delivery map stays grey | The map needs internet access to openstreetmap.org and unpkg.com |
| *Port 3000 is already in use* | Another copy is running. Close the other terminal tab (trash icon) and try again |
| `git push` says *Push cannot contain secrets* | A real key got into a committed file. Don't click GitHub's "allow" link; ask for help |
| `command not found: node` or `npx` | Install Node.js LTS from nodejs.org, quit VS Code (**Command + Q**), reopen |
| Anything else | Copy the red error text from the terminal and send it, hiding any passwords |
