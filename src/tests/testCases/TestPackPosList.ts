import {
  fromGlobalPosition,
  globalPosition,
  packCoordList,
  packPos,
  packPosList,
  packRoomName,
  unpackCoordList,
  unpackPos,
  unpackPosList,
  unpackRoomName
} from 'utils/packPositions';
import { generatePath } from '../../lib';
import { TestResult } from '../tests';
import { CartographerTestCase } from './CartographerTestCase';

export class TestPackPosList extends CartographerTestCase {
  _creeps = {};
  retries = 0;
  timeout = 50; // ticks
  test() {
    const currentRoom = this.spawn.room;
    let adjacentRoom = Object.values(Game.map.describeExits(currentRoom.name))
      .find(r => Object.values(Game.map.describeExits(r)).find(r => r !== currentRoom.name))!;
    let nextAdjacentRoom = Object.values(Game.map.describeExits(adjacentRoom))
      .find(r => r !== currentRoom.name)!;

    const path = generatePath(this.spawn.pos, [{ pos: new RoomPosition(25, 25, nextAdjacentRoom), range: 20 }]);
    const coordPath = path?.map(p => ({ x: p.x, y: p.y }));

    if (!path) {
      console.log('[TestPackPosList] Unable to generate path');
      return TestResult.FAIL;
    }

    if (!unpackPos(packPos(this.spawn.pos)).isEqualTo(this.spawn.pos)) {
      console.log('[TestPackPosList] Inconsistent packPos results');
      return TestResult.FAIL;
    }

    const packedList = packPosList(path);
    const packedUnpackedList = unpackPosList(packedList);
    if (!packedUnpackedList?.every((pos, i) => pos.isEqualTo(path[i]))) {
      console.log('[TestPackPosList] Inconsistent packPosList results');
      return TestResult.FAIL;
    }

    const packedCoordList = packCoordList(path.map(p => ({ x: p.x, y: p.y })));
    const packedUnpackedCoordList = unpackCoordList(packedCoordList);
    if (!packedUnpackedCoordList?.every((c, i) => c.x === coordPath?.[i].x && c.y === coordPath?.[i].y)) {
      console.log('[TestPackPosList] Inconsistent packCoordList results');
      return TestResult.FAIL;
    }

    const packedRoomName = packRoomName('W0N0');
    const unpackedRoomName = unpackRoomName(packedRoomName);
    if (unpackedRoomName !== 'W0N0') {
      console.log('[TestPackPosList] Inconsistent packRoomName results');
      return TestResult.FAIL;
    } else {
      console.log('[TestPackPosList] packRoomName results:', packedRoomName);
    }

    const testGlobalPositions = [
      new RoomPosition(20, 20, 'E0N0'),
      new RoomPosition(20, 20, 'E0S0'),
      new RoomPosition(20, 20, 'W0N0'),
      new RoomPosition(20, 20, 'W0S0')
    ];
    for (const pos of testGlobalPositions) {
      if (!fromGlobalPosition(globalPosition(pos)).isEqualTo(pos)) {
        console.log('[TestPackPosList] Inconsistent globalPosition results');
        return TestResult.FAIL;
      }
    }

    // Report space savings

    console.log('Path length:', path.length);
    console.log('Packed length:', packedList.length);

    // Report CPU statistics

    const startPacking = Math.max(0, Game.cpu.getUsed());
    for (let i = 0; i < 1000; i += 1) {
      packPosList(path);
    }
    const packingCpu = Math.max(0, Game.cpu.getUsed()) - startPacking;
    console.log('Packing CPU (per pos):', packingCpu / (1000 * path.length));

    const startUnpacking = Math.max(0, Game.cpu.getUsed());
    for (let i = 0; i < 1000; i += 1) {
      unpackPosList(packedList);
    }
    const unpackingCpu = Math.max(0, Game.cpu.getUsed()) - startUnpacking;
    console.log('Unpacking CPU (per pos):', unpackingCpu / (1000 * path.length));

    // Test a range of other positions

    const testPositions = [
      new RoomPosition(25, 25, 'E0N0'),
      new RoomPosition(25, 25, 'E0S0'),
      new RoomPosition(25, 25, 'W0N0'),
      new RoomPosition(25, 25, 'W0S0'),
      new RoomPosition(25, 25, 'E100N100'),
      new RoomPosition(25, 25, 'E100S100'),
      new RoomPosition(25, 25, 'W100N100'),
      new RoomPosition(25, 25, 'W100S100')
    ];
    const testPackedList = packPosList(testPositions);
    const testUnpackedList = unpackPosList(testPackedList);
    if (!testUnpackedList?.every((pos, i) => pos.isEqualTo(testPositions[i]))) {
      console.log('[TestPackPosList] Inconsistent packPosList results');
      return TestResult.FAIL;
    }

    return TestResult.PASS;
  }
}
