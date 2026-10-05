/** Rapier collision groups: (membership << 16) | filter. */
export const G = {
  STATIC: 1 << 0,
  CREW: 1 << 1,
  RAGDOLL: 1 << 2,
  ITEM: 1 << 3,
  POT: 1 << 4,
  CAT: 1 << 5,
  HELD: 1 << 6,
  STACK: 1 << 7,
  HAT: 1 << 8,
} as const;

const ALL = 0xffff;
export const groups = (membership: number, filter: number) => ((membership & 0xffff) << 16) | (filter & 0xffff);

export const CG = {
  static: groups(G.STATIC, ALL),
  crew: groups(G.CREW, G.STATIC | G.CREW | G.ITEM | G.POT | G.CAT | G.STACK | G.RAGDOLL),
  ragdoll: groups(G.RAGDOLL, G.STATIC | G.ITEM | G.POT | G.CREW | G.STACK | G.CAT),
  item: groups(G.ITEM, G.STATIC | G.CREW | G.ITEM | G.POT | G.CAT | G.STACK | G.RAGDOLL | G.HELD | G.HAT),
  held: groups(G.HELD, G.STATIC | G.ITEM | G.POT | G.STACK),
  pot: groups(G.POT, ALL & ~G.STACK),
  potStacked: groups(G.STACK, G.CREW | G.ITEM | G.CAT | G.RAGDOLL | G.HELD | G.HAT),
  cat: groups(G.CAT, G.STATIC | G.CREW | G.ITEM | G.POT | G.STACK | G.RAGDOLL),
  hat: groups(G.HAT, G.STATIC | G.ITEM | G.POT | G.STACK),
  /** Query filter that only hits static structure + stacked pots (for ground / line-of-sight rays). */
  queryStatic: groups(0xffff, G.STATIC | G.STACK | G.POT),
};
