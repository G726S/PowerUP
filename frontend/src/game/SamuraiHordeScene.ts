import Phaser from "phaser";

// Real character art from the teammate's original pygame build (sprites/
// IDLE.png, RUN.png, ATTACK 1.png for both player and samurai) -- same
// characters and animations, just re-hosted as spritesheets for Phaser
// instead of the custom pygame sprite-sheet loader they were built for.
const PLAYER_FRAME = { frameWidth: 96, frameHeight: 84 };
const ENEMY_FRAME = { frameWidth: 96, frameHeight: 96 };
const SPRITE_SCALE = 2.2;

const WORLD_WIDTH = 900;
const GAME_HEIGHT = 520;
// A real 2D arena, not a single ground line -- matches the source's later
// revision, where the player gained W/S (up/down) alongside A/D, and
// enemies (which already approached via a full 2D vector) can genuinely
// close in from above/below as well as the sides once the player isn't
// confined to one row.
const ARENA_TOP = 90;
const ARENA_BOTTOM = GAME_HEIGHT - 40;

const MOVE_SPEED = 220;
const MOVE_TICK_INTERVAL_MS = 400;

const PLAYER_ATTACK_RANGE = 130;
const PLAYER_ATTACK_COOLDOWN_MS = 450;
const PLAYER_DAMAGE = 16;

const NUM_ENEMIES = 3;
const ENEMY_MAX_HEALTH = 40;
const ENEMY_SPEED = 105;
const ENEMY_ATTACK_RANGE = 110;
const ENEMY_ATTACK_COOLDOWN_MS = 1100;
const ENEMY_RESPAWN_DELAY_MS = 900;

const COLOR_SKY_TOP = 0xcfe8ff;
const COLOR_SKY_BOTTOM = 0x8fc7ef;
const COLOR_GROUND = 0x7a9e5f;
const COLOR_INK = 0x111111;
const COLOR_ENEMY_BAR = 0xff3b6e;

const FONT = "'Space Mono', monospace";

function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Fires on the scene's own event emitter (this.events) so the owning React
 * component can drive the outer energy meter/session timer/MCQ overlay --
 * same bridge pattern as MonkeyClimbScene. There's no
 * separate in-game health bar here -- getting hit drains the SAME energy
 * meter that moving/attacking already spends, so combat damage and "out of
 * energy" are one mechanic, not two: taking a beating just means you need
 * to answer a question sooner. */
export interface SamuraiHordeSceneEvents {
  "move-tick": () => void;
  attack: () => void;
  hit: () => void;
  kills: (total: number) => void;
}

interface HordeEnemy {
  sprite: Phaser.GameObjects.Sprite;
  barBg: Phaser.GameObjects.Rectangle;
  barFill: Phaser.GameObjects.Rectangle;
  x: number;
  y: number;
  health: number;
  attackReadyAt: number;
  alive: boolean;
  respawnAt: number;
}

