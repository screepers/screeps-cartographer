import type { MoveOpts, MoveTarget } from '..';
import { logCpu, logCpuStart } from '../../utils/logCpu';
import {
  CachingStrategies,
  GenericCachingStrategy,
  MoveTargetListSerializer,
  PositionListSerializer
} from '../CachingStrategies';
import { JsonSerializer } from '../CachingStrategies/Serializers/Json';
import { creepKey } from '../Keys/Creep';
// import { logCpu, logCpuStart } from '../../utils/logCpu';
import { HeapCache } from 'lib/CachingStrategies/Heap';
import { configureRoomCallback } from 'lib/CostMatrixes';
import { pathHasAvoidTargets } from 'lib/WorldMap/pathHasAvoidTargets';
import { slicedPath } from 'lib/WorldMap/selectors';
import { config } from '../../config';
import { generatePath } from '../Movement/generatePath';
import { cachePath, cachedPathKey, followPath, getCachedPath, resetCachedPath } from './cachedPaths';
import { creepIsStuck } from './creepIsStuck';
import { move } from './move';
import { adjacentWalkablePositions, normalizeTargets } from './selectors';

const DEBUG = false;

declare global {
  interface CreepMemory {
    _cmvp?: string;
    _cmvt?: string;
  }

  interface PowerCreepMemory {
    _cmvp?: string;
    _cmvt?: string;
  }
}

const keys = {
  CACHED_PATH: '_cp',
  CACHED_PATH_EXPIRES: '_ce',
  CACHED_PATH_TARGETS: '_ct',
  CACHED_PATH_OPTS: '_co',
  MOVE_BY_PATH_INDEX: '_cpi'
};

const optCacheFields: (keyof MoveOpts)[] = [
  'avoidCreeps',
  'avoidObstacleStructures',
  'flee',
  'plainCost',
  'swampCost',
  'roadCost'
];

/**
 * Clears all data for a cached path (useful to force a repath)
 */
export function clearCachedPath(
  creep: Creep | PowerCreep,
  cache: GenericCachingStrategy<any> = CachingStrategies.HeapCache
) {
  resetCachedPath(creepKey(creep, keys.CACHED_PATH), { cache });
  cache.delete(creepKey(creep, keys.CACHED_PATH_TARGETS));
  cache.delete(creepKey(creep, keys.CACHED_PATH_OPTS));
}

/**
 * Replacement for the builtin moveTo, but passes through options to PathFinder. Supports
 * multiple targets, flee, etc. See `MoveOpts`.
 *
 * If fallbackOpts is specified, the options will override `opts` *only* if `repathIfStuck`
 * triggers a repath. This lets you ignore creeps until a creep gets stuck, then repath around
 * them, for example.
 */
