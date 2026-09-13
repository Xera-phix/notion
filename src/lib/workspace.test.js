import { describe, expect, it } from 'vitest';
import {
  appendMessage,
  createNextChat,
  deleteOwnMessage,
  editOwnMessage,
  getTodayKey,
  insertNoteBlock,
  normalizeWorkspaceLink,
  updateNoteBlock,
} from './workspace.js';

describe('workspace rules', () => {
  it('creates a new chat on the next unused day', () => {
    const chats = [
      { id: 'chat-a', date: '2026-08-31' },
      { id: 'chat-b', date: '2026-09-01' },
    ];

    expect(createNextChat(chats, '2026-08-31')).toEqual({
      id: 'chat-2026-09-02',
      date: '2026-09-02',
      messages: [],
    });
  });

  it('appends a message with an inline reply reference', () => {
    const message = appendMessage([], {
      id: 'message-2',
      authorId: 'demo-you',
      body: 'send it immediately',
      replyToId: 'message-1',
    });

    expect(message[0]).toMatchObject({
      id: 'message-2',
      body: 'send it immediately',
      replyToId: 'message-1',
    });
  });

  it('only permits the author to edit or fully delete a message', () => {
    const messages = [{ id: 'message-1', authorId: 'demo-you', body: 'hello' }];

    expect(editOwnMessage(messages, 'message-1', 'demo-you', 'edited')).toEqual([
      expect.objectContaining({ body: 'edited', editedAt: expect.any(String) }),
    ]);
    expect(deleteOwnMessage(messages, 'message-1', 'someone-else')).toEqual(messages);
    expect(deleteOwnMessage(messages, 'message-1', 'demo-you')).toEqual([]);
  });

  it('updates only the current user’s private note block', () => {
    const blocks = [
      { id: 'note-1', ownerId: 'demo-you', type: 'paragraph', content: 'old' },
      { id: 'note-2', ownerId: 'partner', type: 'paragraph', content: 'private' },
    ];

    expect(updateNoteBlock(blocks, 'note-1', 'demo-you', { content: 'new' })).toEqual([
      expect.objectContaining({ id: 'note-1', content: 'new' }),
      blocks[1],
    ]);
    expect(updateNoteBlock(blocks, 'note-2', 'demo-you', { content: 'intruded' })).toEqual(blocks);
  });

  it('formats the current date as the chat key', () => {
    expect(getTodayKey(new Date('2026-08-31T22:10:00.000Z'))).toBe('2026-08-31');
  });

  it("uses the user's local date near a UTC day boundary", () => {
    const previousTimeZone = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';

    try {
      expect(getTodayKey(new Date('2026-09-01T00:30:00.000Z'))).toBe('2026-08-31');
    } finally {
      process.env.TZ = previousTimeZone;
    }
  });

  it('normalizes Notion workspace links and rejects other hosts', () => {
    expect(normalizeWorkspaceLink({ name: '  Study space  ', url: ' https://www.notion.so/study-space ' })).toEqual({
      name: 'Study space',
      url: 'https://www.notion.so/study-space',
    });
    expect(() => normalizeWorkspaceLink({ name: 'Other', url: 'https://example.com/page' })).toThrow('Notion URL');
  });

  it('inserts an inline private block and renumbers the note order', () => {
    const blocks = [
      { id: 'note-1', ownerId: 'demo-you', type: 'paragraph', content: 'above', position: 0 },
      { id: 'note-2', ownerId: 'demo-you', type: 'paragraph', content: 'below', position: 1 },
    ];

    expect(insertNoteBlock(blocks, { id: 'comment-1', ownerId: 'demo-you', type: 'comment', content: 'sneaky', position: 1 }, 1)).toEqual([
      blocks[0],
      { id: 'comment-1', ownerId: 'demo-you', type: 'comment', content: 'sneaky', position: 1 },
      { ...blocks[1], position: 2 },
    ]);
  });
});
