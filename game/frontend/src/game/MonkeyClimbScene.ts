import Phaser from "phaser";

const WORLD_WIDTH = 480;
const GAME_HEIGHT = 720;

const GRAVITY_Y = 1400;
const JUMP_VELOCITY = -650;
const MOVE_SPEED = 220;

const PLATFORM_WIDTH = 92;
const START_PLATFORM_WIDTH = 200;
const PLATFORM_HEIGHT = 18;
const PLATFORM_GAP_MIN = 80;
const PLATFORM_GAP_MAX = 130;
const BANANA_CHANCE = 0.55;

// At the largest gap (PLATFORM_GAP_MAX), a jump held in one direction the whole
// arc covers roughly 140px horizontally before landing. Keep new platforms
// within a safely smaller radius of the previous one so every jump the
// generator produces is always reachable, regardless of gap size.
const MAX_HORIZONTAL_REACH = 110;

const COLOR_SKY = 0xf2ecdd;
const COLOR_INK = 0x111111;
const COLOR_PLATFORM = 0x23c55e;
const COLOR_YELLOW = 0xffd100;
const COLOR_PINK = 0xff3b6e;

const FONT = "'Space Mono', monospace";

function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

type PlatformBody = Phaser.Physics.Arcade.Sprite;
type BananaBody = Phaser.Physics.Arcade.Sprite;

