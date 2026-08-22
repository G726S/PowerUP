import pygame

pygame.init()
display = pygame.display
monitorSurface = display.Info()
screen = display.set_mode((monitorSurface.current_w, monitorSurface.current_h))
clock = pygame.time.Clock()
max_fps = 144
pressedKeys = None
pressingKeys = 
def PressOnFrame(key):
    return not pressedKeys[key] and pressingKeys[key]
def HeldKey(key):
    return pressedKeys[key] and pressingKeys[key]
def RegisterInput():
    global pressingKeys
    pressingKeys = pygame.key.get_pressed()

while(True):
    for event in pygame.event.get():
        if (event.type == pygame.QUIT):
            break
    ##register input BEFORE checking for any input
    RegisterInput()
    if HeldKey(pygame.K_LCTRL) and PressOnFrame(pygame.K_q):
        break
    pressedKeys = pygame.key.get_pressed()
    screen.fill("white")
    pygame.display.flip()
    clock.tick(max_fps)
pygame.quit()