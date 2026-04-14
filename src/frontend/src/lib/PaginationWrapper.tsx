import React, { useCallback } from "react"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/ui-components/pagination"

export interface OnChangeEventType {
  target: {
    name: string
    value: number
  }
}

export interface PropsType extends React.ComponentPropsWithRef<typeof Pagination> {
  aroundCurrent?: number
  atBeginEnd?: number
  disabled?: boolean
  firstPageValue?: number
  name?: string
  readOnly?: boolean
  showFirstLast?: boolean
  showPrevNext?: boolean
  totalPages?: number
  page: number
  onPageChange: (event: OnChangeEventType) => void
}

export const defaultProps = {
  atBeginEnd: 2,
  aroundCurrent: 1,
  firstPageValue: 0,
  name: "page",
  showPrevNext: true,
}

const ELLIPSIS_MARK = -1

const PaginationWrapper = ({
  atBeginEnd = defaultProps.atBeginEnd,
  aroundCurrent = defaultProps.aroundCurrent,
  disabled,
  firstPageValue = defaultProps.firstPageValue,
  name = defaultProps.name,
  readOnly,
  showPrevNext = defaultProps.showPrevNext,
  totalPages,
  page,
  onPageChange,
  ...etc
}: PropsType) => {
  const zeroBasedValue = page - firstPageValue
  const handleClickF = useCallback(
    (page: number) => {
      if (!onPageChange) {
        console.warn(`onChange() method is not set for PaginationWrapper ("${name}"), but page change occurs`)
        return
      }
      const toReport: number = page + firstPageValue
      return onPageChange({ target: { name, value: toReport } })
    },
    [firstPageValue, name, onPageChange],
  )

  const handlePrev = useCallback(() => handleClickF(zeroBasedValue - 1), [handleClickF, zeroBasedValue])
  const handlePage = useCallback((page: number) => handleClickF(page), [handleClickF])
  const handleNext = useCallback(() => handleClickF(zeroBasedValue + 1), [handleClickF, zeroBasedValue])

  const linksToDisplay: number[] = calcLinksToDisplay(
    totalPages,
    zeroBasedValue,
    atBeginEnd,
    aroundCurrent,
    ELLIPSIS_MARK,
  )

  const allDisabled = disabled || readOnly

  return (
    <Pagination {...etc}>
      <PaginationContent>
        {showPrevNext && (zeroBasedValue <= 0 || allDisabled) ? (
          <PaginationItem key="-1">
            <PaginationPrevious />
          </PaginationItem>
        ) : (
          <PaginationItem key="-1">
            <PaginationPrevious onClick={handlePrev} />
          </PaginationItem>
        )}
        {linksToDisplay.map((p: number, index: number) =>
          p === zeroBasedValue ? (
            <PaginationItem key={p}>
              <PaginationLink isActive>{p + 1}</PaginationLink>
            </PaginationItem>
          ) : p === ELLIPSIS_MARK ? (
            <PaginationItem key={`_${index}`}>
              <PaginationEllipsis />
            </PaginationItem>
          ) : allDisabled ? (
            <PaginationItem key={p}>
              <PaginationLink>{p + 1}</PaginationLink>
            </PaginationItem>
          ) : (
            <PaginationItemWrapper key={p} onClick={handlePage} page={p} />
          ),
        )}
        {showPrevNext && ((totalPages !== undefined && zeroBasedValue >= totalPages - 1) || allDisabled) ? (
          <PaginationItem key="+1">
            <PaginationNext />
          </PaginationItem>
        ) : (
          <PaginationItem key="+1">
            <PaginationNext onClick={handleNext} />
          </PaginationItem>
        )}
      </PaginationContent>
    </Pagination>
  )
}

const PaginationItemWrapper = ({ page, onClick }: { onClick: (page: number) => unknown; page: number }) => {
  const handleClick = useCallback(() => onClick(page), [onClick, page])
  return (
    <PaginationItem>
      <PaginationLink onClick={handleClick}>{page + 1}</PaginationLink>
    </PaginationItem>
  )
}

function calcLinksToDisplay(
  totalPages: number | undefined,
  currentPage: number,
  atBeginEnd: number,
  aroundCurrent: number,
  ellipsisMark: number,
): number[] {
  const result: number[] = []

  for (let page = 0; page < (totalPages === undefined ? atBeginEnd : Math.min(atBeginEnd, totalPages)); page++) {
    if (!result.includes(page)) result.push(page)
  }

  if (result.length !== 0) {
    const lastInLinks: number = result[result.length - 1]!
    if (lastInLinks < Math.max(currentPage - aroundCurrent, 0) - 1) result.push(ellipsisMark)
  } else if (Math.max(currentPage - aroundCurrent, 0) > 0) result.push(ellipsisMark)

  for (
    let page = Math.max(currentPage - aroundCurrent, 0);
    page <=
    (totalPages === undefined ? currentPage + aroundCurrent : Math.min(currentPage + aroundCurrent, totalPages - 1));
    page++
  ) {
    if (!result.includes(page)) result.push(page)
  }

  if (totalPages !== undefined) {
    if (result.length !== 0) {
      const lastInLinks = result[result.length - 1]!
      if (lastInLinks < Math.max(totalPages - atBeginEnd, 0) - 1 && lastInLinks !== ellipsisMark) {
        result.push(ellipsisMark)
      }
    }

    if (totalPages !== undefined && totalPages !== Number.POSITIVE_INFINITY) {
      for (let page = Math.max(totalPages - atBeginEnd, 0); page <= totalPages - 1; page++) {
        if (!result.includes(page)) result.push(page)
      }
    }
  }

  return result
}

export default React.memo(PaginationWrapper)
