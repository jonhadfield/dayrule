import { createContext, useContext } from 'react'

export const InSheet = createContext(false)

/**
 * True inside a mobile sheet. Fields there shouldn't take focus on open:
 * on a phone that raises the keyboard over most of the sheet.
 */
export const useInSheet = () => useContext(InSheet)
