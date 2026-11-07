// All tunable numbers in one place.

export const CFG = {
  startMoney: 30,

  player: {
    speed: 5.4,
    capacity: 6,
    pickupInterval: 0.11,
    dropInterval: 0.09,
    collectRadius: 1.6,
  },

  upgrades: {
    capacity: [6, 8, 10, 13, 16],
    capacityPrice: [50, 120, 260, 520],
    speed: [5.4, 6.0, 6.6, 7.2],
    speedPrice: [60, 150, 320],
  },

  ticket: {
    serveTime: 0.55,
    clerkServeTime: 0.85,
    price: { bike: 3, sedan: 6, pickup: 7, rv: 12 } as Record<string, number>,
    vipMultiplier: 3,
  },

  vehicles: {
    spawnInterval: 2.6,
    maxQueue: 6,
    speed: 7,
  },

  ferry: {
    dockTime: 32, // seconds before forced departure (once something is on board)
    sailOut: 5.5,
    atIsland: 2.5,
    sailBack: 5.5,
    columns: 2,
    rowsByLevel: [3, 4, 5],
    cargoByLevel: [6, 9, 12],
    cargoPrice: 2,
    fullBonus: 15,
    lobstersBase: 3,
    lobstersPerCargo: 1,
  },

  shed: { interval: 1.1, max: 12 },

  stand: { stockMax: 12, lobsterPrice: 4, spawnInterval: 3.4, maxQueue: 5 },
  shack: { inputMax: 10, outputMax: 8, cookTime: 2.2, perRoll: 2, rollPrice: 14, spawnInterval: 4.2, maxQueue: 4 },

  workers: { speed: 3.4, capacity: 4 },

  levels: [0, 6, 14, 24, 36, 50], // cumulative stars to reach level index+1

  events: {
    gullMinLevel: 3,
    gullInterval: [35, 55] as [number, number],
    vipMinLevel: 3,
    vipInterval: [40, 60] as [number, number],
  },
};

export type ItemKind = 'box' | 'lobster' | 'roll';
