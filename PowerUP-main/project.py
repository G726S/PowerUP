import random
import pygame
import sys
sys.path.insert(0, '/customSpriteSheet')
import customSpriteSheet
from main import Main
###     AI WAS NOT USED IN THE CREATION OF THIS SCRIPT###


def IsPowTwo(x):
    return bool((((x - 1) | x) + 1) == (x << 1));

numFrames = {"attack" : 6, "idle": 7, "run": 8}
size = (-1, -1)
def GetSpriteData(path, name):
    return customSpriteSheet.SpriteSheet(path, numFrames[name], 1, (0,0,0), size)

pygame.init()
pygame.font.init()

#the amount of time in seconds the player will play for before switching to the problems
play_time = 40
progressAmount = 1.0
progress_bar_size = (1706 * .4, 30)
progress_bar_dilation = 10
progress_bar_position = (1706 * .05, 50)
progress_bar_text = "progress bar"
progress_bar_text_offset = (0, -47)
progress_bar_font = pygame.font.Font("fonts/Pixie.ttf", 45)
frameIndex = 0
animation_update_interval = 16
if (not IsPowTwo(animation_update_interval)): raise Exception("\"animation_update_interval\" is not a power of two.")
class Entity:
    def __init__(self, numFrames, spriteSheets):
        self.animIndex = 0
        self.animation = "idle"
        self.flipped = False
        self.position = Main.halfDisplaySize
        self.numFrames = numFrames
        self.spriteSheets = spriteSheets
    def Animate(self, animation):
        if self.animation != animation: self.animIndex = 0
        self.animation = animation
        attackSheet = self.spriteSheets[animation]
        attackSheet.blit(Main.screen, self.animIndex, self.position, customSpriteSheet.Origin.Center, self.flipped)
        if Main.isAnimationUpdate:
            self.animIndex = (self.animIndex + 1) % self.numFrames[animation]

Main.Init()
player = None
size = (2, 2)
player = Entity(numFrames, {"attack" : GetSpriteData("sprites/ATTACK 1.png", "attack"), "idle" : GetSpriteData("sprites/IDLE.png", "idle"), "run": GetSpriteData("sprites/RUN.png", "run")})
numFrames = {"attack": 7, "idle": 10}
size = (3, 3)
samurai = Entity(numFrames, {"attack": GetSpriteData("sprites/samurai/ATTACK 1.png", "attack"), "idle": GetSpriteData("sprites/samurai/IDLE.png", "idle")})
samurai.position = (samurai.position[0] + 800 * random.choice([-1, 1]), samurai.position[1])
samurai_attack_dist = 10
samurai_speed = 10
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
def RegisterInput():
    global pressingKeys
    pressingKeys = pygame.key.get_pressed()
def RegisterLateInput():
    global pressedKeys
    pressedKeys = pressingKeys
def GetTextPosition(index):
    return progress_bar_position[index] + progress_bar_text_offset[index]
RegisterInput()
RegisterLateInput()
deltaTime = .0
#milliseconds --> seconds
delta_time_scaling = .001
while(True):
    for event in pygame.event.get():
        if (event.type == pygame.QUIT):
            break
    ##register input BEFORE checking for any input
    RegisterInput()
    if HeldKey(pygame.K_LCTRL) and PressOnFrame(pygame.K_q):
        break
    Main.screen.fill("white")
    horizon = KeyDown(pygame.K_d) - KeyDown(pygame.K_a)
    if horizon:
        player.Animate("run")
        player.flipped = (horizon == -1)
    else:
        if KeyDown(pygame.K_SPACE): player.Animate("attack")
        else: player.Animate("idle")
    progressAmount = max(progressAmount - deltaTime / play_time, .0)
    Main.screen.blit(progress_bar_font.render(progress_bar_text, False, (0, 0, 0)), (GetTextPosition(0), GetTextPosition(1)))
    pygame.draw.rect(Main.screen, "black", (progress_bar_position[0] - progress_bar_dilation * .5, progress_bar_position[1] - progress_bar_dilation * .5, progress_bar_size[0] + progress_bar_dilation, progress_bar_size[1] + progress_bar_dilation))
    pygame.draw.rect(Main.screen, "purple", (progress_bar_position[0], progress_bar_position[1], progress_bar_size[0] * progressAmount, progress_bar_size[1]))
    if Main.DistSqr(player.position, samurai.position) < samurai_attack_dist:
        samurai.Animate("attack")
    else: samurai.Animate("idle")
    if (player.postion[0] > samurai.position[0]): samurai.position
    RegisterLateInput()
    pygame.display.update()
    pygame.display.flip()
    frameIndex += 1
    Main.isAnimationUpdate = not bool(frameIndex & (animation_update_interval - 1))
    deltaTime = clock.tick(max_fps) * delta_time_scaling
pygame.quit()