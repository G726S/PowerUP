// Shared across every game in the lobby -- both Monkey Climb and Samurai
// Duel run the same core loop: a running session timer, an energy meter
// that actions drain, and MCQs that refuel it. Game-specific action costs
// (jump/move/attack costs, banana bonuses, etc.) stay local to each game.
export const STARTING_ENERGY = 2000; // starting point (and respawn baseline) -- NOT a ceiling, energy can grow past this
export const CORRECT_ANSWER_BONUS = 250;
export const LOW_ENERGY_THRESHOLD = 500;
export const DEFAULT_SESSION_SECONDS = 600; // 10 minutes
