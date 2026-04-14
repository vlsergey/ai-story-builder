export function makeErrorWithStatus(message: string, status: number): Error {
  const e = new Error(message)
  ;(e as any).status = status
  return e
}
