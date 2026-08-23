import asyncio
import random
import sys
from urllib.parse import parse_qs

import pygame

import customSpriteSheet
from engine import Main

###     AI WAS NOT USED IN THE CREATION OF THIS SCRIPT###


def is_pow_two(x):
    return bool((((x - 1) | x) + 1) == (x << 1))


def get_query_params():
    """URL query params (?health=..) from the browser build; empty natively."""
    if sys.platform != "emscripten":
        return {}
    query = ""
    try:
        import platform
        query = platform.window.location.search
    except Exception:
        try:
            import js
            query = js.window.location.search
        except Exception:
            query = ""
    if not query:
        return {}
    parsed = parse_qs(query.lstrip("?"))
    return {k: v[0] for k, v in parsed.items()}


def int_param(params, name, default=0):
    try:
        return int(params.get(name, default))
    except (TypeError, ValueError):
        return default


PLAYER_FRAMES = {"attack": 6, "idle": 7, "run": 8}
SAMURAI_FRAMES = {"attack": 7, "idle": 10, "run": 16}


def sprite_sheet(path, frame_count, scale):
    return customSpriteSheet.SpriteSheet(path, frame_count, 1, (0, 0, 0), scale)


class Entity:
    def __init__(self, num_frames, sprite_sheets, max_health, position):
        self.anim_index = 0
        self.animation = "idle"
        self.flipped = False
        self.position = position
        self.num_frames = num_frames
        self.sprite_sheets = sprite_sheets
        self.max_health = max_health
        self.health = max_health
        self.attack_cooldown = 0.0
        self.alive = True

    def animate(self, animation):
        if self.animation != animation:
            self.anim_index = 0
        self.animation = animation
        sheet = self.sprite_sheets[animation]
        sheet.blit(Main.screen, self.anim_index, self.position, customSpriteSheet.Origin.Center, self.flipped)
        if Main.isAnimationUpdate:
            self.anim_index = (self.anim_index + 1) % self.num_frames[animation]

    def take_damage(self, amount):
        if not self.alive:
            return
        self.health = max(0, self.health - amount)
        if self.health == 0:
            self.alive = False


def draw_health_bar(surface, font, position, label, health, max_health, color):
    bar_width, bar_height = 260, 22
    ratio = 0.0 if max_health == 0 else max(0.0, health / max_health)
    label_surf = font.render(f"{label} {int(health)}/{int(max_health)}", False, (0, 0, 0))
    surface.blit(label_surf, (position[0], position[1] - 26))
    pygame.draw.rect(surface, "black", (position[0] - 3, position[1] - 3, bar_width + 6, bar_height + 6))
    pygame.draw.rect(surface, "white", (position[0], position[1], bar_width, bar_height))
    pygame.draw.rect(surface, color, (position[0], position[1], bar_width * ratio, bar_height))


