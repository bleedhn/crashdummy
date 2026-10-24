// Roblox admin logs → Discord: one clean embed per event.

import { EmbedBuilder, escapeMarkdown } from 'discord.js';

export const CATEGORY_COLORS = Object.freeze({
  Moderation: 0xed4245, // red
  AntiCheat: 0xe67e22, // orange
  AdminCommand: 0x3498db, // blue
  AdminAccess: 0x9b59b6, // purple
  Audit: 0x99aab5, // gray
});

const LIMITS = { title: 256, fieldName: 256, fieldValue: 1024, fields: 25, total: 5800 };

const MARKDOWN_OPTIONS = {
  codeBlock: true, inlineCode: true, bold: true, italic: true, underline: true, strikethrough: true,
  spoiler: true, codeBlockContent: true, inlineCodeContent: true, escape: true, heading: true,
  bulletedList: true, numberedList: true, maskedLink: true,
};

// Text that came from the game (names, reasons, evidence): markdown escaped, and every "@" broken with
// a zero-width space so @everyone, @here, <@id> and <@&role> can never ping (sending also disables
// mentions completely - this is the second layer).
export function safeText(value, max = LIMITS.fieldValue) {
  if (value === undefined || value === null) {
    return '';
  }
  let text = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  text = escapeMarkdown(text, MARKDOWN_OPTIONS).replace(/@/g, '@​');
  return clip(text, max);
}

function clip(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

// "VehicleSpeed" -> "Vehicle Speed", "AdminPanelGranted" -> "Admin Panel Granted"
export function humanize(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function code(value) {
  return `\`${String(value).replace(/`/g, "'")}\``;
}

function personLine(person) {
  if (!person) return null;
  const username = person.username ? safeText(person.username, 60) : '?';
  const display = person.displayName && person.displayName !== person.username ? safeText(person.displayName, 60) : null;
  const label = display ? `${display} (@${username})` : username;
  if (person.userId > 0) {
    return `[${label}](https://www.roblox.com/users/${person.userId}/profile)`;
  }
  return label;
}

