import random
import pygame
import sys
sys.path.insert(0, '/customSpriteSheet')
import customSpriteSheet
from main import Main, IVector2
###     AI WAS NOT USED IN THE CREATION OF THIS SCRIPT###


def IsPowTwo(x):
    return bool((((x - 1) | x) + 1) == (x << 1));

numFrames = {"attack" : 6, "idle": 7, "run": 8, "death": 12}
size = (-1, -1)
def GetSpriteData(path, name):
    return customSpriteSheet.SpriteSheet(path, numFrames[name], 1, (0,0,0), size)

pygame.init()
pygame.font.init()

#the amount of time in seconds the player will play for before switching to the problems
play_time = 40
font = pygame.font.Font("fonts/Pixie.ttf", 45)
deathFont = pygame.font.Font("fonts/Pixie.ttf", 120)
death_text_offset = IVector2(-540, -80)

progressAmount = 1.0
progress_bar_size = (1706 * .4, 30)
progress_bar_dilation = 10
progress_bar_position = (1706 * .05, 50)
progress_bar_text = "progress bar"
progress_bar_text_offset = (0, -47)

health_bar_size = (1706 * .4, 30)
health_bar_dilation = 10
health_bar_position = (1706 * .55, 50)
health_bar_text = "health bar"
health_bar_text_offset = (0, -47)

enemy_hb_size = (1706 * .1, 14)
enemy_hb_dilation = 10
enemy_hb_offset = IVector2(-120, -97)

samurai_offset = (0, -57)

frameIndex = 0
animation_update_interval = 8
def CheckAnimationUpdateInterval():
    if (not IsPowTwo(animation_update_interval)): raise Exception("\"animation_update_interval\" is not a power of two.")
CheckAnimationUpdateInterval()
class Entity:
    def __init__(self, numFrames, spriteSheets, speed = 350, immune_time = .3, damage = .04):
        self.animIndex = 0
        self.animation = "idle"
        self.flipped = False
        self.position = Main.halfDisplaySize
        self.numFrames = numFrames
        self.spriteSheets = spriteSheets
        self.health = 1.0
        self.speed = speed
        self.damage = damage
        self.immune_time = immune_time
        self.immuneTimer = self.immune_time + Main.epsilon
        self.pseudoHealth = self.health
        self.healthMoveSpeed = 10.0
    def Animate(self, animation, offset = (0, 0), loop = True):
        if self.animation != animation: self.animIndex = 0
        self.animation = animation
        attackSheet = self.spriteSheets[animation]
        animNumFrames = self.numFrames[animation]
        if Main.isAnimationUpdate:
            if loop or self.animIndex != animNumFrames - 1:
                self.animIndex = (self.animIndex + 1) % animNumFrames
        ##the "(animNumFrames - 1) * self.flipped + self.animIndex * (self.flipped * -2 + 1)" is here because we are flipping the entire spritesheet, so if we don't do this branchless logic, the animation will actually play backwards
        attackSheet.blit(Main.screen, (animNumFrames - 1) * self.flipped + self.animIndex * (self.flipped * -2 + 1), self.position.ToTuple(), customSpriteSheet.Origin.Center, self.flipped, offset)
    def Update(self):
        self.pseudoHealth = Main.Lerp(self.pseudoHealth, self.health, deltaTime * self.healthMoveSpeed)
        self.immuneTimer += deltaTime
    def TakeDamage(self, damage):
        if (self.immuneTimer < self.immune_time): return
        self.immuneTimer = .0
        newHealth = self.health - damage
        #max func wasn't working
        self.health = (.0 if newHealth < .0 else newHealth)
class Enemy(Entity):
    def __init__(self, numFrames, spriteSheets, index, speed = 350, immune_time = .3):
        super().__init__(numFrames, spriteSheets, speed, immune_time)
        self.damageDist = 28
        self.index = index
    def Update(self):
        if self.health == .0:
            ReloadEnemy(self.index)
            return
        super().Update()
        DrawSlider("red", (self.position + enemy_hb_offset).ToTuple(), enemy_hb_dilation, enemy_hb_size, self.pseudoHealth)
    def Animate(self, animation):
        if self.health == .0:
            return
        super().Animate(animation, samurai_offset)

Main.Init()

size = (2, 2)
player = Entity(numFrames, {"attack" : GetSpriteData("sprites/ATTACK 1.png", "attack"), "idle" : GetSpriteData("sprites/IDLE.png", "idle"), "run": GetSpriteData("sprites/RUN.png", "run"), "death": GetSpriteData("sprites/DEATH.png", "death")}, 500, .3, .4)

numFrames = {"attack": 7, "idle": 10, "run" : 16}
size = (3, 3)
num_enemies = 3
samurais = [None] * num_enemies
samurai_spawn_offset = IVector2(800, 1000)
samurai_attack_dist = 10

