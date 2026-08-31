import { memoize, memoizeByTick } from 'lib/Utils/memoize';
import { roomNameToCoords } from 'utils/packPositions';
import { MoveOpts } from '../';
import { config } from '../../config';
import { PortalSet, describeExitsWithPortals, portalSets } from './portals';
import { isHighway, isSourceKeeperRoom } from './selectors';

/**
 * Uses findRoute to create a base route, then enhances
 * it by adding rooms (up to maxRooms) to improve pathfinding
 */
export function findRoute(
  room1: string,
  targetRooms: string[],
  opts?: MoveOpts
): { rooms: string[]; portalSet?: PortalSet }[] | undefined {
  const actualOpts = {
    ...config.DEFAULT_MOVE_OPTS,
    ...opts
  };
  // prepare routeCallback
  const memoizedRouteCallback = memoize(
    (roomName, fromRoomName) => roomName + fromRoomName,
    (roomName: string, fromRoomName: string): number | undefined => {
      const result = actualOpts.routeCallback?.(roomName, fromRoomName);
      if (result !== undefined) return result;
      if (isHighway(roomName)) return actualOpts.highwayRoomCost;
      if (isSourceKeeperRoom(roomName)) return actualOpts.sourceKeeperRoomCost;
      return actualOpts.defaultRoomCost;
    }
  ) as (roomName: string, fromRoomName: string) => number;

  // Generate base route, taking portals into account
  const generatedRoutes = findRouteWithPortals(
    room1,
    targetRooms,
    {
      routeCallback: memoizedRouteCallback
    },
    actualOpts.avoidPortals
  );
  if (generatedRoutes === ERR_NO_PATH) return undefined;

  // enhance the route with extra rooms to improve pathfinding
  return generatedRoutes.map(route => {
    const rooms = enhanceRoute(route, memoizedRouteCallback, actualOpts);
    return {
      rooms,
      portalSet: route[route.length - 1]?.portalSet
    };
  });
}

/**
 * Adds extra rooms to a given route to improve pathfinding (e.g. routing through
 * an inside corner when the route turns)
 */
function enhanceRoute(
  route: { exit?: ExitConstant; room: string }[],
  memoizedRouteCallback: (room: string, fromRoom: string) => number,
  actualOpts: MoveOpts
) {
  let rooms = new Set(route.map(({ room }) => room));
  let blockedRooms = new Set<string>();
  const maxRooms = actualOpts.maxRooms!;
  for (let i = 0; i < route.length - 1; i++) {
    // check if we've met our limit
    if (rooms.size >= maxRooms) break;
    if (!route[i].exit) break;

    // check for areas PathFinder might be able to optimize

    // Route turns a corner: add the room inside the corner
    if (route[i].exit !== route[i + 1].exit) {
      const detour = Game.map.describeExits(route[i].room)[route[i + 1].exit!];

      if (
        detour &&
        Game.map.findExit(detour, route[i + 1].room) > 0 &&
        // Ignore the detour if it the alternative route cost is higher than the original
        memoizedRouteCallback(detour, route[i].room) <= memoizedRouteCallback(route[i + 1].room, route[i].room)
      ) {
        // detour room is connected
        rooms.add(detour);
      }
    }

    // Route is straight, but exit tiles are all to one side of the border
    // Might be faster to detour through neighboring rooms
    if (
      (route[i].exit === route[i + 1].exit || !route[i + 1].exit) &&
      (!route[i + 2]?.exit || route[i].exit === route[i + 2].exit)
    ) {
      // Ignore possible detour if the 2 extra rooms would cause the maxRooms limit to be exceeded
      if (rooms.size >= actualOpts.maxRooms! - 1) continue;
      // Straight line for the next three rooms (or until route ends)
      // Check if there are exit tiles on both halves of the border
      const regions = exitTileRegions(route[i].room, route[i].exit!);
      if (regions.every(r => r)) {
        continue;
      }
      // one half does not have an exit tile.
      let detour: ExitConstant | undefined = undefined;
      if (!regions[0] && (route[i].exit === FIND_EXIT_TOP || route[i].exit === FIND_EXIT_BOTTOM)) {
        detour = FIND_EXIT_LEFT;
      } else if (!regions[1] && (route[i].exit === FIND_EXIT_TOP || route[i].exit === FIND_EXIT_BOTTOM)) {
        detour = FIND_EXIT_RIGHT;
      } else if (!regions[0] && (route[i].exit === FIND_EXIT_LEFT || route[i].exit === FIND_EXIT_RIGHT)) {
        detour = FIND_EXIT_TOP;
      } else if (!regions[1] && (route[i].exit === FIND_EXIT_LEFT || route[i].exit === FIND_EXIT_RIGHT)) {
        detour = FIND_EXIT_BOTTOM;
      }
      if (!detour) throw new Error('Invalid exit tile state: ' + route[i].exit + JSON.stringify(regions));

      // check detour rooms for continuity
      const detour1 = Game.map.describeExits(route[i].room)[detour];
      const detour2 = Game.map.describeExits(route[i + 1].room)[detour];
      if (
        detour1 &&
        detour2 &&
        Game.map.findExit(detour1, detour2) > 0 &&
        // Ignore the detour if it the alternative route cost is higher than the original
        (memoizedRouteCallback(detour1, route[i].room) + memoizedRouteCallback(route[i + 1].room, detour2) <=
          memoizedRouteCallback(route[i + 1].room, route[i].room) + memoizedRouteCallback(route[i + 2].room, route[i + 1].room))
      ) {
        // detour rooms are connected
        rooms.add(detour1);
        rooms.add(detour2);
      }
    }
  }
  // now floodfill adjoining rooms, up to maxRooms
  const frontier = [...rooms];
  while (rooms.size < maxRooms) {
    const room = frontier.shift();
    if (!room) break;
    const exits = Game.map.describeExits(room);
    if (!exits) continue;
    for (const adjacentRoom of Object.values(exits)) {
      if (rooms.has(adjacentRoom)) continue;
      if (memoizedRouteCallback(adjacentRoom, room) !== Infinity) {
        rooms.add(adjacentRoom);
        frontier.push(adjacentRoom);
      }
    }
  }
  return [...rooms];
}

