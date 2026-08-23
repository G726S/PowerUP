import Phaser from "phaser";

const WORLD_WIDTH = 800;
const GAME_HEIGHT = 450;
const GROUND_Y = GAME_HEIGHT - 70;

const MOVE_SPEED = 260;
const MOVE_TICK_INTERVAL_MS = 400;

const PLAYER_MAX_HEALTH = 100;
const PLAYER_DAMAGE = 14;
const PLAYER_ATTACK_RANGE = 110;
const PLAYER_ATTACK_COOLDOWN_MS = 450;

const ENEMY_MAX_HEALTH = 80;
const ENEMY_DAMAGE = 8;
const ENEMY_SPEED = 130;
const ENEMY_ATTACK_RANGE = 100;
const ENEMY_ATTACK_COOLDOWN_MS = 950;

const COLOR_SKY_TOP = 0xffd9a0;
const COLOR_SKY_BOTTOM = 0xffb066;
const COLOR_GROUND = 0x8a5a34;
const COLOR_INK = 0x111111;
const COLOR_PLAYER_BAR = 0x2fd66b;
const COLOR_ENEMY_BAR = 0xff3b6e;

const FONT = "'Space Mono', monospace";

function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Fires on the scene's own event emitter (this.events) so the owning React
 * component can drive the outer energy meter/session timer/MCQ overlay --
 * same bridge pattern as MonkeyClimbScene. This scene owns the fight
 * visuals/AI only, not the study-app economy. */
export interface SamuraiDuelSceneEvents {
  "move-tick": () => void;
  attack: () => void;
  "round-result": (result: { won: boolean }) => void;
}