function utcText(seconds) {
  const iso = new Date(seconds * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  return `<t:${seconds}:F>\n${iso}`;
}

const MODERATION_TITLES = {
  PlayerBan: { Success: 'PLAYER BANNED', Failed: 'BAN FAILED', Denied: 'BAN DENIED' },
  PlayerKick: { Success: 'PLAYER KICKED', Failed: 'KICK FAILED', Denied: 'KICK DENIED' },
  PlayerWarn: { Success: 'PLAYER WARNED', Failed: 'WARNING FAILED', Denied: 'WARNING DENIED' },
  PlayerUnban: { Success: 'PLAYER UNBANNED', Failed: 'UNBAN FAILED', Denied: 'UNBAN DENIED' },
};

const MODERATION_ACTION_NAMES = { PlayerKick: 'Kick', PlayerWarn: 'Warning', PlayerUnban: 'Unban' };

function titleFor(event) {
  const action = humanize(event.action).toUpperCase();
  const repeated = event.occurrences ? ` (x${event.occurrences.count})` : '';
  switch (event.category) {
    case 'Moderation': {
      const titles = MODERATION_TITLES[event.action];
      return `ROBLOX ADMIN LOG — ${titles?.[event.outcome] || `${action} ${event.outcome.toUpperCase()}`}`;
    }
    case 'AntiCheat':
      return `ROBLOX ANTI-CHEAT — ${event.outcome === 'Warning' ? 'WARNING DETECTED' : 'SUSPICIOUS ACTIVITY'}${repeated}`;
    case 'AdminCommand': {
      const failed = event.outcome === 'Failed' ? ' (FAILED)' : event.outcome === 'Partial' ? ' (PARTIAL)' : '';
      return `ROBLOX ADMIN COMMAND — ${action}${failed}${repeated}`;
    }
    case 'AdminAccess': {
      const names = {
        AdminPanelGranted: 'ADMIN PANEL ACCESS',
        TesterPanelGranted: 'TESTER PANEL ACCESS',
        PermissionDenied: 'PERMISSION DENIED',
        UnauthorizedAdminRequest: 'UNAUTHORIZED ADMIN REQUEST',
      };
      return `ROBLOX ADMIN ACCESS — ${names[event.action] || action}${repeated}`;
    }
    default:
      return `ROBLOX AUDIT — ${action}${repeated}`;
  }
}

function moderationAction(event) {
  if (event.action === 'PlayerBan') {
    const permanent = event.details?.permanent === true || /^perm/i.test(String(event.details?.duration || ''));
    return permanent ? 'Permanent Ban' : `Temporary Ban${event.details?.duration ? ` (${safeText(event.details.duration, 40)})` : ''}`;
  }
  return MODERATION_ACTION_NAMES[event.action] || humanize(event.action);
}

// Builds the fields; `used` collects the detail keys already shown so the rest can be listed after.
function fieldsFor(event) {
  const fields = [];
  const used = new Set();
  const add = (name, value, inline = true) => {
    if (value === undefined || value === null || value === '') return;
    fields.push({ name: clip(name, LIMITS.fieldName), value: clip(String(value), LIMITS.fieldValue), inline });
  };
  const detail = (key) => {
    used.add(key);
    return event.details?.[key];
  };
  const actor = event.actor;
  const target = event.target;
  const actorRole = actor?.role ? ` · ${safeText(actor.role, 30)}` : '';

  if (event.category === 'Moderation') {
    add('Action', moderationAction(event));
    if (event.outcome !== 'Success') add('Outcome', event.outcome);
    add('Administrator', actor ? `${personLine(actor)}${actorRole}` : null);
    add('Admin User ID', actor ? code(actor.userId) : null);
    add('Target Player', personLine(target));
    add('Target User ID', target ? code(target.userId) : null);
    add('Reason', event.reason ? safeText(event.reason) : '*None given*', false);
    if (event.action === 'PlayerBan') {
      add('Duration', detail('duration') ? safeText(detail('duration'), 40) : null);
      detail('permanent');
    }
    add('Result', detail('result') ? safeText(detail('result')) : null, false);
  } else if (event.category === 'AntiCheat' || event.action === 'UnauthorizedAdminRequest') {
    add('Player', personLine(target));
    add('User ID', target ? code(target.userId) : null);
    add('Detection', detail('detection') ? safeText(humanize(detail('detection')), 80) : null);
    add('Category', detail('detectionCategory') ? safeText(detail('detectionCategory'), 40) : null);
    add('Severity', detail('severity') ? safeText(detail('severity'), 20) : null);
    add('Action Taken', detail('actionTaken') ? safeText(detail('actionTaken'), 120) : null);
    add('Reason', event.reason ? safeText(event.reason) : null, false);
    add('Evidence', detail('evidence') ? safeText(detail('evidence')) : null, false);
  } else {
    add(event.category === 'AdminAccess' ? 'Staff Member' : 'Administrator', actor ? `${personLine(actor)}${actorRole}` : null);
    add('User ID', actor ? code(actor.userId) : null);
    add('Outcome', event.outcome);
    if (target) {
      add('Target Player', personLine(target));
      add('Target User ID', code(target.userId));
    }
    add('Command', detail('command') ? code(detail('command')) : null);
    add('Values', detail('values') ? safeText(detail('values'), 200) : null);
    add('Targets', detail('targets') ? safeText(detail('targets')) : null, false);
    add('Flight', detail('flight') ? safeText(detail('flight'), 20) : null);
    add('Reason', event.reason ? safeText(event.reason) : null, false);
    add('Result', detail('result') ? safeText(detail('result')) : null, false);
  }

  // anything else the game sent, as plain fields
  for (const [key, value] of Object.entries(event.details || {})) {
    if (used.has(key)) continue;
    add(humanize(key), typeof value === 'string' ? safeText(value) : code(value), String(value).length < 40);
  }

  if (event.occurrences) {
    const { count, firstAt, lastAt } = event.occurrences;
    add('Occurrences', `${count} (${event.occurrences.repeats} after the first report)`);
    add('First Detection', `<t:${firstAt}:T>`);
    add('Latest Detection', `<t:${lastAt}:T>`);
  }

  const server = event.server;
  const serverNotes = [server.studio ? 'Studio test' : null, server.privateServer ? 'Private server' : null].filter(Boolean);
  add('Server Job ID', `${code(server.jobId)}${serverNotes.length ? `\n${serverNotes.join(' · ')}` : ''}`, false);
  add('Place ID', code(server.placeId));
  add('Universe ID', code(server.universeId));
  add('Timestamp', utcText(event.timestamp));
  add('Event ID', code(event.eventId), false);
  if (event.auditId) add('Audit Entry', code(event.auditId));

  return fields;
}

function totalLength(title, fields) {
  return title.length + fields.reduce((sum, field) => sum + field.name.length + field.value.length, 0);
}

export function buildEmbedData(event) {
  const title = clip(titleFor(event), LIMITS.title);
  let fields = fieldsFor(event).slice(0, LIMITS.fields);
  // keep the whole embed under Discord's 6000 character limit: shorten the longest values first
  while (totalLength(title, fields) > LIMITS.total) {
    const longest = fields.reduce((best, field, index) => (field.value.length > fields[best].value.length ? index : best), 0);
    const field = fields[longest];
    if (field.value.length <= 64) {
      fields = fields.slice(0, -1);
      continue;
    }
    fields[longest] = { ...field, value: clip(field.value, Math.floor(field.value.length / 2)) };
  }
  return { title, color: CATEGORY_COLORS[event.category] ?? CATEGORY_COLORS.Audit, fields };
}

export function buildEmbed(event) {
  const data = buildEmbedData(event);
  return new EmbedBuilder().setTitle(data.title).setColor(data.color).addFields(data.fields);
}

export function embedLength(data) {
  return totalLength(data.title, data.fields);
}