export class MonkeyClimbScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private platforms!: Phaser.Physics.Arcade.Group;
  private bananas!: Phaser.Physics.Arcade.Group;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key; r: Phaser.Input.Keyboard.Key };

  private highestPlatformY = 0;
  private lastPlatformX = WORLD_WIDTH / 2;
  private minCameraScrollY = 0;
  private startY = 0;
  private bananaCount = 0;
  private maxHeightScore = 0;
  private gameOver = false;

  private hudHeight!: Phaser.GameObjects.Text;
  private hudBananas!: Phaser.GameObjects.Text;
  private gameOverText!: Phaser.GameObjects.Text;

  constructor() {
    super("MonkeyClimb");
  }

  preload() {
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(COLOR_PLATFORM, 1);
    g.fillRoundedRect(0, 0, PLATFORM_WIDTH, PLATFORM_HEIGHT, 6);
    g.lineStyle(3, COLOR_INK, 1);
    g.strokeRoundedRect(1.5, 1.5, PLATFORM_WIDTH - 3, PLATFORM_HEIGHT - 3, 6);
    g.generateTexture("platform", PLATFORM_WIDTH, PLATFORM_HEIGHT);
    g.clear();
    g.fillStyle(COLOR_PLATFORM, 1);
    g.fillRoundedRect(0, 0, START_PLATFORM_WIDTH, PLATFORM_HEIGHT, 6);
    g.lineStyle(3, COLOR_INK, 1);
    g.strokeRoundedRect(1.5, 1.5, START_PLATFORM_WIDTH - 3, PLATFORM_HEIGHT - 3, 6);
    g.generateTexture("platform-start", START_PLATFORM_WIDTH, PLATFORM_HEIGHT);
    g.clear();
    g.fillStyle(0xffffff, 0);
    g.fillRect(0, 0, 4, 4);
    g.generateTexture("blank", 4, 4);
    g.destroy();
  }

  create() {
    this.gameOver = false;
    this.bananaCount = 0;
    this.maxHeightScore = 0;
    this.highestPlatformY = 0;
    this.lastPlatformX = WORLD_WIDTH / 2;
    this.minCameraScrollY = 0;

    this.cameras.main.setBackgroundColor(COLOR_SKY);
    this.physics.world.gravity.y = GRAVITY_Y;

    this.platforms = this.physics.add.group({ allowGravity: false, immovable: true });
    this.bananas = this.physics.add.group({ allowGravity: false });

    const groundY = GAME_HEIGHT - 40;
    this.spawnPlatform(WORLD_WIDTH / 2, groundY, false, "platform-start");
    this.highestPlatformY = groundY;
    while (this.highestPlatformY > -GAME_HEIGHT) {
      this.spawnNextPlatformRow();
    }

    this.startY = groundY - 30;
    this.player = this.physics.add.sprite(WORLD_WIDTH / 2, this.startY, "blank");
    this.player.setVisible(false);
    this.player.setSize(30, 40);
    this.player.setCollideWorldBounds(false);
    this.player.setDepth(10);

    const monkeyGlyph = this.add.text(WORLD_WIDTH / 2, this.startY, "\u{1F412}", { fontSize: "40px" }).setOrigin(0.5);
    this.player.setData("glyph", monkeyGlyph);

    this.physics.add.collider(this.player, this.platforms, undefined, (player) => {
      const body = (player as Phaser.Physics.Arcade.Sprite).body as Phaser.Physics.Arcade.Body;
      return body.velocity.y >= 0;
    });

    this.physics.add.overlap(this.player, this.bananas, (_player, banana) => {
      const b = banana as BananaBody;
      (b.getData("glyph") as Phaser.GameObjects.Text).destroy();
      b.destroy();
      this.bananaCount += 1;
      this.hudBananas.setText(`BANANAS ${this.bananaCount}`);
    });

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = {
      w: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      d: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      r: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R),
    };

    this.cameras.main.setBounds(0, -1e7, WORLD_WIDTH, 1e7 + GAME_HEIGHT);
    this.minCameraScrollY = this.cameras.main.scrollY;

    this.hudHeight = this.add
      .text(14, 12, "HEIGHT 0", { fontFamily: FONT, fontSize: "18px", color: toCss(COLOR_INK), backgroundColor: toCss(COLOR_YELLOW), padding: { x: 8, y: 4 } })
      .setScrollFactor(0)
      .setDepth(20);
    this.hudBananas = this.add
      .text(14, 44, "BANANAS 0", { fontFamily: FONT, fontSize: "18px", color: toCss(COLOR_INK), backgroundColor: "#ffffff", padding: { x: 8, y: 4 } })
      .setScrollFactor(0)
      .setDepth(20);

    this.gameOverText = this.add
      .text(WORLD_WIDTH / 2, GAME_HEIGHT / 2, "", {
        fontFamily: FONT,
        fontSize: "26px",
        color: toCss(COLOR_INK),
        align: "center",
        backgroundColor: toCss(COLOR_PINK),
        padding: { x: 16, y: 12 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(30)
      .setVisible(false);
  }

  private spawnPlatform(x: number, y: number, withBanana: boolean, texture: string = "platform") {
    const platform = this.platforms.create(x, y, texture) as PlatformBody;
    platform.refreshBody();

    if (withBanana) {
      const banana = this.bananas.create(x, y - 26, "blank") as BananaBody;
      banana.setVisible(false);
      banana.setSize(24, 24);
      const glyph = this.add.text(x, y - 26, "\u{1F34C}", { fontSize: "26px" }).setOrigin(0.5);
      banana.setData("glyph", glyph);
    }
  }

  private spawnNextPlatformRow() {
    const gap = Phaser.Math.Between(PLATFORM_GAP_MIN, PLATFORM_GAP_MAX);
    const y = this.highestPlatformY - gap;
    const minX = PLATFORM_WIDTH / 2 + 10;
    const maxX = WORLD_WIDTH - PLATFORM_WIDTH / 2 - 10;
    const offset = Phaser.Math.Between(-MAX_HORIZONTAL_REACH, MAX_HORIZONTAL_REACH);
    const x = Phaser.Math.Clamp(this.lastPlatformX + offset, minX, maxX);
    this.spawnPlatform(x, y, Math.random() < BANANA_CHANCE);
    this.highestPlatformY = y;
    this.lastPlatformX = x;
  }

  update() {
    if (this.gameOver) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
        this.scene.restart();
      }
      return;
    }

    const left = this.cursors.left?.isDown || this.keys.a.isDown;
    const right = this.cursors.right?.isDown || this.keys.d.isDown;
    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up!) ||
      Phaser.Input.Keyboard.JustDown(this.cursors.space!) ||
      Phaser.Input.Keyboard.JustDown(this.keys.w);

    if (left) this.player.setVelocityX(-MOVE_SPEED);
    else if (right) this.player.setVelocityX(MOVE_SPEED);
    else this.player.setVelocityX(0);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (jumpPressed && body.blocked.down) {
      this.player.setVelocityY(JUMP_VELOCITY);
    }

    if (this.player.x < -20) this.player.x = WORLD_WIDTH + 20;
    else if (this.player.x > WORLD_WIDTH + 20) this.player.x = -20;

    const glyph = this.player.getData("glyph") as Phaser.GameObjects.Text;
    glyph.setPosition(this.player.x, this.player.y);
    if (this.player.body!.velocity.x < -5) glyph.setScale(-1, 1);
    else if (this.player.body!.velocity.x > 5) glyph.setScale(1, 1);

    const targetScrollY = this.player.y - GAME_HEIGHT * 0.6;
    if (targetScrollY < this.minCameraScrollY) {
      this.minCameraScrollY = targetScrollY;
      this.cameras.main.scrollY = targetScrollY;
    }

    while (this.highestPlatformY > this.cameras.main.scrollY - GAME_HEIGHT) {
      this.spawnNextPlatformRow();
    }

    const cullBelow = this.cameras.main.scrollY + GAME_HEIGHT + 80;
    this.platforms.getChildren().forEach((p) => {
      const sprite = p as PlatformBody;
      if (sprite.y > cullBelow) sprite.destroy();
    });
    this.bananas.getChildren().forEach((b) => {
      const sprite = b as BananaBody;
      if (sprite.y > cullBelow) {
        (sprite.getData("glyph") as Phaser.GameObjects.Text | undefined)?.destroy();
        sprite.destroy();
      }
    });

    const heightScore = Math.max(0, Math.floor((this.startY - this.player.y) / 10));
    this.maxHeightScore = Math.max(this.maxHeightScore, heightScore);
    this.hudHeight.setText(`HEIGHT ${heightScore}`);

    if (this.player.y > this.cameras.main.scrollY + GAME_HEIGHT + 60) {
      this.endGame();
    }
  }

  private endGame() {
    this.gameOver = true;
    this.player.setVelocity(0, 0);
    (this.player.getData("glyph") as Phaser.GameObjects.Text).setVisible(false);
    this.gameOverText
      .setText(`GAME OVER\n\nHEIGHT ${this.maxHeightScore}\nBANANAS ${this.bananaCount}\n\nPRESS R TO RESTART`)
      .setVisible(true);
  }
}

export function createMonkeyGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WORLD_WIDTH,
    height: GAME_HEIGHT,
    physics: {
      default: "arcade",
      arcade: { gravity: { x: 0, y: GRAVITY_Y }, debug: false },
    },
    scene: [MonkeyClimbScene],
    backgroundColor: toCss(COLOR_SKY),
  });
}
