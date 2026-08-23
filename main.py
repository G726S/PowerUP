import pygame
import sys
import numpy
sys.path.insert(0, '/customSpriteSheet')
import customSpriteSheet
import spritesheet
###     AI WAS NOT USED IN THE CREATION OF THIS SCRIPT###
#static
class Main():
    display = None
    monitorSurface = None
    screen = None
    isAnimationUpdate = False
    @staticmethod
    def Init():
        Main.display = pygame.display
        Main.monitorSurface = Main.display
        Main.info = Main.monitorSurface.Info()
        Main.displaySize = (Main.info.current_w, Main.info.current_h)
        Main.halfDisplaySize = (int(Main.displaySize[0] * .5), int(Main.displaySize[1] * .5))
        Main.screen = Main.display.set_mode((Main.info.current_w, Main.info.current_h))
    @staticmethod
    def GetRenderOffsettedPos(sprite, position, horizontalMultiplier):
        return (position[0] - int(sprite.sprite_width() * .5 / horizontalMultiplier), position[1] - int(sprite.sprite_width() * .5))
class IVector2():
    def __init__(self):
        self.x = 0
        self.y = 0
    def __init__(self, x, y):
        self.x = x
        self.y = y
    def ToTuple(self):
        return (self.x, self.y)
    def __neg__(self):
        return IVector2(-self.x, -self.y)
    def __add__(self, other):
        return IVector2(self.x + other.x, self.y + other.y)
    def __iadd__(self, other):
        return IVector2(self.x + other.x, self.y + other.y)
    def __sub__(self, other):
        return IVector2(self.x - other.x, self.y - other.y)
    def __mul__(self, other: int):
        return IVector2(self.x * other, self.y * other)
    def __div__(self, other: float):
        return IVector2(self.x / other, self.y / other)
    def SqrMagnitude(self):
        return self.x * self.x + self.y * self.y
    def Magnitude(self):
        return numpy.sqrt(self.SqrMagnitude())
    def Normalized(self):
        r = self.Magnitude()
        if (r == .0): return IVector2(.0, .0)
        return IVector2(self.x / r, self.y / r)
    @staticmethod
    def GetRight():
        return IVector2(1, 0)