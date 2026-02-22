import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getGuild } from '../discord-client.js';
import {
  AutoModerationRuleTriggerType,
  AutoModerationActionType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationActionOptions,
} from 'discord.js';

/**
 * Auto-moderation tools for managing Discord AutoMod rules
 */

export const automodTools: Tool[] = [
  {
    name: 'list_automod_rules',
    description: 'List all auto-moderation rules in the Discord server. Returns rule details including triggers, actions, and exemptions.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_automod_rule',
    description: 'Create a new auto-moderation rule in the Discord server. Supports keyword filtering, spam detection, keyword presets, and mention spam prevention.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name for the auto-moderation rule',
        },
        triggerType: {
          type: 'string',
          enum: ['keyword', 'spam', 'keyword_preset', 'mention_spam'],
          description: 'The type of trigger for the rule',
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords to filter (for "keyword" trigger type)',
        },
        regexPatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Regex patterns to filter (for "keyword" trigger type)',
        },
        presets: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['profanity', 'sexual_content', 'slurs'],
          },
          description: 'Keyword presets to use (for "keyword_preset" trigger type)',
        },
        mentionLimit: {
          type: 'number',
          description: 'Maximum number of mentions allowed (for "mention_spam" trigger type)',
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['block', 'alert', 'timeout'],
                description: 'The action type',
              },
              channelId: {
                type: 'string',
                description: 'Channel ID for alert actions',
              },
              durationSeconds: {
                type: 'number',
                description: 'Timeout duration in seconds (for timeout actions)',
              },
            },
            required: ['type'],
          },
          description: 'Actions to take when the rule is triggered',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether the rule is enabled (default: true)',
        },
        exemptRoles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Role IDs exempt from this rule',
        },
        exemptChannels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Channel IDs exempt from this rule',
        },
      },
      required: ['name', 'triggerType', 'actions'],
    },
  },
  {
    name: 'edit_automod_rule',
    description: 'Modify an existing auto-moderation rule. Only specified fields will be updated.',
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: {
          type: 'string',
          description: 'The ID of the auto-moderation rule to edit',
        },
        name: {
          type: 'string',
          description: 'New name for the rule',
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated keywords to filter',
        },
        regexPatterns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated regex patterns to filter',
        },
        actions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['block', 'alert', 'timeout'],
                description: 'The action type',
              },
              channelId: {
                type: 'string',
                description: 'Channel ID for alert actions',
              },
              durationSeconds: {
                type: 'number',
                description: 'Timeout duration in seconds (for timeout actions)',
              },
            },
            required: ['type'],
          },
          description: 'Updated actions for the rule',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether the rule is enabled',
        },
        exemptRoles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated role IDs exempt from this rule',
        },
        exemptChannels: {
          type: 'array',
          items: { type: 'string' },
          description: 'Updated channel IDs exempt from this rule',
        },
      },
      required: ['ruleId'],
    },
  },
  {
    name: 'delete_automod_rule',
    description: 'Delete an auto-moderation rule from the Discord server.',
    inputSchema: {
      type: 'object',
      properties: {
        ruleId: {
          type: 'string',
          description: 'The ID of the auto-moderation rule to delete',
        },
      },
      required: ['ruleId'],
    },
  },
];

export async function executeAutomodTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_automod_rules':
      return await listAutomodRules();
    case 'create_automod_rule':
      return await createAutomodRule(args);
    case 'edit_automod_rule':
      return await editAutomodRule(args);
    case 'delete_automod_rule':
      return await deleteAutomodRule(args);
    default:
      throw new Error(`Unknown automod tool: ${name}`);
  }
}

// --- Helper mappings ---

const triggerTypeMap: Record<string, AutoModerationRuleTriggerType> = {
  keyword: AutoModerationRuleTriggerType.Keyword,
  spam: AutoModerationRuleTriggerType.Spam,
  keyword_preset: AutoModerationRuleTriggerType.KeywordPreset,
  mention_spam: AutoModerationRuleTriggerType.MentionSpam,
};

