from typing import Dict
from typing import List
from typing import Tuple


SpriteRect = Tuple[int, int, int, int]
SpriteRects = List[SpriteRect]

SpriteOffset = Tuple[int, int]
SpriteOffsets = Tuple[
    SpriteOffset,
    SpriteOffset,
    SpriteOffset,
    SpriteOffset,
    SpriteOffset,
    SpriteOffset,
    SpriteOffset,
    SpriteOffset,
    SpriteOffset
]

AreaRect = Tuple[int, int, int, int]
AreaRects = Dict[
    str, Tuple[
        SpriteRect,
        SpriteOffsets
    ]
]