def ReloadEnemy(index):
    samurais[index] = Enemy(numFrames, {"attack": GetSpriteData("sprites/samurai/ATTACK 1.png", "attack"), "idle": GetSpriteData("sprites/samurai/IDLE.png", "idle"), "run": GetSpriteData("sprites/samurai/RUN.png", "run")}, index, 300)
    samurai = samurais[index]
    halfDisp = Main.halfDisplaySize
    rand = random.random()
    samurai.position = halfDisp + IVector2.GetRight() * (samurai_spawn_offset.x + 200 * rand) * ((rand < .5) * 2 - 1)
    rand = random.random()
    samurai.position += IVector2.GetUp() * (samurai_spawn_offset.y + 200 * rand) * ((rand < .5) * 2 - 1)

for i in range(num_enemies):
    ReloadEnemy(i)

clock = pygame.time.Clock()
max_fps = 144
pressedKeys = None
pressingKeys = None

#whether the key was pressed this frame but not last frame
def PressOnFrame(key):
    return not pressedKeys[key] and pressingKeys[key]
#whether the key was pressed last frame and this frame
def HeldKey(key):
    return pressedKeys[key] and pressingKeys[key]
#whether the key is pressed on this frame regardless of previous states
def KeyDown(key):
    return pressingKeys[key]

def BeforeUpdate() -> bool:
    Main.screen.fill("white")
    global pressingKeys
    pressingKeys = pygame.key.get_pressed()
    if pressedKeys != None and HeldKey(pygame.K_LCTRL) and PressOnFrame(pygame.K_q):
        return True
    return False
def RegisterLateInput():
    global pressedKeys
    pressedKeys = pressingKeys

deltaTime = .0
#milliseconds --> seconds
delta_time_scaling = .001

death_max_time = 3.0
deathTime = death_max_time + Main.epsilon
wasDead = False

def AfterUpdate(alternateUpdateInterval = animation_update_interval):
    global frameIndex
    global animation_update_interval
    global delta_time_scaling
    global deltaTime
    RegisterLateInput()
    pygame.display.update()
    pygame.display.flip()
    frameIndex += 1
    Main.isAnimationUpdate = not bool(frameIndex & (alternateUpdateInterval - 1))
    deltaTime = clock.tick(max_fps) * delta_time_scaling

def GetTextPosition(index, position, offset):
    return position[index] + offset[index]
def DrawSlider(innerColor, position, dilation, size, amount, text = "", textOffset = (0, 0)):
    pygame.draw.rect(Main.screen, "black", (position[0] - dilation * .5, position[1] - dilation * .5, size[0] + dilation, size[1] + dilation))
    pygame.draw.rect(Main.screen, innerColor, (position[0], position[1], size[0] * amount, size[1]))
    if (text == ""): return
    Main.screen.blit(font.render(text, False, (0, 0, 0)), (GetTextPosition(0, position, textOffset), GetTextPosition(1, position, textOffset)))

BeforeUpdate()
RegisterLateInput()

while(True):
    for event in pygame.event.get():
        if (event.type == pygame.QUIT):
            break
    if player.health == .0:
        if BeforeUpdate(): break
        Main.screen.blit(deathFont.render(f'YOU ARE DEAD (respawn in {int(death_max_time - deathTime) + 1})', False, (0, 0, 0)), (Main.halfDisplaySize + death_text_offset).ToTuple())
        player.Animate("death", (0, 0), False)
        deathTime += deltaTime
        if not wasDead:
            deathTime = .0
        if (deathTime > death_max_time):
            player.health = 1.0
            for i in range(num_enemies):
                ReloadEnemy(i)
        wasDead = True
        AfterUpdate(animation_update_interval * 4)
        CheckAnimationUpdateInterval()
        continue
    ##register input BEFORE checking for any input
    if (BeforeUpdate()): break
    horizon = KeyDown(pygame.K_d) - KeyDown(pygame.K_a)
    vert = KeyDown(pygame.K_s) - KeyDown(pygame.K_w)
    if horizon or vert:
        player.Animate("run")
        player.flipped |= horizon == -1
        player.flipped &= horizon != 1
        player.position += IVector2(horizon, vert) * deltaTime * player.speed
    else:
        if KeyDown(pygame.K_SPACE):
            player.Animate("attack")
            if player.animIndex == 0:
                for samurai in samurais:
                    if (samurai.position - player.position).SqrMagnitude() > samurai.damageDist: continue
                    samurai.TakeDamage(player.damage)
        else: player.Animate("idle")
    progressAmount = max(progressAmount - deltaTime / play_time, .0)
    DrawSlider("purple", progress_bar_position, progress_bar_dilation, progress_bar_size, progressAmount, progress_bar_text, progress_bar_text_offset)
    DrawSlider("red", health_bar_position, health_bar_dilation, health_bar_size, player.pseudoHealth, health_bar_text, health_bar_text_offset)
    for samurai in samurais:
        if samurai.health == .0:
            samurai.Update()
            continue
        samurai.Update()
        enemyToPlr = -samurai.position + player.position
        if enemyToPlr.SqrMagnitude() < samurai_attack_dist:
            player.TakeDamage(samurai.damage)
            samurai.Animate("attack")
        else:
            samurai.position += enemyToPlr.Normalized() * deltaTime * samurai.speed
            samurai.Animate("run")
        samurai.flipped = bool(player.position.x < samurai.position.x)
    player.Update()
    wasDead = False
    AfterUpdate()
pygame.quit()