import { EmbedBuilder } from 'discord.js';
import { createEmbed } from '../../shared/utils/embed.js';
import type { Provider, ProviderSnapshot, ResetEvent } from './services/ResetsService.js';

const BRAND: Record<Provider, { name: string; color: number; site: string }> = {
  claude: { name: 'Claude Code', color: 0xD97757, site: 'https://claude-resets.com' },
  codex: { name: 'ChatGPT Codex', color: 0x10A37F, site: 'https://codex-resets.com' },
};

const ts = (d: Date, style: 'R' | 'f' | 'D' = 'R') => `<t:${Math.floor(d.getTime() / 1000)}:${style}>`;

function trim(text: string, max: number): string {
  // Codex notes are raw tweets and carry t.co links we can't show meaningfully
  const clean = text.replace(/https:\/\/t\.co\/\S+/g, '').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Posted to the alert channel the moment a new reset is detected. */
export function resetAlertEmbed(reset: ResetEvent): EmbedBuilder {
  const brand = BRAND[reset.provider];
  const embed = createEmbed(brand.color)
    .setTitle(`🔄 ${brand.name} limits were just reset!`)
    .setDescription(trim(reset.note, 1000) || 'Usage limits have been reset.')
    .addFields({ name: 'Announced', value: ts(reset.date), inline: true })
    .setFooter({ text: new URL(brand.site).host });

  if (reset.banked) {
    embed.addFields({
      name: 'Type',
      value: reset.usableUntil
        ? `Banked reset — apply it yourself before ${ts(reset.usableUntil, 'D')}`
        : 'Banked reset — apply it yourself from your usage settings',
      inline: true,
    });
  }
  if (reset.scope) embed.addFields({ name: 'Applies to', value: reset.scope, inline: true });
  if (reset.url) embed.addFields({ name: 'Source', value: `[View announcement](${reset.url})` });
  return embed;
}

/** Response for /resets claude and /resets codex. */
export function resetStatusEmbed(provider: Provider, snap: ProviderSnapshot): EmbedBuilder {
  const brand = BRAND[provider];
  const embed = createEmbed(brand.color).setTitle(`🔄 ${brand.name} Resets`).setURL(brand.site);

  const latest = snap.resets[0];
  if (!latest) return embed.setDescription('No resets recorded yet.');

  const days = (Date.now() - latest.date.getTime()) / 86_400_000;
  embed.setDescription(
    `Last reset: ${ts(latest.date)} (${days < 1 ? 'less than a day' : `${days.toFixed(1)} days`} ago)` +
      (latest.banked ? ' · banked' : '')
  );

  embed.addFields(
    { name: 'Total resets', value: String(snap.total), inline: true },
    {
      name: 'Average gap',
      value: snap.avgIntervalDays != null ? `${snap.avgIntervalDays.toFixed(1)} days` : 'n/a',
      inline: true,
    }
  );

  // A banked reset the user hasn't necessarily applied yet is the actionable bit
  const openBank = snap.resets.find((r) => r.banked && r.usableUntil && r.usableUntil.getTime() > Date.now());
  if (openBank?.usableUntil) {
    embed.addFields({
      name: '🏦 Banked reset available',
      value: `Apply from your usage settings before ${ts(openBank.usableUntil, 'f')} (${ts(openBank.usableUntil)})`,
    });
  }

  embed.addFields({
    name: 'Recent resets',
    value: snap.resets
      .slice(0, 5)
      .map((r) => {
        const label = trim(r.note, 90) || 'Reset';
        const link = r.url ? `[${label}](${r.url})` : label;
        return `${ts(r.date, 'D')}${r.banked ? ' 🏦' : ''} — ${link}`;
      })
      .join('\n')
      .slice(0, 1024),
  });

  return embed.setFooter({ text: `Data from ${new URL(brand.site).host}` });
}