function exitTileRegions(room: string, exit: ExitConstant): [boolean, boolean] {
  const terrain = Game.map.getRoomTerrain(room);
  let region1 = false;
  for (let i = 0; i < 25; i++) {
    const { x, y } = exitTileByIndex(exit, i);
    if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
      region1 = true;
      break;
    }
  }
  let region2 = false;
  for (let i = 25; i < 49; i++) {
    const { x, y } = exitTileByIndex(exit, i);
    if (terrain.get(x, y) !== TERRAIN_MASK_WALL) {
      region2 = true;
      break;
    }
  }
  return [region1, region2];
}

function exitTileByIndex(exit: ExitConstant, index: number) {
  if (exit === FIND_EXIT_TOP) return { x: index, y: 0 };
  if (exit === FIND_EXIT_BOTTOM) return { x: index, y: 49 };
  if (exit === FIND_EXIT_LEFT) return { x: 0, y: index };
  return { x: 49, y: index }; // FIND_EXIT_RIGHT
}

class PriorityQueue<T> {
  private queue: [number, T][] = [];

  put(item: T, priority: number) {
    let insertIndex = this.queue.findIndex(([p]) => p > priority);
    if (insertIndex === -1) insertIndex = this.queue.length;
    this.queue.splice(insertIndex, 0, [priority, item]);
  }
  take() {
    return this.queue.shift()?.[1];
  }
  *[Symbol.iterator]() {
    for (const [_, item] of this.queue) {
      yield item;
    }
  }
}

const manhattanDistance = memoizeByTick(
  (fromRoom, toRoom) => fromRoom + toRoom,
  (fromRoom: string, toRoom: string) => {
    const { wx: fromX, wy: fromY } = roomNameToCoords(fromRoom);
    const { wx: toX, wy: toY } = roomNameToCoords(toRoom);

    // Manhattan distance
    return Math.abs(fromX - toX) + Math.abs(fromY - toY);
  }
);

const manhattanDistanceToClosestPortal = memoizeByTick(
  room => room,
  (room: string) => {
    let minDistance = Infinity;
    for (const portal of portalSets.keys()) {
      minDistance = Math.min(minDistance, manhattanDistance(room, portal));
    }
    return minDistance;
  }
);

/**
 * Normal A* heuristic would just be the manhattan distance - here we
 * must include distance to the nearest portals as well. This is still
 * an admissible heuristic: https://stackoverflow.com/a/14428389
 */
function findRouteHeuristic(fromRoom: string, toRoom: string) {
  return Math.min(
    manhattanDistance(fromRoom, toRoom),
    manhattanDistanceToClosestPortal(fromRoom) + manhattanDistanceToClosestPortal(toRoom)
  );
}

/**
 * Returns a sequence of rooms. Exits between rooms may be normal room exits or a portal set.
 */
export function findRouteWithPortals(
  fromRoom: string,
  toRooms: string[],
  opts?: RouteOptions,
  avoidPortals?: boolean
): { room: string; exit?: ExitConstant; portalSet?: PortalSet }[][] | ERR_NO_PATH {
  if (toRooms.includes(fromRoom)) return [];

  const routeCallback = opts?.routeCallback ?? (() => 1);

  // A* search, using describeExits to map the grid
  const frontier = new PriorityQueue<string>();
  frontier.put(fromRoom, 0);
  const cameFrom = new Map<string, string>();
  const costSoFar = new Map<string, number>();
  cameFrom.set(fromRoom, fromRoom);
  costSoFar.set(fromRoom, 0);

  let current = frontier.take();
  while (current) {
    if (toRooms.includes(current)) break;

    for (const next of describeExitsWithPortals(current)) {
      const cost = costSoFar.get(current)! + routeCallback(current, next);
      if (cost !== Infinity && (!costSoFar.has(next) || cost < costSoFar.get(next)!)) {
        costSoFar.set(next, cost);
        const priority = cost + Math.min(...toRooms.map(toRoom => findRouteHeuristic(next, toRoom)));
        frontier.put(next, priority);
        cameFrom.set(next, current);
      }
    }

    current = frontier.take();
  }

  if (current && toRooms.includes(current)) {
    // reconstruct path
    const paths: { room: string; exit?: ExitConstant; portalSet?: PortalSet }[][] = [];
    let path: { room: string; exit?: ExitConstant; portalSet?: PortalSet }[] = [{ room: current }];
    while (current !== fromRoom) {
      const previous: string = cameFrom.get(current)!;
      const portalSet = portalSets.get(previous)?.get(current);
      if (portalSet && !avoidPortals) {
        // there's a portal between these two rooms - use it
        paths.unshift(path);
        path = [{ room: previous, portalSet }];
      } else {
        // no portal - must be a regular exit
        const exit = Game.map.findExit(previous, current);
        path.unshift({
          room: previous,
          exit: exit === ERR_NO_PATH ? undefined : (exit as ExitConstant)
        });
      }
      current = previous;
    }
    paths.unshift(path);
    return paths;
  }

  return ERR_NO_PATH;
}
