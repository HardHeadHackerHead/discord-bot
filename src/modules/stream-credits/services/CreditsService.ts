import { Guild, GuildMember, Client } from 'discord.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('StreamCredits:Service');

/**
 * Represents a member eligible for stream credits
 */
export interface CreditsMember {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  isBooster: boolean;
  isTagWearer: boolean;
  serverTag: string | null;
}

/**
 * Result of fetching credits data
 */
export interface CreditsData {
  guildName: string;
  guildIconUrl: string | null;
  boosters: CreditsMember[];
  tagWearers: CreditsMember[];
  combined: CreditsMember[];
  allMembers: CreditsMember[];
  fetchedAt: Date;
}

/**
 * Service to fetch server boosters and tag wearers for stream credits
 */
export class CreditsService {
  private client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Fetch all members eligible for stream credits (boosters + tag wearers)
   */
  async fetchCreditsData(guild: Guild): Promise<CreditsData> {
    logger.info(`Fetching credits data for guild: ${guild.name}`);

    // Use cached members (populated by user-tracking module on startup)
    // to avoid gateway rate limits from guild.members.fetch()
    const members = guild.members.cache;
    logger.info(`Using ${members.size} cached members from ${guild.name}`);

    const boosters: CreditsMember[] = [];
    const tagWearers: CreditsMember[] = [];
    const combinedMap = new Map<string, CreditsMember>();
    const allMembersList: CreditsMember[] = [];

    for (const [, member] of members) {
      if (member.user.bot) continue;

      const isBooster = member.premiumSince !== null;
      const isTagWearer = this.isWearingServerTag(member, guild.id);

      const creditsMember: CreditsMember = {
        userId: member.id,
        username: member.user.username,
        displayName: member.displayName,
        avatarUrl: member.displayAvatarURL({ size: 256, extension: 'png' }),
        isBooster,
        isTagWearer,
        serverTag: this.getServerTag(member),
      };

      allMembersList.push(creditsMember);

      if (isBooster) boosters.push(creditsMember);
      if (isTagWearer) tagWearers.push(creditsMember);
      if (isBooster || isTagWearer) combinedMap.set(member.id, creditsMember);
    }

    // Sort alphabetically by display name
    const sortByName = (a: CreditsMember, b: CreditsMember) =>
      a.displayName.localeCompare(b.displayName);

    boosters.sort(sortByName);
    tagWearers.sort(sortByName);
    allMembersList.sort(sortByName);
    const combined = Array.from(combinedMap.values()).sort(sortByName);

    logger.info(
      `Found ${boosters.length} boosters, ${tagWearers.length} tag wearers, ${combined.length} special, ${allMembersList.length} total members`
    );

    return {
      guildName: guild.name,
      guildIconUrl: guild.iconURL({ size: 256, extension: 'png' }),
      boosters,
      tagWearers,
      combined,
      allMembers: allMembersList,
      fetchedAt: new Date(),
    };
  }

  /**
   * Check if a member is wearing this server's tag (clan/identity badge)
   */
  private isWearingServerTag(member: GuildMember, guildId: string): boolean {
    const primaryGuild = (member.user as any).primaryGuild;
    if (!primaryGuild) return false;

    return (
      primaryGuild.identityGuildId === guildId &&
      primaryGuild.identityEnabled === true
    );
  }

  /**
   * Get the server tag string if the member has one
   */
  private getServerTag(member: GuildMember): string | null {
    const primaryGuild = (member.user as any).primaryGuild;
    if (!primaryGuild) return null;
    return primaryGuild.tag ?? null;
  }
}
