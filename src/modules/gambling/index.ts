/**
 * Gambling Module - Casino-style games using points
 *
 * Features:
 * - Coinflip - 50/50 chance, 2x payout
 * - Slots - Variable payouts up to 50x for jackpot
 * - Roulette - Various bet types (colors, numbers, dozens)
 * - Blackjack - Classic card game against the dealer
 *
 * Commands:
 * - /gamble coinflip <bet> - Flip a coin
 * - /gamble slots <bet> - Spin the slot machine
 * - /gamble roulette <bet> - Play roulette
 * - /gamble blackjack <bet> - Play blackjack
 * - /gamble stats [user] - View gambling statistics
 * - /gamble paytable - View slots paytable
 *
 * Dependencies:
 * - points: Required for wagering and payouts
 */

import { GamblingModule } from './module.js';

export default new GamblingModule();
export { GamblingModule };
export { GamblingStatsService } from './services/GamblingStatsService.js';
export { BlackjackService } from './services/BlackjackService.js';
export { RouletteService } from './services/RouletteService.js';
export { RPSService } from './services/RPSService.js';
