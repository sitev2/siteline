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
