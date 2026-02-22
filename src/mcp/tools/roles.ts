import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getGuild, refreshServerCache } from '../discord-client.js';
import { ColorResolvable, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { smartFindRole, smartFindMember } from './utils.js';

/**
 * Role management tools - with smart fuzzy matching
 */

export const roleTools: Tool[] = [
  {
    name: 'list_roles',
    description: 'List all roles in the Discord server, sorted by position. Returns role names, IDs, colors, and member counts.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_role',
    description: 'Create a new role in the Discord server with specified name, color, and optional permissions.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name for the new role',
        },
        color: {
          type: 'string',
          description: 'The color for the role in hex format (e.g., "#FF0000" for red) or color name (e.g., "Blue", "Red")',
        },
        hoist: {
          type: 'boolean',
          description: 'Whether the role should be displayed separately in the member list (default: false)',
        },
        mentionable: {
          type: 'boolean',
          description: 'Whether the role can be mentioned by anyone (default: false)',
        },
        reason: {
          type: 'string',
          description: 'The reason for creating this role (shown in audit log)',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'delete_role',
    description: 'Delete a role from the Discord server. Role name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: 'The role name or ID to delete (fuzzy matched)',
        },
        reason: {
          type: 'string',
          description: 'The reason for deleting this role (shown in audit log)',
        },
      },
      required: ['role'],
    },
  },
  {
    name: 'modify_role',
    description: 'Modify an existing role\'s properties such as name, color, or position. Role name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: 'The role name or ID to modify (fuzzy matched)',
        },
        name: {
          type: 'string',
          description: 'New name for the role',
        },
        color: {
          type: 'string',
          description: 'New color for the role in hex format (e.g., "#FF0000")',
        },
        hoist: {
          type: 'boolean',
          description: 'Whether the role should be displayed separately in the member list',
        },
        mentionable: {
          type: 'boolean',
          description: 'Whether the role can be mentioned by anyone',
        },
        position: {
          type: 'number',
          description: 'New position for the role in the hierarchy (higher = more authority)',
        },
        reason: {
          type: 'string',
          description: 'The reason for modifying this role (shown in audit log)',
        },
      },
      required: ['role'],
    },
  },
  {
    name: 'get_role_permissions',
    description: 'View all permissions granted to a specific role. Role name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: 'The role name or ID (fuzzy matched)',
        },
      },
      required: ['role'],
    },
  },
  {
    name: 'modify_role_permissions',
    description: 'Grant or revoke specific permissions on a role. Role name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        role: {
          type: 'string',
          description: 'The role name or ID (fuzzy matched)',
        },
        grant: {
          type: 'array',
          description: 'Permission names to grant (e.g., ["SendMessages", "ManageMessages"])',
          items: { type: 'string' },
        },
        revoke: {
          type: 'array',
          description: 'Permission names to revoke (e.g., ["KickMembers", "BanMembers"])',
          items: { type: 'string' },
        },
        reason: {
          type: 'string',
          description: 'The reason for this change (shown in audit log)',
        },
      },
      required: ['role'],
    },
  },
  {
    name: 'assign_role',
    description: 'Assign a role to a member. Both role and member names are fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        member: {
          type: 'string',
          description: 'The member\'s username, display name, or user ID (fuzzy matched)',
        },
        role: {
          type: 'string',
          description: 'The role name or ID to assign (fuzzy matched)',
        },
        reason: {
          type: 'string',
          description: 'The reason for assigning this role (shown in audit log)',
        },
      },
      required: ['member', 'role'],
    },
  },
  {
    name: 'remove_role',
    description: 'Remove a role from a member. Both role and member names are fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        member: {
          type: 'string',
          description: 'The member\'s username, display name, or user ID (fuzzy matched)',
        },
        role: {
          type: 'string',
          description: 'The role name or ID to remove (fuzzy matched)',
        },
        reason: {
          type: 'string',
          description: 'The reason for removing this role (shown in audit log)',
        },
      },
      required: ['member', 'role'],
    },
  },
];

