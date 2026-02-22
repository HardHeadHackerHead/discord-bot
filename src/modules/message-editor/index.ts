/**
 * Message Editor Module - Manage bot messages via emoji reactions
 *
 * Features:
 * - ✏️ Edit: React to enter edit mode, type replacement message
 * - 🧹 Delete: React to delete the bot's message
 * - 📌 Pin/Unpin: React to toggle pin status
 * - 📋 Copy: React then mention a channel to copy the message there
 *
 * All actions require Manage Messages permission.
 * Edit and Copy have 30 second timeouts.
 *
 * Edit Usage:
 * 1. Add ✏️ reaction to any bot message
 * 2. Type your replacement message within 30 seconds
 * 3. Message can be plain text or JSON with { content?, embeds? }
 *
 * Copy Usage:
 * 1. Add 📋 reaction to any bot message
 * 2. Mention the target channel (e.g., #announcements)
 * 3. Message will be copied there
 */

import { MessageEditorModule } from './module.js';

export default new MessageEditorModule();
export { MessageEditorModule };
