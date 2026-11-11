# Turning on accounts (Supabase, free)

Accounts are optional. Without them everyone plays as a guest. With them, players can sign up with a username and password (no email), and the game keeps:

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
3. Turn **Confirm email** **OFF** and click **Save**. Accounts use only a username and password (see "Username-only accounts" below), so there's no real email to confirm.

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

## Username-only accounts and password resets

Players sign up with just a **username and password**: no email. Supabase still needs an email address for every account, so the game gives it a made-up one (`name@players.siteline.invalid`) that never receives mail. Accounts made earlier with a real email still work: those players can log in with their email.

**One setting is required:** Supabase → **Authentication** → **Sign In / Providers** (or **Providers** → **Email**) → turn **Confirm email** **OFF** → **Save**. While it's on, sign-up shows "Sign-up needs one Supabase setting changed…".

**Forgot password:** players can't reset it themselves; the game tells them to ask you. To reset someone's password:

1. Supabase → **SQL Editor** → **New query**.
2. Type this, with their username and a temporary password of your choice:
   ```sql
   select public.owner_reset_password('PlayerName', 'temporary123');
   ```
3. Click **Run**. It answers "Password reset for PlayerName…".
4. Tell the player the temporary password. They log in with it, open **Account**, and press **Change password**.

Only you can do this, in the SQL Editor. Players and the admin account (test123) can't: the Admin screen only shows stats.

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

The account **test123** gets an **Admin** link on the home screen. It shows game-wide numbers (players, who's online, matches, messages, database size), whether the game servers answer, and every player's stats and last time online. It is read-only and never shows emails, passwords or chat messages.

The admin is set when you run `supabase.sql`: it looks up who owns the username at that moment, and removes anyone else from the admin list. So **create the test123 account before running it** (otherwise someone else could sign up with that name later and become admin when you next run it), and give it a strong password. To change who is admin, edit the username in the "admin view" part of `supabase.sql` and run it again.

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
