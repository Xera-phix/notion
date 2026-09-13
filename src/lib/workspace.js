export function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function normalizeWorkspaceLink({ name = '', url = '' } = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url.trim());
  } catch {
    throw new Error('Enter a valid Notion URL.');
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const isNotionHost = ['notion.so', 'notion.site', 'notion.com'].some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  if (parsedUrl.protocol !== 'https:' || !isNotionHost) throw new Error('Enter a valid Notion URL.');

  return {
    name: name.trim() || 'Notion workspace',
    url: parsedUrl.toString(),
  };
}

export function createNextChat(chats, startingDate = getTodayKey()) {
  const usedDates = new Set(chats.map((chat) => chat.date));
  const nextDate = new Date(`${startingDate}T00:00:00`);

  do {
    nextDate.setDate(nextDate.getDate() + 1);
  } while (usedDates.has(getTodayKey(nextDate)));

  const date = getTodayKey(nextDate);
  return { id: `chat-${date}`, date, messages: [] };
}

export function appendMessage(messages, message) {
  return [...messages, message];
}

export function editOwnMessage(messages, messageId, authorId, body) {
  return messages.map((message) => {
    if (message.id !== messageId || message.authorId !== authorId) return message;
    return { ...message, body, editedAt: new Date().toISOString() };
  });
}

export function deleteOwnMessage(messages, messageId, authorId) {
  const message = messages.find((candidate) => candidate.id === messageId);
  if (!message || message.authorId !== authorId) return messages;
  return messages.filter((candidate) => candidate.id !== messageId);
}

export function updateNoteBlock(blocks, blockId, ownerId, changes) {
  return blocks.map((block) => {
    if (block.id !== blockId || block.ownerId !== ownerId) return block;
    return { ...block, ...changes };
  });
}

export function insertNoteBlock(blocks, block, position = blocks.length) {
  const nextBlocks = [...blocks];
  nextBlocks.splice(Math.max(0, Math.min(position, nextBlocks.length)), 0, block);
  return nextBlocks.map((candidate, index) => ({ ...candidate, position: index }));
}
