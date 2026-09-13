create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'you',
  avatar_color text not null default 'coral',
  notifications_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Nootion',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  token_hash text not null unique,
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.day_chats (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  date date not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (space_id, date)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.day_chats(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null default '',
  reply_to_id uuid references public.messages(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  storage_path text not null,
  filename text not null,
  content_type text not null default 'application/octet-stream',
  byte_size bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.note_blocks (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('paragraph', 'heading', 'bullet', 'todo', 'comment')),
  content text not null default '',
  checked boolean not null default false,
  position integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.note_blocks drop constraint if exists note_blocks_type_check;
alter table public.note_blocks add constraint note_blocks_type_check check (type in ('paragraph', 'heading', 'bullet', 'todo', 'comment'));

create table if not exists public.workspace_links (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  url text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, url)
);

create index if not exists messages_chat_created_idx on public.messages(chat_id, created_at);
create index if not exists note_blocks_owner_position_idx on public.note_blocks(space_id, owner_id, position);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'messages'
    ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'day_chats'
    ) then
    alter publication supabase_realtime add table public.day_chats;
  end if;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'attachments'
    ) then
    alter publication supabase_realtime add table public.attachments;
  end if;
end
$$;

create or replace function public.is_space_member(target_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.space_members
    where space_id = target_space_id and user_id = auth.uid()
  );
$$;

create or replace function public.create_space(space_name text, display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_space_id uuid;
  today_chat_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if exists (select 1 from public.space_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a space';
  end if;

  insert into public.profiles (id, display_name)
  values (auth.uid(), nullif(trim(display_name), ''))
  on conflict (id) do update set display_name = excluded.display_name;

  insert into public.spaces (name, owner_id)
  values (coalesce(nullif(trim(space_name), ''), 'Nootion'), auth.uid())
  returning id into new_space_id;

  insert into public.space_members (space_id, user_id, role)
  values (new_space_id, auth.uid(), 'owner');

  insert into public.day_chats (space_id, date, created_by)
  values (new_space_id, current_date, auth.uid())
  returning id into today_chat_id;

  return new_space_id;
end;
$$;

create or replace function public.create_invite(target_space_id uuid, invite_token_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.space_members
    where space_id = target_space_id and user_id = auth.uid() and role = 'owner'
  ) then raise exception 'Only the owner can create an invite'; end if;
  if (select count(*) from public.space_members where space_id = target_space_id) >= 2 then
    raise exception 'This space already has two people';
  end if;
  insert into public.invites (space_id, token_hash) values (target_space_id, invite_token_hash);
end;
$$;

create or replace function public.claim_invite(invite_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_invite public.invites%rowtype;
  member_count integer;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select * into target_invite from public.invites
  where token_hash = invite_token_hash and claimed_at is null
  for update;
  if not found then raise exception 'This invite is invalid or already used'; end if;

  select count(*) into member_count from public.space_members where space_id = target_invite.space_id;
  if member_count >= 2 then raise exception 'This space already has two people'; end if;
  if exists (select 1 from public.space_members where user_id = auth.uid()) then
    raise exception 'This account already belongs to a space';
  end if;

  insert into public.space_members (space_id, user_id, role)
  values (target_invite.space_id, auth.uid(), 'member');
  insert into public.profiles (id, display_name)
  values (auth.uid(), coalesce(nullif(split_part((select email from auth.users where id = auth.uid()), '@', 1), ''), 'you'))
  on conflict (id) do nothing;
  update public.invites set claimed_by = auth.uid(), claimed_at = now() where id = target_invite.id;
  return target_invite.space_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.invites enable row level security;
alter table public.day_chats enable row level security;
alter table public.messages enable row level security;
alter table public.attachments enable row level security;
alter table public.note_blocks enable row level security;
alter table public.workspace_links enable row level security;

create policy "profiles are visible to space members" on public.profiles for select using (
  id = auth.uid() or exists (
    select 1 from public.space_members mine
    join public.space_members theirs on theirs.space_id = mine.space_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy "users manage their own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "members can read their space" on public.spaces for select using (public.is_space_member(id));
create policy "owners create spaces" on public.spaces for insert with check (owner_id = auth.uid());
create policy "members can read membership" on public.space_members for select using (public.is_space_member(space_id));
create policy "members can read chats" on public.day_chats for select using (public.is_space_member(space_id));
create policy "members can create chats" on public.day_chats for insert with check (public.is_space_member(space_id) and created_by = auth.uid());
create policy "members can read messages" on public.messages for select using (
  exists (select 1 from public.day_chats where id = messages.chat_id and public.is_space_member(space_id))
);
create policy "members can send messages" on public.messages for insert with check (
  author_id = auth.uid() and exists (select 1 from public.day_chats where id = messages.chat_id and public.is_space_member(space_id))
);
create policy "authors edit messages" on public.messages for update using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "authors delete messages" on public.messages for delete using (author_id = auth.uid());
create policy "members can read attachments" on public.attachments for select using (
  exists (
    select 1 from public.messages m join public.day_chats c on c.id = m.chat_id
    where m.id = attachments.message_id and public.is_space_member(c.space_id)
  )
);
create policy "authors create attachments" on public.attachments for insert with check (
  exists (
    select 1 from public.messages m where m.id = attachments.message_id and m.author_id = auth.uid()
  )
);
create policy "authors delete attachments" on public.attachments for delete using (
  exists (select 1 from public.messages m where m.id = attachments.message_id and m.author_id = auth.uid())
);
create policy "owners manage private notes" on public.note_blocks for all using (owner_id = auth.uid()) with check (
  owner_id = auth.uid() and public.is_space_member(space_id)
);
create policy "users manage their workspace links" on public.workspace_links for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

insert into storage.buckets (id, name, public) values ('chat-files', 'chat-files', false)
on conflict (id) do nothing;

create policy "members read chat files" on storage.objects for select using (
  bucket_id = 'chat-files' and exists (
    select 1 from public.space_members sm
    where sm.user_id = auth.uid()
    and (storage.foldername(name))[1] = sm.space_id::text
  )
);
create policy "members upload chat files" on storage.objects for insert with check (
  bucket_id = 'chat-files' and exists (
    select 1 from public.space_members sm
    where sm.user_id = auth.uid()
    and (storage.foldername(name))[1] = sm.space_id::text
  )
);
create policy "members delete their chat files" on storage.objects for delete using (
  bucket_id = 'chat-files' and owner_id = auth.uid()::text
);