export class SamuraiHordeScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Sprite;
  private enemies: HordeEnemy[] = [];
  private playerX = WORLD_WIDTH / 2;
  private playerY = (ARENA_TOP + ARENA_BOTTOM) / 2;
  private playerAttackReadyAt = 0;
  private isMoving = false;
  private kills = 0;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; s: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key };

  private killsText!: Phaser.GameObjects.Text;

  constructor() {
    super("SamuraiHorde");
  }

  preload() {
    this.load.spritesheet("player-idle", "/samurai-horde/player-idle.png", PLAYER_FRAME);
    this.load.spritesheet("player-run", "/samurai-horde/player-run.png", PLAYER_FRAME);
    this.load.spritesheet("player-attack", "/samurai-horde/player-attack.png", PLAYER_FRAME);
    this.load.spritesheet("enemy-idle", "/samurai-horde/enemy-idle.png", ENEMY_FRAME);
    this.load.spritesheet("enemy-run", "/samurai-horde/enemy-run.png", ENEMY_FRAME);
    this.load.spritesheet("enemy-attack", "/samurai-horde/enemy-attack.png", ENEMY_FRAME);
  }

  create() {
    this.playerX = WORLD_WIDTH / 2;
    this.playerY = (ARENA_TOP + ARENA_BOTTOM) / 2;
    this.playerAttackReadyAt = 0;
    this.isMoving = false;
    this.kills = 0;
    this.enemies = [];

    if (!this.anims.exists("player-idle-anim")) {
      this.anims.create({ key: "player-idle-anim", frames: this.anims.generateFrameNumbers("player-idle"), frameRate: 8, repeat: -1 });
      this.anims.create({ key: "player-run-anim", frames: this.anims.generateFrameNumbers("player-run"), frameRate: 12, repeat: -1 });
      this.anims.create({ key: "player-attack-anim", frames: this.anims.generateFrameNumbers("player-attack"), frameRate: 16, repeat: 0 });
      this.anims.create({ key: "enemy-idle-anim", frames: this.anims.generateFrameNumbers("enemy-idle"), frameRate: 8, repeat: -1 });
      this.anims.create({ key: "enemy-run-anim", frames: this.anims.generateFrameNumbers("enemy-run"), frameRate: 12, repeat: -1 });
      this.anims.create({ key: "enemy-attack-anim", frames: this.anims.generateFrameNumbers("enemy-attack"), frameRate: 16, repeat: 0 });
    }

    const sky = this.add.graphics().setDepth(-10);
    sky.fillGradientStyle(COLOR_SKY_TOP, COLOR_SKY_TOP, COLOR_SKY_BOTTOM, COLOR_SKY_BOTTOM, 1);
    sky.fillRect(0, 0, WORLD_WIDTH, GAME_HEIGHT);
    // The whole arena is walkable ground now (not just a strip at the
    // bottom) -- the player can move anywhere inside it.
    const ground = this.add.graphics().setDepth(-5);
    ground.fillStyle(COLOR_GROUND, 1);
    ground.fillRoundedRect(20, ARENA_TOP - 20, WORLD_WIDTH - 40, ARENA_BOTTOM - ARENA_TOP + 40, 16);
    ground.lineStyle(4, COLOR_INK, 1);
    ground.strokeRoundedRect(20, ARENA_TOP - 20, WORLD_WIDTH - 40, ARENA_BOTTOM - ARENA_TOP + 40, 16);

    this.player = this.add.sprite(this.playerX, this.playerY, "player-idle").setOrigin(0.5, 1).setScale(SPRITE_SCALE);
    this.player.play("player-idle-anim");

    for (let i = 0; i < NUM_ENEMIES; i++) {
      const sprite = this.add.sprite(0, 0, "enemy-idle").setOrigin(0.5, 1).setScale(SPRITE_SCALE);
      const barBg = this.add.rectangle(0, 0, 60, 8, 0xffffff).setStrokeStyle(2, COLOR_INK).setDepth(1000);
      const barFill = this.add.rectangle(0, 0, 56, 5, COLOR_ENEMY_BAR).setDepth(1001);
      const enemy: HordeEnemy = { sprite, barBg, barFill, x: 0, y: 0, health: ENEMY_MAX_HEALTH, attackReadyAt: 0, alive: true, respawnAt: 0 };
      this.respawnEnemy(enemy, true);
      this.enemies.push(enemy);
    }

    this.killsText = this.add
      .text(WORLD_WIDTH - 20, 20, "KILLS 0", { fontFamily: FONT, fontSize: "18px", color: toCss(COLOR_INK), backgroundColor: "#ffffff", padding: { x: 8, y: 4 } })
      .setOrigin(1, 0)
      .setDepth(20);
    this.add
      .text(20, 20, "WASD/ARROWS MOVE -- SPACE ATTACK", { fontFamily: FONT, fontSize: "14px", color: toCss(COLOR_INK), backgroundColor: "#ffffff", padding: { x: 8, y: 4 } })
      .setOrigin(0, 0)
      .setDepth(20);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = {
      w: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      s: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      d: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.time.addEvent({
      delay: MOVE_TICK_INTERVAL_MS,
      loop: true,
      callback: () => {
        if (this.isMoving) this.events.emit("move-tick");
      },
    });
  }

  private respawnEnemy(enemy: HordeEnemy, initial: boolean) {
    // Spawns anywhere around the player in a full circle, not just left or
    // right -- matches enemies being able to approach from any angle once
    // they're no longer pinned to a single row.
    const angle = Math.random() * Math.PI * 2;
    const dist = 260 + Math.random() * 220;
    enemy.x = Phaser.Math.Clamp(this.playerX + Math.cos(angle) * dist, 60, WORLD_WIDTH - 60);
    enemy.y = Phaser.Math.Clamp(this.playerY + Math.sin(angle) * dist, ARENA_TOP, ARENA_BOTTOM);
    enemy.health = ENEMY_MAX_HEALTH;
    enemy.alive = true;
    enemy.attackReadyAt = 0;
    enemy.sprite.setPosition(enemy.x, enemy.y).setVisible(true);
    enemy.sprite.play("enemy-idle-anim");
    enemy.barBg.setVisible(true);
    enemy.barFill.setVisible(true);
    if (!initial) {
      this.kills += 1;
      this.events.emit("kills", this.kills);
    }
  }

  update(time: number, delta: number) {
    const left = this.cursors.left?.isDown || this.keys.a.isDown;
    const right = this.cursors.right?.isDown || this.keys.d.isDown;
    const up = this.cursors.up?.isDown || this.keys.w.isDown;
    const down = this.cursors.down?.isDown || this.keys.s.isDown;
    this.isMoving = Boolean(left || right || up || down);
    const step = (MOVE_SPEED * delta) / 1000;
    if (left) this.playerX = Math.max(60, this.playerX - step);
    if (right) this.playerX = Math.min(WORLD_WIDTH - 60, this.playerX + step);
    if (up) this.playerY = Math.max(ARENA_TOP, this.playerY - step);
    if (down) this.playerY = Math.min(ARENA_BOTTOM, this.playerY + step);
    this.player.setPosition(this.playerX, this.playerY);
    this.player.setDepth(this.playerY);

    const attackPressed = Phaser.Input.Keyboard.JustDown(this.cursors.space!);
    const attacking = time < this.playerAttackReadyAt + 200 && attackPressed;
    if (attackPressed && time > this.playerAttackReadyAt) {
      this.playerAttackReadyAt = time + PLAYER_ATTACK_COOLDOWN_MS;
      this.events.emit("attack");
      this.player.play("player-attack-anim");
      for (const enemy of this.enemies) {
        if (!enemy.alive) continue;
        if (Phaser.Math.Distance.Between(enemy.x, enemy.y, this.playerX, this.playerY) <= PLAYER_ATTACK_RANGE) {
          enemy.health = Math.max(0, enemy.health - PLAYER_DAMAGE);
        }
      }
    } else if (!attacking) {
      if (this.isMoving) this.player.play("player-run-anim", true);
      else this.player.play("player-idle-anim", true);
    }
    const nearest = this.nearestEnemy();
    if (nearest) this.player.setFlipX(nearest.x < this.playerX);

    for (const enemy of this.enemies) {
      if (!enemy.alive) {
        if (time > enemy.respawnAt) {
          this.respawnEnemy(enemy, false);
          this.killsText.setText(`KILLS ${this.kills}`);
        }
        continue;
      }
      if (enemy.health <= 0) {
        enemy.alive = false;
        enemy.respawnAt = time + ENEMY_RESPAWN_DELAY_MS;
        enemy.sprite.setVisible(false);
        enemy.barBg.setVisible(false);
        enemy.barFill.setVisible(false);
        continue;
      }

      const dx = this.playerX - enemy.x;
      const dy = this.playerY - enemy.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > ENEMY_ATTACK_RANGE) {
        const enemyStep = (ENEMY_SPEED * delta) / 1000;
        enemy.x += (dx / dist) * enemyStep;
        enemy.y += (dy / dist) * enemyStep;
        enemy.sprite.play("enemy-run-anim", true);
      } else if (time > enemy.attackReadyAt) {
        enemy.attackReadyAt = time + ENEMY_ATTACK_COOLDOWN_MS;
        this.events.emit("hit");
        enemy.sprite.play("enemy-attack-anim");
      }
      enemy.sprite.setPosition(enemy.x, enemy.y);
      enemy.sprite.setDepth(enemy.y);
      enemy.sprite.setFlipX(this.playerX > enemy.x);
      enemy.barBg.setPosition(enemy.x - 30, enemy.y - ENEMY_FRAME.frameHeight * SPRITE_SCALE - 6);
      enemy.barFill.setPosition(enemy.x - 27, enemy.y - ENEMY_FRAME.frameHeight * SPRITE_SCALE - 3);
      enemy.barFill.width = (enemy.health / ENEMY_MAX_HEALTH) * 56;
    }
  }

  private nearestEnemy(): HordeEnemy | null {
    let best: HordeEnemy | null = null;
    let bestDist = Infinity;
    for (const enemy of this.enemies) {
      if (!enemy.alive) continue;
      const d = Phaser.Math.Distance.Between(enemy.x, enemy.y, this.playerX, this.playerY);
      if (d < bestDist) {
        bestDist = d;
        best = enemy;
      }
    }
    return best;
  }
}

export function createSamuraiHorde(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WORLD_WIDTH,
    height: GAME_HEIGHT,
    physics: { default: "arcade" },
    scene: [SamuraiHordeScene],
    backgroundColor: toCss(COLOR_SKY_TOP),
  });
}
