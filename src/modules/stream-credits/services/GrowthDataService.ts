import { PrismaClient } from '@prisma/client';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('StreamCredits:Growth');

export interface GrowthDataPoint {
  date: string; // YYYY-MM-DD format (daily granularity)
  totalMembers: number;
}

export interface GrowthStats {
  timeline: GrowthDataPoint[];
  totalMembers: number;
  oldestJoinDate: string | null;
  newestJoinDate: string | null;
}

export class GrowthDataService {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async fetchGrowthData(guildId: string): Promise<GrowthStats> {
    logger.info(`Fetching growth data for guild: ${guildId}`);

    // Get all guild members with their join dates, ordered chronologically
    const members = await this.prisma.guildMember.findMany({
      where: { guildId, isActive: true },
      select: { joinedAt: true },
      orderBy: { joinedAt: 'asc' },
    });

    if (members.length === 0) {
      return {
        timeline: [],
        totalMembers: 0,
        oldestJoinDate: null,
        newestJoinDate: null,
      };
    }

    // Group joins by day and build cumulative count
    const dailyJoins = new Map<string, number>();

    for (const member of members) {
      const d = member.joinedAt;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      dailyJoins.set(key, (dailyJoins.get(key) ?? 0) + 1);
    }

    // Build cumulative timeline — fill in gaps so every day is represented
    const sortedDays = [...dailyJoins.keys()].sort();
    const firstDay = sortedDays[0]!;
    const lastDay = sortedDays[sortedDays.length - 1]!;

    const timeline: GrowthDataPoint[] = [];
    let cumulative = 0;
    const current = new Date(firstDay + 'T00:00:00');
    const end = new Date(lastDay + 'T00:00:00');

    while (current <= end) {
      const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
      const joins = dailyJoins.get(key) ?? 0;
      cumulative += joins;
      timeline.push({ date: key, totalMembers: cumulative });
      current.setDate(current.getDate() + 1);
    }

    logger.info(`Growth data: ${timeline.length} days, ${members.length} total members`);

    return {
      timeline,
      totalMembers: members.length,
      oldestJoinDate: members[0]!.joinedAt.toISOString(),
      newestJoinDate: members[members.length - 1]!.joinedAt.toISOString(),
    };
  }
}
