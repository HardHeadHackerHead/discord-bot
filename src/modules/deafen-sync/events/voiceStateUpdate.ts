import { VoiceState } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { DeafenSyncService } from '../services/DeafenSyncService.js';

let deafenSyncService: DeafenSyncService | null = null;

export function setDeafenSyncService(service: DeafenSyncService): void {
  deafenSyncService = service;
}

export const voiceStateUpdateEvent: AnyModuleEvent = {
  name: 'voiceStateUpdate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const newState = args[1] as VoiceState;

    if (!deafenSyncService) return;
    if (newState.member?.user.bot) return;
    if (!deafenSyncService.get(newState.guild.id, newState.id)) return;

    await deafenSyncService.sync(newState);
  },
};
