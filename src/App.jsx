import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  AtSign,
  Bell,
  BookOpen,
  Check,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  CircleUserRound,
  Clipboard,
  ExternalLink,
  File,
  FileText,
  Hash,
  Image as ImageIcon,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Plus,
  Reply,
  Send,
  Settings2,
  Share2,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from './lib/supabase.js';
import { LocalRepository, SupabaseRepository } from './lib/repository.js';
import { getTodayKey, insertNoteBlock } from './lib/workspace.js';

const AVATAR_COLORS = {
  coral: '#f29a77',
  stone: '#777f78',
  blue: '#7da9ef',
  mint: '#98d3ba',
};

const BLOCK_TYPES = [
  { value: 'paragraph', label: 'Text' },
  { value: 'heading', label: 'Heading' },
  { value: 'bullet', label: 'Bullet' },
  { value: 'todo', label: 'To-do' },
];

function getInviteTokenFromPath() {
  const match = window.location.pathname.match(/^\/invite\/([^/]+)/);
  if (match) return decodeURIComponent(match[1]);
  try {
    return localStorage.getItem('nootion-pending-invite');
  } catch {
    return null;
  }
}

function makeLocalId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function initials(name = '?') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function formatDate(value, options = {}) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(new Date(`${value}T12:00:00`));
}

function formatChatLabel(value, today = getTodayKey()) {
  if (value === today) return 'Today';
  return formatDate(value);
}