const triggerTypeNameMap: Record<number, string> = {
  [AutoModerationRuleTriggerType.Keyword]: 'keyword',
  [AutoModerationRuleTriggerType.Spam]: 'spam',
  [AutoModerationRuleTriggerType.KeywordPreset]: 'keyword_preset',
  [AutoModerationRuleTriggerType.MentionSpam]: 'mention_spam',
};

const actionTypeMap: Record<string, AutoModerationActionType> = {
  block: AutoModerationActionType.BlockMessage,
  alert: AutoModerationActionType.SendAlertMessage,
  timeout: AutoModerationActionType.Timeout,
};

const actionTypeNameMap: Record<number, string> = {
  [AutoModerationActionType.BlockMessage]: 'block',
  [AutoModerationActionType.SendAlertMessage]: 'alert',
  [AutoModerationActionType.Timeout]: 'timeout',
};

const presetMap: Record<string, AutoModerationRuleKeywordPresetType> = {
  profanity: AutoModerationRuleKeywordPresetType.Profanity,
  sexual_content: AutoModerationRuleKeywordPresetType.SexualContent,
  slurs: AutoModerationRuleKeywordPresetType.Slurs,
};

const presetNameMap: Record<number, string> = {
  [AutoModerationRuleKeywordPresetType.Profanity]: 'profanity',
  [AutoModerationRuleKeywordPresetType.SexualContent]: 'sexual_content',
  [AutoModerationRuleKeywordPresetType.Slurs]: 'slurs',
};

interface ActionInput {
  type: string;
  channelId?: string;
  durationSeconds?: number;
}

function buildActions(actions: ActionInput[]): AutoModerationActionOptions[] {
  return actions.map(action => {
    const type = actionTypeMap[action.type];
    if (type === undefined) {
      throw new Error(`Invalid action type: "${action.type}". Must be "block", "alert", or "timeout".`);
    }

    const result: AutoModerationActionOptions = { type };

    if (action.type === 'alert' && action.channelId) {
      result.metadata = { channel: action.channelId as any };
    } else if (action.type === 'timeout' && action.durationSeconds) {
      result.metadata = { durationSeconds: action.durationSeconds } as any;
    }

    return result;
  });
}

// --- Tool implementations ---

async function listAutomodRules(): Promise<string> {
  const guild = await getGuild();
  const rules = await guild.autoModerationRules.fetch();

  const result = rules.map(rule => ({
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    creatorId: rule.creatorId,
    triggerType: triggerTypeNameMap[rule.triggerType] ?? 'unknown',
    triggerMetadata: {
      keywords: rule.triggerMetadata.keywordFilter,
      regexPatterns: rule.triggerMetadata.regexPatterns,
      presets: rule.triggerMetadata.presets.map(p => presetNameMap[p] ?? 'unknown'),
      mentionTotalLimit: rule.triggerMetadata.mentionTotalLimit,
    },
    actions: rule.actions.map(action => ({
      type: actionTypeNameMap[action.type] ?? 'unknown',
      metadata: action.metadata,
    })),
    exemptRoles: rule.exemptRoles.map(r => r.name),
    exemptChannels: rule.exemptChannels.map(c => c.name),
  }));

  return JSON.stringify(result, null, 2);
}

