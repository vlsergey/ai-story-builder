export default function getDifference<T extends object>(objA: T, objB: T): Partial<T> {
  return Object.keys(objB).reduce(
    (diff, key) => {
      const k = key as keyof T
      if (objA[k] !== objB[k]) {
        diff[k] = objB[k]
      }
      return diff
    },
    {} as Partial<T>,
  )
}