function formatFileSize(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAuthor(message, workspace) {
  if (message.authorId === workspace.profile.id) return workspace.profile;
  return workspace.partner || { id: message.authorId, displayName: 'partner', avatarColor: 'stone' };
}

function getSortedChats(chats = []) {
  return [...chats].sort((a, b) => b.date.localeCompare(a.date));
}

function getErrorMessage(error) {
  return error?.message || 'Something went wrong. Try that again.';
}

export default function App() {
  const [repository, setRepository] = useState(null);
  const [workspace, setWorkspace] = useState(undefined);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [view, setView] = useState('home');
  const [activeChatId, setActiveChatId] = useState(null);
  const [pendingInvite, setPendingInvite] = useState(getInviteTokenFromPath());
  const [showArchive, setShowArchive] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showWorkspaceLink, setShowWorkspaceLink] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const previousWorkspaceRef = useRef(null);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      const localRepository = new LocalRepository();
      setRepository(localRepository);
      localRepository.load().then((data) => {
        setWorkspace(data);
        setActiveChatId(getSortedChats(data.chats)[0]?.id || null);
      });
      return undefined;
    }

    let mounted = true;
    const loadUser = async (user, inviteToken = pendingInvite) => {
      if (!user || !mounted) return;
      setAuthLoading(true);
      setError(null);
      const remoteRepository = new SupabaseRepository(supabase, user);
      try {
        if (inviteToken) {
          await remoteRepository.claimInvite(inviteToken);
          localStorage.removeItem('nootion-pending-invite');
          setPendingInvite(null);
          window.history.replaceState({}, '', '/');
        }
        const data = await remoteRepository.load();
        if (!mounted) return;
        setRepository(remoteRepository);
        setWorkspace(data);
        setActiveChatId(data ? getSortedChats(data.chats)[0]?.id || null : null);
      } catch (loadError) {
        if (mounted) setError(getErrorMessage(loadError));
      } finally {
        if (mounted) setAuthLoading(false);
      }
    };

    const initialize = async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) setError(getErrorMessage(sessionError));
      setSession(data.session);
      if (data.session?.user) await loadUser(data.session.user);
      else setAuthLoading(false);
    };

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (nextSession?.user) loadUser(nextSession.user);
      else {
        setRepository(null);
        setWorkspace(null);
        setAuthLoading(false);
      }
    });
    initialize();

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!repository || !workspace || workspace.mode === 'local-preview') return undefined;
    return repository.subscribe((nextWorkspace) => {
      const previousMessageIds = new Set((previousWorkspaceRef.current?.chats || []).flatMap((chat) => chat.messages.map((message) => message.id)));
      const incomingMessages = nextWorkspace.chats.flatMap((chat) => chat.messages).filter((message) => !previousMessageIds.has(message.id) && message.authorId !== nextWorkspace.profile.id);
      if (incomingMessages.length && view !== 'page') {
        setUnreadCount((count) => count + incomingMessages.length);
        if (nextWorkspace.profile.notificationsEnabled && document.hidden && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const newestMessage = incomingMessages.at(-1);
          new Notification(`New message from ${nextWorkspace.partner?.displayName || 'your partner'}`, { body: newestMessage.body || 'Sent an attachment' });
        }
      }
      previousWorkspaceRef.current = nextWorkspace;
      setWorkspace(nextWorkspace);
    });
  }, [repository, workspace?.space?.id, view]);

  useEffect(() => {
    if (workspace) previousWorkspaceRef.current = workspace;
  }, [workspace]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const runAction = async (action, successMessage = null) => {
    setError(null);
    try {
      const result = await action();
      if (result?.space) {
        setWorkspace(result);
        setActiveChatId((currentId) => currentId || getSortedChats(result.chats)[0]?.id || null);
      }
      if (successMessage) setToast(successMessage);
      return result;
    } catch (actionError) {
      setError(getErrorMessage(actionError));
      return null;
    }
  };

  const handleCreateSpace = async (displayName) => {
    const created = await runAction(() => repository.createSpace(displayName));
    if (!created) return;
    const nextWorkspace = await repository.load();
    setWorkspace(nextWorkspace);
    setActiveChatId(getSortedChats(nextWorkspace.chats)[0]?.id || null);
  };

  const handleOpenChat = (chatId) => {
    setActiveChatId(chatId);
    setUnreadCount(0);
    setView('page');
    setShowArchive(false);
  };

  const handleNewChat = async () => {
    const nextWorkspace = await runAction(() => repository.createChat(), 'New day opened');
    if (!nextWorkspace) return;
    setActiveChatId(getSortedChats(nextWorkspace.chats)[0]?.id || null);
    setView('page');
  };

  const handleSend = async (chatId, payload) => {
    const nextWorkspace = await runAction(() => repository.sendMessage(chatId, payload));
    return Boolean(nextWorkspace);
  };

  const handleEdit = async (messageId, body) => {
    await runAction(() => repository.editMessage(messageId, body), 'Message edited');
  };

  const handleDelete = async (messageId) => {
    await runAction(() => repository.deleteMessage(messageId), 'Message deleted');
  };

  const handleSaveNotes = async (blocks) => {
    await runAction(() => repository.saveNotes(blocks));
  };

  const handleSaveProfile = async (changes) => {
    const nextWorkspace = await runAction(() => repository.updateProfile(changes), 'Profile updated');
    if (nextWorkspace) setShowProfile(false);
  };

  const handleAddWorkspaceLink = async (input) => {
    const nextWorkspace = await runAction(() => repository.addWorkspaceLink(input), 'Workspace added');
    if (nextWorkspace) {
      setShowWorkspaceLink(false);
      return true;
    }
    return false;
  };

  const handleRemoveWorkspaceLink = async (linkId) => {
    await runAction(() => repository.removeWorkspaceLink(linkId), 'Workspace removed');
  };

  const handleCreateInvite = async () => repository.createInvite();

  const handleSignOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setShowProfile(false);
  };

  if (authLoading || workspace === undefined) return <LoadingScreen />;
  if (isSupabaseConfigured && !session) {
    return <SignInScreen pendingInvite={pendingInvite} error={error} />;
  }
  if (isSupabaseConfigured && !workspace) {
    return <SetupScreen pendingInvite={pendingInvite} onCreateSpace={handleCreateSpace} error={error} />;
  }
  if (!repository || !workspace) return <LoadingScreen />;

  const activeChat = workspace.chats.find((chat) => chat.id === activeChatId) || getSortedChats(workspace.chats)[0];

  return (
    <div className="app-shell">
      <TopBar
        view={view}
        activeChat={activeChat}
        profile={workspace.profile}
        partner={workspace.partner}
        onHome={() => setView('home')}
        onDiscussion={() => { setUnreadCount(0); setView('page'); }}
        onShare={() => setShowShare(true)}
        onProfile={() => setShowProfile(true)}
        unreadCount={unreadCount}
        workspaceLinks={workspace.workspaceLinks}
        onAddWorkspace={() => setShowWorkspaceLink(true)}
        onRemoveWorkspace={handleRemoveWorkspaceLink}
      />
      <main className="app-main">
        {view === 'home' ? (
          <HomeScreen
            workspace={workspace}
            onOpenPage={() => {
              setActiveChatId(getSortedChats(workspace.chats)[0]?.id || null);
              setView('page');
            }}
            onOpenArchive={() => setShowArchive(true)}
          />
        ) : (
          <PageView
            workspace={workspace}
            activeChat={activeChat}
            onOpenArchive={() => setShowArchive(true)}
            onNewChat={handleNewChat}
            onSend={handleSend}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onSaveNotes={handleSaveNotes}
          />
        )}
      </main>

      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-button quiet" aria-label="Dismiss error" title="Dismiss" onClick={() => setError(null)}><X size={16} /></button>
        </div>
      )}
      {toast && <div className="success-toast" role="status"><Check size={15} /> {toast}</div>}

      {showArchive && (
        <ArchiveModal
          chats={workspace.chats}
          activeChatId={activeChat?.id}
          onClose={() => setShowArchive(false)}
          onSelect={handleOpenChat}
        />
      )}
      {showShare && (
        <ShareModal onClose={() => setShowShare(false)} onCreateInvite={handleCreateInvite} />
      )}
      {showProfile && (
        <ProfileModal
          profile={workspace.profile}
          onClose={() => setShowProfile(false)}
          onSave={handleSaveProfile}
          onSignOut={isSupabaseConfigured ? handleSignOut : null}
        />
      )}
      {showWorkspaceLink && (
        <WorkspaceLinkModal onClose={() => setShowWorkspaceLink(false)} onSave={handleAddWorkspaceLink} />
      )}
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="brand-mark">n</div>
      <span>opening Nootion</span>
    </div>
  );
}