async function createAutomodRule(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();

  const name = args['name'] as string;
  const triggerTypeStr = args['triggerType'] as string;
  const keywords = args['keywords'] as string[] | undefined;
  const regexPatterns = args['regexPatterns'] as string[] | undefined;
  const presets = args['presets'] as string[] | undefined;
  const mentionLimit = args['mentionLimit'] as number | undefined;
  const actions = args['actions'] as ActionInput[];
  const enabled = (args['enabled'] as boolean | undefined) ?? true;
  const exemptRoles = args['exemptRoles'] as string[] | undefined;
  const exemptChannels = args['exemptChannels'] as string[] | undefined;

  const triggerType = triggerTypeMap[triggerTypeStr];
  if (triggerType === undefined) {
    throw new Error(`Invalid trigger type: ${triggerTypeStr}. Must be one of: keyword, spam, keyword_preset, mention_spam`);
  }

  // Build trigger metadata based on trigger type
  const triggerMetadata: Record<string, unknown> = {};
  if (triggerTypeStr === 'keyword') {
    if (keywords) triggerMetadata['keywordFilter'] = keywords;
    if (regexPatterns) triggerMetadata['regexPatterns'] = regexPatterns;
  } else if (triggerTypeStr === 'keyword_preset') {
    if (presets) {
      triggerMetadata['presets'] = presets.map(p => {
        const mapped = presetMap[p];
        if (mapped === undefined) {
          throw new Error(`Invalid preset: ${p}. Must be one of: profanity, sexual_content, slurs`);
        }
        return mapped;
      });
    }
  } else if (triggerTypeStr === 'mention_spam') {
    if (mentionLimit !== undefined) triggerMetadata['mentionTotalLimit'] = mentionLimit;
  }

  const rule = await guild.autoModerationRules.create({
    name,
    eventType: 1, // MessageSend
    triggerType,
    triggerMetadata,
    actions: buildActions(actions),
    enabled,
    exemptRoles: exemptRoles ?? [],
    exemptChannels: exemptChannels ?? [],
  } as any);

  return JSON.stringify({
    success: true,
    message: `Auto-moderation rule "${rule.name}" created successfully`,
    rule: {
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      triggerType: triggerTypeNameMap[rule.triggerType] ?? 'unknown',
    },
  }, null, 2);
}

async function editAutomodRule(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const ruleId = args['ruleId'] as string;

  const rule = await guild.autoModerationRules.fetch(ruleId);

  const updates: Record<string, unknown> = {};

  if (args['name'] !== undefined) updates['name'] = args['name'] as string;
  if (args['enabled'] !== undefined) updates['enabled'] = args['enabled'] as boolean;
  if (args['exemptRoles'] !== undefined) updates['exemptRoles'] = args['exemptRoles'] as string[];
  if (args['exemptChannels'] !== undefined) updates['exemptChannels'] = args['exemptChannels'] as string[];

  if (args['actions'] !== undefined) {
    const actions = args['actions'] as ActionInput[];
    updates['actions'] = buildActions(actions);
  }

  // Build trigger metadata updates
  const triggerMetadata: Record<string, unknown> = {};
  let hasTriggerMetadata = false;
  if (args['keywords'] !== undefined) {
    triggerMetadata['keywordFilter'] = args['keywords'] as string[];
    hasTriggerMetadata = true;
  }
  if (args['regexPatterns'] !== undefined) {
    triggerMetadata['regexPatterns'] = args['regexPatterns'] as string[];
    hasTriggerMetadata = true;
  }
  if (hasTriggerMetadata) {
    updates['triggerMetadata'] = triggerMetadata;
  }

  const updatedRule = await rule.edit(updates as any);

  return JSON.stringify({
    success: true,
    message: `Auto-moderation rule "${updatedRule.name}" updated successfully`,
    rule: {
      id: updatedRule.id,
      name: updatedRule.name,
      enabled: updatedRule.enabled,
      triggerType: triggerTypeNameMap[updatedRule.triggerType] ?? 'unknown',
    },
  }, null, 2);
}

async function deleteAutomodRule(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const ruleId = args['ruleId'] as string;

  const rule = await guild.autoModerationRules.fetch(ruleId);
  const ruleName = rule.name;
  await rule.delete();

  return JSON.stringify({
    success: true,
    message: `Auto-moderation rule "${ruleName}" deleted successfully`,
  }, null, 2);
}
