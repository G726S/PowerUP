import Phaser from "phaser";

const PLAY_WIDTH = 420; // the actual jumpable lane
const SIDE_MARGIN = 90; // decorative tree strip on each side
const WORLD_WIDTH = PLAY_WIDTH + SIDE_MARGIN * 2;
const GAME_HEIGHT = 720;

const GRAVITY_Y = 1400;
const JUMP_VELOCITY = -650;
const MOVE_SPEED = 240;

const PLATFORM_WIDTH = 100;
const START_PLATFORM_WIDTH = 220;
const PLATFORM_HEIGHT = 24;
const PLATFORM_GAP_MIN = 80;
const PLATFORM_GAP_MAX = 130;
const BANANA_CHANCE = 0.55;

// At the largest gap (PLATFORM_GAP_MAX), a jump held in one direction the whole
// arc covers roughly 140px horizontally before landing. Keep new platforms
// within a safely smaller radius of the previous one so every jump the
// generator produces is always reachable, regardless of gap size.
const MAX_HORIZONTAL_REACH = 110;

// How often a held movement key charges the outer energy meter -- matches
// the same interval Samurai Duel uses, so "moving costs energy" feels the
// same across every game rather than being a per-frame drain.
const MOVE_TICK_INTERVAL_MS = 400;

// The camera creeps upward on its own, independent of the player -- standing
// still (or being slow between jumps) means the floor is coming for you, not
// a leisurely free-climb. Paused along with everything else while an MCQ is
// open (see Scene.pause() in MonkeyGame.tsx), so the pressure is only ever
// live while you're actually playing.
const AUTO_SCROLL_SPEED = 42; // px/sec

const COLOR_SKY_TOP = 0x8ecdf0;
const COLOR_SKY_BOTTOM = 0xdff3ff;
const COLOR_INK = 0x111111;
const COLOR_PLATFORM = 0x2fd66b;
const COLOR_PLATFORM_START = 0xffb020;
const COLOR_YELLOW = 0xffd100;
const COLOR_TRUNK = 0x7a4a26;
const COLOR_LEAF = 0x1f9c4a;

const FONT = "'Space Mono', monospace";

function toCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

type PlatformBody = Phaser.Physics.Arcade.Sprite;
type BananaBody = Phaser.Physics.Arcade.Sprite;
type TreeSprite = Phaser.GameObjects.Image;

/** Fires on the scene's own event emitter (this.events) so the owning React
 * component can drive the outer energy meter/session timer/MCQ overlay --
 * this scene owns the physics/visuals only, not the study-app economy. */
export interface MonkeyClimbSceneEvents {
  jump: () => void;
  "move-tick": () => void;
  banana: (count: number) => void;
  height: (height: number) => void;
  gameover: (stats: { height: number; bananas: number }) => void;
}

