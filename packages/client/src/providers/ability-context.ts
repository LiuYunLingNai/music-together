import { createContext } from 'react'
import { createContextualCan } from '@casl/react'
import { defineAbilityFor, type AppAbility } from '@music-together/shared'

export const AbilityContext = createContext<AppAbility>(defineAbilityFor('member'))
export const Can = createContextualCan(AbilityContext.Consumer)
