import math

import pygame
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
    @staticmethod
    def DistSqr(vec1, vec2):
        diffX = vec1[0] - vec2[0]
        diffY = vec1[1] - vec2[1]
        return diffX * diffX + diffY * diffY
    @staticmethod
    def Distance(vec1, vec2):
        diffX = vec1[0] - vec2[0]
        diffY = vec1[1] - vec2[1]
        return math.sqrt(diffX * diffX + diffY * diffY)