export class SamuraiDuelScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Text;
  private enemy!: Phaser.GameObjects.Text;
  private playerX = 200;
  private enemyX = 600;
  private playerHealth = PLAYER_MAX_HEALTH;
  private enemyHealth = ENEMY_MAX_HEALTH;
  private playerAttackReadyAt = 0;
  private enemyAttackReadyAt = 0;
  private isMoving = false;
  private roundOver = false;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key };

  private playerBarBg!: Phaser.GameObjects.Rectangle;
  private playerBarFill!: Phaser.GameObjects.Rectangle;
  private enemyBarBg!: Phaser.GameObjects.Rectangle;
  private enemyBarFill!: Phaser.GameObjects.Rectangle;
  private bannerText!: Phaser.GameObjects.Text;

  constructor() {
    super("SamuraiDuel");
  }

  create() {
    this.playerX = 200;
    this.enemyX = 600;
    this.playerHealth = PLAYER_MAX_HEALTH;
    this.enemyHealth = ENEMY_MAX_HEALTH;
    this.playerAttackReadyAt = 0;
    this.enemyAttackReadyAt = 0;
    this.isMoving = false;
    this.roundOver = false;

    const sky = this.add.graphics().setDepth(-10);
    sky.fillGradientStyle(COLOR_SKY_TOP, COLOR_SKY_TOP, COLOR_SKY_BOTTOM, COLOR_SKY_BOTTOM, 1);
    sky.fillRect(0, 0, WORLD_WIDTH, GAME_HEIGHT);

    const ground = this.add.graphics().setDepth(-5);
    ground.fillStyle(COLOR_GROUND, 1);
    ground.fillRect(0, GROUND_Y + 20, WORLD_WIDTH, GAME_HEIGHT - GROUND_Y - 20);
    ground.lineStyle(4, COLOR_INK, 1);
    ground.lineBetween(0, GROUND_Y + 20, WORLD_WIDTH, GROUND_Y + 20);

    this.player = this.add.text(this.playerX, GROUND_Y, "\u{1F977}", { fontSize: "64px" }).setOrigin(0.5, 1).setDepth(10);
    this.enemy = this.add
      .text(this.enemyX, GROUND_Y, "\u{1F479}", { fontSize: "64px" })
      .setOrigin(0.5, 1)
      .setFlipX(true)
      .setDepth(10);

    const barW = 220;
    this.playerBarBg = this.add.rectangle(20, 20, barW, 22, 0xffffff).setOrigin(0, 0).setStrokeStyle(3, COLOR_INK).setDepth(20);
    this.playerBarFill = this.add.rectangle(23, 23, barW - 6, 16, COLOR_PLAYER_BAR).setOrigin(0, 0).setDepth(21);
    this.enemyBarBg = this.add
      .rectangle(WORLD_WIDTH - 20 - barW, 20, barW, 22, 0xffffff)
      .setOrigin(0, 0)
      .setStrokeStyle(3, COLOR_INK)
      .setDepth(20);
    this.enemyBarFill = this.add
      .rectangle(WORLD_WIDTH - 20 - barW + 3, 23, barW - 6, 16, COLOR_ENEMY_BAR)
      .setOrigin(1, 0)
      .setDepth(21);
    this.enemyBarFill.setPosition(WORLD_WIDTH - 23, 23);

    this.add
      .text(WORLD_WIDTH / 2, 20, "SPACE TO ATTACK", { fontFamily: FONT, fontSize: "16px", color: toCss(COLOR_INK), backgroundColor: "#ffffff", padding: { x: 8, y: 4 } })
      .setOrigin(0.5, 0)
      .setDepth(20);

    this.bannerText = this.add
      .text(WORLD_WIDTH / 2, GAME_HEIGHT / 2, "", { fontFamily: FONT, fontSize: "40px", color: toCss(COLOR_INK), backgroundColor: "#ffd100", padding: { x: 20, y: 14 }, align: "center" })
      .setOrigin(0.5)
      .setDepth(30)
      .setVisible(false);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = {
      w: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      d: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.time.addEvent({
      delay: MOVE_TICK_INTERVAL_MS,
      loop: true,
      callback: () => {
        if (!this.roundOver && this.isMoving) this.events.emit("move-tick");
      },
    });
  }

  update(_time: number, delta: number) {
    if (this.roundOver) return;

    const left = this.cursors.left?.isDown || this.keys.a.isDown;
    const right = this.cursors.right?.isDown || this.keys.d.isDown;
    this.isMoving = Boolean(left || right);
    if (left) this.playerX = Math.max(30, this.playerX - (MOVE_SPEED * delta) / 1000);
    if (right) this.playerX = Math.min(WORLD_WIDTH - 30, this.playerX + (MOVE_SPEED * delta) / 1000);
    this.player.setPosition(this.playerX, GROUND_Y);
    this.player.setFlipX(this.enemyX < this.playerX);

    const distance = Math.abs(this.enemyX - this.playerX);

    // Enemy AI: approach until in range, then attack on cooldown.
    if (distance > ENEMY_ATTACK_RANGE) {
      const step = (ENEMY_SPEED * delta) / 1000;
      this.enemyX += this.enemyX > this.playerX ? -step : step;
    } else if (_time > this.enemyAttackReadyAt) {
      this.enemyAttackReadyAt = _time + ENEMY_ATTACK_COOLDOWN_MS;
      this.playerHealth = Math.max(0, this.playerHealth - ENEMY_DAMAGE);
    }
    this.enemy.setPosition(this.enemyX, GROUND_Y);
    this.enemy.setFlipX(this.playerX > this.enemyX);

    const attackPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.space!) || Phaser.Input.Keyboard.JustDown(this.keys.w);
    if (attackPressed && _time > this.playerAttackReadyAt) {
      this.playerAttackReadyAt = _time + PLAYER_ATTACK_COOLDOWN_MS;
      this.events.emit("attack");
      if (distance <= PLAYER_ATTACK_RANGE) {
        this.enemyHealth = Math.max(0, this.enemyHealth - PLAYER_DAMAGE);
      }
    }

    this.playerBarFill.width = (this.playerHealth / PLAYER_MAX_HEALTH) * (this.playerBarBg.width - 6);
    this.enemyBarFill.width = (this.enemyHealth / ENEMY_MAX_HEALTH) * (this.enemyBarBg.width - 6);

    if (this.playerHealth <= 0) this.endRound(false);
    else if (this.enemyHealth <= 0) this.endRound(true);
  }

  private endRound(won: boolean) {
    this.roundOver = true;
    this.bannerText.setText(won ? "VICTORY!" : "DEFEATED!").setVisible(true);
    this.events.emit("round-result", { won });
  }
}

export function createSamuraiDuel(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WORLD_WIDTH,
    height: GAME_HEIGHT,
    physics: { default: "arcade" },
    scene: [SamuraiDuelScene],
    backgroundColor: toCss(COLOR_SKY_TOP),
  });
}