export async function executeRoleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_roles':
      return await listRoles();
    case 'create_role':
      return await createRole(args);
    case 'delete_role':
      return await deleteRole(args);
    case 'modify_role':
      return await modifyRole(args);
    case 'get_role_permissions':
      return await getRolePermissions(args);
    case 'modify_role_permissions':
      return await modifyRolePermissions(args);
    case 'assign_role':
      return await assignRole(args);
    case 'remove_role':
      return await removeRole(args);
    default:
      throw new Error(`Unknown role tool: ${name}`);
  }
}

async function listRoles(): Promise<string> {
  const guild = await getGuild();

  const roles = guild.roles.cache
    .sort((a, b) => b.position - a.position)
    .map(role => ({
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      hoist: role.hoist,
      mentionable: role.mentionable,
      memberCount: role.members.size,
      managed: role.managed,
      isEveryone: role.id === guild.id,
    }));

  return JSON.stringify({
    totalRoles: roles.length,
    roles,
  }, null, 2);
}

async function createRole(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();

  const name = args['name'] as string;
  const color = args['color'] as string | undefined;
  const hoist = args['hoist'] as boolean | undefined;
  const mentionable = args['mentionable'] as boolean | undefined;
  const reason = args['reason'] as string | undefined;

  const role = await guild.roles.create({
    name,
    color: color as ColorResolvable | undefined,
    hoist: hoist ?? false,
    mentionable: mentionable ?? false,
    reason: reason ?? 'Created via MCP',
  });

  // Refresh cache so the new role is immediately findable
  await refreshServerCache();

  return JSON.stringify({
    success: true,
    message: `Role "${role.name}" created successfully`,
    role: {
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
    },
  }, null, 2);
}

async function deleteRole(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const roleIdentifier = args['role'] as string;
  const reason = args['reason'] as string | undefined;

  const role = await smartFindRole(roleIdentifier);

  if (role.managed) {
    throw new Error(`Cannot delete managed role "${role.name}" (managed by an integration)`);
  }

  if (role.id === guild.id) {
    throw new Error('Cannot delete the @everyone role');
  }

  const roleName = role.name;
  await role.delete(reason ?? 'Deleted via MCP');

  // Refresh cache so the deleted role is removed from lookups
  await refreshServerCache();

  return JSON.stringify({
    success: true,
    message: `Role "${roleName}" deleted successfully`,
  }, null, 2);
}

async function modifyRole(args: Record<string, unknown>): Promise<string> {
  const roleIdentifier = args['role'] as string;
  const role = await smartFindRole(roleIdentifier);

  if (role.managed) {
    throw new Error(`Cannot modify managed role "${role.name}" (managed by an integration)`);
  }

  const updates: {
    name?: string;
    color?: ColorResolvable;
    hoist?: boolean;
    mentionable?: boolean;
    position?: number;
    reason?: string;
  } = {};

  if (args['name'] !== undefined) updates.name = args['name'] as string;
  if (args['color'] !== undefined) updates.color = args['color'] as ColorResolvable;
  if (args['hoist'] !== undefined) updates.hoist = args['hoist'] as boolean;
  if (args['mentionable'] !== undefined) updates.mentionable = args['mentionable'] as boolean;
  if (args['position'] !== undefined) updates.position = args['position'] as number;
  updates.reason = (args['reason'] as string) ?? 'Modified via MCP';

  const updatedRole = await role.edit(updates);

  return JSON.stringify({
    success: true,
    message: `Role "${updatedRole.name}" modified successfully`,
    role: {
      id: updatedRole.id,
      name: updatedRole.name,
      color: updatedRole.hexColor,
      position: updatedRole.position,
      hoist: updatedRole.hoist,
      mentionable: updatedRole.mentionable,
    },
  }, null, 2);
}