async def play_round(health_bonus, damage_bonus, speed_bonus):
    """Plays one round; returns "restart" or "quit"."""
    Main.Init()

    play_time = 40
    progress_amount = 1.0
    progress_bar_size = (Main.displaySize[0] * .4, 30)
    progress_bar_dilation = 10
    progress_bar_position = (Main.displaySize[0] * .05, 50)
    progress_bar_text_offset = (0, -47)
    progress_bar_font = pygame.font.Font("fonts/Pixie.ttf", 45)
    hud_font = pygame.font.Font("fonts/Pixie.ttf", 32)
    banner_font = pygame.font.Font("fonts/Pixie.ttf", 70)

    frame_index = 0
    animation_update_interval = 16
    if not is_pow_two(animation_update_interval):
        raise Exception('"animation_update_interval" is not a power of two.')

    player_max_health = 100 + health_bonus * 5
    player_damage = 10 + damage_bonus
    player_speed = 300 + speed_bonus * 5

    player = Entity(
        PLAYER_FRAMES,
        {
            "attack": sprite_sheet("sprites/ATTACK 1.png", PLAYER_FRAMES["attack"], (2, 2)),
            "idle": sprite_sheet("sprites/IDLE.png", PLAYER_FRAMES["idle"], (2, 2)),
            "run": sprite_sheet("sprites/RUN.png", PLAYER_FRAMES["run"], (2, 2)),
        },
        player_max_health,
        Main.halfDisplaySize,
    )

    samurai_max_health = 60
    samurai_damage = 8
    samurai_speed = 220
    samurai_start = (Main.halfDisplaySize[0] + 800 * random.choice([-1, 1]), Main.halfDisplaySize[1])
    samurai = Entity(
        SAMURAI_FRAMES,
        {
            "attack": sprite_sheet("sprites/samurai/ATTACK 1.png", SAMURAI_FRAMES["attack"], (3, 3)),
            "idle": sprite_sheet("sprites/samurai/IDLE.png", SAMURAI_FRAMES["idle"], (3, 3)),
            "run": sprite_sheet("sprites/samurai/RUN.png", SAMURAI_FRAMES["run"], (3, 3)),
        },
        samurai_max_health,
        samurai_start,
    )
    samurai.flipped = samurai.position[0] > player.position[0]

    samurai_attack_range = 140
    samurai_attack_cooldown_time = 1.0
    player_attack_range = 140
    player_attack_cooldown_time = 0.5

    clock = pygame.time.Clock()
    max_fps = 60

    pressed_keys = None
    pressing_keys = None

    def press_on_frame(key):
        return not pressed_keys[key] and pressing_keys[key]

    def register_input():
        nonlocal pressing_keys
        pressing_keys = pygame.key.get_pressed()

    def register_late_input():
        nonlocal pressed_keys
        pressed_keys = pressing_keys

    def text_position(index):
        return progress_bar_position[index] + progress_bar_text_offset[index]

    register_input()
    register_late_input()

    delta_time = 0.0
    delta_time_scaling = 0.001

    outcome = None  # None while playing, else "WIN" / "LOSE" / "TIME"
    running = True
    result = "quit"
    while running:
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False

        register_input()
        if pressing_keys[pygame.K_LCTRL] and press_on_frame(pygame.K_q):
            running = False

        Main.screen.fill("white")

        if outcome is None:
            horizon = pressing_keys[pygame.K_d] - pressing_keys[pygame.K_a]
            if horizon:
                new_x = player.position[0] + horizon * player_speed * delta_time
                player.position = (new_x, player.position[1])
                player.animate("run")
                player.flipped = horizon == -1
            elif pressing_keys[pygame.K_SPACE]:
                player.animate("attack")
            else:
                player.animate("idle")

            player.attack_cooldown = max(0.0, player.attack_cooldown - delta_time)
            samurai.attack_cooldown = max(0.0, samurai.attack_cooldown - delta_time)

            dist_sqr = Main.DistSqr(player.position, samurai.position)

            samurai.flipped = samurai.position[0] > player.position[0]
            if dist_sqr <= samurai_attack_range ** 2:
                samurai.animate("attack")
                if samurai.attack_cooldown <= 0.0:
                    samurai.attack_cooldown = samurai_attack_cooldown_time
                    player.take_damage(samurai_damage)
            else:
                step = -1 if samurai.position[0] > player.position[0] else 1
                samurai.position = (samurai.position[0] + step * samurai_speed * delta_time, samurai.position[1])
                samurai.animate("run")

            if pressing_keys[pygame.K_SPACE] and player.attack_cooldown <= 0.0 and dist_sqr <= player_attack_range ** 2:
                player.attack_cooldown = player_attack_cooldown_time
                samurai.take_damage(player_damage)

            progress_amount = max(progress_amount - delta_time / play_time, 0.0)

            if not samurai.alive:
                outcome = "WIN"
            elif not player.alive:
                outcome = "LOSE"
            elif progress_amount <= 0.0:
                outcome = "TIME"

        if samurai.alive:
            samurai.animate(samurai.animation)
        if player.alive:
            player.animate(player.animation)

        progress_bar_font_surf = progress_bar_font.render("TIME", False, (0, 0, 0))
        Main.screen.blit(progress_bar_font_surf, (text_position(0), text_position(1)))
        pygame.draw.rect(
            Main.screen,
            "black",
            (
                progress_bar_position[0] - progress_bar_dilation * .5,
                progress_bar_position[1] - progress_bar_dilation * .5,
                progress_bar_size[0] + progress_bar_dilation,
                progress_bar_size[1] + progress_bar_dilation,
            ),
        )
        pygame.draw.rect(
            Main.screen,
            "purple",
            (progress_bar_position[0], progress_bar_position[1], progress_bar_size[0] * progress_amount, progress_bar_size[1]),
        )

        draw_health_bar(Main.screen, hud_font, (progress_bar_position[0], progress_bar_position[1] + 60), "YOU", player.health, player.max_health, "green")
        draw_health_bar(Main.screen, hud_font, (progress_bar_position[0], progress_bar_position[1] + 110), "SAMURAI", samurai.health, samurai.max_health, "red")

        if outcome is not None:
            message = {"WIN": "YOU WIN", "LOSE": "YOU DIED", "TIME": "TIME'S UP"}[outcome]
            banner = banner_font.render(message, False, (0, 0, 0))
            Main.screen.blit(banner, (Main.halfDisplaySize[0] - banner.get_width() // 2, 120))
            hint = hud_font.render("PRESS R TO PLAY AGAIN, ESC TO QUIT", False, (0, 0, 0))
            Main.screen.blit(hint, (Main.halfDisplaySize[0] - hint.get_width() // 2, 200))
            if press_on_frame(pygame.K_r):
                result = "restart"
                running = False
            if press_on_frame(pygame.K_ESCAPE):
                running = False

        register_late_input()
        pygame.display.flip()
        frame_index += 1
        Main.isAnimationUpdate = not bool(frame_index & (animation_update_interval - 1))
        clock.tick(max_fps)
        delta_time = clock.get_time() * delta_time_scaling
        await asyncio.sleep(0)

    return result


async def main():
    pygame.init()
    pygame.font.init()

    params = get_query_params()
    health_bonus = int_param(params, "health")
    damage_bonus = int_param(params, "damage")
    speed_bonus = int_param(params, "speed")

    while True:
        result = await play_round(health_bonus, damage_bonus, speed_bonus)
        if result != "restart":
            break

    pygame.quit()


if __name__ == "__main__":
    asyncio.run(main())
