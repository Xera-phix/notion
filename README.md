# Nootion

A desktop-first, Notion-shaped shared page with WhatsApp-style messages, inline replies, daily chats, private notes, private inline comments, and file uploads.

Light mode is the default. Use the light/dark mode button in the bottom-left corner on any screen to switch themes. Your choice is saved in this browser.

Profiles and messages use names without avatars. Returning to a tab keeps the current page, draft, and scroll position rather than reopening the workspace on same-account auth refresh events. Startup has no full-screen loading animation.

## Local preview

```powershell
npm install
npm run dev
```

Without environment variables, Nootion runs in a local preview mode and stores its demo workspace in browser storage. This makes the UI and chat flow usable before a backend is connected.

Use the Nootion breadcrumb menu to add personal Notion page links. Each saved link appears as a workspace item and redirects the current tab to the real Notion page; Nootion does not import or sync that page's content.

Private notes can include author-only inline comments. Use the small plus marker between blocks to insert a note or a hidden comment; comments stay collapsed until you reveal them and are stored with the rest of your private note blocks.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL editor and run [supabase/schema.sql](supabase/schema.sql).
3. Copy [.env.example](.env.example) to `.env`.
4. Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. In Supabase Auth, enable email OTP or magic links and add the local and Vercel URLs to the redirect allowlist.
6. Run `npm run dev` again.

The production mode uses Supabase Auth, Postgres, Realtime, and the private `chat-files` Storage bucket. Row-level security limits a space to its two members; private note blocks are readable only by their owner.

## Vercel

Import the repository into Vercel, set the two `VITE_` environment variables, and deploy. The included [vercel.json](vercel.json) keeps invite and auth callback routes working with the single-page app.

The intended project slug is `noot-tion`; the final `*.vercel.app` hostname depends on availability in Vercel.
