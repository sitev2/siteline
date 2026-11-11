# Turning on accounts (Supabase, free)

Accounts are optional. Without them everyone plays as a guest. With them, players can sign up with an email, password and username, and the game keeps:

- their stats: kills, deaths, headshots, damage, matches played and won, rounds won, deathmatch wins and favourite weapon
- their balance: 10–80 cents per match win
- their settings: keybinds, crosshair, phone layout and graphics

It takes about 10 minutes.

## 1. Create the free Supabase project

1. Go to **https://supabase.com** and click **Start your project**. Sign up with your email (or GitHub, once your GitHub account works again).
2. Click **New project**.
   - **Name:** `siteline`
   - **Database password:** click **Generate a password** and save it somewhere safe. The game doesn't need it.
   - **Region:** the one closest to you and your friends.
   - **Plan:** Free.
3. Click **Create new project** and wait a minute or two while it sets up.

## 2. Create the tables (copy-paste)

1. In the left sidebar, click **SQL Editor**, then **New query**.
2. Open the file **`supabase.sql`** from the game folder. Select everything and copy it.
3. Paste it into the Supabase editor and click **Run** (bottom right).
4. You should see "Success. No rows returned". That's it.

## 3. Email settings

1. In the left sidebar, click **Authentication**, then **Sign In / Providers** (on some versions it's **Providers**, then **Email**).
2. Make sure **Email** is turned on.
3. **Confirm email:**
   - On means new players must click a link in an email before they can log in. This is safer.
   - Off means they can play straight away.
   Either works with the game.
4. Click **Authentication**, then **URL Configuration**. Set **Site URL** to your game's address, for example `https://your-site.netlify.app`, and click **Save**. The confirmation emails link there.

## 4. Paste your project URL and key into the game

1. In the left sidebar, click **Project Settings** (the cog), then **API** (on some versions it's **Data API** / **API Keys**).
2. Copy these two values:
   - **Project URL**, which looks like `https://abcdefgh.supabase.co`
   - the **anon public** key: a long text starting with `eyJ…` (on newer projects it may be called the **publishable** key)
3. Open **`config.js`** in the game folder with a text editor (Notepad is fine) and find these lines:
   ```js
   supabaseUrl: '',
   supabaseAnonKey: '',
   ```
4. Paste the values between the quotes:
   ```js
   supabaseUrl: 'https://abcdefgh.supabase.co',
   supabaseAnonKey: 'eyJhbGciOi…',
   ```
5. Save the file and upload the game folder again (on Netlify, drag the folder onto your site's **Deploys** page).

The anon key is meant to be public. Supabase's row-level security rules, created by `supabase.sql`, decide what it can do. Never put the **service_role** / **secret** key in the game.

## Forgot password (needs email sending set up)

The Account screen has **Forgot password?** (sends a reset link by email) and, when logged in, **Change password**. The reset link opens the game, which then asks for a new password.

**Supabase's built-in email only sends to you and your Supabase team members, and only about 2 emails an hour.** Until you connect your own email sender (SMTP), players asking for a reset get "The game can't send emails to that address yet". Sign-up confirmation emails have the same limit. To fix it (free, about 15 minutes):

1. **Tell Supabase where the game is.** Supabase → **Authentication** → **URL Configuration**:
   - **Site URL:** `https://sitev2.github.io/siteline/`
   - **Redirect URLs** → **Add URL** → `https://sitev2.github.io/siteline/` → **Save**.
2. **Make a free email-sending account**, for example **Brevo** (https://www.brevo.com, free plan, 300 emails a day):
   - Sign up, then go to **Senders, Domains & Dedicated IPs** → **Senders** → **Add a sender**, and use an email address you own. Brevo emails you a link to confirm it.
   - Go to **SMTP & API** → **SMTP** tab → **Generate a new SMTP key**. Keep this page open: it shows the **SMTP server**, **Port**, **Login** and the **key**.
3. **Connect it to Supabase.** Supabase → **Authentication** → **Emails** → **SMTP Settings** → turn on **Enable custom SMTP** and fill in:
   - **Sender email:** the address you confirmed in Brevo. **Sender name:** `SITELINE`
   - **Host:** `smtp-relay.brevo.com` **Port:** `587`
   - **Username:** the Brevo **Login**. **Password:** the Brevo **SMTP key**
   - **Save**.
4. Supabase then allows 30 emails an hour. You can change that under **Authentication** → **Rate Limits**.
5. Test it: in the game, Account → **Forgot password?** with your own email. Check the spam folder the first time.

(Menu names can differ slightly between versions of Supabase and Brevo. Any SMTP service works the same way.)

## Updating the database after a game update

Some updates (like **friends and invites**) need new tables in Supabase. When an update says so, do this once:

1. Go to **https://supabase.com/dashboard** and open your **siteline** project.
2. In the left sidebar, click **SQL Editor**, then **New query**.
3. Open **`supabase.sql`** on GitHub (https://github.com/sitev2/siteline/blob/main/supabase.sql), click the **Copy raw file** button (two overlapping squares, top right of the file), and paste it into the Supabase editor.
4. Click **Run** (bottom right). You should see "Success. No rows returned". If Supabase warns about "destructive operations", click **Run this query**: it only replaces the game's own functions and keeps every player and their stats.

It is safe to run again any time. Until it has been run, the Friends screen says the database isn't set up yet.

## Friends and invites

Logged-in players can add friends by username (the other player must accept), see which friends are online and what they're doing ("In the menu", "In a 2v2 match"…), see their stats, and invite them to the game they're in. An invite pops up on the friend's screen with a **Join** button and expires after 3 minutes.

- Only friends see your online status, activity and stats.
- The game tells Supabase "I'm online" every 20 seconds while it's open; friends count as online for 90 seconds after that.
- **Chat:** friends can message each other from the Friends screen (Chat button). Only friends can message, at most 20 messages a minute and 200 characters each; the game's swear filter runs on every message. Messages are **deleted after 7 days**, and unfriending deletes the chat.
- Nobody can read or change the friends, invites or messages tables directly: only through the database functions in `supabase.sql`, which check you're logged in and that you're friends.

## Admin screen

The accounts **test123** and **test1234** get an **Admin** link on the home screen. It shows game-wide numbers (players, who's online, matches, messages, database size), whether the game servers answer, and every player's stats and last time online. It is read-only and never shows emails, passwords or chat messages.

Admins are set when you run `supabase.sql`: it looks up who owns those usernames at that moment. So **create those accounts before running it** (otherwise someone else could sign up with the name later and become admin when you next run it), and give them strong passwords. To change who is admin, edit the usernames in the "admin view" part of `supabase.sql` and run it again (to remove an admin, delete their row in Table Editor → `admins`).

## What can and can't be protected from cheating

Matches run in a player's browser: the host's browser runs the match, and each player's browser reports its own result. So be realistic:

**Protected:**

- Players can only read and change **their own** profile. Nobody can edit someone else's stats.
- Stats and balance can **only** change through the `report_match` function. A player can't simply set their balance to $1,000.
- `report_match` caps every number at what one match can produce: at most 60 kills, headshots no more than kills, 9,000 damage, 9 rounds won. Only real gun names count towards favourite weapon.
- **One report every 2 minutes per account**, so even a faked report can only add a small amount, slowly. Each win adds 10–80 cents.
- Practice and bot games never report.

**Not protected:**

- Someone who knows how to edit the game's code in their browser can **send a fake "I won" report** within those limits. Because the match runs in a player's browser, there is no neutral referee to confirm results.
- A host can change the rules of the match running in their own browser.

To make stats fully trustworthy, matches would need to run on a server you control (like the home server in `server/`) that reports results itself. For a game among friends, the limits above keep things fair enough.