export const moveTo = (
  creep: Creep | PowerCreep,
  targets: _HasRoomPosition | RoomPosition | MoveTarget | RoomPosition[] | MoveTarget[],
  opts?: MoveOpts,
  fallbackOpts: MoveOpts = { avoidCreeps: true }
) => {
  if (DEBUG) logCpuStart();

  // unspawned power creeps have undefined pos
  if (!creep.pos) return ERR_INVALID_ARGS;

  // map defaults onto opts
  let actualOpts: MoveOpts = {
    ...config.DEFAULT_MOVE_OPTS,
    ...opts
  };

  if (DEBUG) logCpu('mapping opts');

  // select cache for path
  const cache = opts?.cache ?? CachingStrategies.HeapCache;

  // convert target from whatever format to MoveTarget[]
  let normalizedTargets: MoveTarget[] = normalizeTargets(targets, actualOpts.keepTargetInRoom, actualOpts.flee);

  if (DEBUG) logCpu('normalizing targets');

  let needToFlee = false;
  let cachedTargets = cache.with(MoveTargetListSerializer).get(creepKey(creep, keys.CACHED_PATH_TARGETS));
  for (let i = 0; i < normalizedTargets.length; i++) {
    const { pos, range } = normalizedTargets[i];
    // check if movement is complete
    if (!needToFlee && pos.inRangeTo(creep.pos, range) && creep.pos.roomName === pos.roomName) {
      if (!opts?.flee) {
        // no need to move, path complete
        clearCachedPath(creep, cache);
        // register move intent to stay here or in an adjacent viable position
        const cm = configureRoomCallback(actualOpts)(creep.pos.roomName);
        move(
          creep,
          [
            creep.pos,
            ...adjacentWalkablePositions(creep.pos, true).filter(
              p => normalizedTargets.some(t => t.pos.inRangeTo(p, t.range)) && (!cm || cm.get(p.x, p.y) !== 255) // exclude squares that are blocked by a cost matrix
            )
          ],
          actualOpts.priority
        );
        return OK;
      } else {
        needToFlee = true; // need to move, still in range of flee targets
      }
    }
    // check if cached targets are the same, there is no reason why the order should change
    const ct = cachedTargets?.[i];
    if (!ct || !ct.pos.isEqualTo(pos) || ct.range !== range) {
      // cached path had different targets
      clearCachedPath(creep, cache);
      cachedTargets = undefined;
    }
  }

  if (DEBUG) logCpu('checking targets');

  // if relevant opts have changed, clear cached path
  const cachedOpts = cache.with(JsonSerializer).get(creepKey(creep, keys.CACHED_PATH_OPTS));
  if (!cachedOpts || optCacheFields.some(f => actualOpts[f as keyof MoveOpts] !== cachedOpts[f])) {
    clearCachedPath(creep, cache);
  }

  // Skip if power creep or any costs has been manually set.
  if (DEBUG) logCpu('adding creep info for calculate default road, plain and swamp costs');
  const manuallyDefinedCosts = [opts?.roadCost, opts?.plainCost, opts?.swampCost].some(cost => cost !== undefined);
  if ('body' in creep && !manuallyDefinedCosts) {
    actualOpts = {
      creepMovementInfo: { usedCapacity: creep.store.getUsedCapacity(), body: creep.body },
      ...actualOpts
    };
  }

  if (DEBUG) logCpu('checking opts');

  // cache opts
  const expiration = actualOpts.reusePath ? Game.time + actualOpts.reusePath + 1 : undefined;
  cache.with(MoveTargetListSerializer).set(creepKey(creep, keys.CACHED_PATH_TARGETS), normalizedTargets, expiration);
  cache.with(JsonSerializer).set(
    creepKey(creep, keys.CACHED_PATH_OPTS),
    optCacheFields.reduce((sum, f) => {
      sum[f] = actualOpts[f] as any;
      return sum;
    }, {} as MoveOpts),
    expiration
  );

  // If creep is stuck, we need to repath
  const cachedPath = getCachedPath(creepKey(creep, keys.CACHED_PATH), { cache });
  const cachedMoveIndex = HeapCache.get(creepKey(creep, keys.MOVE_BY_PATH_INDEX));
  const slicedCachedPath = cachedPath && slicedPath(cachedPath, cachedMoveIndex ?? 0);
  const avoidTargets = actualOpts.avoidTargets?.(creep.pos.roomName) ?? [];
  if (actualOpts.repathIfStuck && cachedPath && creepIsStuck(creep, actualOpts.repathIfStuck)) {
    resetCachedPath(creepKey(creep, keys.CACHED_PATH), { cache });
    actualOpts = {
      ...actualOpts,
      ...fallbackOpts
    };
  } else if (slicedCachedPath?.length && pathHasAvoidTargets(slicedCachedPath, avoidTargets)) {
    // If cached path has avoid targets, we need to repath
    // find the last segment of the path after all avoid targets in this room
    let lastAvoidIndex = 0;
    slicedCachedPath.forEach((pos, i) => {
      if (avoidTargets.some(t => t.pos.inRangeTo(pos, t.range))) {
        lastAvoidIndex = i;
      }
    });
    const remainingPath = slicedCachedPath.slice(lastAvoidIndex);
    const reroute = generatePath(
      creep.pos,
      remainingPath.map(pos => ({ pos, range: 0 })),
      {
        ...actualOpts,
        cache,
        flee: false
      }
    );
    if (!reroute) {
      // reroute failed - reset path and try again
      resetCachedPath(creepKey(creep, keys.CACHED_PATH), { cache });
    } else {
      // reroute succeeded - update cached path
      let joinIndex: number | undefined = undefined; // furthest point on remainingPath that is in range of reroute
      for (let i = 0; i < remainingPath.length; i++) {
        if (reroute[reroute.length - 1].inRangeTo(remainingPath[i], 1)) {
          joinIndex = i;
          continue;
        }
        if (joinIndex !== undefined) break;
      }
      if (joinIndex === undefined) {
        // reroute failed - reset path and try again
        resetCachedPath(creepKey(creep, keys.CACHED_PATH), { cache });
      } else {
        cache
          .with(PositionListSerializer)
          .set(
            cachedPathKey(creepKey(creep, keys.CACHED_PATH)),
            reroute.concat(remainingPath.slice(joinIndex)),
            expiration
          );
      }
    }
  }

  if (DEBUG) logCpu('checking if creep is stuck');

  // generate cached path, if needed - cachePath will also normalize targets
  const path = cachePath(creepKey(creep, keys.CACHED_PATH), creep.pos, targets, { ...actualOpts, cache });

  if (!path) return ERR_NO_PATH;

  if (DEBUG) logCpu('generating cached path');

  // move to any viable target square, if path is nearly done
  if (path && path[path.length - 2]?.isEqualTo(creep.pos)) {
    // Nearly at end of path
    let cm = configureRoomCallback(actualOpts)(creep.pos.roomName);

    const notBlockedOnCostMatrix =
      cm instanceof PathFinder.CostMatrix
        ? (p: RoomPosition) => (cm as PathFinder['CostMatrix']).get(p.x, p.y) < 254 // 254 is used to "soft block" travel
        : () => true;
    const matchesTargetRange = !opts?.flee
      ? (p: RoomPosition) => normalizedTargets.some(t => t.pos.inRangeTo(p, t.range))
      : (p: RoomPosition) => normalizedTargets.every(t => t.pos.getRangeTo(p) >= t.range);
    const targets = adjacentWalkablePositions(creep.pos, true).filter(
      (p: RoomPosition) => matchesTargetRange(p) && notBlockedOnCostMatrix(p)
    );
    if (targets.length) {
      move(creep, targets, actualOpts.priority);
      return OK;
    }
    // otherwise, just follow the path
  }

  // move by path
  let result = followPath(creep, creepKey(creep, keys.CACHED_PATH), {
    ...actualOpts,
    reverse: false,
    cache
  });
  if (result === ERR_NOT_FOUND) {
    // creep has fallen off path: repath and try again
    clearCachedPath(creep, cache);
    cachePath(creepKey(creep, keys.CACHED_PATH), creep.pos, normalizedTargets, { ...actualOpts, cache });
    result = followPath(creep, creepKey(creep, keys.CACHED_PATH), {
      ...actualOpts,
      reverse: false,
      cache
    });
  }

  if (DEBUG) logCpu('moving by path');

  return result;
};
