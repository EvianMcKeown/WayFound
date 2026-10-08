SOUTH, NORTH = -34.26, -33.42
WEST, EAST = 18.27, 19.06

OUTSIDE_MESSAGE = "That place is outside the area WayFound covers. It plans journeys in Cape Town only."


def contains(lat: float, lon: float) -> bool:
    return SOUTH <= lat <= NORTH and WEST <= lon <= EAST


def photon_bbox() -> str:
    return f"{WEST},{SOUTH},{EAST},{NORTH}"