async function assignRole(args: Record<string, unknown>): Promise<string> {
  const memberIdentifier = args['member'] as string;
  const roleIdentifier = args['role'] as string;
  const reason = args['reason'] as string | undefined;

  const member = await smartFindMember(memberIdentifier);
  const role = await smartFindRole(roleIdentifier);

  if (member.roles.cache.has(role.id)) {
    return JSON.stringify({
      success: true,
      message: `Member "${member.displayName}" already has the role "${role.name}"`,
    }, null, 2);
  }

  await member.roles.add(role, reason ?? 'Assigned via MCP');

  return JSON.stringify({
    success: true,
    message: `Role "${role.name}" assigned to "${member.displayName}" successfully`,
    member: {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
    },
    role: {
      id: role.id,
      name: role.name,
    },
  }, null, 2);
}

async function removeRole(args: Record<string, unknown>): Promise<string> {
  const memberIdentifier = args['member'] as string;
  const roleIdentifier = args['role'] as string;
  const reason = args['reason'] as string | undefined;

  const member = await smartFindMember(memberIdentifier);
  const role = await smartFindRole(roleIdentifier);

  if (!member.roles.cache.has(role.id)) {
    return JSON.stringify({
      success: true,
      message: `Member "${member.displayName}" doesn't have the role "${role.name}"`,
    }, null, 2);
  }

  await member.roles.remove(role, reason ?? 'Removed via MCP');

  return JSON.stringify({
    success: true,
    message: `Role "${role.name}" removed from "${member.displayName}" successfully`,
    member: {
      id: member.id,
      username: member.user.username,
      displayName: member.displayName,
    },
    role: {
      id: role.id,
      name: role.name,
    },
  }, null, 2);
}

async function getRolePermissions(args: Record<string, unknown>): Promise<string> {
  const roleIdentifier = args['role'] as string;
  const role = await smartFindRole(roleIdentifier);

  const permissions = role.permissions.toArray();

  return JSON.stringify({
    role: {
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
    },
    permissions,
    isAdministrator: permissions.includes('Administrator'),
  }, null, 2);
}

async function modifyRolePermissions(args: Record<string, unknown>): Promise<string> {
  const roleIdentifier = args['role'] as string;
  const grantPerms = args['grant'] as string[] | undefined;
  const revokePerms = args['revoke'] as string[] | undefined;
  const reason = args['reason'] as string | undefined;

  const role = await smartFindRole(roleIdentifier);

  if (role.managed) {
    throw new Error(`Cannot modify permissions on managed role "${role.name}" (managed by an integration)`);
  }

  // Start with current permissions
  let bits = role.permissions.bitfield;

  // Grant permissions
  if (grantPerms) {
    for (const perm of grantPerms) {
      if (!(perm in PermissionFlagsBits)) {
        throw new Error(`Unknown permission: "${perm}". Valid: ${Object.keys(PermissionFlagsBits).slice(0, 10).join(', ')}...`);
      }
      bits |= PermissionFlagsBits[perm as keyof typeof PermissionFlagsBits];
    }
  }

  // Revoke permissions
  if (revokePerms) {
    for (const perm of revokePerms) {
      if (!(perm in PermissionFlagsBits)) {
        throw new Error(`Unknown permission: "${perm}". Valid: ${Object.keys(PermissionFlagsBits).slice(0, 10).join(', ')}...`);
      }
      bits &= ~PermissionFlagsBits[perm as keyof typeof PermissionFlagsBits];
    }
  }

  await role.setPermissions(bits, reason ?? 'Permissions modified via MCP');

  const newPermissions = new PermissionsBitField(bits).toArray();

  return JSON.stringify({
    success: true,
    message: `Permissions updated for role "${role.name}"`,
    role: { id: role.id, name: role.name },
    granted: grantPerms ?? [],
    revoked: revokePerms ?? [],
    currentPermissions: newPermissions,
  }, null, 2);
}
