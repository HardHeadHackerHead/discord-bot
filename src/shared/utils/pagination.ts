import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ChatInputCommandInteraction,
  Message,
  InteractionCollector,
  ButtonInteraction,
} from 'discord.js';
import { createEmbed, COLORS } from './embed.js';

/**
 * Options for paginated embeds
 */
export interface PaginationOptions {
  /** Items per page */
  itemsPerPage: number;

  /** Timeout in milliseconds (default: 2 minutes) */
  timeout?: number;

  /** Whether only the command user can navigate (default: true) */
  restrictToUser?: boolean;

  /** Custom embed color */
  color?: number;

  /** Show page numbers in footer (default: true) */
  showPageNumbers?: boolean;
}

/**
 * Default pagination options
 */
const DEFAULT_OPTIONS: Required<PaginationOptions> = {
  itemsPerPage: 10,
  timeout: 120000, // 2 minutes
  restrictToUser: true,
  color: COLORS.primary,
  showPageNumbers: true,
};

/**
 * Create pagination buttons
 */
function createPaginationButtons(
  currentPage: number,
  totalPages: number,
  disabled: boolean = false
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('pagination_first')
      .setLabel('⏮')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || currentPage === 0),
    new ButtonBuilder()
      .setCustomId('pagination_prev')
      .setLabel('◀')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || currentPage === 0),
    new ButtonBuilder()
      .setCustomId('pagination_page')
      .setLabel(`${currentPage + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('pagination_next')
      .setLabel('▶')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || currentPage >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId('pagination_last')
      .setLabel('⏭')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || currentPage >= totalPages - 1)
  );
}

/**
 * Paginated list for displaying items in embeds with navigation
 */
export class PaginatedList<T> {
  private items: T[];
  private options: Required<PaginationOptions>;
  private formatItem: (item: T, index: number) => string;
  private title: string;
  private description?: string;

  constructor(
    items: T[],
    formatItem: (item: T, index: number) => string,
    title: string,
    options?: PaginationOptions
  ) {
    this.items = items;
    this.formatItem = formatItem;
    this.title = title;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Set optional description shown on all pages
   */
  setDescription(description: string): this {
    this.description = description;
    return this;
  }

  /**
   * Get total number of pages
   */
  get totalPages(): number {
    return Math.ceil(this.items.length / this.options.itemsPerPage);
  }

  /**
   * Get items for a specific page
   */
  private getPageItems(page: number): T[] {
    const start = page * this.options.itemsPerPage;
    const end = start + this.options.itemsPerPage;
    return this.items.slice(start, end);
  }

  /**
   * Build embed for a specific page
   */
  private buildEmbed(page: number): EmbedBuilder {
    const pageItems = this.getPageItems(page);
    const startIndex = page * this.options.itemsPerPage;

    const formattedItems = pageItems
      .map((item, index) => this.formatItem(item, startIndex + index))
      .join('\n');

    const embed = createEmbed(this.options.color).setTitle(this.title);

    if (this.description) {
      embed.setDescription(`${this.description}\n\n${formattedItems}`);
    } else {
      embed.setDescription(formattedItems || 'No items to display.');
    }

    if (this.options.showPageNumbers && this.totalPages > 1) {
      embed.setFooter({ text: `Page ${page + 1} of ${this.totalPages} • ${this.items.length} total items` });
    } else if (this.items.length > 0) {
      embed.setFooter({ text: `${this.items.length} total items` });
    }

    return embed;
  }

  /**
   * Send the paginated embed and handle navigation
   */
  async send(interaction: ChatInputCommandInteraction): Promise<void> {
    // If only one page, just send without buttons
    if (this.totalPages <= 1) {
      await interaction.reply({ embeds: [this.buildEmbed(0)] });
      return;
    }

    let currentPage = 0;

    const message = await interaction.reply({
      embeds: [this.buildEmbed(currentPage)],
      components: [createPaginationButtons(currentPage, this.totalPages)],
      fetchReply: true,
    });

    // Create collector for button interactions
    const collector = message.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: this.options.timeout,
      filter: this.options.restrictToUser
        ? (i) => i.user.id === interaction.user.id
        : undefined,
    });

    collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
      switch (buttonInteraction.customId) {
        case 'pagination_first':
          currentPage = 0;
          break;
        case 'pagination_prev':
          currentPage = Math.max(0, currentPage - 1);
          break;
        case 'pagination_next':
          currentPage = Math.min(this.totalPages - 1, currentPage + 1);
          break;
        case 'pagination_last':
          currentPage = this.totalPages - 1;
          break;
      }

      await buttonInteraction.update({
        embeds: [this.buildEmbed(currentPage)],
        components: [createPaginationButtons(currentPage, this.totalPages)],
      });
    });

    collector.on('end', async () => {
      // Disable buttons when collector expires
      try {
        await interaction.editReply({
          components: [createPaginationButtons(currentPage, this.totalPages, true)],
        });
      } catch {
        // Message may have been deleted
      }
    });
  }
}

/**
 * Quick helper to create and send a paginated list
 */
export async function paginatedList<T>(
  interaction: ChatInputCommandInteraction,
  items: T[],
  formatItem: (item: T, index: number) => string,
  title: string,
  options?: PaginationOptions
): Promise<void> {
  const list = new PaginatedList(items, formatItem, title, options);
  await list.send(interaction);
}

/**
 * Format leaderboard entry with rank, name, and value
 */
export function formatLeaderboardEntry(
  rank: number,
  name: string,
  value: string | number,
  highlight: boolean = false
): string {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `\`${rank}.\``;
  const prefix = highlight ? '**' : '';
  const suffix = highlight ? '**' : '';
  return `${medal} ${prefix}${name}${suffix} - ${value}`;
}
