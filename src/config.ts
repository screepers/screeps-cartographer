import { MoveOpts } from './lib';

export const config = {
  DEFAULT_MOVE_OPTS: {
    avoidCreeps: false,
    avoidObstacleStructures: true,
    avoidSourceKeepers: true,
    keepTargetInRoom: true,
    repathIfStuck: 3,
    roadCost: 1,
    plainCost: 2,
    swampCost: 10,
    shoveCostLimit: 255,
    priority: 1,
    defaultRoomCost: 2,
    highwayRoomCost: 1,
    sourceKeeperRoomCost: 2,
    maxRooms: 64,
    maxOps: 100000,
    maxOpsPerRoom: 2000,
  } as MoveOpts,
  DEFAULT_VISUALIZE_OPTS: {
    fill: 'transparent',
    stroke: '#fff',
    lineStyle: 'dashed',
    strokeWidth: 0.15,
    opacity: 0.1
  } as PolyStyle,
  MEMORY_CACHE_PATH: '_cg',
  MEMORY_CACHE_EXPIRATION_PATH: '_cge',
  MEMORY_PORTAL_PATH: '_cgp'
};
