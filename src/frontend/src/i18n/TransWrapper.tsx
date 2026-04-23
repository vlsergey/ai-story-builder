import type { ParseKeys, TOptions } from "i18next"
import { Trans } from "react-i18next"

interface TransWrapperProps {
  i18nKey: ParseKeys
  values?: TOptions
}

export default function TransWrapper({ i18nKey, values = {} }: TransWrapperProps) {
  return <Trans components={{ code: <code />, strong: <strong /> }} i18nKey={i18nKey} values={values} />
}
