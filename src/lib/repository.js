import {
  appendMessage,
  createNextChat,
  deleteOwnMessage,
  editOwnMessage,
  getTodayKey,
  normalizeWorkspaceLink,
  updateNoteBlock,
} from './workspace.js';

const LOCAL_STORAGE_KEY = 'nootion-local-workspace';
const MAX_LOCAL_FILE_BYTES = 2 * 1024 * 1024;

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function datePlusDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return getTodayKey(date);
}

function makeDefaultState() {
  const today = getTodayKey();
  const yesterday = datePlusDays(today, -1);
  const twoDaysAgo = datePlusDays(today, -2);

  return {
    mode: 'local-preview',
    profile: {
      id: 'demo-you',
      email: 'you@noot-tion.local',
      displayName: 'luk',
      avatarColor: 'coral',
      notificationsEnabled: false,
    },
    partner: {
      id: 'demo-partner',
      email: 'partner@noot-tion.local',
      displayName: 'cyn',
      avatarColor: 'stone',
    },
    space: {
      id: 'demo-space',
      name: 'Nootion',
      ownerId: 'demo-you',
    },
    workspaceLinks: [],
    chats: [
      {
        id: `chat-${today}`,
        date: today,
        createdAt: `${today}T18:00:00.000Z`,
        messages: [
          {
            id: 'message-1',
            authorId: 'demo-partner',
            body: 'hope it\'s going splendidly!!',
            createdAt: `${today}T19:20:00.000Z`,
            attachments: [],
          },
          {
            id: 'message-2',
            authorId: 'demo-you',
            body: 'breanna quan\'s latest video has her going to the BTS popup LOL. WE WERE THERE.',
            createdAt: `${today}T19:22:00.000Z`,
            attachments: [],
          },
        ],
      },
      {
        id: `chat-${yesterday}`,
        date: yesterday,
        createdAt: `${yesterday}T18:00:00.000Z`,
        messages: [
          {
            id: 'message-3',
            authorId: 'demo-you',
            body: 'WHY A 40 YR OLD TALM BOUT HOOD',
            createdAt: `${yesterday}T23:02:00.000Z`,
            attachments: [],
          },
          {
            id: 'message-4',
            authorId: 'demo-partner',
            body: 'LMAO',
            createdAt: `${yesterday}T23:03:00.000Z`,
            replyToId: 'message-3',
            attachments: [],
          },
        ],
      },
      {
        id: `chat-${twoDaysAgo}`,
        date: twoDaysAgo,
        createdAt: `${twoDaysAgo}T18:00:00.000Z`,
        messages: [],
      },
    ],
    notes: [
      { id: 'note-1', ownerId: 'demo-you', type: 'heading', content: 'things to remember', checked: false, position: 0 },
      { id: 'note-2', ownerId: 'demo-you', type: 'paragraph', content: 'a private page that only shows up for me.', checked: false, position: 1 },
      { id: 'note-3', ownerId: 'demo-you', type: 'todo', content: 'send the picture later', checked: false, position: 2 },
    ],
    inviteToken: 'demo-invite-token',
  };
}

function readLocalState() {
  try {
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    return stored ? JSON.parse(stored) : makeDefaultState();
  } catch {
    return makeDefaultState();
  }
}