function SignInScreen({ pendingInvite, error: externalError }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(externalError);
  const [isSending, setIsSending] = useState(false);

  useEffect(() => setError(externalError), [externalError]);

  const submit = async (event) => {
    event.preventDefault();
    if (!email.trim()) {
      setError('Enter your email address.');
      return;
    }
    setIsSending(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setIsSending(false);
    if (signInError) setError(getErrorMessage(signInError));
    else {
      if (pendingInvite) localStorage.setItem('nootion-pending-invite', pendingInvite);
      setSent(true);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-panel">
        <div className="auth-brand"><span className="brand-mark">n</span><span>Nootion</span></div>
        <span className="eyebrow">a quiet shared page</span>
        <h1>Sign in with a one-time link.</h1>
        <p className="auth-copy">No password to remember. Enter your email and we’ll send a link that brings you back to your page.</p>
        {pendingInvite && <div className="invite-note"><Link2 size={15} /> You’re joining an invited Nootion page.</div>}
        {sent ? (
          <div className="sent-state">
            <div className="sent-icon"><Check size={18} /></div>
            <strong>Check your inbox.</strong>
            <span>The sign-in link is on its way to {email.trim()}.</span>
            <button type="button" className="text-button" onClick={() => setSent(false)}>Use a different email</button>
          </div>
        ) : (
          <form className="auth-form" onSubmit={submit}>
            <label htmlFor="email">Email address</label>
            <input id="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" autoFocus />
            <button type="submit" className="primary-button wide" disabled={isSending}>{isSending ? 'Sending link...' : 'Send one-time link'} <ArrowUpRight size={16} /></button>
            {error && <p className="form-error">{error}</p>}
          </form>
        )}
        <span className="auth-footer"><LockKeyhole size={13} /> private by invitation</span>
      </div>
    </div>
  );
}

function SetupScreen({ pendingInvite, onCreateSpace, error }) {
  const [displayName, setDisplayName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!displayName.trim()) return;
    setIsCreating(true);
    await onCreateSpace(displayName);
    setIsCreating(false);
  };

  return (
    <div className="setup-screen">
      <div className="setup-panel">
        <div className="brand-mark large">n</div>
        <span className="eyebrow">{pendingInvite ? 'you were invited' : 'your private page'}</span>
        <h1>{pendingInvite ? 'Join Nootion.' : 'Make your Nootion page.'}</h1>
        <p>{pendingInvite ? 'Choose the name that should appear beside your messages.' : 'Give yourself a name before you open the shared page.'}</p>
        <form onSubmit={submit}>
          <label htmlFor="display-name">Your name</label>
          <input id="display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="What should they call you?" autoFocus />
          <button className="primary-button wide" type="submit" disabled={isCreating || !displayName.trim()}>{isCreating ? 'Opening page...' : pendingInvite ? 'Join shared page' : 'Create Nootion'} <ArrowUpRight size={16} /></button>
        </form>
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}

function TopBar({ view, activeChat, profile, partner, onHome, onDiscussion, onShare, onProfile, unreadCount, workspaceLinks = [], onAddWorkspace, onRemoveWorkspace }) {
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspaceSwitcherRef = useRef(null);

  useEffect(() => {
    if (!workspaceMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!workspaceSwitcherRef.current?.contains(event.target)) setWorkspaceMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setWorkspaceMenuOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [workspaceMenuOpen]);

  return (
    <header className="top-bar">
      <div className="top-left">
        <button type="button" className="icon-button top-menu" aria-label="Open home" title="Home" onClick={onHome}><Menu size={18} /></button>
        <div className="workspace-switcher" ref={workspaceSwitcherRef}>
          <button type="button" className="breadcrumb-button" aria-haspopup="menu" aria-expanded={workspaceMenuOpen} onClick={() => setWorkspaceMenuOpen((isOpen) => !isOpen)}>
            <span className="crumb-muted">Nootion</span>
            <ChevronDown size={14} />
            <span>{view === 'home' ? 'home' : 'New page'}</span>
            {view === 'page' && activeChat && <><ChevronRight size={14} /><span>{formatChatLabel(activeChat.date)}</span></>}
          </button>
          {workspaceMenuOpen && (
            <div className="workspace-menu" role="menu" aria-label="Workspaces">
              <div className="workspace-menu-heading">your workspaces</div>
              <button type="button" className="workspace-menu-item selected" role="menuitem" onClick={() => { onHome(); setWorkspaceMenuOpen(false); }}>
                <span className="workspace-menu-icon nootion-menu-icon">n</span>
                <span className="workspace-menu-copy"><strong>Nootion</strong><small>private shared page</small></span>
                <Check size={15} />
              </button>
              {workspaceLinks.map((link) => (
                <div className="workspace-link-row" key={link.id}>
                  <a className="workspace-menu-item workspace-link-item" role="menuitem" href={link.url} title={link.url} onClick={() => setWorkspaceMenuOpen(false)}>
                    <span className="workspace-menu-icon"><Link2 size={15} /></span>
                    <span className="workspace-menu-copy"><strong>{link.name}</strong><small>Notion page</small></span>
                    <ExternalLink size={14} />
                  </a>
                  <button type="button" className="workspace-remove" aria-label={`Remove ${link.name}`} title="Remove workspace" onClick={(event) => { event.stopPropagation(); onRemoveWorkspace(link.id); }}><X size={13} /></button>
                </div>
              ))}
              <div className="workspace-menu-divider" />
              <button type="button" className="workspace-menu-add" role="menuitem" onClick={() => { setWorkspaceMenuOpen(false); onAddWorkspace(); }}><Plus size={15} /> Add workspace</button>
            </div>
          )}
        </div>
      </div>
      <div className="top-right">
        {partner && <div className="partner-stack" title={`${partner.displayName} is part of this page`}><Avatar user={partner} size="small" /></div>}
        <button type="button" className="top-action" onClick={onShare}><Share2 size={15} /> Share</button>
        <button type="button" className="icon-button quiet icon-with-badge" aria-label="Open discussion" title="Discussion" onClick={onDiscussion}><MessageCircle size={18} />{unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}</button>
        <button type="button" className="icon-button quiet" aria-label="Favorite page" title="Favorite"><Star size={18} /></button>
        <button type="button" className="profile-button" aria-label="Open profile" title="Profile" onClick={onProfile}><Avatar user={profile} /></button>
      </div>
    </header>
  );
}

function Avatar({ user, size = 'regular' }) {
  return (
    <span className={`avatar avatar-${size}`} style={{ '--avatar-color': AVATAR_COLORS[user?.avatarColor] || AVATAR_COLORS.stone }} aria-hidden="true">
      {initials(user?.displayName || '?')}
    </span>
  );
}

function HomeScreen({ workspace, onOpenPage, onOpenArchive }) {
  const chats = getSortedChats(workspace.chats);
  const latest = chats[0];

  return (
    <div className="content-shell home-shell">
      <div className="home-heading">
        <div>
          <span className="eyebrow">private space</span>
          <h1>Nootion</h1>
          <p>One page for the things that belong between you two.</p>
        </div>
        <div className="home-heading-mark"><BookOpen size={23} strokeWidth={1.5} /></div>
      </div>

      <section className="space-row">
        <div className="space-row-icon"><FileText size={20} /></div>
        <div className="space-row-copy"><strong>New page</strong><span>Shared page · {latest ? `${latest.messages.length} messages today` : 'ready for today'}</span></div>
        <span className="space-row-status"><span className="status-dot" /> active</span>
        <button type="button" className="primary-button compact" onClick={onOpenPage}>Open page <ArrowUpRight size={15} /></button>
      </section>

      <div className="home-grid">
        <section className="home-section">
          <div className="section-heading"><div><span className="section-kicker">recent days</span><h2>Your archive</h2></div><button type="button" className="text-button" onClick={onOpenArchive}>View all <ArrowUpRight size={14} /></button></div>
          <div className="archive-list compact-list">
            {chats.slice(0, 4).map((chat, index) => (
              <button type="button" className="archive-row" key={chat.id} onClick={() => { onOpenArchive(); }}>
                <span className={`archive-marker ${index === 0 ? 'active' : ''}`}><Hash size={14} /></span>
                <span className="archive-row-copy"><strong>{formatChatLabel(chat.date)}</strong><span>{chat.messages.length ? `${chat.messages.length} ${chat.messages.length === 1 ? 'message' : 'messages'}` : 'No messages yet'}</span></span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </section>

        <section className="home-section private-preview">
          <div className="section-heading"><div><span className="section-kicker">your side</span><h2>Private notes</h2></div><LockKeyhole size={15} /></div>
          <p>Only your notes appear here. They stay separate from the shared discussion.</p>
          <div className="private-preview-line"><span /><span /><span className="short" /></div>
          <button type="button" className="subtle-button" onClick={onOpenPage}>Edit notes <Pencil size={14} /></button>
        </section>
      </div>
    </div>
  );
}

function PageView({ workspace, activeChat, onOpenArchive, onNewChat, onSend, onEdit, onDelete, onSaveNotes }) {
  const [replyingTo, setReplyingTo] = useState(null);
  const [composerKey, setComposerKey] = useState(0);
  const messages = activeChat?.messages || [];
  const messageLookup = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);

  useEffect(() => {
    setReplyingTo(null);
    setComposerKey((key) => key + 1);
  }, [activeChat?.id]);

  const handleReply = (message) => {
    setReplyingTo(message);
    window.requestAnimationFrame(() => document.getElementById('message-composer')?.focus());
  };

  return (
    <div className="content-shell page-shell">
      <div className="page-intro">
        <div className="page-icon"><FileText size={27} strokeWidth={1.6} /></div>
        <div className="page-title-wrap"><span className="page-label">shared page</span><h1>New page</h1><span className="page-updated">Edited just now</span></div>
      </div>

      <section className="discussion-section">
        <div className="discussion-heading">
          <div><span className="section-kicker">discussion</span><h2>{activeChat ? formatChatLabel(activeChat.date) : 'No day yet'}</h2></div>
          <div className="discussion-actions">
            <button type="button" className="subtle-button" onClick={onOpenArchive}><Archive size={15} /> Archive</button>
            <button type="button" className="primary-button compact" onClick={onNewChat}><Plus size={15} /> New day</button>
          </div>
        </div>

        <div className="discussion-rule"><span>{activeChat?.date ? formatDate(activeChat.date, { year: 'numeric' }) : 'start here'}</span></div>

        {messages.length ? (
          <div className="message-list">
            {messages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                author={getAuthor(message, workspace)}
                currentUser={workspace.profile}
                replyTarget={message.replyToId ? messageLookup.get(message.replyToId) : null}
                messageLookup={messageLookup}
                onReply={handleReply}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </div>
        ) : (
          <div className="empty-chat"><MessageCircle size={24} /><strong>Nothing here yet.</strong><span>Start the conversation for {activeChat ? formatChatLabel(activeChat.date).toLowerCase() : 'today'}.</span></div>
        )}

        {activeChat && <Composer key={composerKey} activeChat={activeChat} replyingTo={replyingTo} onClearReply={() => setReplyingTo(null)} onSend={onSend} />}
      </section>

      <PrivateNotes blocks={workspace.notes} ownerId={workspace.profile.id} onSave={onSaveNotes} />
    </div>
  );
}

function MessageRow({ message, author, currentUser, replyTarget, messageLookup, onReply, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.body);
  const [menuOpen, setMenuOpen] = useState(false);
  const ownMessage = message.authorId === currentUser.id;

  useEffect(() => setEditValue(message.body), [message.body]);

  const saveEdit = async () => {
    if (!editValue.trim()) return;
    await onEdit(message.id, editValue);
    setEditing(false);
  };

  return (
    <article className={`message-row ${ownMessage ? 'is-own' : ''}`} id={`message-${message.id}`}>
      <Avatar user={author} />
      <div className="message-column">
        <div className="message-meta"><strong>{author.displayName}</strong><time>{formatTime(message.createdAt)}</time>{message.editedAt && <span>edited</span>}</div>
        {editing ? (
          <div className="edit-box">
            <textarea value={editValue} onChange={(event) => setEditValue(event.target.value)} autoFocus rows={3} />
            <div className="edit-actions"><button type="button" className="text-button" onClick={() => { setEditing(false); setEditValue(message.body); }}>Cancel</button><button type="button" className="primary-button compact" onClick={saveEdit}>Save</button></div>
          </div>
        ) : (
          <div className="message-content">
            {replyTarget && <button type="button" className="quoted-message" onClick={() => document.getElementById(`message-${replyTarget.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}><span>replying to {getAuthor(replyTarget, { profile: currentUser, partner: author }).displayName}</span><p>{replyTarget.body || 'Attachment'}</p></button>}
            {message.body && <div className="message-text">{message.body.split('\n').map((line, index) => <span key={`${message.id}-${index}`}>{line}{index < message.body.split('\n').length - 1 && <br />}</span>)}</div>}
            {message.attachments?.length > 0 && <AttachmentList attachments={message.attachments} />}
          </div>
        )}
        <div className="message-actions">
          <button type="button" className="message-action" title="Reply" aria-label="Reply" onClick={() => onReply(message)}><Reply size={14} /></button>
          {ownMessage && <>
            <button type="button" className="message-action" title="Edit" aria-label="Edit" onClick={() => setEditing(true)}><Pencil size={13} /></button>
            <div className="message-menu-wrap">
              <button type="button" className="message-action" title="More" aria-label="More" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal size={14} /></button>
              {menuOpen && <div className="message-menu"><button type="button" onClick={() => { setMenuOpen(false); onDelete(message.id); }}><Trash2 size={13} /> Delete</button></div>}
            </div>
          </>}
        </div>
      </div>
    </article>
  );
}

function AttachmentList({ attachments }) {
  return (
    <div className="attachment-list">
      {attachments.map((attachment) => {
        const isImage = attachment.type?.startsWith('image/');
        return isImage && attachment.url ? (
          <a className="image-attachment" href={attachment.url} target="_blank" rel="noreferrer" key={attachment.id}>
            <img src={attachment.url} alt={attachment.name} />
            <span>{attachment.name}</span>
          </a>
        ) : (
          <a className="file-attachment" href={attachment.url || '#'} download={attachment.name} key={attachment.id} onClick={(event) => { if (!attachment.url) event.preventDefault(); }}>
            <span className="file-attachment-icon">{isImage ? <ImageIcon size={16} /> : <File size={16} />}</span>
            <span className="file-attachment-copy"><strong>{attachment.name}</strong><small>{formatFileSize(attachment.size)}</small></span>
            <ArrowUpRight size={14} />
          </a>
        );
      })}
    </div>
  );
}

function Composer({ activeChat, replyingTo, onClearReply, onSend }) {
  const [body, setBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => () => pendingFiles.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl)), [pendingFiles]);

  const addFiles = (fileList) => {
    const nextFiles = Array.from(fileList || []).map((file) => ({ file, previewUrl: URL.createObjectURL(file) }));
    setPendingFiles((current) => [...current, ...nextFiles]);
  };

  const removeFile = (index) => {
    setPendingFiles((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((_file, fileIndex) => fileIndex !== index);
    });
  };

  const submit = async () => {
    if ((!body.trim() && !pendingFiles.length) || isSending) return;
    setIsSending(true);
    const sent = await onSend(activeChat.id, { body, replyToId: replyingTo?.id || null, files: pendingFiles.map(({ file }) => file) });
    setIsSending(false);
    if (!sent) return;
    pendingFiles.forEach(({ previewUrl }) => URL.revokeObjectURL(previewUrl));
    setPendingFiles([]);
    setBody('');
    onClearReply();
  };

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  const onPaste = (event) => {
    if (event.clipboardData.files?.length) addFiles(event.clipboardData.files);
  };

  return (
    <div className={`composer-wrap ${isDragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={(event) => { event.preventDefault(); setIsDragging(false); addFiles(event.dataTransfer.files); }}>
      {replyingTo && <div className="replying-bar"><Reply size={14} /><span>Replying to <strong>{replyingTo.body || 'attachment'}</strong></span><button type="button" className="icon-button quiet" aria-label="Cancel reply" title="Cancel reply" onClick={onClearReply}><X size={15} /></button></div>}
      {pendingFiles.length > 0 && <div className="pending-files">{pendingFiles.map(({ file, previewUrl }, index) => <div className="pending-file" key={`${file.name}-${index}`}>{file.type.startsWith('image/') ? <img src={previewUrl} alt="" /> : <File size={16} />}<span>{file.name}</span><button type="button" className="icon-button quiet" aria-label={`Remove ${file.name}`} title="Remove file" onClick={() => removeFile(index)}><X size={13} /></button></div>)}</div>}
      <div className="composer">
        <button type="button" className="composer-icon" aria-label="Attach files" title="Attach files" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /></button>
        <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }} />
        <textarea id="message-composer" value={body} onChange={(event) => setBody(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste} placeholder={`Message ${formatChatLabel(activeChat.date).toLowerCase()}...`} rows={1} aria-label="Message" />
        <button type="button" className="send-button" aria-label="Send message" title="Send message" disabled={(!body.trim() && !pendingFiles.length) || isSending} onClick={submit}><Send size={16} /></button>
      </div>
      <span className="composer-hint">Enter to send · Shift + Enter for a new line</span>
    </div>
  );
}

function PrivateNotes({ blocks, ownerId, onSave }) {
  const [draftBlocks, setDraftBlocks] = useState(blocks || []);
  const [saving, setSaving] = useState(false);
  const [expandedCommentIds, setExpandedCommentIds] = useState(() => new Set());

  useEffect(() => setDraftBlocks(blocks || []), [blocks]);

  const persist = async (nextBlocks) => {
    setDraftBlocks(nextBlocks);
    setSaving(true);
    await onSave(nextBlocks);
    setSaving(false);
  };

  const updateBlock = (blockId, changes) => {
    const nextBlocks = draftBlocks.map((block) => block.id === blockId ? { ...block, ...changes } : block);
    setDraftBlocks(nextBlocks);
    return nextBlocks;
  };

  const addBlock = async (position, type = 'paragraph') => {
    const block = { id: makeLocalId(type === 'comment' ? 'comment' : 'note'), ownerId, type, content: '', checked: false, position };
    const nextBlocks = insertNoteBlock(draftBlocks, block, position);
    if (type === 'comment') setExpandedCommentIds((current) => new Set([...current, block.id]));
    await persist(nextBlocks);
  };

  const removeBlock = async (blockId) => {
    setExpandedCommentIds((current) => {
      const next = new Set(current);
      next.delete(blockId);
      return next;
    });
    await persist(draftBlocks.filter((block) => block.id !== blockId));
  };

  const saveBlock = async (blockId, changes) => {
    await persist(updateBlock(blockId, changes));
  };

  const toggleComment = (blockId) => {
    setExpandedCommentIds((current) => {
      const next = new Set(current);
      if (next.has(blockId)) next.delete(blockId);
      else next.add(blockId);
      return next;
    });
  };

  return (
    <section className="notes-section">
      <div className="notes-heading"><div><span className="section-kicker">your side</span><h2>Private notes</h2></div><div className="notes-status"><LockKeyhole size={13} /> only you {saving && <span>· saving</span>}</div></div>
      <div className="notes-editor">
        <InlineInsertControl position={0} onAddNote={() => addBlock(0)} onAddComment={() => addBlock(0, 'comment')} />
        {draftBlocks.map((block, index) => (
          <Fragment key={block.id}>
            {block.type === 'comment' ? (
              <PrivateCommentBlock
                block={block}
                expanded={expandedCommentIds.has(block.id)}
                onToggle={() => toggleComment(block.id)}
                onSave={saveBlock}
                onDelete={removeBlock}
              />
            ) : (
              <div className={`note-block note-${block.type}`}>
                <button type="button" className="block-grip" title="Block options" aria-label="Block options"><MoreHorizontal size={15} /></button>
                {block.type === 'todo' && <input type="checkbox" checked={Boolean(block.checked)} aria-label="Mark note complete" onChange={(event) => { const next = updateBlock(block.id, { checked: event.target.checked }); persist(next); }} />}
                {block.type === 'bullet' && <span className="bullet-dot">•</span>}
                {block.type === 'heading' ? <input className="note-input heading-input" value={block.content} onChange={(event) => updateBlock(block.id, { content: event.target.value })} onBlur={() => persist(draftBlocks)} placeholder="Heading" /> : <textarea className={`note-input ${block.checked ? 'is-checked' : ''}`} value={block.content} onChange={(event) => updateBlock(block.id, { content: event.target.value })} onBlur={() => persist(draftBlocks)} placeholder={block.type === 'todo' ? 'A small thing to remember...' : 'Write something...'} rows={1} />}
                <select className="block-type" aria-label="Note block type" value={block.type} onChange={(event) => { const next = updateBlock(block.id, { type: event.target.value }); persist(next); }}>
                  {BLOCK_TYPES.map((type) => <option value={type.value} key={type.value}>{type.label}</option>)}
                </select>
                <button type="button" className="block-delete" title="Delete block" aria-label="Delete block" onClick={() => removeBlock(block.id)}><Trash2 size={13} /></button>
              </div>
            )}
            <InlineInsertControl position={index + 1} onAddNote={() => addBlock(index + 1)} onAddComment={() => addBlock(index + 1, 'comment')} />
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function InlineInsertControl({ position, onAddNote, onAddComment }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className={`inline-insert ${menuOpen ? 'is-open' : ''}`}>
      <button type="button" className="inline-insert-trigger" aria-label="Add something here" title="Add something here" onClick={() => setMenuOpen((open) => !open)}><Plus size={13} /></button>
      {menuOpen && <div className="inline-insert-menu" role="menu" aria-label={`Insert at position ${position}`}>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onAddNote(); }}><FileText size={13} /> Note</button>
        <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onAddComment(); }}><LockKeyhole size={13} /> Sneaky comment</button>
      </div>}
    </div>
  );
}

function PrivateCommentBlock({ block, expanded, onToggle, onSave, onDelete }) {
  const [value, setValue] = useState(block.content || '');

  useEffect(() => setValue(block.content || ''), [block.content]);

  const save = async () => {
    if (value !== block.content) await onSave(block.id, { content: value });
  };

  return (
    <div className={`private-comment ${expanded ? 'is-expanded' : ''}`}>
      <button type="button" className="private-comment-marker" aria-expanded={expanded} onClick={onToggle}>
        <LockKeyhole size={13} />
        <span>{value.trim() ? 'private comment' : 'empty private comment'}</span>
      </button>
      {expanded && <div className="private-comment-body">
        <textarea value={value} onChange={(event) => setValue(event.target.value)} onBlur={save} placeholder="Only you can see this..." rows={2} autoFocus={!value} />
        <div className="private-comment-actions"><span>only you</span><button type="button" className="block-delete" title="Delete private comment" aria-label="Delete private comment" onClick={() => onDelete(block.id)}><Trash2 size={13} /></button></div>
      </div>}
    </div>
  );
}

function ArchiveModal({ chats, activeChatId, onClose, onSelect }) {
  const sortedChats = getSortedChats(chats);
  return (
    <Modal title="Archive" eyebrow="past discussions" onClose={onClose}>
      <div className="archive-modal-list">
        {sortedChats.map((chat) => (
          <button type="button" className={`archive-modal-row ${chat.id === activeChatId ? 'selected' : ''}`} key={chat.id} onClick={() => onSelect(chat.id)}>
            <span className="archive-modal-date"><Hash size={15} /><strong>{formatChatLabel(chat.date)}</strong></span>
            <span className="archive-modal-meta">{formatDate(chat.date, { weekday: 'short', year: 'numeric' })} · {chat.messages.length} {chat.messages.length === 1 ? 'message' : 'messages'}</span>
            {chat.id === activeChatId ? <Check size={15} /> : <ChevronRight size={15} />}
          </button>
        ))}
      </div>
    </Modal>
  );
}

function ShareModal({ onClose, onCreateInvite }) {
  const [inviteLink, setInviteLink] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const createInvite = async () => {
    setIsCreating(true);
    try {
      setInviteLink(await onCreateInvite());
    } catch {
      setInviteLink('');
    } finally {
      setIsCreating(false);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard?.writeText(inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Modal title="Invite someone" eyebrow="one shared page" onClose={onClose}>
      <div className="share-modal-copy"><div className="share-icon"><Link2 size={18} /></div><p>Make one private link for the other person. It can only be claimed once.</p></div>
      {inviteLink ? <div className="invite-link-box"><span>{inviteLink}</span><button type="button" className="primary-button compact" onClick={copyLink}>{copied ? <Check size={14} /> : <Clipboard size={14} />} {copied ? 'Copied' : 'Copy link'}</button></div> : <button type="button" className="primary-button wide" onClick={createInvite} disabled={isCreating}>{isCreating ? 'Making link...' : 'Make one-time link'} <ArrowUpRight size={15} /></button>}
      <span className="modal-footnote"><LockKeyhole size={13} /> Only two people can belong to this page.</span>
    </Modal>
  );
}

function WorkspaceLinkModal({ onClose, onSave }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!url.trim()) return;
    setIsSaving(true);
    await onSave({ name, url });
    setIsSaving(false);
  };

  return (
    <Modal title="Add workspace" eyebrow="your Notion pages" onClose={onClose}>
      <div className="share-modal-copy"><div className="share-icon"><Link2 size={18} /></div><p>Save a Notion page here so it is one click away from your Nootion menu.</p></div>
      <form className="workspace-link-form" onSubmit={submit}>
        <label htmlFor="workspace-link-name">Workspace name</label>
        <input id="workspace-link-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Cyn's space" autoFocus />
        <label htmlFor="workspace-link-url">Notion link</label>
        <input id="workspace-link-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.notion.so/..." required />
        <div className="modal-actions"><button type="button" className="subtle-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button compact" disabled={isSaving || !url.trim()}>{isSaving ? 'Adding...' : 'Add workspace'} <ExternalLink size={14} /></button></div>
      </form>
      <span className="modal-footnote"><ExternalLink size={13} /> Opens the real Notion page in a new tab.</span>
    </Modal>
  );
}

function ProfileModal({ profile, onClose, onSave, onSignOut }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [avatarColor, setAvatarColor] = useState(profile.avatarColor);
  const [notificationsEnabled, setNotificationsEnabled] = useState(profile.notificationsEnabled);
  const [notificationError, setNotificationError] = useState('');

  const toggleNotifications = async () => {
    if (!('Notification' in window)) {
      setNotificationError('This browser does not support notifications.');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      setNotificationsEnabled(true);
      setNotificationError('');
    } else {
      setNotificationError('Notifications are blocked in this browser.');
    }
  };

  return (
    <Modal title="Your profile" eyebrow="account settings" onClose={onClose}>
      <div className="profile-preview"><Avatar user={{ displayName, avatarColor }} size="large" /><div><strong>{displayName || 'your name'}</strong><span>{profile.email}</span></div></div>
      <label htmlFor="profile-name">Name</label>
      <input id="profile-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      <div className="profile-field-label">Avatar color</div>
      <div className="color-options">{Object.entries(AVATAR_COLORS).map(([name, color]) => <button type="button" className={`color-option ${avatarColor === name ? 'selected' : ''}`} style={{ '--swatch-color': color }} aria-label={`${name} avatar color`} title={name} key={name} onClick={() => setAvatarColor(name)}><span /></button>)}</div>
      <div className="setting-row"><div><strong>Desktop notifications</strong><span>Get a quiet alert for new messages.</span></div><button type="button" className={`toggle ${notificationsEnabled ? 'on' : ''}`} aria-label="Toggle desktop notifications" aria-pressed={notificationsEnabled} onClick={() => notificationsEnabled ? setNotificationsEnabled(false) : toggleNotifications()}><span /></button></div>
      {notificationError && <p className="form-error">{notificationError}</p>}
      <div className="modal-actions"><button type="button" className="subtle-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button compact" onClick={() => onSave({ displayName: displayName.trim() || profile.displayName, avatarColor, notificationsEnabled })}>Save changes <Check size={14} /></button></div>
      {onSignOut && <button type="button" className="sign-out-button" onClick={onSignOut}><LogOut size={14} /> Sign out</button>}
    </Modal>
  );
}

function Modal({ title, eyebrow, onClose, children }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div><button type="button" className="icon-button quiet" aria-label="Close" title="Close" onClick={onClose}><X size={18} /></button></div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
