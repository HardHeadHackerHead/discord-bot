/**
 * Shared types for the gambling module.
 *
 * All game-specific services, game logic files, command handlers,
 * and event handlers import from here instead of from individual services.
 */

export type GameType = 'coinflip' | 'slots' | 'roulette' | 'blackjack' | 'rps';
export type GameOutcome = 'win' | 'loss' | 'push';
export type RPSChoice = 'rock' | 'paper' | 'scissors';

export interface GamblingStats {
  id: string;
  user_id: string;
  guild_id: string;
  total_bets: number;
  total_wagered: number;
  total_won: number;
  total_lost: number;
  net_profit: number;
  biggest_win: number;
  biggest_loss: number;
  current_streak: number;
  best_win_streak: number;
  worst_loss_streak: number;
  coinflip_wins: number;
  coinflip_losses: number;
  slots_wins: number;
  slots_losses: number;
  roulette_wins: number;
  roulette_losses: number;
  blackjack_wins: number;
  blackjack_losses: number;
  blackjack_pushes: number;
  rps_wins: number;
  rps_losses: number;
  bankruptcies: number;
  created_at: Date;
  updated_at: Date;
}

export interface GamblingHistory {
  id: string;
  user_id: string;
  guild_id: string;
  game_type: GameType;
  bet_amount: number;
  outcome: GameOutcome;
  payout: number;
  multiplier: number;
  game_data: unknown;
  created_at: Date;
}

export interface GameResult {
  outcome: GameOutcome;
  payout: number;
  multiplier: number;
  gameData?: unknown;
}

export interface Card {
  suit: 'hearts' | 'diamonds' | 'clubs' | 'spades';
  rank: string;
  value: number;
}

export type HandStatus = 'playing' | 'standing' | 'busted' | 'blackjack';
export type CurrentHand = 'main' | 'split';

export interface BlackjackGame {
  id: string;
  user_id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  bet_amount: number;
  split_bet_amount: number;
  player_hand: Card[];
  split_hand: Card[] | null;
  dealer_hand: Card[];
  deck: Card[];
  status: 'playing' | 'standing' | 'busted' | 'blackjack' | 'dealer_turn' | 'finished';
  current_hand: CurrentHand;
  main_hand_status: HandStatus;
  split_hand_status: HandStatus | null;
  has_split: boolean;
  created_at: Date;
  expires_at: Date;
}

export interface RouletteGame {
  id: string;
  guild_id: string;
  channel_id: string;
  voice_channel_id: string;
  message_id: string | null;
  status: 'betting' | 'spinning' | 'finished';
  result_number: number | null;
  result_color: 'red' | 'black' | 'green' | null;
  betting_ends_at: Date;
  created_at: Date;
}

export interface RouletteBet {
  id: string;
  game_id: string;
  user_id: string;
  bet_type: string;
  bet_number: number | null;
  bet_amount: number;
  payout: number;
  outcome: 'pending' | 'win' | 'loss';
  created_at: Date;
}

export interface RPSChallenge {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  challenger_id: string;
  opponent_id: string;
  bet_amount: number;
  status: 'pending' | 'accepted' | 'completed' | 'expired' | 'declined' | 'forfeited';
  challenger_choice: RPSChoice | null;
  opponent_choice: RPSChoice | null;
  winner_id: string | null;
  expires_at: Date;
  choice_deadline: Date | null;
  created_at: Date;
}
