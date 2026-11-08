// Constants shared by the detector pipeline, the hit test and the HUD.

/** Typical phone main camera field of view across the long side of the frame. */
export const MAIN_CAMERA_FOV_DEG = 69.4;

/** Assumed height of a standing player, for the distance estimate. */
export const PERSON_HEIGHT_M = 1.7;

/** Lag forgiveness around a Fire press, in milliseconds. */
export const SHOT_WINDOW_BEFORE_MS = 150;
export const SHOT_WINDOW_AFTER_MS = 120;