export class MonkeyClimbScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private platforms!: Phaser.Physics.Arcade.Group;
  private bananas!: Phaser.Physics.Arcade.Group;
  private leftTrees: TreeSprite[] = [];
  private rightTrees: TreeSprite[] = [];
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys!: { w: Phaser.Input.Keyboard.Key; a: Phaser.Input.Keyboard.Key; d: Phaser.Input.Keyboard.Key };

  private highestPlatformY = 0;
  private highestTreeY = 0;
  private lastPlatformX = WORLD_WIDTH / 2;
  private minCameraScrollY = 0;
  private autoScrollY = 0;
  private startY = 0;
  private bananaCount = 0;
  private maxHeightScore = 0;
  private lastEmittedHeight = -1;
  private gameOver = false;
  private isMoving = false;

  private hudHeight!: Phaser.GameObjects.Text;

  constructor() {
    super("MonkeyClimb");
  }

  preload() {
    const g = this.make.graphics({ x: 0, y: 0 });

    g.fillStyle(COLOR_PLATFORM, 1);
    g.fillRoundedRect(0, 0, PLATFORM_WIDTH, PLATFORM_HEIGHT, 8);
    g.lineStyle(4, COLOR_INK, 1);
    g.strokeRoundedRect(2, 2, PLATFORM_WIDTH - 4, PLATFORM_HEIGHT - 4, 8);
    g.fillStyle(0xffffff, 0.35);
    g.fillRoundedRect(4, 3, PLATFORM_WIDTH - 8, 5, 3);
    g.generateTexture("platform", PLATFORM_WIDTH, PLATFORM_HEIGHT);

    g.clear();
    g.fillStyle(COLOR_PLATFORM_START, 1);
    g.fillRoundedRect(0, 0, START_PLATFORM_WIDTH, PLATFORM_HEIGHT, 8);
    g.lineStyle(4, COLOR_INK, 1);
    g.strokeRoundedRect(2, 2, START_PLATFORM_WIDTH - 4, PLATFORM_HEIGHT - 4, 8);
    g.generateTexture("platform-start", START_PLATFORM_WIDTH, PLATFORM_HEIGHT);

    g.clear();
    g.fillStyle(0xffffff, 0);
    g.fillRect(0, 0, 4, 4);
    g.generateTexture("blank", 4, 4);

    // A simple two-tone tree -- trunk + a rounded canopy -- as its own
    // texture so it can be dropped in cheaply as decoration on both edges.
    const treeW = 56;
    const treeH = 96;
    g.clear();
    g.fillStyle(COLOR_TRUNK, 1);
    g.fillRect(treeW / 2 - 6, treeH - 34, 12, 34);
    g.fillStyle(COLOR_LEAF, 1);
    g.fillCircle(treeW / 2, treeH - 60, 26);
    g.fillCircle(treeW / 2 - 16, treeH - 42, 20);
    g.fillCircle(treeW / 2 + 16, treeH - 42, 20);
    g.lineStyle(3, COLOR_INK, 0.5);
    g.strokeCircle(treeW / 2, treeH - 60, 26);
    g.generateTexture("tree", treeW, treeH);

    g.destroy();
  }

  create() {
    this.gameOver = false;
    this.isMoving = false;
    this.bananaCount = 0;
    this.maxHeightScore = 0;
    this.lastEmittedHeight = -1;
    this.highestPlatformY = 0;
    this.highestTreeY = 0;
    this.lastPlatformX = WORLD_WIDTH / 2;
    this.minCameraScrollY = 0;
    this.autoScrollY = 0;
    this.leftTrees = [];
    this.rightTrees = [];

    // Vertical sky gradient instead of a flat fill, plus the tree margins,
    // reads far less flat/empty than a single solid color.
    this.cameras.main.setBackgroundColor(COLOR_SKY_TOP);
    const sky = this.add.graphics().setScrollFactor(0).setDepth(-10);
    sky.fillGradientStyle(COLOR_SKY_TOP, COLOR_SKY_TOP, COLOR_SKY_BOTTOM, COLOR_SKY_BOTTOM, 1);
    sky.fillRect(0, 0, WORLD_WIDTH, GAME_HEIGHT);

    this.physics.world.gravity.y = GRAVITY_Y;

    this.platforms = this.physics.add.group({ allowGravity: false, immovable: true });
    this.bananas = this.physics.add.group({ allowGravity: false });

    const groundY = GAME_HEIGHT - 40;
    this.spawnPlatform(WORLD_WIDTH / 2, groundY, false, "platform-start");
    this.highestPlatformY = groundY;
    while (this.highestPlatformY > -GAME_HEIGHT) {
      this.spawnNextPlatformRow();
    }
    this.highestTreeY = groundY + 60;
    while (this.highestTreeY > -GAME_HEIGHT) {
      this.spawnTreeRow();
    }

    this.startY = groundY - 30;
    this.player = this.physics.add.sprite(WORLD_WIDTH / 2, this.startY, "blank");
    this.player.setVisible(false);
    this.player.setSize(30, 40);
    this.player.setCollideWorldBounds(false);
    this.player.setDepth(10);

    const monkeyGlyph = this.add
      .text(WORLD_WIDTH / 2, this.startY, "\u{1F412}", {
        fontSize: "50px",
        stroke: "#ffffff",
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setDepth(11);
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
      this.events.emit("banana", this.bananaCount);
    });

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.keys = {
      w: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      a: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      d: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };

    this.cameras.main.setBounds(0, -1e7, WORLD_WIDTH, 1e7 + GAME_HEIGHT);
    this.minCameraScrollY = this.cameras.main.scrollY;
    this.autoScrollY = this.cameras.main.scrollY;

    // Inset well clear of the canvas corners -- sitting right at the edge
    // got visually clipped by the wrapping card's rounded border outside
    // the canvas.
    this.hudHeight = this.add
      .text(20, 20, "HEIGHT 0", { fontFamily: FONT, fontSize: "20px", color: toCss(COLOR_INK), backgroundColor: toCss(COLOR_YELLOW), padding: { x: 10, y: 6 } })
      .setScrollFactor(0)
      .setDepth(20);

    // A held move key charges the outer energy meter on a fixed cadence
    // (not every frame) -- this timer is recreated fresh each create() call
    // (i.e. each restart), so it never accumulates duplicate ticks.
    this.time.addEvent({
      delay: MOVE_TICK_INTERVAL_MS,
      loop: true,
      callback: () => {
        if (!this.gameOver && this.isMoving) this.events.emit("move-tick");
      },
    });
  }

  private spawnPlatform(x: number, y: number, withBanana: boolean, texture: string = "platform") {
    const platform = this.platforms.create(x, y, texture) as PlatformBody;
    platform.refreshBody();

    if (withBanana) {
      const banana = this.bananas.create(x, y - 30, "blank") as BananaBody;
      banana.setVisible(false);
      banana.setSize(24, 24);
      const glyph = this.add.text(x, y - 30, "\u{1F34C}", { fontSize: "30px" }).setOrigin(0.5).setDepth(9);
      banana.setData("glyph", glyph);
    }
  }

  private spawnNextPlatformRow() {
    const gap = Phaser.Math.Between(PLATFORM_GAP_MIN, PLATFORM_GAP_MAX);
    const y = this.highestPlatformY - gap;
    const minX = SIDE_MARGIN + PLATFORM_WIDTH / 2 + 6;
    const maxX = WORLD_WIDTH - SIDE_MARGIN - PLATFORM_WIDTH / 2 - 6;
    const offset = Phaser.Math.Between(-MAX_HORIZONTAL_REACH, MAX_HORIZONTAL_REACH);
    const x = Phaser.Math.Clamp(this.lastPlatformX + offset, minX, maxX);
    this.spawnPlatform(x, y, Math.random() < BANANA_CHANCE);
    this.highestPlatformY = y;
    this.lastPlatformX = x;
  }

  private spawnTreeRow() {
    const y = this.highestTreeY - Phaser.Math.Between(90, 140);
    const scale = Phaser.Math.FloatBetween(0.8, 1.25);
    const leftX = Phaser.Math.Between(16, SIDE_MARGIN - 36);
    const rightX = WORLD_WIDTH - Phaser.Math.Between(16, SIDE_MARGIN - 36);
    this.leftTrees.push(this.add.image(leftX, y, "tree").setScale(scale).setDepth(1));
    this.rightTrees.push(this.add.image(rightX, y, "tree").setScale(scale).setFlipX(true).setDepth(1));
    this.highestTreeY = y;
  }

  update(_time: number, delta: number) {
    if (this.gameOver) return;

    const left = this.cursors.left?.isDown || this.keys.a.isDown;
    const right = this.cursors.right?.isDown || this.keys.d.isDown;
    const jumpPressed =
      Phaser.Input.Keyboard.JustDown(this.cursors.up!) ||
      Phaser.Input.Keyboard.JustDown(this.cursors.space!) ||
      Phaser.Input.Keyboard.JustDown(this.keys.w);

    this.isMoving = Boolean(left || right);
    if (left) this.player.setVelocityX(-MOVE_SPEED);
    else if (right) this.player.setVelocityX(MOVE_SPEED);
    else this.player.setVelocityX(0);

    const body = this.player.body as Phaser.Physics.Arcade.Body;
    if (jumpPressed && body.blocked.down) {
      this.player.setVelocityY(JUMP_VELOCITY);
      this.events.emit("jump");
    }

    const playLeft = SIDE_MARGIN - 20;
    const playRight = WORLD_WIDTH - SIDE_MARGIN + 20;
    if (this.player.x < playLeft) this.player.x = playRight;
    else if (this.player.x > playRight) this.player.x = playLeft;

    const glyph = this.player.getData("glyph") as Phaser.GameObjects.Text;
    glyph.setPosition(this.player.x, this.player.y);
    if (this.player.body!.velocity.x < -5) glyph.setScale(-1, 1);
    else if (this.player.body!.velocity.x > 5) glyph.setScale(1, 1);

    // Forced pace: the camera never stops creeping upward on its own, on
    // top of however fast the player's own climbing pulls it up.
    this.autoScrollY -= (AUTO_SCROLL_SPEED * delta) / 1000;
    const targetScrollY = this.player.y - GAME_HEIGHT * 0.6;
    this.minCameraScrollY = Math.min(this.minCameraScrollY, targetScrollY, this.autoScrollY);
    this.cameras.main.scrollY = this.minCameraScrollY;

    while (this.highestPlatformY > this.cameras.main.scrollY - GAME_HEIGHT) {
      this.spawnNextPlatformRow();
    }
    while (this.highestTreeY > this.cameras.main.scrollY - GAME_HEIGHT) {
      this.spawnTreeRow();
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
    this.leftTrees = this.leftTrees.filter((t) => {
      if (t.y > cullBelow) {
        t.destroy();
        return false;
      }
      return true;
    });
    this.rightTrees = this.rightTrees.filter((t) => {
      if (t.y > cullBelow) {
        t.destroy();
        return false;
      }
      return true;
    });

    const heightScore = Math.max(0, Math.floor((this.startY - this.player.y) / 10));
    this.maxHeightScore = Math.max(this.maxHeightScore, heightScore);
    this.hudHeight.setText(`HEIGHT ${heightScore}`);
    if (heightScore !== this.lastEmittedHeight) {
      this.lastEmittedHeight = heightScore;
      this.events.emit("height", heightScore);
    }

    if (this.player.y > this.cameras.main.scrollY + GAME_HEIGHT + 60) {
      this.endGame();
    }
  }

  private endGame() {
    this.gameOver = true;
    this.player.setVelocity(0, 0);
    (this.player.getData("glyph") as Phaser.GameObjects.Text).setVisible(false);
    this.events.emit("gameover", { height: this.maxHeightScore, bananas: this.bananaCount });
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
    backgroundColor: toCss(COLOR_SKY_TOP),
  });
}