function writeLocalState(state) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A private browsing session may refuse storage; the in-memory state still works.
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    if (file.size > MAX_LOCAL_FILE_BYTES) {
      resolve('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

export class LocalRepository {
  constructor() {
    const storedState = readLocalState();
    this.state = { ...storedState, workspaceLinks: storedState.workspaceLinks || [] };
    this.listeners = new Set();
  }

  async load() {
    return clone(this.state);
  }

  persist() {
    writeLocalState(this.state);
    for (const listener of this.listeners) listener(clone(this.state));
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async updateProfile(changes) {
    this.state.profile = { ...this.state.profile, ...changes };
    this.persist();
    return this.load();
  }

  async addWorkspaceLink(input) {
    const link = normalizeWorkspaceLink(input);
    if (this.state.workspaceLinks.some((candidate) => candidate.url === link.url)) throw new Error('That Notion workspace is already added.');
    this.state.workspaceLinks = [{ id: createId('workspace'), ...link, createdAt: new Date().toISOString() }, ...this.state.workspaceLinks];
    this.persist();
    return this.load();
  }

  async removeWorkspaceLink(linkId) {
    this.state.workspaceLinks = this.state.workspaceLinks.filter((link) => link.id !== linkId);
    this.persist();
    return this.load();
  }

  async createInvite() {
    const token = `${createId('invite').replaceAll('-', '')}${Math.random().toString(36).slice(2, 8)}`;
    this.state.inviteToken = token;
    this.persist();
    return `${window.location.origin}/invite/${token}`;
  }

  async createChat() {
    const nextChat = createNextChat(this.state.chats, getTodayKey());
    this.state.chats = [{ ...nextChat, createdAt: new Date().toISOString() }, ...this.state.chats];
    this.persist();
    return this.load();
  }

  async sendMessage(chatId, payload) {
    const chat = this.state.chats.find((candidate) => candidate.id === chatId);
    if (!chat) throw new Error('That day could not be found.');

    const attachments = await Promise.all((payload.files || []).map(async (file) => ({
      id: createId('attachment'),
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      url: await fileToDataUrl(file),
    })));
    const message = {
      id: createId('message'),
      authorId: this.state.profile.id,
      body: payload.body.trim(),
      replyToId: payload.replyToId || null,
      createdAt: new Date().toISOString(),
      attachments,
    };
    chat.messages = appendMessage(chat.messages, message);
    this.persist();
    return this.load();
  }

  async editMessage(messageId, body) {
    const chat = this.state.chats.find((candidate) => candidate.messages.some((message) => message.id === messageId));
    if (!chat) return this.load();
    chat.messages = editOwnMessage(chat.messages, messageId, this.state.profile.id, body.trim());
    this.persist();
    return this.load();
  }

  async deleteMessage(messageId) {
    const chat = this.state.chats.find((candidate) => candidate.messages.some((message) => message.id === messageId));
    if (!chat) return this.load();
    chat.messages = deleteOwnMessage(chat.messages, messageId, this.state.profile.id);
    this.persist();
    return this.load();
  }

  async saveNotes(blocks) {
    this.state.notes = blocks.map((block, position) => ({ ...block, position, ownerId: this.state.profile.id }));
    this.persist();
    return this.load();
  }
}

function mapProfile(profile, user) {
  return {
    id: user.id,
    email: user.email || '',
    displayName: profile?.display_name || user.user_metadata?.display_name || user.email?.split('@')[0] || 'you',
    avatarColor: profile?.avatar_color || 'coral',
    notificationsEnabled: Boolean(profile?.notifications_enabled),
  };
}

function mapMessage(message, attachments) {
  return {
    id: message.id,
    authorId: message.author_id,
    body: message.body || '',
    replyToId: message.reply_to_id,
    createdAt: message.created_at,
    editedAt: message.updated_at,
    attachments: (attachments || []).filter((attachment) => attachment.message_id === message.id).map((attachment) => ({
      id: attachment.id,
      name: attachment.filename,
      type: attachment.content_type,
      size: attachment.byte_size,
      path: attachment.storage_path,
      url: attachment.url || '',
    })),
  };
}

export class SupabaseRepository {
  constructor(client, user) {
    this.client = client;
    this.user = user;
    this.spaceId = null;
    this.messageChannel = null;
  }

  async load() {
    const { data: membership, error: membershipError } = await this.client
      .from('space_members')
      .select('space_id, role')
      .eq('user_id', this.user.id)
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return null;

    this.spaceId = membership.space_id;
    const [{ data: space, error: spaceError }, { data: members, error: membersError }, { data: profile, error: profileError }, { data: chats, error: chatsError }, { data: notes, error: notesError }, { data: workspaceLinks, error: workspaceLinksError }] = await Promise.all([
      this.client.from('spaces').select('id, name, owner_id').eq('id', this.spaceId).single(),
      this.client.from('space_members').select('user_id, role').eq('space_id', this.spaceId),
      this.client.from('profiles').select('id, display_name, avatar_color, notifications_enabled').eq('id', this.user.id).maybeSingle(),
      this.client.from('day_chats').select('id, date, created_at').eq('space_id', this.spaceId).order('date', { ascending: false }),
      this.client.from('note_blocks').select('id, owner_id, type, content, checked, position').eq('space_id', this.spaceId).eq('owner_id', this.user.id).order('position'),
      this.client.from('workspace_links').select('id, name, url, created_at').eq('owner_id', this.user.id).order('created_at', { ascending: false }),
    ]);
    if (spaceError || membersError || profileError || chatsError || notesError || workspaceLinksError) {
      throw spaceError || membersError || profileError || chatsError || notesError || workspaceLinksError;
    }

    const chatIds = (chats || []).map((chat) => chat.id);
    const messageQuery = chatIds.length
      ? this.client.from('messages').select('id, chat_id, author_id, body, reply_to_id, created_at, updated_at').in('chat_id', chatIds).order('created_at')
      : Promise.resolve({ data: [], error: null });
    const { data: messages, error: messageError } = await messageQuery;
    if (messageError) throw messageError;
    const messageIds = (messages || []).map((message) => message.id);
    const attachmentQuery = messageIds.length
      ? this.client.from('attachments').select('id, message_id, filename, content_type, byte_size, storage_path').in('message_id', messageIds)
      : Promise.resolve({ data: [], error: null });
    const { data: attachments, error: attachmentError } = await attachmentQuery;
    if (attachmentError) throw attachmentError;
    const hydratedAttachments = await Promise.all((attachments || []).map(async (attachment) => {
      const { data: signedUrl } = await this.client.storage.from('chat-files').createSignedUrl(attachment.storage_path, 3600);
      return { ...attachment, url: signedUrl?.signedUrl || '' };
    }));

    const memberIds = (members || []).map((member) => member.user_id).filter((id) => id !== this.user.id);
    const { data: partnerProfile } = memberIds.length
      ? await this.client.from('profiles').select('id, display_name, avatar_color').eq('id', memberIds[0]).maybeSingle()
      : { data: null };
    const messageAuthors = new Map([
      [this.user.id, mapProfile(profile, this.user)],
      ...(partnerProfile ? [[partnerProfile.id, {
        id: partnerProfile.id,
        displayName: partnerProfile.display_name || 'partner',
        avatarColor: partnerProfile.avatar_color || 'stone',
      }]] : []),
    ]);

    return {
      mode: 'supabase',
      space,
      profile: messageAuthors.get(this.user.id),
      partner: memberIds.length ? messageAuthors.get(memberIds[0]) : null,
      members,
      workspaceLinks: (workspaceLinks || []).map((link) => ({
        id: link.id,
        name: link.name,
        url: link.url,
        createdAt: link.created_at,
      })),
      chats: (chats || []).map((chat) => ({
        ...chat,
        date: String(chat.date),
        messages: (messages || []).filter((message) => message.chat_id === chat.id).map((message) => mapMessage(message, hydratedAttachments)),
      })),
      notes: notes || [],
    };
  }

  async createSpace(displayName) {
    const { data, error } = await this.client.rpc('create_space', {
      space_name: 'Nootion',
      display_name: displayName.trim(),
    });
    if (error) throw error;
    return data;
  }

  async claimInvite(token) {
    const hash = await hashToken(token);
    const { error } = await this.client.rpc('claim_invite', { invite_token_hash: hash });
    if (error) throw error;
    return this.load();
  }

  async createInvite() {
    if (!this.spaceId) throw new Error('Create your shared page first.');
    const token = `${createId('invite').replaceAll('-', '')}${Math.random().toString(36).slice(2, 8)}`;
    const tokenHash = await hashToken(token);
    const { error } = await this.client.rpc('create_invite', {
      target_space_id: this.spaceId,
      invite_token_hash: tokenHash,
    });
    if (error) throw error;
    return `${window.location.origin}/invite/${token}`;
  }

  async createChat() {
    const existingDates = (await this.load()).chats.map((chat) => chat.date);
    const nextChat = createNextChat(existingDates.map((date) => ({ date })), getTodayKey());
    const { error } = await this.client.from('day_chats').insert({
      space_id: this.spaceId,
      date: nextChat.date,
      created_by: this.user.id,
    });
    if (error) throw error;
    return this.load();
  }

  async sendMessage(chatId, payload) {
    const { data: message, error } = await this.client.from('messages').insert({
      chat_id: chatId,
      author_id: this.user.id,
      body: payload.body.trim(),
      reply_to_id: payload.replyToId || null,
    }).select('id').single();
    if (error) throw error;

    for (const file of payload.files || []) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '-');
      const storagePath = `${this.spaceId}/${message.id}/${createId('file')}-${safeName}`;
      const { error: uploadError } = await this.client.storage.from('chat-files').upload(storagePath, file, { upsert: false });
      if (uploadError) throw uploadError;
      const { error: attachmentError } = await this.client.from('attachments').insert({
        message_id: message.id,
        storage_path: storagePath,
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        byte_size: file.size,
      });
      if (attachmentError) throw attachmentError;
    }
    return this.load();
  }

  async editMessage(messageId, body) {
    const { error } = await this.client.from('messages').update({ body: body.trim(), updated_at: new Date().toISOString() }).eq('id', messageId).eq('author_id', this.user.id);
    if (error) throw error;
    return this.load();
  }

  async deleteMessage(messageId) {
    const { data: attachments, error: attachmentQueryError } = await this.client.from('attachments').select('storage_path').eq('message_id', messageId);
    if (attachmentQueryError) throw attachmentQueryError;
    if (attachments?.length) await this.client.storage.from('chat-files').remove(attachments.map((attachment) => attachment.storage_path));
    const { error } = await this.client.from('messages').delete().eq('id', messageId).eq('author_id', this.user.id);
    if (error) throw error;
    return this.load();
  }

  async updateProfile(changes) {
    const { error } = await this.client.from('profiles').upsert({
      id: this.user.id,
      display_name: changes.displayName,
      avatar_color: changes.avatarColor,
      notifications_enabled: changes.notificationsEnabled,
    });
    if (error) throw error;
    return this.load();
  }

  async addWorkspaceLink(input) {
    const link = normalizeWorkspaceLink(input);
    const { data: existing, error: existingError } = await this.client
      .from('workspace_links')
      .select('id')
      .eq('owner_id', this.user.id)
      .eq('url', link.url)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) throw new Error('That Notion workspace is already added.');

    const { error } = await this.client.from('workspace_links').insert({
      owner_id: this.user.id,
      name: link.name,
      url: link.url,
    });
    if (error) throw error;
    return this.load();
  }

  async removeWorkspaceLink(linkId) {
    const { error } = await this.client.from('workspace_links').delete().eq('id', linkId).eq('owner_id', this.user.id);
    if (error) throw error;
    return this.load();
  }

  async saveNotes(blocks) {
    const { error: deleteError } = await this.client.from('note_blocks').delete().eq('space_id', this.spaceId).eq('owner_id', this.user.id);
    if (deleteError) throw deleteError;
    const { error } = await this.client.from('note_blocks').insert(blocks.map((block, position) => ({
      ...(isUuid(block.id) ? { id: block.id } : {}),
      space_id: this.spaceId,
      owner_id: this.user.id,
      type: block.type,
      content: block.content,
      checked: Boolean(block.checked),
      position,
    })));
    if (error) throw error;
    return this.load();
  }

  subscribe(listener) {
    if (!this.spaceId) return () => {};
    this.messageChannel = this.client.channel(`nootion-messages-${this.spaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'day_chats' }, async () => listener(await this.load()))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, async () => listener(await this.load()))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attachments' }, async () => listener(await this.load()))
      .subscribe();
    return () => {
      if (this.messageChannel) this.client.removeChannel(this.messageChannel);
    };
  }
}

async function hashToken(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function getDefaultStateForPreview() {
  return clone(makeDefaultState());
}
