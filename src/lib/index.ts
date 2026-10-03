import { CachingStrategy, cleanAllCaches } from './CachingStrategies';
import { updateIntel } from './Utils/updateIntel';

export type MoveTarget = { pos: RoomPosition; range: number };
export interface MoveOpts extends PathFinderOpts {
  /**
   * Caching strategy to use to save paths. Defaults to HeapCache.
   */
  cache?: CachingStrategy;
  /**
   * Number of ticks to save a cached path before repathing. If undefined,
   * cached path will be reused indefinitely. Default is undefined.
   */
  reusePath?: number;
  /**
   * Number of ticks to wait for a creep to become unstuck before repathing
   * with the fallbackOpts. Default is 3.
   */
  repathIfStuck?: number;
  /**
   * If set, will visualize the path using provided styles.
   */
  visualizePathStyle?: PolyStyle;
  /**
   * If target range would extend out of the target room, trim to keep target in room
   */
  keepTargetInRoom?: boolean;
  /**
   * Automatically populates cost matrix with creep positions.
   */
  avoidCreeps?: boolean;
  /**
   * Automatically populates cost matrix with structure positions.
   */
  avoidObstacleStructures?: boolean;
  /**
   * Always path around Source Keeper-protected resources.
   */
  avoidSourceKeepers?: boolean;

  /**
   * Cost for walking on road positions. The default is 1.
   */
  roadCost?: number;
  /**
   * Cost for walking on plain positions. The default is 2.
   */
  plainCost?: number;
  /**
   * Cost for walking on swamp positions. The default is 10.
   */
  swampCost?: number;
  /**
   * When calling {@link moveTo} on a creep that is already within range
   * of a target, it will prefer to stay in place, but it will also accept
   * any adjacent position within range of a target as long as the cost
   * for that position is less than this threshold.
   *
   * This option is ignored if {@link roomCallback} is undefined or
   * does not return a cost matrix for the current room.
   *
   * This value should always be less than or equal to 255. At 255, any walkable
   * adjacent position is considered viable. The default is 255.
   */
  shoveCostLimit?: number;
  /**
   * Movement priority (higher-value moves override lower-value moves). The default is 1.
   */
  priority?: number;
  /**
   * Default cost for a room in findRoute callback (may be overridden
   * if routeCallback is provided). Defaults to 2.
   */
  defaultRoomCost?: number;
  /**
   * Cost for a Source Keeper room in findRoute callback (may be overridden
   * if routeCallback is provided). Defaults to 2.
   */
  sourceKeeperRoomCost?: number;
  /**
   * Cost for a highway room in findRoute callback (may be overridden
   * if routeCallback is provided). Defaults to 1.
   */
  highwayRoomCost?: number;
  /**
   * The maximum allowed pathfinding operations per room (if maxOps is higher for a short path, PathFinder will use the lower).
   * You can limit CPU time used for the search based on ratio 1 op ~ 0.001 CPU. The default value is 2000.
   */
  maxOpsPerRoom?: number;
  /**
   * This callback works like the builtin `findRoute` and will override
   * the default values for highway/source keeper room cost unless you
   * return `undefined`.
   */
  routeCallback?: (roomName: string, fromRoomName: string) => number | undefined;
  /**
   * Creep used capacity and body, used to calculate default terrain costs.
   */
  creepMovementInfo?: { usedCapacity: number; body: Creep['body'] };
  /**
   * Targets for dynamic avoidance - will re-route to path around avoidance regions
   * if they intersect with creep's current path
   */
  avoidTargets?: (roomName: string) => MoveTarget[];
  /**
   * Gradient for avoid targets - by default, tiles within an avoidTarget will be
   * set to 254, but if a gradient is set, the cost will decrease by (gradient * range)
   * for each tile away from the target.
   */
  avoidTargetGradient?: number;
  /**
   * By default, portals will be blocked in the cost matrix if we aren't traveling through them
   * to avoid ending up somewhere random. Set this to true to ignore portals in the cost matrix.
   * This does not affect travel through portals.
   *
   * **Warning:** This only applies to intrashard portals. Intershard portals will not be
   * automatically blocked in the cost matrix regardless of this setting.
   */
  ignorePortals?: boolean;
  /**
   * By default, portals are used for travel if they are the shortest path. Set this to true to
   * avoid using portals for travel.
   */
  avoidPortals?: boolean;
}

export * from './CachingStrategies';
export * as Keys from './Keys';
export * from './Movement/cachedPaths';
export * from './Movement/generatePath';
export * from './Movement/move';
export * from './Movement/moveByPath';
export * from './Movement/moveTo';
export * from './Movement/pull';
export * from './Movement/roomPositions';
export * from './Movement/selectors';
export { blockSquare, getMoveIntents } from './TrafficManager/moveLedger';
export * from './TrafficManager/reconcileTraffic';

export function preTick() {
  cleanAllCaches();
  updateIntel();
}
