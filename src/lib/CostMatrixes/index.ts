import { type MoveOpts, type MoveTarget } from 'lib';
import { portalSets } from 'lib/WorldMap/portals';
import { calculateNearbyPositions } from '../Movement/selectors';
import { avoidSourceKeepers } from './sourceKeepers';

export interface CostMatrixOptions {
  avoidCreeps?: boolean;
  avoidObstacleStructures?: boolean;
  avoidSourceKeepers?: boolean;
  ignorePortals?: boolean;
  roadCost?: number;
  avoidTargets?: (roomName: string) => MoveTarget[];
  avoidTargetGradient?: number;
}

/**
 * Applies Options to the clone of a CostMatrix, returning the new matrix.
 * If no Options apply, returns the original matrix.
 */
export const applyCostMatrixOptions = (cm: CostMatrix, room: string, opts: CostMatrixOptions): CostMatrix => {
  let clonedMatrix: CostMatrix | undefined = undefined;

  if (opts.avoidCreeps) {
    const matrix = clonedMatrix ??= cm.clone();
    Game.rooms[room]?.find(FIND_CREEPS).forEach(c => matrix.set(c.pos.x, c.pos.y, 255));
    Game.rooms[room]?.find(FIND_POWER_CREEPS).forEach(c => matrix.set(c.pos.x, c.pos.y, 255));
  }
  if (opts.avoidSourceKeepers) {
    const matrix = clonedMatrix ??= cm.clone();
    avoidSourceKeepers(room, matrix);
  }
  if (opts.avoidObstacleStructures || opts.roadCost) {
    const matrix = clonedMatrix ??= cm.clone();

    if (opts.avoidObstacleStructures) {
      Game.rooms[room]?.find(FIND_MY_CONSTRUCTION_SITES).forEach(s => {
        if ((OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType)) {
          matrix.set(s.pos.x, s.pos.y, 255);
        }
      });
    }
    Game.rooms[room]?.find(FIND_STRUCTURES).forEach(s => {
      if (opts.avoidObstacleStructures) {
        if (
          (OBSTACLE_OBJECT_TYPES as string[]).includes(s.structureType) ||
          (s.structureType === STRUCTURE_RAMPART && !s.my && !s.isPublic)
        ) {
          matrix.set(s.pos.x, s.pos.y, 255);
        }
      }
      if (opts.roadCost) {
        if (s instanceof StructureRoad && matrix.get(s.pos.x, s.pos.y) === 0) {
          matrix.set(s.pos.x, s.pos.y, opts.roadCost);
        }
      }
    });
  }
  if (opts.avoidTargets) {
    const matrix = clonedMatrix ??= cm.clone();
    const terrain = Game.map.getRoomTerrain(room);
    for (const t of opts.avoidTargets(room))
      for (const p of calculateNearbyPositions(t.pos, t.range, true))
        if (terrain.get(p.x, p.y) !== TERRAIN_MASK_WALL) {
          const avoidWeight = 254 - p.getRangeTo(t.pos) * (opts.avoidTargetGradient ?? 0);
          matrix.set(p.x, p.y, Math.max(matrix.get(p.x, p.y), avoidWeight));
        }
  }

  if (!opts.ignorePortals) {
    const matrix = clonedMatrix ??= cm.clone();
    const portalCoords = [...(portalSets.get(room)?.values() ?? [])].flatMap(p => {
      if (room === p.room1) return [...p.portalMap.keys()];
      return [...p.portalMap.reversed.keys()];
    });
    portalCoords.forEach(c => matrix.set(c.x, c.y, 255));
  }

  return clonedMatrix ?? cm;
};

export const configureRoomCallback = (actualOpts: MoveOpts, targetRooms?: string[]) => (room: string) => {
  if (targetRooms && !targetRooms.includes(room)) return false; // outside route search space
  let cm = actualOpts.roomCallback?.(room);
  if (cm === false || cm === true) return cm;
  return applyCostMatrixOptions(cm || new PathFinder.CostMatrix(), room, actualOpts);
};