import enum
from typing import Tuple

import pygame
from pygame import Surface
from pygame import Color as Colour

from .types import SpriteRects
from .types import SpriteOffsets
from .types import AreaRects



class Origin(enum.Enum):
    """Represents sprite origin when drawing.

    Default sprite origin (offset) is (0, 0) Which is Top Left.
    This is convenience Enum to help reposition the sprite around it's coordinates.

    For example, in a RPG game it might be simpler to use (x, y) as position where character's legs are,
    in which case you'd use Origin.Bottom when blitting the sprite, which will indicate to the method to
    add appropriate offset.
    """
    TopLeft = 0
    Top = 1
    TopRight = 2
    Left = 3
    Center = 4
    Right = 5
    BottomLeft = 6
    Bottom = 7
    BottomRight = 8



class SpriteSheet:
    def __init__(self, file_path: str, columns: int, rows: int, colour_key: Colour = Colour(255, 0, 255), scale: Tuple[int, int] = (-1, -1)) -> None:
        """Creates a sprite sheet from a file.

        Parameters:
            - file_path: path to the image to be used for this sprite sheet.
            - columns: how many sprites are in a single row of sprite sheet.
            - rows: how many sprites are in a single column of sprite sheet.
            - colour_key (optional): transparency key to use for this sheet.
        """
        self.__colour_key: Colour = colour_key
        self.__sheet: Surface = pygame.image.load(file_path).convert()
        if (scale != (-1, -1)):
            sheet = self.__sheet
            self.__sheet = pygame.transform.scale(sheet, (sheet.get_width() * scale[0], sheet.get_height() * scale[1]))
        self.__sheet.set_colorkey(self.__colour_key)
        self.__columns: int = columns
        self.__rows: int = rows
        self.__sprite_count: int = self.__columns * self.__rows
        self.__width: int = self.__sheet.get_rect().width
        self.__height: int = self.__sheet.get_rect().height
        self.__sprite_width: int = self.__width // self.__columns
        self.__sprite_height: int = self.__height // self.__rows
        self.__sprite_half_width: int = self.__sprite_width // 2
        self.__sprite_half_height: int = self.__sprite_height // 2
        self.__sprites: SpriteRects = []
        self.__areas: AreaRects = {}

        for y in range(self.__rows):
            for x in range(self.__columns):
                self.__sprites.append((
                    x * self.__sprite_width,
                    y * self.__sprite_height,
                    self.__sprite_width,
                    self.__sprite_height
                ))

        self.__offsets: SpriteOffsets = (
            (0, 0),
            (-self.__sprite_half_width, 0),
            (-self.__sprite_width, 0),
            (0, -self.__sprite_half_height),
            (-self.__sprite_half_width, -self.__sprite_half_height),
            (-self.__sprite_width, -self.__sprite_half_height),
            (0, -self.__sprite_height),
            (-self.__sprite_half_width, -self.__sprite_height),
            (-self.__sprite_width, -self.__sprite_height)
        )

    def add_area(self, area_name: str, sprite_id: int, columns: int, rows: int) -> None:
        """Defines a new area.

        Parameters:
            - area_name: name of the new area.
            - sprite_id: id of the top left sprite in this new area.
            - columns: how wide this new area is.
            - rows: how tall this new area is.

        Exceptions:
            - ValueError when `area_name` is already defined.
            - IndexError when `sprite_id` is out of bounds.
            - IndexError when `area` is not entirely nside a sprite sheet.
        """
        if area_name in self.__areas:
            raise ValueError(f"Area '{area_name}' is already defined")

        if not 0 <= sprite_id < self.__sprite_count:
            raise IndexError(f"'sprite_id = {sprite_id}' out of bounds [0; {self.__sprite_count})")

        if columns < 0 or rows < 0:
            raise ValueError(f"Invalid area size '{columns}x{rows}'")

        x, y = (sprite_id % self.__columns, sprite_id // self.__columns)
        if self.__columns < x + columns or self.__rows < y + rows:
            raise IndexError(f"Area '{area_name}' is out of bounds")

        area_x, area_y = self.__sprites[sprite_id][:2]
        area_w, area_h = (self.__sprite_width * columns, self.__sprite_height * rows)
        half_w, half_h = area_w // 2, area_h // 2

        self.__areas[area_name] = (
            (area_x, area_y, area_w, area_h), (
                (0, 0),
                (-half_w, 0),
                (-area_w, 0),
                (0, -half_h),
                (-half_w, -half_h),
                (-area_w, -half_h),
                (0, -area_h),
                (-half_w, -area_h),
                (-area_w, -area_h)
            )
        )

    def blit(self, surface: Surface, sprite_id: int, position: Tuple[int, int], origin: Origin = Origin.TopLeft, flipX = False) -> None:
        """Blits a sprite from this sprite sheet onto the given surface.

        Parameters:
            - surface: surface to blit the sprite onto.
            - sprite_id: index of a sprite to be blit onto the surface. Index is counted from left to right, top to bottom in (row-major) order.
            - position: (x, y) tuple of pixel coordinates on surface.
            - origin (optional): origin of the drawn sprite. Top Left corner is default.
        """
        offset_x, offset_y = self.__offsets[origin.value]
        x, y = position
        blit_position = (x + offset_x, y + offset_y)

        surface.blit(pygame.transform.flip(self.__sheet, flipX, False), blit_position, self.__sprites[sprite_id])

    def blit_area(self, surface: Surface, area_name: str, position: Tuple[int, int], origin: Origin = Origin.TopLeft) -> None:
        """Blits named area from this sprite sheet onto the given surface.

        Parameters:
            - surface: surface to blit the sprite onto.
            - area_name: name of a sprite to be blit onto the surface.
            - position: (x, y) tuple of pixel coordinates on surface.
            - origin (optional): origin of the drawn sprite. Top Left corner is default.
        """
        area, offsets = self.__areas[area_name]
        offset_x, offset_y = offsets[origin.value]
        x, y = position
        blit_position = (x + offset_x, y + offset_y)

        surface.blit(self.__sheet, blit_position, area)

    def columns(self) -> int:
        """Returns amount of sprite columns in this sprite sheet."""
        return self.__columns

    def rows(self) -> int:
        """Returns amount of sprite rows in this sprite sheet."""
        return self.__rows

    def sheet_size(self) -> Tuple[int, int]:
        """Returns amount of rows and columns in this sprite sheet as a tuple."""
        return (self.__columns, self.__rows)

    def sprite_count(self) -> int:
        """Returns amount of sprites in this sprite sheet."""
        return self.__sprite_count

    def width(self) -> int:
        """Returns width of this sprite sheet in pixels."""
        return self.__width

    def height(self) -> int:
        """Returns height of this sprite sheet in pixels."""
        return self.__height

    def size(self) -> Tuple[int, int]:
        """Returns width and height of this sprite sheet in pixels as a tuple."""
        return (self.__width, self.__height)

    def sprite_width(self) -> int:
        """Returns single sprite width in pixels."""
        return self.__sprite_width

    def sprite_height(self) -> int:
        """Returns single sprite height in pixels."""
        return self.__sprite_height

    def sprite_size(self) -> Tuple[int, int]:
        """Returns single sprite width and height in pixels as a tuple."""
        return (self.__sprite_width, self.__sprite_height)

    def sprite_half_width(self) -> int:
        """Returns single sprite half-width in pixels."""
        return self.__sprite_half_width

    def sprite_half_height(self) -> int:
        """Returns single sprite half-height in pixels."""
        return self.__sprite_half_height

    def sprite_half_size(self) -> Tuple[int, int]:
        """Returns single sprite half-width and half-height in pixels as a tuple."""
        return (self.__sprite_half_width, self.__sprite_half_height)

    def colour_key(self) -> Colour:
        """Returns transparency key value used in this sprite sheet."""
        return self.__colour_key

    def color_key(self) -> Colour:
        """Returns transparency key value used in this sprite sheet. Alias to `SpriteSheet.colour_key()`."""
        return self.__colour_key
